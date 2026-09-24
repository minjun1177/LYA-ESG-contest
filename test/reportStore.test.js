import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReportStore } from '../src/lib/reportStore.js';

test('create, list, and resolve reports with vote threshold', () => {
  const store = new ReportStore({ dbPath: ':memory:', ttlHours: 1, resolveThreshold: 2 });
  const r = store.create({ lat: 37.5, lng: 127, category: 'flooding', description: 'water' });
  assert.equal(r.category, 'flooding');
  assert.equal(store.listActive().length, 1);

  assert.equal(store.voteResolved(r.id, 'ip1').removed, false);
  assert.equal(store.voteResolved(r.id, 'ip1').report.resolveVotes, 1); // 중복 투표 무시
  assert.equal(store.voteResolved(r.id, 'ip2').removed, true);
  assert.equal(store.listActive().length, 0);
  assert.deepEqual(store.voteResolved(r.id, 'ip3'), { report: null, removed: false });
  store.close();
});

test('expired reports are hidden and purged', () => {
  const store = new ReportStore({ dbPath: ':memory:', ttlHours: 1 });
  const t0 = Date.now();
  const r = store.create({ lat: 37.5, lng: 127, category: 'fire' }, t0);
  store.voteResolved(r.id, 'ip1');
  assert.equal(store.listActive(t0 + 2 * 3600 * 1000).length, 0);
  assert.deepEqual(store.purgeExpired(t0 + 2 * 3600 * 1000), [r.id]);
  assert.equal(store.get(r.id), null);
  store.close();
});
