"use strict";

/* 최소 보안 헤더와 /api no-store — 응답 객체를 흉내 내 미들웨어만 검증한다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSecurityHeaders, isApiPath, HSTS_VALUE } = require("../server/security-headers.js");

function headersFor(urlPath, headers = {}) {
  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); }
  };
  createSecurityHeaders()({ path: urlPath, url: urlPath, headers, socket: {} }, res, () => {});
  return res.headers;
}

test("baseline headers are set on every response", () => {
  const headers = headersFor("/");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(headers["permissions-policy"], /camera=\(\)/);
  assert.match(headers["permissions-policy"], /geolocation=\(\)/);
});

test("HSTS is only sent for HTTPS requests", () => {
  assert.equal(headersFor("/")["strict-transport-security"], undefined);
  assert.equal(headersFor("/", { "x-forwarded-proto": "https" })["strict-transport-security"], HSTS_VALUE);
  assert.equal(headersFor("/", { "x-forwarded-proto": "https, http" })["strict-transport-security"], HSTS_VALUE);
  assert.equal(headersFor("/", { "x-forwarded-proto": "http" })["strict-transport-security"], undefined);
});

test("/api responses are never stored by caches", () => {
  assert.equal(headersFor("/api/health")["cache-control"], "no-store");
  assert.equal(headersFor("/api/metrics")["cache-control"], "no-store");
  assert.equal(headersFor("/api")["cache-control"], "no-store");
  assert.equal(headersFor("/apiary/health")["cache-control"], undefined);
  assert.equal(headersFor("/")["cache-control"], undefined);
  assert.equal(isApiPath("/api/socket"), true);
  assert.equal(isApiPath("/apis"), false);
});

test("the server disables X-Powered-By and mounts the middleware before the body parser", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "server.js"), "utf8");
  assert.match(source, /app\.disable\("x-powered-by"\);/);
  const mount = source.indexOf("app.use(createSecurityHeaders())");
  const parser = source.indexOf("app.use(express.json(");
  assert.ok(mount > 0, "보안 헤더 미들웨어가 연결되지 않았습니다");
  assert.ok(parser > 0 && mount < parser, "body 파서보다 먼저 연결해야 파싱 실패 응답에도 헤더가 붙습니다");
});
