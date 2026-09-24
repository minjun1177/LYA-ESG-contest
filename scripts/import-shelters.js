#!/usr/bin/env node
// 공공데이터포털에서 내려받은 대피소 CSV를 앱의 표준 형식(data/shelters/*.csv)으로 변환
//
// 사용법:
//   node scripts/import-shelters.js --type heat 무더위쉼터.csv
//   node scripts/import-shelters.js --type civil_defense --underground auto 민방위대피시설.csv --out data/shelters/civil.csv
//
// --type        temporary_housing | earthquake_indoor | earthquake_outdoor | civil_defense | heat | cold
// --underground auto(기본: '지하' 표기가 있는 열로 판단) | yes | no
// --out         출력 경로 (기본: data/shelters/<type>.csv)
//
// 열 이름은 데이터셋마다 달라서 흔히 쓰이는 이름 후보로 자동 매칭한다.
// 좌표가 위경도(WGS84)가 아닌 데이터(예: EPSG:5174 X/Y)는 지원하지 않으며 해당 행은 건너뛴다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT_DIR } from '../src/config.js';
import { decodeText, parseCsvObjects, toCsv } from '../src/lib/csv.js';
import { isInKorea } from '../src/lib/geo.js';
import { SHELTER_TYPES } from '../src/lib/hazards.js';
import { SHELTER_CSV_HEADER } from '../src/lib/shelters.js';

// 공공데이터 CSV에서 자주 보이는 열 이름 후보 (앞쪽 우선)
const COLUMN_CANDIDATES = {
  name: ['시설명', '쉼터명', '대피소명', '수용시설명', '대피장소명', '장소명', '명칭', 'name'],
  lat: ['위도', '위도(EPSG4326)', '위도(WGS84)', 'lat', 'latitude', 'LAT', 'y좌표(위도)'],
  lng: ['경도', '경도(EPSG4326)', '경도(WGS84)', 'lng', 'lon', 'longitude', 'LOT', 'x좌표(경도)'],
  address: ['도로명전체주소', '도로명주소', '소재지도로명주소', '상세주소', '주소', '소재지지번주소', '지번주소', 'address'],
  capacity: ['최대수용인원', '수용인원', '이용가능인원', '수용가능인원', '대피가능인원', 'capacity'],
};

function findColumn(headers, candidates) {
  const normalized = headers.map((h) => h.replace(/\s+/g, ''));
  for (const c of candidates) {
    const i = normalized.indexOf(c.replace(/\s+/g, ''));
    if (i >= 0) return headers[i];
  }
  // 부분 일치 (예: '위도(도)')
  for (const c of candidates) {
    const i = normalized.findIndex((h) => h.includes(c));
    if (i >= 0) return headers[i];
  }
  return null;
}

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error('usage: node scripts/import-shelters.js --type <type> [--underground auto|yes|no] [--out FILE] INPUT.csv');
  console.error(`types: ${SHELTER_TYPES.join(', ')}`);
  process.exit(1);
}

function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        type: { type: 'string' },
        underground: { type: 'string', default: 'auto' },
        out: { type: 'string' },
      },
    });
  } catch (err) {
    usage(err.message);
  }
  const { values, positionals } = args;
  if (positionals.length !== 1) usage('exactly one input CSV is required');
  if (!SHELTER_TYPES.includes(values.type)) usage(`unknown --type "${values.type ?? ''}"`);
  if (!['auto', 'yes', 'no'].includes(values.underground)) usage('--underground must be auto, yes or no');

  let text;
  try {
    text = decodeText(readFileSync(positionals[0]));
  } catch (err) {
    usage(`cannot read ${positionals[0]}: ${err.message}`);
  }
  const rows = parseCsvObjects(text);
  if (rows.length === 0) usage('the CSV has no data rows');

  const headers = Object.keys(rows[0]);
  const cols = Object.fromEntries(Object.entries(COLUMN_CANDIDATES).map(([k, c]) => [k, findColumn(headers, c)]));
  const undergroundCol = headers.find((h) => h.includes('지하')) ?? null;
  for (const required of ['name', 'lat', 'lng']) {
    if (!cols[required]) usage(`could not find a "${required}" column. headers: ${headers.join(', ')}`);
  }
  console.log('column mapping:', { ...cols, underground: values.underground === 'auto' ? undergroundCol : values.underground });

  const out = [];
  let skipped = 0;
  for (const row of rows) {
    const lat = Number.parseFloat(row[cols.lat]);
    const lng = Number.parseFloat(row[cols.lng]);
    if (!row[cols.name] || !isInKorea(lat, lng)) {
      skipped += 1;
      continue;
    }
    let underground = values.underground === 'yes';
    if (values.underground === 'auto' && undergroundCol) underground = /지하/.test(row[undergroundCol]);
    out.push({
      name: row[cols.name],
      type: values.type,
      lat,
      lng,
      address: cols.address ? row[cols.address] : '',
      capacity: cols.capacity ? String(row[cols.capacity]).replace(/[^\d]/g, '') : '',
      underground: underground ? 1 : 0,
      sample: 0,
    });
  }

  const outFile = values.out ?? path.join(ROOT_DIR, 'data', 'shelters', `${values.type}.csv`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, toCsv(SHELTER_CSV_HEADER, out));
  console.log(`wrote ${out.length} shelters to ${outFile}${skipped ? ` (skipped ${skipped} rows without a name or WGS84 coordinates)` : ''}`);
  console.log('restart the server to load the new file.');
}

main();
