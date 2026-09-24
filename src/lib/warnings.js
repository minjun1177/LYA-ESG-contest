// 기상청 특보현황(getPwnStatus)의 발효현황 텍스트(t6)를 구조화된 데이터로 변환
//
// 입력 예)  o 호우경보 : 서울, 경기도(고양, 파주)
//           o 풍랑주의보 : 동해중부먼바다
// 출력 예)  [{ hazard: 'heavy_rain', level: 'warning',
//             areas: [{ province: 'seoul', partial: false, detail: '' },
//                     { province: 'gyeonggi', partial: true, detail: '고양, 파주' }],
//             seaAreas: [] }]

import { parseKmaWarningName, LEVEL_RANK, HAZARDS } from './hazards.js';
import { provinceFromKmaName } from './provinces.js';

/** 괄호 깊이를 고려해 최상위 쉼표로만 분리 */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseArea(token) {
  const m = token.match(/^([^(]+)(?:\((.*)\))?$/);
  const name = (m ? m[1] : token).trim();
  const detail = m && m[2] ? m[2].trim() : '';
  return { name, detail };
}

export function parseWarningText(text) {
  if (!text) return [];
  const result = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    // 글머리 기호(o, ㅇ, ○, -) 제거
    const line = rawLine.replace(/^\s*(?:o|ㅇ|○|●|-)\s*/, '').trim();
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const kind = parseKmaWarningName(line.slice(0, sep));
    if (!kind) continue;

    const areas = new Map();
    const seaAreas = [];
    for (const token of splitTopLevel(line.slice(sep + 1))) {
      const { name, detail } = parseArea(token);
      const province = provinceFromKmaName(name);
      if (!province) {
        seaAreas.push(name);
        continue;
      }
      // 시·도 이름 자체가 아닌 권역명(예: 울릉도.독도)이거나 괄호 세부지역이 있으면 일부 지역 발효
      const partial = Boolean(detail) || province === 'gyeongbuk' && /울릉|독도/.test(name);
      const prev = areas.get(province);
      if (prev) {
        prev.partial = prev.partial && partial;
        prev.detail = [prev.detail, detail || name].filter(Boolean).join(', ');
      } else {
        areas.set(province, { province, partial, detail: detail || (partial ? name : '') });
      }
    }
    result.push({ ...kind, areas: [...areas.values()], seaAreas });
  }
  return result;
}

/**
 * 특보 목록 → 시·도별 발효 특보
 * { seoul: [{ hazard, level, partial }], ... } (등급 높은 순)
 */
export function warningsByProvince(warnings) {
  const map = {};
  for (const w of warnings) {
    if (!HAZARDS[w.hazard]?.land) continue;
    for (const area of w.areas) {
      (map[area.province] ??= []).push({ hazard: w.hazard, level: w.level, partial: area.partial, detail: area.detail });
    }
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  }
  return map;
}
