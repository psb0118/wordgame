"use strict";

/* 최소 보안 헤더 + CSP(Report-Only).

   CSP는 아직 강제하지 않는다. 인라인 <script>는 내용 해시로만 허용하고
   (테마 부팅 스크립트 등), 인라인 style 속성이 많아 style-src는 'unsafe-inline'을 쓴다.
   위반은 /api/csp-report로 모아 실제 필요한 출처를 확인한 뒤 enforce로 전환한다. */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
});

const HSTS_VALUE = "max-age=15552000; includeSubDomains";
const CSP_REPORT_PATH = "/api/csp-report";
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function sha256Source(code) {
  return `'sha256-${crypto.createHash("sha256").update(code, "utf8").digest("base64")}'`;
}

/* src가 없는 <script> 본문만 해시한다. 브라우저도 같은 바이트를 해시한다. */
function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of String(html).matchAll(INLINE_SCRIPT)) {
    const code = match[1];
    if (!code.trim()) continue;
    hashes.push(sha256Source(code));
  }
  return hashes;
}

/* 배포본의 모든 HTML에서 인라인 스크립트 해시를 모은다 — 페이지를 추가해도 자동 반영. */
function collectInlineScriptHashes(dir) {
  const hashes = new Set();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".html")) continue;
    try {
      for (const hash of inlineScriptHashes(fs.readFileSync(path.join(dir, name), "utf8"))) hashes.add(hash);
    } catch { /* 읽을 수 없는 파일은 건너뛴다 */ }
  }
  return [...hashes];
}

/* Firebase 인증 iframe·토큰 교환에 필요한 오리진은 설정에서 읽어 하드코딩을 피한다. */
function readAuthDomain(dir) {
  try {
    const config = fs.readFileSync(path.join(dir, "firebase-config.js"), "utf8");
    const match = /authDomain\s*:\s*"([^"]+)"/.exec(config);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function buildCspPolicy(options = {}) {
  const hashes = options.hashes || [];
  const authDomain = options.authDomain || "";
  const firebaseOrigin = authDomain ? `https://${authDomain}` : "";

  const scriptSrc = ["'self'", "https://www.gstatic.com", ...hashes];
  const connectSrc = ["'self'", "ws:", "wss:", "https://*.googleapis.com"];
  const frameSrc = ["'self'"];
  if (firebaseOrigin) {
    connectSrc.push(firebaseOrigin);
    frameSrc.push(firebaseOrigin);
  }

  return [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    /* 인라인 style 속성(HTML·innerHTML)이 많아 우선 허용한다. */
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", connectSrc],
    ["frame-src", frameSrc],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["report-to", ["csp"]],
    ["report-uri", [CSP_REPORT_PATH]]
  ].map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

function isSecureRequest(req) {
  const forwarded = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return Boolean(req.secure || req.socket?.encrypted);
}

function isApiPath(urlPath) {
  return urlPath === "/api" || urlPath.startsWith("/api/");
}

function createSecurityHeaders(options = {}) {
  const hsts = options.hsts !== false;
  const htmlDir = path.resolve(options.htmlDir || path.join(__dirname, "..", "client"));
  const csp = options.csp === false
    ? ""
    : buildCspPolicy({
      hashes: options.hashes || collectInlineScriptHashes(htmlDir),
      authDomain: options.authDomain === undefined ? readAuthDomain(htmlDir) : options.authDomain
    });

  return function securityHeaders(req, res, next) {
    for (const [name, value] of Object.entries(BASE_HEADERS)) res.setHeader(name, value);
    if (csp) {
      /* 아직 강제하지 않는다 — 위반 로그를 모은 뒤 enforce로 바꾼다. */
      res.setHeader("Content-Security-Policy-Report-Only", csp);
      res.setHeader("Reporting-Endpoints", `csp="${CSP_REPORT_PATH}"`);
    }
    /* 평문 HTTP에는 HSTS를 보내지 않는다(브라우저가 무시하고, 개발 환경을 오염시킨다). */
    if (hsts && isSecureRequest(req)) res.setHeader("Strict-Transport-Security", HSTS_VALUE);
    const urlPath = String(req.path || req.url || "");
    /* 계정·게임 상태가 담긴 JSON이 브라우저나 중간 캐시에 남지 않게 한다. */
    if (isApiPath(urlPath)) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

module.exports = {
  createSecurityHeaders,
  buildCspPolicy,
  inlineScriptHashes,
  collectInlineScriptHashes,
  readAuthDomain,
  isSecureRequest,
  isApiPath,
  BASE_HEADERS,
  HSTS_VALUE,
  CSP_REPORT_PATH
};
