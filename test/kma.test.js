import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KmaService, kstStampToIso, ultraShortBaseTime } from '../src/services/kma.js';

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const ok = (items) => jsonResponse({ response: { header: { resultCode: '00', resultMsg: 'NORMAL' }, body: { items: { item: items } } } });

test('without a key the service returns labelled sample data', async () => {
  const kma = new KmaService({ serviceKey: '', fetchImpl: () => assert.fail('must not call the network') });
  const w = await kma.getWarnings();
  assert.equal(w.source, 'sample');
  assert.ok(w.warnings.length > 0);
  assert.equal((await kma.getEarthquakes()).source, 'sample');
  const weather = await kma.getWeather(37.5665, 126.978);
  assert.equal(weather.source, 'sample');
  assert.equal(weather._comment, undefined);
});

test('live warnings are parsed and cached', async () => {
  let calls = 0;
  let url = '';
  const kma = new KmaService({
    serviceKey: 'a+b/c==',
    fetchImpl: async (u) => {
      calls += 1;
      url = u;
      return ok([{ tmFc: 202607151000, t6: 'o 호우경보 : 서울' }]);
    },
  });
  const w = await kma.getWarnings();
  assert.equal(w.source, 'live');
  assert.equal(w.warnings[0].hazard, 'heavy_rain');
  assert.equal(w.issuedAt, '2026-07-15T01:00:00.000Z');
  await kma.getWarnings();
  assert.equal(calls, 1);
  assert.match(url, /serviceKey=a%2Bb%2Fc%3D%3D&/); // Decoding 키는 인코딩해서 전송
});

test('an already-encoded key is sent as-is', async () => {
  let url = '';
  const kma = new KmaService({ serviceKey: 'a%2Bb', fetchImpl: async (u) => { url = u; return ok([]); } });
  await kma.getWarnings();
  assert.match(url, /serviceKey=a%2Bb&/);
});

test('NODATA means no warnings; errors mean unavailable, never sample', async () => {
  const nodata = new KmaService({
    serviceKey: 'k',
    fetchImpl: async () => jsonResponse({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } }),
  });
  assert.deepEqual(await nodata.getWarnings(), { source: 'live', issuedAt: null, warnings: [] });

  const xml = new KmaService({
    serviceKey: 'k',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<OpenAPI_ServiceResponse><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></OpenAPI_ServiceResponse>' }),
  });
  assert.equal((await xml.getWarnings()).source, 'unavailable');
  assert.equal((await xml.getEarthquakes()).source, 'unavailable');
  assert.equal((await xml.getWeather(37.5, 127)).source, 'unavailable');

  const down = new KmaService({ serviceKey: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal((await down.getWarnings()).source, 'unavailable');
});

test('earthquakes are filtered to the peninsula and de-duplicated', async () => {
  const quake = { tmEqk: '20260715093000', lat: '36.1', lon: '129.3', mt: '4.2', dep: '10', inT: 'IV', loc: 'x' };
  const kma = new KmaService({
    serviceKey: 'k',
    fetchImpl: async () => ok([quake, { ...quake }, { ...quake, lat: '10', lon: '100' }]),
  });
  const { earthquakes } = await kma.getEarthquakes();
  assert.equal(earthquakes.length, 1);
  assert.equal(earthquakes[0].magnitude, 4.2);
  assert.equal(earthquakes[0].time, '2026-07-15T00:30:00.000Z');
});

test('weather maps observation categories', async () => {
  let url = '';
  const kma = new KmaService({
    serviceKey: 'k',
    fetchImpl: async (u) => {
      url = u;
      return ok([
        { category: 'T1H', obsrValue: '31.2' }, { category: 'RN1', obsrValue: '12' },
        { category: 'REH', obsrValue: '80' }, { category: 'WSD', obsrValue: '3.4' }, { category: 'PTY', obsrValue: '1' },
      ]);
    },
  });
  const w = await kma.getWeather(37.5665, 126.978);
  assert.equal(w.temperature, 31.2);
  assert.equal(w.rain1h, 12);
  assert.equal(w.precipitationType, 1);
  assert.match(url, /nx=60&ny=127/);
});

test('ultraShortBaseTime uses the previous hour before HH:45 KST', () => {
  // 2026-07-15 10:30 KST
  assert.deepEqual(ultraShortBaseTime(new Date('2026-07-15T01:30:00Z')), { baseDate: '20260715', baseTime: '0900' });
  // 10:50 KST
  assert.deepEqual(ultraShortBaseTime(new Date('2026-07-15T01:50:00Z')), { baseDate: '20260715', baseTime: '1000' });
  // 00:10 KST → 전날 23시
  assert.deepEqual(ultraShortBaseTime(new Date('2026-07-14T15:10:00Z')), { baseDate: '20260714', baseTime: '2300' });
});

test('kstStampToIso', () => {
  assert.equal(kstStampToIso('202607151000'), '2026-07-15T01:00:00.000Z');
  assert.equal(kstStampToIso('bad'), null);
});
