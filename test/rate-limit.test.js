"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../server/net-limit.js");

test("rate limiter allows up to the limit inside a window", () => {
  const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.equal(rl.allow("a", 1000).ok, true);
  assert.equal(rl.allow("a", 1200).ok, true);
  assert.equal(rl.allow("a", 1400).ok, true);
  const blocked = rl.allow("a", 1500);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0, "차단 시 재시도 대기 시간을 알려준다");
});

test("rate limiter resets after the window and isolates keys", () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(rl.allow("a", 1000).ok, true);
  assert.equal(rl.allow("a", 1500).ok, false);
  assert.equal(rl.allow("b", 1500).ok, true, "다른 소켓은 영향받지 않는다");
  assert.equal(rl.allow("a", 2000).ok, true, "창이 지나면 다시 허용한다");
});

test("rate limiter rejects empty keys and bounds the bucket map", () => {
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 2 });
  assert.equal(rl.allow("", 1000).ok, false);
  rl.allow("a", 1000);
  rl.allow("b", 1000);
  rl.allow("c", 1000);
  assert.ok(rl.size() <= 2, "오래된 키를 정리해 메모리를 제한한다");
});
