"use strict";

/* 끝말잇기 오프라인 셸 — 게임 자체는 서버가 필요하지만,
   앱을 다시 열거나 단어장 화면을 확인할 수 있게 정적 자원만 캐시한다. */
const CACHE = "kkeul-shell-v11";
const BASE_SHELL = [
  "./offline.html",
  "./firebase-config.js",
  "./firebase-auth.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./notification-badge.png"
];

/* index.html이 실제로 요청하는 ?v= URL을 읽어 프리캐시한다 —
   버전 문자열을 손으로 맞추다 어긋나는 문제를 없앤다. */
async function shellUrls() {
  const urls = new Set(BASE_SHELL);
  try {
    const response = await fetch("./", { cache: "reload" });
    const html = await response.text();
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = match[1];
      if (!url || /^(?:[a-z]+:|\/\/|#)/i.test(url)) continue;
      urls.add(url.startsWith("/") ? `.${url}` : `./${url.replace(/^\.\//, "")}`);
    }
  } catch (e) { /* 오프라인 설치에서는 기본 셸만 사용한다 */ }
  return [...urls];
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = await shellUrls();
    await Promise.all(urls.map(url => cache.add(url).catch(() => undefined)));
    await self.skipWaiting();
  })());
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
    /* 안드로이드 알림은 SVG 아이콘을 그리지 못하므로 PNG를 기본값으로 쓴다. */
    icon: data.icon || "./icon-192.png",
    badge: data.badge || "./notification-badge.png",
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
