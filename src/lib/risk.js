// 사용자 위치의 위험도(신호등) 판단 — 공식 근거만 사용
//
// 결과: { level: 'danger' | 'caution' | 'safe', hazards: [...], reasons: [{ code, basis, params }] }
// reasons.code  는 화면에서 risk.reason.<code>  로,
// reasons.basis 는 화면에서 risk.basis.<basis> 로 번역된다 (판단 근거의 출처 표시).
//
// 근거
//   kma_warning   기상청 기상특보 — 경보는 위험, 주의보는 주의
//   quake_alert   지진재난문자 발송 기준 — 내 시·도 진도 Ⅲ 이상(긴급재난문자) 위험, 진도 Ⅱ(안전안내문자) 주의
//   kma_rain_term 기상청 예보용어 '매우 강한 비' — 시간당 30mm 이상이면 주의
// 시민 제보는 공식 근거가 아니어서 위험도에 반영하지 않는다.

import { HAZARDS, LEVEL_RANK } from './hazards.js';
import { parseIntensity } from './intensity.js';
import { findProvince } from './provinces.js';

export const RISK_RULES = {
  quakeDangerIntensity: 3, // 진도 Ⅲ 이상 지역: 긴급재난문자 대상
  quakeCautionIntensity: 2, // 진도 Ⅱ 지역: 안전안내문자 대상
  quakeWithinHours: 24, // 앱 기준: 지진 발생 후 이 시간 동안 위험도에 반영
  veryHeavyRainMmPerHour: 30, // 기상청 예보용어 '매우 강한 비'
};

const LEVEL_ORDER = { safe: 0, caution: 1, danger: 2 };
const raise = (current, next) => (LEVEL_ORDER[next] > LEVEL_ORDER[current] ? next : current);

/** 지진 하나가 내 시·도에 준 진도 (지역별 진도가 없으면 진앙이 있는 시·도에만 최대 진도 적용) */
export function intensityAtProvince(quake, province, provinceOf = findProvince) {
  if (!province) return null;
  const { max, byProvince } = parseIntensity(quake.intensity);
  if (byProvince[province]) return byProvince[province];
  if (Object.keys(byProvince).length > 0) return null;
  return max && provinceOf(quake.lat, quake.lng) === province ? max : null;
}

/**
 * @param {object} input
 * @param {string|null} input.province   사용자 위치의 시·도 식별자
 * @param {Array<{hazard,level,partial}>} input.warnings  사용자 시·도에 발효된 특보
 * @param {Array<{lat,lng,magnitude,intensity,time,domestic}>} input.earthquakes
 * @param {{rain1h?:number}|null} input.weather
 * @param {Date} [input.now]
 */
export function assessRisk({ province = null, warnings = [], earthquakes = [], weather = null, now = new Date(), provinceOf = findProvince }) {
  let level = 'safe';
  const reasons = [];
  const hazards = []; // 대피소 매칭에 쓰는 재난 코드 (중요한 순)

  const landWarnings = warnings
    .filter((w) => HAZARDS[w.hazard]?.land)
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  for (const w of landWarnings) {
    level = raise(level, w.level === 'warning' ? 'danger' : 'caution');
    reasons.push({ code: 'warning', basis: 'kma_warning', params: { hazard: w.hazard, level: w.level, partial: Boolean(w.partial) } });
    if (!hazards.includes(w.hazard)) hazards.push(w.hazard);
  }

  const since = now.getTime() - RISK_RULES.quakeWithinHours * 3600 * 1000;
  for (const q of earthquakes) {
    if (q.domestic === false || new Date(q.time).getTime() < since) continue;
    const intensity = intensityAtProvince(q, province, provinceOf);
    if (!intensity || intensity < RISK_RULES.quakeCautionIntensity) continue;
    const quakeLevel = intensity >= RISK_RULES.quakeDangerIntensity ? 'danger' : 'caution';
    level = raise(level, quakeLevel);
    reasons.push({ code: 'earthquake', basis: 'quake_alert', params: { magnitude: q.magnitude, intensity } });
    if (!hazards.includes('earthquake')) hazards.unshift('earthquake');
  }

  if (weather && weather.rain1h >= RISK_RULES.veryHeavyRainMmPerHour) {
    level = raise(level, 'caution');
    reasons.push({ code: 'veryHeavyRain', basis: 'kma_rain_term', params: { mm: weather.rain1h } });
  }

  if (reasons.length === 0) reasons.push({ code: 'none', basis: null, params: {} });
  return { level, hazards, reasons };
}
