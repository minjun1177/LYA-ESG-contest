// 모든 언어 파일이 같은 키를 갖고, 서버가 보내는 모든 코드에 번역이 있는지 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { HAZARD_CODES, LEVELS, SHELTER_TYPES } from '../src/lib/hazards.js';
import { PROVINCE_IDS } from '../src/lib/provinces.js';
import { REPORT_CATEGORIES } from '../src/lib/reportStore.js';

const dir = path.join(ROOT_DIR, 'public', 'locales');
const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
const locales = Object.fromEntries(
  index.languages.map((l) => [l.code, JSON.parse(readFileSync(path.join(dir, `${l.code}.json`), 'utf8'))]),
);

function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
}
const get = (obj, key) => key.split('.').reduce((n, p) => n?.[p], obj);

test('default language is listed', () => {
  assert.ok(index.languages.some((l) => l.code === index.default));
});

test('all locales have exactly the same keys', () => {
  const reference = keys(locales[index.default]).sort();
  for (const [code, dict] of Object.entries(locales)) {
    assert.deepEqual(keys(dict).sort(), reference, `locale ${code} differs from ${index.default}`);
  }
});

test('every server code has a translation in every locale', () => {
  const required = [
    ...HAZARD_CODES.flatMap((c) => [`hazard.${c}.name`, `hazard.${c}.guide`]),
    ...LEVELS.map((l) => `level.${l}`),
    ...SHELTER_TYPES.map((s) => `shelter.type.${s}`),
    ...PROVINCE_IDS.map((p) => `province.${p}`),
    ...REPORT_CATEGORIES.map((c) => `report.category.${c}`),
    ...['safe', 'caution', 'danger'].flatMap((l) => [`risk.level.${l}`, `risk.levelDesc.${l}`]),
    ...['warning', 'earthquake', 'reports', 'heavyRainNow', 'hot', 'cold', 'none'].map((r) => `risk.reason.${r}`),
    ...['invalid_location', 'out_of_korea', 'invalid_category', 'description_too_long', 'rate_limited',
      'not_found', 'invalid_bbox', 'invalid_simulation', 'invalid_body', 'internal', 'network'].map((e) => `error.${e}`),
    ...['0', '1', '2', '3', '5', '6', '7'].map((p) => `weather.precipType.${p}`),
  ];
  for (const [code, dict] of Object.entries(locales)) {
    for (const key of required) {
      assert.notEqual(get(dict, key), undefined, `${code}: missing ${key}`);
    }
    for (const c of HAZARD_CODES) {
      assert.ok(Array.isArray(get(dict, `hazard.${c}.guide`)), `${code}: hazard.${c}.guide must be a list`);
    }
  }
});

test('HTML only references keys that exist', () => {
  const html = readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
  const used = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const [code, dict] of Object.entries(locales)) {
    for (const key of used) assert.equal(typeof get(dict, key), 'string', `${code}: missing ${key}`);
  }
});

test('JS only references static keys that exist', () => {
  const js = ['app.js', 'mapView.js'].map((f) => readFileSync(path.join(ROOT_DIR, 'public', 'js', f), 'utf8')).join('\n');
  const used = [...js.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const [code, dict] of Object.entries(locales)) {
    for (const key of used) {
      const found = get(dict, key) ?? get(dict, `${key}_other`);
      assert.notEqual(found, undefined, `${code}: missing ${key}`);
    }
  }
});
