// 사용자 위치의 위험도(신호등) 판단
//
// 결과: { level: 'danger' | 'caution' | 'safe', hazards: [...], reasons: [{ code, params }] }
// reasons.code 는 화면에서 public/locales/*.json 의 risk.reason.<code> 로 번역된다.

import { distanceMeters } from './geo.js';
import { HAZARDS, LEVEL_RANK } from './hazards.js';

export const RISK_RULES = {
  quakeMinMagnitude: 4.0, // 이 규모 이상 지진이
  quakeRadiusM: 100000, // 이 반경 안에서
  quakeWithinHours: 24, // 이 시간 안에 발생하면 위험
  reportRadiusM: 1000, // 이 반경 안의 시민 제보를 주의 요인으로 봄
  heavyRainMmPerHour: 30, // 1시간 강수량(mm) 이상이면 주의
  hotC: 33, // 기온 이상이면 주의
  coldC: -12, // 기온 이하이면 주의
};

const LEVEL_ORDER = { safe: 0, caution: 1, danger: 2 };
const raise = (current, next) => (LEVEL_ORDER[next] > LEVEL_ORDER[current] ? next : current);

/**
 * @param {object} input
 * @param {{lat:number,lng:number}} input.location
 * @param {Array<{hazard,level,partial}>} input.warnings  사용자 시·도에 발효된 특보
 * @param {Array<{lat,lng,magnitude,time}>} input.earthquakes
 * @param {Array<{lat,lng,category}>} input.reports
 * @param {{temperature?:number, rain1h?:number}|null} input.weather
 * @param {Date} [input.now]
 */
export function assessRisk({ location, warnings = [], earthquakes = [], reports = [], weather = null, now = new Date() }) {
  let level = 'safe';
  const reasons = [];
  const hazards = []; // 대피소 매칭에 쓰는 재난 코드 (중요한 순)

  const landWarnings = warnings
    .filter((w) => HAZARDS[w.hazard]?.land)
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  for (const w of landWarnings) {
    level = raise(level, w.level === 'warning' ? 'danger' : 'caution');
    reasons.push({ code: 'warning', params: { hazard: w.hazard, level: w.level, partial: Boolean(w.partial) } });
    if (!hazards.includes(w.hazard)) hazards.push(w.hazard);
  }

  const since = now.getTime() - RISK_RULES.quakeWithinHours * 3600 * 1000;
  for (const q of earthquakes) {
    if (q.magnitude < RISK_RULES.quakeMinMagnitude || new Date(q.time).getTime() < since) continue;
    const d = distanceMeters(location.lat, location.lng, q.lat, q.lng);
    if (d > RISK_RULES.quakeRadiusM) continue;
    level = raise(level, 'danger');
    reasons.push({ code: 'earthquake', params: { magnitude: q.magnitude, distanceKm: Math.round(d / 1000) } });
    if (!hazards.includes('earthquake')) hazards.unshift('earthquake');
  }

  const nearby = reports.filter(
    (r) => distanceMeters(location.lat, location.lng, r.lat, r.lng) <= RISK_RULES.reportRadiusM,
  );
  if (nearby.length > 0) {
    level = raise(level, 'caution');
    reasons.push({ code: 'reports', params: { count: nearby.length, radiusM: RISK_RULES.reportRadiusM } });
  }

  if (weather) {
    if (weather.rain1h >= RISK_RULES.heavyRainMmPerHour) {
      level = raise(level, 'caution');
      reasons.push({ code: 'heavyRainNow', params: { mm: weather.rain1h } });
    }
    if (weather.temperature >= RISK_RULES.hotC) {
      level = raise(level, 'caution');
      reasons.push({ code: 'hot', params: { c: weather.temperature } });
    }
    if (weather.temperature <= RISK_RULES.coldC) {
      level = raise(level, 'caution');
      reasons.push({ code: 'cold', params: { c: weather.temperature } });
    }
  }

  if (reasons.length === 0) reasons.push({ code: 'none', params: {} });
  return { level, hazards, reasons };
}
