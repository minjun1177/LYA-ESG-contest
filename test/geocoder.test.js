import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Geocoder, GeocoderError, rankPlaces } from '../src/services/geocoder.js';

const item = (name, lat, lon, category, type, extra = {}) => ({
  name, display_name: `${name}, 서울특별시, 대한민국`, lat: String(lat), lon: String(lon),
  category, type, boundingbox: [String(lat - 0.001), String(lat + 0.001), String(lon - 0.001), String(lon + 0.001)], ...extra,
});
const reply = (items) => ({ ok: true, status: 200, json: async () => items });

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ q: u.searchParams.get('q'), params: u.searchParams, headers: init.headers, at: Date.now() });
    return handler(u.searchParams.get('q'));
  };
  fn.calls = calls;
  return fn;
}

test('requires a User-Agent per the Nominatim usage policy', () => {
  assert.throws(() => new Geocoder({}), /userAgent/);
});

test('search maps results, sends policy headers and parameters', async () => {
  const fetchImpl = fakeFetch(() => reply([item('서울특별시청', 37.5668, 126.9784, 'amenity', 'townhall')]));
  const g = new Geocoder({ userAgent: 'test-app/1.0', email: 'ops@example.com', minIntervalMs: 0, fetchImpl });
  const [place] = await g.search('서울시청', 'en');
  assert.equal(place.name, '서울특별시청');
  assert.equal(place.lat, 37.5668);
  assert.deepEqual(Object.keys(place.bbox), ['south', 'north', 'west', 'east']);
  const { params, headers } = fetchImpl.calls[0];
  assert.equal(headers['User-Agent'], 'test-app/1.0');
  assert.equal(params.get('countrycodes'), 'kr');
  assert.equal(params.get('accept-language'), 'en');
  assert.equal(params.get('format'), 'jsonv2');
  assert.equal(params.get('email'), 'ops@example.com');
});

test('results outside Korea are dropped and repeated queries are cached', async () => {
  const fetchImpl = fakeFetch(() => reply([item('Tokyo', 35.68, 139.69, 'place', 'city'), item('A', 37.5, 127, 'place', 'x')]));
  const g = new Geocoder({ userAgent: 'x', minIntervalMs: 0, fetchImpl });
  assert.deepEqual((await g.search('a')).map((p) => p.name), ['A']);
  await g.search('  A ');
  assert.equal(fetchImpl.calls.length, 1);
});

test('station queries retry without the 역 suffix and put railway stations first', async () => {
  const fetchImpl = fakeFetch((q) => (q === '구로'
    ? reply([
      item('구로', 37.5033, 126.8822, 'railway', 'station'),
      item('구로', 37.5010, 126.8830, 'railway', 'stop'),
      item('구로동', 37.49, 126.88, 'place', 'suburb'),
    ])
    : reply([item('구로역', 37.5046, 126.8819, 'highway', 'bus_stop')])));
  const g = new Geocoder({ userAgent: 'x', minIntervalMs: 0, fetchImpl });
  const places = await g.search('구로역');
  assert.deepEqual(fetchImpl.calls.map((c) => c.q), ['구로역', '구로']);
  assert.equal(places[0].category, 'railway');
  assert.ok(!places.some((p) => p.name === '구로동')); // 재검색에서는 역만 가져옴
  assert.equal(places.filter((p) => p.category === 'railway').length, 1); // 승강장(stop) 제외
});

test('no retry when a station is already in the results', async () => {
  const fetchImpl = fakeFetch(() => reply([item('Guro', 37.5, 126.88, 'railway', 'station')]));
  const g = new Geocoder({ userAgent: 'x', minIntervalMs: 0, fetchImpl });
  await g.search('Guro Station');
  assert.equal(fetchImpl.calls.length, 1);
});

test('requests are spaced by minIntervalMs', async () => {
  const fetchImpl = fakeFetch(() => reply([]));
  const g = new Geocoder({ userAgent: 'x', minIntervalMs: 60, fetchImpl });
  await Promise.all([g.search('a'), g.search('b'), g.search('c')]);
  const gaps = fetchImpl.calls.slice(1).map((c, i) => c.at - fetchImpl.calls[i].at);
  assert.ok(gaps.every((gap) => gap >= 55), `gaps ${gaps}`);
});

test('a full queue is rejected with search_busy', async () => {
  const fetchImpl = fakeFetch(() => reply([]));
  const g = new Geocoder({ userAgent: 'x', minIntervalMs: 30, maxQueue: 2, fetchImpl });
  const results = await Promise.allSettled([g.search('a'), g.search('b'), g.search('c')]);
  assert.equal(results[2].status, 'rejected');
  assert.equal(results[2].reason.code, 'search_busy');
});

test('network and HTTP failures become search_unavailable', async () => {
  const down = new Geocoder({ userAgent: 'x', minIntervalMs: 0, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(down.search('a'), (e) => e instanceof GeocoderError && e.code === 'search_unavailable');
  const http = new Geocoder({ userAgent: 'x', minIntervalMs: 0, fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(http.search('a'), (e) => e.code === 'search_unavailable');
  // 실패한 뒤에도 다음 요청은 정상 처리
  let n = 0;
  const flaky = new Geocoder({
    userAgent: 'x', minIntervalMs: 0,
    fetchImpl: async () => { n += 1; if (n === 1) throw new Error('x'); return reply([]); },
  });
  await assert.rejects(flaky.search('a'));
  assert.deepEqual(await flaky.search('b'), []);
});

test('rankPlaces moves bus stops last and removes nearby duplicates', () => {
  const p = (name, lat, category, type) => ({ name, lat, lng: 127, category, type });
  const ranked = rankPlaces([
    p('Stop', 37.5, 'highway', 'bus_stop'),
    p('Hall', 37.5, 'amenity', 'townhall'),
    p('Hall', 37.5001, 'amenity', 'townhall'),
    p('Hall', 37.6, 'amenity', 'townhall'),
  ]);
  assert.deepEqual(ranked.map((x) => `${x.name}@${x.lat}`), ['Hall@37.5', 'Hall@37.6', 'Stop@37.5']);
});
