import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CONFIRMED_TTL_HOURS, REPORT_CATEGORIES, ReportStore } from '../src/lib/reportStore.js';

const H = 3600 * 1000;

test('every category has a confirmed lifetime; "other" lasts 12 hours', () => {
  for (const c of REPORT_CATEGORIES) assert.ok(CONFIRMED_TTL_HOURS[c] > 0, c);
  assert.equal(CONFIRMED_TTL_HOURS.other, 12);
});

test('pending reports expire after 2 hours unless confirmed', () => {
  const store = new ReportStore({ dbPath: ':memory:' });
  const t0 = Date.now();
  const r = store.create({ lat: 37.5, lng: 127, category: 'flooding', reporter: 'a' }, t0);
  assert.equal(r.status, 'pending');
  assert.equal(new Date(r.expiresAt).getTime() - t0, 2 * H);
  store.vote(r.id, 'b', 'confirm', t0 + H); // 투표가 와도 대기 시간은 늘지 않는다
  assert.equal(store.get(r.id).expiresAt, r.expiresAt);
  assert.deepEqual(store.purgeExpired(t0 + 2 * H), [r.id]);
  store.close();
});

test('three distinct devices confirm; duplicates do not count; lifetime depends on category', () => {
  const store = new ReportStore({ dbPath: ':memory:' });
  const t0 = Date.now();
  const r = store.create({ lat: 37.5, lng: 127, category: 'fallen_tree', reporter: 'a' }, t0);
  store.vote(r.id, 'b', 'confirm', t0);
  assert.equal(store.vote(r.id, 'b', 'confirm', t0).report.confirmVotes, 1);
  store.vote(r.id, 'c', 'confirm', t0);
  const third = store.vote(r.id, 'd', 'confirm', t0 + 1000);
  assert.equal(third.confirmed, true);
  assert.equal(third.report.status, 'confirmed');
  assert.equal(new Date(third.report.expiresAt).getTime(), t0 + 1000 + 72 * H);
  store.close();
});

test('three resolve votes remove a report', () => {
  const store = new ReportStore({ dbPath: ':memory:', confirmThreshold: 1 });
  const r = store.create({ lat: 37.5, lng: 127, category: 'fire', reporter: 'a' });
  store.vote(r.id, 'b', 'confirm');
  assert.equal(store.vote(r.id, 'x', 'resolve').removed, false);
  store.vote(r.id, 'y', 'resolve');
  assert.equal(store.vote(r.id, 'z', 'resolve').removed, true);
  assert.equal(store.get(r.id), null);
  assert.deepEqual(store.vote(r.id, 'w', 'resolve'), { report: null, removed: false, confirmed: false });
  assert.throws(() => store.vote(r.id, 'w', 'nope'), /unknown vote kind/);
  store.close();
});

test('an older database is migrated: existing reports become confirmed, old votes are kept', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reports-'));
  const dbPath = path.join(dir, 'old.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL NOT NULL, lng REAL NOT NULL,
      category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE report_resolutions (report_id INTEGER NOT NULL, voter TEXT NOT NULL, PRIMARY KEY (report_id, voter));
  `);
  const now = Date.now();
  old.prepare('INSERT INTO reports (lat, lng, category, created_at, expires_at) VALUES (37.5, 127, ?, ?, ?)').run('other', now, now + H);
  old.prepare("INSERT INTO report_resolutions VALUES (1, 'ip1')").run();
  old.close();

  const store = new ReportStore({ dbPath });
  const r = store.get(1);
  assert.equal(r.status, 'confirmed');
  assert.equal(r.resolveVotes, 1);
  store.close();
});
