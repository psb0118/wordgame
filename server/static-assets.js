"use strict";

/* 정적 텍스트 자산(brotli/gzip)과 캐시 정책.

   - 요청이 올 때 한 번 압축해 프로세스 메모리에 둔다. 파일이 바뀌면 mtime/크기가
     달라져 자동으로 다시 만든다.
   - `?v=`가 붙은 자산은 내용이 바뀌면 URL도 바뀌므로 1년 immutable로 캐시한다.
   - index.html·sw.js처럼 URL이 고정된 자산은 no-cache로 두고 ETag로 304만 주고받는다.
   - index.html의 __PUBLIC_ORIGIN__ 토큰은 요청 호스트로 바꾼다. OG/Twitter 카드는
     상대 경로를 해석하지 않으므로 절대 URL이 필요하다. */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".map", "application/json; charset=utf-8"]
]);

const ORIGIN_TOKEN = "__PUBLIC_ORIGIN__";
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";
/* 첫 요청 지연을 줄이려고 brotli 품질은 9를 쓴다. 11은 5배 느리고 3~4KB 작다. */
const BROTLI_QUALITY = 9;
const CACHE_LIMIT = 64;
const MIN_COMPRESS_BYTES = 1024;

const HOST_PATTERN = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

function parseAcceptEncoding(header) {
  const weights = new Map();
  if (!header) return weights;
  for (const part of String(header).split(",")) {
    const [rawName, ...params] = part.split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let quality = 1;
    for (const param of params) {
      const [rawKey, rawValue] = param.split("=");
      if (!rawKey || rawKey.trim().toLowerCase() !== "q") continue;
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) quality = parsed;
    }
    weights.set(name, quality);
  }
  return weights;
}

/* q값이 높은 인코딩을 쓰고, 같으면 br을 고른다. q=0은 거부, 목록에 없는 인코딩은
   `*`가 있을 때만 허용한다. */
function pickEncoding(weights) {
  if (weights.size === 0) return null;
  const wildcard = weights.has("*") ? weights.get("*") : 0;
  const quality = (name) => (weights.has(name) ? weights.get(name) : wildcard);
  const brotli = quality("br");
  const gzip = quality("gzip");
  if (brotli > 0 && brotli >= gzip) return "br";
  if (gzip > 0) return "gzip";
  return null;
}

function cacheControlFor(ext, fileName, versioned) {
  if (fileName === "sw.js") return REVALIDATE;
  if (ext === ".html") return REVALIDATE;
  return versioned ? IMMUTABLE : REVALIDATE;
}

function resolveOrigin(req, configuredOrigin) {
  if (configuredOrigin) return configuredOrigin;
  const host = String(req.headers?.host || "");
  /* Host 헤더는 클라이언트가 정한다 — HTML에 그대로 넣기 전에 모양을 검사한다. */
  if (!HOST_PATTERN.test(host)) return "";
  const forwarded = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const proto = forwarded === "https" || (!forwarded && req.socket?.encrypted) ? "https" : "http";
  return `${proto}://${host}`;
}

function isInside(rootDir, filePath) {
  return filePath === rootDir || filePath.startsWith(rootDir + path.sep);
}

function createStaticAssetHandler(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, "..", "client"));
  const configuredOrigin = String(options.publicOrigin || "").replace(/\/+$/, "");
  const cache = new Map();

  function build(filePath, stat, origin) {
    const key = `${filePath}|${stat.mtimeMs}|${stat.size}|${origin}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }

    let body = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html" && body.includes(ORIGIN_TOKEN)) {
      body = Buffer.from(body.toString("utf8").split(ORIGIN_TOKEN).join(origin), "utf8");
    }

    let gzip = null;
    let brotli = null;
    if (body.length >= MIN_COMPRESS_BYTES) {
      gzip = zlib.gzipSync(body, { level: 9 });
      brotli = zlib.brotliCompressSync(body, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY }
      });
    }

    const entry = {
      body,
      gzip,
      brotli,
      etag: `W/"${body.length.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
      lastModified: new Date(stat.mtimeMs).toUTCString()
    };
    cache.set(key, entry);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return entry;
  }

  function resolveFile(urlPath) {
    const relative = urlPath.replace(/^\/+/, "");
    if (relative.split("/").some((part) => part === "..")) return null;
    let target = path.resolve(rootDir, relative);
    if (!isInside(rootDir, target)) return null;
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return null;
    }
    if (stat.isDirectory()) {
      target = path.join(target, "index.html");
      try {
        stat = fs.statSync(target);
      } catch {
        return null;
      }
      if (!isInside(rootDir, target)) return null;
    }
    if (!stat.isFile()) return null;
    return { target, stat };
  }

  return function staticAssetHandler(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let urlPath;
    try {
      urlPath = decodeURIComponent(req.path || "/");
    } catch {
      return next();
    }
    if (urlPath.includes("\0")) return next();

    const resolved = resolveFile(urlPath);
    if (!resolved) return next();

    const ext = path.extname(resolved.target).toLowerCase();
    const contentType = CONTENT_TYPES.get(ext);
    if (!contentType) return next();

    const entry = build(resolved.target, resolved.stat, ext === ".html" ? resolveOrigin(req, configuredOrigin) : "");

    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("ETag", entry.etag);
    res.setHeader("Last-Modified", entry.lastModified);
    res.setHeader(
      "Cache-Control",
      cacheControlFor(ext, path.basename(resolved.target), Boolean(req.query && req.query.v))
    );

    if (req.headers["if-none-match"] === entry.etag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    const encoding = pickEncoding(parseAcceptEncoding(req.headers["accept-encoding"]));
    const body = encoding === "br" && entry.brotli
      ? entry.brotli
      : encoding === "gzip" && entry.gzip
        ? entry.gzip
        : entry.body;
    if (body !== entry.body) {
      res.setHeader("Content-Encoding", encoding);
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(body.length));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
  };
}

module.exports = { createStaticAssetHandler, pickEncoding, parseAcceptEncoding, cacheControlFor, ORIGIN_TOKEN };
