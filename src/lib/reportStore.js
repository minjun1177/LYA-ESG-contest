import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 시민 위험 제보 종류 (언어 중립 코드). 표시 이름은 public/locales/*.json 의 report.category.<code>
export const REPORT_CATEGORIES = ['flooding', 'road_damage', 'fallen_tree', 'landslide', 'fire', 'power_line', 'other'];
export const REPORT_DESCRIPTION_MAX = 200;

/**
 * 제보 저장소 (Node 내장 SQLite)
 * - 제보는 ttlHours 후 자동 만료
 * - 서로 다른 사용자가 '해결됨'을 resolveThreshold 번 누르면 지도에서 사라짐
 */
export class ReportStore {
  constructor({ dbPath, ttlHours = 24, resolveThreshold = 3 }) {
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.ttlMs = ttlHours * 3600 * 1000;
    this.resolveThreshold = resolveThreshold;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS report_resolutions (
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        voter TEXT NOT NULL,
        PRIMARY KEY (report_id, voter)
      );
      CREATE INDEX IF NOT EXISTS idx_reports_expires ON reports(expires_at);
    `);
  }

  static toDto(row) {
    return {
      id: row.id,
      lat: row.lat,
      lng: row.lng,
      category: row.category,
      description: row.description,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      resolveVotes: row.votes ?? 0,
    };
  }

  purgeExpired(now = Date.now()) {
    const expired = this.db.prepare('SELECT id FROM reports WHERE expires_at <= ?').all(now).map((r) => r.id);
    if (expired.length > 0) {
      this.db.prepare('DELETE FROM report_resolutions WHERE report_id IN (SELECT id FROM reports WHERE expires_at <= ?)').run(now);
      this.db.prepare('DELETE FROM reports WHERE expires_at <= ?').run(now);
    }
    return expired;
  }

  create({ lat, lng, category, description = '' }, now = Date.now()) {
    const info = this.db
      .prepare('INSERT INTO reports (lat, lng, category, description, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(lat, lng, category, description, now, now + this.ttlMs);
    return this.get(Number(info.lastInsertRowid));
  }

  get(id) {
    const row = this.db
      .prepare(`SELECT r.*, (SELECT COUNT(*) FROM report_resolutions v WHERE v.report_id = r.id) AS votes
                FROM reports r WHERE r.id = ?`)
      .get(id);
    return row ? ReportStore.toDto(row) : null;
  }

  listActive(now = Date.now()) {
    return this.db
      .prepare(`SELECT r.*, (SELECT COUNT(*) FROM report_resolutions v WHERE v.report_id = r.id) AS votes
                FROM reports r WHERE r.expires_at > ? ORDER BY r.created_at DESC LIMIT 1000`)
      .all(now)
      .map(ReportStore.toDto);
  }

  /**
   * '해결됨' 투표. 같은 사용자의 중복 투표는 무시.
   * @returns {{ report: object|null, removed: boolean }}
   */
  voteResolved(id, voter) {
    const report = this.get(id);
    if (!report) return { report: null, removed: false };
    this.db.prepare('INSERT OR IGNORE INTO report_resolutions (report_id, voter) VALUES (?, ?)').run(id, voter);
    const updated = this.get(id);
    if (updated.resolveVotes >= this.resolveThreshold) {
      this.db.prepare('DELETE FROM report_resolutions WHERE report_id = ?').run(id);
      this.db.prepare('DELETE FROM reports WHERE id = ?').run(id);
      return { report: updated, removed: true };
    }
    return { report: updated, removed: false };
  }

  close() {
    this.db.close();
  }
}
