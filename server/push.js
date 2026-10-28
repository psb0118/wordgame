"use strict";

/* 웹 푸시 알림
   ---------------------------------------------------------
   - VAPID 키는 환경 변수(VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)를 우선 사용하고,
     없으면 서버가 1회 생성해 KV 저장소에 보관한다.
   - 구독은 계정(정규화 닉네임)당 최대 5개. endpoint/keys 형식을 검증한다.
   - 만료된 구독(404/410)은 보내는 김에 정리한다.
   - 실제 전송은 web-push가 담당하며, 테스트에서는 webpushImpl을 주입한다. */

let defaultWebPush = null;
try { defaultWebPush = require("web-push"); } catch { /* 선택 의존성 — 없으면 비활성 */ }

const MAX_SUBS_PER_ACCOUNT = 5;

/* 푸시 엔드포인트로 사설/로컬 주소를 허용하면 서버가 내부망으로 요청을 보낼 수 있다.
   표준 푸시 서비스는 공인 HTTPS 호스트를 쓰므로 사설 호스트만 차단한다. */
function isBlockedPushHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;
  if (host.startsWith("::ffff:")) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function sanitizeSubscription(raw) {
  if (!raw || typeof raw !== "object") return null;
  const endpoint = String(raw.endpoint || "").trim();
  if (endpoint.length > 2000) return null;
  let parsed = null;
  try { parsed = new URL(endpoint); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  if (isBlockedPushHost(parsed.hostname)) return null;
  const keys = raw.keys && typeof raw.keys === "object" ? raw.keys : {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();
  if (!p256dh || !auth || p256dh.length > 300 || auth.length > 100) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime: Number.isFinite(Number(raw.expirationTime)) ? Number(raw.expirationTime) : null,
    addedAt: String(raw.addedAt || new Date().toISOString())
  };
}

/* 내 턴 알림을 보낼지 결정한다. 탭이 보이는 중인 플레이어에게는 보내지 않는다.
   (백그라운드 탭/연결이 끊긴 경우에만 알림) */
function shouldNotifyTurn(input = {}) {
  const mode = String(input.mode || "");
  if (!input.started || input.finished || input.practice) return false;
  if (!["online", "ranked", "tournament", "party"].includes(mode)) return false;
  if (input.isBot) return false;
  if (input.visible) return false;
  return true;
}

function buildPayload(input = {}) {
  return JSON.stringify({
    title: String(input.title || "끝말잇기").slice(0, 60),
    body: String(input.body || "").slice(0, 180),
    url: String(input.url || "/").slice(0, 500),
    tag: String(input.tag || "kkeul").slice(0, 80),
    icon: "/icon.svg",
    badge: "/icon.svg"
  });
}

function createPushManager(opts = {}) {
  const webpush = opts.webpushImpl === undefined ? defaultWebPush : opts.webpushImpl;
  const env = opts.env || process.env;
  const logger = opts.logger || console;
  const loadStore = opts.loadStore || (async () => null);
  const saveStore = opts.saveStore || (async () => {});
  const now = opts.now || (() => Date.now());

  let store = { vapid: null, subs: {} };
  let enabled = false;
  let publicKey = "";
  let initialized = false;

  function cleanSubs(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [account, list] of Object.entries(raw)) {
      const key = String(account || "").trim();
      if (!key || !Array.isArray(list)) continue;
      const seen = new Set();
      const subs = [];
      for (const item of list) {
        const sub = sanitizeSubscription(item);
        if (!sub || seen.has(sub.endpoint)) continue;
        seen.add(sub.endpoint);
        subs.push(sub);
        if (subs.length >= MAX_SUBS_PER_ACCOUNT) break;
      }
      if (subs.length) out[key] = subs;
    }
    return out;
  }

  async function init() {
    if (initialized) return { enabled, publicKey };
    initialized = true;
    try {
      const loaded = await loadStore();
      if (loaded && typeof loaded === "object") {
        store.vapid = loaded.vapid && typeof loaded.vapid === "object" ? loaded.vapid : null;
        store.subs = cleanSubs(loaded.subs);
      }
    } catch (e) {
      logger.warn?.("[PUSH] 구독 저장소 로드 실패:", e.message);
    }

    if (!webpush) {
      logger.warn?.("[PUSH] web-push 모듈이 없어 알림이 비활성화됩니다.");
      return { enabled: false, publicKey: "" };
    }

    const envPublic = String(env.VAPID_PUBLIC_KEY || "").trim();
    const envPrivate = String(env.VAPID_PRIVATE_KEY || "").trim();
    let vapid = null;
    if (envPublic && envPrivate) {
      vapid = { publicKey: envPublic, privateKey: envPrivate };
    } else if (store.vapid && store.vapid.publicKey && store.vapid.privateKey) {
      vapid = { publicKey: store.vapid.publicKey, privateKey: store.vapid.privateKey };
    } else {
      try {
        vapid = webpush.generateVAPIDKeys();
        store.vapid = vapid;
        await saveStore(store);
      } catch (e) {
        logger.warn?.("[PUSH] VAPID 키 생성 실패:", e.message);
        return { enabled: false, publicKey: "" };
      }
    }

    const subject = String(env.VAPID_SUBJECT || "mailto:admin@kkeul.local").trim();
    try {
      webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
      enabled = true;
      publicKey = vapid.publicKey;
    } catch (e) {
      logger.warn?.("[PUSH] VAPID 설정 실패:", e.message);
      enabled = false;
      publicKey = "";
    }
    return { enabled, publicKey };
  }

  async function subscribe(accountId, rawSubscription) {
    await init();
    const account = String(accountId || "").trim();
    if (!account) return { ok: false, reason: "먼저 닉네임을 설정해주세요." };
    if (!enabled) return { ok: false, reason: "서버에서 알림이 비활성화되어 있습니다." };
    const sub = sanitizeSubscription(rawSubscription);
    if (!sub) return { ok: false, reason: "알림 구독 정보가 올바르지 않습니다." };
    cleanSubsIntoStore();
    const list = Array.isArray(store.subs[account]) ? store.subs[account].slice() : [];
    const idx = list.findIndex(s => s.endpoint === sub.endpoint);
    if (idx >= 0) list[idx] = { ...sub, addedAt: list[idx].addedAt || sub.addedAt };
    else {
      if (list.length >= MAX_SUBS_PER_ACCOUNT) return { ok: false, reason: `기기당 최대 ${MAX_SUBS_PER_ACCOUNT}개까지 알림을 받을 수 있습니다.` };
      list.push(sub);
    }
    store.subs[account] = list;
    await saveStore(store);
    return { ok: true, count: list.length };
  }

  function cleanSubsIntoStore() {
    store.subs = cleanSubs(store.subs);
  }

  async function unsubscribe(accountId, endpoint) {
    await init();
    const account = String(accountId || "").trim();
    const key = String(endpoint || "").trim();
    if (!account) return { ok: false, reason: "먼저 닉네임을 설정해주세요." };
    const list = Array.isArray(store.subs[account]) ? store.subs[account] : [];
    const next = key ? list.filter(s => s.endpoint !== key) : [];
    if (next.length) store.subs[account] = next;
    else delete store.subs[account];
    await saveStore(store);
    return { ok: true, count: next.length };
  }

  function count(accountId) {
    const list = store.subs[String(accountId || "").trim()];
    return Array.isArray(list) ? list.length : 0;
  }

  async function send(accountId, payload) {
    if (!enabled) return { sent: 0, removed: 0 };
    const account = String(accountId || "").trim();
    const list = Array.isArray(store.subs[account]) ? store.subs[account].slice() : [];
    if (!list.length) return { sent: 0, removed: 0 };
    const body = buildPayload(payload);
    const keep = [];
    let sent = 0;
    let removed = 0;
    for (const sub of list) {
      try {
        await webpush.sendNotification(sub, body);
        sent++;
        keep.push(sub);
      } catch (e) {
        const status = Number(e && e.statusCode);
        if (status === 404 || status === 410 || status === 413) {
          removed++;
        } else {
          logger.warn?.("[PUSH] 전송 실패:", status || (e && e.message) || "unknown");
          keep.push(sub);
        }
      }
    }
    if (removed > 0) {
      if (keep.length) store.subs[account] = keep;
      else delete store.subs[account];
      try { await saveStore(store); } catch (e) { logger.warn?.("[PUSH] 정리 저장 실패:", e.message); }
    }
    return { sent, removed };
  }

  async function renameAccount(oldKey, newKey) {
    await init();
    const from = String(oldKey || "").trim();
    const to = String(newKey || "").trim();
    if (!from || !to || from === to) return { ok: false };
    const list = Array.isArray(store.subs[from]) ? store.subs[from] : [];
    if (!list.length) return { ok: true, moved: 0 };
    const target = Array.isArray(store.subs[to]) ? store.subs[to].slice() : [];
    const known = new Set(target.map(s => s.endpoint));
    let moved = 0;
    for (const sub of list) {
      if (known.has(sub.endpoint)) continue;
      if (target.length >= MAX_SUBS_PER_ACCOUNT) break;
      target.push(sub);
      known.add(sub.endpoint);
      moved++;
    }
    delete store.subs[from];
    if (target.length) store.subs[to] = target;
    try { await saveStore(store); } catch (e) { logger.warn?.("[PUSH] 개명 구독 저장 실패:", e.message); }
    return { ok: true, moved };
  }

  function status(accountId) {
    return {
      ok: true,
      enabled,
      publicKey,
      count: count(accountId),
      max: MAX_SUBS_PER_ACCOUNT,
      now: now()
    };
  }

  return {
    init,
    isEnabled: () => enabled,
    getPublicKey: () => publicKey,
    subscribe,
    unsubscribe,
    renameAccount,
    count,
    send,
    status,
    sanitizeSubscription,
    buildPayload
  };
}

module.exports = {
  MAX_SUBS_PER_ACCOUNT,
  sanitizeSubscription,
  isBlockedPushHost,
  shouldNotifyTurn,
  buildPayload,
  createPushManager
};
