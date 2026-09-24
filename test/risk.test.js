import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk } from '../src/lib/risk.js';

const here = { lat: 37.5665, lng: 126.978 };
const now = new Date('2026-07-15T06:00:00Z');

test('no risk factors is safe', () => {
  const r = assessRisk({ location: here, now });
  assert.equal(r.level, 'safe');
  assert.deepEqual(r.reasons, [{ code: 'none', params: {} }]);
});

test('warning is danger, advisory is caution, sea warnings ignored', () => {
  assert.equal(assessRisk({ location: here, warnings: [{ hazard: 'heavy_rain', level: 'warning' }], now }).level, 'danger');
  assert.equal(assessRisk({ location: here, warnings: [{ hazard: 'heat_wave', level: 'advisory' }], now }).level, 'caution');
  assert.equal(assessRisk({ location: here, warnings: [{ hazard: 'high_seas', level: 'warning' }], now }).level, 'safe');
});

test('hazards are ordered by severity', () => {
  const r = assessRisk({
    location: here,
    warnings: [{ hazard: 'dry', level: 'advisory' }, { hazard: 'heavy_rain', level: 'warning' }],
    now,
  });
  assert.deepEqual(r.hazards, ['heavy_rain', 'dry']);
});

test('recent strong nearby earthquake is danger; old or far ones are not', () => {
  const quake = { lat: 37.6, lng: 127.0, magnitude: 4.5, time: '2026-07-15T05:00:00Z' };
  const r = assessRisk({ location: here, earthquakes: [quake], now });
  assert.equal(r.level, 'danger');
  assert.equal(r.hazards[0], 'earthquake');
  assert.equal(assessRisk({ location: here, earthquakes: [{ ...quake, time: '2026-07-10T00:00:00Z' }], now }).level, 'safe');
  assert.equal(assessRisk({ location: here, earthquakes: [{ ...quake, lat: 35.1 }], now }).level, 'safe');
  assert.equal(assessRisk({ location: here, earthquakes: [{ ...quake, magnitude: 3.0 }], now }).level, 'safe');
});

test('nearby reports and extreme weather raise caution', () => {
  assert.equal(assessRisk({ location: here, reports: [{ lat: 37.567, lng: 126.979 }], now }).level, 'caution');
  assert.equal(assessRisk({ location: here, reports: [{ lat: 37.7, lng: 127.2 }], now }).level, 'safe');
  assert.equal(assessRisk({ location: here, weather: { rain1h: 40, temperature: 20 }, now }).level, 'caution');
  assert.equal(assessRisk({ location: here, weather: { rain1h: 0, temperature: 35 }, now }).level, 'caution');
  assert.equal(assessRisk({ location: here, weather: { rain1h: 0, temperature: -15 }, now }).level, 'caution');
});
