import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeText, parseCsvObjects } from './csv.js';
import { distanceMeters, isInKorea } from './geo.js';
import { HAZARDS, SHELTER_TYPES } from './hazards.js';

// data/shelters/*.csv 표준 형식 (scripts/import-shelters.js 가 공공데이터 CSV를 이 형식으로 변환)
export const SHELTER_CSV_HEADER = ['name', 'type', 'lat', 'lng', 'address', 'capacity', 'underground', 'sample'];

const truthy = (v) => ['1', 'y', 'yes', 'true'].includes(String(v).trim().toLowerCase());

export function normalizeShelter(row, index, source) {
  const lat = Number.parseFloat(row.lat);
  const lng = Number.parseFloat(row.lng);
  if (!row.name || !SHELTER_TYPES.includes(row.type) || !isInKorea(lat, lng)) return null;
  const capacity = Number.parseInt(row.capacity, 10);
  return {
    id: `${source}:${index}`,
    name: row.name,
    type: row.type,
    lat,
    lng,
    address: row.address || '',
    capacity: Number.isFinite(capacity) ? capacity : null,
    underground: truthy(row.underground),
    sample: truthy(row.sample),
  };
}

/** 폴더 안의 모든 표준 CSV를 읽어 대피소 목록 반환 */
export function loadShelters(dir) {
  const shelters = [];
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
  } catch (err) {
    console.warn(`[shelters] cannot read shelter directory ${dir}: ${err.message}`);
    return shelters;
  }
  for (const file of files) {
    const source = path.basename(file, '.csv');
    try {
      const rows = parseCsvObjects(decodeText(readFileSync(path.join(dir, file))));
      let skipped = 0;
      rows.forEach((row, i) => {
        const s = normalizeShelter(row, i, source);
        if (s) shelters.push(s);
        else skipped += 1;
      });
      console.log(`[shelters] ${file}: loaded ${rows.length - skipped}${skipped ? `, skipped ${skipped} invalid rows` : ''}`);
    } catch (err) {
      console.warn(`[shelters] failed to read ${file}: ${err.message}`);
    }
  }
  return shelters;
}

/**
 * 현재 재난에 맞는 대피소만 골라 가까운 순으로 반환
 * @param {Array} shelters 전체 대피소
 * @param {{lat:number,lng:number}} origin 사용자 위치
 * @param {string[]} hazardCodes 현재 사용자 위치에 발효 중인 재난 코드 (중요한 순)
 */
export function matchShelters(shelters, origin, hazardCodes = [], { limit = 5, maxDistanceM = 20000 } = {}) {
  // 대피소 정책이 있는 재난을 중요한 순서대로 시도하고, 맞는 대피소가 있는 첫 정책을 사용
  const policies = hazardCodes.map((c) => HAZARDS[c]).filter((p) => p && p.shelterTypes.length > 0);
  for (const policy of policies) {
    const found = nearest(shelters, origin, policy.shelterTypes, policy.excludeUnderground, limit, maxDistanceM);
    if (found.length > 0) return found;
  }
  // 발효 중인 재난이 없거나 맞는 대피소가 없으면 종류 무관 가장 가까운 곳
  return nearest(shelters, origin, SHELTER_TYPES, policies.some((p) => p.excludeUnderground), limit, maxDistanceM);
}

function nearest(shelters, origin, allowed, excludeUnderground, limit, maxDistanceM) {
  return shelters
    .filter((s) => allowed.includes(s.type) && !(excludeUnderground && s.underground))
    .map((s) => ({ ...s, distanceM: Math.round(distanceMeters(origin.lat, origin.lng, s.lat, s.lng)) }))
    .filter((s) => s.distanceM <= maxDistanceM)
    // 거리 우선, 거리가 비슷하면(200m 이내) 정책상 우선순위가 높은 종류 먼저
    .sort((a, b) => {
      if (Math.abs(a.distanceM - b.distanceM) > 200) return a.distanceM - b.distanceM;
      return allowed.indexOf(a.type) - allowed.indexOf(b.type) || a.distanceM - b.distanceM;
    })
    .slice(0, limit);
}

/** 지도 화면 범위(bbox) 안의 대피소 */
export function sheltersInBounds(shelters, { minLat, minLng, maxLat, maxLng }, types, limit = 500) {
  return shelters
    .filter((s) => s.lat >= minLat && s.lat <= maxLat && s.lng >= minLng && s.lng <= maxLng)
    .filter((s) => !types || types.includes(s.type))
    .slice(0, limit);
}
