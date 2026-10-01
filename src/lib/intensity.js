// 기상청 지진정보의 진도 문자열 해석
//   예) "최대진도 Ⅳ(충남), Ⅲ(대전,세종)" → { max: 4, byProvince: { chungnam: 4, daejeon: 3, sejong: 3 } }
//       "최대진도Ⅰ" / "III" → { max: 1|3, byProvince: {} }
// 기상청 지진정보 API는 최근 3일만 조회돼 지역별 표기 실례를 확보하지 못했으므로,
// 괄호 안 지역명이 있으면 읽고, 없으면 최대 진도만 쓴다.

import { provinceFromKmaName } from './provinces.js';

const UNICODE_ROMAN = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, 'Ⅵ': 6, 'Ⅶ': 7, 'Ⅷ': 8, 'Ⅸ': 9, 'Ⅹ': 10, 'Ⅺ': 11, 'Ⅻ': 12 };
const ASCII_ROMAN = { I: 1, V: 5, X: 10 };

function romanToInt(token) {
  if (token.length === 1 && UNICODE_ROMAN[token]) return UNICODE_ROMAN[token];
  let total = 0;
  for (let i = 0; i < token.length; i += 1) {
    const cur = ASCII_ROMAN[token[i]];
    const next = ASCII_ROMAN[token[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total >= 1 && total <= 12 ? total : null;
}

export function parseIntensity(text) {
  const result = { max: null, byProvince: {} };
  if (!text) return result;
  const re = /([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]|\b[IVX]{1,4}\b)\s*(?:\(([^)]*)\))?/g;
  for (const m of String(text).matchAll(re)) {
    const level = romanToInt(m[1]);
    if (!level) continue;
    result.max = Math.max(result.max ?? 0, level);
    for (const name of (m[2] ?? '').split(/[,·、]/)) {
      const province = provinceFromKmaName(name.trim());
      if (province) result.byProvince[province] = Math.max(result.byProvince[province] ?? 0, level);
    }
  }
  return result;
}
