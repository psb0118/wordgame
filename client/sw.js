"use strict";

/* 끝말잇기 오프라인 셸 — 게임 자체는 서버가 필요하지만,
   앱을 다시 열거나 단어장 화면을 확인할 수 있게 정적 자원만 캐시한다. */
const CACHE = "kkeul-shell-v4";
const SHELL = [
  "./offline.html",
  "./style.css",
  "./style.css?v=42",
  "./script.js",
  "./script.js?v=51",
  "./firebase-config.js",
  "./firebase-auth.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/* 웹 푸시 — 서버가 보낸 JSON을 알림으로 표시하고, 클릭하면 해당 URL을 연다. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "끝말잇기";
  const options = {
    body: data.body || "",
    icon: data.icon || "./icon.svg",
    badge: data.badge || "./icon.svg",
    tag: data.tag || "kkeul",
    data: { url: data.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/socket.io/") || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return (await caches.match("./offline.html")) || new Response("오프라인입니다.", {
            status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        }
        return new Response("", { status: 503 });
      })
  );
});
