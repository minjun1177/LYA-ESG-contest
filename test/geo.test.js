import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, geometryContains, isInKorea, toKmaGrid } from '../src/lib/geo.js';

test('toKmaGrid matches KMA reference grid points', () => {
  assert.deepEqual(toKmaGrid(37.5665, 126.978), { nx: 60, ny: 127 }); // 서울시청
  assert.deepEqual(toKmaGrid(35.1796, 129.0756), { nx: 98, ny: 76 }); // 부산시청
  assert.deepEqual(toKmaGrid(33.4996, 126.5312), { nx: 53, ny: 38 }); // 제주시
});

test('distanceMeters approximates Seoul–Busan distance', () => {
  const d = distanceMeters(37.5665, 126.978, 35.1796, 129.0756);
  assert.ok(d > 320000 && d < 330000, `got ${d}`);
  assert.equal(distanceMeters(37, 127, 37, 127), 0);
});

test('geometryContains handles polygons with holes and multipolygons', () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  const poly = { type: 'Polygon', coordinates: [...square, hole] };
  assert.equal(geometryContains(poly, 1, 1), true);
  assert.equal(geometryContains(poly, 5, 5), false);
  assert.equal(geometryContains(poly, 11, 1), false);
  const multi = { type: 'MultiPolygon', coordinates: [square, [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] };
  assert.equal(geometryContains(multi, 25, 25), true);
  assert.equal(geometryContains(null, 1, 1), false);
});

test('isInKorea rejects out-of-range coordinates', () => {
  assert.equal(isInKorea(37.5, 127), true);
  assert.equal(isInKorea(35.68, 139.69), false); // 도쿄
  assert.equal(isInKorea(Number.NaN, 127), false);
});
