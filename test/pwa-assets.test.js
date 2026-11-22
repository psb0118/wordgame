"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const push = require("../server/push.js");

const ROOT = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const resolve = (src) => path.join(ROOT, "client", src.replace(/^\//, ""));

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString(), "PNG", `${path.basename(file)}는 PNG여야 합니다`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* Chrome은 manifest에 192px·512px 아이콘이 있을 때만 설치를 승격한다. */
test("manifest ships the PNG icons Chrome needs for install promotion", () => {
  const manifest = JSON.parse(read("client", "manifest.webmanifest"));
  assert.equal(manifest.id, "/");
  assert.ok(manifest.name || manifest.short_name, "name 또는 short_name이 필요합니다");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.notEqual(manifest.prefer_related_applications, true);

  for (const size of [192, 512]) {
    const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}` && i.type === "image/png");
    assert.ok(icon, `${size}px PNG 아이콘 항목이 필요합니다`);
    assert.match(icon.purpose, /\bany\b/, `${size}px 아이콘 purpose에 any가 필요합니다`);
    assert.deepEqual(pngSize(resolve(icon.src)), { width: size, height: size });
  }
});

/* iOS는 apple-touch-icon이 없으면 홈 화면에 페이지 스크린샷을 넣는다. */
test("index.html links the iOS home screen icon and standalone metadata", () => {
  const html = read("client", "index.html");
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon\.png">/);
  assert.deepEqual(pngSize(resolve("/apple-touch-icon.png")), { width: 180, height: 180 });
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="끝말잇기">/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
});

/* 안드로이드 알림은 SVG 아이콘을 그리지 못해 빈 네모가 뜬다. */
test("push notifications fall back to raster icons", () => {
  const manager = push.createPushManager({ loadStore: async () => null, saveStore: async () => {} });
  const payload = JSON.parse(manager.buildPayload({ title: "내 턴", body: "지금 입력하세요" }));
  assert.equal(payload.icon, "/icon-192.png");
  assert.equal(payload.badge, "/notification-badge.png");
  assert.deepEqual(pngSize(resolve(payload.badge)), { width: 96, height: 96 });

  const sw = read("client", "sw.js");
  assert.match(sw, /icon: data\.icon \|\| "\.\/icon-192\.png"/);
  assert.match(sw, /badge: data\.badge \|\| "\.\/notification-badge\.png"/);
});

test("service worker precaches the install icons with a fresh cache name", () => {
  const sw = read("client", "sw.js");
  assert.match(sw, /const CACHE = "kkeul-shell-v\d+";/);
  for (const file of ["icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "notification-badge.png"]) {
    assert.ok(sw.includes(`"./${file}"`), `${file}가 프리캐시 목록에 있어야 합니다`);
  }
});

test("install banner keeps comfortable tap targets on mobile", () => {
  const css = read("client", "style.css");
  const close = /\.install-banner-close \{[\s\S]*?\}/.exec(css);
  assert.ok(close, "닫기 버튼 스타일이 필요합니다");
  const width = Number(/width: (\d+)px/.exec(close[0])?.[1]);
  const height = Number(/height: (\d+)px/.exec(close[0])?.[1]);
  assert.ok(width >= 40 && height >= 40, `닫기 버튼은 40px 이상이어야 합니다 (${width}x${height})`);
  assert.match(css, /\.install-banner-action \{[\s\S]*?min-height: 40px/, "설치 버튼 높이가 40px 이상이어야 합니다");
});
