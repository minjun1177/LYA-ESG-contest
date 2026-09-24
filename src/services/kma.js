// 기상청 공공데이터 API 연동 (공공데이터포털 인증키 사용)
//   - 기상특보 조회서비스  getPwnStatus  : 현재 발효 중인 특보 현황
//   - 지진정보 조회서비스  getEqkMsg     : 최근 지진 통보
//   - 단기예보 조회서비스  getUltraSrtNcst: 초단기실황(현재 날씨)
// 인증키가 없으면 data/samples 의 샘플 데이터를 사용(source: 'sample')한다.
// 인증키가 있는데 호출이 실패하면 샘플로 대체하지 않고 source: 'unavailable' 을 돌려준다
// (실제 재난 상황에서 가짜 데이터를 보여주지 않기 위해).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { toKmaGrid } from '../lib/geo.js';
import { parseWarningText } from '../lib/warnings.js';

const BASE = 'https://apis.data.go.kr/1360000';
const ENDPOINTS = {
  warnings: `${BASE}/WthrWrnInfoService/getPwnStatus`,
  earthquakes: `${BASE}/EqkInfoService/getEqkMsg`,
  weather: `${BASE}/VilageFcstInfoService_2.0/getUltraSrtNcst`,
};

const REQUEST_TIMEOUT_MS = 8000;

export class KmaApiError extends Error {}

/** 한국 표준시(KST) 기준 날짜·시각 구성요소 */
export function kstParts(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    ymd: `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`,
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
    pad,
  };
}

/** 초단기실황 발표 시각: 매시 정각 자료가 약 40분 뒤 제공되므로 45분 이전이면 한 시간 전 자료 */
export function ultraShortBaseTime(now = new Date()) {
  const ref = kstParts(now).minute < 45 ? new Date(now.getTime() - 3600 * 1000) : now;
  const { ymd, hour, pad } = kstParts(ref);
  return { baseDate: ymd, baseTime: `${pad(hour)}00` };
}

