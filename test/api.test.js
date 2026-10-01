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
  store = new ReportStore({ dbPath: ':memory:', confirmThreshold: 3, resolveThreshold: 3 });
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
  assert.deepEqual(cfg.reportDescriptionRequired, ['other']);
  assert.equal(cfg.reportConfirmThreshold, 3);
  assert.equal(cfg.reportPendingMinutes, 120);
  assert.equal(cfg.reportConfirmedTtlHours.other, 12);
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

// 기기 ID(UUID v4)와 GPS 위치를 붙인 요청 도우미
const dev = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asDevice = (n) => ({ 'x-device-id': dev(n) });
const gpsAt = (lat, lng, accuracy = 20) => ({ lat, lng, accuracy });
const report = (extra = {}) => ({ lat: 37.5, lng: 127, category: 'fire', gps: gpsAt(37.5005, 127), ...extra });

test('invalid inputs return error codes', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/situation?lat=abc&lng=1`)).json(), { error: 'invalid_location' });
  assert.deepEqual(await (await fetch(`${base}/api/shelters?bbox=1,2`)).json(), { error: 'invalid_bbox' });
  assert.deepEqual(await (await fetch(`${base}/api/nope`)).json(), { error: 'not_found' });
  assert.deepEqual(await (await post('/api/reports', '{bad')).json(), { error: 'invalid_body' });
  assert.deepEqual(await (await post('/api/reports', report({ lat: 35.68, lng: 139.69 }), asDevice(1))).json(), { error: 'out_of_korea' });
  assert.deepEqual(await (await post('/api/reports', report({ category: 'zzz' }), asDevice(1))).json(), { error: 'invalid_category' });
  const long = await post('/api/reports', report({ description: 'x'.repeat(201) }), asDevice(1));
  assert.deepEqual(await long.json(), { error: 'description_too_long', max: 200 });
  // '기타' 제보는 설명 필수 (공백만 있어도 거부)
  for (const description of [undefined, '', '   ']) {
    const r = await post('/api/reports', report({ category: 'other', description }), asDevice(77));
    assert.deepEqual(await r.json(), { error: 'description_required' });
  }
  const ok = await post('/api/reports', report({ category: 'other', description: '맨홀 뚜껑 열림' }), asDevice(77));
  assert.equal(ok.status, 201);
  // 줄바꿈은 유지되고 \r\n 은 \n 으로 통일
  const multi = await post('/api/reports', report({ category: 'other', description: '1층 침수\r\n2층 정전' }), asDevice(78));
  assert.equal((await multi.json()).report.description, '1층 침수\n2층 정전');
});

test('reporting needs a device id and a nearby, accurate GPS fix', async () => {
  assert.deepEqual(await (await post('/api/reports', report())).json(), { error: 'device_required' });
  assert.deepEqual(await (await post('/api/reports', report(), { 'x-device-id': 'not-a-uuid' })).json(), { error: 'device_required' });
  const noGps = await post('/api/reports', report({ gps: undefined }), asDevice(2));
  assert.equal(noGps.status, 403);
  assert.deepEqual(await noGps.json(), { error: 'gps_required' });
  const vague = await post('/api/reports', report({ gps: gpsAt(37.5, 127, 3000) }), asDevice(2));
  assert.deepEqual(await vague.json(), { error: 'gps_inaccurate', maxAccuracyM: 500 });
  const far = await post('/api/reports', report({ gps: gpsAt(37.52, 127) }), asDevice(2)); // 약 2.2km
  assert.deepEqual(await far.json(), { error: 'too_far', radiusM: 1000 });
});

test('a report starts pending, is confirmed by 3 other devices, then resolved by 3', async () => {
  const seen = [];
  const original = events.broadcast.bind(events);
  events.broadcast = (event, data) => { seen.push(event); original(event, data); };
  try {
    const at = { lat: 37.5665, lng: 126.978 };
    const near = gpsAt(37.567, 126.978);
    const res = await post('/api/reports', { ...at, category: 'flooding', description: ' water ', gps: near }, asDevice(10));
    assert.equal(res.status, 201);
    const { report: created } = await res.json();
    assert.equal(created.description, 'water');
    assert.equal(created.status, 'pending');
    assert.deepEqual(seen, ['report:new']);

    // 시민 제보는 위험도에 반영하지 않지만 주변 제보로는 보여준다
    const s = await (await fetch(`${base}/api/situation?lat=37.5665&lng=126.978`)).json();
    assert.equal(s.nearbyReports.length, 1);
    assert.ok(!s.risk.reasons.some((r) => r.code === 'reports'));

    const vote = (n, kind, gps = near) => post(`/api/reports/${created.id}/vote`, { kind, gps }, asDevice(n));
    assert.deepEqual(await (await vote(10, 'confirm')).json(), { error: 'own_report' });
    assert.deepEqual(await (await vote(11, 'resolve')).json(), { error: 'vote_not_allowed' }); // 확인 전에는 '해결' 불가
    assert.deepEqual(await (await vote(11, 'confirm', gpsAt(37.6, 126.978))).json(), { error: 'too_far', radiusM: 1000 });
    assert.deepEqual(await (await vote(11, 'nope')).json(), { error: 'invalid_vote' });

    assert.equal((await (await vote(11, 'confirm')).json()).report.confirmVotes, 1);
    assert.equal((await (await vote(11, 'confirm')).json()).report.confirmVotes, 1); // 같은 기기는 한 번만
    await vote(12, 'confirm');
    const third = await (await vote(13, 'confirm')).json();
    assert.equal(third.confirmed, true);
    assert.equal(third.report.status, 'confirmed');
    // 침수는 확인 후 12시간 유지
    const hours = (new Date(third.report.expiresAt) - new Date(third.report.confirmedAt)) / 3600000;
    assert.equal(Math.round(hours), 12);

    assert.deepEqual(await (await vote(14, 'confirm')).json(), { error: 'vote_not_allowed' });
    await vote(10, 'resolve'); // 제보자도 '해결됐어요'는 누를 수 있다
    await vote(11, 'resolve');
    const done = await (await vote(12, 'resolve')).json();
    assert.equal(done.removed, true);
    assert.equal((await vote(13, 'resolve')).status, 404);
    assert.ok(seen.includes('report:updated') && seen.at(-1) === 'report:removed');
  } finally {
    events.broadcast = original;
  }
});

test('a per-IP cap stops rotating device IDs to bypass the device limit', async () => {
  const cfg = { ...loadConfig({}), reportRateLimit: 5, reportIpRateLimit: 2 };
  const capStore = new ReportStore({ dbPath: ':memory:' });
  const capEvents = new EventHub();
  const app = createApp({ config: cfg, kma: new KmaService({ serviceKey: '' }), geocoder: null, shelters: [], reportStore: capStore, events: capEvents });
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}/api/reports`;
    const send = (n) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...asDevice(n) }, body: JSON.stringify(report()) });
    assert.equal((await send(201)).status, 201);
    assert.equal((await send(202)).status, 201);
    const blocked = await send(203); // 새 기기 ID지만 같은 IP
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error, 'rate_limited');
  } finally {
    capEvents.close();
    srv.close();
    capStore.close();
  }
});

test('report rate limit counts per device, not per IP', async () => {
  const body = report({ gps: gpsAt(37.5005, 127) });
  for (let i = 0; i < 3; i += 1) assert.equal((await post('/api/reports', body, asDevice(50))).status, 201);
  const limited = await post('/api/reports', body, asDevice(50));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'rate_limited');
  // 같은 IP의 다른 기기는 영향 없음
  assert.equal((await post('/api/reports', body, asDevice(51))).status, 201);
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
