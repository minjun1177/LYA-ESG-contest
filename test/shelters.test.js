import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadShelters, matchShelters, normalizeShelter, sheltersInBounds } from '../src/lib/shelters.js';

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
  const ids = matchShelters(shelters, origin, ['heavy_rain']).map((s) => s.id);
  assert.deepEqual(ids, ['gym']);
});

test('earthquake prefers outdoor evacuation sites', () => {
  assert.equal(matchShelters(shelters, origin, ['earthquake'])[0].id, 'park');
});

test('heat wave picks cooling centers; primary hazard wins', () => {
  assert.deepEqual(matchShelters(shelters, origin, ['heat_wave']).map((s) => s.id), ['cool']);
  assert.equal(matchShelters(shelters, origin, ['earthquake', 'heat_wave'])[0].id, 'park');
});

test('no hazard returns nearest of any type, sorted by distance with distance attached', () => {
  const list = matchShelters(shelters, origin, []);
  assert.equal(list[0].id, 'bunker');
  assert.ok(list.every((s, i) => i === 0 || s.distanceM >= list[i - 1].distanceM - 200));
  assert.ok(!list.some((s) => s.id === 'far')); // 20km 밖
});

test('falls back to any above-ground shelter when no policy match exists', () => {
  const onlyBunkerAndWarm = shelters.filter((s) => ['bunker', 'warm'].includes(s.id));
  assert.deepEqual(matchShelters(onlyBunkerAndWarm, origin, ['heavy_rain']).map((s) => s.id), ['warm']);
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
