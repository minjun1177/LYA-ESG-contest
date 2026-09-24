import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProvince, provinceFromKmaName, loadProvinces, PROVINCE_IDS } from '../src/lib/provinces.js';

test('every boundary feature maps to a known province id', () => {
  const ids = loadProvinces().features.map((f) => f.properties.id).sort();
  assert.deepEqual(ids, [...PROVINCE_IDS].sort());
});

test('findProvince locates major cities', () => {
  assert.equal(findProvince(37.5665, 126.978), 'seoul');
  assert.equal(findProvince(35.1796, 129.0756), 'busan');
  assert.equal(findProvince(33.4996, 126.5312), 'jeju');
  assert.equal(findProvince(37.7519, 128.8761), 'gangwon'); // 강릉
  assert.equal(findProvince(35.8242, 127.148), 'jeonbuk'); // 전주
  assert.equal(findProvince(36.0, 124.0), null); // 서해
});

test('provinceFromKmaName understands KMA spellings', () => {
  assert.equal(provinceFromKmaName('서울'), 'seoul');
  assert.equal(provinceFromKmaName('경상북도'), 'gyeongbuk');
  assert.equal(provinceFromKmaName('울릉도.독도'), 'gyeongbuk');
  assert.equal(provinceFromKmaName('강원도'), 'gangwon');
  assert.equal(provinceFromKmaName('전라북도'), 'jeonbuk');
  assert.equal(provinceFromKmaName('서해5도'), 'incheon');
  assert.equal(provinceFromKmaName('제주도'), 'jeju');
  assert.equal(provinceFromKmaName('동해중부먼바다'), null);
  assert.equal(provinceFromKmaName(''), null);
});
