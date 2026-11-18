"use strict";

/* 소켓 이벤트 레이트리밋 — 이벤트별 고정 창(fixed window) 제한.
   초과 요청은 조용히 무시할 수 있도록 retryAfterMs를 돌려준다. */
function createRateLimiter({ limit, windowMs, maxKeys = 20000 } = {}) {
  const max = Math.max(1, Math.floor(Number(limit) || 1));
  const span = Math.max(1, Math.floor(Number(windowMs) || 1000));
  const buckets = new Map();   /* key -> { start, count } */

  return {
    allow(key, now = Date.now()) {
      const k = String(key || "").slice(0, 120);
      if (!k) return { ok: false, retryAfterMs: span };
      let bucket = buckets.get(k);
      if (!bucket || now - bucket.start >= span) {
        bucket = { start: now, count: 0 };
        buckets.set(k, bucket);
        if (buckets.size > maxKeys) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined && oldest !== k) buckets.delete(oldest);
        }
      }
      bucket.count += 1;
      if (bucket.count > max) {
        return { ok: false, retryAfterMs: Math.max(0, span - (now - bucket.start)) };
      }
      return { ok: true, retryAfterMs: 0 };
    },
    size() { return buckets.size; }
  };
}

module.exports = { createRateLimiter };
