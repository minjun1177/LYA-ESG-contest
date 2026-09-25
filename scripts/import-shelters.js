#!/usr/bin/env node
// 공공데이터 대피소 CSV를 앱의 표준 형식(data/shelters/*.csv)으로 변환
//
// 사용법:
//   node scripts/import-shelters.js --type heat 무더위쉼터.csv
//   node scripts/import-shelters.js --type heat --datago 15116079          # 공공데이터포털 파일데이터 번호로 바로 받기
//   node scripts/import-shelters.js --type civil_defense --underground auto 민방위대피시설.csv --out data/shelters/civil.csv
//
// --type        temporary_housing | earthquake_indoor | earthquake_outdoor | civil_defense | heat | cold
// --datago      data.go.kr 파일데이터 번호 (입력 파일 대신)
// --underground auto(기본: '지하' 표기가 있는 열로 판단) | yes | no
// --out         출력 경로 (기본: data/shelters/<type>.csv)
//
// 열 이름은 데이터셋마다 달라서 흔히 쓰이는 이름 후보로 자동 매칭한다.
// 위도·경도가 뒤바뀐 행은 자동으로 바로잡고, 위경도(WGS84)가 없는 행은 건너뛴다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT_DIR } from '../src/config.js';
import { decodeText, parseCsvObjects, toCsv } from '../src/lib/csv.js';
import { SHELTER_TYPES } from '../src/lib/hazards.js';
import { convertShelterRows } from '../src/lib/shelterImport.js';
import { SHELTER_CSV_HEADER } from '../src/lib/shelters.js';
import { downloadDataGoFile } from '../src/services/dataGoFile.js';

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error('usage: node scripts/import-shelters.js --type <type> [--underground auto|yes|no] [--out FILE] (INPUT.csv | --datago ID)');
  console.error(`types: ${SHELTER_TYPES.join(', ')}`);
  process.exit(1);
}

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        type: { type: 'string' },
        datago: { type: 'string' },
        underground: { type: 'string', default: 'auto' },
        out: { type: 'string' },
      },
    });
  } catch (err) {
    usage(err.message);
  }
  const { values, positionals } = args;
  if (Boolean(values.datago) === (positionals.length === 1) || positionals.length > 1) {
    usage('give exactly one input: a CSV path or --datago ID');
  }
  if (!SHELTER_TYPES.includes(values.type)) usage(`unknown --type "${values.type ?? ''}"`);
  if (!['auto', 'yes', 'no'].includes(values.underground)) usage('--underground must be auto, yes or no');

  let buffer;
  try {
    if (values.datago) {
      const file = await downloadDataGoFile(values.datago);
      console.log(`downloaded ${file.filename} from ${file.sourceUrl}`);
      buffer = file.buffer;
    } else {
      buffer = readFileSync(positionals[0]);
    }
  } catch (err) {
    usage(err.message);
  }

  let result;
  try {
    result = convertShelterRows(parseCsvObjects(decodeText(buffer)), { type: values.type, underground: values.underground });
  } catch (err) {
    usage(err.message);
  }
  const { shelters, skipped, swapped, columns } = result;
  console.log('column mapping:', columns);

  const outFile = values.out ?? path.join(ROOT_DIR, 'data', 'shelters', `${values.type}.csv`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, toCsv(SHELTER_CSV_HEADER, shelters));
  console.log(`wrote ${shelters.length} shelters to ${outFile}`
    + `${swapped ? ` (fixed ${swapped} rows with swapped lat/lng)` : ''}`
    + `${skipped ? ` (skipped ${skipped} rows without a name or WGS84 coordinates)` : ''}`);
  console.log('restart the server to load the new file.');
}

main();
