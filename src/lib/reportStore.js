import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 시민 위험 제보 종류 (언어 중립 코드). 표시 이름은 public/locales/*.json 의 report.category.<code>
export const REPORT_CATEGORIES = ['flooding', 'road_damage', 'fallen_tree', 'landslide', 'fire', 'power_line', 'other'];
export const REPORT_DESCRIPTION_MAX = 200;
// 종류만으로는 무슨 위험인지 알 수 없어 설명이 꼭 필요한 제보 종류
export const REPORT_CATEGORIES_REQUIRING_DESCRIPTION = ['other'];

// 확인된 제보가 지도에 남는 시간(시간). 금방 사라지는 위험은 짧게, 복구가 오래 걸리는 위험은 길게
export const CONFIRMED_TTL_HOURS = {
  flooding: 12,
  fire: 12,
  power_line: 24,
  road_damage: 72,
  fallen_tree: 72,
  landslide: 72,
  other: 12,
};

export const REPORT_STATUS = { pending: 'pending', confirmed: 'confirmed' };
export const VOTE_KINDS = ['confirm', 'resolve'];

/**
 * 시민 제보 저장소 (Node 내장 SQLite)
 *
 * 1. 제보하면 '확인 대기'(pending) — pendingMinutes 안에 확인이 모이지 않으면 사라진다
 * 2. 제보자가 아닌 서로 다른 기기 confirmThreshold 대가 '나도 봤어요' → '확인됨'(confirmed),
 *    그때부터 종류별 유지 시간(CONFIRMED_TTL_HOURS) 동안 표시
 * 3. 확인된 제보에 서로 다른 기기 resolveThreshold 대가 '해결됐어요' → 바로 삭제
 * 기기 구분은 브라우저마다 만든 무작위 기기 ID로 한다 (같은 와이파이·터널 뒤의 사람도 구분).
 */
export class ReportStore {
  constructor({ dbPath, pendingMinutes = 120, confirmThreshold = 3, resolveThreshold = 3 }) {
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.pendingMs = pendingMinutes * 60 * 1000;
    this.confirmThreshold = confirmThreshold;
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
      CREATE TABLE IF NOT EXISTS report_votes (
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        voter TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (report_id, voter, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_reports_expires ON reports(expires_at);
    `);
    this.#migrate();
  }

  // 이전 버전 DB: 상태·제보자 칸이 없던 제보는 '확인됨'으로 간주, 예전 해결 투표는 새 표로 옮김
  #migrate() {
    const cols = this.db.prepare('PRAGMA table_info(reports)').all().map((c) => c.name);
    if (!cols.includes('status')) this.db.exec("ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
    if (!cols.includes('reporter')) this.db.exec("ALTER TABLE reports ADD COLUMN reporter TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('confirmed_at')) this.db.exec('ALTER TABLE reports ADD COLUMN confirmed_at INTEGER');
    const legacy = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='report_resolutions'").get();
    if (legacy) {
      this.db.exec(`
        INSERT OR IGNORE INTO report_votes (report_id, voter, kind, created_at)
          SELECT report_id, voter, 'resolve', 0 FROM report_resolutions;
        DROP TABLE report_resolutions;
      `);
    }
  }

  static #select = `SELECT r.*,
      (SELECT COUNT(*) FROM report_votes v WHERE v.report_id = r.id AND v.kind = 'confirm') AS confirm_votes,
      (SELECT COUNT(*) FROM report_votes v WHERE v.report_id = r.id AND v.kind = 'resolve') AS resolve_votes
    FROM reports r`;

  static toDto(row) {
    return {
      id: row.id,
      lat: row.lat,
      lng: row.lng,
      category: row.category,
      description: row.description,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      expiresAt: new Date(row.expires_at).toISOString(),
      confirmVotes: row.confirm_votes ?? 0,
      resolveVotes: row.resolve_votes ?? 0,
    };
  }

  purgeExpired(now = Date.now()) {
    const expired = this.db.prepare('SELECT id FROM reports WHERE expires_at <= ?').all(now).map((r) => r.id);
    if (expired.length > 0) {
      this.db.prepare('DELETE FROM report_votes WHERE report_id IN (SELECT id FROM reports WHERE expires_at <= ?)').run(now);
      this.db.prepare('DELETE FROM reports WHERE expires_at <= ?').run(now);
    }
    return expired;
  }

  create({ lat, lng, category, description = '', reporter }, now = Date.now()) {
    const info = this.db
      .prepare(`INSERT INTO reports (lat, lng, category, description, created_at, expires_at, status, reporter)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(lat, lng, category, description, now, now + this.pendingMs, reporter);
    return this.get(Number(info.lastInsertRowid));
  }

  get(id) {
    const row = this.db.prepare(`${ReportStore.#select} WHERE r.id = ?`).get(id);
    return row ? ReportStore.toDto(row) : null;
  }

  /** 투표 자격 판단에 필요한 내부 정보 (제보자 기기 ID 포함 — 응답으로 내보내지 않는다) */
  getInternal(id) {
    return this.db.prepare('SELECT id, lat, lng, status, reporter, expires_at FROM reports WHERE id = ?').get(id) ?? null;
  }

  listActive(now = Date.now()) {
    return this.db
      .prepare(`${ReportStore.#select} WHERE r.expires_at > ? ORDER BY r.created_at DESC LIMIT 1000`)
      .all(now)
      .map(ReportStore.toDto);
  }

  /**
   * 투표. 같은 기기의 같은 종류 투표는 한 번만 센다. 자격(위치·상태·본인 여부)은 호출하는 쪽에서 확인.
   * @returns {{ report: object|null, removed: boolean, confirmed: boolean }}
   */
  vote(id, voter, kind, now = Date.now()) {
    if (!VOTE_KINDS.includes(kind)) throw new Error(`unknown vote kind: ${kind}`);
    const current = this.get(id);
    if (!current) return { report: null, removed: false, confirmed: false };
    this.db.prepare('INSERT OR IGNORE INTO report_votes (report_id, voter, kind, created_at) VALUES (?, ?, ?, ?)')
      .run(id, voter, kind, now);
    const updated = this.get(id);

    if (kind === 'confirm' && updated.status === REPORT_STATUS.pending && updated.confirmVotes >= this.confirmThreshold) {
      const ttlMs = (CONFIRMED_TTL_HOURS[updated.category] ?? CONFIRMED_TTL_HOURS.other) * 3600 * 1000;
      this.db.prepare("UPDATE reports SET status = 'confirmed', confirmed_at = ?, expires_at = ? WHERE id = ?")
        .run(now, now + ttlMs, id);
      return { report: this.get(id), removed: false, confirmed: true };
    }
    if (kind === 'resolve' && updated.resolveVotes >= this.resolveThreshold) {
      this.db.prepare('DELETE FROM report_votes WHERE report_id = ?').run(id);
      this.db.prepare('DELETE FROM reports WHERE id = ?').run(id);
      return { report: updated, removed: true, confirmed: false };
    }
    return { report: updated, removed: false, confirmed: false };
  }

  close() {
    this.db.close();
  }
}
