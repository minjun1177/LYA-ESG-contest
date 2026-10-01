import express from 'express';
import { isInKorea, isValidLatLng, distanceMeters } from '../lib/geo.js';
import { HAZARDS, HAZARD_CODES, SHELTER_TYPES } from '../lib/hazards.js';
import { findProvince, loadProvinces } from '../lib/provinces.js';
import { RateLimiter } from '../lib/rateLimit.js';
import {
  CONFIRMED_TTL_HOURS, REPORT_CATEGORIES, REPORT_CATEGORIES_REQUIRING_DESCRIPTION, REPORT_DESCRIPTION_MAX, REPORT_STATUS, VOTE_KINDS,
} from '../lib/reportStore.js';
import { assessRisk, RISK_RULES } from '../lib/risk.js';
import { matchShelters, searchShelters, sheltersInBounds } from '../lib/shelters.js';
import { GeocoderError } from '../services/geocoder.js';
import { warningsByProvince } from '../lib/warnings.js';

// 오류는 언어 중립 코드로만 응답하고, 화면에서 error.<code> 로 번역한다
class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function parseLatLng(query) {
  const lat = Number.parseFloat(query.lat);
  const lng = Number.parseFloat(query.lng);
  if (!isValidLatLng(lat, lng)) throw new ApiError(400, 'invalid_location');
  return { lat, lng };
}

function parseBbox(value) {
  const parts = String(value ?? '').split(',').map(Number.parseFloat);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new ApiError(400, 'invalid_bbox');
  const [minLng, minLat, maxLng, maxLat] = parts;
  return { minLng, minLat, maxLng, maxLat };
}

// 시연용 재난 시뮬레이션: ?simulate=heavy_rain | earthquake ...
function simulatedHazard(value) {
  if (!value) return null;
  if (!HAZARD_CODES.includes(value) || !HAZARDS[value].land) throw new ApiError(400, 'invalid_simulation');
  return value;
}

export const SEARCH_QUERY_MAX = 100;

// 브라우저가 만든 무작위 기기 ID (UUID v4). 같은 IP 뒤의 여러 사람을 구분하는 데 쓴다
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deviceIdOf(req) {
  const id = req.get('x-device-id');
  if (!id || !DEVICE_ID_RE.test(id)) throw new ApiError(400, 'device_required');
  return id.toLowerCase();
}

/** 제보·투표는 GPS 위치가 있는 사용자만, 대상 지점 반경 안에서만 할 수 있다 */
function requireGpsNear(body, target, { radiusM, maxAccuracyM }) {
  const gps = body?.gps;
  const lat = Number(gps?.lat);
  const lng = Number(gps?.lng);
  const accuracy = Number(gps?.accuracy);
  if (!gps || !isValidLatLng(lat, lng) || !Number.isFinite(accuracy)) throw new ApiError(403, 'gps_required');
  if (accuracy > maxAccuracyM) throw new ApiError(403, 'gps_inaccurate', { maxAccuracyM });
  if (distanceMeters(lat, lng, target.lat, target.lng) > radiusM) throw new ApiError(403, 'too_far', { radiusM });
}

