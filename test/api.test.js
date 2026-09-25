import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { EventHub } from '../src/lib/events.js';
import { ReportStore } from '../src/lib/reportStore.js';
import { GeocoderError } from '../src/services/geocoder.js';
import { KmaService } from '../src/services/kma.js';

let server;
let base;
let store;
let events;

before(async () => {
  const config = { ...loadConfig({}), reportRateLimit: 3, reportRateWindowMin: 10, searchRateLimit: 6 };
  store = new ReportStore({ dbPath: ':memory:', resolveThreshold: 2 });
  events = new EventHub();
  const shelters = [
    { id: 's:0', name: 'gym', type: 'temporary_housing', lat: 37.57, lng: 126.98, underground: false, sample: true },
    { id: 's:1', name: 'bunker', type: 'civil_defense', lat: 37.567, lng: 126.978, underground: true, sample: true },
  ];
  const kma = new KmaService({ serviceKey: '' }); // 샘플 데이터: 서울 호우경보
  const geocoder = {
    search: async (q, lang) => {
      if (q === 'down') throw new GeocoderError('search_unavailable');
      if (q === 'boom') throw new Error('unexpected');
      return [{ name: `${q}:${lang}`, address: '', lat: 37.5, lng: 127, category: 'place', type: 'x', bbox: null }];
    },
  };
  const app = createApp({ config, kma, geocoder, shelters, reportStore: store, events });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  events.close();
  server.close();
  store.close();
});

const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('GET /api/config exposes language-neutral codes only', async () => {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.live, false);
  assert.ok(cfg.hazards.includes('heavy_rain'));
  assert.ok(!cfg.hazards.includes('high_seas'));
  assert.ok(cfg.reportCategories.includes('flooding'));
});

test('GET /api/situation assesses risk and matches shelters', async () => {
  const s = await (await fetch(`${base}/api/situation?lat=37.5665&lng=126.978`)).json();
  assert.equal(s.province, 'seoul');
  assert.equal(s.risk.level, 'danger');
  assert.deepEqual(s.risk.hazards, ['heavy_rain']);
  assert.deepEqual(s.shelters.map((x) => x.id), ['s:0']); // 지하 대피소 제외
  assert.equal(s.shelterFallback, false);
  assert.equal(s.sources.warnings, 'sample');
});

test('simulation replaces real data with one hazard', async () => {
  const s = await (await fetch(`${base}/api/situation?lat=37.5665&lng=126.978&simulate=earthquake`)).json();
  assert.equal(s.simulated, 'earthquake');
  assert.deepEqual(s.risk.hazards, ['earthquake']);
  assert.deepEqual(s.warnings, []);
  // 지진 대피소가 없는 데이터 → 대체했다는 표시
  assert.equal(s.shelterFallback, true);
  const bad = await fetch(`${base}/api/situation?lat=37.5&lng=127&simulate=high_seas`);
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'invalid_simulation' });
});

test('invalid inputs return error codes', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/situation?lat=abc&lng=1`)).json(), { error: 'invalid_location' });
  assert.deepEqual(await (await fetch(`${base}/api/shelters?bbox=1,2`)).json(), { error: 'invalid_bbox' });
  assert.deepEqual(await (await fetch(`${base}/api/nope`)).json(), { error: 'not_found' });
  assert.deepEqual(await (await post('/api/reports', '{bad')).json(), { error: 'invalid_body' });
  assert.deepEqual(await (await post('/api/reports', { lat: 35.68, lng: 139.69, category: 'fire' })).json(), { error: 'out_of_korea' });
  assert.deepEqual(await (await post('/api/reports', { lat: 37.5, lng: 127, category: 'zzz' })).json(), { error: 'invalid_category' });
  const long = await post('/api/reports', { lat: 37.5, lng: 127, category: 'fire', description: 'x'.repeat(201) });
  assert.deepEqual(await long.json(), { error: 'description_too_long', max: 200 });
});

test('reports are created, broadcast, resolved, and rate limited per visitor IP', async () => {
  const seen = [];
  const original = events.broadcast.bind(events);
  events.broadcast = (event, data) => { seen.push(event); original(event, data); };

  const headers = { 'mt-connection-ip': '203.0.113.9' };
  const res = await post('/api/reports', { lat: 37.5665, lng: 126.978, category: 'flooding', description: ' water ' }, headers);
  assert.equal(res.status, 201);
  const { report } = await res.json();
  assert.equal(report.description, 'water');
  assert.deepEqual(seen, ['report:new']);

  const listed = await (await fetch(`${base}/api/reports`)).json();
  assert.ok(listed.reports.some((r) => r.id === report.id));

  const s = await (await fetch(`${base}/api/situation?lat=37.5665&lng=126.978`)).json();
  assert.equal(s.nearbyReports.length, 1);

  await post(`/api/reports/${report.id}/resolve`, {}, { 'mt-connection-ip': '198.51.100.1' });
  const second = await (await post(`/api/reports/${report.id}/resolve`, {}, { 'mt-connection-ip': '198.51.100.2' })).json();
  assert.equal(second.removed, true);
  assert.equal((await post(`/api/reports/${report.id}/resolve`, {})).status, 404);

  await post('/api/reports', { lat: 37.5, lng: 127, category: 'fire' }, headers);
  await post('/api/reports', { lat: 37.5, lng: 127, category: 'fire' }, headers);
  const limited = await post('/api/reports', { lat: 37.5, lng: 127, category: 'fire' }, headers);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'rate_limited');
  // 다른 방문자는 영향 없음
  assert.equal((await post('/api/reports', { lat: 37.5, lng: 127, category: 'fire' }, { 'mt-connection-ip': '203.0.113.10' })).status, 201);
});

test('GET /api/search returns places and matching shelters', async () => {
  const r = await (await fetch(`${base}/api/search?q=${encodeURIComponent('gym')}&lang=en`)).json();
  assert.deepEqual(r.places.map((p) => p.name), ['gym:en']);
  assert.deepEqual(r.shelters.map((s) => s.id), ['s:0']);
  assert.equal(r.placesError, null);

  const fallbackLang = await (await fetch(`${base}/api/search?q=a&lang=${encodeURIComponent('<x>')}`)).json();
  assert.equal(fallbackLang.places[0].name, 'a:ko');

  const down = await (await fetch(`${base}/api/search?q=down`)).json();
  assert.equal(down.placesError, 'search_unavailable');
  assert.deepEqual(down.places, []);

  const boom = await fetch(`${base}/api/search?q=boom`);
  assert.equal(boom.status, 500);
  assert.deepEqual(await boom.json(), { error: 'internal' });
});

test('GET /api/search validates the query and rate limits per visitor', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/search?q=%20`)).json(), { error: 'invalid_query', max: 100 });
  assert.equal((await fetch(`${base}/api/search?q=${'x'.repeat(101)}`)).status, 400);
  const headers = { 'mt-connection-ip': '192.0.2.50' };
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await fetch(`${base}/api/search?q=a`, { headers })).status, 200);
  }
  const limited = await fetch(`${base}/api/search?q=a`, { headers });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'rate_limited');
});

test('static frontend, locales and Leaflet are served', async () => {
  const index = await fetch(`${base}/`);
  assert.match(await index.text(), /id="map"/);
  // OSM 타일 서버는 Referer 가 없으면 차단 이미지를 준다
  assert.equal(index.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal((await fetch(`${base}/locales/en.json`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/leaflet/leaflet.js`)).status, 200);
});
