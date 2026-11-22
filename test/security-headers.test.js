"use strict";

/* 최소 보안 헤더와 /api no-store — 응답 객체를 흉내 내 미들웨어만 검증한다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  createSecurityHeaders,
  buildCspPolicy,
  inlineScriptHashes,
  isApiPath,
  HSTS_VALUE,
  CSP_REPORT_PATH
} = require("../server/security-headers.js");

const CLIENT_DIR = path.join(__dirname, "..", "client");
const hashOf = (code) => `'sha256-${crypto.createHash("sha256").update(code, "utf8").digest("base64")}'`;

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

test("CSP is report-only and allows the inline theme script by hash", () => {
  const headers = headersFor("/");
  const policy = headers["content-security-policy-report-only"];
  assert.ok(policy, "Report-Only CSP 헤더가 없습니다");
  assert.equal(headers["content-security-policy"], undefined, "아직 강제 모드가 아니어야 합니다");
  assert.equal(headers["reporting-endpoints"], `csp="${CSP_REPORT_PATH}"`);

  const html = fs.readFileSync(path.join(CLIENT_DIR, "index.html"), "utf8");
  const themeScript = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(policy.includes(hashOf(themeScript)), "테마 스크립트 해시가 정책에 없습니다");

  /* offline.html의 인라인 스크립트도 같은 규칙으로 자동 허용된다. */
  const offline = fs.readFileSync(path.join(CLIENT_DIR, "offline.html"), "utf8");
  const offlineScript = /<script>([\s\S]*?)<\/script>/.exec(offline)[1];
  assert.ok(policy.includes(hashOf(offlineScript)), "offline.html 스크립트 해시가 정책에 없습니다");
  assert.equal(inlineScriptHashes('<script src="a.js"></script>').length, 0);
});

test("CSP lists only the origins the app actually needs", () => {
  const policy = buildCspPolicy({
    hashes: ["'sha256-abc'"],
    authDomain: "wordgame-9703e.firebaseapp.com"
  });
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /script-src 'self' https:\/\/www\.gstatic\.com 'sha256-abc'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.match(policy, /connect-src [^;]*https:\/\/\*\.googleapis\.com/);
  assert.match(policy, /frame-src [^;]*https:\/\/wordgame-9703e\.firebaseapp\.com/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, new RegExp(`report-uri ${CSP_REPORT_PATH}`));

  /* script-src에 'unsafe-inline'이 있으면 해시가 무시된다. */
  const scriptSrc = /script-src ([^;]+)/.exec(policy)[1];
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src에 unsafe-inline이 있으면 해시가 무효입니다");
  const origins = [...policy.matchAll(/https:\/\/[^\s;']+/g)].map((match) => match[0]);
  const allowed = new Set([
    "https://www.gstatic.com",
    "https://*.googleapis.com",
    "https://wordgame-9703e.firebaseapp.com"
  ]);
  for (const origin of origins) assert.ok(allowed.has(origin), `예상하지 못한 외부 출처: ${origin}`);
});

test("the CSP report endpoint is wired on the server", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "server.js"), "utf8");
  assert.match(source, /app\.post\("\/api\/csp-report"/);
  assert.match(source, /application\/csp-report/);
  assert.match(source, /csp: cspReports\.snapshot\(\)/);
});

test("the server disables X-Powered-By and mounts the middleware before the body parser", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "server.js"), "utf8");
  assert.match(source, /app\.disable\("x-powered-by"\);/);
  const mount = source.indexOf("app.use(createSecurityHeaders())");
  const parser = source.indexOf("app.use(express.json(");
  assert.ok(mount > 0, "보안 헤더 미들웨어가 연결되지 않았습니다");
  assert.ok(parser > 0 && mount < parser, "body 파서보다 먼저 연결해야 파싱 실패 응답에도 헤더가 붙습니다");
});
