import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadShelters, matchShelters, normalizeShelter, searchShelters, sheltersInBounds } from '../src/lib/shelters.js';

const origin = { lat: 37.5665, lng: 126.978 };
const make = (id, type, dLat, extra = {}) => ({
  id, name: id, type, lat: origin.lat + dLat, lng: origin.lng, underground: false, sample: false, ...extra,
});
const shelters = [
  make('bunker', 'civil_defense', 0.001, { underground: true }),
  make('gym', 'temporary_housing', 0.01),
  make('park', 'earthquake_outdoor', 0.005),
  make('cool', 'heat', 0.002),
  make('warm', 'cold', 0.003),
  make('far', 'temporary_housing', 1.0),
];

test('heavy rain picks above-ground housing and hides underground shelters', () => {
  const ids = matchShelters(shelters, origin, ['heavy_rain']).shelters.map((s) => s.id);
  assert.deepEqual(ids, ['gym']);
});

test('earthquake prefers outdoor evacuation sites', () => {
  assert.equal(matchShelters(shelters, origin, ['earthquake']).shelters[0].id, 'park');
});

test('heat wave picks cooling centers; primary hazard wins', () => {
  assert.deepEqual(matchShelters(shelters, origin, ['heat_wave']).shelters.map((s) => s.id), ['cool']);
  assert.equal(matchShelters(shelters, origin, ['earthquake', 'heat_wave']).shelters[0].id, 'park');
});

test('no hazard returns nearest of any type, sorted by distance with distance attached', () => {
  const { shelters: list, fallback } = matchShelters(shelters, origin, []);
  assert.equal(fallback, false);
  assert.equal(list[0].id, 'bunker');
  assert.ok(list.every((s, i) => i === 0 || s.distanceM >= list[i - 1].distanceM - 200));
  assert.ok(!list.some((s) => s.id === 'far')); // 20km 밖
});

test('falls back to any above-ground shelter when no policy match exists', () => {
  const onlyBunkerAndWarm = shelters.filter((s) => ['bunker', 'warm'].includes(s.id));
  const result = matchShelters(onlyBunkerAndWarm, origin, ['heavy_rain']);
  assert.deepEqual(result.shelters.map((s) => s.id), ['warm']);
  assert.equal(result.fallback, true); // 화면에 '맞는 대피소 없음' 안내를 띄우기 위한 표시
  assert.equal(matchShelters(shelters, origin, ['heavy_rain']).fallback, false);
});

test('normalizeShelter rejects invalid rows', () => {
  assert.equal(normalizeShelter({ name: 'x', type: 'nope', lat: '37', lng: '127' }, 0, 's'), null);
  assert.equal(normalizeShelter({ name: 'x', type: 'heat', lat: '0', lng: '0' }, 0, 's'), null);
  const ok = normalizeShelter({ name: 'x', type: 'heat', lat: '37.5', lng: '127', underground: 'Y', capacity: '30' }, 3, 's');
  assert.equal(ok.id, 's:3');
  assert.equal(ok.underground, true);
  assert.equal(ok.capacity, 30);
});

test('loadShelters reads every CSV in a folder and sheltersInBounds filters', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shelters-'));
  writeFileSync(path.join(dir, 'a.csv'), 'name,type,lat,lng,address,capacity,underground,sample\nA,heat,37.5,127.0,,,0,0\nbad,heat,x,y,,,0,0\n');
  const loaded = loadShelters(dir);
  assert.equal(loaded.length, 1);
  assert.equal(sheltersInBounds(loaded, { minLat: 37, minLng: 126, maxLat: 38, maxLng: 128 }).length, 1);
  assert.equal(sheltersInBounds(loaded, { minLat: 37, minLng: 126, maxLat: 38, maxLng: 128 }, ['cold']).length, 0);
  assert.deepEqual(loadShelters(path.join(dir, 'missing')), []);
});

test('searchShelters matches name or address ignoring spaces and case', () => {
  const list = [
    { name: '구로 무더위쉼터', address: '', type: 'heat' },
    { name: 'Gym', address: 'Guro-gu', type: 'temporary_housing' },
    { name: '서울 한파쉼터', address: '', type: 'cold' },
  ];
  assert.deepEqual(searchShelters(list, '구로무더위').map((s) => s.name), ['구로 무더위쉼터']);
  assert.deepEqual(searchShelters(list, 'GURO').map((s) => s.name), ['Gym']);
  assert.deepEqual(searchShelters(list, '  '), []);
});

test('loadShelters drops sample shelters once real data exists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shelters-'));
  const header = 'name,type,lat,lng,address,capacity,underground,sample\n';
  writeFileSync(path.join(dir, 'sample.csv'), `${header}S,heat,37.5,127.0,,,0,1\n`);
  assert.equal(loadShelters(dir).length, 1); // 샘플만 있으면 샘플 사용
  writeFileSync(path.join(dir, 'real.csv'), `${header}R,heat,37.5,127.0,,,0,0\n`);
  assert.deepEqual(loadShelters(dir).map((s) => s.name), ['R']);
});
