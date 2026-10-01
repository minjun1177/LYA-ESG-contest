import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntensity } from '../src/lib/intensity.js';

test('regional intensities are mapped to provinces', () => {
  assert.deepEqual(parseIntensity('최대진도 Ⅳ(충남), Ⅲ(대전,세종), Ⅱ(충북·전북)'), {
    max: 4,
    byProvince: { chungnam: 4, daejeon: 3, sejong: 3, chungbuk: 2, jeonbuk: 2 },
  });
});

test('max-only and ASCII forms', () => {
  assert.deepEqual(parseIntensity('최대진도Ⅰ'), { max: 1, byProvince: {} });
  assert.deepEqual(parseIntensity('III'), { max: 3, byProvince: {} });
  assert.deepEqual(parseIntensity('IV(경북)'), { max: 4, byProvince: { gyeongbuk: 4 } });
  assert.deepEqual(parseIntensity(''), { max: null, byProvince: {} });
  assert.deepEqual(parseIntensity(undefined), { max: null, byProvince: {} });
});
