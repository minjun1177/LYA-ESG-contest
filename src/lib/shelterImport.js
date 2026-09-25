// 공공데이터 대피소 CSV → 앱 표준 형식 변환 (scripts/import-shelters.js, scripts/fetch-shelters.js 공용)

import { isInKorea } from './geo.js';

// 공공데이터 CSV에서 자주 보이는 열 이름 후보 (앞쪽 우선)
export const COLUMN_CANDIDATES = {
  name: ['시설명', '쉼터명', '쉼터명칭', '대피소명', '수용시설명', '대피장소명', '장소명', '명칭', 'name'],
  lat: ['위도', '위도(EPSG4326)', '위도(WGS84)', 'lat', 'latitude', 'LAT', 'y좌표(위도)'],
  lng: ['경도', '경도(EPSG4326)', '경도(WGS84)', 'lng', 'lon', 'longitude', 'LOT', 'x좌표(경도)'],
  address: ['도로명전체주소', '도로명주소', '소재지도로명주소', '소재지주소', '상세주소', '주소', '소재지지번주소', '지번주소', 'address'],
  capacity: ['최대수용인원', '수용인원', '이용가능인원', '수용가능인원', '대피가능인원', 'capacity'],
};

export function findColumn(headers, candidates) {
  const normalized = headers.map((h) => h.replace(/\s+/g, ''));
  for (const c of candidates) {
    const i = normalized.indexOf(c.replace(/\s+/g, ''));
    if (i >= 0) return headers[i];
  }
  // 부분 일치 (예: '이용가능인원수', '수용가능인원(명)')
  for (const c of candidates) {
    const i = normalized.findIndex((h) => h.includes(c));
    if (i >= 0) return headers[i];
  }
  return null;
}

/**
 * @param {Array<object>} rows parseCsvObjects 결과
 * @param {{ type: string, underground?: 'auto'|'yes'|'no' }} options
 * @returns {{ shelters: Array<object>, skipped: number, swapped: number, columns: object }}
 */
export function convertShelterRows(rows, { type, underground = 'auto' }) {
  if (rows.length === 0) throw new Error('the CSV has no data rows');
  const headers = Object.keys(rows[0]);
  const columns = Object.fromEntries(Object.entries(COLUMN_CANDIDATES).map(([k, c]) => [k, findColumn(headers, c)]));
  columns.underground = underground === 'auto' ? headers.find((h) => h.includes('지하')) ?? null : underground;
  for (const required of ['name', 'lat', 'lng']) {
    if (!columns[required]) {
      throw new Error(`could not find a "${required}" column (coordinates are required). headers: ${headers.join(', ')}`);
    }
  }

  const shelters = [];
  let skipped = 0;
  let swapped = 0;
  for (const row of rows) {
    let lat = Number.parseFloat(row[columns.lat]);
    let lng = Number.parseFloat(row[columns.lng]);
    // 위도·경도 열이 뒤바뀐 데이터가 실제로 있다 (예: 위도=127.37, 경도=36.30)
    if (!isInKorea(lat, lng) && isInKorea(lng, lat)) {
      [lat, lng] = [lng, lat];
      swapped += 1;
    }
    if (!row[columns.name] || !isInKorea(lat, lng)) {
      skipped += 1;
      continue;
    }
    let isUnderground = underground === 'yes';
    if (underground === 'auto' && columns.underground) isUnderground = /지하/.test(row[columns.underground]);
    shelters.push({
      name: row[columns.name],
      type,
      lat,
      lng,
      address: columns.address ? row[columns.address] : '',
      capacity: columns.capacity ? String(row[columns.capacity]).replace(/[^\d]/g, '') : '',
      underground: isUnderground ? 1 : 0,
      sample: 0,
    });
  }
  return { shelters, skipped, swapped, columns };
}
