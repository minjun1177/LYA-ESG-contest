// 고정 창(fixed window) 방식의 간단한 요청 제한 — 제보 도배 방지용

export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** 허용되면 true, 초과면 false */
  take(key, now = Date.now()) {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      this.#sweep(now);
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  retryAfterSec(key, now = Date.now()) {
    const entry = this.hits.get(key);
    return entry ? Math.max(1, Math.ceil((entry.start + this.windowMs - now) / 1000)) : 0;
  }

  #sweep(now) {
    if (this.hits.size < 5000) return;
    for (const [key, entry] of this.hits) {
      if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
  }
}
