import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { geometryContains } from './geo.js';

// 시·도 식별자 (언어 중립 코드). 화면 표시 이름은 public/locales/*.json 의 province.<id>
export const PROVINCE_IDS = [
  'seoul', 'busan', 'daegu', 'incheon', 'gwangju', 'daejeon', 'ulsan', 'sejong', 'gyeonggi',
  'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju',
];

// 통계청 경계 데이터(2013)의 시·도 코드 → 식별자
const KOSTAT_CODE_TO_ID = {
  11: 'seoul', 21: 'busan', 22: 'daegu', 23: 'incheon', 24: 'gwangju', 25: 'daejeon', 26: 'ulsan',
  29: 'sejong', 31: 'gyeonggi', 32: 'gangwon', 33: 'chungbuk', 34: 'chungnam', 35: 'jeonbuk',
  36: 'jeonnam', 37: 'gyeongbuk', 38: 'gyeongnam', 39: 'jeju',
};

// 기상청 특보문에 나오는 한글 지명 표기 → 식별자 (원본 데이터 해석용, 화면 문구 아님)
// 긴 표기부터 비교해야 '경상북도'가 '경북'보다 먼저 매칭된다
const KMA_REGION_ALIASES = [
  ['서울특별시', 'seoul'], ['서울', 'seoul'],
  ['부산광역시', 'busan'], ['부산', 'busan'],
  ['대구광역시', 'daegu'], ['대구', 'daegu'],
  ['인천광역시', 'incheon'], ['서해5도', 'incheon'], ['인천', 'incheon'],
  ['광주광역시', 'gwangju'], ['광주', 'gwangju'],
  ['대전광역시', 'daejeon'], ['대전', 'daejeon'],
  ['울산광역시', 'ulsan'], ['울산', 'ulsan'],
  ['세종특별자치시', 'sejong'], ['세종', 'sejong'],
  ['경기도', 'gyeonggi'], ['경기', 'gyeonggi'],
  ['강원특별자치도', 'gangwon'], ['강원도', 'gangwon'], ['강원', 'gangwon'],
  ['충청북도', 'chungbuk'], ['충북', 'chungbuk'],
  ['충청남도', 'chungnam'], ['충남', 'chungnam'],
  ['전북특별자치도', 'jeonbuk'], ['전라북도', 'jeonbuk'], ['전북', 'jeonbuk'],
  ['전라남도', 'jeonnam'], ['전남', 'jeonnam'],
  ['경상북도', 'gyeongbuk'], ['울릉도.독도', 'gyeongbuk'], ['울릉도', 'gyeongbuk'], ['독도', 'gyeongbuk'], ['경북', 'gyeongbuk'],
  ['경상남도', 'gyeongnam'], ['경남', 'gyeongnam'],
  ['제주특별자치도', 'jeju'], ['제주도', 'jeju'], ['제주', 'jeju'],
].sort((a, b) => b[0].length - a[0].length);

/** 특보문 지명을 시·도 식별자로 변환. 해상 구역(…바다) 등은 null */
export function provinceFromKmaName(name) {
  if (!name) return null;
  const clean = String(name).replace(/\s+/g, '');
  if (/바다$/.test(clean)) return null;
  const hit = KMA_REGION_ALIASES.find(([alias]) => clean.startsWith(alias));
  return hit ? hit[1] : null;
}

let cached = null;

/** 시·도 경계 GeoJSON. properties.id 에 식별자를 채워 반환 */
export function loadProvinces(file = path.join(ROOT_DIR, 'data', 'provinces.geojson')) {
  if (cached && cached.file === file) return cached.data;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.features = raw.features.map((f) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: { id: KOSTAT_CODE_TO_ID[f.properties.code] ?? null },
  }));
  cached = { file, data: raw };
  return raw;
}

/** 좌표가 속한 시·도 식별자 (바다 위 등 경계 밖이면 null) */
export function findProvince(lat, lng, geojson = loadProvinces()) {
  const hit = geojson.features.find((f) => geometryContains(f.geometry, lat, lng));
  return hit ? hit.properties.id : null;
}
