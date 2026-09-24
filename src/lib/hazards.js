// 재난 종류 정의 (언어 중립 코드). 화면 표시 이름·행동요령은 public/locales/*.json 의 hazard.<code>
//
// shelterTypes: 해당 재난 때 추천하는 대피소 종류 (앞쪽일수록 우선)
// excludeUnderground: 지하 시설 제외 여부 (침수·붕괴 위험)
// land: 육상 위험인지 (false = 해상 특보, 사용자 위험도 판단에서 제외)

export const SHELTER_TYPES = [
  'temporary_housing', // 이재민 임시주거시설 (학교 체육관·마을회관 등 지상 실내)
  'earthquake_indoor', // 지진겸용 임시주거시설
  'earthquake_outdoor', // 지진 옥외대피장소 (운동장·공원)
  'civil_defense', // 민방위 대피시설 (대부분 지하)
  'heat', // 무더위쉼터
  'cold', // 한파쉼터
];

export const HAZARDS = {
  heavy_rain: { shelterTypes: ['temporary_housing', 'earthquake_indoor'], excludeUnderground: true, land: true },
  typhoon: { shelterTypes: ['temporary_housing', 'earthquake_indoor'], excludeUnderground: true, land: true },
  storm_surge: { shelterTypes: ['temporary_housing', 'earthquake_indoor'], excludeUnderground: true, land: true },
  tsunami: { shelterTypes: ['temporary_housing', 'earthquake_indoor'], excludeUnderground: true, land: true },
  strong_wind: { shelterTypes: ['temporary_housing', 'earthquake_indoor', 'civil_defense'], excludeUnderground: false, land: true },
  heavy_snow: { shelterTypes: ['cold', 'temporary_housing'], excludeUnderground: false, land: true },
  cold_wave: { shelterTypes: ['cold', 'temporary_housing'], excludeUnderground: false, land: true },
  heat_wave: { shelterTypes: ['heat'], excludeUnderground: false, land: true },
  earthquake: { shelterTypes: ['earthquake_outdoor', 'earthquake_indoor'], excludeUnderground: true, land: true },
  dry: { shelterTypes: [], excludeUnderground: false, land: true },
  yellow_dust: { shelterTypes: [], excludeUnderground: false, land: true },
  high_seas: { shelterTypes: [], excludeUnderground: false, land: false },
};

export const HAZARD_CODES = Object.keys(HAZARDS);

// 특보 등급: warning(경보) > advisory(주의보)
export const LEVELS = ['advisory', 'warning'];
export const LEVEL_RANK = { advisory: 1, warning: 2 };

// 기상청 특보명(한글) → 코드 (원본 데이터 해석용, 화면 문구 아님)
const KMA_HAZARD_NAMES = {
  호우: 'heavy_rain', 태풍: 'typhoon', 폭풍해일: 'storm_surge', 해일: 'storm_surge', 지진해일: 'tsunami',
  강풍: 'strong_wind', 대설: 'heavy_snow', 한파: 'cold_wave', 폭염: 'heat_wave', 건조: 'dry',
  황사: 'yellow_dust', 풍랑: 'high_seas',
};
const KMA_LEVEL_NAMES = { 주의보: 'advisory', 경보: 'warning' };

/** '호우경보' → { hazard: 'heavy_rain', level: 'warning' } (모르는 특보명이면 null) */
export function parseKmaWarningName(name) {
  const clean = String(name).replace(/\s+/g, '');
  const m = clean.match(/^(.+?)(주의보|경보)$/);
  if (!m || !KMA_HAZARD_NAMES[m[1]]) return null;
  return { hazard: KMA_HAZARD_NAMES[m[1]], level: KMA_LEVEL_NAMES[m[2]] };
}