/** '20250101123456' 형태의 KST 시각 → ISO 문자열 */
export function kstStampToIso(stamp) {
  const s = String(stamp ?? '');
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+09:00`).toISOString();
}

function readSample(name) {
  // eslint-disable-next-line no-unused-vars
  const { _comment, ...data } = JSON.parse(readFileSync(path.join(ROOT_DIR, 'data', 'samples', name), 'utf8'));
  return data;
}

function asArray(items) {
  if (!items) return [];
  const item = items.item ?? items;
  return Array.isArray(item) ? item : [item];
}

export class KmaService {
  constructor({ serviceKey = '', cacheMinutes = 5, fetchImpl = globalThis.fetch } = {}) {
    this.serviceKey = serviceKey;
    this.cacheMs = cacheMinutes * 60 * 1000;
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  get live() {
    return Boolean(this.serviceKey);
  }

  // 공공데이터포털은 Encoding 키(이미 %인코딩됨)와 Decoding 키를 모두 발급한다
  #keyParam() {
    return this.serviceKey.includes('%') ? this.serviceKey : encodeURIComponent(this.serviceKey);
  }

  async #call(url, params) {
    const query = new URLSearchParams({ pageNo: '1', dataType: 'JSON', ...params }).toString();
    const res = await this.fetch(`${url}?serviceKey=${this.#keyParam()}&${query}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new KmaApiError(`HTTP ${res.status}`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // 인증 오류 등은 dataType과 무관하게 XML로 온다
      const reason = text.match(/<returnAuthMsg>([^<]*)</)?.[1] ?? text.slice(0, 120);
      throw new KmaApiError(`non-JSON response: ${reason}`);
    }
    const header = json?.response?.header;
    if (!header) throw new KmaApiError('unexpected response shape');
    // 03 = NODATA_ERROR (조회 결과 없음) 는 정상적인 '없음'
    if (header.resultCode === '03') return [];
    if (header.resultCode !== '00') throw new KmaApiError(`${header.resultCode} ${header.resultMsg}`);
    return asArray(json.response.body?.items);
  }

  async #cached(key, loader) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheMs) return hit.promise;
    const promise = loader().catch((err) => {
      this.cache.delete(key);
      throw err;
    });
    this.cache.set(key, { at: Date.now(), promise });
    return promise;
  }

  /** 현재 발효 중인 특보 */
  async getWarnings() {
    if (!this.live) {
      const sample = readSample('warnings.json');
      return { source: 'sample', issuedAt: sample.issuedAt, warnings: parseWarningText(sample.t6) };
    }
    try {
      return await this.#cached('warnings', async () => {
        const items = await this.#call(ENDPOINTS.warnings, { numOfRows: '10' });
        const latest = items[0];
        return {
          source: 'live',
          issuedAt: latest ? kstStampToIso(latest.tmFc) : null,
          warnings: latest ? parseWarningText(latest.t6) : [],
        };
      });
    } catch (err) {
      console.warn(`[kma] warnings unavailable: ${err.message}`);
      return { source: 'unavailable', issuedAt: null, warnings: [] };
    }
  }

  /** 최근(최대 3일) 한반도 주변 지진 */
  async getEarthquakes() {
    if (!this.live) {
      return { source: 'sample', earthquakes: readSample('earthquakes.json').earthquakes };
    }
    try {
      return await this.#cached('earthquakes', async () => {
        const now = new Date();
        const from = kstParts(new Date(now.getTime() - 2 * 24 * 3600 * 1000)).ymd;
        const items = await this.#call(ENDPOINTS.earthquakes, {
          numOfRows: '50',
          fromTmFc: from,
          toTmFc: kstParts(now).ymd,
        });
        const earthquakes = items
          .map((it) => ({
            time: kstStampToIso(it.tmEqk),
            lat: Number.parseFloat(it.lat),
            lng: Number.parseFloat(it.lon),
            magnitude: Number.parseFloat(it.mt),
            depthKm: Number.parseFloat(it.dep) || null,
            intensity: it.inT || '',
            location: it.loc || '',
          }))
          .filter((q) => q.time && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Number.isFinite(q.magnitude))
          // 한반도 주변만
          .filter((q) => q.lat >= 32 && q.lat <= 40 && q.lng >= 123 && q.lng <= 132);
        // 같은 지진이 여러 번 통보될 수 있어 발생시각·위치로 중복 제거
        const unique = new Map(earthquakes.map((q) => [`${q.time}|${q.lat}|${q.lng}`, q]));
        return { source: 'live', earthquakes: [...unique.values()] };
      });
    } catch (err) {
      console.warn(`[kma] earthquakes unavailable: ${err.message}`);
      return { source: 'unavailable', earthquakes: [] };
    }
  }

  /** 좌표의 현재 날씨(초단기실황) */
  async getWeather(lat, lng) {
    const { nx, ny } = toKmaGrid(lat, lng);
    if (!this.live) {
      return { source: 'sample', grid: { nx, ny }, ...readSample('weather.json') };
    }
    const { baseDate, baseTime } = ultraShortBaseTime();
    try {
      return await this.#cached(`weather:${nx},${ny},${baseDate}${baseTime}`, async () => {
        const items = await this.#call(ENDPOINTS.weather, {
          numOfRows: '20',
          base_date: baseDate,
          base_time: baseTime,
          nx: String(nx),
          ny: String(ny),
        });
        const value = (cat) => {
          const v = Number.parseFloat(items.find((it) => it.category === cat)?.obsrValue);
          return Number.isFinite(v) ? v : null;
        };
        return {
          source: 'live',
          grid: { nx, ny },
          observedAt: kstStampToIso(`${baseDate}${baseTime}`),
          temperature: value('T1H'),
          rain1h: value('RN1'),
          humidity: value('REH'),
          windSpeed: value('WSD'),
          // 강수형태 PTY: 0 없음, 1 비, 2 비/눈, 3 눈, 5 빗방울, 6 빗방울눈날림, 7 눈날림
          precipitationType: value('PTY'),
        };
      });
    } catch (err) {
      console.warn(`[kma] weather unavailable: ${err.message}`);
      return { source: 'unavailable', grid: { nx, ny } };
    }
  }
}
