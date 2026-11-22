"use strict";

/* 서비스 워커 activate 정리 로직 — VM에서 caches/fetch를 흉내 내 실제 sw.js를 실행한다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "client", "sw.js"), "utf8");
const BASE = "https://game.example.com/sw.js";
const ORIGIN = "https://game.example.com";
const CACHE = "kkeul-shell-v11";
const OFFLINE = `${ORIGIN}/offline.html`;

const SHELL_HTML =
  '<link rel="stylesheet" href="/style.css?v=aaaa111122">' +
  '<script src="script.js?v=bbbb333344"></script>';

function absolute(url) {
  return new URL(url, BASE).href;
}

function load({ cached = [], html = SHELL_HTML, failFetch = false, omitOffline = false } = {}) {
  const store = new Set(cached.map(absolute));
  const listeners = new Map();
  const deletedCaches = [];
  const additions = [];
  const state = { claimed: 0, skipped: 0 };

  const keyOf = (entry) => (typeof entry === "string" ? absolute(entry) : entry.url);

  const cache = {
    async keys() { return [...store].map((url) => ({ url })); },
    async delete(entry) { return store.delete(keyOf(entry)); },
    async add(url) { additions.push(absolute(url)); store.add(absolute(url)); },
    async put(request) { store.add(keyOf(request)); },
    async match(entry) {
      const key = keyOf(entry);
      if (key.endsWith("/offline.html") && omitOffline) return undefined;
      return store.has(key) ? new Response(`cached:${key}`) : undefined;
    }
  };

  const caches = {
    async open() { return cache; },
    async keys() { return [CACHE, "kkeul-shell-v10"]; },
    async delete(key) { deletedCaches.push(key); return true; },
    async match(entry) {
      const key = keyOf(entry);
      return store.has(key) ? new Response(`cached:${key}`) : undefined;
    }
  };

  const self = {
    location: { href: BASE, origin: ORIGIN },
    registration: { scope: `${ORIGIN}/` },
    addEventListener(type, handler) { listeners.set(type, handler); },
    async skipWaiting() { state.skipped += 1; },
    clients: {
      async claim() { state.claimed += 1; },
      async matchAll() { return []; },
      async openWindow() { return undefined; }
    }
  };

  const fetchImpl = failFetch
    ? async () => { throw new Error("offline"); }
    : async () => ({ ok: true, status: 200, text: async () => html });

  vm.runInContext(SOURCE, vm.createContext({ self, caches, fetch: fetchImpl, URL, Response, console }));

  async function run(type, event = {}) {
    let pending;
    const handler = listeners.get(type);
    assert.ok(handler, `${type} 리스너가 없습니다`);
    handler({ ...event, waitUntil(promise) { pending = promise; }, respondWith(promise) { pending = promise; } });
    return pending;
  }

  return { store, run, deletedCaches, additions, state };
}

test("activate keeps the current shell and drops stale hashed assets", async () => {
  const worker = load({
    cached: [
      `${ORIGIN}/style.css?v=aaaa111122`,
      `${ORIGIN}/script.js?v=bbbb333344`,
      `${ORIGIN}/style.css?v=0000stale00`,
      `${ORIGIN}/script.js?v=9999stale99`,
      OFFLINE,
      `${ORIGIN}/icon-192.png`,
      `${ORIGIN}/`
    ]
  });

  await worker.run("activate");

  assert.equal(worker.store.has(`${ORIGIN}/style.css?v=0000stale00`), false, "지난 배포의 CSS가 남았습니다");
  assert.equal(worker.store.has(`${ORIGIN}/script.js?v=9999stale99`), false, "지난 배포의 JS가 남았습니다");
  assert.equal(worker.store.has(`${ORIGIN}/style.css?v=aaaa111122`), true, "현재 셸 CSS를 지웠습니다");
  assert.equal(worker.store.has(`${ORIGIN}/script.js?v=bbbb333344`), true, "현재 셸 JS를 지웠습니다");
  assert.equal(worker.store.has(OFFLINE), true, "오프라인 fallback 문서를 지웠습니다");
  assert.equal(worker.store.has(`${ORIGIN}/icon-192.png`), true, "프리캐시 아이콘을 지웠습니다");
  /* 오프라인에서도 셸 대신 offline.html로 안내하도록 문서 캐시는 셸 목록만 남긴다. */
  assert.equal(worker.store.has(`${ORIGIN}/`), false);
  assert.deepEqual(worker.deletedCaches, ["kkeul-shell-v10"]);
  assert.equal(worker.state.claimed, 1);
});

test("activate leaves the cache untouched when the shell list cannot be read", async () => {
  const cached = [
    `${ORIGIN}/style.css?v=aaaa111122`,
    `${ORIGIN}/style.css?v=0000stale00`,
    OFFLINE
  ];
  const worker = load({ cached, failFetch: true });

  await worker.run("activate");

  for (const url of cached) {
    assert.equal(worker.store.has(url), true, `${url}를 지웠습니다`);
  }
  assert.equal(worker.state.claimed, 1);
});

test("activate restores offline.html when it is missing", async () => {
  const worker = load({ cached: [`${ORIGIN}/style.css?v=aaaa111122`], omitOffline: true });

  await worker.run("activate");

  assert.ok(worker.additions.includes(OFFLINE), "offline.html을 다시 채우지 않았습니다");
  assert.equal(worker.store.has(OFFLINE), true);
});

test("offline navigation still falls back to the cached offline page", async () => {
  const worker = load({ cached: [OFFLINE] });
  const request = { method: "GET", url: `${ORIGIN}/`, mode: "navigate", headers: {} };

  const response = await worker.run("fetch", { request });
  const body = await response.text();

  assert.match(body, /offline\.html/);
});

test("the precache list keeps the offline document and install still uses it", async () => {
  const worker = load({ cached: [] });

  await worker.run("install");

  assert.equal(worker.store.has(OFFLINE), true, "install이 offline.html을 프리캐시하지 않았습니다");
  assert.equal(worker.state.skipped, 1);
  assert.match(SOURCE, /const CACHE = "kkeul-shell-v\d+";/);
});
