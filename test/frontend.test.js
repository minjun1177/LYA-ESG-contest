// 브라우저 없이 확인할 수 있는 프론트엔드 규칙 (실제 동작은 docs/E2E_TESTING.md 로 검증)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';

const css = readFileSync(path.join(ROOT_DIR, 'public', 'css', 'style.css'), 'utf8');
const mapJs = readFileSync(path.join(ROOT_DIR, 'public', 'js', 'mapView.js'), 'utf8');

test('the hidden attribute always wins over display rules (map hint bug)', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('OSM tiles are requested with a Referer (tile usage policy)', () => {
  assert.match(mapJs, /referrerPolicy:\s*'strict-origin-when-cross-origin'/);
});

test('pick mode lets clicks through Leaflet layers (popup handlers stop map clicks)', () => {
  assert.match(css, /\.view-map\.picking \.leaflet-interactive\s*\{\s*pointer-events:\s*none;?\s*\}/);
});
