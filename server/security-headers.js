"use strict";

/* 최소 보안 헤더 — 인증·게임 로직은 건드리지 않고 응답 헤더만 정리한다.
   CSP는 인라인 스타일/스크립트를 정리한 뒤 별도 단계로 켠다. */

const BASE_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
});

const HSTS_VALUE = "max-age=15552000; includeSubDomains";

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
  return function securityHeaders(req, res, next) {
    for (const [name, value] of Object.entries(BASE_HEADERS)) res.setHeader(name, value);
    /* 평문 HTTP에는 HSTS를 보내지 않는다(브라우저가 무시하고, 개발 환경을 오염시킨다). */
    if (hsts && isSecureRequest(req)) res.setHeader("Strict-Transport-Security", HSTS_VALUE);
    const urlPath = String(req.path || req.url || "");
    /* 계정·게임 상태가 담긴 JSON이 브라우저나 중간 캐시에 남지 않게 한다. */
    if (isApiPath(urlPath)) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

module.exports = { createSecurityHeaders, isSecureRequest, isApiPath, BASE_HEADERS, HSTS_VALUE };
