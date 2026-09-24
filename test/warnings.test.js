import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWarningText, splitTopLevel, warningsByProvince } from '../src/lib/warnings.js';

const SAMPLE = 'o 호우경보 : 서울, 경기도(고양, 파주)\r\no 호우주의보 : 인천\r\n'
  + 'o 폭염주의보 : 대구, 경상북도(경산), 울릉도.독도\r\no 풍랑주의보 : 동해중부먼바다\r\no 알수없음주의보 : 서울';

test('splitTopLevel ignores commas inside parentheses', () => {
  assert.deepEqual(splitTopLevel('서울, 경기도(고양, 파주), 인천'), ['서울', '경기도(고양, 파주)', '인천']);
});

test('parseWarningText extracts hazards, levels and areas', () => {
  const list = parseWarningText(SAMPLE);
  assert.equal(list.length, 4); // 알 수 없는 특보는 건너뜀
  const rain = list[0];
  assert.equal(rain.hazard, 'heavy_rain');
  assert.equal(rain.level, 'warning');
  assert.deepEqual(rain.areas, [
    { province: 'seoul', partial: false, detail: '' },
    { province: 'gyeonggi', partial: true, detail: '고양, 파주' },
  ]);
  const heat = list[2];
  const gb = heat.areas.find((a) => a.province === 'gyeongbuk');
  assert.equal(gb.partial, true);
  assert.match(gb.detail, /경산/);
  assert.match(gb.detail, /울릉도/);
  assert.deepEqual(list[3].seaAreas, ['동해중부먼바다']);
});

test('parseWarningText tolerates empty and unusual input', () => {
  assert.deepEqual(parseWarningText(''), []);
  assert.deepEqual(parseWarningText(null), []);
  assert.deepEqual(parseWarningText('o 없음'), []);
});

test('warningsByProvince groups land warnings and sorts by level', () => {
  const map = warningsByProvince(parseWarningText('o 호우주의보 : 서울\no 강풍경보 : 서울\no 풍랑경보 : 서해중부먼바다'));
  assert.deepEqual(map.seoul.map((w) => w.level), ['warning', 'advisory']);
  assert.equal(Object.keys(map).length, 1);
});
