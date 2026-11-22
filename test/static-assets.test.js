"use strict";

/* 정적 자산 압축·캐시 계층 — 요청/응답을 흉내 내 핸들러만 검증한다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  createStaticAssetHandler,
  pickEncoding,
  parseAcceptEncoding,
  cacheControlFor
} = require("../server/static-assets.js");

const CLIENT_DIR = path.join(__dirname, "..", "client");

function run(url, headers = {}, method = "GET") {
  const handler = createStaticAssetHandler({ rootDir: CLIENT_DIR });
  const [rawPath, rawQuery = ""] = url.split("?");
  const query = {};
  for (const pair of rawQuery.split("&")) {
    if (!pair) continue;
    const [key, value = ""] = pair.split("=");
    query[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  const req = { method, path: rawPath, query, headers, socket: {} };
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(body) { this.body = body || Buffer.alloc(0); }
  };
  let nextCalled = false;
  handler(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("brotli is preferred, gzip is the fallback and identity is the default", () => {
  assert.equal(pickEncoding(parseAcceptEncoding("gzip, deflate, br")), "br");
  assert.equal(pickEncoding(parseAcceptEncoding("gzip;q=1, br;q=0.5")), "gzip");
  assert.equal(pickEncoding(parseAcceptEncoding("*")), "br");
  assert.equal(pickEncoding(parseAcceptEncoding("gzip")), "gzip");
  assert.equal(pickEncoding(parseAcceptEncoding("br;q=0")), null);
  assert.equal(pickEncoding(parseAcceptEncoding("")), null);

  const br = run("/style.css?v=68", { "accept-encoding": "gzip, br" });
  assert.equal(br.res.headers["content-encoding"], "br");
  const gzip = run("/style.css?v=68", { "accept-encoding": "gzip" });
  assert.equal(gzip.res.headers["content-encoding"], "gzip");
  assert.equal(gzip.res.headers.vary, "Accept-Encoding");

  const decoded = zlib.brotliDecompressSync(br.res.body);
  assert.equal(decoded.toString(), fs.readFileSync(path.join(CLIENT_DIR, "style.css"), "utf8"));

  const identity = run("/style.css?v=68", {});
  assert.equal(identity.res.headers["content-encoding"], undefined);
  assert.equal(Number(identity.res.headers["content-length"]), fs.statSync(path.join(CLIENT_DIR, "style.css")).size);
});

test("versioned assets get a long cache while entry points stay revalidated", () => {
  assert.equal(cacheControlFor(".css", "style.css", true), "public, max-age=31536000, immutable");
  assert.equal(cacheControlFor(".css", "style.css", false), "no-cache");
  assert.equal(cacheControlFor(".html", "index.html", true), "no-cache");
  assert.equal(cacheControlFor(".js", "sw.js", true), "no-cache");

  assert.equal(run("/script.js?v=60", {}).res.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(run("/", { host: "game.example.com" }).res.headers["cache-control"], "no-cache");
});

test("revalidation answers 304 for the current ETag", () => {
  const first = run("/script.js?v=60", {});
  const etag = first.res.headers.etag;
  assert.ok(etag, "ETag가 필요합니다");

  const second = run("/script.js?v=60", { "if-none-match": etag });
  assert.equal(second.res.statusCode, 304);
  assert.equal(second.res.body.length, 0);
  assert.equal(second.res.headers["content-length"], undefined);
});

test("binary assets and traversal attempts fall through to express.static", () => {
  assert.equal(run("/icon-192.png", {}).nextCalled, true);
  assert.equal(run("/../server/server.js", {}).nextCalled, true);
  assert.equal(run("/%2e%2e%2fserver%2fserver.js", {}).nextCalled, true);
  assert.equal(run("/missing.css", {}).nextCalled, true);
});

test("the OG card is a 1200x630 PNG and index.html exposes absolute share metadata", () => {
  const size = pngSize(path.join(CLIENT_DIR, "og-cover.png"));
  assert.deepEqual(size, { width: 1200, height: 630 });

  const html = fs.readFileSync(path.join(CLIENT_DIR, "index.html"), "utf8");
  for (const prop of ["og:title", "og:description", "og:image", "og:url", "twitter:card", "twitter:image"]) {
    const meta = new RegExp(`<meta (?:property|name)="${prop}" content="([^"]+)">`).exec(html);
    assert.ok(meta, `${prop} 메타 태그가 필요합니다`);
    assert.ok(meta[1].length > 0, `${prop} 내용이 비어 있습니다`);
  }
  assert.match(html, /<meta property="og:image" content="__PUBLIC_ORIGIN__\/og-cover\.png">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);

  const { res } = run("/", { host: "game.example.com", "x-forwarded-proto": "https" });
  const served = res.body.toString("utf8");
  assert.match(served, /<meta property="og:image" content="https:\/\/game\.example\.com\/og-cover\.png">/);
  assert.match(served, /<meta property="og:url" content="https:\/\/game\.example\.com\/">/);
  assert.ok(!served.includes("__PUBLIC_ORIGIN__"), "토큰이 남으면 안 됩니다");
});
