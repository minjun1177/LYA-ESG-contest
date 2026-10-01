import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk, intensityAtProvince } from '../src/lib/risk.js';

const now = new Date('2026-07-15T06:00:00Z');
const quake = (extra = {}) => ({ lat: 36.0, lng: 129.3, magnitude: 4.5, time: '2026-07-15T05:00:00Z', domestic: true, intensity: 'Ⅳ(경북),Ⅲ(대구),Ⅱ(울산)', ...extra });

test('no risk factors is safe', () => {
  const r = assessRisk({ province: 'seoul', now });
  assert.equal(r.level, 'safe');
  assert.deepEqual(r.reasons, [{ code: 'none', basis: null, params: {} }]);
});

test('KMA warnings: warning is danger, advisory is caution, sea warnings ignored', () => {
  const warn = assessRisk({ province: 'seoul', warnings: [{ hazard: 'heavy_rain', level: 'warning' }], now });
  assert.equal(warn.level, 'danger');
  assert.equal(warn.reasons[0].basis, 'kma_warning');
  assert.equal(assessRisk({ warnings: [{ hazard: 'heat_wave', level: 'advisory' }], now }).level, 'caution');
  assert.equal(assessRisk({ warnings: [{ hazard: 'high_seas', level: 'warning' }], now }).level, 'safe');
});

test('hazards are ordered by severity', () => {
  const r = assessRisk({ warnings: [{ hazard: 'dry', level: 'advisory' }, { hazard: 'heavy_rain', level: 'warning' }], now });
  assert.deepEqual(r.hazards, ['heavy_rain', 'dry']);
});

test('earthquakes follow the alert-message intensity criteria for my province', () => {
  const gb = assessRisk({ province: 'gyeongbuk', earthquakes: [quake()], now });
  assert.equal(gb.level, 'danger'); // 진도 Ⅳ ≥ Ⅲ → 긴급재난문자 대상
  assert.deepEqual(gb.reasons[0], { code: 'earthquake', basis: 'quake_alert', params: { magnitude: 4.5, intensity: 4 } });
  assert.equal(gb.hazards[0], 'earthquake');
  assert.equal(assessRisk({ province: 'ulsan', earthquakes: [quake()], now }).level, 'caution'); // 진도 Ⅱ → 안전안내문자
  assert.equal(assessRisk({ province: 'seoul', earthquakes: [quake()], now }).level, 'safe'); // 목록에 없는 지역
  assert.equal(assessRisk({ province: 'gyeongbuk', earthquakes: [quake({ time: '2026-07-10T00:00:00Z' })], now }).level, 'safe');
  assert.equal(assessRisk({ province: 'gyeongbuk', earthquakes: [quake({ domestic: false })], now }).level, 'safe');
});

test('without a regional breakdown, the max intensity applies to the epicentre province only', () => {
  const q = quake({ intensity: '최대진도 Ⅲ' });
  const provinceOf = () => 'gyeongbuk';
  assert.equal(intensityAtProvince(q, 'gyeongbuk', provinceOf), 3);
  assert.equal(intensityAtProvince(q, 'daegu', provinceOf), null);
  assert.equal(intensityAtProvince(quake({ intensity: '' }), 'gyeongbuk', provinceOf), null);
});

test('very heavy rain (KMA 30 mm/h term) raises caution; temperature alone does not', () => {
  const rain = assessRisk({ weather: { rain1h: 30 }, now });
  assert.equal(rain.level, 'caution');
  assert.equal(rain.reasons[0].basis, 'kma_rain_term');
  assert.equal(assessRisk({ weather: { rain1h: 29.9 }, now }).level, 'safe');
  assert.equal(assessRisk({ weather: { rain1h: 0, temperature: 36 }, now }).level, 'safe'); // 폭염은 특보로만
});
