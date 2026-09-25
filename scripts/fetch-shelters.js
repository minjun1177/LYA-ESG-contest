#!/usr/bin/env node
// data/shelter-sources.json 에 적힌 실제 대피소 데이터를 공공데이터포털에서 받아 data/shelters/ 에 저장
// 사용법: npm run fetch:shelters
// 하나가 실패해도 나머지는 계속 받고, 마지막에 요약을 출력한다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { decodeText, parseCsvObjects, toCsv } from '../src/lib/csv.js';
import { SHELTER_TYPES } from '../src/lib/hazards.js';
import { convertShelterRows } from '../src/lib/shelterImport.js';
import { SHELTER_CSV_HEADER } from '../src/lib/shelters.js';
import { downloadDataGoFile } from '../src/services/dataGoFile.js';

const MANIFEST = path.join(ROOT_DIR, 'data', 'shelter-sources.json');
const OUT_DIR = path.join(ROOT_DIR, 'data', 'shelters');
const DELAY_MS = 1000; // 포털에 부담을 주지 않도록 순차 + 간격

async function main() {
  const { datasets } = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];
  for (const ds of datasets) {
    try {
      if (!SHELTER_TYPES.includes(ds.type)) throw new Error(`unknown type "${ds.type}"`);
      if (!/^[\w.-]+\.csv$/.test(ds.out)) throw new Error(`invalid output file name "${ds.out}"`);
      const file = await downloadDataGoFile(ds.id);
      const { shelters, skipped, swapped } = convertShelterRows(parseCsvObjects(decodeText(file.buffer)), { type: ds.type });
      writeFileSync(path.join(OUT_DIR, ds.out), toCsv(SHELTER_CSV_HEADER, shelters));
      summary.push({ id: ds.id, title: ds.title, ok: true, count: shelters.length, skipped, swapped, out: ds.out });
    } catch (err) {
      summary.push({ id: ds.id, title: ds.title, ok: false, error: err.message });
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  for (const s of summary) {
    console.log(s.ok
      ? `ok    ${s.id} ${s.title}: ${s.count} shelters → data/shelters/${s.out}${s.swapped ? ` (fixed ${s.swapped} swapped lat/lng)` : ''}${s.skipped ? ` (skipped ${s.skipped})` : ''}`
      : `FAIL  ${s.id} ${s.title}: ${s.error}`);
  }
  const failed = summary.filter((s) => !s.ok).length;
  console.log(`\n${summary.length - failed}/${summary.length} datasets imported. Restart the server to load them.`);
  if (failed > 0) process.exitCode = 1;
}

main();