export function createApiRouter({ config, kma, geocoder, shelters, reportStore, events }) {
  const router = express.Router();
  // 파싱 오류도 아래 오류 처리기에서 코드로 응답하도록 라우터 안에서 등록
  router.use(express.json({ limit: '16kb' }));
  const limiter = new RateLimiter({ limit: config.reportRateLimit, windowMs: config.reportRateWindowMin * 60 * 1000 });
  const searchLimiter = new RateLimiter({ limit: config.searchRateLimit, windowMs: 60 * 1000 });
  const ipActionLimiter = new RateLimiter({ limit: config.reportIpRateLimit, windowMs: config.reportRateWindowMin * 60 * 1000 });

  // minitunnel -H 터널은 실제 방문자 IP를 mt-connection-ip 헤더로 넘겨준다 (외부에서 위조 불가)
  const clientIp = (req) =>
    (config.trustTunnelHeader && req.get('mt-connection-ip')) || req.socket.remoteAddress || 'unknown';

  function takeOrThrow(limiter, key, res) {
    if (limiter.take(key)) return;
    const retryAfter = limiter.retryAfterSec(key);
    res.set('Retry-After', String(retryAfter));
    throw new ApiError(429, 'rate_limited', { retryAfterSec: retryAfter });
  }

  router.get('/config', (req, res) => {
    res.json({
      live: kma.live,
      hazards: HAZARD_CODES.filter((c) => HAZARDS[c].land),
      shelterTypes: SHELTER_TYPES,
      reportCategories: REPORT_CATEGORIES,
      reportDescriptionMax: REPORT_DESCRIPTION_MAX,
      reportDescriptionRequired: REPORT_CATEGORIES_REQUIRING_DESCRIPTION,
      reportPendingMinutes: config.reportPendingMinutes,
      reportConfirmThreshold: config.reportConfirmThreshold,
      reportResolveThreshold: config.reportResolveThreshold,
      reportConfirmedTtlHours: CONFIRMED_TTL_HOURS,
      reportRadiusM: config.reportRadiusM,
      reportGpsMaxAccuracyM: config.reportGpsMaxAccuracyM,
      riskRules: RISK_RULES,
    });
  });

  router.get('/provinces', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(loadProvinces());
  });

  // 전국 재난 상황: 시·도별 특보 + 최근 지진
  router.get('/overview', async (req, res) => {
    const [w, q] = await Promise.all([kma.getWarnings(), kma.getEarthquakes()]);
    res.json({
      warnings: {
        source: w.source,
        issuedAt: w.issuedAt,
        list: w.warnings,
        byProvince: warningsByProvince(w.warnings),
      },
      earthquakes: q,
    });
  });

  // 내 위치의 상황: 위험도 신호등 + 재난에 맞는 대피소
  router.get('/situation', async (req, res) => {
    const location = parseLatLng(req.query);
    const simulate = simulatedHazard(req.query.simulate);
    const province = findProvince(location.lat, location.lng);

    const [w, q, weather] = await Promise.all([
      kma.getWarnings(),
      kma.getEarthquakes(),
      isInKorea(location.lat, location.lng) ? kma.getWeather(location.lat, location.lng) : null,
    ]);

    let warnings = province ? warningsByProvince(w.warnings)[province] ?? [] : [];
    let earthquakes = q.earthquakes;
    // 시뮬레이션 중에는 실제 특보·지진 대신 가상 재난 하나만 적용
    if (simulate === 'earthquake') {
      warnings = [];
      // 내 위치가 진앙, 내 시·도 진도 Ⅳ (긴급재난문자 대상)
      earthquakes = [{
        lat: location.lat, lng: location.lng, magnitude: 5.0, intensity: 'Ⅳ', domestic: true, time: new Date().toISOString(),
      }];
    } else if (simulate) {
      warnings = [{ hazard: simulate, level: 'warning', partial: false }];
      earthquakes = [];
    }

    // 위험도는 공식 근거(특보·진도·강수강도)만으로 판단 — 시민 제보는 참고 정보로만 함께 보낸다
    const risk = assessRisk({
      province,
      warnings,
      earthquakes,
      weather: weather?.source === 'unavailable' ? null : weather,
    });
    const reports = reportStore.listActive();

    const matched = matchShelters(shelters, location, risk.hazards);
    res.json({
      location,
      province,
      simulated: simulate,
      sources: { warnings: w.source, earthquakes: q.source, weather: weather?.source ?? null },
      warnings,
      weather,
      risk,
      shelters: matched.shelters,
      shelterFallback: matched.fallback,
      nearbyReports: reports
        .map((r) => ({ ...r, distanceM: Math.round(distanceMeters(location.lat, location.lng, r.lat, r.lng)) }))
        .filter((r) => r.distanceM <= config.reportRadiusM)
        .sort((a, b) => a.distanceM - b.distanceM),
    });
  });

  router.get('/shelters', (req, res) => {
    const bbox = parseBbox(req.query.bbox);
    const types = req.query.types
      ? String(req.query.types).split(',').filter((t) => SHELTER_TYPES.includes(t))
      : null;
    res.json({ shelters: sheltersInBounds(shelters, bbox, types) });
  });

  // 장소 검색: OSM(Nominatim) 장소 + 이름이 일치하는 대피소
  router.get('/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length > SEARCH_QUERY_MAX) throw new ApiError(400, 'invalid_query', { max: SEARCH_QUERY_MAX });
    const lang = /^[a-z]{2}$/.test(String(req.query.lang)) ? String(req.query.lang) : 'ko';

    const ip = clientIp(req);
    if (!searchLimiter.take(ip)) {
      const retryAfter = searchLimiter.retryAfterSec(ip);
      res.set('Retry-After', String(retryAfter));
      throw new ApiError(429, 'rate_limited', { retryAfterSec: retryAfter });
    }

    let places = [];
    let placesError = null;
    try {
      places = await geocoder.search(q, lang);
    } catch (err) {
      if (!(err instanceof GeocoderError)) throw err;
      placesError = err.code; // 장소 검색이 안 돼도 대피소 결과는 돌려준다
    }
    res.json({ query: q, places, placesError, shelters: searchShelters(shelters, q) });
  });

  router.get('/reports', (req, res) => {
    res.json({ reports: reportStore.listActive() });
  });

  router.post('/reports', (req, res) => {
    const body = req.body ?? {};
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!isValidLatLng(lat, lng)) throw new ApiError(400, 'invalid_location');
    if (!isInKorea(lat, lng)) throw new ApiError(400, 'out_of_korea');
    if (!REPORT_CATEGORIES.includes(body.category)) throw new ApiError(400, 'invalid_category');
    // 줄바꿈은 그대로 저장 (윈도우 줄바꿈 \r\n 만 \n 으로 통일)
    const description = typeof body.description === 'string' ? body.description.replace(/\r\n?/g, '\n').trim() : '';
    if (description.length > REPORT_DESCRIPTION_MAX) {
      throw new ApiError(400, 'description_too_long', { max: REPORT_DESCRIPTION_MAX });
    }
    if (!description && REPORT_CATEGORIES_REQUIRING_DESCRIPTION.includes(body.category)) {
      throw new ApiError(400, 'description_required');
    }

    const device = deviceIdOf(req);
    requireGpsNear(body, { lat, lng }, { radiusM: config.reportRadiusM, maxAccuracyM: config.reportGpsMaxAccuracyM });

    // 도배 제한은 기기 단위 (터널 tcp 모드·공유 와이파이에서는 모두 같은 IP로 보이므로)
    // + 같은 IP 전체의 넉넉한 상한 (기기 ID를 바꿔 가며 피하는 것 방지)
    takeOrThrow(ipActionLimiter, clientIp(req), res);
    takeOrThrow(limiter, device, res);

    const report = reportStore.create({ lat, lng, category: body.category, description, reporter: device });
    events.broadcast('report:new', report);
    res.status(201).json({ report });
  });

  // 투표: confirm = '나도 봤어요'(확인 대기 제보만), resolve = '해결됐어요'(확인된 제보만)
  router.post('/reports/:id/vote', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new ApiError(404, 'not_found');
    const kind = req.body?.kind;
    if (!VOTE_KINDS.includes(kind)) throw new ApiError(400, 'invalid_vote');
    const device = deviceIdOf(req);

    const target = reportStore.getInternal(id);
    if (!target || target.expires_at <= Date.now()) throw new ApiError(404, 'not_found');
    const allowedStatus = kind === 'confirm' ? REPORT_STATUS.pending : REPORT_STATUS.confirmed;
    if (target.status !== allowedStatus) throw new ApiError(409, 'vote_not_allowed');
    // 내 제보를 내가 '확인'해 승격시킬 수는 없다 ('해결됐어요'는 제보자도 가능)
    if (kind === 'confirm' && target.reporter === device) throw new ApiError(403, 'own_report');
    requireGpsNear(req.body, target, { radiusM: config.reportRadiusM, maxAccuracyM: config.reportGpsMaxAccuracyM });
    takeOrThrow(ipActionLimiter, clientIp(req), res);

    const { report, removed, confirmed } = reportStore.vote(id, device, kind);
    events.broadcast(removed ? 'report:removed' : 'report:updated', removed ? { id } : report);
    res.json({ report, removed, confirmed });
  });

  router.get('/events', events.handler);

  router.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.code, ...err.extra });
      return;
    }
    // express.json() 파싱 오류
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    console.error('[api] unexpected error:', err);
    res.status(500).json({ error: 'internal' });
  });

  return router;
}
