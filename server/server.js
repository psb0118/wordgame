"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { createCluster } = require("./cluster.js");
const rankSeason = require("./rank-season.js");
const guildWeek = require("./guild-week.js");
const guildDuel = require("./guild-duel.js");
const { createPushManager, shouldNotifyTurn } = require("./push.js");
const wordbookStore = require("./wordbook.js");
const replayShare = require("./replay-share.js");
const {
  DUEUM, normalizeWord, allowedFirstChars, canConnect,
  loadData, hasWord, getAttackDepth, isAttackWord,
  getCandidates, isOneShot, getStartCandidates, chooseStartWord,
  chooseAIWord, chooseAIStartWord, calculateRank, calculateElo,
  mergeCustomWords
} = require("./game.js");

/* =========================================================
   설정
========================================================= */

const app = express();
/* Render가 주입하는 배포 커밋 — health/metrics에서 실제 배포본을 확인한다. */
const BUILD_COMMIT = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").slice(0, 40);
/* Render 같은 리버스 프록시 뒤에서 req.ip가 실제 클라이언트 IP가 되게 한다.
   직접 노출되는 환경이라면 프록시 홉 수에 맞게 조정해야 한다. */
app.set("trust proxy", 1);
const server = http.createServer(app);
const PORT = process.env.PORT && process.env.PORT !== "0" ? process.env.PORT : 3000;

/* 다중 인스턴스 구성 — game 역할만 실제 Socket.IO 게임 코어를 띄우고,
   web 역할은 /socket.io 와 상태성 API를 게임 코어로 릴레이한다. */
const cluster = createCluster({
  onLeaseLost: () => {
    /* 리더 lease를 잃은 코어가 계속 살아 있으면 두 코어가 서로 다른 방 상태를
       들고 갈라질 수 있다. 즉시 종료하고 플랫폼이 재시작하게 둔다. */
    console.error("[CLUSTER] 게임 코어 lease 상실 — 프로세스를 종료합니다.");
    process.exit(1);
  }
});
app.use(cluster.middleware);
app.use(express.json({ limit: "256kb" }));

/* web 릴레이 인스턴스는 Socket.IO 엔진을 띄우지 않는다. 기존 핸들러 등록 코드가
   그대로 실행될 수 있도록 아무 일도 하지 않는 최소 인터페이스를 제공한다. */
function createNoopIo() {
  const noop = {
    on() { return noop; },
    emit() { return noop; },
    to() { return noop; },
    in() { return noop; },
    use() { return noop; },
    close() {},
    serverSideEmit() {},
    sockets: { sockets: new Map() }
  };
  return noop;
}

/* 계정 단위 푸시 알림 — 실패해도 게임 흐름을 막지 않는다. */
function notifyPush(accountId, payload) {
  const key = normKey(accountId);
  if (!key) return;
  Promise.resolve(pushManager.send(key, payload))
    .catch(err => console.warn("[PUSH] 알림 실패:", err && err.message ? err.message : err));
}

const io = cluster.isGameCore
  ? new Server(server, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket", "polling"],
      /* 짧은 끊김은 Socket.IO가 방/핸드셰이크를 복구한다. 30초 유예와 같은 범위. */
      connectionStateRecovery: { maxDisconnectionDuration: 30000, skipMiddlewares: true }
    })
  : createNoopIo();

/* web 역할에서만 WebSocket 업그레이드를 게임 코어로 전달한다. */
if (cluster.role === "web") server.on("upgrade", cluster.upgrade);
const ROOT_DIR = path.join(__dirname, "..");
const CLIENT_DIR = path.join(ROOT_DIR, "client");

/* 웹 푸시 — VAPID 키/구독 저장소. 실제 전송은 web-push가 담당한다. */
const pushManager = createPushManager({
  env: process.env,
  loadStore: () => loadStoreJSON("push", PUSH_STORE_PATH, null),
  saveStore: (store) => writeStoreFile(PUSH_STORE_PATH, store, "push"),
  logger: console
});
const DATA_DIR = path.join(ROOT_DIR, "data");
/* 런타임 데이터(유저/시즌/친구/관리자 설정/커스텀 사전/버그 제보) 저장 위치.
   재배포 시 저장소를 새로 클론하면 JSON 파일이 사라지므로, KK_DATA_DIR로
   영속 디스크 경로를 지정할 수 있다. 미지정 시 기존과 동일하게 data/ 를 쓴다. */
const RUNTIME_DATA_DIR = process.env.KK_DATA_DIR ? path.resolve(process.env.KK_DATA_DIR) : DATA_DIR;
const PUSH_STORE_PATH = path.join(RUNTIME_DATA_DIR, "push.json");
const GUILD_WEEK_STORE_PATH = path.join(RUNTIME_DATA_DIR, "guild-week.json");
/* 관전자 — 방마다 최대 인원. 플레이어 정원과 별개다. */
const MAX_SPECTATORS = 30;
let MAX_HEARTS = 2;
let TURN_TIME = 20;
let MAX_PLAYERS = 10;
/* 2v2 파티(팀전) — 파티 모드 상수. 기존 온라인/랭크/싱글 흐름과 완전히 분리되어
   복귀 검사(smoke 61종)에는 절대 영향을 주지 않는다.
   팀은 2명씩 2팀(총 4명)이며, 하트는 팀 단위로 공유한다. */
const PARTY_TEAM_SIZE = 2;     /* 팀당 인원 */
const PARTY_TEAM_COUNT = 2;    /* 2팀 */
const PARTY_PLAYERS = PARTY_TEAM_SIZE * PARTY_TEAM_COUNT; /* 4 */
const TEAM_HEARTS = 2;         /* 팀 하트 MAX_HEARTS(2)와 동일 — 한방 2회면 팀 탈락 */
let ONESHOT_FREE_TURNS = 1;
let MISTAKES_PER_LIFE = 5;
const AI_PLAYER_ID = "ai";
const STARTING_SYLLABLES = ["가", "기", "나", "다", "사", "마", "자", "시"];
/* 싱글플레이 힌트 한 판(게임)당 사용 횟수 제한 */
const HINTS_PER_GAME = 5;

/* =========================================================
   관리자 설정 — 수치로 조정 가능한 모든 값
========================================================= */

let watchNicks = [];
/* 관리자 권한의 유일한 근거 — 서버가 검증한 Firebase 구글 계정 이메일 allowlist.
   (기존 닉네임/비밀번호 방식은 제거됨. 환경변수 ADMIN_EMAILS로 쉼표 구분 추가 가능) */
const ADMIN_EMAILS = Array.from(new Set(
  String(process.env.ADMIN_EMAILS || "soundpsb1@gmail.com")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
));
function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());
}
/* 기다림 없이 연결이 끊겼을 때 패배 처리까지 유예하는 시간 (온라인·랭크 재접속용) */
const RECONNECT_GRACE_MS = 30000;
/* 연결이 끊긴 진행 중 게임 — socketId -> { roomId, nickname, timer } */
const disconnectedPlayers = new Map();

function notifySuperAdmins(payload) {
  for (const [sid, authed] of adminAuthed) {
    if (authed && authed.role === "super" && io.sockets.sockets.has(sid)) {
      io.to(sid).emit("admin:loginNotice", payload);
    }
  }
}
/* 접속 중인 소켓이 검증된 Firebase 관리자 이메일로 인증됐는지.
   adminAuthed 값: { role: "super", email } — 클라이언트가 절대 쓸 수 없는 서버 측 상태 */
const adminAuthed = new Map();
/* 소켓ID -> 검증된 Firebase UID/이메일 (서버가 ID 토큰에서 직접 추출) */
const socketFirebaseUid = new Map();
const socketFirebaseEmail = new Map();
const adminConfigPath = path.join(RUNTIME_DATA_DIR, "admin-config.json");

function getConfig() {
  return {
    turnTime: TURN_TIME,
    maxHearts: MAX_HEARTS,
    maxPlayers: MAX_PLAYERS,
    oneShotFreeTurns: ONESHOT_FREE_TURNS,
    mistakesPerLife: MISTAKES_PER_LIFE
  };
}

function clampNum(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const CONFIG_RANGES = {
  turnTime: [5, 120],
  maxHearts: [1, 10],
  maxPlayers: [2, 50],
  oneShotFreeTurns: [0, 5],
  mistakesPerLife: [1, 20]
};

function applyConfigValue(key, raw) {
  const range = CONFIG_RANGES[key];
  if (!range) return null;
  const fallback = {
    turnTime: TURN_TIME, maxHearts: MAX_HEARTS, maxPlayers: MAX_PLAYERS,
    oneShotFreeTurns: ONESHOT_FREE_TURNS, mistakesPerLife: MISTAKES_PER_LIFE
  }[key];
  const val = clampNum(raw, range[0], range[1], fallback);
  if (key === "turnTime") TURN_TIME = val;
  else if (key === "maxHearts") MAX_HEARTS = val;
  else if (key === "maxPlayers") MAX_PLAYERS = val;
  else if (key === "oneShotFreeTurns") ONESHOT_FREE_TURNS = val;
  else if (key === "mistakesPerLife") MISTAKES_PER_LIFE = val;
  return val;
}

function saveAdminConfig() {
  try {
    writeStoreFile(adminConfigPath, { watchlist: watchNicks, config: getConfig() }, "adminConfig");
  } catch (e) { console.warn("관리자 설정 저장 실패:", e.message); }
}

function applyAdminConfig(data) {
  if (!data || typeof data !== "object") return;
  /* 구버전 adminPassword/subAdmins 필드는 무시 (Google 전용 인증으로 이전됨) */
  if (Array.isArray(data.watchlist)) watchNicks = data.watchlist.map(w => String(w || "").trim()).filter(Boolean);
  const c = data.config || {};
  for (const key of Object.keys(CONFIG_RANGES)) {
    if (typeof c[key] === "number") applyConfigValue(key, c[key]);
  }
}

async function loadAdminConfig() {
  try {
    const data = await loadStoreJSON("adminConfig", adminConfigPath, null);
    if (data) {
      applyAdminConfig(data);
      console.log(`관리자 설정 로드 완료(${dbMode === "pg" ? "DB" : "파일"}):`, JSON.stringify(getConfig()));
    }
  } catch (e) { console.warn("관리자 설정 로드 실패:", e.message); }
}

/* =========================================================
   운영 제재 — 밴(접속 차단) / 뮤트(채팅 차단)
   kv_store 'moderation': { banned: {key:{nick,by,at,reason}}, muted: {...} }
========================================================= */
const moderationPath = path.join(RUNTIME_DATA_DIR, "moderation.json");
let bannedMap = new Map();   /* normKey -> {nick, by, at, reason} */
let mutedMap = new Map();    /* normKey -> {nick, by, at, reason} */

function readModEntries(raw) {
  const out = new Map();
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = normKey(k);
    if (!key) continue;
    out.set(key, {
      nick: String((v && v.nick) || k),
      by: String((v && v.by) || ""),
      at: String((v && v.at) || ""),
      reason: String((v && v.reason) || ""),
      uid: String((v && v.uid) || "")
    });
  }
  return out;
}

function applyModeration(data) {
  if (!data || typeof data !== "object") return;
  bannedMap = readModEntries(data.banned);
  mutedMap = readModEntries(data.muted);
}

function saveModeration() {
  try {
    const obj = { banned: {}, muted: {} };
    for (const [k, v] of bannedMap) obj.banned[k] = v;
    for (const [k, v] of mutedMap) obj.muted[k] = v;
    writeStoreFile(moderationPath, obj, "moderation");
  } catch (e) { console.warn("제재 정보 저장 실패:", e.message); }
}

async function loadModeration() {
  try {
    const data = await loadStoreJSON("moderation", moderationPath, null);
    if (data) {
      applyModeration(data);
      console.log(`제재 목록 로드 완료(${dbMode === "pg" ? "DB" : "파일"}): 밴 ${bannedMap.size}명 / 뮤트 ${mutedMap.size}명`);
    }
  } catch (e) { console.warn("제재 목록 로드 실패:", e.message); }
}

/* 반환: 제재 정보 또는 null */
function getBan(nickname) { return bannedMap.get(normKey(nickname)) || null; }
/* 뮤트 — 기간제(until) 지원: 만료되면 자동으로 무시된다.
   닉네임 키와 계정 UID(개명 우회 방지) 두 기준으로 모두 찾는다 */
function getMute(nickname, uid) {
  const now = Date.now();
  const live = (e) => !!e && (!e.until || Date.parse(e.until) > now);
  const hit = mutedMap.get(normKey(nickname));
  if (live(hit)) return hit;
  const u = String(uid || "");
  if (u) {
    for (const e of mutedMap.values()) {
      if (e && e.uid === u && live(e)) return e;
    }
  }
  return null;
}

/* 밴 여부 검사 — 제재당했으면 사유가 붙은 차단 메시지, 아니면 null */
function banGuard(nickname) {
  const b = getBan(nickname);
  if (!b) return null;
  return `이 계정은 이용이 정지되었습니다${b.reason ? ` (사유: ${b.reason})` : ""}. 자세한 내용은 관리자에게 문의하세요.`;
}

/* Firebase UID 기준 밴 검사 — 닉네임을 바꿔도 같은 계정은 막힌다 */
function banGuardByUid(uid) {
  const u = String(uid || "");
  if (!u) return null;
  for (const b of bannedMap.values()) {
    if (b.uid && b.uid === u) {
      return `이 계정은 이용이 정지되었습니다${b.reason ? ` (사유: ${b.reason})` : ""}. 자세한 내용은 관리자에게 문의하세요.`;
    }
  }
  return null;
}

function listModeration() {
  const now = Date.now();
  const conv = (m, hideExpired) => [...m.values()]
    .filter(e => !hideExpired || !e || !e.until || Date.parse(e.until) > now)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { banned: conv(bannedMap, false), muted: conv(mutedMap, true) };
}

function addModeration(kind, nickname, meta) {
  const key = normKey(nickname);
  if (!key) return { ok: false, reason: "닉네임을 입력해주세요." };
  const store = kind === "banned" ? bannedMap : mutedMap;
  const entry = {
    nick: String(nickname).trim(),
    by: String(meta.by || ""),
    at: new Date().toISOString(),
    reason: String(meta.reason || ""),
    uid: String(meta.uid || ""),
    /* 만료 시각 — 없음/NULL = 영구. 기간(일수)은 뮤트(채팅정지)에만 적용 */
    until: null
  };
  const days = Number(meta.days);
  if (kind !== "banned" && Number.isFinite(days) && days > 0) {
    entry.until = new Date(Date.now() + Math.floor(days) * 86400000).toISOString();
  }
  store.set(key, entry);
  saveModeration();
  return { ok: true, key, entry };
}

function removeModeration(kind, nickname) {
  const key = normKey(nickname);
  const store = kind === "banned" ? bannedMap : mutedMap;
  const existed = store.delete(key);
  if (existed) saveModeration();
  return existed;
}

/* =========================================================
   채팅 필터 — 길이/빈 내용만 검사한다.
   (비속어 필터는 운영 정책상 제거 — 신고 기반으로만 단속하고,
    도배는 아래 속도 제한이 막는다)
========================================================= */
const CHAT_MAX_LEN = 100;
const CHAT_COOLDOWN_MS = 1200;
const CHAT_WINDOW_MS = 10000;
const CHAT_WINDOW_MAX = 6;
/* 전체 채팅(대기실·로비) 최근 이력 — 최대 50건.
   kv_store('chatHistory') + 파일 미러에 영속화해 재시작·콜드워크에도 유지된다 */
const GLOBAL_CHAT_HISTORY = [];
const GLOBAL_CHAT_MAX = 50;
const chatHistoryPath = path.join(RUNTIME_DATA_DIR, "chat-history.json");
let chatSaveTimer = null;

async function loadChatHistory() {
  try {
    const data = await loadStoreJSON("chatHistory", chatHistoryPath, []);
    const keep = (Array.isArray(data) ? data : [])
      .filter(m => m && typeof m === "object" && typeof m.text === "string" && typeof m.from === "string")
      .slice(-GLOBAL_CHAT_MAX)
      .map(m => ({ from: String(m.from), text: String(m.text), at: String(m.at || ""), id: String(m.id || ""), scope: "global" }));
    GLOBAL_CHAT_HISTORY.length = 0;
    for (const m of keep) GLOBAL_CHAT_HISTORY.push(m);
  } catch (e) { console.warn("채팅 이력 로드 실패:", e.message); }
}

function saveChatHistoryNow() {
  try { writeStoreFile(chatHistoryPath, GLOBAL_CHAT_HISTORY.slice(-GLOBAL_CHAT_MAX), "chatHistory"); }
  catch (e) { console.warn("채팅 이력 저장 실패:", e.message); }
}

/* 메시지마다 DB를 때리지 않도록 3초 디바운스 — 서버 종료 시에는 즉시 플러시된다 */
function scheduleSaveChatHistory() {
  if (chatSaveTimer) return;
  chatSaveTimer = setTimeout(() => { chatSaveTimer = null; saveChatHistoryNow(); }, 3000);
  if (chatSaveTimer && typeof chatSaveTimer.unref === "function") chatSaveTimer.unref();
}

/* 반복 채팅 신고 자동 뮤트 — 24시간 내 서로 다른 신고자 3명이 같은 대상을 신고하면
   10분 자동 뮤트. 단일 악성 유저의 도배 신고로는 발동하지 않도록 '서로 다른 신고자' 기준 */
const CHAT_AUTO_MUTE_REPORTS = 3;
const CHAT_AUTO_MUTE_MINUTES = 10;
const chatReportCounts = new Map();   /* 대상 정규화 키 -> { firstAt, reporters: Set<신고자 키> } */
/* 이모지 리액션 — 허용 목록 밖은 거부, 소켓당 최소 간격 제한 */
const REACT_EMOJIS = ["👍", "👏", "🔥", "😮", "😅", "😢", "❤️", "😂", "💪", "🎉", "🤔", "😡"];
const REACT_COOLDOWN_MS = 600;

/* 반환: { ok, reason, clean } — ok면 clean에 통과한 텍스트 */
function chatFilter(raw) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, reason: "메시지를 입력해주세요." };
  if (text.length > CHAT_MAX_LEN) {
    return { ok: false, reason: `메시지는 ${CHAT_MAX_LEN}자 이내로 입력해주세요.` };
  }
  return { ok: true, clean: text };
}

/* 계정 단위 채팅 속도 제한 — 소켓을 바꿔 재접속해도 같은 계정이면 제한이 유지된다. */
const CHAT_ACCOUNT_RATE = new Map();
const CHAT_RATE_MAX_ACCOUNTS = 5000;

function chatRateKey(uid, nickname) {
  const u = String(uid || "").trim();
  if (u) return `uid:${u}`;
  return `nick:${normKey(nickname)}`;
}

function takeChatSlot(key, now = Date.now()) {
  const k = String(key || "");
  if (!k) return { ok: false, reason: "채팅 계정을 확인할 수 없습니다." };
  const rec = CHAT_ACCOUNT_RATE.get(k) || { lastAt: 0, win: [] };
  const win = (Array.isArray(rec.win) ? rec.win : []).filter(t => now - t < CHAT_WINDOW_MS);
  if (now - Number(rec.lastAt || 0) < CHAT_COOLDOWN_MS) {
    return { ok: false, reason: "조금 천천히 보내주세요." };
  }
  if (win.length >= CHAT_WINDOW_MAX) {
    return { ok: false, reason: "짧은 시간에 메시지가 너무 많습니다." };
  }
  win.push(now);
  CHAT_ACCOUNT_RATE.set(k, { lastAt: now, win });
  if (CHAT_ACCOUNT_RATE.size > CHAT_RATE_MAX_ACCOUNTS) {
    for (const old of CHAT_ACCOUNT_RATE.keys()) {
      if (old === k) continue;
      CHAT_ACCOUNT_RATE.delete(old);
      if (CHAT_ACCOUNT_RATE.size <= CHAT_RATE_MAX_ACCOUNTS) break;
    }
  }
  return { ok: true };
}

/* =========================================================
   관리자: 플레이어 계정 삭제 — 닉네임(정규화) 기준 전체 제거
   players 테이블/캐시 + 감시목록·친구 참조 + 온라인 접속까지 정리
========================================================= */
async function deletePlayerAccount(nickname) {
  const key = normKey(nickname);
  if (!key) return { ok: false, reason: "닉네임을 입력해주세요." };

  const removed = new Set();

  if (dbMode === "pg" && dbPool) {
    try {
      const r = await dbPool.query(
        `SELECT id, firebase_uid FROM players
         WHERE id = $1 OR regexp_replace(lower(trim(nickname)), '\\s+', '', 'g') = $1`,
        [key]
      );
      const uids = [...new Set(r.rows.map(x => String(x.firebase_uid || "")).filter(Boolean))];
      const all = new Set(r.rows.map(x => x.id));
      if (uids.length) {
        const r2 = await dbPool.query(`SELECT id FROM players WHERE firebase_uid = ANY($1)`, [uids]);
        for (const row of r2.rows) all.add(row.id);
      }
      if (all.size) {
        await dbPool.query(`DELETE FROM players WHERE id = ANY($1)`, [[...all]]);
        await dbPool.query(`DELETE FROM economy_ledger WHERE account_id = ANY($1)`, [[...all]]);
        for (const id of all) { playerCache.delete(id); removed.add(id); }
      }
    } catch (err) {
      console.error("계정 삭제(DB) 오류:", err.message);
      return { ok: false, reason: "계정 삭제에 실패했습니다." };
    }
  } else {
    for (const [id, p] of [...playerCache]) {
      if (id === key || normKey(p && p.nickname) === key) { playerCache.delete(id); removed.add(id); }
    }
    if (removed.size) {
      try { saveJsonDb(); } catch (e) { console.warn("계정 삭제 저장 실패:", e.message); }
    }
  }

  /* 감시목록에서 제거 */
  if (watchNicks.some(w => normKey(w) === key)) {
    watchNicks = watchNicks.filter(w => normKey(w) !== key);
    saveAdminConfig();
  }

  /* 친구 목록·친구 신청에서 제거 */
  let friendsTouched = false;
  if (friendsMap.delete(key)) friendsTouched = true;
  for (const set of friendsMap.values()) { if (set.delete(key)) friendsTouched = true; }
  if (friendRequests.delete(key)) friendsTouched = true;
  for (const set of friendRequests.values()) { if (set.delete(key)) friendsTouched = true; }
  if (friendsTouched) saveFriends();

  /* 온라인 접속이면 방에서 빼고 끊는다 */
  const tId = onlineNicks.get(key);
  const ts = tId ? io.sockets.sockets.get(tId) : null;
  if (ts) {
    try {
      removeFromRankedQueue(tId);
      leaveRoomForSocket(ts, "deleted");
      ts.emit("player:deleted", { ok: false, reason: "관리자에 의해 계정이 삭제되었습니다." });
      setTimeout(() => { try { ts.disconnect(true); } catch (e) { /* 무시 */ } }, 400);
    } catch (e) { console.warn("삭제 대상 접속 정리 실패:", e.message); }
  }

  return { ok: true, removed: removed.size, ids: [...removed] };
}

/* =========================================================
   데이터 로드
========================================================= */

const baseWordData = loadData(DATA_DIR, ROOT_DIR);
/* 게임 검색 뷰 — 커스텀 사전 승인 단어가 합쳐진다. 관리자 승인 시 rebuildWordViews()로 재구성 */
let WORD_SET = baseWordData.WORD_SET;
let WORD_INDEX = baseWordData.WORD_INDEX;
const BASE_WORD_SET = baseWordData.WORD_SET;
const { ATTACK_DEPTH, ROOT_WORDS, RARE_ROOT_WORDS, DEFENSE_WORDS, DOLRIM_WORDS } = baseWordData;

function rebuildWordViews() {
  const merged = mergeCustomWords(BASE_WORD_SET, baseWordData.WORD_INDEX, customWords.approved);
  WORD_SET = merged.WORD_SET;
  WORD_INDEX = merged.WORD_INDEX;
}

function extractOpenDictionaryEntries(payload, requestedWord) {
  const wanted = normalizeWord(requestedWord);
  const rawItems = payload?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const entries = [];
  const seen = new Set();

  for (const item of items) {
    const headword = normalizeWord(String(item?.word || "").replace(/\^/g, ""));
    if (headword !== wanted) continue;
    const rawSenses = item.sense || item.sense_info || item.senseInfo;
    const senses = Array.isArray(rawSenses) ? rawSenses : rawSenses ? [rawSenses] : [];
    for (const sense of senses) {
      const definition = String(sense?.definition || "").trim();
      if (!definition) continue;
      const pos = String(sense.pos || "").trim();
      const type = String(sense.type || item.type || "").trim();
      const identity = `${pos}\u0000${definition}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const link = String(sense.link || item.link || "");
      entries.push({
        definition, pos, type,
        link: /^https:\/\/opendict\.korean\.go\.kr\//.test(link) ? link : "https://opendict.korean.go.kr/search",
      });
    }
  }
  return entries;
}

async function fetchOpenDictionaryEntries(word, apiKey, fetchFn = fetch, signal = AbortSignal.timeout(8000)) {
  const params = new URLSearchParams({
    key: apiKey,
    q: word,
    req_type: "json",
    advanced: "y",
    target: "1",
    method: "exact",
    num: "100",
  });
  const response = await fetchFn(`https://opendict.korean.go.kr/api/search?${params}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`우리말샘 응답 오류 (${response.status})`);
  const payload = await response.json();
  if (payload?.error) throw new Error("우리말샘 API 오류");
  return extractOpenDictionaryEntries(payload, word);
}

const dictionaryDefinitionCache = new Map();
const DICTIONARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DICTIONARY_EMPTY_CACHE_TTL_MS = 10 * 60 * 1000;
const DICTIONARY_CACHE_LIMIT = 500;
const DICTIONARY_INFLIGHT = new Map();

function getCachedDictionaryDefinition(word) {
  const cached = dictionaryDefinitionCache.get(word);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dictionaryDefinitionCache.delete(word);
    return null;
  }
  /* Map insertion order doubles as LRU order: a hit keeps frequently viewed words. */
  dictionaryDefinitionCache.delete(word);
  dictionaryDefinitionCache.set(word, cached);
  return cached;
}

function cacheDictionaryDefinition(word, entries) {
  dictionaryDefinitionCache.delete(word);
  if (dictionaryDefinitionCache.size >= DICTIONARY_CACHE_LIMIT) {
    dictionaryDefinitionCache.delete(dictionaryDefinitionCache.keys().next().value);
  }
  const ttl = entries.length ? DICTIONARY_CACHE_TTL_MS : DICTIONARY_EMPTY_CACHE_TTL_MS;
  dictionaryDefinitionCache.set(word, {
    entries,
    source: "우리말샘",
    expiresAt: Date.now() + ttl,
  });
}

/* =========================================================
   커스텀 사전 — 단일 저장소 customWords(kv 'customWords' + RUNTIME 파일)
   구 시스템 customDict(kv 'customDict' + 저장소 루트 파일)는 부팅 시
   읽어 병합하는 것만 한다 — 더 이상 따로 쓰지 않는다(2중화 제거).
========================================================= */
const customDictPath = path.join(ROOT_DIR, "custom-words.json");   /* 구 데이터 읽기 전용 */

/* 구 customDict 저장소 데이터를 단일 저장소에 중복 없이 병합 */
function applyCustomDict(data) {
  if (!data || typeof data !== "object") return;
  const nextId = Number(data.nextId);
  if (Number.isFinite(nextId) && nextId > customWords.nextId) customWords.nextId = nextId;
  const mergeBy = (cur, legacy, keyOf) => {
    for (const item of Array.isArray(legacy) ? legacy : []) {
      if (item == null) continue;
      const k = keyOf(item);
      if (!k) continue;
      if (!cur.some(x => keyOf(x) === k)) cur.push(item);
    }
  };
  mergeBy(customWords.pending, data.pending, p => String(p.word || ""));
  mergeBy(customWords.approved, data.approved, w => normalizeWord(String(w || "")));
  mergeBy(customWords.rejected, data.rejected, r => String(r.word || ""));
}

async function loadCustomDict() {
  try {
    const data = await loadStoreJSON("customDict", customDictPath, null);
    if (data) {
      const before = customWords.pending.length + customWords.approved.length + customWords.rejected.length;
      applyCustomDict(data);
      const after = customWords.pending.length + customWords.approved.length + customWords.rejected.length;
      console.log(`구 커스텀 사전 병합(${dbMode === "pg" ? "DB" : "파일"}): 신규 ${after - before}건 / 대기 ${customWords.pending.length} / 승인 ${customWords.approved.length}`);
      if (after !== before) saveCustomWords();
    }
  } catch (e) { console.warn("구 커스텀 사전 병합 실패:", e.message); }
}

/* =========================================================
   커스텀 사전 — 사용자 단어 신청 → 관리자 승인 (JSON 영속)
   - approved: 게임 사전(WORD_SET/WORD_INDEX)에 반영된 단어
   - pending: 승인 대기 신청  / rejected: 거절된 신청
========================================================= */

const customWordsPath = path.join(RUNTIME_DATA_DIR, "custom-words.json");
let customWords = { nextId: 1, pending: [], approved: [], rejected: [] };

function applyCustomWordsData(data) {
  if (!data || typeof data !== "object") return;
  customWords.pending = Array.isArray(data.pending) ? data.pending : [];
  customWords.approved = Array.isArray(data.approved) ? data.approved : [];
  customWords.rejected = Array.isArray(data.rejected) ? data.rejected : [];
  const nextId = Number(data.nextId);
  if (Number.isFinite(nextId) && nextId > 0) customWords.nextId = nextId;
}

function loadCustomWords() {
  try {
    if (fs.existsSync(customWordsPath)) {
      applyCustomWordsData(JSON.parse(fs.readFileSync(customWordsPath, "utf8")));
    }
    /* 승인된 커스텀 단어를 게임 사전에 반영 — WORD_SET + WORD_INDEX(첫 글자 버킷) */
    for (const w of customWords.approved) applyCustomWord(w);
    console.log(`커스텀 사전 로드: 승인 ${customWords.approved.length} / 대기 ${customWords.pending.length} / 거절 ${customWords.rejected.length}`);
  } catch (e) { console.warn("커스텀 사전 로드 실패:", e.message); }
}

/* PG 모드에서 부팅 시 DB 값으로 덮어쓴다 — 파일이 사라진 재배포에서도 단어 사전 유지 */
async function hydrateCustomWordsFromPG() {
  if (dbMode !== "pg") return;
  const data = await pgStoreGet("customWords");
  if (!data) return;
  applyCustomWordsData(data);
  for (const w of customWords.approved) applyCustomWord(w);
  console.log(`커스텀 사전 로드(DB): 승인 ${customWords.approved.length} / 대기 ${customWords.pending.length} / 거절 ${customWords.rejected.length}`);
}

function saveCustomWords() {
  try {
    writeStoreFile(customWordsPath, customWords, "customWords");
  } catch (e) { console.warn("커스텀 사전 저장 실패:", e.message); }
}

/* 승인된 커스텀 단어를 WORD_SET/WORD_INDEX에 추가 — 이미 있으면 무시 */
function applyCustomWord(word) {
  const w = normalizeWord(word);
  if (!w || WORD_SET.has(w)) return false;
  WORD_SET.add(w);
  const first = w.at(0);
  if (!first) return false;
  if (!WORD_INDEX.has(first)) WORD_INDEX.set(first, []);
  WORD_INDEX.get(first).push(w);
  return true;
}

/* 관리자 화면에 단어 승인 현황 전체 브로드캐스트 */
function emitCustomWords(socket) {
  socket.emit("admin:words", {
    ok: true,
    pending: customWords.pending.map(p => ({ word: p.word, by: p.by, at: p.at })),
    approved: customWords.approved,
    rejected: customWords.rejected.map(r => ({ word: r.word, by: r.by, at: r.at, reason: r.reason }))
  });
}

/* 단어 신청자에게 승인/반려 알림 (온라인일 때만) */
function notifyRequester(requester, msg) {
  const targetSocketId = onlineNicks.get(normKey(requester));
  if (!targetSocketId) return;
  const ts = io.sockets.sockets.get(targetSocketId);
  if (ts) ts.emit("dictionary:status", { ok: true, message: msg, refreshed: true });
}

loadCustomWords();

/* =========================================================
   데이터베이스 — PostgreSQL 또는 JSON 파일 폴백
========================================================= */

let dbPool = null;
let dbMode = null;
const playerCache = new Map();
/* KK_DATA_DIR 지정 시 그 경로를, 미지정 시 기존 위치(저장소 루트)를 유지한다 */
const jsonPath = process.env.KK_DATA_DIR
  ? path.join(RUNTIME_DATA_DIR, "player-data.json")
  : path.join(ROOT_DIR, "player-data.json");

/* ---------------------------------------------------------
   보조 저장소(friends/season/admin/custom/bug) 영속 계층
   - PG 모드: kv_store 테이블에 JSON 문자열로 저장/복원
   - JSON 모드: 파일 저장 + .bak 백업(쓰기 직전 회전)
   이렇게 하면 DATABASE_URL이 설정된 배포에서는 재배포로 파일이
   사라져도 모든 데이터가 DB에서 복구된다.
--------------------------------------------------------- */
async function pgStoreGet(key) {
  if (dbMode !== "pg" || !dbPool) return null;
  try {
    const r = await dbPool.query("SELECT value FROM kv_store WHERE key = $1", [key]);
    if (r.rows.length && r.rows[0].value != null) return JSON.parse(r.rows[0].value);
  } catch (e) { console.warn(`저장소 '${key}' PG 읽기 실패:`, e.message); }
  return null;
}

function pgStoreSet(key, value) {
  if (dbMode !== "pg" || !dbPool) return;
  dbPool.query(
    "INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
    [key, JSON.stringify(value)]
  ).catch(e => console.warn(`저장소 '${key}' PG 쓰기 실패:`, e.message));
}

/* JSON → PG 플레이어 일회성 자동 이관
   - JSON 모드로 오래 굴리다가 DATABASE_URL을 붙여 PG로 전환할 때,
     살아있는(실제 닉네임) 유저 기록을 PG에 업서트로 한 번만 옮긴다.
   - 이관 마커(kv_store)로 정확히 1회만 실행된다.
   - 파일이 없거나 실패해도 부팅을 막지 않는다(안전).
   - savePlayerData의 검증된 upsert 경로를 그대로 재사용해 필드 매핑이 갈라지지 않는다. */
async function migrateJsonPlayersToPg() {
  if (dbMode !== "pg" || !dbPool) return;
  try {
    if (!fs.existsSync(jsonPath)) return;
    const marker = await pgStoreGet("json_pg_import_v1");
    if (marker) { console.log("JSON→PG 플레이어 이관: 이미 완료됨 (건너뜀)"); return; }
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (!raw || typeof raw !== "object") return;
    let imported = 0;
    for (const [key, rec] of Object.entries(raw)) {
      if (!rec || typeof rec !== "object") continue;
      const nk = normKey(String(rec.nickname || "").trim());
      const hasRealNick = nk.length > 0 && nk !== normKey("플레이어");
      if (!hasRealNick) continue;                  /* 고스트는 이관하지 않는다 */
      /* 부분 이관 후 재시도해도 이미 PG에 있는 계정의 새 진행 기록은 덮어쓰지 않는다. */
      const existing = await dbPool.query("SELECT id FROM players WHERE id = $1", [nk]);
      if (existing.rows.length > 0) continue;
      await savePlayerData(key, rec);              /* 검증된 upsert 경로 재사용 */
      imported++;
    }
    await dbPool.query(
      "INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
      ["json_pg_import_v1", JSON.stringify({ imported, at: new Date().toISOString() })]
    );
    console.log(`JSON→PG 플레이어 이관 완료: ${imported}명`);
  } catch (err) {
    /* 파일 파손/읽기 오류 등은 치명적이지 않다 — 다음 부팅에서 다시 시도 가능 */
    console.warn("JSON→PG 플레이어 이관 생략(안전 모드):", err.message);
  }
}

/* PG 우선 로드 — PG에 값이 있으면 그 값을, 없으면 파일을, 둘 다 없으면 fallback */
async function loadStoreJSON(key, filePath, fallback = null) {
  if (dbMode === "pg") {
    const v = await pgStoreGet(key);
    if (v !== null) return v;
  }
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) { console.warn(`저장소 '${key}' 파일 읽기 실패:`, e.message); }
  return fallback;
}

/* 파일 저장 + .bak 백업 회전 + (PG 모드면) DB 미러 */
function writeStoreFile(filePath, value, key) {
  try {
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, `${filePath}.bak`); } catch (e) { /* 백업 실패는 무시 */ }
    }
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  } catch (e) { console.warn(`저장소 '${key}' 파일 저장 실패:`, e.message); }
  pgStoreSet(key, value);
}


/* 입력창 placeholder나 테스트 입력이 그대로 계정 이름이 된 경우 — 랭킹에 노출하지 않는다.
   실제 사용자가 붙인 이름과 겹치지 않도록 정확히 일치할 때만 걸러낸다. */
const PLACEHOLDER_NICKS = new Set([
  "플레이어", "닉네임", "닉네임입력", "닉네임을입력하세요", "이름", "이름입력",
  "정보", "undefined", "null"
]);

function isPlaceholderNickname(nickname) {
  const key = normKey(nickname);
  return !key || PLACEHOLDER_NICKS.has(key);
}

/* 실사용자 이름이 없는 레코드(소켓 ID 키 + placeholder 닉네임)는 고스트로 분류 —
   랭킹/리더보드에서 제외하고, 계정을 만들면 사라진다 */
function isGhostRecord(p) {
  return isPlaceholderNickname(p?.nickname);
}

/* 같은 닉네임(단일 계정) 레코드 2개를 하나로 병합 — 과거 소켓 ID 기준 저장 데이터 정규화용 */
function mergePlayerRecords(a, b) {
  const sumMode = (x, y) => ({
    rating: Math.max(Number(x?.rating) || 1000, Number(y?.rating) || 1000),
    wins: (Number(x?.wins) || 0) + (Number(y?.wins) || 0),
    losses: (Number(x?.losses) || 0) + (Number(y?.losses) || 0),
    streak: Math.max(Number(x?.streak) || 0, Number(y?.streak) || 0),
    bestStreak: Math.max(Number(x?.bestStreak) || 0, Number(y?.bestStreak) || 0)
  });
  const ra = a.ranked || {}, rb = b.ranked || {};
  const titles = [...(Array.isArray(a.titles) ? a.titles : []), ...(Array.isArray(b.titles) ? b.titles : [])]
    .filter(t => t && typeof t === "object" && t.id)
    .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i);
  const realNickA = !isGhostRecord(a) ? a.nickname : "";
  const realNickB = !isGhostRecord(b) ? b.nickname : "";
  const merged = Object.assign({}, a, b);
  merged.id = normKey(String(realNickB || realNickA || "").trim());
  merged.nickname = realNickB || realNickA || "플레이어";
  merged.single = sumMode(a.single, b.single);
  merged.multi = sumMode(a.multi, b.multi);
  merged.ranked = {
    rating: Math.max(Number(ra.rating) || 1000, Number(rb.rating) || 1000),
    wins: (Number(ra.wins) || 0) + (Number(rb.wins) || 0),
    losses: (Number(ra.losses) || 0) + (Number(rb.losses) || 0),
    streak: Math.max(Number(ra.streak) || 0, Number(rb.streak) || 0),
    bestStreak: Math.max(Number(ra.bestStreak) || 0, Number(rb.bestStreak) || 0)
  };
  merged.money = Math.max(Number(a.money) || 0, Number(b.money) || 0);
  merged.moneyMultiplier = Math.max(Number(a.moneyMultiplier) || 1, Number(b.moneyMultiplier) || 1);
  merged.ratingBoostGames = Math.max(Number(a.ratingBoostGames) || 0, Number(b.ratingBoostGames) || 0);
  merged.titles = titles;
  merged.currentTitle = b.currentTitle || a.currentTitle || "";
  merged.attendanceStreak = Math.max(Number(a.attendanceStreak) || 0, Number(b.attendanceStreak) || 0);
  merged.lastCheckDate = b.lastCheckDate || a.lastCheckDate || "";
  const ra2 = Array.isArray(a.recentGames) ? a.recentGames : [];
  const rb2 = Array.isArray(b.recentGames) ? b.recentGames : [];
  merged.recentGames = rb2.length >= ra2.length ? rb2 : ra2;
  merged.daily = b.daily || a.daily || {};
  merged.season = b.season || a.season || null;
  merged.shieldTickets = Math.max(Number(a.shieldTickets) || 0, Number(b.shieldTickets) || 0);
  merged.ratingHistory = (Array.isArray(b.ratingHistory) && b.ratingHistory.length >= (Array.isArray(a.ratingHistory) ? a.ratingHistory.length : 0)) ? b.ratingHistory : (a.ratingHistory || []);
  merged.lastSeen = b.lastSeen || a.lastSeen || "";
  return migratePlayerData(merged);
}

function loadJsonDb() {
  try {
    /* 본 파일이 없는데 백업(.bak)이 있으면 복원 — 부분 유실/중단 복구 */
    if (!fs.existsSync(jsonPath) && fs.existsSync(`${jsonPath}.bak`)) {
      try {
        fs.copyFileSync(`${jsonPath}.bak`, jsonPath);
        console.warn("player-data.json 유실 감지 — 백업에서 복원했습니다.");
      } catch (e) { console.warn("player-data.json 백업 복원 실패:", e.message); }
    }
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const merged = new Map();
      let ghosts = 0;
      for (const [k, v] of Object.entries(data)) {
        if (!v || typeof v !== "object") continue;
        if (isGhostRecord(v)) { merged.set(k, migratePlayerData(v)); ghosts++; continue; }
        const nk = normKey(String(v.nickname || "").trim());
        const existing = merged.get(nk);
        merged.set(nk, existing ? mergePlayerRecords(existing, v) : migratePlayerData(v));
      }
      playerCache.clear();
      for (const [k, v] of merged) playerCache.set(k, v);
      console.log(`JSON DB 로드: ${playerCache.size}명 (닉네임 단일 계정, 고스트 ${ghosts}개)`);
      saveJsonDb();
    }
  } catch (e) { console.warn("JSON DB 로드 실패:", e.message); }
}

/* =========================================================
   친구 & 초대 — 닉네임이 곧 계정. 친구 목록/초대 대상 조회에 사용한다
========================================================= */
const friendsJsonPath = path.join(RUNTIME_DATA_DIR, "friends.json");
const friendsMap = new Map();            /* 정규화 닉네임 -> Set<정규화 닉네임> */
const friendRequests = new Map();        /* 신청한 쪽 정규화 닉네임 -> Set<받는 쪽 정규화 닉네임> */
const onlineNicks = new Map();           /* 정규화 닉네임 -> socketId(접속 중) */
const socketNicks = new Map();           /* socketId -> 등록된 닉네임 (닉네임 재적용 전 새 소켓 구분) */
const normKey = (nick) => String(nick || "").replace(/\s+/g, "").toLowerCase();

function applyFriendsData(data) {
  if (!data || typeof data !== "object") return;
  for (const [k, arr] of Object.entries(data)) {
    if (!Array.isArray(arr)) continue;
    if (k === "_requests") {
      for (const [from, to] of arr) {
        const f = normKey(from), t = normKey(to);
        if (!f || !t) continue;
        if (!friendRequests.has(f)) friendRequests.set(f, new Set());
        friendRequests.get(f).add(t);
      }
      continue;
    }
    friendsMap.set(normKey(k), new Set((arr || []).map(f => normKey(f))));
  }
}

async function loadFriends() {
  try {
    const data = await loadStoreJSON("friends", friendsJsonPath, null);
    if (data) {
      applyFriendsData(data);
      console.log(`친구 데이터 로드(${dbMode === "pg" ? "DB" : "파일"}): 친구 ${friendsMap.size}명, 대기 신청 ${friendRequests.size}명`);
    }
  } catch (e) { console.warn("친구 데이터 로드 실패:", e.message); }
}

function saveFriends() {
  try {
    const obj = {};
    for (const [k, set] of friendsMap) if (set.size) obj[k] = [...set];
    const reqs = [];
    for (const [from, set] of friendRequests) for (const to of set) reqs.push([from, to]);
    if (reqs.length) obj["_requests"] = reqs;
    writeStoreFile(friendsJsonPath, obj, "friends");
  } catch (e) { console.warn("친구 데이터 저장 실패:", e.message); }
}

/* 개명 반영 — 친구/신청/길드에 남은 옛 계정 키를 새 키로 치환한다.
   friendsMap은 표시명이 아니라 정규화 키만 저장하므로, 키를 갱신하지 않으면
   목록 조회 시옛 행이 사라져 친구/길드가 튕겨 나간다.
   제재 목록(밴/뮤트)·감시 목록·채팅 이력의 표시명도 함께 개명해
   옛 이름이 화면/조회에 남지 않게 한다 */
function renameAccountRefs(prevKey, newKey, newNick) {
  try {
    const from = normKey(prevKey), to = normKey(newKey);
    if (!from || !to || from === to) return;
    if (friendsMap.has(from)) {
      const set = friendsMap.get(from);
      friendsMap.delete(from);
      const merged = friendsMap.get(to) || new Set();
      for (const k of set) merged.add(k);
      merged.delete(to);
      friendsMap.set(to, merged);
    }
    for (const set of friendsMap.values()) {
      if (set.has(from)) { set.delete(from); set.add(to); }
    }
    if (friendRequests.has(from)) {
      const s = friendRequests.get(from);
      friendRequests.delete(from);
      const m = friendRequests.get(to) || new Set();
      for (const x of s) m.add(x);
      friendRequests.set(to, m);
    }
    for (const set of friendRequests.values()) {
      if (set.has(from)) { set.delete(from); set.add(to); }
    }
    saveFriends();

    /* 제재 목록 — 닉네임 키 기준 조회·표시가 새 이름으로 유지된다.
       (키를 안 옮기면 개명 즉시 뮤트/밴 조회가 끊겨 제재가 무력화된다) */
    let modChanged = false;
    for (const store of [bannedMap, mutedMap]) {
      const entry = store.get(from);
      if (entry) {
        store.delete(from);
        entry.nick = String(newNick || entry.nick);
        store.set(to, entry);
        modChanged = true;
      }
    }
    if (modChanged) saveModeration();

    /* 감시 목록 — 로그인 감시 대상의 표시명을 새 이름으로 교체 */
    let watchChanged = false;
    watchNicks = watchNicks.map(w => {
      if (normKey(w) === from) { watchChanged = true; return String(newNick || w); }
      return w;
    });
    if (watchChanged) saveAdminConfig();

    /* 채팅 이력(전체 + 각 방) — 옛 이름으로 쓴 메시지의 표시명을 새 이름으로 치환 */
    const rewriteFrom = (list) => {
      if (!Array.isArray(list)) return false;
      let hit = false;
      for (const m of list) {
        if (m && normKey(m.from) === from) { m.from = String(newNick || m.from); hit = true; }
      }
      return hit;
    };
    let histChanged = rewriteFrom(GLOBAL_CHAT_HISTORY);
    for (const r of ROOMS.values()) if (rewriteFrom(r.chat)) histChanged = true;
    if (histChanged) scheduleSaveChatHistory();

    if (guildCache) {
      let changed = false;
      for (const g of Object.values(guildCache)) {
        const m = (g.members || []).find(x => x.key === from);
        if (m) { m.key = to; m.nick = String(newNick || m.nick); changed = true; }
        if (g.leader === from) { g.leader = to; g.leaderNick = String(newNick || g.leaderNick); changed = true; }
        /* 주간 점수의 계정 키도 함께 옮긴다 — 개명 후 기여도가 사라지지 않게. */
        if (g.week && g.week.points && g.week.points[from] != null) {
          g.week.points[to] = (Number(g.week.points[to]) || 0) + (Number(g.week.points[from]) || 0);
          delete g.week.points[from];
          changed = true;
        }
        if (g.week && g.week.dailyPoints && g.week.dailyPoints[from] != null) {
          g.week.dailyPoints[to] = (Number(g.week.dailyPoints[to]) || 0) + (Number(g.week.dailyPoints[from]) || 0);
          delete g.week.dailyPoints[from];
          changed = true;
        }
      }
      if (changed) saveGuilds();
    }
  } catch (e) { console.warn("개명 참조 갱신 실패:", e.message); }
}

/* =========================================================
   길드/클랜 — kv_store 'guilds' (PG·JSON 공통 파일 미러)
   shape: { [guildKey]: { key, name, leader, leaderNick, createdAt,
                          members: [{ key, nick, joinedAt }] } }
========================================================= */
const guildsPath = path.join(RUNTIME_DATA_DIR, "guilds.json");
const GUILD_MAX_MEMBERS = 30;
const GUILD_CREATE_COIN = 10000;
let guildCache = null;

function applyGuilds(data) {
  const out = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) {
      const key = normKey(k);
      if (!key || !v || typeof v !== "object") continue;
      const members = (Array.isArray(v.members) ? v.members : [])
        .filter(m => m && typeof m === "object" && normKey(String(m.key || "")))
        .map(m => ({ key: normKey(String(m.key || "")), nick: String(m.nick || m.key || ""), joinedAt: String(m.joinedAt || "") }))
        .filter((m, i, arr) => arr.findIndex(x => x.key === m.key) === i)
        .slice(0, GUILD_MAX_MEMBERS);
      if (!members.length) continue;
      const g = {
        key,
        name: String(v.name || "").trim().slice(0, 12) || k,
        leader: normKey(String(v.leader || "")),
        leaderNick: String(v.leaderNick || ""),
        createdAt: String(v.createdAt || ""),
        members,
        /* 주간 대항전 점수·1:1 대항전 기록은 길드 객체에 함께 영속한다. */
        week: v.week && typeof v.week === "object" ? v.week : null,
        duel: v.duel && typeof v.duel === "object" ? v.duel : null,
        duelWins: v.duelWins,
        duelLosses: v.duelLosses,
        duelDraws: v.duelDraws,
        duelHistory: Array.isArray(v.duelHistory) ? v.duelHistory : []
      };
      if (!members.some(m => m.key === g.leader)) g.leader = members[0].key;
      const leaderMember = members.find(m => m.key === g.leader);
      if (leaderMember) g.leaderNick = leaderMember.nick;
      guildWeek.normalizeGuildWeek(g);
      if (typeof guildDuel !== "undefined") guildDuel.normalizeDuel(g);
      out[key] = g;
    }
  }
  guildCache = out;
  return out;
}

async function loadGuilds() {
  if (guildCache) return guildCache;
  try {
    const data = await loadStoreJSON("guilds", guildsPath, null);
    applyGuilds(data);
  } catch (e) { console.warn("길드 데이터 로드 실패:", e.message); }
  if (!guildCache) guildCache = {};
  return guildCache;
}

function saveGuilds() {
  try {
    if (!guildCache) return;
    writeStoreFile(guildsPath, guildCache, "guilds");
  } catch (e) { console.warn("길드 데이터 저장 실패:", e.message); }
}

/* ---------- 길드 주간 대항전 ---------- */
let guildWeekStore = null;

async function loadGuildWeekStore() {
  const data = await loadStoreJSON("guild-week", GUILD_WEEK_STORE_PATH, null);
  guildWeekStore = {
    lastClosed: data && typeof data.lastClosed === "string" ? data.lastClosed : null,
    history: data && Array.isArray(data.history) ? data.history.slice(-12) : []
  };
  return guildWeekStore;
}
function saveGuildWeekStore() {
  try { writeStoreFile(GUILD_WEEK_STORE_PATH, guildWeekStore, "guild-week"); }
  catch (e) { console.warn("길드 주간 데이터 저장 실패:", e.message); }
}
function getGuildWeekStore() {
  if (!guildWeekStore) guildWeekStore = { lastClosed: null, history: [] };
  return guildWeekStore;
}

function buildGuildWeekBoard(nickname) {
  const weekKey = getKstWeek();
  const nk = normKey(nickname || "");
  const top = guildWeek.guildWeekLeaderboard(guildCache || {}, weekKey, 5);
  const g = nk ? guildOf(nk) : null;
  const currentWeek = !!(g && g.week && g.week.key === weekKey);
  const myRank = g ? guildWeek.guildWeekRank(guildCache, weekKey, g.key) : null;
  return {
    weekKey,
    endsAt: (() => {
      const d = new Date((Date.now() + 9 * 3600 * 1000));
      const day = d.getUTCDay() || 7;
      const mon = new Date(d);
      mon.setUTCDate(d.getUTCDate() - day + 1);
      mon.setUTCHours(0, 0, 0, 0);
      return mon.getTime() + 7 * 86400000 - 9 * 3600 * 1000;
    })(),
    top,
    duel: g && typeof guildDuel !== "undefined" ? guildDuel.duelView(g, guildCache, weekKey) : null,
    myGuild: g ? {
      key: g.key,
      name: g.name,
      points: currentWeek ? guildWeek.guildWeekTotal(g) : 0,
      rank: myRank,
      myPoints: currentWeek ? guildWeek.guildMemberWeekPoints(g, nk) : 0,
      /* 보상은 이번 주에 실제로 점수를 낸 길드원에게만 지급된다. */
      reward: (currentWeek && guildWeek.guildMemberWeekPoints(g, nk) > 0)
        ? guildWeek.guildWeekRewardFor(myRank) : 0
    } : null
  };
}

async function settleGuildDuels(key) {
  try {
    if (guildDuel.ensurePairings(guildCache, key)) saveGuilds();
    const done = new Set();
    for (const g of Object.values(guildCache || {})) {
      if (!g || !g.duel || g.duel.week !== key || g.duel.settled || !g.duel.opponentKey) continue;
      if (done.has(g.key)) continue;
      const opp = guildCache[g.duel.opponentKey];
      if (!opp || !opp.duel || opp.duel.week !== key) {
        g.duel.settled = true;
        continue;
      }
      done.add(g.key);
      done.add(opp.key);
      const base = guildDuel.settleDuel({ weekKey: key, guild: g, opponent: opp });
      const sides = [
        { g, other: opp, result: base.result, my: base.myPoints, their: base.theirPoints },
        { g: opp, other: g, result: base.result === "win" ? "loss" : base.result === "loss" ? "win" : "draw", my: base.theirPoints, their: base.myPoints }
      ];
      for (const side of sides) {
        const amount = guildDuel.duelRewardFor(side.result);
        const members = guildWeek.guildWeekRewardMembers(side.g);
        for (const member of members) {
          try {
            const pd = await getPlayerData(member.key);
            const tx = await beginEconomyTx({
              accountId: member.key,
              idemKey: "guildduel:" + key + ":" + side.g.key + ":" + member.key,
              delta: amount, reason: "guild_duel", ref: side.other.key
            });
            if (!tx.ok) {
              if (!tx.duplicate) console.warn("길드 대항전 보상 실패:", member.key);
              continue;
            }
            if (!tx.duplicate) pd.money = Math.max(0, (Number(pd.money) || 0) + amount);
            try {
              await savePlayerData(member.key, pd);
              await finishEconomyTx(tx, pd.money);
            } catch (e) {
              await abortEconomyTx(tx);
              throw e;
            }
            const resultText = side.result === "win" ? "승리" : side.result === "draw" ? "무승부" : "패배";
            notifyPush(member.key, {
              title: "길드 대항전 보상",
              body: side.g.name + " vs " + side.other.name + " — " + resultText + " +" + amount.toLocaleString() + "코인",
              url: "/", tag: "guildduel:" + key + ":" + side.g.key
            });
          } catch (e) {
            console.error("길드 대항전 보상 오류:", e.message);
          }
        }
        guildDuel.applyDuelRecord(side.g, {
          weekKey: key, result: side.result, myPoints: side.my, theirPoints: side.their,
          opponentKey: side.other.key, opponentName: side.other.name, amount
        });
        if (members.length) {
          const resultText = side.result === "win" ? "승리" : side.result === "draw" ? "무승부" : "패배";
          notifyGuildMembers(side.g, "길드 대항전 vs " + side.other.name + " — " + resultText + " (기여자 +" + amount.toLocaleString() + "코인)", null);
        }
      }
    }
    saveGuilds();
  } catch (e) {
    console.error("길드 대항전 정산 오류:", e.message);
  }
}

/* 주간 정산 — 상위 3개 길드원 전원에게 코인을 1회씩 지급한다.
   idemKey로 재처리/재시작에도 중복 지급되지 않는다. */
async function closeGuildWeek(key) {
  try {
    await loadGuilds();
    const top = guildWeek.guildWeekLeaderboard(guildCache, key, 3);
    let paid = 0;
    let failed = false;
    for (const row of top) {
      const g = guildCache[row.key];
      if (!g) continue;
      const amount = guildWeek.guildWeekRewardFor(row.rank);
      if (!amount) continue;
      /* 가입만 하고 기여하지 않았거나, 주간 종료 직전에 가입한 길드원에게
         보상이 새지 않도록 이번 주 점수를 낸 길드원만 지급한다. */
      const rewardMembers = guildWeek.guildWeekRewardMembers(g);
      for (const member of rewardMembers) {
        try {
          const pd = await getPlayerData(member.key);
          const tx = await beginEconomyTx({
            accountId: member.key,
            idemKey: "guildweek:" + key + ":" + row.key + ":" + member.key,
            delta: amount, reason: "guild_week", ref: key
          });
          if (!tx.ok) {
            if (!tx.duplicate) failed = true;
            continue;
          }
          if (!tx.duplicate) pd.money = Math.max(0, (Number(pd.money) || 0) + amount);
          try {
            await savePlayerData(member.key, pd);
            await finishEconomyTx(tx, pd.money);
            if (!tx.duplicate) paid++;
          } catch (e) {
            await abortEconomyTx(tx);
            throw e;
          }
          notifyPush(member.key, {
            title: "길드 주간 보상",
            body: g.name + " 길드가 주간 대항전 " + row.rank + "위! +" + amount.toLocaleString() + "코인",
            url: "/", tag: "guildweek:" + key
          });
        } catch (e) {
          failed = true;
          console.error("길드 주간 보상 오류:", e.message);
        }
      }
      if (rewardMembers.length) {
        notifyGuildMembers(g, "주간 대항전 " + row.rank + "위! 기여한 길드원에게 +" + amount.toLocaleString() + "코인", null);
      }
    }
    await settleGuildDuels(key);
    /* 일부 지급이 실패하면 마커를 전진시키지 않고 다음 주기에 재시도한다.
       이미 지급된 길드원은 economy_ledger 멱등 키로 중복 지급되지 않는다. */
    if (failed) return false;
    const store = getGuildWeekStore();
    if (!store.history.some(h => h && h.week === key)) {
      store.history.push({ week: key, closedAt: new Date().toISOString(), top });
    }
    store.history = store.history.slice(-12);
    store.lastClosed = key;
    saveGuildWeekStore();
    console.log("[길드 주간 종료] " + key + " — 보상 " + paid + "명");
    return true;
  } catch (e) {
    console.error("길드 주간 종료 처리 오류:", e.message);
    return false;
  }
}

let guildWeekRolloverPromise = null;
async function ensureGuildWeekRollover() {
  /* 동시 마감/보상 중복 실행 방지 — 한 번에 하나만 진행한다. */
  if (guildWeekRolloverPromise) return guildWeekRolloverPromise;
  const task = (async () => {
  const key = getKstWeek();
  const store = getGuildWeekStore();
  if (!store.lastClosed) {
    store.lastClosed = key;
    saveGuildWeekStore();
    return key;
  }
  if (store.lastClosed === key) return key;
  const closed = store.lastClosed;
  const ok = await closeGuildWeek(closed);
  if (!ok) return closed;
  store.lastClosed = key;
  saveGuildWeekStore();
  return key;
  })();
  guildWeekRolloverPromise = task;
  try { return await task; } finally { guildWeekRolloverPromise = null; }
}

/* 랭크/대회 승리 시 길드 주간 점수 적립. 길드가 없으면 아무 것도 하지 않는다. */
async function awardGuildWeekPoints(accountId, points, ref) {
  try {
    const key = normKey(accountId);
    if (!key) return null;
    /* 주가 바뀌는 첫 승리라면 이전 주 정산을 먼저 끝내야 점수가 유실되지 않는다.
       정산이 실패하면 이번 주로 길드를 리셋하지 않고(이전 주 점수 보존) 적립을 건너뛴다. */
    const weekKey = getKstWeek();
    if (getGuildWeekStore().lastClosed !== weekKey) {
      await ensureGuildWeekRollover();
      if (getGuildWeekStore().lastClosed !== weekKey) return { ok: false, reason: "rollover_pending", added: 0 };
    }
    await loadGuilds();
    const g = guildOf(key);
    if (!g) return null;
    const reset = guildWeek.ensureGuildWeek(g, weekKey);
    const result = guildWeek.addGuildWeekContribution(g, {
      memberKey: key, points, now: Date.now(), weekKey
    });
    if (reset || result.ok) saveGuilds();
    if (guildDuel.ensurePairings(guildCache, weekKey)) saveGuilds();
    return result;
  } catch (e) {
    console.warn("길드 주간 점수 오류:", e.message);
    return null;
  }
}

/* 멤버가 속한 길드 찾기 — loadGuilds() 후 호출 */
function guildOf(memberKey) {
  if (!guildCache) return null;
  const nk = normKey(memberKey);
  for (const g of Object.values(guildCache)) {
    if (g.members.some(m => m.key === nk)) return g;
  }
  return null;
}

/* 길드 상태 — 내 계정 기준 (가입 여부·리더 여부·멤버 온라인) */
function buildGuildState(nickname) {
  const nk = normKey(nickname);
  const g = guildOf(nk);
  const weekly = buildGuildWeekBoard(nickname);
  if (!g) return { ok: true, guild: null, weekly };
  return {
    ok: true,
    weekly,
    guild: {
      key: g.key,
      name: g.name,
      leader: g.leaderNick || g.leader,
      leaderKey: g.leader,
      isLeader: g.leader === nk,
      createdAt: g.createdAt,
      memberCount: g.members.length,
      maxMembers: GUILD_MAX_MEMBERS,
      members: g.members.map(m => ({
        nick: m.nick,
        key: m.key,
        leader: m.key === g.leader,
        online: onlineNicks.has(m.key),
        joinedAt: m.joinedAt
      }))
    }
  };
}

/* 길드원 전체 알림 — exceptKey는 발신자(본인 제외) */
function notifyGuildMembers(guild, text, exceptKey) {
  if (!guild) return;
  for (const m of guild.members) {
    if (exceptKey && m.key === exceptKey) continue;
    const sid = onlineNicks.get(m.key);
    const s = sid ? io.sockets.sockets.get(sid) : null;
    if (s) s.emit("guild:notice", { text, guild: guild.name });
  }
}

function registerOnline(socketId, nickname) {
  const key = normKey(nickname);
  if (!key) return;
  unregisterOnline(socketId);
  onlineNicks.set(key, socketId);
  socketNicks.set(socketId, nickname);
}

function unregisterOnline(socketId) {
  socketNicks.delete(socketId);
  for (const [k, v] of onlineNicks) if (v === socketId) onlineNicks.delete(k);
}

async function nicknameKnown(nickname) {
  const key = normKey(nickname);
  if (!key) return false;
  /* PG 모드는 playerCache에 아직 올라오지 않은 오프라인 계정도 있으므로 DB에서 찾는다.
     계정 키(id)는 닉네임 정규화 값이므로 id 조회로 충분하다. */
  if (dbMode === "pg" && dbPool) {
    try {
      const r = await dbPool.query("SELECT 1 FROM players WHERE id = $1 LIMIT 1", [key]);
      return r.rows.length > 0;
    } catch (e) {
      console.error("닉네임 조회 오류:", e.message);
      return false;
    }
  }
  for (const p of playerCache.values()) {
    if (normKey(p?.nickname) === key) return true;
  }
  return false;
}

/* 정규화 키 → 실제 표시 닉네임 (케이스 보존). 기록이 없으면 원래 키 그대로 반환 */
function nicknameDisplay(key) {
  const k = normKey(key);
  if (!k) return key || "";
  for (const p of playerCache.values()) {
    if (p && p.nickname && normKey(p.nickname) === k) return p.nickname;
  }
  return key || "";
}

function saveJsonDb() {
  try {
    const obj = {};
    for (const [k, v] of playerCache) obj[k] = v;
    /* 쓰기 직전 이전 내용을 .bak으로 회전 — 유실 시 loadJsonDb가 복원 */
    if (fs.existsSync(jsonPath)) {
      try { fs.copyFileSync(jsonPath, `${jsonPath}.bak`); } catch (e) { /* 무시 */ }
    }
    fs.writeFileSync(jsonPath, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn("JSON DB 저장 실패:", e.message);
    throw e;
  }
}

async function initDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    /* DB가 잠깐 응답하지 않는다고 JSON 파일 모드로 내려가면, 영속 디스크가 없는
       배포에서는 기존 기록이 사라진 것처럼 보이고 그 사이 쓰기는 다음 배포에서
       유실된다. 그래서 재시도하고, 그래도 실패하면 조용히 강등하지 않고 알린다. */
    const attempts = Math.max(1, Number(process.env.DB_CONNECT_ATTEMPTS) || 5);
    const retryMs = Math.max(200, Number(process.env.DB_CONNECT_RETRY_MS) || 2000);
    let lastErr = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const { Pool } = require("pg");
        /* PostgreSQL/Neon URLs carry their own TLS settings (e.g. sslmode=require).
           Do not disable certificate verification with an explicit SSL override. */
        dbPool = new Pool({ connectionString: databaseUrl });
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY,
            nickname TEXT DEFAULT '플레이어',
            rating INTEGER DEFAULT 1000,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            streak INTEGER DEFAULT 0,
            best_streak INTEGER DEFAULT 0,
            ranked_rating INTEGER DEFAULT 1000,
            ranked_wins INTEGER DEFAULT 0,
            ranked_losses INTEGER DEFAULT 0,
            ranked_streak INTEGER DEFAULT 0,
            ranked_best_streak INTEGER DEFAULT 0,
            money INTEGER DEFAULT 0,
            money_multiplier INTEGER DEFAULT 1,
            rating_boost_games INTEGER DEFAULT 0,
            titles TEXT DEFAULT '[]',
            current_title TEXT DEFAULT '',
            last_check_date TEXT DEFAULT '',
            attendance_streak INTEGER DEFAULT 0,
            recent_games TEXT DEFAULT '[]',
            daily TEXT DEFAULT '{}',
            weekly TEXT DEFAULT '{}',
            monthly TEXT DEFAULT '{}',
            single_rating INTEGER DEFAULT 1000,
            single_wins INTEGER DEFAULT 0,
            single_losses INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            season TEXT DEFAULT '{}',
            firebase_uid TEXT DEFAULT NULL,
            firebase_email TEXT DEFAULT '',
            firebase_name TEXT DEFAULT '',
            shield_tickets INTEGER DEFAULT 0,
            rating_history TEXT DEFAULT '[]',
            last_seen TEXT DEFAULT '',
            extras TEXT DEFAULT '{}'
          )
        `);
        await dbPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_firebase_uid ON players(firebase_uid)`);
        await dbPool.query(`
          ALTER TABLE players
            ADD COLUMN IF NOT EXISTS single_rating INTEGER DEFAULT 1000,
            ADD COLUMN IF NOT EXISTS single_wins INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS single_losses INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS best_streak INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS ranked_rating INTEGER DEFAULT 1000,
            ADD COLUMN IF NOT EXISTS ranked_wins INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS ranked_losses INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS ranked_streak INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS ranked_best_streak INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS money INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS money_multiplier INTEGER DEFAULT 1,
            ADD COLUMN IF NOT EXISTS rating_boost_games INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS titles TEXT DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS current_title TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS last_check_date TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS attendance_streak INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS recent_games TEXT DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS daily TEXT DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS weekly TEXT DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS monthly TEXT DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS season TEXT DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS firebase_uid TEXT DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS firebase_email TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS firebase_name TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS shield_tickets INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS rating_history TEXT DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS last_seen TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS extras TEXT DEFAULT '{}'
        `);
        await dbPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_firebase_uid ON players(firebase_uid)`);
        /* 보조 저장소(친구/시즌/관리자 설정/커스텀 사전/버그 제보) — 재배포에도 유지 */
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        /* 코인 원장 — 지급/차감을 기록하고 idem_key로 중복 지급을 막는다 */
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS economy_ledger (
            id BIGSERIAL PRIMARY KEY,
            idem_key TEXT UNIQUE NOT NULL,
            account_id TEXT NOT NULL,
            delta BIGINT NOT NULL,
            balance_after BIGINT,
            reason TEXT NOT NULL,
            ref TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_economy_ledger_account ON economy_ledger(account_id, created_at DESC)`);
        dbMode = "pg";
        console.log("데이터베이스: PostgreSQL 연결 완료");
        return;
      } catch (err) {
        lastErr = err;
        if (dbPool) { try { await dbPool.end(); } catch (e) { /* 무시 */ } dbPool = null; }
        console.warn(`PostgreSQL 연결 실패 (${attempt}/${attempts}):`, err.message);
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, retryMs));
      }
    }
    if (String(process.env.ALLOW_JSON_FALLBACK || "") !== "1") {
      throw Object.assign(
        new Error(`PostgreSQL 연결에 실패했습니다 (${attempts}회 재시도): ${lastErr ? lastErr.message : "알 수 없는 이유"}`),
        { code: "DB_UNAVAILABLE" }
      );
    }
    console.warn("ALLOW_JSON_FALLBACK=1 — PostgreSQL 없이 JSON 파일 모드로 시작합니다. 재배포 시 데이터가 유실될 수 있습니다.");
  }
  dbMode = "json";
  loadJsonDb();
  console.log("데이터베이스: JSON 파일 모드");
}

/* =========================================================
   Firebase — Google 로그인(ID 토큰 검증) + Firestore 점수/순위
   · FIREBASE_SERVICE_ACCOUNT(서비스 계정 JSON 또는 base64)가 있으면 활성화
   · 없으면 조용히 비활성화되어 기존 기능/부팅에 영향이 없다
======================================================== */
let firebaseAuth = null;
let firebaseDb = null;
let firebaseReady = false;
const firebaseDirty = new Set();

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.log("Firebase: FIREBASE_SERVICE_ACCOUNT 미설정 — 로그인/파이어 랭킹 비활성");
    return;
  }
  try {
    let text = String(raw).trim();
    if (!text.startsWith("{")) text = Buffer.from(text, "base64").toString("utf8");
    const sa = JSON.parse(text);
    const { initializeApp, cert, getApps } = require("firebase-admin/app");
    const { getAuth } = require("firebase-admin/auth");
    const { getFirestore } = require("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(sa) });
    firebaseAuth = getAuth(app);
    firebaseDb = getFirestore(app);
    firebaseReady = true;
    console.log(`Firebase 초기화 완료 — 프로젝트: ${sa.project_id || "(알 수 없음)"}`);
  } catch (err) {
    firebaseReady = false;
    console.error("Firebase 초기화 실패:", err.message);
  }
}

/* 점수 변경 시 Firestore에 반영할 플레이어를 표시하고, 짧게 모아서 배치 반영한다.
   (매 저장마다 쓰면 과금/지연이 커지므로 dirty-set + 주기 flush) */
function markFirebaseDirty(key) {
  if (!firebaseReady || !key) return;
  firebaseDirty.add(key);
}

async function flushFirebaseScores() {
  if (!firebaseReady || firebaseDirty.size === 0) return;
  const { FieldValue } = require("firebase-admin/firestore");
  const keys = Array.from(firebaseDirty);
  firebaseDirty.clear();
  for (const key of keys) {
    const p = playerCache.get(key);
    if (!p) continue;
    try {
      await firebaseDb.collection("leaderboards").doc(key).set({
        nickname: p.nickname || "플레이어",
        multi: {
          rating: Number(p.multi?.rating) || 1000,
          wins: Number(p.multi?.wins) || 0,
          losses: Number(p.multi?.losses) || 0,
          streak: Number(p.multi?.streak) || 0,
          bestStreak: Number(p.multi?.bestStreak) || 0
        },
        ranked: {
          rating: Number(p.ranked?.rating) || 1000,
          wins: Number(p.ranked?.wins) || 0,
          losses: Number(p.ranked?.losses) || 0,
          streak: Number(p.ranked?.streak) || 0,
          bestStreak: Number(p.ranked?.bestStreak) || 0
        },
        single: {
          rating: Number(p.single?.rating) || 1000,
          wins: Number(p.single?.wins) || 0,
          losses: Number(p.single?.losses) || 0
        },
        money: Math.max(0, Math.floor(Number(p.money) || 0)),
        firebaseUid: p.firebaseUid || "",
        email: p.firebaseEmail || p.email || "",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error("Firebase 점수 동기화 실패:", key, err.message);
    }
  }
}
setInterval(() => { flushFirebaseScores().catch(() => {}); }, 20000);

async function verifyFirebaseIdToken(idToken) {
  if (!firebaseReady || !firebaseAuth) throw new Error("firebase_not_configured");
  return firebaseAuth.verifyIdToken(String(idToken || ""));
}

const MODE_DEFAULT = { rating: 1000, wins: 0, losses: 0, streak: 0, bestStreak: 0 };
const SEASON_DEFAULT = { rating: 1000, wins: 0, losses: 0, games: 0, streak: 0, bestStreak: 0 };

function migratePlayerData(p) {
  p.single = Object.assign({ ...MODE_DEFAULT }, p.single || {});
  p.multi = Object.assign({ ...MODE_DEFAULT }, p.multi || {});
  p.ranked = Object.assign({ ...MODE_DEFAULT }, p.ranked || {});
  p.season = Object.assign({ ...SEASON_DEFAULT }, p.season && typeof p.season === "object" ? p.season : {});
  /* Firebase 연결 — 문자열이 아니면 버린다. PG/JSON에 그대로 영속된다 */
  p.firebaseUid = typeof p.firebaseUid === "string" ? p.firebaseUid : "";
  p.firebaseEmail = typeof p.firebaseEmail === "string" ? p.firebaseEmail : "";
  p.firebaseName = typeof p.firebaseName === "string" ? p.firebaseName : "";
  p.ranked.streak = Number.isFinite(p.ranked.streak) ? Math.max(0, Math.floor(p.ranked.streak)) : 0;
  p.ranked.bestStreak = Number.isFinite(p.ranked.bestStreak) ? Math.max(0, Math.floor(p.ranked.bestStreak)) : 0;
  /* 시즌 소프트 리셋/배치고사 — 기존 계정은 0(배치 없음)으로 시작한다. */
  p.ranked.placementGamesLeft = Math.max(0, Math.min(rankSeason.PLACEMENT_GAMES,
    Number.isFinite(p.ranked.placementGamesLeft) ? Math.floor(p.ranked.placementGamesLeft) : 0));
  p.ranked.placementSeason = typeof p.ranked.placementSeason === "string" ? p.ranked.placementSeason : "";
  p.ranked.lastResetSeason = typeof p.ranked.lastResetSeason === "string" ? p.ranked.lastResetSeason : "";
  if (typeof p.money !== "number" || !Number.isFinite(p.money)) p.money = typeof p.money === "number" ? Math.max(0, p.money) : 0;
  p.money = Math.max(0, Math.floor(p.money));
  if (!Number.isFinite(p.moneyMultiplier) || p.moneyMultiplier < 1) p.moneyMultiplier = 1;
  p.moneyMultiplier = Math.min(99, Math.floor(p.moneyMultiplier));
  if (!Number.isFinite(p.ratingBoostGames) || p.ratingBoostGames < 0) p.ratingBoostGames = 0;
  p.ratingBoostGames = Math.floor(p.ratingBoostGames);
  /* 이름 변경 횟수 — 0회=무료, 1회차 이후부터 회당 RENAME_PRICE */
  if (!Number.isFinite(p.nameChanges) || p.nameChanges < 0) p.nameChanges = 0;
  p.nameChanges = Math.floor(p.nameChanges);
  if (!Array.isArray(p.titles)) p.titles = [];
  p.currentTitle = typeof p.currentTitle === "string" ? p.currentTitle : "";
  p.lastCheckDate = typeof p.lastCheckDate === "string" ? p.lastCheckDate : "";
  p.attendanceStreak = Number.isFinite(p.attendanceStreak) ? Math.max(0, Math.floor(p.attendanceStreak)) : 0;
  if (!Array.isArray(p.recentGames)) p.recentGames = [];
  else p.recentGames = p.recentGames.slice(-10).filter(g => g && typeof g === "object");
  /* 단어장은 migratePlayerData만 따로 평가하는 테스트가 있어 외부 모듈 없이 정리한다. */
  if (!Array.isArray(p.wordbook)) p.wordbook = [];
  else {
    const seenWords = new Set();
    p.wordbook = p.wordbook.filter(item => {
      const word = String(item && item.word || "").replace(/\s+/g, "").trim().slice(0, 30);
      if (!word || seenWords.has(word)) return false;
      seenWords.add(word);
      return true;
    }).slice(0, 300).map(item => ({
      word: String(item.word || "").replace(/\s+/g, "").trim().slice(0, 30),
      at: String(item.at || "").slice(0, 40)
    }));
  }
  p.shieldTickets = Number.isFinite(p.shieldTickets) ? Math.max(0, Math.floor(p.shieldTickets)) : 0;
  if (!Array.isArray(p.ratingHistory)) p.ratingHistory = [];
  else p.ratingHistory = p.ratingHistory.slice(-60).filter(e => e && typeof e === "object" && Number.isFinite(Number(e.r)));
  p.lastSeen = typeof p.lastSeen === "string" ? p.lastSeen : "";
  p.recoveryHash = typeof p.recoveryHash === "string" ? p.recoveryHash.slice(0, 128) : "";
  p.recoveryAt = typeof p.recoveryAt === "string" ? p.recoveryAt : "";
  p.daily = initDailyData(p.daily, getKstDate());
  p.weekly = initWeeklyData(p.weekly, getKstWeek());
  p.monthly = initMonthlyData(p.monthly, getKstMonth());
  if (!p.season || typeof p.season !== "object") p.season = null;
  else p.season = {
    season: String(p.season.season || ""),
    games: Math.max(0, Math.floor(Number(p.season.games) || 0)),
    rating: Math.max(0, Math.floor(Number(p.season.rating) || 1000)),
    wins: Math.max(0, Math.floor(Number(p.season.wins) || 0)),
    losses: Math.max(0, Math.floor(Number(p.season.losses) || 0)),
    bestStreak: Math.max(0, Math.floor(Number(p.season.bestStreak) || 0))
  };
  return p;
}

/* 소켓 ID를 닉네임 정규화 키로 변환 — 닉네임이 곧 계정 키다.
   닉네임 미설정 소켓은 원래 ID를 그대로 쓴다(고스트로는 영속되지 않는다). */
function resolvePlayerId(playerId) {
  const nm = socketNicks.get(playerId);
  return nm ? normKey(nm) : playerId;
}

/* 표시 이름 원자적 선점 — 같은 이름을 두 계정이 동시에 가져가지 못하게 한다.
   PG: 조건부 UPDATE + rowCount로 원자적 판정. JSON: 단일 스레드에서 확인 후 기록.
   반환: { ok:true, key } 또는 { ok:false, reason } */
async function claimDisplayName(uid, nickname) {
  const key = normKey(nickname);
  if (!key) return { ok: false, reason: "이름을 입력해주세요." };
  if (dbMode === "pg") {
    try {
      const cur = await dbPool.query("SELECT id, nickname, firebase_uid FROM players WHERE id = $1", [key]);
      if (cur.rows.length === 0) return { ok: true, key, fresh: true };
      const rowUid = String(cur.rows[0].firebase_uid || "");
      if (rowUid && rowUid !== String(uid || "")) {
        return { ok: false, reason: "이미 사용 중인 이름입니다." };
      }
      if (!rowUid && uid) {
        const upd = await dbPool.query(
          "UPDATE players SET firebase_uid = $2, updated_at = NOW() WHERE id = $1 AND (firebase_uid IS NULL OR firebase_uid = $2)",
          [key, String(uid)]
        );
        if (upd.rowCount === 0) return { ok: false, reason: "이미 사용 중인 이름입니다." };
        playerCache.delete(key);
      }
      return { ok: true, key };
    } catch (err) {
      if (String(err.code) === "23505") return { ok: false, reason: "이미 사용 중인 이름입니다." };
      throw err;
    }
  }
  const cached = playerCache.get(key);
  if (cached) {
    const rowUid = String(cached.firebaseUid || "");
    const isReal = !!(cached.nickname && normKey(cached.nickname) === key);
    if (isReal && rowUid && rowUid !== String(uid || "")) {
      return { ok: false, reason: "이미 사용 중인 이름입니다." };
    }
  }
  return { ok: true, key };
}

/* 관리자 여부 — 검증된 Firebase 이메일이 allowlist에 있을 때만 true.
   닉네임·타이틀·localStorage 값은 절대 근거가 되지 않는다 */
function isAdminSocket(socket) {
  const authed = adminAuthed.get(socket.id);
  return !!(authed && authed.role === "super" && isAdminEmail(authed.email));
}

async function getPlayerData(playerId) {
  const key = resolvePlayerId(playerId);
  if (playerCache.has(key)) return migratePlayerData(structuredClone(playerCache.get(key)));
  if (dbMode === "pg") {
    try {
      const result = await dbPool.query("SELECT * FROM players WHERE id = $1", [key]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        const data = {
          id: row.id,
          nickname: row.nickname,
          multi: { rating: row.rating, wins: row.wins, losses: row.losses, streak: row.streak, bestStreak: row.best_streak },
          single: { rating: row.single_rating, wins: row.single_wins, losses: row.single_losses },
          ranked: { rating: row.ranked_rating, wins: row.ranked_wins, losses: row.ranked_losses, streak: row.ranked_streak, bestStreak: row.ranked_best_streak },
          money: row.money,
          moneyMultiplier: row.money_multiplier,
          ratingBoostGames: row.rating_boost_games,
          titles: (() => { try { return JSON.parse(row.titles || "[]"); } catch { return []; } })(),
          currentTitle: row.current_title || "",
          lastCheckDate: row.last_check_date || "",
          attendanceStreak: row.attendance_streak || 0,
          recentGames: (() => { try { return JSON.parse(row.recent_games || "[]"); } catch { return []; } })(),
          daily: (() => { try { return JSON.parse(row.daily || "{}"); } catch { return {}; } })(),
          weekly: (() => { try { return JSON.parse(row.weekly || "{}"); } catch { return {}; } })(),
          monthly: (() => { try { return JSON.parse(row.monthly || "{}"); } catch { return {}; } })(),
          season: (() => { try { const v = JSON.parse(row.season || "null"); return v && typeof v === "object" ? v : null; } catch { return null; } })(),
          firebaseUid: row.firebase_uid || "",
          firebaseEmail: row.firebase_email || "",
          firebaseName: row.firebase_name || "",
          shieldTickets: row.shield_tickets || 0,
          ratingHistory: (() => { try { return JSON.parse(row.rating_history || "[]"); } catch { return []; } })(),
          lastSeen: row.last_seen || ""
        };
        /* 컬럼이 아닌 부가 필드(업적/추천인/쪽지 등) 병합 — 없으면 무시 */
        try {
          const extras = JSON.parse(row.extras || "{}");
          if (extras && typeof extras === "object") {
            Object.assign(data, extras);
            if (data.ranked && extras.rankedPlacement && typeof extras.rankedPlacement === "object") {
              Object.assign(data.ranked, extras.rankedPlacement);
            }
          }
        } catch { /* 손상된 extras는 무시 */ }
        const migrated = migratePlayerData(data);
        playerCache.set(key, migrated);
        return structuredClone(migrated);
      }
    } catch (err) {
      console.error("DB 읽기 오류:", err.message);
      throw err; // DB 장애를 신규 계정으로 오인해 기존 기록을 덮어쓰지 않는다.
    }
  }
  /* 이름 없는 소켓 기본값 — 고스트를 캐시에 쌓지 않는다 (랭킹 초기화/중복의 원인이었음) */
  const defaultData = migratePlayerData({ id: key, nickname: "플레이어" });
  return { ...defaultData };
}

/* 컬럼형 필드가 아닌 부가 데이터(업적/추천인/쪽지 등) — extras JSON 컬럼에 영속 */
const PLAYER_COLUMN_KEYS = new Set(["id","nickname","multi","single","ranked","money","moneyMultiplier","ratingBoostGames","titles","currentTitle","lastCheckDate","attendanceStreak","recentGames","shieldTickets","ratingHistory","lastSeen","daily","weekly","monthly","season","firebaseUid","firebaseEmail","firebaseName"]);
function playerExtras(safe) {
  const out = {};
  for (const k of Object.keys(safe)) {
    if (PLAYER_COLUMN_KEYS.has(k)) continue;
    if (safe[k] === undefined) continue;
    out[k] = safe[k];
  }
  /* ranked 안의 배치 메타데이터는 컬럼이 아니므로 extras에 함께 보존한다. */
  if (safe.ranked && typeof safe.ranked === "object") {
    out.rankedPlacement = {
      placementGamesLeft: safe.ranked.placementGamesLeft,
      placementSeason: safe.ranked.placementSeason,
      lastResetSeason: safe.ranked.lastResetSeason
    };
  }
  return out;
}

async function savePlayerData(playerId, data) {
  const safe = migratePlayerData(structuredClone(data));
  const nk = normKey(String(safe.nickname || "").trim());
  const hasRealNick = nk.length > 0 && nk !== normKey("플레이어");
  /* 저장 키는 닉네임(계정) 키를 우선 — 소켓 ID와 무관하게 한 명당 한 레코드 */
  let key = hasRealNick ? nk : (socketNicks.has(playerId) ? normKey(socketNicks.get(playerId)) : playerId);
  safe.id = key;
  if (!hasRealNick) return;   /* 이름 없는 고스트 소켓은 영속하지 않는다 */
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  const rankedStreak = Math.max(0, Math.floor(num(data.ranked && data.ranked.streak, 0)));
  const rankedBestStreak = Math.max(0, Math.floor(num(data.ranked && data.ranked.bestStreak, 0)));
  const modeCore = (m) => ({
    rating: num(m.rating, 1000),
    wins: Math.max(0, num(m.wins, 0)),
    losses: Math.max(0, num(m.losses, 0)),
    streak: Math.max(0, Math.floor(num(m.streak, 0))),
    bestStreak: Math.max(0, Math.floor(num(m.bestStreak, 0)))
  });
  safe.single = modeCore(safe.single);
  safe.multi = modeCore(safe.multi);
  const rankedMeta = {
    placementGamesLeft: Math.max(0, Math.min(rankSeason.PLACEMENT_GAMES,
      Number.isFinite(Number(safe.ranked.placementGamesLeft)) ? Math.floor(Number(safe.ranked.placementGamesLeft)) : 0)),
    placementSeason: typeof safe.ranked.placementSeason === "string" ? safe.ranked.placementSeason : "",
    lastResetSeason: typeof safe.ranked.lastResetSeason === "string" ? safe.ranked.lastResetSeason : ""
  };
  safe.ranked = modeCore(safe.ranked);
  safe.ranked.streak = rankedStreak;
  safe.ranked.bestStreak = rankedBestStreak;
  Object.assign(safe.ranked, rankedMeta);
  safe.money = Math.max(0, Math.floor(num(safe.money, 0)));
  safe.moneyMultiplier = Math.min(99, Math.max(1, Math.floor(num(safe.moneyMultiplier, 1))));
  safe.ratingBoostGames = Math.max(0, Math.floor(num(safe.ratingBoostGames, 0)));
  safe.titles = Array.isArray(safe.titles) ? safe.titles.filter(t => t && typeof t === "object") : [];
  safe.currentTitle = typeof safe.currentTitle === "string" ? safe.currentTitle : "";
  safe.lastCheckDate = typeof safe.lastCheckDate === "string" ? safe.lastCheckDate : "";
  safe.attendanceStreak = Math.max(0, Math.floor(num(safe.attendanceStreak, 0)));
  safe.recentGames = Array.isArray(safe.recentGames) ? safe.recentGames.slice(-10).filter(g => g && typeof g === "object") : [];
  safe.shieldTickets = Math.max(0, Math.floor(num(safe.shieldTickets, 0)));
  safe.ratingHistory = Array.isArray(safe.ratingHistory) ? safe.ratingHistory.slice(-60).filter(e => e && typeof e === "object") : [];
  safe.lastSeen = typeof safe.lastSeen === "string" ? safe.lastSeen : "";
  safe.daily = initDailyData(safe.daily, getKstDate());
  safe.weekly = initWeeklyData(safe.weekly, getKstWeek());
  safe.monthly = initMonthlyData(safe.monthly, getKstMonth());
  if (dbMode === "pg") {
    try {
      await dbPool.query(`
        INSERT INTO players
          (id, nickname, rating, wins, losses, streak, best_streak,
           single_rating, single_wins, single_losses,
           ranked_rating, ranked_wins, ranked_losses, ranked_streak, ranked_best_streak,
           money, money_multiplier, rating_boost_games,
           titles, current_title, last_check_date, attendance_streak,
           recent_games, daily, weekly, monthly, season,
           firebase_uid, firebase_email, firebase_name, shield_tickets, rating_history, last_seen, extras, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW())
        ON CONFLICT (id) DO UPDATE SET
          nickname=$2, rating=$3, wins=$4, losses=$5,
          streak=$6, best_streak=$7,
          single_rating=$8, single_wins=$9, single_losses=$10,
          ranked_rating=$11, ranked_wins=$12, ranked_losses=$13,
          ranked_streak=$14, ranked_best_streak=$15,
          money=$16, money_multiplier=$17, rating_boost_games=$18,
          titles=$19, current_title=$20, last_check_date=$21, attendance_streak=$22,
          recent_games=$23, daily=$24, weekly=$25, monthly=$26, season=$27,
          firebase_uid=$28, firebase_email=$29, firebase_name=$30,
          shield_tickets=$31, rating_history=$32, last_seen=$33, extras=$34, updated_at=NOW()
      `, [
        key, safe.nickname || "플레이어",
        safe.multi.rating, safe.multi.wins, safe.multi.losses,
        safe.multi.streak, safe.multi.bestStreak,
        safe.single.rating, safe.single.wins, safe.single.losses,
        safe.ranked.rating, safe.ranked.wins, safe.ranked.losses,
        safe.ranked.streak, safe.ranked.bestStreak,
        safe.money, safe.moneyMultiplier, safe.ratingBoostGames,
        JSON.stringify(safe.titles), safe.currentTitle,
        safe.lastCheckDate, safe.attendanceStreak,
        JSON.stringify(safe.recentGames), JSON.stringify(safe.daily),
        JSON.stringify(safe.weekly), JSON.stringify(safe.monthly),
        JSON.stringify(safe.season || {}),
        safe.firebaseUid || null, safe.firebaseEmail || "", safe.firebaseName || "",
        safe.shieldTickets, JSON.stringify(safe.ratingHistory), safe.lastSeen,
        JSON.stringify(playerExtras(safe))
      ]);
    } catch (err) {
      console.error("DB 쓰기 오류:", err.message);
      throw err; // 이관/보상 호출자가 실패를 알아야 완료 처리하지 않는다.
    }
  }
  const previous = playerCache.get(key);
  playerCache.set(key, safe);
  if (dbMode !== "pg") {
    try {
      saveJsonDb();
    } catch (err) {
      if (previous) playerCache.set(key, previous);
      else playerCache.delete(key);
      throw err;
    }
  }
  /* Firebase 연동 시 Firestore 리더보드에도 점수를 반영하도록 표시 (저장 성공 후).
     격리 VM 테스트 하네스에는 이 함수가 없으므로 방어적으로 존재 여부를 확인한다. */
  if (typeof markFirebaseDirty === "function") markFirebaseDirty(key);
  if (key !== playerId && playerCache.has(playerId)) playerCache.delete(playerId);
}

/* =========================================================
   코인 원장
   - 지급/차감 전에 idem_key를 원장에 선점해 같은 요청의 중복 지급을 막는다.
   - PG 모드에서는 UNIQUE(idem_key)로 다중 인스턴스에서도 1회만 통과한다.
   - JSON/테스트 모드에서는 프로세스 메모리로 동일하게 막는다.
========================================================= */
const ECONOMY_MEMORY = [];
const ECONOMY_IDEM = new Set();
const ECONOMY_MAX_MEMORY = 500;

async function beginEconomyTx({ accountId, idemKey, delta, reason, ref = "" }) {
  const key = String(idemKey || "").trim().slice(0, 180);
  const account = String(accountId || "").trim().slice(0, 80);
  if (!key || !account) return { ok: false, reason: "원장 키가 없습니다." };
  const amount = Math.trunc(Number(delta) || 0);
  const why = String(reason || "reward").slice(0, 40);
  const reference = String(ref || "").slice(0, 160);
  if (dbMode === "pg" && dbPool) {
    try {
      const r = await dbPool.query(
        `INSERT INTO economy_ledger (idem_key, account_id, delta, reason, ref)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idem_key) DO NOTHING
         RETURNING id`,
        [key, account, amount, why, reference]
      );
      if (!r.rows.length) return { ok: false, duplicate: true, key };
      return { ok: true, key, id: r.rows[0].id };
    } catch (err) {
      console.error("코인 원장 기록 오류:", err.message);
      return { ok: false, reason: "보상 기록에 실패했습니다." };
    }
  }
  if (ECONOMY_IDEM.has(key)) return { ok: false, duplicate: true, key };
  ECONOMY_IDEM.add(key);
  const row = {
    idemKey: key, accountId: account, delta: amount, reason: why,
    ref: reference, at: new Date().toISOString(), balanceAfter: null
  };
  ECONOMY_MEMORY.push(row);
  if (ECONOMY_MEMORY.length > ECONOMY_MAX_MEMORY) {
    ECONOMY_MEMORY.splice(0, ECONOMY_MEMORY.length - ECONOMY_MAX_MEMORY);
  }
  return { ok: true, key, row };
}

async function finishEconomyTx(tx, balanceAfter) {
  if (!tx || !tx.ok) return;
  const bal = Math.max(0, Math.floor(Number(balanceAfter) || 0));
  if (tx.id != null && dbMode === "pg" && dbPool) {
    try { await dbPool.query("UPDATE economy_ledger SET balance_after = $2 WHERE id = $1", [tx.id, bal]); }
    catch (e) { console.warn("코인 원장 잔액 갱신 실패:", e.message); }
    return;
  }
  if (tx.row) tx.row.balanceAfter = bal;
}

async function abortEconomyTx(tx) {
  if (!tx || !tx.ok) return;
  if (tx.id != null && dbMode === "pg" && dbPool) {
    try { await dbPool.query("DELETE FROM economy_ledger WHERE id = $1", [tx.id]); }
    catch (e) { console.warn("코인 원장 롤백 실패:", e.message); }
    return;
  }
  if (tx.key) ECONOMY_IDEM.delete(tx.key);
  const idx = ECONOMY_MEMORY.findIndex(r => r.idemKey === tx.key);
  if (idx >= 0) ECONOMY_MEMORY.splice(idx, 1);
}

async function getEconomyHistory(accountId, limit = 20) {
  const account = String(accountId || "").trim();
  const max = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
  if (!account) return [];
  if (dbMode === "pg" && dbPool) {
    try {
      const r = await dbPool.query(
        `SELECT delta, balance_after, reason, ref, created_at
         FROM economy_ledger WHERE account_id = $1
         ORDER BY id DESC LIMIT $2`,
        [account, max]
      );
      return r.rows.map(x => ({
        delta: Number(x.delta) || 0,
        balanceAfter: x.balance_after == null ? null : Number(x.balance_after),
        reason: x.reason,
        ref: x.ref,
        at: x.created_at ? new Date(x.created_at).toISOString() : ""
      }));
    } catch (e) {
      console.warn("코인 내역 조회 실패:", e.message);
      return [];
    }
  }
  return ECONOMY_MEMORY.filter(r => r.accountId === account)
    .slice(-max).reverse()
    .map(r => ({ delta: r.delta, balanceAfter: r.balanceAfter, reason: r.reason, ref: r.ref, at: r.at }));
}

/* 개명 시 원장 계정 키도 함께 옮겨 코인 내역이 끊기지 않게 한다 */
async function renameEconomyAccount(prevKey, newKey) {
  const from = normKey(prevKey), to = normKey(newKey);
  if (!from || !to || from === to) return;
  if (dbMode === "pg" && dbPool) {
    try { await dbPool.query("UPDATE economy_ledger SET account_id = $1 WHERE account_id = $2", [to, from]); }
    catch (e) { console.warn("코인 원장 계정 이전 실패:", e.message); }
    return;
  }
  for (const row of ECONOMY_MEMORY) if (row.accountId === from) row.accountId = to;
}

/* 최근 코인 수입/지출 요약 — KST 기준 오늘/최근 7일 (원장 화면 상단용) */
async function getEconomySummary(accountId) {
  const account = String(accountId || "").trim();
  const empty = () => ({ income: 0, expense: 0, net: 0, count: 0 });
  if (!account) return { today: empty(), week: empty() };
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const todayStart = Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - 9 * 3600 * 1000;
  const weekStart = todayStart - 6 * 86400000;
  let rows = [];
  if (dbMode === "pg" && dbPool) {
    try {
      const r = await dbPool.query(
        `SELECT delta, EXTRACT(EPOCH FROM created_at) * 1000 AS at_ms
         FROM economy_ledger
         WHERE account_id = $1 AND created_at >= NOW() - interval '8 days'`,
        [account]
      );
      rows = r.rows.map(x => ({ delta: Number(x.delta) || 0, at: Number(x.at_ms) || 0 }));
    } catch (e) {
      console.warn("코인 요약 조회 실패:", e.message);
      return { today: empty(), week: empty() };
    }
  } else {
    rows = ECONOMY_MEMORY
      .filter(r => r.accountId === account)
      .map(r => ({ delta: Number(r.delta) || 0, at: Date.parse(r.at) || 0 }));
  }
  const calc = (since) => {
    const out = empty();
    for (const row of rows) {
      if (row.at < since) continue;
      out.count++;
      if (row.delta > 0) out.income += row.delta;
      else if (row.delta < 0) out.expense += -row.delta;
    }
    out.net = out.income - out.expense;
    return out;
  };
  return { today: calc(todayStart), week: calc(weekStart) };
}

/* 복귀 보상 원장 — applyWelcomeReward가 지급한 금액을 저장 후 기록한다 */
async function recordWelcomeLedger(accountId, amount, balanceAfter) {
  if (!accountId || !(Number(amount) > 0)) return;
  const today = getKstDate();
  try {
    const tx = await beginEconomyTx({
      accountId, idemKey: `welcome:${accountId}:${today}`,
      delta: Number(amount), reason: "welcome", ref: today
    });
    if (tx.ok) await finishEconomyTx(tx, balanceAfter);
  } catch (e) {
    console.warn("복귀 보상 원장 기록 오류:", e.message);
  }
}

/* ---------- 계정 복구·기기 연결 helpers ---------- */
function normalizeRecoveryCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

function randomRecoveryCode(length) {
  const bytes = crypto.randomBytes(Math.max(1, length));
  let out = "";
  for (let i = 0; i < length; i++) out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  return out;
}

function hashRecoveryCode(code, accountId) {
  const clean = normalizeRecoveryCode(code);
  const account = normKey(accountId);
  if (!clean || !account) return "";
  return crypto.createHash("sha256")
    .update(RECOVERY_PEPPER + ":" + account + ":" + clean)
    .digest("hex");
}

function sameRecoveryHash(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || !y || x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y)); } catch { return false; }
}

function recoveryAttemptAllowed(socketId) {
  const now = Date.now();
  let row = RECOVERY_ATTEMPTS.get(socketId);
  if (!row || now - row.startedAt >= RECOVERY_ATTEMPT_WINDOW_MS) {
    row = { count: 0, startedAt: now };
    RECOVERY_ATTEMPTS.set(socketId, row);
  }
  row.count += 1;
  return row.count <= RECOVERY_ATTEMPT_MAX;
}

function issueLinkCode(ownerKey) {
  const now = Date.now();
  for (const [code, row] of LINK_CODES) {
    if (!row || row.expiresAt <= now) LINK_CODES.delete(code);
  }
  const code = randomRecoveryCode(LINK_CODE_LENGTH);
  LINK_CODES.set(code, { ownerKey: normKey(ownerKey), expiresAt: now + LINK_CODE_TTL_MS });
  return code;
}

function redeemLinkCode(code) {
  const clean = normalizeRecoveryCode(code);
  const row = LINK_CODES.get(clean);
  if (!row) return null;
  LINK_CODES.delete(clean);
  if (!row.ownerKey || row.expiresAt <= Date.now()) return null;
  return row.ownerKey;
}

/* 계정을 현재 소켓으로 이어받는다. 방에 있었다면 확인된 뒤 자동으로 나간다. */
async function adoptAccountForSocket(socket, nickname, via) {
  const key = normKey(nickname);
  if (!key) return { ok: false, reason: "닉네임을 입력해주세요." };
  const target = await getPlayerData(key);
  if (!target || !target.nickname || normKey(target.nickname) !== key || isGhostRecord(target)) {
    return { ok: false, reason: "해당 닉네임의 계정을 찾을 수 없습니다." };
  }
  const currentUid = socketFirebaseUid.get(socket.id) || "";
  if (target.firebaseUid && currentUid && target.firebaseUid !== currentUid) {
    return { ok: false, reason: "이 계정은 다른 Google 계정에 연결되어 있습니다." };
  }
  const holder = onlineNicks.get(key);
  if (holder && holder !== socket.id && io.sockets.sockets.has(holder)) {
    return { ok: false, reason: "이미 다른 기기에서 접속 중인 계정입니다. 기존 접속을 종료한 뒤 다시 시도해주세요." };
  }
  if (getPlayerRoom(socket)) {
    leaveRoomForSocket(socket, "account");
    socket.emit("room:left", { ok: true });
  }
  registerOnline(socket.id, target.nickname);
  socket.emit("player:nameUpdated", {
    ok: true, nickname: target.nickname, recovered: true,
    nameChanges: Number(target.nameChanges || 0)
  });
  socket.emit("player:ranking", await getRankingPayload(socket.id));
  socket.emit("account:recovered", { ok: true, nickname: target.nickname, via });
  return { ok: true, nickname: target.nickname };
}

/* 구매 요청 ID — 반복 구매(보호 티켓·물약)의 중복 청구를 막는다 */
function safeEconomyRequestId(value, prefix = "req") {
  const clean = String(value || "").replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 80);
  return clean || `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* 업적 해금 코인은 evaluateAchievements가 동기적으로 지급하므로,
   저장이 끝난 뒤 원장에 감사 기록만 남긴다. 업적 ID 자체가 멱등 키다. */
async function recordAchievementLedger(accountId, unlocked, balanceAfter) {
  if (!accountId || !Array.isArray(unlocked) || unlocked.length === 0) return;
  for (const def of unlocked) {
    if (!def || !def.id || !(Number(def.coin) > 0)) continue;
    try {
      const tx = await beginEconomyTx({
        accountId, idemKey: `achievement:${accountId}:${def.id}`,
        delta: Number(def.coin), reason: "achievement", ref: def.id
      });
      if (tx.ok) await finishEconomyTx(tx, balanceAfter);
      else if (!tx.duplicate) console.warn("업적 원장 기록 실패:", def.id, tx.reason || "");
    } catch (e) {
      console.warn("업적 원장 기록 오류:", e.message);
    }
  }
}

function updateSingleResult(playerId, won, socketId = playerId) {
  return (async () => {
    const pd = await getPlayerData(playerId);
    if (won) pd.single.wins = (pd.single.wins || 0) + 1;
    else pd.single.losses = (pd.single.losses || 0) + 1;
    const r = Number(pd.single.rating) || 1000;
    const expected = 1 / (1 + Math.pow(10, (1000 - r) / 400));
    const next = Math.round(r + 32 * ((won ? 1 : 0) - expected));
    pd.single.rating = Number.isFinite(next) ? next : 1000;
    await savePlayerData(playerId, pd);
    const s = io.sockets.sockets.get(socketId);
    if (s) s.emit("player:ranking", {
      ...pd,
      single: { ...pd.single, rank: calculateRank(pd.single.rating) }
    });
    return pd;
  })();
}

async function updateRating(winnerId, loserId, winnerNickname, loserNickname, mode = "multi", opts = {}) {
  const key = mode === "ranked" ? "ranked" : "multi";
  /* 퇴장/연결 종료로 소켓 매핑이 지워져도 경기 참가자의 계정 키는 유지한다. */
  winnerId = normKey(winnerNickname) || resolvePlayerId(winnerId);
  loserId = normKey(loserNickname) || resolvePlayerId(loserId);
  const winner = await getPlayerData(winnerId);
  const loser = await getPlayerData(loserId);
  const { newWinnerRating, newLoserRating } = calculateElo(winner[key].rating, loser[key].rating);
  let wGain = newWinnerRating - winner[key].rating;
  let lChange = newLoserRating - loser[key].rating;
  /* 배치고사 중에는 변동 폭을 키워 5판 안에 실력대에 수렴시킨다. */
  if (key === "ranked") {
    wGain *= rankSeason.ratingMultiplier(winner.ranked);
    lChange *= rankSeason.ratingMultiplier(loser.ranked);
  }
  /* 랭크 보호 티켓 — 보유 시 자동 소모되어 패배자의 레이팅 감소를 막는다(전적/연승은 그대로 기록) */
  let loserProtected = false;
  if (mode === "ranked" && lChange < 0 && Number(loser.shieldTickets || 0) > 0 && opts.noShield !== true) {
    loser.shieldTickets = Math.max(0, Number(loser.shieldTickets) - 1);
    lChange = 0;
    loserProtected = true;
  }
  const wBoost = opts.winnerBoost || 1;
  const lBoost = opts.loserBoost || 1;
  winner[key].rating = Math.round(winner[key].rating + wGain * wBoost);
  loser[key].rating = Math.round(loser[key].rating + lChange * lBoost);
  winner[key].wins += 1; winner.nickname = winnerNickname || winner.nickname;
  loser[key].losses += 1; loser.nickname = loserNickname || loser.nickname;
  if (key === "ranked" || key === "multi") {
    if (opts.noStreak !== true) {
      winner[key].streak = Math.max(0, (winner[key].streak || 0)) + 1;
      winner[key].bestStreak = Math.max((winner[key].bestStreak || 0), winner[key].streak);
    }
    loser[key].streak = 0;
  }
  if (!Number.isFinite(winner[key].rating)) winner[key].rating = 1000;
  if (!Number.isFinite(loser[key].rating)) loser[key].rating = 1000;
  /* 랭크 배치고사 — 승/패 모두 1판씩 소모한다(보호 티켓으로 무효가 된 경기도 포함). */
  if (key === "ranked") {
    if (opts.placementWinner !== false) rankSeason.recordPlacementResult(winner);
    if (opts.placementLoser !== false) rankSeason.recordPlacementResult(loser);
  }
  if (opts.decBoostWinner) winner.ratingBoostGames = Math.max(0, (winner.ratingBoostGames || 0) - 1);
  if (opts.decBoostLoser) loser.ratingBoostGames = Math.max(0, (loser.ratingBoostGames || 0) - 1);
  /* 레이팅 추이 스냅샷(랭크+멀티 동시 기록, 날짜당 1점) — 아이템 탭 그래프용 */
  pushRatingHistory(winner);
  pushRatingHistory(loser);

  await savePlayerData(winnerId, winner);
  await savePlayerData(loserId, loser);
  return {
    winner: { ...winner, rank: calculateRank(winner[key].rating), placement: rankSeason.placementState(winner.ranked) },
    loser: { ...loser, rank: calculateRank(loser[key].rating), placement: rankSeason.placementState(loser.ranked) },
    loserProtected
  };
}

/* 오늘 날짜의 레이팅 스냅샷을 기록 — 같은 날은 마지막 값으로 갱신해 하루 1점 */
function pushRatingHistory(pd) {
  try {
    const d = getKstDate();
    const hist = Array.isArray(pd.ratingHistory) ? pd.ratingHistory : [];
    const last = hist[hist.length - 1];
    if (last && last.d === d) { last.r = Math.round(pd.ranked?.rating || 1000); last.m = Math.round(pd.multi?.rating || 1000); }
    else hist.push({ d, r: Math.round(pd.ranked?.rating || 1000), m: Math.round(pd.multi?.rating || 1000) });
    pd.ratingHistory = hist.slice(-60);
  } catch { /* 기록 실패는 결과에 영향주지 않는다 */ }
}

/* 복귀 환영 보상 — 3일 이상 접속하지 않았으면 (최대 14일 × 2000원)을 돌려준다.
   lastSeen을 오늘로 갱신하므로 같은 세션에서 중복 지급되지 않는다. 반환: 보상액(없으면 null) */
function applyWelcomeReward(pd, socket) {
  try {
    const today = getKstDate();
    const last = String(pd.lastSeen || "");
    if (last === today) return null;
    pd.lastSeen = today;
    if (!last) return null; /* 최초 기록일 때는 보상 없이 날짜만 남긴다 */
    const gap = Math.round((Date.parse(today) - Date.parse(last)) / 86400000);
    if (!Number.isFinite(gap) || gap < 3 || gap <= 0) return null;
    const amount = Math.min(gap, 14) * 2000;
    pd.money = (Number(pd.money) || 0) + amount;
    if (socket) socket.emit("welcome:reward", { amount, gapDays: gap, message: `${gap}일 만에 다시 오셨네요! ${amount.toLocaleString("ko-KR")}원을 돌려받았습니다.` });
    return amount;
  } catch (err) { console.error("복귀 보상 오류:", err.message); return null; }
}

/* =========================================================
   돈(코인) 시스템 & 상점
========================================================= */

const MONEY_TABLE = [
  { amount: 5000000, weight: 1 },
  { amount: 1000000, weight: 2 },
  { amount: 500000, weight: 4 },
  { amount: 100000, weight: 8 },
  { amount: 50000, weight: 13 },
  { amount: 25000, weight: 19 },
  { amount: 10000, weight: 24 },
  { amount: 5000, weight: 29 }
];
const MONEY_TOTAL_WEIGHT = MONEY_TABLE.reduce((a, b) => a + b.weight, 0);

function rollMoney() {
  let r = Math.random() * MONEY_TOTAL_WEIGHT;
  for (const row of MONEY_TABLE) {
    if (r < row.weight) return row.amount;
    r -= row.weight;
  }
  return 5000;
}

const SHOP_TITLES = [
  { id: "t_rookie", name: "풋내기 도전자", price: 20000 },
  { id: "t_wordy", name: "단어 수집가", price: 100000 },
  { id: "t_chain", name: "연쇄 마스터", price: 300000 },
  { id: "t_oneshot", name: "한방의 달인", price: 1000000 },
  { id: "t_god", name: "끝말잇기 신", price: 10000000 },
  { id: "t_legend", name: "전설의 챔피언", price: 30000000 }
];
const SHOP_POTION_PRICE = 1000000;
/* 이름 변경 비용 — 1회차 무료, 2회차부터 회당 100만 코인 */
const RENAME_PRICE = 1000000;
const SHOP_SHIELD_PRICE = 2000000;
const SHOP_MULTIPLIER_PRICES = [
  { multiplier: 2, price: 5000000 },
  { multiplier: 3, price: 15000000 },
  { multiplier: 4, price: 30000000 },
  { multiplier: 5, price: 50000000 }
];

function computeMoneyReward(base, player) {
  let m = base;
  m *= (player.moneyMultiplier || 1);
  if ((player.ratingBoostGames || 0) > 0) m *= 2;
  return Math.round(m);
}

/* =========================================================
   버그 제보 — 총관리자만 열람 가능
========================================================= */

const bugReportsPath = path.join(RUNTIME_DATA_DIR, "bug-reports.json");
let bugReports = [];

async function loadBugReports() {
  try {
    const data = await loadStoreJSON("bugReports", bugReportsPath, null);
    if (data) {
      bugReports = Array.isArray(data) ? data : [];
      console.log(`버그 제보 로드(${dbMode === "pg" ? "DB" : "파일"}): ${bugReports.length}건`);
    }
  } catch (e) { console.warn("버그 제보 로드 실패:", e.message); }
}

function saveBugReports() {
  try {
    writeStoreFile(bugReportsPath, bugReports, "bugReports");
  } catch (e) { console.warn("버그 제보 저장 실패:", e.message); }
}

/* =========================================================
   실시간 랭크 게임 — 매칭 큐
========================================================= */

const RANKED_QUEUE = [];
const RANKED_QUEUE_MAP = new Map(); /* socketId -> true */
/* 랭크 복수전 — socketId -> 상대 socketId. 한쪽이 신청하면 대기, 양쪽이
   같은 상대를 신청하면 즉시 그 둘끼리 새 랭크 매치를 시작한다 */
const REMATCHES = new Map();
/* 최근 성사된 매칭의 대기 시간 — 대기실 안내 문구에 사용 */
const RANKED_RECENT_MATCHES = [];

/* 랭크 대결 초대(2인전) — inviterSocketId -> { targetSocketId, from, fromRating, at }.
   친구에게 지명 랭크 대결을 신청하고 수락하면 그 둘끼리 새 랭크 매치를 시작한다 */
const RANKED_INVITES = new Map();

/* =========================================================
   랭크 대회 — 4인 서바이벌
   한 방에 4명이 들어와 턴을 돌리고, 하트가 모두 소진된 순서대로
   탈락한다. 마지막 한 명이 남으면 대회 승리로 정산한다.
   기존 턴/한방/타이머 엔진을 그대로 쓰므로 일반 대전과 규칙이 같다.
========================================================= */
const TOURNAMENT_SIZE = 4;
const TOURNAMENT_QUEUE = [];
/* socketId -> true */
const TOURNAMENT_QUEUE_MAP = new Map();
const TOURNAMENT_RECENT = [];

/* =========================================================
   계정 복구·기기 연결
   - 복구 코드: 계정마다 한 번 발급/재발급. 해시만 저장하고 원문은 발급 시 1회만 보여준다.
   - 연결 코드: 현재 기기에서 10분짜리 일회용 코드를 만들어 다른 기기에서 입력한다.
   - 두 경로 모두 코드를 아는 사람만 계정을 이어받을 수 있다.
========================================================= */
const RECOVERY_PEPPER = String(process.env.RECOVERY_PEPPER || "kkeul-recovery-v1");
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_LENGTH = 10;
const LINK_CODE_LENGTH = 8;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const RECOVERY_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const RECOVERY_ATTEMPT_MAX = 8;
/* code -> { ownerKey, expiresAt } */
const LINK_CODES = new Map();
/* socketId -> { count, startedAt } */
const RECOVERY_ATTEMPTS = new Map();

/* 소켓과 얽힌 랭크 초대를 모두 정리 — 내가 보낸 초대와 나를 대상으로 한 초대를
   취소하고 상대에게 통지한다 (매칭 대기 진입/커넥션 종료 등에서 호출) */
function cancelRankedInvitesFor(socketId) {
  const outgoing = RANKED_INVITES.get(socketId);
  if (outgoing) {
    RANKED_INVITES.delete(socketId);
    const tSocket = io.sockets.sockets.get(outgoing.targetSocketId);
    if (tSocket) tSocket.emit("ranked:inviteCanceled", { from: outgoing.from, reason: "초대자가 초대를 취소했습니다." });
  }
  for (const [inviter, inv] of [...RANKED_INVITES]) {
    if (inv.targetSocketId === socketId) {
      RANKED_INVITES.delete(inviter);
      const inviterSocket = io.sockets.sockets.get(inviter);
      if (inviterSocket) inviterSocket.emit("ranked:inviteCanceled", { from: inv.from, reason: "상대가 닉네임을 변경하거나 연결이 종료되었습니다." });
    }
  }
}

function addToRankedQueue(socketId, nickname, rating) {
  if (RANKED_QUEUE_MAP.has(socketId)) return false;
  RANKED_QUEUE.push({ socketId, nickname, rating, joinedAt: Date.now() });
  RANKED_QUEUE_MAP.set(socketId, true);
  return true;
}

function removeFromRankedQueue(socketId) {
  const idx = RANKED_QUEUE.findIndex(q => q.socketId === socketId);
  if (idx !== -1) RANKED_QUEUE.splice(idx, 1);
  RANKED_QUEUE_MAP.delete(socketId);
}

function broadcastRankedQueue() {
  const now = Date.now();
  const size = RANKED_QUEUE.length;
  const inQueue = [...RANKED_QUEUE_MAP.keys()];
  const oldestWaitMs = size
    ? Math.max(0, now - RANKED_QUEUE.reduce((min, q) => Math.min(min, q.joinedAt), now))
    : 0;
  const recent = RANKED_RECENT_MATCHES.slice(-5);
  const averageWaitMs = recent.length
    ? Math.round(recent.reduce((sum, m) => sum + m.waitMs, 0) / recent.length)
    : null;

  /* 개인화된 근접 인원은 소켓별로 보내고, 아무도 없으면 전체에 크기만 알린다 */
  for (const q of RANKED_QUEUE) {
    const nearbyCount = RANKED_QUEUE.reduce(
      (count, other) => count + (other !== q && Math.abs(other.rating - q.rating) <= 100 ? 1 : 0), 0);
    io.to(q.socketId).emit("ranked:queueSize", {
      size, inQueue, nearbyCount, oldestWaitMs, averageWaitMs,
    });
  }
  if (size === 0) io.emit("ranked:queueSize", { size: 0, inQueue: [] });
}

async function getRankingPayload(socketId) {
  const data = await getPlayerData(socketId);
  return {
    nickname: data.nickname,
    isAdmin: isAdminPd(data),
    single: { ...data.single, rank: calculateRank(data.single.rating) },
    multi: { ...data.multi, rank: calculateRank(data.multi.rating) },
    ranked: { ...data.ranked, rank: calculateRank(data.ranked.rating) },
    placement: rankSeason.placementState(data.ranked),
    money: data.money,
    moneyMultiplier: data.moneyMultiplier,
    ratingBoostGames: data.ratingBoostGames,
    nameChanges: Number(data.nameChanges || 0),
    hasRecovery: !!data.recoveryHash,
    recoveryAt: data.recoveryAt || "",
    titles: data.titles,
    currentTitle: data.currentTitle,
    attendance: {
      checkedToday: data.lastCheckDate === getKstDate(),
      streak: data.attendanceStreak || 0,
      lastCheckDate: data.lastCheckDate || ""
    },
    recentGames: Array.isArray(data.recentGames) ? data.recentGames.slice(-10) : [],
    daily: initDailyData(data.daily, getKstDate()),
    weekly: initWeeklyData(data.weekly, getKstWeek()),
    monthly: initMonthlyData(data.monthly, getKstMonth())
  };
}

/* 출석체크 — KST 기준 날짜, 연속 출석 보상 (2000원 + 연속 일수별 보너스, 최대 1만 원) */
function getKstDate(ts) {
  return new Date((ts == null ? Date.now() : ts) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const ATTENDANCE_REWARD = (streak) => Math.min(10000, 2000 + (streak - 1) * 1000);

/* KST 기준 ISO 주차 키 "2026-W37" — 월요일 시작 주 */
function getKstWeek(ts) {
  const d = new Date((ts == null ? Date.now() : ts) + 9 * 3600 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay() || 7;                /* 월=1 ~ 일=7 */
  d.setUTCDate(d.getUTCDate() + 4 - day);        /* 그 주의 목요일 기준 */
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
/* KST 기준 월 키 "2026-09" — 시즌 키와 동일하게 맞춘다 */
function getKstMonth(ts) { return (getKstDate(ts) || "").slice(0, 7); }

/* KST 기준 주간/월간 날짜 범위 문자열 (표시용) */
function kstWeekRange(ts) {
  const d = new Date((ts == null ? Date.now() : ts) + 9 * 3600 * 1000);
  const day = d.getUTCDay() || 7;               /* 월=1 ~ 일=7 */
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - day + 1);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return `${mon.toISOString().slice(0, 10)} ~ ${sun.toISOString().slice(0, 10)}`;
}
function kstMonthRange(ts) {
  const d = new Date((ts == null ? Date.now() : ts) + 9 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)} ~ ${new Date(Date.UTC(y, m, last)).toISOString().slice(0, 10)}`;
}

/* =========================================================
   미션 — 일일/주간/월간 3그룹. 그룹 키(KST 일/주/월)가 바뀌면
   카운터가 리셋되고, 달성 시 코인/칭호 보상을 지급한다
========================================================= */

const DAILY_MISSIONS = [
  { id: "rankedWins", label: "랭크에서 3승 올리기", target: 3, coin: 3000 },
  { id: "oneShots", label: "한방 단어 5번 성공", target: 5, coin: 2000 },
  { id: "streakDone", label: "랭크 2연승 달성", target: 1, coin: 1000, title: { id: "t_daily", name: "데일리 마스터" } }
];
const WEEKLY_MISSIONS = [
  { id: "rankedWins", label: "랭크에서 10승 올리기", target: 10, coin: 15000 },
  { id: "oneShots", label: "한방 단어 15번 성공", target: 15, coin: 8000 },
  { id: "streakDone", label: "랭크 2연승 3번 달성", target: 3, coin: 5000 }
];
const MONTHLY_MISSIONS = [
  { id: "rankedWins", label: "랭크에서 30승 올리기", target: 30, coin: 50000 },
  { id: "oneShots", label: "한방 단어 40번 성공", target: 40, coin: 20000 },
  { id: "streakDone", label: "랭크 2연승 8번 달성", target: 8, coin: 10000 }
];
const DAILY_TITLE = DAILY_MISSIONS.find(m => m.title);

/* =========================================================
   업적 — 계정 단위 누적 기록으로 해금. 해금 즉시 코인 지급,
   한 번 해금된 항목은 유지된다(achievements: { id: 해금시각 })
========================================================= */
function achievementDefs() {
  return [
    { id: "first_win", name: "첫 승리", desc: "첫 승리를 거둔다", coin: 1000 },
    { id: "win10", name: "단단한 실력", desc: "누적 10승 달성", coin: 3000 },
    { id: "win50", name: "끝말잇기 고수", desc: "누적 50승 달성", coin: 10000 },
    { id: "games50", name: "단련된 혀", desc: "누적 50판 플레이", coin: 4000 },
    { id: "word100", name: "말이 술술", desc: "누적 단어 100개 입력", coin: 2000 },
    { id: "word500", name: "수다의 달인", desc: "누적 단어 500개 입력", coin: 8000 },
    { id: "long8", name: "긴 말", desc: "8글자 이상 단어 입력", coin: 1500 },
    { id: "oneshot5", name: "한방 명수", desc: "한방 단어 5회 성공", coin: 3000 },
    { id: "oneshot20", name: "한방 전문가", desc: "한방 단어 20회 성공", coin: 10000 },
    { id: "streak5", name: "5연승", desc: "어떤 모드에서든 5연승 달성", coin: 5000 },
    { id: "party1", name: "팀 플레이어", desc: "2v2 파티에서 승리", coin: 2500 }
  ];
}

/* 레퍼럴(추천인) — 계정당 1회 등록, 양쪽 모두 코인 보상 */
const REFERRAL_JOIN_COIN = 3000;
const REFERRAL_INVITE_COIN = 5000;

/* 우편(쪽지) — 쪽지함 최대 보관 개수 / 쪽지 코인 상한 */
const MAIL_MAX = 50;
const MAIL_COIN_MAX = 1000000;

/* 누적 카운터 보장(없으면 생성+정규화) — pd.ach */
function achievementStats(pd) {
  if (!pd.ach || typeof pd.ach !== "object") pd.ach = {};
  const a = pd.ach;
  for (const k of ["games", "wins", "words", "oneshots", "longest", "partyWins", "streak"]) {
    a[k] = Math.max(0, Math.floor(Number(a[k]) || 0));
  }
  if (!pd.achievements || typeof pd.achievements !== "object") pd.achievements = {};
  return a;
}

/* 해금 조건 평가 — 새로 해금된 항목 목록을 반환(코인은 여기서 지급) */
function evaluateAchievements(pd) {
  const a = achievementStats(pd);
  a.streak = Math.max(a.streak, Number(pd.multi && pd.multi.bestStreak) || 0, Number(pd.ranked && pd.ranked.bestStreak) || 0);
  const cond = {
    first_win: a.wins >= 1, win10: a.wins >= 10, win50: a.wins >= 50,
    games50: a.games >= 50, word100: a.words >= 100, word500: a.words >= 500,
    long8: a.longest >= 8, oneshot5: a.oneshots >= 5, oneshot20: a.oneshots >= 20,
    streak5: a.streak >= 5, party1: a.partyWins >= 1
  };
  const unlocked = [];
  for (const def of achievementDefs()) {
    if (pd.achievements[def.id]) continue;
    if (!cond[def.id]) continue;
    pd.achievements[def.id] = new Date().toISOString();
    pd.money = Math.max(0, (Number(pd.money) || 0) + def.coin);
    unlocked.push(def);
  }
  return unlocked;
}


function missionKeyOf(group) { return group === "weekly" ? getKstWeek() : (group === "monthly" ? getKstMonth() : getKstDate()); }
function missionListOf(group) { return group === "weekly" ? WEEKLY_MISSIONS : (group === "monthly" ? MONTHLY_MISSIONS : DAILY_MISSIONS); }

function initPeriodData(d, periodKey) {
  d = (d && typeof d === "object") ? d : {};
  if (d.date !== periodKey) d = { date: periodKey, rankedWins: 0, oneShots: 0, streakDone: 0, claimed: [] };
  if (!Array.isArray(d.claimed)) d.claimed = [];
  d.rankedWins = Math.max(0, Math.floor(Number(d.rankedWins) || 0));
  d.oneShots = Math.max(0, Math.floor(Number(d.oneShots) || 0));
  d.streakDone = Math.max(0, Math.floor(Number(d.streakDone) || 0));
  return d;
}

function initDailyData(d, today) { return initPeriodData(d, today); }
function initWeeklyData(d, weekKey) { return initPeriodData(d, weekKey); }
function initMonthlyData(d, monthKey) { return initPeriodData(d, monthKey); }

const missionCurrent = (m, data) => m.id === "rankedWins" ? data.rankedWins : (m.id === "oneShots" ? data.oneShots : data.streakDone);

function buildMissionProgress(missions, data) {
  return missions.map(m => ({
    id: m.id,
    label: m.label,
    target: m.target,
    current: Math.min(m.target, missionCurrent(m, data)),
    coin: m.coin || 0,
    title: m.title || null,
    claimed: data.claimed.includes(m.id)
  }));
}

/* 미션 카운터 누적 (랭크 승리 / 한방 / 연승 달성) — 일일·주간·월간 동시 반영 */
function bumpMission(playerId, key) {
  return getPlayerData(playerId)
    .then(async (pd) => {
      const scopes = [
        { field: "daily", key: getKstDate() },
        { field: "weekly", key: getKstWeek() },
        { field: "monthly", key: getKstMonth() }
      ];
      for (const sc of scopes) {
        const data = initPeriodData(pd[sc.field], sc.key);
        if (data.claimed.includes(key)) continue;
        if (key === "rankedWins") data.rankedWins++;
        else if (key === "oneShots") data.oneShots++;
        else if (key === "streakDone") data.streakDone++;
        pd[sc.field] = data;
      }
      await savePlayerData(playerId, pd);
    })
    .catch(err => console.error("미션 누적 오류:", err.message));
}
/* 이전 이름 유지 — 하위 호환 */
function bumpDaily(playerId, key) { return bumpMission(playerId, key); }

/* =========================================================
   시즌제 랭킹 — 매월 1일 00시(KST) 자동 전환.
   시즌 중에는 현재 랭크 레이팅/연승을 그대로 사용하고, 시즌
   종료 시 그 시즌에 1판 이상 랭크 게임을 한 플레이어의 순위
   상위권에 코인 보상(1위는 전용 칭호)을 지급하며 전 시즌
   기록을 남긴다. '지금' 시각은 SEASON_NOW_OVERRIDE로 대체
   가능해 운영/테스트에서 시즌 전환을 직접 검증할 수 있다.
========================================================= */

const seasonJsonPath = path.join(RUNTIME_DATA_DIR, "season.json");
const SEA_TITLE = { id: "t_season", name: "시즌 챔피언" };
let seasonStore = null;

function nowForSeason() {
  const v = Number(process.env.SEASON_NOW_OVERRIDE || 0);
  return Number.isFinite(v) && v > 0 ? v : Date.now();
}
function seasonKeyOf(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function seasonEndMs(key) {
  const [y, m] = String(key).split("-").map(Number);
  return Date.UTC(y, m, 1) - 9 * 3600 * 1000;
}
function currentSeasonKey() { return seasonKeyOf(nowForSeason()); }

async function loadSeasonStore() {
  const data = await loadStoreJSON("season", seasonJsonPath, null);
  if (data && typeof data === "object") {
    seasonStore = {
      lastClosed: typeof data.lastClosed === "string" && data.lastClosed ? data.lastClosed : null,
      history: Array.isArray(data.history) ? data.history : []
    };
  } else {
    seasonStore = { lastClosed: null, history: [] };
  }
  return seasonStore;
}
function saveSeasonStore() {
  try { writeStoreFile(seasonJsonPath, seasonStore, "season"); }
  catch (e) { console.warn("시즌 데이터 저장 실패:", e.message); }
}
function getSeasonStore() {
  if (!seasonStore) seasonStore = { lastClosed: null, history: [] };
  return seasonStore;
}

/* 시즌 참가 누적 — 랭크 게임 종료 시 승/패 쌍으로 호출.
   새 시즌이 시작된 뒤 처음 이기면 참가 기록을 그 시즌으로 초기화한다 */
async function bumpSeasonFor(playerId, outcome) {
  try {
    const pd = await getPlayerData(playerId);
    const key = currentSeasonKey();
    const s = pd.season && pd.season.season === key
      ? pd.season
      : { season: key, games: 0, rating: pd.ranked.rating, wins: 0, losses: 0, bestStreak: 0 };
    s.games++;
    s.rating = pd.ranked.rating;
    if (outcome === "win") {
      s.wins++;
      s.bestStreak = Math.max(s.bestStreak, pd.ranked.streak || 0);
    } else {
      s.losses++;
    }
    pd.season = s;
    await savePlayerData(playerId, pd);
  } catch (err) { console.error("시즌 참가 기록 오류:", err.message); }
}

/* 전체 플레이어 목록 — JSON 모드는 메모리 캐시 전체, PG 모드는 DB 스캔 */
async function listAllPlayers() {
  if (dbMode === "pg") {
    const res = await dbPool.query("SELECT id FROM players WHERE id <> $1", [AI_PLAYER_ID]);
    const out = [];
    for (const row of res.rows) out.push(await getPlayerData(row.id));
    return out;
  }
  return [...playerCache.values()].filter(p => p && p.id !== AI_PLAYER_ID);
}

function seasonRewardFor(rank) {
  if (rank === 1) return { amount: 1000000, title: SEA_TITLE };
  if (rank <= 3) return { amount: 500000 };
  if (rank <= 10) return { amount: 150000 };
  if (rank <= 50) return { amount: 30000 };
  return { amount: 2000 };
}

/* 종료된 시즌 집계 → 보상 지급 → 전 시즌 기록 저장 */
async function closeSeason(key) {
  try {
    const players = await listAllPlayers();
    const rows = [];
    for (const p of players) {
      const s = p.season;
      if (!s || s.season !== key || (s.games || 0) === 0) continue;
      rows.push({
        id: p.id,
        nickname: p.nickname || "플레이어",
        rating: p.ranked && Number.isFinite(p.ranked.rating) ? p.ranked.rating : 1000,
        wins: s.wins || 0,
        losses: s.losses || 0
      });
    }
    rows.sort((a, b) => (b.rating - a.rating) || (b.wins - a.wins) || String(a.nickname).localeCompare(String(b.nickname)));
    rows.forEach((r, i) => { r.rank = i + 1; });
    let awarded = 0;
    let failed = false;
    for (const r of rows) {
      const rew = seasonRewardFor(r.rank);
      const pd = await getPlayerData(r.id);
      const tx = rew.amount > 0
        ? await beginEconomyTx({
            accountId: r.id, idemKey: `season:${key}:${r.id}`,
            delta: rew.amount, reason: "season", ref: key
          })
        : null;
      /* 원장 기록에 실패하면 코인을 지급하지 않고 다음 주기에 재시도한다.
         (원장 없이 지급하면 재시도 때 중복 지급될 수 있다) */
      if (rew.amount > 0 && tx && !tx.ok && !tx.duplicate) {
        console.warn("[SEASON] 보상 원장 기록 실패 — 재시도:", r.id, tx.reason || "");
        failed = true;
        continue;
      }
      const alreadyPaid = !!(tx && tx.duplicate);
      if (!alreadyPaid) pd.money += rew.amount;
      if (rew.title && !pd.titles.some(t => t && t.id === rew.title.id)) {
        pd.titles.push({ id: rew.title.id, name: rew.title.name });
        if (!pd.currentTitle) pd.currentTitle = rew.title.name;
      }
      /* 시즌 종료 — 다음 시즌을 위해 레이팅을 1000 기준으로 일부만 이월하고
         배치고사 5판을 예약한다. lastResetSeason 마커로 중복 적용을 막는다. */
      const reset = rankSeason.applySeasonSoftReset(pd, key, { placementSeason: currentSeasonKey() });
      pd.season = null;
      if (reset.changed) {
        console.log("[SEASON RESET] " + r.id + ": " + reset.before + " → " + reset.after + " (" + key + ")");
      }
      try {
        await savePlayerData(r.id, pd);
        if (tx && tx.ok) await finishEconomyTx(tx, pd.money);
      } catch (e) {
        if (tx && tx.ok) await abortEconomyTx(tx);
        throw e;
      }
      awarded++;
    }
    /* 보상 대상이 아니어도 랭크를 치른 계정은 다음 시즌을 위해 리셋한다.
       시즌을 건너뛴 계정이 옛 레이팅으로 복귀하는 것을 막는다. */
    const rewardedIds = new Set(rows.map(r => r.id));
    for (const p of players) {
      if (rewardedIds.has(p.id)) continue;
      const ranked = p.ranked || {};
      const played = (Number(ranked.wins) || 0) + (Number(ranked.losses) || 0) > 0;
      const rated = Number(ranked.rating) !== 1000;
      const pendingPlacement = Number(ranked.placementGamesLeft) > 0;
      if (!played && !rated && !pendingPlacement) continue;
      try {
        const pd = await getPlayerData(p.id);
        const reset = rankSeason.applySeasonSoftReset(pd, key, { placementSeason: currentSeasonKey() });
        if (!reset.changed) continue;
        pd.season = null;
        await savePlayerData(p.id, pd);
      } catch (e) {
        failed = true;
        console.error("시즌 리셋 오류:", p.id, e.message);
      }
    }
    /* 한 명이라도 실패했으면 기록/마커를 확정하지 않고 다음 주기에 이어서 처리한다. */
    if (failed) return false;
    const store = getSeasonStore();
    if (!store.history.some(h => h && h.season === key)) store.history.push({
      season: key,
      closedAt: new Date().toISOString(),
      champion: rows.length ? rows[0].nickname : null,
      participants: rows.length,
      top: rows.slice(0, 10).map(r => ({ nickname: r.nickname, rank: r.rank, rating: r.rating, wins: r.wins, losses: r.losses }))
    });
    saveSeasonStore();
    console.log(`[시즌 종료] ${key} — 참가 ${rows.length}명, 보상 지급 ${awarded}명`);
    return true;
  } catch (err) {
    console.error("시즌 종료 처리 오류:", err.message);
    return false;
  }
}

/* 시즌 전환 감지 → 이전 시즌 종료 처리. 시작 직후/API/소켓/주기 타이머에서 호출 */
let seasonRolloverPromise = null;
async function ensureSeasonRollover() {
  /* 동시에 여러 요청이 들어와도 마감/보상이 두 번 실행되지 않도록 한 번만 진행한다. */
  if (seasonRolloverPromise) return seasonRolloverPromise;
  const task = (async () => {
  const key = currentSeasonKey();
  const store = getSeasonStore();
  if (!store.lastClosed) {
    store.lastClosed = key;
    saveSeasonStore();
    return key;
  }
  if (store.lastClosed === key) return key;
  const closed = store.lastClosed;
  /* 일부 저장/원장 기록이 실패하면 마커를 전진시키지 않고 다음 호출에서 재시도한다.
     이미 처리된 플레이어는 season이 비워져 있어 중복 지급되지 않는다. */
  const ok = await closeSeason(closed);
  if (!ok) return closed;
  store.lastClosed = key;
  saveSeasonStore();
  return key;
  })();
  seasonRolloverPromise = task;
  try { return await task; } finally { seasonRolloverPromise = null; }
}

function buildSeasonInfo() {
  const key = currentSeasonKey();
  const store = getSeasonStore();
  const hist = store.history.length ? store.history[store.history.length - 1] : null;
  const coin = (rank) => `${seasonRewardFor(rank).amount.toLocaleString("en-US")}코인`;
  return {
    ok: true,
    key,
    endsAt: seasonEndMs(key),
    now: nowForSeason(),
    daysLeft: Math.max(0, Math.ceil((seasonEndMs(key) - nowForSeason()) / 86400000)),
    previous: hist ? { season: hist.season, champion: hist.champion, participants: hist.participants } : null,
    /* 실제 지급 로직(seasonRewardFor)에서 값을 뽑아 표기 — 안내와 실제 보상이 어긋나지 않는다 */
    rewards: [
      { rank: "1위", value: `${coin(1)} + 🏆 시즌 챔피언 칭호` },
      { rank: "2~3위", value: coin(2) },
      { rank: "4~10위", value: coin(4) },
      { rank: "11~50위", value: coin(11) },
      { rank: "참가", value: coin(999) }
    ]
  };
}

/* 최근 10판 전적 기록 — 종료된 방의 각 인간 플레이어에 기록 */
async function recordMatchHistory(room, winnerIndex, loserIndex) {
  if (!room || !room.players) return;
  const isParty = room.mode === "party";
  const winTeam = isParty && winnerIndex !== null && winnerIndex !== undefined
    ? (room.players[winnerIndex] ? room.players[winnerIndex].teamOf : null)
    : null;
  for (const p of room.players) {
    if (p.isBot) continue;
    try {
      const accountId = normKey(p.nickname) || p.id;
      const pd = await getPlayerData(accountId);
      const mine = (room.history || []).filter(h => h.player === p.playerIndex && typeof h.word === "string" && h.word.length > 0);
      const wordCount = mine.length;
      const avgWordLen = wordCount > 0 ? Math.round((mine.reduce((a, w) => a + w.word.length, 0) / wordCount) * 10) / 10 : 0;
      const opp = (isParty && p.teamOf !== null && p.teamOf !== undefined)
        ? room.players.find(o => o.playerIndex !== p.playerIndex && !o.isBot && o.teamOf !== p.teamOf)
        : room.players.find(o => o.playerIndex !== p.playerIndex && !o.isBot && o.id !== p.id);
      const result = winnerIndex === null ? "draw"
        : (winTeam !== null && winTeam !== undefined) ? (p.teamOf === winTeam ? "win" : "lose")
        : (p.playerIndex === winnerIndex ? "win" : "lose");
      /* 업적 — 판/승/단어/한방/장문/파티 승수를 누적하고 해금 조건 평가 */
      const a = achievementStats(pd);
      a.games += 1;
      if (result === "win") a.wins += 1;
      if (isParty && result === "win") a.partyWins += 1;
      a.words += wordCount;
      a.oneshots += mine.filter(h => h && h.oneShot).length;
      for (const h of mine) {
        const len = h && typeof h.word === "string" ? h.word.length : 0;
        if (len > a.longest) a.longest = len;
      }
      const newAch = evaluateAchievements(pd);
      /* 리플레이용 단어 흐름 — 최근 120수, 이 플레이어의 단어 여부(m) 포함 */
      const flow = (room.history || [])
        .filter(h => h && typeof h.word === "string" && h.word.length > 0)
        .slice(-120)
        .map(h => ({
          w: h.word.slice(0, 30),
          n: h.player === -1 ? "시작" : String((room.players.find(o => o.playerIndex === h.player) || {}).nickname || h.nickname || "플레이어").slice(0, 20),
          o: !!h.oneShot,
          d: h.depth == null ? null : h.depth,
          t: Number.isFinite(h.turn) ? h.turn : null,
          m: h.player === p.playerIndex
        }));
      const list = Array.isArray(pd.recentGames) ? pd.recentGames : [];
      list.push({
        date: new Date().toISOString(),
        mode: room.mode || "single",
        result,
        vs: opp ? opp.nickname : "AI",
        wordCount,
        avgWordLen,
        flow
      });
      pd.recentGames = list.slice(-10);
      await savePlayerData(accountId, pd);
      if (newAch.length) await recordAchievementLedger(accountId, newAch, pd.money);
      if (newAch.length) {
        const as = p.socketId ? io.sockets.sockets.get(p.socketId) : null;
        if (as) as.emit("achievements:unlocked", {
          list: newAch.map(d => ({ id: d.id, name: d.name, coin: d.coin })),
          money: Math.max(0, Math.floor(Number(pd.money) || 0))
        });
      }
    } catch (e) { console.error("전적 기록 오류:", e.message); }
  }
}

function tryMatchRanked() {
  while (RANKED_QUEUE.length >= 2) {
    /* 레이팅 순으로 정렬한 뒤 앞에서부터 두 명씩 매칭한다. 정렬된 목록에서
       인접한 두 명을 짝지으면 전체 레이팅 격차 합이 최소가 된다.
       동률이면 먼저 기다린 사람(joinedAt)을 앞에 둔다. */
    RANKED_QUEUE.sort((a, b) =>
      (a.rating - b.rating) || (a.joinedAt - b.joinedAt) || String(a.socketId).localeCompare(String(b.socketId)));
    const a = RANKED_QUEUE.shift();
    const b = RANKED_QUEUE.shift();
    RANKED_QUEUE_MAP.delete(a.socketId);
    RANKED_QUEUE_MAP.delete(b.socketId);

    if (!io.sockets.sockets.has(a.socketId) || !io.sockets.sockets.has(b.socketId)) {
      continue;
    }

    const matchedAt = Date.now();
    RANKED_RECENT_MATCHES.push({
      at: matchedAt,
      waitMs: Math.max(0, matchedAt - Math.min(a.joinedAt, b.joinedAt)),
    });
    if (RANKED_RECENT_MATCHES.length > 10) RANKED_RECENT_MATCHES.shift();

    startRankedGame(a, b);
  }
  broadcastRankedQueue();
}

/* 두 소켓을 즉시 랭크 매치로 연결해 새 게임을 시작한다 (일반 큐 매칭 + 복수전 공용) */
function startRankedGame(a, b) {
  const sa = io.sockets.sockets.get(a.socketId);
  const sb = io.sockets.sockets.get(b.socketId);
  if (!sa || !sb) return false;

  /* 매칭 확정 전에 이전 방(싱글/AI 방 등)에서 분리 — 랭크 게임 중 이전 방의
     이벤트가 들어와 턴/입력이 꼬이는 문제 방지 */
  leaveRoomForSocket(sa, "leave");
  leaveRoomForSocket(sb, "leave");

  const roomId = createRoomId();
  const room = {
    id: roomId,
    hostSocketId: a.socketId,
    mode: "ranked",
    players: [],
    currentWord: null,
    turnPlayerIndex: 0,
    turnNumber: 0,
    history: [],
    usedWords: new Set(),
    started: false,
    finished: false,
    winner: null,
    loser: null,
    timer: null,
    turnStartedAt: null,
    turnEndsAt: null,
    lastSyllable: null,
    gameSessionId: 0,
    rankedRatingA: a.rating,
    rankedRatingB: b.rating,
    spectators: new Map(),
    spectatorChat: []
  };
  addPlayer(room, a.socketId, a.nickname);
  addPlayer(room, b.socketId, b.nickname);
  ROOMS.set(roomId, room);

  sa.join(roomId);
  sb.join(roomId);
  sa.data.roomId = roomId;
  sa.data.playerIndex = 0;
  sb.data.roomId = roomId;
  sb.data.playerIndex = 1;

  registerOnline(a.socketId, a.nickname);
  registerOnline(b.socketId, b.nickname);

  sa.emit("ranked:matched", {
    ok: true, roomId, playerIndex: 0, opponent: b.nickname, opponentRating: b.rating,
    state: getPublicRoomState(room)
  });
  sb.emit("ranked:matched", {
    ok: true, roomId, playerIndex: 1, opponent: a.nickname, opponentRating: a.rating,
    state: getPublicRoomState(room)
  });
  startNewGame(room);
  console.log(`[RANKED MATCH] ${a.nickname}(${a.rating}) vs ${b.nickname}(${b.rating}) → ${roomId}`);
  return true;
}

/* =========================================================
   랭크 대회 — 큐/방/정산
========================================================= */
function addToTournamentQueue(socketId, nickname, rating) {
  if (TOURNAMENT_QUEUE_MAP.has(socketId)) return false;
  TOURNAMENT_QUEUE.push({ socketId, nickname, rating, joinedAt: Date.now() });
  TOURNAMENT_QUEUE_MAP.set(socketId, true);
  return true;
}

function removeFromTournamentQueue(socketId) {
  const idx = TOURNAMENT_QUEUE.findIndex(q => q.socketId === socketId);
  if (idx !== -1) TOURNAMENT_QUEUE.splice(idx, 1);
  TOURNAMENT_QUEUE_MAP.delete(socketId);
}

function broadcastTournamentQueue() {
  const now = Date.now();
  const size = TOURNAMENT_QUEUE.length;
  const oldestWaitMs = size
    ? Math.max(0, now - TOURNAMENT_QUEUE.reduce((min, q) => Math.min(min, q.joinedAt), now))
    : 0;
  for (const q of TOURNAMENT_QUEUE) {
    const nearbyCount = TOURNAMENT_QUEUE.reduce(
      (count, other) => count + (other !== q && Math.abs(other.rating - q.rating) <= 200 ? 1 : 0), 0);
    io.to(q.socketId).emit("tournament:queueSize", {
      size, needed: Math.max(0, TOURNAMENT_SIZE - size), nearbyCount, oldestWaitMs
    });
  }
  if (size === 0) io.emit("tournament:queueSize", { size: 0, needed: TOURNAMENT_SIZE });
}

function tryMatchTournament() {
  while (TOURNAMENT_QUEUE.length >= TOURNAMENT_SIZE) {
    TOURNAMENT_QUEUE.sort((a, b) =>
      (a.rating - b.rating) || (a.joinedAt - b.joinedAt) || String(a.socketId).localeCompare(String(b.socketId)));
    const entries = TOURNAMENT_QUEUE.splice(0, TOURNAMENT_SIZE);
    for (const entry of entries) TOURNAMENT_QUEUE_MAP.delete(entry.socketId);
    if (entries.some(entry => !io.sockets.sockets.has(entry.socketId))) continue;
    const matchedAt = Date.now();
    TOURNAMENT_RECENT.push({
      at: matchedAt,
      waitMs: Math.max(0, matchedAt - Math.min(...entries.map(e => e.joinedAt)))
    });
    if (TOURNAMENT_RECENT.length > 10) TOURNAMENT_RECENT.shift();
    startTournamentGame(entries);
  }
  broadcastTournamentQueue();
}

function startTournamentGame(entries) {
  if (!Array.isArray(entries) || entries.length !== TOURNAMENT_SIZE) return false;
  const sockets = entries.map(e => io.sockets.sockets.get(e.socketId));
  if (sockets.some(s => !s)) return false;
  for (const s of sockets) leaveRoomForSocket(s, "leave");
  const roomId = createRoomId();
  const room = {
    id: roomId,
    hostSocketId: entries[0].socketId,
    mode: "tournament",
    tournament: true,
    tournamentId: "T" + roomId,
    players: [],
    currentWord: null,
    turnPlayerIndex: 0,
    turnNumber: 0,
    history: [],
    usedWords: new Set(),
    started: false,
    finished: false,
    winner: null,
    loser: null,
    timer: null,
    turnStartedAt: null,
    turnEndsAt: null,
    lastSyllable: null,
    gameSessionId: 0,
    spectators: new Map(),
    spectatorChat: []
  };
  for (const entry of entries) addPlayer(room, entry.socketId, entry.nickname);
  ROOMS.set(roomId, room);
  entries.forEach((entry, index) => {
    const s = sockets[index];
    s.join(roomId);
    s.data.roomId = roomId;
    s.data.playerIndex = index;
    registerOnline(entry.socketId, entry.nickname);
    s.emit("tournament:matched", {
      ok: true, roomId, playerIndex: index,
      players: entries.map((e, i) => ({ nickname: e.nickname, rating: e.rating, isMe: i === index })),
      state: getPublicRoomState(room)
    });
  });
  startNewGame(room);
  console.log(`[TOURNAMENT MATCH] ${entries.map(e => e.nickname).join(", ")} → ${roomId}`);
  return true;
}

/* 대회 정산 — 승자는 남은 인원 전원을 상대로 랭크 승리를 얻고,
   패자는 각각 랭크 패배를 기록한다. 승자 연승은 한 번만 올린다. */
async function settleTournamentGame(resultRoom, winnerIndex, roomId, gameSessionId) {
  const humans = (resultRoom.players || []).filter(p => !p.isBot);
  const winner = humans.find(p => p.playerIndex === winnerIndex);
  const losers = humans.filter(p => p.playerIndex !== winnerIndex);
  if (!winner) {
    await recordMatchHistory(resultRoom, winnerIndex, null);
    return;
  }
  const winnerId = normKey(winner.nickname) || winner.id;
  /* 월 경계를 넘긴 대회 — 이전 시즌 마감이 끝난 뒤에 결과를 반영한다. */
  const seasonReady = (await ensureSeasonRollover()) === currentSeasonKey();
  let winnerData = null;
  for (const loser of losers) {
    const loserId = normKey(loser.nickname) || loser.id;
    try {
      const result = await updateRating(
        winnerId, loserId, winner.nickname || "플레이어", loser.nickname || "플레이어",
        "ranked", { noStreak: true, placementWinner: false }
      );
      winnerData = result.winner;
      for (const [data, p] of [[result.winner, winner], [result.loser, loser]]) {
        if (p && p.socketId) {
          const s = io.sockets.sockets.get(p.socketId);
          if (s) s.emit("player:ranking", { ...data, rank: data.rank });
        }
      }
      if (result.loserProtected && loser && loser.socketId) {
        const ls = io.sockets.sockets.get(loser.socketId);
        if (ls) ls.emit("shield:used", { message: "랭크 보호 티켓이 사용되어 레이팅이 감소하지 않았습니다!" });
      }
      if (seasonReady) await bumpSeasonFor(loserId, "lose");
    } catch (err) {
      console.error("대회 패자 정산 오류:", err.message);
    }
  }

  winnerData = await getPlayerData(winnerId);
  winnerData.ranked.streak = Math.max(0, Number(winnerData.ranked.streak) || 0) + 1;
  winnerData.ranked.bestStreak = Math.max(Number(winnerData.ranked.bestStreak) || 0, winnerData.ranked.streak);
  /* 대회 우승은 상대 수와 무관하게 배치고사 1판으로 계산한다. */
  rankSeason.recordPlacementResult(winnerData);
  await savePlayerData(winnerId, winnerData);

  const base = rollMoney() * Math.max(1, losers.length);
  const earned = computeMoneyReward(base, winnerData);
  if (earned > 0) {
    const tx = await beginEconomyTx({
      accountId: winnerId,
      idemKey: `tournament:${roomId}:${gameSessionId}:${winnerId}`,
      delta: earned, reason: "tournament_win", ref: roomId
    });
    if (tx && tx.ok) {
      winnerData.money += earned;
      try {
        await savePlayerData(winnerId, winnerData);
        await finishEconomyTx(tx, winnerData.money);
      } catch (err) {
        await abortEconomyTx(tx);
        throw err;
      }
      const ws = winner.socketId ? io.sockets.sockets.get(winner.socketId) : null;
      if (ws) ws.emit("money:received", {
        amount: earned, base, multiplier: Math.round(earned / Math.max(1, base)), roomId
      });
    } else if (tx && tx.duplicate) {
      console.warn("이미 지급된 대회 보상 — 중복 지급 생략:", roomId, winnerId);
    }
  }

  /* 코인 저장 뒤에 일일/시즌 카운터를 갱신해야 오래된 스냅샷이 카운터를 덮어쓰지 않는다. */
  await bumpDaily(winnerId, "rankedWins");
  if (winnerData.ranked.streak >= 2) await bumpDaily(winnerId, "streakDone");
  if (seasonReady) await bumpSeasonFor(winnerId, "win");
  /* 대회 우승은 길드 주간 대항전 60점 */
  await awardGuildWeekPoints(winnerId, 60, roomId);
  await recordMatchHistory(resultRoom, winnerIndex, null);
  for (const p of humans) {
    if (!p.socketId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit("player:ranking", await getRankingPayload(p.socketId));
  }
}

/* =========================================================
   방 관리
========================================================= */

const ROOMS = new Map();

function createRoomId() {
  let id;
  do { id = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (ROOMS.has(id));
  return id;
}

/* 방 정원 — 랭크는 항상 2명(1:1 고정), 그 외는 관리자 설정값(MAX_PLAYERS).
   2v2 파티는 UI에서 제거되어 더 이상 생성되지 않는다(레거시 party 방 방어용 코드만 유지). */
function roomCapacity(room) {
  if (!room) return MAX_PLAYERS;
  if (room.mode === "ranked") return 2;
  if (room.mode === "tournament") return TOURNAMENT_SIZE;
  return room.mode === "party" ? PARTY_PLAYERS : MAX_PLAYERS;
}

function createRoom(socketId, nickname, mode, opts = {}) {
  const roomId = createRoomId();
  const room = {
    id: roomId,
    hostSocketId: socketId,
    mode: mode || "online",
    modeId: opts.modeId || null,
    teamOf: null,
    partyId: null,
    createdAt: Date.now(),
    players: [],
    currentWord: null,
    turnPlayerIndex: 0,
    turnNumber: 0,
    history: [],
    usedWords: new Set(),
    started: false,
    finished: false,
    winner: null,
    loser: null,
    timer: null,
    turnStartedAt: null,
    turnEndsAt: null,
    lastSyllable: null,
    gameSessionId: 0,
    hintsUsed: 0,
    /* 싱글(AI) 난이도 — easy/normal/hard. AI 생각 시간과 선택 수준이 달라진다 */
    difficulty: opts.difficulty || "normal",
    aiThinkMs: { easy: 1500, normal: 800, hard: 300 }[opts.difficulty || "normal"] || 800,
    /* 튜토리얼 실습 게임 — 진행은 실제와 같지만 전적/미션/연승 등 아무것도 기록하지 않는다 */
    practice: !!opts.practice,
    spectators: new Map(),
    spectatorChat: []
  };
  /* 방장은 파티(2v2)에서 항상 0번 팀(첫 좌석)에 배치된다 */
  addPlayer(room, socketId, nickname, room.mode === "party" ? { teamOf: 0 } : {});
  ROOMS.set(roomId, room);
  return room;
}

function addPlayer(room, socketId, nickname, opts = {}) {
  if (room.players.length >= roomCapacity(room)) return null;
  if (room.mode === "party") {
    /* 2v2 파티 — 좌석을 A1,B1,A2,B2 순서로 배치(인터리브)해서 기존의 선형
       턴 순회(findNextAlivePlayer)가 자동으로 팀이 번갈아 가며 차례를 갖게 한다.
       즉 '한방'은 항상 상대 팀(다음 살아있는 상대)을 노리게 되므로 턴/한방/종료
       엔진을 전혀 건드리지 않고 2v2가 성립한다. teamOf는 0 또는 1. */
    const count0 = room.players.filter(p => p.teamOf === 0).length;
    const count1 = room.players.filter(p => p.teamOf === 1).length;
    const teamOf = opts.teamOf != null ? opts.teamOf : (count1 < count0 ? 1 : 0);
    const teamMemberCount = teamOf === 1
      ? room.players.filter(p => p.teamOf === 1).length
      : room.players.filter(p => p.teamOf === 0).length;
    if (teamMemberCount >= PARTY_TEAM_SIZE) return null;
    /* 인터리브 좌석: 팀 0은 짝수(0,2), 팀 1은 홀수(1,3) 자리에 앉는다 */
    const targetSeat = teamOf === 0 ? (teamMemberCount * 2) : (teamMemberCount * 2 + 1);
    const player = {
      id: socketId, socketId, playerIndex: targetSeat,
      nickname: nickname || `플레이어 ${targetSeat + 1}`,
      isBot: false, alive: true, connected: true,
      hearts: MAX_HEARTS, eliminated: false, mistakes: 0,
      waiting: false, teamOf
    };
    room.players.push(player);
    /* playerIndex를 좌석 순서(0,1,2,3)로 정렬해 인터리브 순서를 항상 유지 */
    room.players.sort((a, b) => a.playerIndex - b.playerIndex);
    room.players.forEach((p, i) => { p.playerIndex = i; });
    return room.players.find(p => p.id === socketId) || null;
  }
  const playerIndex = room.players.length;
  const player = {
    id: socketId, socketId, playerIndex,
    nickname: nickname || `플레이어 ${playerIndex + 1}`,
    isBot: false, alive: true, connected: true,
    hearts: MAX_HEARTS, eliminated: false, mistakes: 0,
    waiting: false, teamOf: null
  };
  room.players.push(player);
  return player;
}

function addBot(room) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const playerIndex = room.players.length;
  const player = {
    id: `AI_${room.id}`, socketId: null, playerIndex,
    nickname: "AI", isBot: true, alive: true, connected: true,
    hearts: MAX_HEARTS, eliminated: false, mistakes: 0
  };
  room.players.push(player);
  return player;
}

function getPlayerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId) || null;
}

/* 플레이어가 장착 중인 칭호 — 저장된 계정 데이터에서 조회 (소켓 ID → 닉네임 키).
   관리자도 자신의 칭호를 자유롭게 장착/해제할 수 있으며, 관리자 표시는
   방/리더보드 payload의 isAdmin 플래그로 UI가 [관리자] 배지를 그린다 */
function playerTitle(player) {
  if (!player || player.isBot) return "";
  const d = playerCache.get(resolvePlayerId(player.id));
  if (!d) return "";
  return d.currentTitle || "";
}

/* 관리자 계정 여부 — 검증된 Firebase UID + allowlist 이메일이 모두 있어야 한다 */
function isAdminPd(d) {
  return !!(d && d.firebaseUid && isAdminEmail(d.firebaseEmail || d.email));
}

function getPlayerByIndex(room, index) {
  return room.players.find(p => p.playerIndex === index) || null;
}

function getAlivePlayers(room) {
  return room.players.filter(p => !p.eliminated && !p.waiting);
}

function findNextAlivePlayer(room, currentIndex) {
  const total = room.players.length;
  for (let i = 1; i <= total; i++) {
    const index = (currentIndex + i) % total;
    const player = room.players[index];
    if (player && !player.eliminated && !player.waiting) return player.playerIndex;
  }
  return null;
}

function findRoomBySocket(socketId) {
  for (const room of ROOMS.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

/* 소켓의 현재 방 조회 — socket.data.roomId(최신 방)를 우선한다.
   레거시로 한 소켓이 여러 방에 남아 있더라도 최신 방 기준으로 동작한다 */
function getPlayerRoom(socket) {
  if (!socket) return null;
  return ROOMS.get(socket.data.roomId) || findRoomBySocket(socket.id);
}

/* 소켓을 이전 방에서 완전히 분리 — 방 생성/입장/랭크 매칭 진입 시 호출해
   한 소켓이 여러 방(특히 싱글/AI 방)에 남아 이벤트가 서로 섞이는 문제를 방지한다 */
/* 관전자 상태 — 방 객체가 여러 경로(일반/랭크/대회)에서 만들어지므로 지연 보정한다. */
function ensureSpectatorState(room) {
  if (!room) return new Map();
  if (!(room.spectators instanceof Map)) room.spectators = new Map();
  if (!Array.isArray(room.spectatorChat)) room.spectatorChat = [];
  return room.spectators;
}
function spectatorChannel(room) { return room.id + ":spec"; }
function spectatorList(room) {
  return [...ensureSpectatorState(room).values()].map(s => ({ nickname: s.nickname, joinedAt: s.joinedAt }));
}
function broadcastSpectators(room) {
  if (!room) return;
  const spectators = ensureSpectatorState(room);
  io.to(room.id).emit("room:spectators", {
    roomId: room.id,
    count: spectators.size,
    limit: MAX_SPECTATORS,
    spectators: spectatorList(room)
  });
}
function removeSpectator(room, socketId) {
  if (!room) return false;
  const spectators = ensureSpectatorState(room);
  if (!spectators.has(socketId)) return false;
  spectators.delete(socketId);
  return true;
}
/* 방이 닫힐 때 관전자 소켓을 정리 — 죽은 방에 남아 이벤트를 기다리지 않게 한다. */
function clearSpectators(room, reason) {
  if (!room) return;
  const spectators = ensureSpectatorState(room);
  for (const id of [...spectators.keys()]) {
    const s = io.sockets.sockets.get(id);
    if (s) {
      s.leave(room.id);
      s.leave(spectatorChannel(room));
      if (s.data) { s.data.roomId = null; s.data.playerIndex = null; s.data.spectating = false; }
      s.emit("room:left", { ok: true, spectate: true, reason: reason || "closed" });
    }
  }
  spectators.clear();
}

function leaveRoomForSocket(socket, reason) {
  const room = getPlayerRoom(socket);
  if (!room) return;
  socket.leave(room.id);
  socket.leave(spectatorChannel(room));
  socket.data.roomId = null;
  socket.data.playerIndex = null;
  /* 관전 중이던 방을 떠나면 남은 플레이어에게 관전자 수 변화를 알린다. */
  if (removeSpectator(room, socket.id)) broadcastSpectators(room);
  removePlayer(room, socket.id, reason || "leave");
  const realConnected = room.players.filter(p => !p.isBot && p.connected);
  if (realConnected.length === 0) {
    clearSpectators(room, "closed");
    stopTurnTimer(room);
    ROOMS.delete(room.id);
  }
}

function getPublicRoomState(room) {
  if (!room) return null;
  return {
    roomId: room.id,
    hostSocketId: room.hostSocketId,
    mode: room.mode,
    practice: !!room.practice,
    tournament: !!room.tournament,
    tournamentId: room.tournamentId || null,
    currentWord: room.currentWord,
    startSyllable: room.startSyllable || null,
    turnPlayer: room.turnPlayerIndex,
    turnNumber: room.turnNumber,
    started: room.started,
    finished: room.finished,
    winner: room.winner,
    loser: room.loser,
    turnTime: TURN_TIME,
    oneShotFreeTurns: ONESHOT_FREE_TURNS,
    mistakesPerLife: MISTAKES_PER_LIFE,
    hintsUsed: room.hintsUsed || 0,
    hintsLimit: HINTS_PER_GAME,
    history: room.history.map(item => ({
      word: item.word, player: item.player, nickname: item.nickname,
      depth: item.depth, turn: item.turn
    })),
    players: room.players.map(p => ({
      id: p.id, playerIndex: p.playerIndex, nickname: p.nickname,
      isBot: p.isBot, hearts: p.hearts, alive: p.alive,
      connected: p.connected, eliminated: p.eliminated,
      mistakes: p.mistakes || 0,
      waiting: p.waiting || false,
      team: (p.teamOf === 0 || p.teamOf === 1) ? p.teamOf : null,
      title: playerTitle(p),
      isAdmin: isAdminPd(playerCache.get(resolvePlayerId(p.id)))
    })),
    rankedRatings: (() => {
      const o = {};
      for (const p of room.players) {
        if (p.isBot) continue;
        const d = playerCache.get(resolvePlayerId(p.id));
        if (d && d.ranked && typeof d.ranked.rating === "number") o[p.playerIndex] = d.ranked.rating;
      }
      return o;
    })(),
    playerCount: room.players.filter(p => !p.isBot && !p.waiting).length,
    maxPlayers: roomCapacity(room),
    spectatorCount: ensureSpectatorState(room).size,
    spectatorLimit: MAX_SPECTATORS,
    maxHearts: MAX_HEARTS,
    turnStartedAt: room.turnStartedAt,
    turnEndsAt: room.turnEndsAt
  };
}

function broadcastRoomState(room) {
  if (!room) return;
  io.to(room.id).emit("game:state", getPublicRoomState(room));
}

/* =========================================================
   타이머
========================================================= */

function stopTurnTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.turnStartedAt = null;
  room.turnEndsAt = null;
}

/* 내 턴 알림 — 현재 차례인 플레이어가 탭을 보고 있지 않을 때만 보낸다.
   같은 세션·턴에는 한 번만 보내 중복 알림을 막는다. */
function notifyTurnStart(room) {
  try {
    if (!room) return;
    const player = getPlayerByIndex(room, room.turnPlayerIndex);
    if (!player || !player.nickname) return;
    const activeSocket = player.socketId ? io.sockets.sockets.get(player.socketId) : null;
    const visible = !!(activeSocket && activeSocket.data && activeSocket.data.visible !== false);
    if (!shouldNotifyTurn({
      mode: room.mode, practice: !!room.practice, finished: !!room.finished,
      started: !!room.started, isBot: !!player.isBot, visible
    })) return;
    const key = room.id + ":" + room.gameSessionId + ":" + room.turnNumber + ":" + player.playerIndex;
    if (room.lastTurnPushKey === key) return;
    room.lastTurnPushKey = key;
    const body = room.mode === "ranked"
      ? "랭크 대전에서 당신의 차례입니다."
      : room.id + " 방에서 당신의 차례입니다.";
    notifyPush(normKey(player.nickname), {
      title: "내 턴입니다",
      body,
      url: "/?room=" + room.id,
      tag: "turn:" + room.id
    });
  } catch (err) { console.warn("[PUSH] 턴 알림 오류:", err.message); }
}

function startTurnTimer(room, gameSessionId) {
  stopTurnTimer(room);
  if (!room || room.finished || !room.started) return;
  /* 한 명이라도 재접속 유예 중이면 경기 전체를 계속 일시정지한다. */
  if (room.players.some(p => !p.isBot && !p.connected && !p.eliminated && !p.waiting)) return;
  const player = getPlayerByIndex(room, room.turnPlayerIndex);
  if (!player || player.eliminated) return;

  /* 내 차례가 돌아오면 이전 턴의 실수는 초기화 (하트는 게임 동안 유지) */
  player.mistakes = 0;

  const now = Date.now();
  room.turnStartedAt = now;
  room.turnEndsAt = now + TURN_TIME * 1000;
  broadcastRoomState(room);

  room.timer = setTimeout(() => {
    if (room.gameSessionId !== gameSessionId) return;
    handleTurnTimeout(room, gameSessionId);
  }, TURN_TIME * 1000);

  if (player.isBot && room.mode === "ai") {
    /* 난이도별 AI 생각 시간 — 보통/어려움은 빠르게, 쉬움은 여유있게 두어
       반응 속도 차이도 체감되게 한다 */
    const thinkMs = (room.aiThinkMs != null && room.aiThinkMs >= 100) ? room.aiThinkMs : 500;
    setTimeout(() => {
      if (room.gameSessionId !== gameSessionId) return;
      runAI(room, gameSessionId);
    }, thinkMs);
  }

  /* 탭이 백그라운드이거나 연결이 끊긴 플레이어에게만 턴 시작을 알린다. */
  notifyTurnStart(room);
}

function handleTurnTimeout(room, gameSessionId) {
  if (!room || room.finished || room.gameSessionId !== gameSessionId) return;
  const player = getPlayerByIndex(room, room.turnPlayerIndex);
  if (!player || player.eliminated) return;

  player.hearts--;
  player.mistakes = 0;
  let heartLost = true;
  if (player.hearts <= 0) { player.hearts = 0; player.eliminated = true; }

  io.to(room.id).emit("game:timeout", {
    player: player.playerIndex, nickname: player.nickname,
    hearts: player.hearts, eliminated: player.eliminated,
    mistakes: player.mistakes, mistakesPerLife: MISTAKES_PER_LIFE,
    heartLost, mode: room.mode, roomId: room.id
  });

  const alive = getAlivePlayers(room);
  if (room.mode === "party") {
    if (checkPartyEnd(room)) return;
  } else {
    if (alive.length === 0) { finishGame(room, null, null); return; }
    if (alive.length === 1) {
      finishGame(room, alive[0].playerIndex, player.playerIndex);
      return;
    }
  }

  if (heartLost && !player.eliminated) {
    /* 미답 시 하트 1개 차감 후, 기존 단어(이전 음절)를 유지하지 않고
       새 시작 음절로 라운드를 다시 시작한다 — 같은 음절에서 한방을 노리는 흐름 차단.
       선공은 하트를 잃은 플레이어에게 돌아간다 */
    io.to(room.id).emit("game:roundReset", {
      reason: `응답하지 않아 하트 1개를 잃었습니다. 새 라운드를 시작합니다.`,
      mode: room.mode, roomId: room.id
    });
    startNewGame(room, { preserveHearts: true, firstPlayer: player.playerIndex });
    return;
  }

  const next = findNextAlivePlayer(room, player.playerIndex);
  if (next === null) { finishGame(room, null, player.playerIndex); return; }
  room.turnPlayerIndex = next;
  room.turnNumber++;
  startTurnTimer(room, gameSessionId);
}

/* =========================================================
   게임 종료 — 승패 판정
   winnerIndex가 이긴 사람, loserIndex가 진 사람
========================================================= */

/* =========================================================
   파티(2v2) — 팀 승패 판정
   한 팀원이라도 생존해 있으면 게임 계속, 한 팀만 남으면 종료.
========================================================= */
function partyAliveTeams(room) {
  const teams = new Set();
  for (const p of room.players) {
    if (p.eliminated || p.waiting) continue;
    if (p.teamOf === 0 || p.teamOf === 1) teams.add(p.teamOf);
  }
  return teams;
}

/* 파티(2v2) 시작/재시작 조건 — 양 팀에 최소 1명씩 연결되어 있어야 한다 */
function partyReadyError(room, eligible) {
  if (!room || room.mode !== "party") return null;
  const t0 = eligible.some(p => p.teamOf === 0);
  const t1 = eligible.some(p => p.teamOf === 1);
  return (!t0 || !t1) ? "각 팀에 최소 1명씩 연결되어 있어야 합니다." : null;
}

/* 종료 처리를 했으면 true */
function checkPartyEnd(room) {
  if (!room || room.mode !== "party" || room.finished) return false;
  const teams = partyAliveTeams(room);
  if (teams.size >= 2) return false;
  if (teams.size === 0) { finishGame(room, null, null); return true; }
  const winTeam = [...teams][0];
  const winPlayer = room.players.find(p => !p.eliminated && !p.waiting && p.teamOf === winTeam);
  const losePlayer = room.players.find(p => p.teamOf !== winTeam && p.eliminated)
    || room.players.find(p => p.teamOf !== winTeam);
  if (!winPlayer) { finishGame(room, null, null); return true; }
  finishGame(room, winPlayer.playerIndex, losePlayer ? losePlayer.playerIndex : null);
  return true;
}

/* 파티 승/패 페어 (승팀원 vs 패팀원 짝지어 레이팅에 반영) */
function partyResultPairs(room, winnerIndex) {
  if (!room || room.mode !== "party" || winnerIndex == null) return [];
  const winner = room.players[winnerIndex];
  if (!winner || winner.teamOf == null) return [];
  const winTeam = winner.teamOf;
  const winners = room.players.filter(p => !p.isBot && p.teamOf === winTeam);
  const losers = room.players.filter(p => !p.isBot && p.teamOf !== winTeam);
  const pairs = [];
  const n = Math.min(winners.length, losers.length);
  for (let i = 0; i < n; i++) pairs.push([winners[i].playerIndex, losers[i].playerIndex]);
  return pairs;
}

async function finishGame(room, winnerIndex, loserIndex) {
  if (!room || room.finished) return;
  room.finished = true;
  room.winner = winnerIndex;
  room.loser = loserIndex;
  stopTurnTimer(room);
  /* UI에서 바로 재시작하거나 방이 정리되어도 저장할 경기 결과는 바뀌지 않는다. */
  const resultRoom = {
    mode: room.mode,
    players: room.players.map(p => ({ ...p })),
    history: (room.history || []).map(h => ({ ...h }))
  };
  /* 마지막 한방의 미션 저장이 끝난 뒤 점수/전적을 읽어 덮어쓰기 경쟁을 막는다. */
  if (room.pendingMissionWrites) await room.pendingMissionWrites;
  let resultSave;

  const winnerName = winnerIndex !== null ? room.players[winnerIndex]?.nickname : "무승부";
  console.log(`[GAME END] Room:${room.id} Winner:${winnerName} (${winnerIndex}) Loser:(${loserIndex})`);

  /* 레이팅 반영 — 싱글(AI)은 레이팅 미반영, 온라인=멀티 레이팅, 랭크드=랭크드 레이팅+돈 보상 */
  const w = winnerIndex != null ? resultRoom.players[winnerIndex] : null;
  const l = loserIndex != null ? resultRoom.players[loserIndex] : null;
  const winnerAccountId = w ? normKey(w.nickname) || w.id : null;
  const loserAccountId = l ? normKey(l.nickname) || l.id : null;
  const humanOnly = w && l && !w.isBot && !l.isBot;
  if (room.mode === "tournament") {
    resultSave = (winnerIndex !== null
      ? settleTournamentGame(resultRoom, winnerIndex, room.id, room.gameSessionId)
      : recordMatchHistory(resultRoom, winnerIndex, null))
      .catch(err => console.error("대회 결과 저장 오류:", err.message));
  } else if (room.mode === "party" && humanOnly && w && l && winnerIndex !== null) {
    /* 2v2 — 승리 팀·패배 팀 전원에게 멀티 레이팅 승/패를 각각 반영 */
    const pairs = partyResultPairs(resultRoom, winnerIndex);
    resultSave = (async () => {
      for (const [wi, li] of pairs) {
        const wp = resultRoom.players[wi];
        const lp = resultRoom.players[li];
        if (!wp || !lp) continue;
        try {
          const res = await updateRating(
            normKey(wp.nickname) || wp.id, normKey(lp.nickname) || lp.id,
            wp.nickname || "플레이어", lp.nickname || "플레이어", "multi", {}
          );
          for (const [data, p] of [[res.winner, wp], [res.loser, lp]]) {
            if (p && p.socketId) {
              const s = io.sockets.sockets.get(p.socketId);
              if (s) s.emit("player:ranking", { ...data, rank: data.rank });
            }
          }
        } catch (err) { console.error("파티 레이팅 반영 오류:", err.message); }
      }
      await recordMatchHistory(resultRoom, winnerIndex, loserIndex);
    })().catch(err => console.error("파티 결과 저장 오류:", err.message));
  } else if (w && l && w.id !== l.id && (room.mode === "online" || room.mode === "ranked") && humanOnly) {
    const mode = room.mode === "ranked" ? "ranked" : "multi";
    const updateOpts = {};
    let seasonReady = true;
    if (room.mode === "ranked") {
      /* 월 경계를 넘긴 첫 경기 — 이전 시즌 마감이 끝난 뒤에 레이팅을 반영한다.
         마감이 실패하면 시즌 참가 기록을 덮어쓰지 않는다. */
      seasonReady = (await ensureSeasonRollover()) === currentSeasonKey();
      const [wData, lData] = await Promise.all([getPlayerData(winnerAccountId), getPlayerData(loserAccountId)]);
      updateOpts.winnerBoost = ((wData.ratingBoostGames || 0) > 0) ? 2 : 1;
      updateOpts.loserBoost = ((lData.ratingBoostGames || 0) > 0) ? 2 : 1;
      updateOpts.decBoostWinner = true;
      updateOpts.decBoostLoser = true;
    }
    resultSave = updateRating(
      winnerAccountId, loserAccountId,
      w.nickname || "플레이어", l.nickname || "플레이어",
      mode, updateOpts
    )
      .then(async (result) => {
        for (const [data, p] of [[result.winner, w], [result.loser, l]]) {
          if (p && !p.isBot && p.socketId) {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.emit("player:ranking", { ...data, rank: data.rank });
          }
        }
        if (result.loserProtected && l && !l.isBot && l.socketId) {
          const ls = io.sockets.sockets.get(l.socketId);
          if (ls) ls.emit("shield:used", { message: "랭크 보호 티켓이 사용되어 레이팅이 감소하지 않았습니다!" });
        }
        if (room.mode === "ranked") {
          /* 일일 미션 — 랭크 승리 누적, 연승 2회 달성 */
          await bumpDaily(winnerAccountId, "rankedWins");
          if ((result.winner.ranked && result.winner.ranked.streak) >= 2) await bumpDaily(winnerAccountId, "streakDone");
          const winnerData = await getPlayerData(winnerAccountId);
          const base = rollMoney();
          const earned = computeMoneyReward(base, winnerData);
          const tx = earned > 0
            ? await beginEconomyTx({
                accountId: winnerAccountId,
                idemKey: `game:${room.id}:${room.gameSessionId}:${winnerAccountId}`,
                delta: earned, reason: "game_win", ref: room.id
              })
            : null;
          if (tx && tx.duplicate) {
            console.warn("이미 지급된 게임 보상 — 중복 지급 생략:", room.id, winnerAccountId);
          } else {
            winnerData.money += earned;
            try {
              await savePlayerData(winnerAccountId, winnerData);
              if (tx && tx.ok) await finishEconomyTx(tx, winnerData.money);
            } catch (e) {
              if (tx && tx.ok) await abortEconomyTx(tx);
              throw e;
            }
            const ws = io.sockets.sockets.get(w.socketId);
            if (ws) ws.emit("money:received", { amount: earned, base, multiplier: Math.round(earned / base), roomId: room.id });
          }
        }

        /* 시즌 참가 누적 — 승/패 각각 현재 시즌에 기록 */
        if (room.mode === "ranked") {
          if (seasonReady) {
            await bumpSeasonFor(winnerAccountId, "win");
            await bumpSeasonFor(loserAccountId, "lose");
          }
          /* 길드 주간 대항전 — 승리 30점 + 연승 보너스(최대 20점) */
          const streak = Math.max(0, Number(result.winner.ranked && result.winner.ranked.streak) || 0);
          await awardGuildWeekPoints(winnerAccountId, 30 + Math.min(20, Math.max(0, streak - 1) * 2), room.id);
        }

        /* 전적 기록은 레이팅/미션 저장이 모두 끝난 뒤에 — 동시 기록 시 덮어쓰기 손실 방지 */
        await recordMatchHistory(resultRoom, winnerIndex, loserIndex);
      })
      .catch((err) => console.error("레이팅 반영 오류:", err.message));
  } else if (room.practice) {
    /* 튜토리얼 실습 — 전적/점수/업적/미션 아무것도 기록하지 않는다 */
    resultSave = Promise.resolve();
  } else {
    /* 전적과 싱글 점수 저장을 순차 처리해 이전 스냅샷이 새 전적을 덮어쓰지 않는다. */
    resultSave = (async () => {
      await recordMatchHistory(resultRoom, winnerIndex, loserIndex);
      if (resultRoom.mode === "ai" && winnerIndex !== null) {
        const human = resultRoom.players.find(p => !p.isBot);
        if (human && human.playerIndex !== undefined) {
          const accountId = normKey(human.nickname) || human.id;
          await updateSingleResult(accountId, human.playerIndex === winnerIndex, human.socketId || human.id);
        }
      }
    })().catch(err => console.error("싱글 결과 저장 오류:", err.message));
  }

  /* 방장이 탈락/이탈했으면 생존자에게 방장 이전 (재시작 데드락 방지) */
  const host = room.players.find(p => p.id === room.hostSocketId);
  if (!host || !host.connected || host.eliminated) {
    const nextHost = room.players.find(p => !p.isBot && p.connected && !p.eliminated && p.id !== room.hostSocketId);
    if (nextHost) room.hostSocketId = nextHost.id;
  }

  io.to(room.id).emit("game:finished", {
    winner: winnerIndex,
    loser: loserIndex,
    winnerName: winnerName,
    state: getPublicRoomState(room)
  });
  broadcastRoomState(room);

  /* 인간 접속자가 하나도 없으면(싱글/AI 방에서 인간이 이탈한 경우 등)
     종료된 방을 즉시 정리해 좀비 방으로 남지 않게 한다 */
  const connectedHumans = room.players.filter(p => !p.isBot && p.connected);
  if (connectedHumans.length === 0) {
    clearSpectators(room, "closed");
    ROOMS.delete(room.id);
  }
  await resultSave;
}

/* =========================================================
   게임 시작 — 랜덤 선공
========================================================= */

function startNewGame(room, opts = {}) {
  if (!room) return false;
  room.gameSessionId++;
  stopTurnTimer(room);

  const preserveHearts = !!opts.preserveHearts;

  /* 재시작(대기실/종료 후) 시 나가거나 접속이 끊긴 플레이어는 제거 — 유령 플레이어 방지 */
  if (!room.started || room.finished) {
    if (room.players.some(p => !p.connected)) {
      room.players = room.players.filter(p => p.connected);
      room.players.forEach((p, i) => { p.playerIndex = i; });
    }
  }

  for (const player of room.players) {
    if (preserveHearts) {
      if (player.hearts <= 0) {
        player.hearts = 0;
        player.eliminated = true;
      }
      player.alive = !player.eliminated;
    } else {
      player.hearts = MAX_HEARTS;
      player.alive = true;
      player.eliminated = false;
    }
    player.mistakes = 0;
    player.waiting = false;
  }

  if (room.players.length === 0) { clearSpectators(room, "closed"); ROOMS.delete(room.id); return false; }

  /* 하트를 건너뛰는 새 라운드(라운드 리셋)에서는 사용 단어/기록을 유지해
     같은 게임(목숨이 다 닳기 전) 안에서는 중복 단어를 계속 검사한다 */
  if (!preserveHearts) {
    room.currentWord = null;
    room.history = [];
    room.usedWords = new Set();
    room.hintsUsed = 0;
  } else {
    room.currentWord = null;
  }
  room.turnNumber = 0;
  room.finished = false;
  room.started = true;
  room.winner = null;
  room.loser = null;

  /* 시작 음절 — 이전 라운드와 같은 음절이 반복되지 않도록 회피.
     항상 정해진 시작 음절(가/기/나/다/마/자/시)만 사용한다 */
  let pool = STARTING_SYLLABLES;
  if (room.lastSyllable && pool.length > 1) {
    pool = pool.filter(s => s !== room.lastSyllable);
  }
  const syllable = pool[Math.floor(Math.random() * pool.length)];
  room.lastSyllable = syllable;
  room.startSyllable = syllable;
  room.currentWord = syllable;
  room.history.push({
    word: syllable, player: -1, nickname: "시작",
    depth: null, turn: room.history.length
  });

  /* 첫 선공 랜덤 — AI 모드에서는 AI가 먼저 시작할 수도 있다.
     opts.firstPlayer가 지정되면(하트 차감 후 복귀) 그 플레이어가 선공 */
  const eligibleFirst = room.players.filter(p => !p.eliminated && !p.waiting &&
    (room.mode === "ai" ? true : !p.isBot));
  if (eligibleFirst.length === 0) { room.started = false; return false; }
  const forced = opts.firstPlayer != null
    ? eligibleFirst.find(p => p.playerIndex === opts.firstPlayer)
    : null;
  room.turnPlayerIndex = (forced || eligibleFirst[Math.floor(Math.random() * eligibleFirst.length)]).playerIndex;

  io.to(room.id).emit("game:started", {
    ok: true, startWord: syllable,
    firstTurn: room.turnPlayerIndex,
    state: getPublicRoomState(room)
  });

  startTurnTimer(room, room.gameSessionId);

  return true;
}

/* =========================================================
   단어 제출 — 승패 판정 수정
========================================================= */

function playWord(room, player, rawWord, gameSessionId) {
  if (!room) return { ok: false, reason: "방을 찾을 수 없습니다." };
  if (room.finished) return { ok: false, reason: "게임이 이미 끝났습니다." };
  if (!room.started) return { ok: false, reason: "게임이 아직 시작되지 않았습니다." };
  if (!player) return { ok: false, reason: "플레이어를 찾을 수 없습니다." };
  if (player.eliminated) return { ok: false, reason: "탈락한 플레이어입니다." };
  if (room.turnPlayerIndex !== player.playerIndex) return { ok: false, reason: "지금은 당신의 차례가 아닙니다." };
  if (room.gameSessionId !== gameSessionId) return { ok: false, reason: "이전 게임의 요청입니다." };

  const word = normalizeWord(rawWord);
  if (!word) return { ok: false, reason: "단어를 입력해주세요.", penalty: true };
  if (!hasWord(word, WORD_SET)) return { ok: false, reason: "단어 목록에 없는 단어입니다.", penalty: true };
  if (room.usedWords.has(word)) return { ok: false, reason: "이미 사용한 단어입니다.", penalty: true };

  const isFirstTurn = room.turnNumber === 0;

  if (isFirstTurn) {
    const syllable = room.startSyllable || "";
    if (!word.startsWith(syllable)) {
      return { ok: false, reason: `"${syllable}"(으)로 시작하는 단어를 입력해주세요.`, penalty: true };
    }
  } else {
    if (room.currentWord && !canConnect(room.currentWord, word)) {
      const last = room.currentWord.at(-1);
      return { ok: false, reason: `"${last}" 다음에 연결할 수 없는 단어입니다.`, allowed: allowedFirstChars(last), penalty: true };
    }
  }

  if (room.turnNumber < ONESHOT_FREE_TURNS) {
    if (isAttackWord(word, ATTACK_DEPTH)) {
      return { ok: false, reason: `첫 ${ONESHOT_FREE_TURNS}턴은 공격 단어를 사용할 수 없습니다.`, penalty: true };
    }
    if (isOneShot(word, room.usedWords, WORD_INDEX)) {
      return { ok: false, reason: `첫 ${ONESHOT_FREE_TURNS}턴은 한방 단어를 사용할 수 없습니다.`, penalty: true };
    }
  }

  stopTurnTimer(room);
  room.currentWord = word;
  room.usedWords.add(word);
  const depth = getAttackDepth(word, ATTACK_DEPTH);

  room.history.push({
    word, player: player.playerIndex, nickname: player.nickname,
    depth, turn: room.history.length
  });

  const nextCandidates = getCandidates(word, room.usedWords, WORD_INDEX);

  io.to(room.id).emit("game:word", {
    ok: true, word, player: player.playerIndex, nickname: player.nickname,
    depth, nextCount: nextCandidates.length, mode: room.mode, roomId: room.id
  });
  broadcastRoomState(room);

  /* 다음 사람이 대응할 단어가 없으면 한방 — 게임 종료 대신 상대 하트 1개 차감
     (하트가 모두 깎이면 탈락, 한 명만 남으면 그때 게임 종료) */
  if (nextCandidates.length === 0) {
    const loser = findNextAlivePlayer(room, player.playerIndex);
    if (loser === null) { finishGame(room, player.playerIndex, null); return { ok: true, finished: true }; }
    const loserPlayer = getPlayerByIndex(room, loser);
    loserPlayer.hearts--;
    loserPlayer.mistakes = 0;
    loserPlayer.eliminated = loserPlayer.hearts <= 0;
    if (loserPlayer.eliminated) loserPlayer.hearts = 0;
    loserPlayer.alive = !loserPlayer.eliminated;

    io.to(room.id).emit("game:oneshot", {
      word, killer: player.playerIndex, killerNickname: player.nickname,
      target: loser, targetNickname: loserPlayer.nickname,
      hearts: loserPlayer.hearts, eliminated: loserPlayer.eliminated,
      mode: room.mode, roomId: room.id
    });

    /* 이번 단어가 한방이었다는 사실을 전적/업적 집계용으로 남긴다 */
    const lastIdx = room.history.length - 1;
    if (room.history[lastIdx] && room.history[lastIdx].word === word) room.history[lastIdx].oneShot = true;

    /* 일일 미션 — '한방 단어' 성공 횟수 누적 (튜토리얼 실습은 제외) */
    if (!player.isBot && !room.practice) {
      const accountId = normKey(player.nickname) || player.id;
      room.pendingMissionWrites = (room.pendingMissionWrites || Promise.resolve())
        .then(() => bumpDaily(accountId, "oneShots"));
    }

    const alive = getAlivePlayers(room);
    if (room.mode === "party") {
      if (checkPartyEnd(room)) return { ok: true, finished: true };
    } else {
      if (alive.length === 0) { finishGame(room, null, null); return { ok: true, finished: true }; }
      if (alive.length === 1) {
        finishGame(room, alive[0].playerIndex, loser);
        return { ok: true, finished: true };
      }
    }

    /* 다음 라운드로 자연스럽게 이어짐 — 게임(목숨)은 유지 */
    io.to(room.id).emit("game:roundReset", {
      reason: `한방 단어 '${word}'! ${loserPlayer.nickname}님이 하트 1개를 잃었습니다.`,
      mode: room.mode, roomId: room.id
    });
    startNewGame(room, { preserveHearts: true });
    return { ok: true, finished: true };
  }

  const nextAlive = findNextAlivePlayer(room, player.playerIndex);
  if (nextAlive === null) { finishGame(room, player.playerIndex, null); return { ok: true, finished: true }; }

  room.turnPlayerIndex = nextAlive;
  room.turnNumber++;
  startTurnTimer(room, room.gameSessionId);
  return { ok: true };
}

/* =========================================================
   AI 실행
========================================================= */

function runAI(room, gameSessionId) {
  if (!room || room.finished || !room.started || room.gameSessionId !== gameSessionId) return;
  if (room.mode !== "ai") return;
  const player = getPlayerByIndex(room, room.turnPlayerIndex);
  if (!player || !player.isBot || player.eliminated) return;
  if (room.turnPlayerIndex !== player.playerIndex) return;

  let word;
  const difficulty = room.difficulty || "normal";
  if (room.turnNumber === 0) {
    if (difficulty === "easy") {
      /* 쉬움: 시작 음절에 맞는 안전한 단어를 무작위로 — 희귀 루트/공격·한방 단어를 노리지 않고
         방어 단어는 절대 시작하지 않는다. 돌림 단어면 그것을 우선한다 */
      const legal = getCandidates(room.startSyllable || "", room.usedWords, WORD_INDEX)
        .filter(w => w.startsWith(room.startSyllable)
          && !isAttackWord(w, ATTACK_DEPTH)
          && !isOneShot(w, room.usedWords, WORD_INDEX)
          && !DEFENSE_WORDS.has(w));
      const dolrimStart = legal.filter(w => DOLRIM_WORDS.has(w));
      const pool = dolrimStart.length > 0 ? dolrimStart : legal;
      word = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    } else {
      word = chooseAIStartWord(room.startSyllable || "", room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, DEFENSE_WORDS, ROOT_WORDS, RARE_ROOT_WORDS, DOLRIM_WORDS);
    }
  } else {
    if (difficulty === "easy") {
      /* 쉬움: 즉시 한방이 열리면 잡고, 아니면 무작위 — 강제승리 유도나 희귀 루트를 쓰지 않아
         전략 싸움에 약하다 */
      const candidates = getCandidates(room.currentWord, room.usedWords, WORD_INDEX);
      if (candidates.length === 0) word = null;
      else {
        const winners = candidates.filter(w => isOneShot(w, room.usedWords, WORD_INDEX));
        word = winners.length > 0
          ? winners[Math.floor(Math.random() * winners.length)]
          : candidates[Math.floor(Math.random() * candidates.length)];
      }
    } else {
      /* 보통: 기존 최강 전략. 어려움: 강제 승리 탐색을 더 넓게/깊게 하고 최선의 수에 가깝게 결정.
         freeTurns: 앞 N턴 공격/한방 금지 규칙을 AI 선택기도 지키게 한다 */
      word = chooseAIWord(room.currentWord, room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, room.turnNumber, DEFENSE_WORDS, RARE_ROOT_WORDS, DOLRIM_WORDS, { strong: difficulty === "hard", freeTurns: ONESHOT_FREE_TURNS });
    }
  }

  if (!word) {
    finishGame(room, findNextAlivePlayer(room, player.playerIndex), player.playerIndex);
    return;
  }
  if (room.turnNumber > 0 && room.currentWord && !canConnect(room.currentWord, word)) {
    const fallbackPool = getCandidates(room.currentWord, room.usedWords, WORD_INDEX);
    const valid = fallbackPool.find(w => canConnect(room.currentWord, w));
    if (valid) word = valid;
    else { finishGame(room, findNextAlivePlayer(room, player.playerIndex), player.playerIndex); return; }
  }
  const result = playWord(room, player, word, gameSessionId);
  if (!result.ok && result.penalty) {
    if (room.turnNumber === 0) {
      /* 이미 시도한 단어를 피해 다른 시작 단어로 재시도 */
      const blocked = new Set(room.usedWords);
      blocked.add(word);
      const retry = chooseAIStartWord(room.startSyllable || "", blocked, WORD_SET, WORD_INDEX, ATTACK_DEPTH, DEFENSE_WORDS, ROOT_WORDS, RARE_ROOT_WORDS, DOLRIM_WORDS);
      if (retry) playWord(room, player, retry, gameSessionId);
    } else {
      let fallbackPool = getCandidates(room.currentWord || "", room.usedWords, WORD_INDEX)
        .filter(w => canConnect(room.currentWord || "", w));
      /* 앞 N턴 금지 규칙이 걸린 재시도도 공격/한방/방어 단어는 다시 거부되므로
         같은 규칙을 통과하는 후보만 남긴다(금지 대상만 걸러내고 전부 걸리면 원래 풀 유지) */
      if (room.turnNumber < ONESHOT_FREE_TURNS) {
        const legalNow = fallbackPool.filter(w =>
          !isAttackWord(w, ATTACK_DEPTH) && !isOneShot(w, room.usedWords, WORD_INDEX) && !DEFENSE_WORDS.has(w));
        if (legalNow.length) fallbackPool = legalNow;
      }
      if (fallbackPool.length > 0) {
        const retry = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
        playWord(room, player, retry, gameSessionId);
      }
    }
  }
}

/* =========================================================
   방 나가기
========================================================= */

function removePlayer(room, socketId, reason) {
  if (!room) return;
  const index = room.players.findIndex(p => p.socketId === socketId);
  if (index === -1) return;
  const player = room.players[index];
  if (player.isBot) return;

  if (room.started && !room.finished) {
    player.eliminated = true;
    player.connected = false;
    if (reason !== "kick") {
      io.to(room.id).emit("room:playerLeft", { playerIndex: player.playerIndex, nickname: player.nickname, reason });
    }

    const alive = getAlivePlayers(room);
    if (room.mode === "party") {
      if (checkPartyEnd(room)) return;
    } else if (alive.length <= 1) {
      finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, player.playerIndex);
      return;
    }
    if (room.turnPlayerIndex === player.playerIndex) {
      const next = findNextAlivePlayer(room, player.playerIndex);
      if (next !== null) { room.turnPlayerIndex = next; room.turnNumber++; startTurnTimer(room, room.gameSessionId); }
    } else if (room.timer == null) {
      /* 비차례 플레이어의 재접속 유예가 끝나도 남은 플레이어의 타이머를 복구한다. */
      startTurnTimer(room, room.gameSessionId);
    }
  } else {
    room.players.splice(index, 1);
    for (let i = index; i < room.players.length; i++) room.players[i].playerIndex = i;

    /* 남은 유저에게 자기 playerIndex 재전달 — 로비에서 인덱스가 밀린 경우 대응 */
    for (const p of room.players) {
      if (p.isBot || !p.connected || !p.socketId) continue;
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.emit("room:playerIndex", { playerIndex: p.playerIndex });
    }
  }

  if (room.hostSocketId === socketId) {
    const firstHuman = room.players.find(p => !p.isBot && p.connected);
    if (firstHuman) room.hostSocketId = firstHuman.socketId;
  }

  broadcastRoomState(room);
}

/* =========================================================
   정적 파일
========================================================= */

app.use(express.static(CLIENT_DIR));

app.get("/", (req, res) => {
  for (const file of [path.join(CLIENT_DIR, "index.html"), path.join(ROOT_DIR, "index.html")]) {
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  res.status(404).send("index.html을 찾을 수 없습니다.");
});

/* 우리말샘 쿼터 보호 — 캐시 적중 여부와 무관하게 IP당 분당 요청 수를 제한한다.
   라우트 미들웨어로 분리해 핸들러 단위 테스트에는 영향을 주지 않는다. */
const DICTIONARY_RATE_WINDOW_MS = 60 * 1000;
const DICTIONARY_RATE_MAX = 60;
const dictionaryRateBuckets = new Map();
let dictionaryRateSweepAt = 0;

function dictionaryRateLimit(req, res, next) {
  const now = Date.now();
  if (now >= dictionaryRateSweepAt) {
    for (const [key, bucket] of dictionaryRateBuckets) {
      if (now - bucket.startedAt >= DICTIONARY_RATE_WINDOW_MS) dictionaryRateBuckets.delete(key);
    }
    dictionaryRateSweepAt = now + DICTIONARY_RATE_WINDOW_MS;
  }

  const key = String(req.ip || req.socket?.remoteAddress || "unknown");
  let bucket = dictionaryRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= DICTIONARY_RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    dictionaryRateBuckets.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count > DICTIONARY_RATE_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + DICTIONARY_RATE_WINDOW_MS - now) / 1000));
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      ok: false,
      reason: `뜻 조회 요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해 주세요.`,
    });
  }
  return next();
}

async function handleDictionaryDefinition(req, res) {
  const word = normalizeWord(String(req.query.word || ""));
  if (!/^[가-힣]{2,40}$/.test(word)) {
    return res.status(400).json({ ok: false, reason: "한글 두 음절 이상, 40자 이하로 입력해 주세요." });
  }
  if (!WORD_SET.has(word)) {
    return res.status(404).json({ ok: false, reason: "게임 사전에서 찾을 수 없는 단어입니다." });
  }

  const cached = getCachedDictionaryDefinition(word);
  if (cached) {
    return res.json({ ok: true, word, entries: cached.entries, source: cached.source, cached: true });
  }

  const apiKey = String(process.env.OPENDICT_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({ ok: false, reason: "우리말샘 API 키가 서버에 설정되지 않았습니다." });
  }

  try {
    let lookup = DICTIONARY_INFLIGHT.get(word);
    const joinedLookup = !!lookup;
    if (!lookup) {
      lookup = fetchOpenDictionaryEntries(word, apiKey, fetch, AbortSignal.timeout(8000));
      DICTIONARY_INFLIGHT.set(word, lookup);
    }
    let entries;
    try {
      entries = await lookup;
    } finally {
      if (!joinedLookup && DICTIONARY_INFLIGHT.get(word) === lookup) DICTIONARY_INFLIGHT.delete(word);
    }
    cacheDictionaryDefinition(word, entries);
    return res.json({ ok: true, word, entries, source: "우리말샘", cached: joinedLookup });
  } catch (error) {
    console.warn("우리말샘 뜻 조회 실패:", error.message);
    return res.status(502).json({ ok: false, reason: "우리말샘 사전 조회에 실패했습니다. 잠시 후 다시 시도해 주세요." });
  }
}

app.get("/api/dictionary/definition", dictionaryRateLimit, handleDictionaryDefinition);

/* ---------------------------------------------------------
   리플레이 공유 저장소 — PG kv_store + JSON 파일 미러
--------------------------------------------------------- */
const REPLAY_SHARE_LIMIT = 500;
const REPLAY_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REPLAY_SHARE_PATH = path.join(RUNTIME_DATA_DIR || path.join(ROOT_DIR, "data"), "replay-shares.json");
const replayShareCache = { loaded: false, map: new Map() };

async function loadReplayShares() {
  if (replayShareCache.loaded) return replayShareCache.map;
  replayShareCache.loaded = true;
  try {
    const raw = await loadStoreJSON("replayShares", REPLAY_SHARE_PATH, {});
    const now = Date.now();
    for (const [token, entry] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
      if (!replayShare.isToken(token) || !entry || typeof entry !== "object") continue;
      if (!(Number(entry.expiresAt) > now) || !Array.isArray(entry.flow)) continue;
      replayShareCache.map.set(token, entry);
    }
  } catch (err) {
    console.warn("리플레이 공유 저장소 읽기 실패:", err.message);
  }
  return replayShareCache.map;
}

function persistReplayShares() {
  const raw = {};
  for (const [token, entry] of replayShareCache.map) raw[token] = entry;
  try {
    fs.mkdirSync(path.dirname(REPLAY_SHARE_PATH), { recursive: true });
    fs.writeFileSync(REPLAY_SHARE_PATH, JSON.stringify(raw));
  } catch (err) {
    console.warn("리플레이 공유 저장소 쓰기 실패:", err.message);
  }
  if (dbMode === "pg") pgStoreSet("replayShares", raw);
}

/* 운영 지표는 기본 비공개다. METRICS_TOKEN을 설정하고 x-metrics-token 헤더로 접근하거나,
   같은 호스트에서 프록시를 거치지 않고 직접 호출할 때만 열린다.
   프록시 뒤에서는 req.ip가 사설 주소로 보이므로 IP 대역 허용은 쓰지 않는다 —
   Render 같은 환경에서는 외부 요청도 사설 주소로 도착해 그대로 통과한다. */
const METRICS_TOKEN = String(process.env.METRICS_TOKEN || "").trim();

function isLoopbackAddress(value) {
  let ip = String(value || "").trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip === "::1" || /^127\./.test(ip);
}

function metricsTokenMatches(given) {
  if (!METRICS_TOKEN) return false;
  const a = Buffer.from(String(given || ""), "utf8");
  const b = Buffer.from(METRICS_TOKEN, "utf8");
  if (a.length !== b.length) return false;
  return require("crypto").timingSafeEqual(a, b);
}

function metricsAccess(req, res, next) {
  if (metricsTokenMatches(req.get("x-metrics-token"))) return next();
  const proxied = !!(
    req.headers["x-forwarded-for"] ||
    req.headers["x-forwarded-host"] ||
    req.headers["forwarded"]
  );
  if (!proxied && isLoopbackAddress(req.socket && req.socket.remoteAddress)) return next();
  res.status(404).json({ ok: false });
}

/* 운영 지표 — 방/대기열/메모리를 한 번에 볼 수 있게 한다. */
app.get("/api/metrics", metricsAccess, (req, res) => {
  res.set("cache-control", "no-store");
  res.json({
    ok: true,
    commit: BUILD_COMMIT,
    uptime: process.uptime(),
    rooms: ROOMS.size,
    online: onlineNicks.size,
    players: playerCache.size,
    rankedQueue: RANKED_QUEUE.length,
    tournamentQueue: TOURNAMENT_QUEUE.length,
    db: dbMode,
    push: pushManager.isEnabled(),
    cluster: cluster.health(),
    memory: process.memoryUsage()
  });
});

/* 공유 리플레이 조회 — 토큰은 30일 뒤 만료되며 내부 ID는 저장하지 않는다. */
app.get("/api/replay/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "");
    if (!replayShare.isToken(token)) {
      res.status(400).json({ ok: false, reason: "잘못된 링크입니다." });
      return;
    }
    const shares = await loadReplayShares();
    const entry = shares.get(token);
    if (!entry || !(Number(entry.expiresAt) > Date.now())) {
      res.status(404).json({ ok: false, reason: "만료되었거나 없는 리플레이입니다." });
      return;
    }
    res.set("cache-control", "no-store");
    res.json({ ok: true, replay: { flow: entry.flow, createdAt: entry.createdAt } });
  } catch (err) {
    console.error("리플레이 조회 오류:", err.message);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/cluster/status", metricsAccess, async (req, res) => {
  res.set("cache-control", "no-store");
  res.json({
    ok: true,
    ...cluster.health(),
    nodes: await cluster.listNodes(dbPool),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true, commit: BUILD_COMMIT,
    words: WORD_SET.size, attackWords: Object.keys(ATTACK_DEPTH).length,
    rooms: ROOMS.size, customApproved: customWords.approved.length,
    customPending: customWords.pending.length, seasonId: currentSeasonKey(),
    db: dbMode === "pg" ? "postgres" : "json",
    firebase: firebaseReady,
    dataDir: RUNTIME_DATA_DIR || null,
    uptime: process.uptime(),
    cluster: cluster.health(),
    push: pushManager.isEnabled(),
  });
});

/* 웹 푸시 공개키 — 브라우저가 구독할 때만 사용하며 개인키는 절대 내려보내지 않는다. */
app.get("/api/push/publicKey", (req, res) => {
  res.json({
    ok: true,
    enabled: pushManager.isEnabled(),
    publicKey: pushManager.getPublicKey()
  });
});

/* 시즌 정보 — 아래의 단일 /api/season 핸들러(월 단위 buildSeasonInfo)가 응답한다 */

app.get("/api/leaderboard", async (req, res) => {
  try {
    const rawMode = String(req.query.mode || "multi");
    const mode = ["multi", "single", "ranked", "money", "streak", "tier", "firebase"].includes(rawMode)
      ? rawMode : (rawMode === "ai" ? "single" : "multi");
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "10"), 10) || 10));
    /* 고스트/중복 필터링 뒤에도 limit만큼 채우기 위해 넉넉히 가져온 뒤 자른다 */
    const fetchN = Math.min(200, limit * 4 + 25);
    /* 동점자는 같은 순위를 받는다(dense rank) — rating/wins가 모두 같으면 동점 */
    const applyDenseRank = (list, keyFn) => {
      let rank = 0;
      let prev = null;
      return list.map((r) => {
        const k = keyFn(r);
        if (prev === null || k !== prev) { rank += 1; prev = k; }
        return { ...r, rank };
      });
    };

    /* 시즌 모드 — 현재 시즌(season) 또는 지난 시즌 아카이브(?seasonId 지정).
       시즌은 매월 1일로 전환되는 월 단위. 현재 시즌은 해당 시즌에 1판 이상
       랭크 게임을 한 플레이어를 현재 랭크 레이팅 순으로, 지난 시즌은
       종료 시 집계 기록(seasonStore.history)에서 조회한다. */
    if (rawMode === "season" || rawMode === "seasonHistory") {
      const seasonKey = String(req.query.seasonId || "");
      let entries;
      if (seasonKey) {
        const hist = getSeasonStore().history.find(h => h.season === seasonKey);
        entries = hist ? (hist.top || []).filter(t => !isPlaceholderNickname(t.nickname)).map(t => ({
          id: t.nickname, nickname: t.nickname,
          rating: Number(t.rating) || 0, wins: Number(t.wins) || 0,
          losses: Number(t.losses) || 0,
          games: (Number(t.wins) || 0) + (Number(t.losses) || 0),
          streak: 0
        })) : [];
      } else {
        const key = currentSeasonKey();
        entries = (await listAllPlayers())
          .filter(p => p.season && p.season.season === key && (p.season.games || 0) > 0 && !isPlaceholderNickname(p.nickname))
          .map(p => ({
            id: p.id, nickname: p.nickname || "플레이어",
            rating: Number(p.season.rating) || 1000,
            wins: p.season.wins || 0, losses: p.season.losses || 0,
            games: p.season.games || 0, streak: p.season.bestStreak || 0,
            email: p.firebaseEmail || p.email || ""
          }));
      }
      const seenNicks = new Set();
      const rows = applyDenseRank(entries
        .filter(r => {
          const k = String(r.nickname || "").trim();
          if (!k) return true;
          if (seenNicks.has(k)) return false;
          seenNicks.add(k);
          return true;
        })
        .sort((a, b) => ((Number(b.rating) || 0) - (Number(a.rating) || 0)) || ((Number(b.games) || 0) - (Number(a.games) || 0)))
        .slice(0, limit)
        .map((r) => ({
          id: r.id, nickname: r.nickname,
          mode: seasonKey ? "seasonHistory" : "season",
          ranking: Number(r.rating) || 0, wins: Number(r.wins) || 0, losses: Number(r.losses) || 0,
          money: 0, streak: Number(r.streak) || 0, bestStreak: Number(r.streak) || 0,
          games: Number(r.games) || 0,
          isAdmin: isAdminEmail(r.email),
          tier: calculateRank(Number(r.rating) || 0)
        })), r => `${r.ranking}|${r.wins}`);
      return res.json(rows);
    }

    /* Firebase(Firestore) 리더보드 — '파이어' 탭. 랭크 레이팅 순으로 서버가
       주기적으로 미러링한 점수를 정렬해 돌려준다. */
    if (rawMode === "firebase") {
      if (!firebaseReady) return res.json([]);
      try {
        await flushFirebaseScores();
        const snap = await firebaseDb.collection("leaderboards")
          .orderBy("ranked.rating", "desc").limit(limit).get();
        let fbRank = 0;
        let fbPrev = null;
        const fbRows = snap.docs.map((doc) => {
          const v = doc.data() || {};
          const rating = Number(v.ranked && v.ranked.rating) || 1000;
          const wins = Number(v.ranked && v.ranked.wins) || 0;
          const k = `${rating}|${wins}`;
          if (fbPrev === null || k !== fbPrev) { fbRank += 1; fbPrev = k; }
          return {
            id: doc.id, nickname: v.nickname || "플레이어", mode: "firebase",
            ranking: rating,
            wins,
            losses: Number(v.ranked && v.ranked.losses) || 0,
            money: Number(v.money) || 0,
            streak: Number(v.ranked && v.ranked.streak) || 0,
            bestStreak: Number(v.ranked && v.ranked.bestStreak) || 0,
            isAdmin: isAdminEmail(v.email),
            rank: fbRank, tier: calculateRank(rating)
          };
        });
        return res.json(fbRows);
      } catch (err) {
        console.error("Firebase 리더보드 오류:", err.message);
        return res.json([]);
      }
    }

    let rows = [];
    if (dbMode === "pg") {
      let sql;
      let params = [AI_PLAYER_ID, fetchN];
      if (mode === "money") {
        sql = `SELECT id, nickname, money AS stat_rating, 0 AS stat_wins, 0 AS stat_losses,
                      money AS stat_money, 0 AS stat_streak, 0 AS stat_best_streak,
                      firebase_email AS stat_email
               FROM players WHERE id <> $1 ORDER BY money DESC, nickname ASC LIMIT $2`;
      } else if (mode === "streak") {
        sql = `SELECT id, nickname, ranked_rating AS stat_rating, ranked_wins AS stat_wins,
                      ranked_losses AS stat_losses, 0 AS stat_money,
                      ranked_streak AS stat_streak, ranked_best_streak AS stat_best_streak,
                      firebase_email AS stat_email
               FROM players WHERE id <> $1
               ORDER BY ranked_best_streak DESC, ranked_rating DESC, nickname ASC LIMIT $2`;
      } else {
        const isRanked = mode === "ranked" || mode === "tier";
        const isSingle = mode === "single";
        const col = isRanked ? "ranked_rating" : isSingle ? "single_rating" : "rating";
        const winCol = isRanked ? "ranked_wins" : isSingle ? "single_wins" : "wins";
        const lossCol = isRanked ? "ranked_losses" : isSingle ? "single_losses" : "losses";
        const stCol = mode === "multi" ? "streak" : (isRanked ? "ranked_streak" : "0");
        const bstCol = mode === "multi" ? "best_streak" : (isRanked ? "ranked_best_streak" : "0");
        sql = `SELECT id, nickname, ${col} AS stat_rating, ${winCol} AS stat_wins, ${lossCol} AS stat_losses,
                      0 AS stat_money, ${stCol} AS stat_streak,
                      ${bstCol} AS stat_best_streak, firebase_email AS stat_email
               FROM players WHERE id <> $1 ORDER BY ${col} DESC, ${winCol} DESC, nickname ASC LIMIT $2`;
      }
      rows = (await dbPool.query(sql, params)).rows;
    } else {
      rows = [...playerCache.values()]
        .filter(p => p && p.id !== AI_PLAYER_ID)
        .map(p => {
          let s;
          if (mode === "money") {
            s = { rating: p.money, wins: 0, losses: 0, streak: 0, bestStreak: 0, money: p.money };
          } else {
            const rk = (mode === "ranked" || mode === "streak" || mode === "tier") ? p.ranked
                     : mode === "single" ? p.single : p.multi;
            const useStreak = mode === "ranked" || mode === "streak" || mode === "tier" || mode === "multi";
            const m = rk || { rating: 1000, wins: 0, losses: 0 };
            s = {
              rating: m.rating, wins: m.wins, losses: m.losses,
              streak: useStreak ? (m.streak || 0) : 0,
              bestStreak: useStreak ? (m.bestStreak || 0) : 0,
              money: p.money
            };
          }
          return { id: p.id, nickname: p.nickname, ...s, stat_email: p.firebaseEmail || p.email || "" };
        })
        .sort((a, b) => {
          if (mode === "streak") return (b.bestStreak - a.bestStreak) || ((b.rating || 1000) - (a.rating || 1000)) || String(a.nickname || "").localeCompare(String(b.nickname || ""));
          const da = (mode === "money" ? a.money : a.rating) || 0;
          const db = (mode === "money" ? b.money : b.rating) || 0;
          if (db !== da) return db - da;
          return ((b.wins || 0) - (a.wins || 0)) || String(a.nickname || "").localeCompare(String(b.nickname || ""));
        })
        .slice(0, fetchN)
        .map(r => ({
          id: r.id, nickname: r.nickname, stat_rating: r.rating, stat_wins: r.wins, stat_losses: r.losses,
          stat_money: r.money, stat_streak: r.streak, stat_best_streak: r.bestStreak,
          stat_email: r.stat_email || ""
        }));
    }
    /* 같은 닉네임(같은 계정)이 좀비 레코드 때문에 중복 집계되는 것을 방지.
       정렬은 위에서 끝났으므로 닉네임당 첫 번째(최고 순위) 레코드만 남긴다.
       이름 없는 고스트('플레이어' 등)는 리더보드에서 제외한다. */
    if (mode === "tier") {
      const TIER_IDX = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Grandmaster", "Challenger"];
      rows.sort((a, b) => {
        const ia = TIER_IDX.indexOf(calculateRank(a.stat_rating).tier);
        const ib = TIER_IDX.indexOf(calculateRank(b.stat_rating).tier);
        return (ib - ia) || (b.stat_rating - a.stat_rating);
      });
    }
    const seenNicks = new Set();
    const filtered = rows.filter(r => {
      const k = String(r.nickname || "").trim();
      if (isPlaceholderNickname(k)) return false;
      if (seenNicks.has(k)) return false;
      seenNicks.add(k);
      return true;
    }).slice(0, limit);
    const ranked = applyDenseRank(filtered.map((r) => ({
      id: r.id, nickname: r.nickname, mode,
      ranking: r.stat_rating, wins: r.stat_wins, losses: r.stat_losses,
      money: r.stat_money || 0,
      streak: r.stat_streak || 0, bestStreak: r.stat_best_streak || 0,
      isAdmin: isAdminEmail(r.stat_email),
      tier: (mode === "money" || mode === "streak") ? null : calculateRank(r.stat_rating)
    })), r => mode === "money" ? `${r.money}`
      : mode === "streak" ? `${r.bestStreak}|${r.ranking}`
      : `${r.ranking}|${r.wins}`);
    res.json(ranked);
  } catch (err) {
    console.error("리더보드 조회 오류:", err.message);
    res.status(500).json({ ok: false, error: "리더보드를 불러오지 못했습니다." });
  }
});

app.get("/api/season", async (req, res) => {
  try {
    await ensureSeasonRollover();
    res.json(buildSeasonInfo());
  } catch (err) {
    console.error("시즌 정보 조회 오류:", err.message);
    res.status(500).json({ ok: false, error: "시즌 정보를 불러오지 못했습니다." });
  }
});

/* 닉네임으로 플레이어 조회 (JSON DB / PostgreSQL 공통) — 소켓 핸들러·레퍼럴 공용 */
async function findPlayerIdByNickname(nickname) {
  if (dbMode === "pg") {
    const result = await dbPool.query("SELECT id FROM players WHERE nickname = $1 LIMIT 1", [nickname]);
    return result.rows.length ? result.rows[0].id : null;
  }
  for (const [id, p] of playerCache) {
    if (String(p?.nickname || "").trim() === nickname) return id;
  }
  return null;
}

/* 같은 닉네임의 모든 레코드 조회 — 소켓 ID는 재접속마다 바뀌므로 좀비 레코드가 여러 개
   남아 랭킹에 같은 유저가 중복 표시되는 것을 막는다 */
async function findAllPlayerIdsByNickname(nickname) {
  if (dbMode === "pg") {
    try {
      const result = await dbPool.query("SELECT id FROM players WHERE nickname = $1", [nickname]);
      return result.rows.map(r => r.id);
    } catch (err) { console.error("닉네임 레코드 조회 오류:", err.message); return []; }
  }
  const ids = [];
  for (const [id, p] of playerCache) {
    if (String(p?.nickname || "").trim() === nickname) ids.push(id);
  }
  return ids;
}

/* =========================================================
   Socket.IO 이벤트
========================================================= */

io.on("connection", (socket) => {
  console.log(`[CONNECT] ${socket.id}`);
  /* 기본값은 '보는 중' — 첫 visibility 이벤트가 오기 전까지 불필요한 푸시를 막는다. */
  socket.data.visible = true;
  socket.on("client:visibility", (data) => {
    socket.data.visible = data?.visible !== false;
  });

  socket.emit("server:ready", {
    ok: true, words: WORD_SET.size, attackWords: Object.keys(ATTACK_DEPTH).length,
    maxPlayers: MAX_PLAYERS, turnTime: TURN_TIME, maxHearts: MAX_HEARTS,
    customApproved: customWords.approved.length, customPending: customWords.pending.length
  });

  socket.on("room:create", async (data) => {
    try {
      const nickname = normalizeWord(data?.nickname) || "플레이어";
      /* 2v2 파티 모드 제거 — ai(싱글/실습) 또는 일반 방만 생성된다 */
      const mode = data?.mode === "ai" ? "ai" : "online";
      /* 싱글 난이도 — 잘못된 값이면 보통으로 폴백 */
      const difficulty = ["easy", "normal", "hard"].includes(data?.difficulty) ? data.difficulty : "normal";
      const banMsg = banGuard(nickname);
      if (banMsg) { socket.emit("room:error", { ok: false, reason: banMsg, banned: true }); return; }
      leaveRoomForSocket(socket, "recreate");

      const room = createRoom(socket.id, nickname, mode, {
        difficulty,
        practice: mode === "ai" && data?.practice === true
      });
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerIndex = 0;
      socket.data.playerId = socket.id;
      registerOnline(socket.id, nickname);

      socket.emit("room:created", { ok: true, roomId: room.id, playerIndex: 0, state: getPublicRoomState(room) });

      if (mode === "ai") {
        addBot(room);
        startNewGame(room);
      }

      broadcastRoomState(room);
      console.log(`[ROOM CREATE] ${room.id} / ${socket.id}`);
    } catch (error) {
      console.error("room:create 오류:", error);
      socket.emit("room:error", { ok: false, reason: "방을 생성하지 못했습니다." });
    }
  });

  socket.on("room:join", (data) => {
    try {
      const roomId = String(data?.roomId || "").trim().toUpperCase();
      const nickname = normalizeWord(data?.nickname) || "플레이어";
      if (!roomId) { socket.emit("room:error", { ok: false, reason: "방 코드를 입력해주세요." }); return; }
      const banMsg = banGuard(nickname);
      if (banMsg) { socket.emit("room:error", { ok: false, reason: banMsg, banned: true }); return; }

      const room = ROOMS.get(roomId);
      if (!room) { socket.emit("room:error", { ok: false, reason: "방을 찾을 수 없습니다." }); return; }

      const existing = room.players.find(p => p.socketId === socket.id);
      if (existing) {
        if (removeSpectator(room, socket.id)) broadcastSpectators(room);
        existing.connected = true;
        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.playerIndex = existing.playerIndex;
        socket.data.playerId = socket.id;
        socket.emit("room:joined", { ok: true, roomId: room.id, playerIndex: existing.playerIndex, reconnect: true, waiting: existing.waiting, state: getPublicRoomState(room) });
        broadcastRoomState(room);
        return;
      }

      /* 연결이 끊긴 플레이어를 같은 닉네임(새 소켓)으로 복귀 — 30초 유예 안에 오면
         게임이 이어진다. 이전 소켓의 유예 타이머를 해제하고 자리를 대체한다. */
      const reconnected = room.players.find(p => !p.isBot && !p.connected && normKey(p.nickname) === normKey(nickname));
      if (reconnected) {
        if (removeSpectator(room, socket.id)) broadcastSpectators(room);
        const oldId = reconnected.socketId;
        reconnected.socketId = socket.id;
        reconnected.id = socket.id;
        reconnected.connected = true;
        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.playerIndex = reconnected.playerIndex;
        socket.data.playerId = socket.id;
        registerOnline(socket.id, nickname);
        const prev = disconnectedPlayers.get(oldId);
        if (prev) { clearTimeout(prev.timer); disconnectedPlayers.delete(oldId); }
        disconnectedPlayers.delete(socket.id);
        if (room.started && !room.finished) {
          stopTurnTimer(room);
          startTurnTimer(room, room.gameSessionId);
        }
        socket.emit("room:joined", { ok: true, roomId: room.id, playerIndex: reconnected.playerIndex, reconnect: true, waiting: reconnected.waiting, state: getPublicRoomState(room) });
        io.to(room.id).emit("room:playerJoined", { playerIndex: reconnected.playerIndex, nickname, reconnect: true, state: getPublicRoomState(room) });
        broadcastRoomState(room);
        return;
      }

      const nicknameExists = room.players.some(p => !p.isBot && p.nickname === nickname);
      if (nicknameExists) {
        socket.emit("room:error", { ok: false, reason: `"${nickname}" 닉네임은 이미 사용 중입니다.` });
        return;
      }
      /* 정원 검사는 기존 좌석의 재접속 처리 후에 한다. */
      if (room.players.filter(p => !p.isBot).length >= roomCapacity(room)) {
        socket.emit("room:error", { ok: false, reason: "방이 가득 찼습니다." }); return;
      }
      /* 파티(2v2) 진행 중에는 새로 들어올 수 없다 — 대기 없이 정원 4명 채워
         시작하는 방이므로 중간 합류는 팀 균형을 깨뜨린다 */
      if (room.mode === "party" && room.started && !room.finished) {
        socket.emit("room:error", { ok: false, reason: "파티 게임이 진행 중입니다. 잠시 후 다시 입장해 주세요." });
        return;
      }

      /* 입장 확정 전에 이전 방(싱글/AI 방 포함)에서 분리 — 한 소켓이 여러 방에
         남아 이벤트가 섞이는 것을 막는다. 재접속(existing) 경로에는 적용하지 않는다 */
      leaveRoomForSocket(socket, "leave");

      const isMidGame = room.started && !room.finished;

      const bots = room.players.filter(p => p.isBot);
      if (bots.length > 0) {
        const turnHolder = room.started && !room.finished ? getPlayerByIndex(room, room.turnPlayerIndex) : null;
        for (const bot of bots) {
          const botIdx = room.players.indexOf(bot);
          room.players.splice(botIdx, 1);
          for (let i = botIdx; i < room.players.length; i++) room.players[i].playerIndex = i;
        }
        /* 봇이 제거된 경우 턴 포인터를 정정 — 진행 중이면 타이머 재시작 */
        if (room.started && !room.finished) {
          let turnPlayer = turnHolder ? room.players[room.players.indexOf(turnHolder)] : null;
          if (!turnPlayer || turnPlayer.eliminated || turnPlayer.isBot) {
            const next = findNextAlivePlayer(room, room.turnPlayerIndex);
            turnPlayer = next != null ? getPlayerByIndex(room, next) : null;
            if (next != null) room.turnNumber++;
          }
          if (turnPlayer) {
            room.turnPlayerIndex = turnPlayer.playerIndex;
            stopTurnTimer(room);
            startTurnTimer(room, room.gameSessionId);
          } else {
            finishGame(room, null, room.turnPlayerIndex);
            return;
          }
        }
      }

      const player = addPlayer(room, socket.id, nickname);
      if (!player) { socket.emit("room:error", { ok: false, reason: "방에 입장할 수 없습니다." }); return; }

      if (isMidGame) {
        player.waiting = true;
        player.alive = false;
        player.eliminated = true;
      }

      /* AI(싱글) 방에 두 번째 사람이 들어오면 멀티플레이 방으로 전환 */
      if (room.mode === "ai") room.mode = "online";

      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerIndex = player.playerIndex;
      socket.data.playerId = socket.id;
      registerOnline(socket.id, nickname);

      socket.emit("room:joined", {
        ok: true, roomId: room.id, playerIndex: player.playerIndex,
        waiting: isMidGame, state: getPublicRoomState(room)
      });
      io.to(room.id).emit("room:playerJoined", {
        playerIndex: player.playerIndex, nickname: player.nickname,
        waiting: isMidGame, state: getPublicRoomState(room)
      });

      broadcastRoomState(room);
      console.log(`[ROOM JOIN] ${room.id} / ${socket.id} / player ${player.playerIndex}`);
    } catch (error) {
      console.error("room:join 오류:", error);
      socket.emit("room:error", { ok: false, reason: "방에 입장하지 못했습니다." });
    }
  });

  socket.on("room:joinRandom", () => {
    try {
      const candidates = [];
      for (const room of ROOMS.values()) {
        if (room.mode !== "online") continue;
        if (room.started || room.finished) continue;
        const humans = room.players.filter(p => !p.isBot);
        if (humans.length >= MAX_PLAYERS) continue;
        if (humans.some(p => p.socketId === socket.id)) continue;
        if (room.modeId === "ranked") continue;
        candidates.push(room);
      }
      if (candidates.length === 0) {
        socket.emit("room:joinRandom", { ok: false, reason: "현재 입장 가능한 방이 없습니다. 방을 만들어 보세요!" });
        return;
      }
      const room = candidates[Math.floor(Math.random() * candidates.length)];
      socket.emit("room:joinRandom", { ok: true, roomId: room.id, host: room.players[0] ? room.players[0].nickname : "" });
    } catch (error) {
      console.error("room:joinRandom 오류:", error);
    }
  });

  socket.on("game:word", (data) => {
    try {
      const room = getPlayerRoom(socket);
      if (!room) { socket.emit("game:error", { ok: false, reason: "게임 방에 참여하지 않았습니다." }); return; }
      if (room.finished || !room.started) {
        socket.emit("game:error", { ok: false, reason: "게임이 진행 중이 아닙니다." });
        socket.emit("game:state", getPublicRoomState(room));
        return;
      }
      const player = getPlayerBySocket(room, socket.id);
      if (!player) {
        socket.emit("game:error", { ok: false, reason: "플레이어를 찾을 수 없습니다." });
        socket.emit("game:state", getPublicRoomState(room));
        return;
      }
      if (player.eliminated) {
        socket.emit("game:error", { ok: false, reason: "탈락한 플레이어입니다." });
        socket.emit("game:state", getPublicRoomState(room));
        return;
      }

      const word = data?.word ?? data?.inputWord ?? "";
      const result = playWord(room, player, word, room.gameSessionId);

      if (!result.ok) {
        if (result.penalty) {
          player.mistakes = (player.mistakes || 0) + 1;
          let heartLost = false;
          if (player.mistakes >= MISTAKES_PER_LIFE) {
            player.mistakes = 0;
            player.hearts--;
            heartLost = true;
            if (player.hearts <= 0) { player.hearts = 0; player.eliminated = true; }
          }
          socket.emit("game:error", {
            ok: false, reason: result.reason, hearts: player.hearts,
            allowed: result.allowed || null, mistakes: player.mistakes, mistakesPerLife: MISTAKES_PER_LIFE,
            heartLost
          });
          broadcastRoomState(room);
          if (room.finished) return;
          const alive = getAlivePlayers(room);
          if (room.mode === "party") {
            if (checkPartyEnd(room)) return;
          } else {
            if (alive.length === 0) { finishGame(room, null, null); return; }
            if (alive.length === 1) {
              finishGame(room, alive[0].playerIndex, player.playerIndex);
              return;
            }
          }
          if (player.eliminated) {
            const next = findNextAlivePlayer(room, player.playerIndex);
            if (next !== null) { room.turnPlayerIndex = next; room.turnNumber++; startTurnTimer(room, room.gameSessionId); }
          } else if (heartLost) {
            /* 실수 누적으로 하트를 잃어도 새 시작 음절로 라운드를 다시 시작한다
               (기존 단어 유지로 같은 음절 한방을 노리는 흐름 차단) */
            io.to(room.id).emit("game:roundReset", { reason: "하트 1개를 잃었습니다. 새 라운드를 시작합니다.", mode: room.mode, roomId: room.id });
            startNewGame(room, { preserveHearts: true, firstPlayer: player.playerIndex });
          }
          /* 일반 실수(하트 손실 아님): 터닝 시간을 초기화하지 않고 이번 턴의 20초를 유지 */
        } else {
          socket.emit("game:error", { ok: false, reason: result.reason });
          /* 상태 불일치(차례/종료/세션 등) — 클라이언트가 나는 상태로 헛치지 않도록 즉시 재동기화 */
          if (/(차례|시작되지 않았습니다|이미 끝났습니다|이전 게임|찾을 수 없습니다|탈락한 플레이어|참여하지 않았습니다|진행 중이 아닙니다)/.test(result.reason || "")) {
            socket.emit("game:state", getPublicRoomState(room));
          }
        }
      }
    } catch (error) {
      console.error("game:word 오류:", error);
      socket.emit("game:error", { ok: false, reason: "단어 처리 중 오류가 발생했습니다." });
    }
  });

  socket.on("game:hint", () => {
    try {
      const room = getPlayerRoom(socket);
      if (!room) { socket.emit("game:hint", { ok: false, reason: "게임 방에 참여하지 않았습니다." }); return; }
      if (room.mode !== "ai") { socket.emit("game:hint", { ok: false, reason: "싱글플레이에서만 힌트를 사용할 수 있습니다." }); return; }
      if (!room.started || room.finished) { socket.emit("game:hint", { ok: false, reason: "게임이 진행 중이 아닙니다." }); return; }
      const player = getPlayerBySocket(room, socket.id);
      if (!player) { socket.emit("game:hint", { ok: false, reason: "플레이어를 찾을 수 없습니다." }); return; }
      if (player.eliminated) { socket.emit("game:hint", { ok: false, reason: "탈락한 플레이어입니다." }); return; }
      if (room.turnPlayerIndex !== player.playerIndex) { socket.emit("game:hint", { ok: false, reason: "지금은 당신의 차례가 아닙니다." }); return; }
      if ((room.hintsUsed || 0) >= HINTS_PER_GAME) {
        socket.emit("game:hint", { ok: false, reason: `힌트를 모두 사용했습니다. (이번 판 ${HINTS_PER_GAME}개 제한)` });
        return;
      }

      let candidates;
      if (room.turnNumber === 0) {
        const syllable = room.startSyllable || "";
        candidates = getCandidates(syllable, room.usedWords, WORD_INDEX)
          .filter(w => w.startsWith(syllable)
            && !isAttackWord(w, ATTACK_DEPTH)
            && !isOneShot(w, room.usedWords, WORD_INDEX)
            && !DEFENSE_WORDS.has(w));
      } else {
        /* 사람에게 가장 유리한 수를 권한다 — AI가 가장 받아치기 어려운 수
           (기존: AI의 최선의 수 = 사람에게 가장 불리한 수를 주던 문제 수정)
           방어 단어는 따돌리기용 난해한 단어라 추천하지 않는다 */
        const all = getCandidates(room.currentWord, room.usedWords, WORD_INDEX);
        candidates = all.filter(w => !DEFENSE_WORDS.has(w));
        if (candidates.length === 0) candidates = all;
      }

      if (candidates.length === 0) { socket.emit("game:hint", { ok: false, reason: "힌트를 찾을 수 없습니다." }); return; }

      /* '최선의 수' — 상대 선택지를 가장 적게 주는 단어를 권한다.
         후보가 많으면 샘플링해 검색 비용을 한정한다 */
      const HINT_SAMPLE = 150;
      let sample = candidates;
      if (candidates.length > HINT_SAMPLE) {
        sample = [...candidates];
        for (let i = sample.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sample[i], sample[j]] = [sample[j], sample[i]];
        }
        sample = sample.slice(0, HINT_SAMPLE);
      }

      let word;
      if (room.turnNumber === 0) {
        let best = sample[0];
        let bestCount = Infinity;
        for (const c of sample) {
          const n = getCandidates(c, room.usedWords, WORD_INDEX).length;
          if (n < bestCount) { bestCount = n; best = c; }
        }
        word = best;
      } else {
        /* 1순위: 즉시 승리(한방) — AI가 응답 불가 */
        const oneshots = sample.filter(w => isOneShot(w, room.usedWords, WORD_INDEX));
        if (oneshots.length > 0) {
          word = oneshots[0];
        } else {
          /* 2순위: AI 응답 선택지를 가장 적게 주는 수 */
          let best = sample[0];
          let bestCount = Infinity;
          for (const c of sample) {
            const n = getCandidates(c, room.usedWords, WORD_INDEX).length;
            if (n < bestCount) { bestCount = n; best = c; }
          }
          word = best;
        }
      }
      room.hintsUsed = (room.hintsUsed || 0) + 1;
      socket.emit("game:hint", { ok: true, word, hintsUsed: room.hintsUsed, hintsLeft: HINTS_PER_GAME - room.hintsUsed, mode: room.mode });
      broadcastRoomState(room);
    } catch (error) {
      console.error("game:hint 오류:", error);
      socket.emit("game:hint", { ok: false, reason: "힌트 처리 중 오류가 발생했습니다." });
    }
  });

  socket.on("game:start", () => {
    try {
      const room = getPlayerRoom(socket);
      if (!room) return;
      if (room.mode !== "online" && room.mode !== "party") {
        socket.emit("game:error", { ok: false, reason: "온라인 모드에서만 시작할 수 있습니다." });
        return;
      }
      if (room.hostSocketId !== socket.id) {
        socket.emit("game:error", { ok: false, reason: "방장만 게임을 시작할 수 있습니다." });
        return;
      }
      const hostPlayer = room.players.find(p => p.id === socket.id);
      if (hostPlayer && hostPlayer.eliminated) {
        socket.emit("game:error", { ok: false, reason: "탈락한 플레이어는 게임을 시작할 수 없습니다." });
        return;
      }
      if (room.started && !room.finished) {
        socket.emit("game:error", { ok: false, reason: "이미 게임이 진행 중입니다." });
        return;
      }
      const eligible = room.players.filter(p => !p.isBot && p.connected);
      if (eligible.length < 2) {
        socket.emit("game:error", { ok: false, reason: "최소 2명 이상의 연결된 플레이어가 필요합니다." });
        return;
      }
      const partyErr = partyReadyError(room, eligible);
      if (partyErr) { socket.emit("game:error", { ok: false, reason: partyErr }); return; }
      startNewGame(room);
      console.log(`[GAME START] ${room.id} by ${socket.id}`);
    } catch (error) { console.error("game:start 오류:", error); }
  });

  socket.on("game:restart", () => {
    try {
      const room = getPlayerRoom(socket);
      if (!room) return;
      if (room.mode === "tournament") {
        socket.emit("game:error", { ok: false, reason: "대회 경기는 다시 시작할 수 없습니다. 새 대회에 참가해주세요." });
        return;
      }
      if (room.hostSocketId !== socket.id) {
        socket.emit("game:error", { ok: false, reason: "방장만 게임을 다시 시작할 수 있습니다." });
        return;
      }
      if (!room.finished) {
        socket.emit("game:error", { ok: false, reason: "게임이 아직 종료되지 않았습니다." });
        return;
      }
      const hostPlayer = room.players.find(p => p.id === socket.id);
      if (hostPlayer && hostPlayer.eliminated) {
        socket.emit("game:error", { ok: false, reason: "탈락한 플레이어는 게임을 시작할 수 없습니다." });
        return;
      }
      const eligible = room.players.filter(p => !p.isBot && p.connected);
      if (eligible.length < 2) {
        socket.emit("game:error", { ok: false, reason: "최소 2명 이상의 연결된 플레이어가 필요합니다." });
        return;
      }
      const partyErr = partyReadyError(room, eligible);
      if (partyErr) { socket.emit("game:error", { ok: false, reason: partyErr }); return; }
      startNewGame(room);
      console.log(`[GAME RESTART] ${room.id}`);
    } catch (error) { console.error("game:restart 오류:", error); }
  });

  socket.on("room:leave", () => {
    try {
      REMATCHES.delete(socket.id);
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = ROOMS.get(roomId);
      if (!room) { socket.data.roomId = null; socket.data.spectating = false; return; }
      socket.leave(roomId);
      socket.leave(spectatorChannel(room));
      if (removeSpectator(room, socket.id)) {
        broadcastSpectators(room);
        broadcastRoomState(room);
        socket.data.roomId = null;
        socket.data.playerIndex = null;
        socket.data.spectating = false;
        socket.emit("room:left", { ok: true, spectate: true });
        /* 남은 플레이어가 없으면 방을 닫고 남은 관전자도 정리한다 */
        const remaining = room.players.filter(p => !p.isBot && p.connected);
        if (remaining.length === 0) { clearSpectators(room, "closed"); stopTurnTimer(room); ROOMS.delete(room.id); }
        return;
      }
      removePlayer(room, socket.id, "leave");
      /* 연결된 실제 플레이어가 아무도 없으면 방 즉시 정리 —
         싱글(AI) 방은 인간이 나가도 좀비로 남아 이벤트를 뿜는 문제 방지 */
      const realConnected = room.players.filter(p => !p.isBot && p.connected);
      if (realConnected.length === 0) {
        clearSpectators(room, "closed");
        stopTurnTimer(room);
        ROOMS.delete(room.id);
      }
      socket.data.roomId = null;
      socket.data.playerIndex = null;
      socket.data.spectating = false;
      socket.emit("room:left", { ok: true });
    } catch (error) { console.error("room:leave 오류:", error); }
  });

  /* 관전 — 방 채널에만 참가해 상태/단어/종료 이벤트를 받는다(입력 불가, 플레이어로는 안 들어감) */
  function spectateRoom(socket, room) {
    if (!room) { socket.emit("room:error", { ok: false, reason: "방이 존재하지 않습니다." }); return; }
    /* 제재 중인 계정은 관전 채널에도 들어오지 못하게 한다. */
    const banMsg = banGuard(socketNicks.get(socket.id) || "")
      || banGuardByUid(socketFirebaseUid.get(socket.id) || "");
    if (banMsg) { socket.emit("room:error", { ok: false, reason: banMsg, banned: true }); return; }
    if (room.mode === "ai") { socket.emit("room:error", { ok: false, reason: "싱글(AI) 게임은 관전할 수 없습니다." }); return; }
    if (room.finished) { socket.emit("room:error", { ok: false, reason: "이미 종료된 방입니다." }); return; }
    if (room.players.some(p => p.socketId === socket.id)) {   /* 이미 플레이어면 그대로 유지 */
      socket.emit("room:spectating", {
        ok: true, roomId: room.id, alreadyPlaying: true,
        spectatorCount: ensureSpectatorState(room).size,
        spectators: spectatorList(room),
        state: getPublicRoomState(room)
      });
      return;
    }
    const spectators = ensureSpectatorState(room);
    if (spectators.has(socket.id)) {
      socket.emit("room:spectating", {
        ok: true, roomId: room.id, spectatorCount: spectators.size,
        spectators: spectatorList(room), state: getPublicRoomState(room)
      });
      return;
    }
    if (spectators.size >= MAX_SPECTATORS) {
      socket.emit("room:error", { ok: false, reason: "관전 인원이 가득 찼습니다." });
      return;
    }
    leaveRoomForSocket(socket, "leave");   /* 이전 방(플레이어/관전)에서 분리 */
    socket.join(room.id);
    socket.join(spectatorChannel(room));
    socket.data.roomId = room.id;
    socket.data.playerIndex = null;
    socket.data.spectating = true;
    spectators.set(socket.id, {
      nickname: socketNicks.get(socket.id) || "관전자",
      joinedAt: new Date().toISOString()
    });
    socket.emit("room:spectating", {
      ok: true, roomId: room.id, spectatorCount: spectators.size,
      spectators: spectatorList(room), state: getPublicRoomState(room)
    });
    broadcastSpectators(room);
    broadcastRoomState(room);
  }

  socket.on("room:spectate", (data) => {
    try {
      spectateRoom(socket, ROOMS.get(String(data?.roomId || "")));
    } catch (error) { console.error("room:spectate 오류:", error); }
  });

  /* 친구 관전 — 온라인 친구의 현재 방을 찾아 관전 채널에 합류 */
  socket.on("friends:spectate", (data) => {
    try {
      const key = normKey(String(data?.nickname || ""));
      const me = normKey(socketNicks.get(socket.id) || "");
      /* 친구 목록에 있는 계정만 친구 방을 관전할 수 있다 — 닉네임을 직접 넣어
         아무 방이나 여는 것을 서버에서 막는다. */
      if (!me || !key || !(friendsMap.get(me) || new Set()).has(key)) {
        socket.emit("room:error", { ok: false, reason: "친구만 관전할 수 있습니다." });
        return;
      }
      const friendSocketId = onlineNicks.get(key);
      const fsocket = friendSocketId ? io.sockets.sockets.get(friendSocketId) : null;
      const roomId = fsocket && fsocket.data.roomId;
      if (!roomId || !ROOMS.has(roomId)) {
        socket.emit("room:error", { ok: false, reason: "친구가 지금 방에 있지 않습니다." });
        return;
      }
      spectateRoom(socket, ROOMS.get(roomId));
    } catch (error) { console.error("friends:spectate 오류:", error); }
  });

  /* 커스텀 사전 — 사용자가 새 단어를 신청한다. 신청 검증 후 pending에 추가하고,
   관리자가 승인하면 게임 사전에 반영된다. */
  socket.on("word:request", (data) => {
    try {
      const nickname = normalizeWord(socketNicks.get(socket.id) || data?.nickname || "");
      if (!nickname) { socket.emit("word:requestResult", { ok: false, reason: "닉네임을 먼저 저장해주세요." }); return; }

      const raw = normalizeWord(String(data?.word || ""));
      if (raw.length < 2 || raw.length > 40) {
        socket.emit("word:requestResult", { ok: false, reason: "단어는 2~40자 사이여야 합니다." }); return;
      }
      if (!/^[가-힣]+$/.test(raw)) {
        socket.emit("word:requestResult", { ok: false, reason: "한글 단어만 신청할 수 있습니다." }); return;
      }
      if (hasWord(raw, WORD_SET) || customWords.approved.some(w => w === raw)) {
        socket.emit("word:requestResult", { ok: false, reason: "이미 사전에 있는 단어입니다." }); return;
      }
      if (customWords.pending.some(p => p.word === raw)) {
        socket.emit("word:requestResult", { ok: false, reason: "이미 승인 대기 중인 단어입니다." }); return;
      }

      customWords.pending.push({ word: raw, by: nickname, at: Date.now(), socketId: socket.id });
      saveCustomWords();
      socket.emit("word:requestResult", {
        ok: true, word: raw, message: `'${raw}' 단어가 승인 대기 목록에 추가되었습니다.`,
        pendingCount: customWords.pending.length
      });
      console.log(`[WORD REQUEST] ${nickname} → '${raw}' (대기 ${customWords.pending.length})`);
    } catch (error) { console.error("word:request 오류:", error); }
  });

  /* 커스텀 사전 목록 — 내 신청 상태 + 승인된 단어 수를 제공한다 */
  socket.on("word:list", (data) => {
    try {
      const nickname = normalizeWord(data?.nickname || socketNicks.get(socket.id) || "");
      socket.emit("word:listResult", {
        ok: true,
        pending: nickname
          ? customWords.pending.filter(p => normalizeWord(p.by) === normalizeWord(nickname)).map(p => ({ word: p.word, status: "pending", at: p.at }))
          : [],
        rejected: nickname
          ? customWords.rejected.filter(r => normalizeWord(r.by) === normalizeWord(nickname)).map(r => ({ word: r.word, status: "rejected", at: r.at, reason: r.reason }))
          : [],
        approvedTotal: customWords.approved.length
      });
    } catch (error) { console.error("word:list 오류:", error); }
  });

  /* 방 목록 브라우저 — 온라인 멀티 방(미종료)을 공개 목록으로 제공한다.
     AI(싱글) 방과 랭크 매칭 방은 제외하고, 호스트/인원/시작 여부만 노출한다. */
  socket.on("room:list", () => {
    try {
      const rooms = [...ROOMS.values()]
        .filter(r => r && (r.mode === "online" || r.mode === "party") && !r.finished)
        .map(r => {
          const humans = r.players.filter(p => !p.isBot);
          const host = humans.find(p => p.socketId === r.hostSocketId) || humans[0] || null;
          return {
            roomId: r.id,
            host: host ? host.nickname : "플레이어",
            playerCount: r.players.filter(p => !p.isBot && !p.waiting).length,
            maxPlayers: roomCapacity(r),
            party: r.mode === "party",
            teams: r.mode === "party"
              ? { 0: r.players.filter(p => p.teamOf === 0 && !p.isBot).length, 1: r.players.filter(p => p.teamOf === 1 && !p.isBot).length }
              : null,
            started: !!r.started,
            spectatorCount: ensureSpectatorState(r).size
          };
        });
      socket.emit("room:list", { ok: true, rooms });
    } catch (error) {
      console.error("room:list 오류:", error);
      socket.emit("room:list", { ok: false, reason: "방 목록을 불러오지 못했습니다." });
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[DISCONNECT] ${socket.id} / ${reason}`);
    adminAuthed.delete(socket.id);
    socketFirebaseUid.delete(socket.id);
    socketFirebaseEmail.delete(socket.id);
    REMATCHES.delete(socket.id);
    cancelRankedInvitesFor(socket.id);
    removeFromRankedQueue(socket.id);
    removeFromTournamentQueue(socket.id);
    broadcastRankedQueue();
    broadcastTournamentQueue();
    RECOVERY_ATTEMPTS.delete(socket.id);
    const hadNick = socketNicks.has(socket.id);
    unregisterOnline(socket.id);
    /* 이름 없이 접속했다 끊긴 고스트 레코드 정리 — 랭킹이 '플레이어'로 오염되는 것 방지 */
    if (!hadNick && playerCache.has(socket.id)) {
      const ghost = playerCache.get(socket.id);
      if (isGhostRecord(ghost)) {
        playerCache.delete(socket.id);
        if (dbMode !== "pg") saveJsonDb();
      }
    }
    const room = getPlayerRoom(socket);
    if (!room) return;
    /* 관전자 연결 종료 — 방 상태/관전자 수만 갱신하고 플레이어 처리로 가지 않는다 */
    if (removeSpectator(room, socket.id)) {
      socket.data.spectating = false;
      broadcastSpectators(room);
      broadcastRoomState(room);
      const remaining = room.players.filter(p => !p.isBot && p.connected);
      if (remaining.length === 0) { clearSpectators(room, "closed"); stopTurnTimer(room); ROOMS.delete(room.id); }
      return;
    }
    const player = getPlayerBySocket(room, socket.id);
    if (player) {
      if (room.started && !room.finished) {
        player.connected = false;
        io.to(room.id).emit("room:playerDisconnected", { playerIndex: player.playerIndex, nickname: player.nickname });
        broadcastRoomState(room);
        if (room.mode === "ai") {
          /* 싱글(AI) 방은 재접속 의미가 없으므로 즉시 정리 — 좀비 방 방지 */
          stopTurnTimer(room);
          ROOMS.delete(room.id);
        } else {
          /* 온라인·랭크 — 30초 안에 같은 닉네임으로 재접속하면 게임이 그대로 이어진다.
             재접속이 없으면 유예가 끝난 뒤 퇴장(=패배)으로 처리한다 */
          stopTurnTimer(room);
          room.turnStartedAt = null;
          room.turnEndsAt = null;
          const prev = disconnectedPlayers.get(socket.id);
          if (prev) clearTimeout(prev.timer);
          const timer = setTimeout(() => {
            disconnectedPlayers.delete(socket.id);
            const r2 = ROOMS.get(room.id);
            if (!r2 || r2.finished || r2.mode === "ai") return;
            const p2 = getPlayerBySocket(r2, socket.id);
            if (!p2 || p2.connected) return;
            removePlayer(r2, socket.id, "disconnect");
            const realConnected = r2.players.filter(x => !x.isBot && x.connected);
            if (realConnected.length === 0) { clearSpectators(r2, "closed"); stopTurnTimer(r2); ROOMS.delete(r2.id); }
            broadcastRoomState(r2);
          }, RECONNECT_GRACE_MS);
          disconnectedPlayers.set(socket.id, { roomId: room.id, nickname: player.nickname || "", timer });
        }
      } else {
        removePlayer(room, socket.id, "disconnect");
        const realPlayers = room.players.filter(p => !p.isBot);
        if (realPlayers.length === 0) { clearSpectators(room, "closed"); stopTurnTimer(room); ROOMS.delete(room.id); }
      }
    }
  });

  socket.on("room:state", () => {
    const room = getPlayerRoom(socket);
    if (room) socket.emit("game:state", getPublicRoomState(room));
  });

  /* -- 실시간 랭크 게임 매칭 ----------------------------- */
  socket.on("ranked:queue", async () => {
    try {
      /* 랭킹 게이트 — Google 로그인 세션 없이는 랭크 매치에 들어올 수 없다 (게스트는 싱글/멀티만) */
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("ranked:queueStatus", { ok: false, reason: "랭킹은 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      REMATCHES.delete(socket.id);
      cancelRankedInvitesFor(socket.id);
      const wasTournamentQueued = TOURNAMENT_QUEUE_MAP.has(socket.id);
      removeFromTournamentQueue(socket.id);
      broadcastTournamentQueue();
      if (wasTournamentQueued) socket.emit("tournament:queueStatus", { ok: true, queued: false });
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "플레이어").trim();
      if (!nickname) { socket.emit("ranked:queueStatus", { ok: false, reason: "닉네임을 먼저 설정해주세요." }); return; }
      const banMsg = banGuard(nickname);
      if (banMsg) { socket.emit("ranked:queueStatus", { ok: false, reason: banMsg, banned: true }); return; }
      /* 매칭 대기 중 이전 방 게임이 계속 돌아가는 것을 막기 위해 현재 방에서 분리 */
      leaveRoomForSocket(socket, "leave");
      socket.emit("room:left", { ok: true });
      if (!addToRankedQueue(socket.id, nickname, pd.ranked.rating)) {
        socket.emit("ranked:queueStatus", { ok: true, queued: true, reason: "이미 매칭 대기 중입니다." });
        return;
      }
      registerOnline(socket.id, nickname);
      socket.emit("ranked:queueStatus", { ok: true, queued: true });
      broadcastRankedQueue();
      tryMatchRanked();
    } catch (err) { console.error("랭크 매칭 오류:", err); }
  });

  socket.on("ranked:cancel", () => {
    REMATCHES.delete(socket.id);
    removeFromRankedQueue(socket.id);
    socket.emit("ranked:queueStatus", { ok: true, queued: false });
    broadcastRankedQueue();
  });

  /* -- 4인 랭크 대회 ------------------------------------- */
  socket.on("tournament:queue", async () => {
    try {
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("tournament:queueStatus", { ok: false, reason: "랭크 대회는 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "플레이어").trim();
      if (!nickname || isGhostRecord(pd)) { socket.emit("tournament:queueStatus", { ok: false, reason: "닉네임을 먼저 설정해주세요." }); return; }
      const banMsg = banGuard(nickname);
      if (banMsg) { socket.emit("tournament:queueStatus", { ok: false, reason: banMsg, banned: true }); return; }
      leaveRoomForSocket(socket, "leave");
      socket.emit("room:left", { ok: true });
      const wasRankedQueued = RANKED_QUEUE_MAP.has(socket.id);
      removeFromRankedQueue(socket.id);
      cancelRankedInvitesFor(socket.id);
      broadcastRankedQueue();
      if (wasRankedQueued) socket.emit("ranked:queueStatus", { ok: true, queued: false });
      if (!addToTournamentQueue(socket.id, nickname, Number(pd.ranked && pd.ranked.rating) || 1000)) {
        socket.emit("tournament:queueStatus", { ok: true, queued: true, reason: "이미 대회 대기 중입니다." });
        return;
      }
      registerOnline(socket.id, nickname);
      socket.emit("tournament:queueStatus", { ok: true, queued: true });
      broadcastTournamentQueue();
      tryMatchTournament();
    } catch (err) {
      console.error("대회 매칭 오류:", err);
      socket.emit("tournament:queueStatus", { ok: false, reason: "대회 매칭에 실패했습니다." });
    }
  });

  socket.on("tournament:cancel", () => {
    removeFromTournamentQueue(socket.id);
    socket.emit("tournament:queueStatus", { ok: true, queued: false });
    broadcastTournamentQueue();
  });

  /* -- 랭크 복수전 (다시 대결) --------------------------- */
  socket.on("ranked:rematch", async () => {
    try {
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("ranked:rematchStatus", { ok: false, reason: "랭킹은 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      const room = getPlayerRoom(socket);
      if (!room || room.mode !== "ranked" || !room.finished) {
        socket.emit("ranked:rematchStatus", { ok: false, reason: "복수전을 신청할 수 있는 상태가 아닙니다." });
        return;
      }
      const me = room.players.find(p => p.socketId === socket.id);
      const opp = room.players.find(p => p.socketId !== socket.id && !p.isBot && p.connected);
      const opponentSocket = opp ? io.sockets.sockets.get(opp.socketId) : null;
      if (!me || !opp || !opponentSocket) return;

      if (REMATCHES.get(opp.socketId) === socket.id) {
        /* 상대가 이미 복수전을 신청한 상태 → 즉시 그 둘끼리 다시 매칭 */
        REMATCHES.delete(opp.socketId);
        REMATCHES.delete(socket.id);
        const [pdMe, pdOpp] = await Promise.all([getPlayerData(socket.id), getPlayerData(opp.socketId)]);
        startRankedGame(
          { socketId: socket.id, nickname: pdMe.nickname || me.nickname || "플레이어", rating: pdMe.ranked.rating },
          { socketId: opp.socketId, nickname: pdOpp.nickname || opp.nickname || "플레이어", rating: pdOpp.ranked.rating }
        );
      } else {
        REMATCHES.set(socket.id, opp.socketId);
        const pdMe = await getPlayerData(socket.id);
        socket.emit("ranked:rematchStatus", { ok: true, waiting: true, opponent: opp.nickname });
        opponentSocket.emit("ranked:rematchOffer", {
          from: pdMe.nickname || me.nickname || "플레이어", roomId: room.id
        });
        console.log(`[REMATCH] ${me.nickname} → ${opp.nickname} (신청)`);
      }
    } catch (err) { console.error("복수전 신청 오류:", err); }
  });

  socket.on("ranked:rematchCancel", () => {
    REMATCHES.delete(socket.id);
    socket.emit("ranked:rematchStatus", { ok: true, waiting: false });
  });

  /* -- 랭크 대결 초대 (2인전) — 친구를 지명해 랭크 매치를 시작한다.
     수락하면 기존 랭크 매치와 동일하게 레이팅/돈/일일 미션이 적용된다 ---------- */
  socket.on("ranked:invite", async (data) => {
    try {
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("ranked:inviteSent", { ok: false, reason: "랭킹은 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      const pd = await getPlayerData(socket.id);
      const myNick = String(pd.nickname || "플레이어").trim();
      const target = String(data?.nickname || "").trim();
      if (!myNick) { socket.emit("ranked:inviteSent", { ok: false, reason: "닉네임을 먼저 설정해주세요." }); return; }
      if (!target) { socket.emit("ranked:inviteSent", { ok: false, reason: "초대할 닉네임을 입력해주세요." }); return; }
      const tId = onlineNicks.get(normKey(target));
      if (!tId || tId === socket.id || !io.sockets.sockets.has(tId)) {
        socket.emit("ranked:inviteSent", { ok: false, reason: `'${target}' 님이 현재 온라인이 아닙니다.` });
        return;
      }
      if (RANKED_QUEUE_MAP.has(socket.id)) {
        socket.emit("ranked:inviteSent", { ok: false, reason: "매칭 대기 중에는 초대를 보낼 수 없습니다. 매칭을 먼저 취소해주세요." });
        return;
      }
      if (RANKED_QUEUE_MAP.has(tId)) {
        socket.emit("ranked:inviteSent", { ok: false, reason: `'${target}' 님이 현재 매칭 대기 중이라 초대를 받을 수 없습니다.` });
        return;
      }
      if (RANKED_INVITES.has(socket.id)) {
        socket.emit("ranked:inviteSent", { ok: false, reason: "이미 보낸 랭크 초대가 있습니다. 먼저 취소해주세요." });
        return;
      }
      if ([...RANKED_INVITES.values()].some(inv => inv.targetSocketId === tId)) {
        socket.emit("ranked:inviteSent", { ok: false, reason: `'${target}' 님에게 이미 도착한 랭크 초대가 있습니다.` });
        return;
      }

      RANKED_INVITES.set(socket.id, { targetSocketId: tId, from: myNick, fromRating: pd.ranked.rating, at: Date.now() });
      const tSocket = io.sockets.sockets.get(tId);
      if (tSocket) tSocket.emit("ranked:inviteReceived", { from: myNick, fromRating: pd.ranked.rating });
      socket.emit("ranked:inviteSent", { ok: true, nickname: target });
      console.log(`[RANKED INVITE] '${myNick}'(${pd.ranked.rating}) → '${target}'`);
    } catch (err) { console.error("랭크 초대 오류:", err); }
  });

  socket.on("ranked:inviteCancel", () => {
    const inv = RANKED_INVITES.get(socket.id);
    if (inv) {
      RANKED_INVITES.delete(socket.id);
      const tSocket = io.sockets.sockets.get(inv.targetSocketId);
      if (tSocket) tSocket.emit("ranked:inviteCanceled", { from: inv.from });
    }
    socket.emit("ranked:inviteSent", { ok: true, canceled: true });
  });

  socket.on("ranked:inviteAccept", async () => {
    try {
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("ranked:inviteStatus", { ok: false, reason: "랭킹은 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      let found = null;
      for (const [inviter, inv] of RANKED_INVITES) {
        if (inv.targetSocketId === socket.id) { found = { inviter, inv }; break; }
      }
      if (!found) { socket.emit("ranked:inviteStatus", { ok: false, reason: "받은 랭크 초대가 없거나 이미 만료되었습니다." }); return; }

      /* 초대 중 상대가 매칭 대기/게임에 들어갔을 수 있으므로 재확인 후 매치 시작 */
      if (RANKED_QUEUE_MAP.has(found.inviter) || RANKED_QUEUE_MAP.has(socket.id)) {
        RANKED_INVITES.delete(found.inviter);
        socket.emit("ranked:inviteStatus", { ok: false, reason: "한쪽이 이미 매칭에 들어가 초대가 취소되었습니다." });
        return;
      }

      const inviterSocket = io.sockets.sockets.get(found.inviter);
      const meSocket = io.sockets.sockets.get(socket.id);
      if (!inviterSocket || !meSocket) {
        RANKED_INVITES.delete(found.inviter);
        return;
      }
      RANKED_INVITES.delete(found.inviter);

      const [pdInviter, pdMe] = await Promise.all([getPlayerData(found.inviter), getPlayerData(socket.id)]);
      const inviterNick = String(pdInviter.nickname || found.inv.from || "플레이어").trim();
      const meNick = String(pdMe.nickname || "플레이어").trim();
      if (!inviterNick) {
        socket.emit("ranked:inviteStatus", { ok: false, reason: "초대자가 닉네임을 설정하지 않았습니다." });
        return;
      }
      startRankedGame(
        { socketId: found.inviter, nickname: inviterNick, rating: pdInviter.ranked.rating },
        { socketId: socket.id, nickname: meNick, rating: pdMe.ranked.rating }
      );
    } catch (err) { console.error("랭크 초대 수락 오류:", err); }
  });

  socket.on("ranked:inviteReject", () => {
    for (const [inviter, inv] of RANKED_INVITES) {
      if (inv.targetSocketId === socket.id) {
        RANKED_INVITES.delete(inviter);
        const inviterSocket = io.sockets.sockets.get(inviter);
        if (inviterSocket) inviterSocket.emit("ranked:inviteRejected", { from: inv.from });
        socket.emit("ranked:inviteStatus", { ok: true, rejected: true });
        return;
      }
    }
    socket.emit("ranked:inviteStatus", { ok: false, reason: "받은 랭크 초대가 없습니다." });
  });

  /* -- 시즌 정보 ----------------------------------------- */
  /* -- 웹 푸시 구독 ------------------------------------- */
  async function pushAccount(requireNick = true) {
    const pd = await getPlayerData(socket.id);
    const nickname = String(pd.nickname || "").trim();
    if (requireNick && (!nickname || isGhostRecord(pd))) return null;
    return { pd, account: normKey(nickname), nickname };
  }

  socket.on("push:status", async () => {
    try {
      const who = await pushAccount(false);
      /* 이름 없는 게스트는 '플레이어' 기본 레코드라 계정으로 취급하지 않는다. */
      const valid = !!(who && who.nickname && !isGhostRecord(who.pd));
      const account = valid ? who.account : "";
      socket.emit("push:status", { ...pushManager.status(account), hasNickname: valid });
    } catch (err) {
      console.error("푸시 상태 오류:", err);
      socket.emit("push:status", { ok: false, enabled: false, count: 0 });
    }
  });

  socket.on("push:subscribe", async (data) => {
    try {
      const who = await pushAccount(true);
      if (!who) { socket.emit("push:result", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const result = await pushManager.subscribe(who.account, data?.subscription);
      socket.emit("push:result", {
        ...result,
        count: pushManager.count(who.account),
        message: result.ok ? "이 기기에서 알림을 받습니다." : result.reason
      });
    } catch (err) {
      console.error("푸시 구독 오류:", err);
      socket.emit("push:result", { ok: false, reason: "알림 구독에 실패했습니다." });
    }
  });

  socket.on("push:unsubscribe", async (data) => {
    try {
      const who = await pushAccount(true);
      if (!who) { socket.emit("push:result", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const result = await pushManager.unsubscribe(who.account, data?.endpoint);
      socket.emit("push:result", { ...result, message: "알림을 해제했습니다." });
    } catch (err) {
      console.error("푸시 해제 오류:", err);
      socket.emit("push:result", { ok: false, reason: "알림 해제에 실패했습니다." });
    }
  });

  let pushTestAt = 0;
  socket.on("push:test", async () => {
    try {
      const now = Date.now();
      if (now - pushTestAt < 30000) {
        socket.emit("push:result", { ok: false, reason: "잠시 후 다시 시도해주세요." });
        return;
      }
      pushTestAt = now;
      const who = await pushAccount(true);
      if (!who) { socket.emit("push:result", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const sent = await pushManager.send(who.account, {
        title: "알림 테스트", body: "끝말잇기 알림이 정상적으로 도착했습니다.",
        url: "/", tag: "push-test"
      });
      socket.emit("push:result", {
        ok: sent.sent > 0,
        reason: sent.sent > 0 ? "" : "등록된 알림 구독이 없습니다.",
        message: sent.sent > 0 ? "테스트 알림을 보냈습니다." : "등록된 알림 구독이 없습니다."
      });
    } catch (err) {
      console.error("푸시 테스트 오류:", err);
      socket.emit("push:result", { ok: false, reason: "테스트 알림 전송에 실패했습니다." });
    }
  });

  socket.on("season:info", async () => {
    try {
      await ensureSeasonRollover();
      socket.emit("season:info", buildSeasonInfo());
    } catch (err) {
      console.error("시즌 정보 조회 오류:", err.message);
      socket.emit("season:info", { ok: false, error: "시즌 정보를 불러오지 못했습니다." });
    }
  });

  /* -- 출석체크 ----------------------------------------- */
  socket.on("attendance:status", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      const today = getKstDate();
      if (pd.lastCheckDate === today) {
        socket.emit("attendance:status", { ok: true, checkedToday: true, streak: pd.attendanceStreak || 0, nextReward: 0 });
        return;
      }
      const yesterday = getKstDate(Date.now() - 86400000);
      const continuing = pd.lastCheckDate === yesterday;
      /* 하루라도 건너뛰면 연속이 끊기므로, 대기 상태에서는 유효 연속만 보여준다 */
      const streak = continuing ? (pd.attendanceStreak || 0) : 0;
      const nextStreak = continuing ? (pd.attendanceStreak || 0) + 1 : 1;
      socket.emit("attendance:status", { ok: true, checkedToday: false, streak, nextReward: ATTENDANCE_REWARD(nextStreak) });
    } catch (err) { console.error("출석 상태 오류:", err); }
  });

  socket.on("attendance:check", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      const today = getKstDate();
      if (pd.lastCheckDate === today) {
        socket.emit("attendance:result", { ok: false, reason: "이미 오늘 출석했습니다.", checkedToday: true, streak: pd.attendanceStreak || 0 });
        return;
      }
      const yesterday = getKstDate(Date.now() - 86400000);
      const streak = pd.lastCheckDate === yesterday ? (pd.attendanceStreak || 0) + 1 : 1;
      const reward = ATTENDANCE_REWARD(streak);
      const accountId = normKey(pd.nickname) || normKey(socketNicks.get(socket.id)) || socket.id;
      const tx = await beginEconomyTx({
        accountId, idemKey: `attendance:${accountId}:${today}`,
        delta: reward, reason: "attendance", ref: today
      });
      if (!tx.ok) {
        socket.emit("attendance:result", { ok: false, reason: "이미 오늘 출석했습니다.", checkedToday: true, streak: pd.attendanceStreak || 0 });
        return;
      }
      pd.lastCheckDate = today;
      pd.attendanceStreak = streak;
      pd.money += reward;
      try {
        await savePlayerData(socket.id, pd);
        await finishEconomyTx(tx, pd.money);
      } catch (e) {
        await abortEconomyTx(tx);
        throw e;
      }
      socket.emit("attendance:result", { ok: true, reward, streak, money: pd.money, checkedToday: true });
      console.log(`[ATTENDANCE] ${String(pd.nickname || "플레이어")} ${today} ${streak}일차 +${reward}원`);
    } catch (err) { console.error("출석체크 오류:", err); }
  });

  /* -- 상점 --------------------------------------------- */
  socket.on("shop:list", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      socket.emit("shop:info", {
        ok: true,
        money: pd.money,
        moneyMultiplier: pd.moneyMultiplier,
        ratingBoostGames: pd.ratingBoostGames,
        titles: pd.titles,
        currentTitle: pd.currentTitle,
        titleCatalog: SHOP_TITLES,
        potionPrice: SHOP_POTION_PRICE,
        multiplierPrices: SHOP_MULTIPLIER_PRICES,
        shieldTickets: pd.shieldTickets || 0,
        shieldPrice: SHOP_SHIELD_PRICE,
        ratingHistory: pd.ratingHistory || [],
        isAdmin: isAdminPd(pd)
      });
    } catch (err) { console.error("상점 조회 오류:", err); }
  });

  /* -- 코인 원장 내역 ---------------------------------- */
  socket.on("economy:history", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      const accountId = normKey(pd.nickname) || normKey(socketNicks.get(socket.id)) || socket.id;
      const [history, summary] = await Promise.all([
        getEconomyHistory(accountId, 20),
        getEconomySummary(accountId)
      ]);
      socket.emit("economy:history", { ok: true, history, summary });
    } catch (err) {
      console.error("코인 내역 오류:", err);
      socket.emit("economy:history", { ok: false, reason: "코인 내역을 불러오지 못했습니다." });
    }
  });

  socket.on("shop:buyTitle", async (data) => {
    try {
      const titleId = String(data?.titleId || "");
      const title = SHOP_TITLES.find(t => t.id === titleId);
      if (!title) { socket.emit("shop:result", { ok: false, reason: "존재하지 않는 칭호입니다." }); return; }
      const pd = await getPlayerData(socket.id);
      if (pd.titles.some(t => t.id === titleId)) { socket.emit("shop:result", { ok: false, reason: "이미 보유한 칭호입니다." }); return; }
      if (pd.money < title.price) { socket.emit("shop:result", { ok: false, reason: "돈이 부족합니다." }); return; }
      const accountId = normKey(pd.nickname) || normKey(socketNicks.get(socket.id)) || socket.id;
      const tx = await beginEconomyTx({
        accountId, idemKey: `shop:title:${accountId}:${title.id}`,
        delta: -title.price, reason: "shop_title", ref: title.id
      });
      if (!tx.ok) {
        socket.emit("shop:result", { ok: false, reason: tx.duplicate ? "이미 구매한 칭호입니다." : "구매 기록에 실패했습니다." });
        return;
      }
      pd.money -= title.price;
      pd.titles.push({ id: title.id, name: title.name });
      pd.currentTitle = title.name;
      try {
        await savePlayerData(socket.id, pd);
        await finishEconomyTx(tx, pd.money);
      } catch (e) {
        await abortEconomyTx(tx);
        throw e;
      }
      socket.emit("shop:result", { ok: true, message: `칭호 '${title.name}'을 구매했습니다.`, money: pd.money, titles: pd.titles, currentTitle: pd.currentTitle });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
    } catch (err) { console.error("칭호 구매 오류:", err); }
  });

  socket.on("shop:setTitle", async (data) => {
    try {
      const titleId = String(data?.titleId || "");
      const pd = await getPlayerData(socket.id);
      let titleName = "";
      if (titleId === "t_admin") {
        if (!isAdminPd(pd)) { socket.emit("shop:result", { ok: false, reason: "관리자 전용 칭호입니다." }); return; }
        titleName = "관리자";
      } else {
        const title = pd.titles.find(t => t.id === titleId);
        if (!title) { socket.emit("shop:result", { ok: false, reason: "보유하지 않은 칭호입니다." }); return; }
        titleName = title.name;
      }
      pd.currentTitle = titleName;
      await savePlayerData(socket.id, pd);
      socket.emit("shop:result", { ok: true, message: `칭호 '${titleName}'(으)로 변경했습니다.`, currentTitle: pd.currentTitle, titles: pd.titles });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
      broadcastRoomState(getPlayerRoom(socket));
    } catch (err) { console.error("칭호 변경 오류:", err); }
  });

  socket.on("shop:unsetTitle", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      if (!pd.currentTitle) { socket.emit("shop:result", { ok: true, message: "장착 중인 칭호가 없습니다.", currentTitle: "" }); return; }
      pd.currentTitle = "";
      await savePlayerData(socket.id, pd);
      socket.emit("shop:result", { ok: true, message: "칭호를 해제했습니다.", currentTitle: "" });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
      broadcastRoomState(getPlayerRoom(socket));
    } catch (err) { console.error("칭호 해제 오류:", err); }
  });

  /* -- 업적 목록 (해금 상태 + 총계) --------------------- */
  socket.on("achievements:list", async () => {
    try {
      const nickname = socketNicks.get(socket.id);
      if (!nickname) { socket.emit("achievements:list", { ok: false, reason: "닉네임을 먼저 설정해주세요." }); return; }
      const accountId = normKey(nickname);
      const pd = await getPlayerData(accountId);
      achievementStats(pd);
      const newAch = evaluateAchievements(pd);   /* 로그인 중 미션/승수 변화로 해금이 밀린 경우 보완 */
      await savePlayerData(accountId, pd);
      if (newAch.length) await recordAchievementLedger(accountId, newAch, pd.money);
      socket.emit("achievements:list", {
        ok: true,
        list: achievementDefs().map(d => ({ ...d, unlockedAt: pd.achievements[d.id] || null })),
        totals: { ...pd.ach },
        unlockedCount: Object.keys(pd.achievements).length
      });
    } catch (error) { console.error("achievements:list 오류:", error); }
  });

  socket.on("missions:status", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      const daily = initDailyData(pd.daily, getKstDate());
      const weekly = initWeeklyData(pd.weekly, getKstWeek());
      const monthly = initMonthlyData(pd.monthly, getKstMonth());
      socket.emit("missions:status", {
        ok: true,
        periods: {
          daily: daily.date,
          weekly: weekly.date,
          monthly: monthly.date,
          weeklyRange: kstWeekRange(),
          monthlyRange: kstMonthRange()
        },
        daily,
        missions: buildMissionProgress(DAILY_MISSIONS, daily),
        groups: {
          daily: buildMissionProgress(DAILY_MISSIONS, daily),
          weekly: buildMissionProgress(WEEKLY_MISSIONS, weekly),
          monthly: buildMissionProgress(MONTHLY_MISSIONS, monthly)
        }
      });
    } catch (err) { console.error("미션 조회 오류:", err); }
  });

  socket.on("missions:claim", async (data) => {
    try {
      const group = (data?.group === "weekly" || data?.group === "monthly") ? data.group : "daily";
      const missionId = String(data?.id || "");
      const mission = missionListOf(group).find(m => m.id === missionId);
      if (!mission) { socket.emit("missions:result", { ok: false, reason: "알 수 없는 미션입니다." }); return; }
      const pd = await getPlayerData(socket.id);
      const periodKey = missionKeyOf(group);
      const store = initPeriodData(pd[group], periodKey);
      if (store.claimed.includes(missionId)) { socket.emit("missions:result", { ok: false, reason: "이미 수령한 보상입니다." }); return; }
      if (missionCurrent(mission, store) < mission.target) { socket.emit("missions:result", { ok: false, reason: "아직 달성하지 못했습니다." }); return; }

      const accountId = normKey(pd.nickname) || normKey(socketNicks.get(socket.id)) || socket.id;
      const tx = mission.coin
        ? await beginEconomyTx({
            accountId, idemKey: `mission:${accountId}:${group}:${periodKey}:${missionId}`,
            delta: mission.coin, reason: "mission", ref: `${group}:${missionId}`
          })
        : null;
      if (tx && !tx.ok) {
        socket.emit("missions:result", { ok: false, reason: "이미 수령한 보상입니다." });
        return;
      }

      store.claimed.push(missionId);
      pd[group] = store;
      let message = "보상을 수령했습니다.";
      if (mission.coin) {
        pd.money += mission.coin;
        message = `${mission.coin.toLocaleString()}원을 받았습니다.`;
      }
      if (mission.title && !pd.titles.some(t => t.id === mission.title.id)) {
        pd.titles.push({ id: mission.title.id, name: mission.title.name });
        if (!pd.currentTitle) pd.currentTitle = mission.title.name;
        message += ` 칭호 '${mission.title.name}'을 획득했습니다.`;
      }
      try {
        await savePlayerData(socket.id, pd);
        if (tx) await finishEconomyTx(tx, pd.money);
      } catch (e) {
        if (tx) await abortEconomyTx(tx);
        throw e;
      }
      const afterDaily = initDailyData(pd.daily, getKstDate());
      socket.emit("missions:result", {
        ok: true, message, group,
        daily: afterDaily,
        missions: buildMissionProgress(DAILY_MISSIONS, afterDaily),
        groups: {
          daily: buildMissionProgress(DAILY_MISSIONS, afterDaily),
          weekly: buildMissionProgress(WEEKLY_MISSIONS, initWeeklyData(pd.weekly, getKstWeek())),
          monthly: buildMissionProgress(MONTHLY_MISSIONS, initMonthlyData(pd.monthly, getKstMonth()))
        },
        money: pd.money, titles: pd.titles, currentTitle: pd.currentTitle
      });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
      socket.emit("shop:info", {
        ok: true, money: pd.money, moneyMultiplier: pd.moneyMultiplier,
        ratingBoostGames: pd.ratingBoostGames, titles: pd.titles,
        currentTitle: pd.currentTitle, titleCatalog: SHOP_TITLES,
        potionPrice: SHOP_POTION_PRICE, multiplierPrices: SHOP_MULTIPLIER_PRICES,
        shieldTickets: pd.shieldTickets || 0, shieldPrice: SHOP_SHIELD_PRICE,
        ratingHistory: pd.ratingHistory || [],
        isAdmin: isAdminPd(pd)
      });
    } catch (err) { console.error("미션 보상 수령 오류:", err); }
  });

  socket.on("shop:buyShield", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      if (pd.money < SHOP_SHIELD_PRICE) { socket.emit("shop:result", { ok: false, reason: "돈이 부족합니다." }); return; }
      const accountId = normKey(pd.nickname) || normKey(socketNicks.get(socket.id)) || socket.id;
      const requestId = safeEconomyRequestId(data?.requestId, "shield");
      const tx = await beginEconomyTx({
        accountId, idemKey: `shop:shield:${accountId}:${requestId}`,
        delta: -SHOP_SHIELD_PRICE, reason: "shop_shield", ref: requestId
      });
      if (!tx.ok) {
        socket.emit("shop:result", { ok: false, reason: tx.duplicate ? "이미 처리한 구매입니다." : "구매 기록에 실패했습니다." });
        return;
      }
      pd.money -= SHOP_SHIELD_PRICE;
      pd.shieldTickets = (pd.shieldTickets || 0) + 1;
      try {
        await savePlayerData(socket.id, pd);
        await finishEconomyTx(tx, pd.money);
      } catch (e) {
        await abortEconomyTx(tx);
        throw e;
      }
      socket.emit("shop:result", { ok: true, message: "랭크 보호 티켓 1장을 구매했습니다. (랭크 패배 1회 방어)", money: pd.money, shieldTickets: pd.shieldTickets });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
    } catch (err) { console.error("보호 티켓 구매 오류:", err); }
  });

  socket.on("shop:buyPotion", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      if (pd.money < SHOP_POTION_PRICE) { socket.emit("shop:result", { ok: false, reason: "돈이 부족합니다." }); return; }
      const accountId = normKey(pd.nickname) || normKey(socketNicks.get(socket.id)) || socket.id;
      const requestId = safeEconomyRequestId(data?.requestId, "potion");
      const tx = await beginEconomyTx({
        accountId, idemKey: `shop:potion:${accountId}:${requestId}`,
        delta: -SHOP_POTION_PRICE, reason: "shop_potion", ref: requestId
      });
      if (!tx.ok) {
        socket.emit("shop:result", { ok: false, reason: tx.duplicate ? "이미 처리한 구매입니다." : "구매 기록에 실패했습니다." });
        return;
      }
      pd.money -= SHOP_POTION_PRICE;
      pd.ratingBoostGames += 10;
      try {
        await savePlayerData(socket.id, pd);
        await finishEconomyTx(tx, pd.money);
      } catch (e) {
        await abortEconomyTx(tx);
        throw e;
      }
      socket.emit("shop:result", { ok: true, message: "다음 10판 동안 레이팅 2배 물약을 구매했습니다.", money: pd.money, ratingBoostGames: pd.ratingBoostGames });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
    } catch (err) { console.error("물약 구매 오류:", err); }
  });

  socket.on("shop:buyMultiplier", async (data) => {
    try {
      const target = Number(data?.multiplier);
      const row = SHOP_MULTIPLIER_PRICES.find(m => m.multiplier === target);
      if (!row) { socket.emit("shop:result", { ok: false, reason: "구매할 수 없는 배율입니다." }); return; }
      const pd = await getPlayerData(socket.id);
      if ((pd.moneyMultiplier || 1) >= target) { socket.emit("shop:result", { ok: false, reason: `이미 ${pd.moneyMultiplier}배 이상 보유 중입니다.` }); return; }
      if (pd.money < row.price) { socket.emit("shop:result", { ok: false, reason: "돈이 부족합니다." }); return; }
      const accountId = normKey(pd.nickname) || normKey(socketNicks.get(socket.id)) || socket.id;
      const tx = await beginEconomyTx({
        accountId, idemKey: `shop:multiplier:${accountId}:${target}`,
        delta: -row.price, reason: "shop_multiplier", ref: String(target)
      });
      if (!tx.ok) {
        socket.emit("shop:result", { ok: false, reason: tx.duplicate ? "이미 구매한 배율입니다." : "구매 기록에 실패했습니다." });
        return;
      }
      pd.money -= row.price;
      pd.moneyMultiplier = target;
      try {
        await savePlayerData(socket.id, pd);
        await finishEconomyTx(tx, pd.money);
      } catch (e) {
        await abortEconomyTx(tx);
        throw e;
      }
      socket.emit("shop:result", { ok: true, message: `영구 돈 ${target}배를 구매했습니다.`, money: pd.money, moneyMultiplier: pd.moneyMultiplier });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
    } catch (err) { console.error("배율 구매 오류:", err); }
  });

  /* -- 버그 제보 ----------------------------------------- */
  socket.on("bug:submit", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "익명").trim();
      const category = String(data?.category || "기타").trim().slice(0, 20);
      const message = String(data?.message || "").trim().slice(0, 2000);
      if (!message) { socket.emit("bug:submitted", { ok: false, reason: "내용을 입력해주세요." }); return; }
      bugReports.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        nickname, category, message, createdAt: new Date().toISOString()
      });
      saveBugReports();
      socket.emit("bug:submitted", { ok: true, reason: "버그 제보가 접수되었습니다. 감사합니다!" });
      console.log(`[BUG REPORT] '${nickname}': ${category} — ${message.slice(0, 60)}`);
    } catch (err) { console.error("버그 제보 오류:", err); }
  });

  /* -- 관리자: 돈 조절 (총관리자 전용) ------------------- */
  socket.on("admin:setMoney", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:moneyResult", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") { socket.emit("admin:moneyResult", { ok: false, reason: "돈 조절은 최고 관리자만 사용할 수 있습니다." }); return; }
      const nickname = String(data?.nickname ?? "").trim();
      const amount = clampNum(data?.amount, -999999999, 999999999, 0);
      if (!nickname) { socket.emit("admin:moneyResult", { ok: false, reason: "닉네임을 입력해주세요." }); return; }
      const id = await findPlayerIdByNickname(nickname);
      if (!id) { socket.emit("admin:moneyResult", { ok: false, reason: `'${nickname}' 닉네임을 찾을 수 없습니다.` }); return; }
      const pd = await getPlayerData(id);
      const beforeMoney = Math.max(0, Number(pd.money) || 0);
      const afterMoney = Math.max(0, beforeMoney + amount);
      const actualDelta = afterMoney - beforeMoney;
      const accountId = normKey(pd.nickname) || String(id);
      const requestId = safeEconomyRequestId(data?.requestId, "admin");
      const tx = actualDelta !== 0
        ? await beginEconomyTx({
            accountId, idemKey: `admin:${accountId}:${requestId}`,
            delta: actualDelta, reason: "admin_adjust", ref: reg.nickname || "admin"
          })
        : null;
      if (tx && !tx.ok) {
        socket.emit("admin:moneyResult", { ok: false, reason: "코인 조절 기록에 실패했습니다." });
        return;
      }
      pd.money = afterMoney;
      try {
        await savePlayerData(id, pd);
        if (tx) await finishEconomyTx(tx, pd.money);
      } catch (e) {
        if (tx) await abortEconomyTx(tx);
        throw e;
      }
      socket.emit("admin:moneyResult", { ok: true, nickname: pd.nickname, money: pd.money, message: `'${nickname}' 님의 돈을 ${amount}원 ${amount >= 0 ? "추가" : "차감"}했습니다. (현재 ${pd.money}원)` });
      if (onlineNicks.has(normKey(nickname))) {
        const tId = onlineNicks.get(normKey(nickname));
        const ts = io.sockets.sockets.get(tId);
        if (ts) ts.emit("player:ranking", await getRankingPayload(tId));
      }
      console.log(`[ADMIN] ${reg.nickname}님이 '${nickname}' 돈 ${amount}원 조절`);
    } catch (err) { console.error("돈 조절 오류:", err); }
  });

  /* -- 관리자: 버그 제보 목록 (총관리자만) ---------------- */
  socket.on("admin:getBugs", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:bugs", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") { socket.emit("admin:bugs", { ok: false, reason: "버그 제보 열람은 최고 관리자만 가능합니다." }); return; }
      socket.emit("admin:bugs", { ok: true, reports: bugReports });
    } catch (err) { console.error("버그 목록 오류:", err); }
  });

  socket.on("admin:deleteBug", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:bugs", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") { socket.emit("admin:bugs", { ok: false, reason: "버그 제보 삭제는 최고 관리자만 가능합니다." }); return; }
      const id = String(data?.id || "");
      bugReports = bugReports.filter(b => b.id !== id);
      saveBugReports();
      socket.emit("admin:bugs", { ok: true, reports: bugReports });
    } catch (err) { console.error("버그 삭제 오류:", err); }
  });

  /* 커스텀 사전 관리 — 승인 대기 목록 조회 + 승인/거절 (관리자 전용) */
  socket.on("admin:wordList", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:words", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") { socket.emit("admin:words", { ok: false, reason: "단어 승인은 최고 관리자만 가능합니다." }); return; }
      emitCustomWords(socket);
    } catch (err) { console.error("커스텀 사전 목록 오류:", err); }
  });

  socket.on("admin:wordApprove", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:words", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") { socket.emit("admin:words", { ok: false, reason: "단어 승인은 최고 관리자만 가능합니다." }); return; }
      const word = normalizeWord(String(data?.word || ""));
      if (!word) { socket.emit("admin:words", { ok: false, reason: "승인할 단어를 선택해주세요." }); return; }
      const idx = customWords.pending.findIndex(p => p.word === word);
      if (idx === -1) { socket.emit("admin:words", { ok: false, reason: "대기 목록에 없는 단어입니다." }); return; }
      const req = customWords.pending.splice(idx, 1)[0];
      if (hasWord(word, WORD_SET)) {
        /* 이미 사전에 있는 단어는 승인 불필요 — 대기에서만 제거 */
        console.log(`[WORD APPROVE] '${word}' — 이미 사전에 있어 대기에서만 제거`);
      } else {
        applyCustomWord(word);
        customWords.approved.push(word);
        console.log(`[WORD APPROVE] ${req.by} → '${word}' 승인 (커스텀 사전 ${customWords.approved.length})`);
      }
      saveCustomWords();
      emitCustomWords(socket);
    } catch (err) { console.error("커스텀 사전 승인 오류:", err); }
  });

  socket.on("admin:wordReject", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:words", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") { socket.emit("admin:words", { ok: false, reason: "단어 승인은 최고 관리자만 가능합니다." }); return; }
      const word = normalizeWord(String(data?.word || ""));
      const reason = String(data?.reason || "").trim().slice(0, 50);
      if (!word) { socket.emit("admin:words", { ok: false, reason: "거절할 단어를 선택해주세요." }); return; }
      const idx = customWords.pending.findIndex(p => p.word === word);
      if (idx === -1) { socket.emit("admin:words", { ok: false, reason: "대기 목록에 없는 단어입니다." }); return; }
      const req = customWords.pending.splice(idx, 1)[0];
      customWords.rejected.push({ word, by: req.by, at: Date.now(), reason });
      saveCustomWords();
      socket.emit("admin:words", {
        ok: true,
        message: `'${word}' 단어를 거절했습니다.`,
        pending: customWords.pending.map(p => ({ word: p.word, by: p.by, at: p.at })),
        approved: customWords.approved,
        rejected: customWords.rejected.map(r => ({ word: r.word, by: r.by, at: r.at, reason: r.reason }))
      });
      console.log(`[WORD REJECT] ${req.by} → '${word}' (${reason || "사유 없음"})`);
    } catch (err) { console.error("커스텀 사전 거절 오류:", err); }
  });

  /* 추방 — 방장 또는 관리자만 가능 */
  socket.on("room:kick", async (data) => {
    try {
      const room = getPlayerRoom(socket);
      if (!room) { socket.emit("room:error", { ok: false, reason: "방에 참여하지 않았습니다." }); return; }
      const isHost = room.hostSocketId === socket.id;
      const reg = await requireNickname(socket);
      if (!isHost && !reg.ok) {
        socket.emit("room:error", { ok: false, reason: "방장 또는 관리자만 추방할 수 있습니다." });
        return;
      }
      const idx = Number(data?.playerIndex);
      const target = room.players[idx];
      if (!target || target.isBot || target.socketId === socket.id) {
        socket.emit("room:error", { ok: false, reason: "추방할 수 없는 대상입니다." });
        return;
      }
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit("room:kicked", { ok: true, reason: "방장/관리자에 의해 추방되었습니다." });
        targetSocket.leave(room.id);
        /* 클라이언트의 후속 room:leave가 빈 '방을 나갔습니다.'를 띄우지 않도록 정리 */
        targetSocket.data.roomId = null;
        targetSocket.data.playerIndex = null;
      }
      removePlayer(room, target.socketId, "kick");
      io.to(room.id).emit("room:playerLeft", {
        playerIndex: target.playerIndex, nickname: target.nickname, reason: "kick"
      });
      broadcastRoomState(room);
      console.log(`[KICK] ${room.id} / 방장·관리자가 '${target.nickname}' 추방`);
      const realPlayers = room.players.filter(p => !p.isBot);
      if (realPlayers.length === 0) { clearSpectators(room, "closed"); stopTurnTimer(room); ROOMS.delete(room.id); }
    } catch (err) { console.error("추방 오류:", err); }
  });

  /* -- 단어장 (계정 동기화) ---------------------------- */
  const loadWordbookForSocket = async () => {
    if (!socketNicks.has(socket.id)) return { ok: false, reason: "닉네임을 먼저 설정해주세요." };
    const pd = await getPlayerData(socket.id);
    if (!pd) return { ok: false, reason: "계정을 찾을 수 없습니다." };
    return { ok: true, pd };
  };

  socket.on("wordbook:list", async () => {
    try {
      const loaded = await loadWordbookForSocket();
      if (!loaded.ok) {
        socket.emit("wordbook:listResult", { ok: false, reason: loaded.reason, items: [] });
        return;
      }
      const items = wordbookStore.sanitize(loaded.pd.wordbook);
      const rawLength = Array.isArray(loaded.pd.wordbook) ? loaded.pd.wordbook.length : 0;
      if (items.length !== rawLength) {
        loaded.pd.wordbook = items;
        await savePlayerData(socket.id, loaded.pd);
      }
      socket.emit("wordbook:listResult", { ok: true, items });
    } catch (err) {
      console.error("단어장 조회 오류:", err);
      socket.emit("wordbook:listResult", { ok: false, reason: "단어장을 불러오지 못했습니다.", items: [] });
    }
  });

  socket.on("wordbook:add", async (data) => {
    try {
      const loaded = await loadWordbookForSocket();
      if (!loaded.ok) { socket.emit("wordbook:updated", { ok: false, reason: loaded.reason }); return; }
      loaded.pd.wordbook = wordbookStore.add(loaded.pd.wordbook, data && data.word, data && data.at);
      await savePlayerData(socket.id, loaded.pd);
      socket.emit("wordbook:updated", { ok: true, items: loaded.pd.wordbook });
    } catch (err) {
      console.error("단어장 저장 오류:", err);
      socket.emit("wordbook:updated", { ok: false, reason: "단어장 저장에 실패했습니다." });
    }
  });

  socket.on("wordbook:remove", async (data) => {
    try {
      const loaded = await loadWordbookForSocket();
      if (!loaded.ok) { socket.emit("wordbook:updated", { ok: false, reason: loaded.reason }); return; }
      loaded.pd.wordbook = wordbookStore.remove(loaded.pd.wordbook, data && data.word);
      await savePlayerData(socket.id, loaded.pd);
      socket.emit("wordbook:updated", { ok: true, items: loaded.pd.wordbook });
    } catch (err) {
      console.error("단어장 삭제 오류:", err);
      socket.emit("wordbook:updated", { ok: false, reason: "단어장 삭제에 실패했습니다." });
    }
  });

  socket.on("wordbook:clear", async () => {
    try {
      const loaded = await loadWordbookForSocket();
      if (!loaded.ok) { socket.emit("wordbook:updated", { ok: false, reason: loaded.reason }); return; }
      loaded.pd.wordbook = [];
      await savePlayerData(socket.id, loaded.pd);
      socket.emit("wordbook:updated", { ok: true, items: [] });
    } catch (err) {
      console.error("단어장 비우기 오류:", err);
      socket.emit("wordbook:updated", { ok: false, reason: "단어장을 비우지 못했습니다." });
    }
  });

  socket.on("wordbook:merge", async (data) => {
    try {
      const loaded = await loadWordbookForSocket();
      if (!loaded.ok) { socket.emit("wordbook:updated", { ok: false, reason: loaded.reason }); return; }
      loaded.pd.wordbook = wordbookStore.merge(loaded.pd.wordbook, data && data.items);
      await savePlayerData(socket.id, loaded.pd);
      socket.emit("wordbook:updated", { ok: true, items: loaded.pd.wordbook, merged: true });
    } catch (err) {
      console.error("단어장 동기화 오류:", err);
      socket.emit("wordbook:updated", { ok: false, reason: "단어장 동기화에 실패했습니다." });
    }
  });

  /* -- 리플레이 공유 링크 ------------------------------ */
  socket.on("replay:share", async (data) => {
    try {
      const now = Date.now();
      if (socket.data && socket.data.replayShareAt && now - socket.data.replayShareAt < 4000) {
        socket.emit("replay:shareResult", { ok: false, reason: "잠시 후 다시 시도해주세요." });
        return;
      }
      const flow = replayShare.sanitizeFlow(data && data.flow);
      if (!flow) {
        socket.emit("replay:shareResult", { ok: false, reason: "공유할 리플레이가 없습니다." });
        return;
      }
      const shares = await loadReplayShares();
      for (const [token, entry] of shares) {
        if (!(Number(entry && entry.expiresAt) > now)) shares.delete(token);
      }
      while (shares.size >= REPLAY_SHARE_LIMIT) {
        const oldest = shares.keys().next().value;
        shares.delete(oldest);
      }
      const token = replayShare.createToken();
      shares.set(token, { flow, createdAt: new Date(now).toISOString(), expiresAt: now + REPLAY_SHARE_TTL_MS });
      persistReplayShares();
      if (socket.data) socket.data.replayShareAt = now;
      socket.emit("replay:shareResult", { ok: true, token, path: "/?replay=" + token });
    } catch (err) {
      console.error("리플레이 공유 오류:", err);
      socket.emit("replay:shareResult", { ok: false, reason: "공유 링크를 만들지 못했습니다." });
    }
  });

  socket.on("player:getRanking", async () => {
    try {
      /* setName 등록이 아직 안 끝난 새 소켓에서 오면 초기(0) 화면이 잠깐 보일 수 있다.
         닉네임이 등록될 때까지 잠깐 기다렸다가 진짜 계정 데이터를 보낸다 */
      if (!socketNicks.has(socket.id)) await new Promise(r => setTimeout(r, 500));
      socket.emit("player:ranking", await getRankingPayload(socket.id));
    } catch (err) { console.error("랭킹 조회 오류:", err); }
  });

  /* -- 관리자 패널 (Google 전용) ------------------------ */
  const normNick = (nick) => String(nick || "").replace(/\s+/g, "").toLowerCase();

  /* 관리자 권한 확인 — 서버가 검증한 Firebase 이메일 allowlist가 유일한 근거.
     호출부 호환을 위해 기존 requireNickname 이름을 유지한다 */
  const requireNickname = async (socket) => {
    if (!isAdminSocket(socket)) {
      return { ok: false, reason: "관리자 권한이 없습니다. 관리자 구글 계정으로 로그인해주세요." };
    }
    const pd = await getPlayerData(socket.id);
    return { ok: true, nickname: String(pd.nickname || "").trim(), role: "super", subAdmin: null };
  };

  socket.on("admin:getPanel", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      socket.emit("admin:panel", {
        ok: true,
        role: reg.role,
        isSuper: reg.role === "super",
        adminEmail: ADMIN_EMAILS[0] || "",
        config: getConfig(),
        startSyllables: STARTING_SYLLABLES,
        watchlist: watchNicks
      });
    } catch (err) { console.error("관리자 패널 오류:", err); }
  });

  socket.on("admin:findPlayer", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:findResult", { ok: false, reason: reg.reason }); return; }
      const nickname = String(data?.nickname ?? "").trim();
      if (!nickname) {
        socket.emit("admin:findResult", { ok: false, reason: "닉네임을 입력해주세요." });
        return;
      }
      const id = await findPlayerIdByNickname(nickname);
      if (!id) {
        socket.emit("admin:findResult", { ok: false, reason: `'${nickname}' 닉네임을 찾을 수 없습니다.` });
        return;
      }
      const pd = await getPlayerData(id);
      socket.emit("admin:findResult", {
        ok: true,
        player: {
          id, nickname: pd.nickname,
          single: { ...pd.single },
          multi: { ...pd.multi },
          ranked: { ...pd.ranked },
          money: pd.money,
          moneyMultiplier: pd.moneyMultiplier
        }
      });
    } catch (err) { console.error("관리자 플레이어 조회 오류:", err); }
  });

  socket.on("admin:setPlayerStats", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:statsUpdated", { ok: false, reason: reg.reason }); return; }
      const nickname = String(data?.nickname ?? "").trim();
      const mode = data?.mode === "ranked" ? "ranked" : data?.mode === "single" ? "single" : "multi";
      if (!nickname) {
        socket.emit("admin:statsUpdated", { ok: false, reason: "닉네임을 입력해주세요." });
        return;
      }
      const id = await findPlayerIdByNickname(nickname);
      if (!id) {
        socket.emit("admin:statsUpdated", { ok: false, reason: `'${nickname}' 닉네임을 찾을 수 없습니다.` });
        return;
      }
      const pd = await getPlayerData(id);
      if (mode !== "single") pd[mode].rating = clampNum(data?.rating, 0, 9999, pd[mode].rating);
      pd[mode].wins = clampNum(data?.wins, 0, 100000, pd[mode].wins);
      pd[mode].losses = clampNum(data?.losses, 0, 100000, pd[mode].losses);
      await savePlayerData(id, pd);
      socket.emit("admin:statsUpdated", {
        ok: true,
        player: {
          id, nickname: pd.nickname,
          single: { ...pd.single },
          multi: { ...pd.multi },
          ranked: { ...pd.ranked },
          money: pd.money,
          moneyMultiplier: pd.moneyMultiplier
        }
      });
      console.log(`[ADMIN] ${reg.nickname}님이 '${nickname}'(${mode}) 통계 수정:`, JSON.stringify(pd[mode]));
    } catch (err) { console.error("관리자 통계 수정 오류:", err); }
  });

  socket.on("admin:updateConfig", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:panel", { ok: false, reason: "수치 조정은 최고 관리자만 할 수 있습니다." });
        return;
      }
      const key = String(data?.key ?? "");
      const range = CONFIG_RANGES[key];
      if (!range) {
        socket.emit("admin:panel", { ok: false, reason: "조정할 수 없는 항목입니다." });
        return;
      }
      const val = applyConfigValue(key, data?.value);
      saveAdminConfig();
      io.emit("admin:configUpdated", getConfig());
      socket.emit("admin:panel", { ok: true, message: "설정이 적용되었습니다.", config: getConfig() });
      console.log(`[ADMIN] ${reg.nickname}님이 ${key} → ${val} 변경`);
    } catch (err) { console.error("관리자 설정 오류:", err); }
  });

  socket.on("admin:getRole", async () => {
    try {
      const reg = await requireNickname(socket);
      socket.emit("admin:role", { ok: true, role: reg.ok ? reg.role : "none" });
    } catch (err) { console.error("관리자 역할 조회 오류:", err); }
  });

  /* -- 커스텀 사전 — 유저 단어 신청 → 관리자 승인 시 게임 반영 (단일 저장소) -- */
  socket.on("dictionary:status", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "").trim();
      const mine = customWords.pending
        .filter(p => String(p.requester || p.by || "") === nickname)
        .map(p => ({ id: p.id, word: p.word, at: p.at }));
      socket.emit("dictionary:status", {
        ok: true, mine, nickname,
        approvedTotal: customWords.approved.length,
        pendingTotal: customWords.pending.length,
        canSubmit: mine.length < 3
      });
    } catch (err) { console.error("사전 상태 오류:", err); }
  });

  socket.on("dictionary:submit", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "").trim();
      if (!nickname) { socket.emit("dictionary:status", { ok: false, reason: "닉네임을 먼저 설정해주세요." }); return; }
      const word = normalizeWord(data?.word);
      if (!word || word.length < 2 || word.length > 15) {
        socket.emit("dictionary:status", { ok: false, reason: "단어는 한글 2~15자여야 합니다." }); return;
      }
      if (WORD_SET.has(word) || customWords.approved.includes(word)) {
        socket.emit("dictionary:status", { ok: false, reason: `'${word}'는 이미 등록된 단어입니다.` }); return;
      }
      const mineCount = customWords.pending.filter(p => String(p.requester || p.by || "") === nickname).length;
      if (mineCount >= 3) {
        socket.emit("dictionary:status", { ok: false, reason: "진행 중인 신청이 3개 이상입니다. 처리 후 다시 시도해주세요." }); return;
      }
      if (customWords.pending.some(p => p.word === word)) {
        socket.emit("dictionary:status", { ok: false, reason: `'${word}'는 이미 신청 대기 중인 단어입니다.` }); return;
      }
      if (customWords.pending.length >= 200) {
        socket.emit("dictionary:status", { ok: false, reason: "승인 대기 목록이 꽉 찼습니다. 잠시 후 다시 시도해주세요." }); return;
      }
      customWords.pending.push({ id: String(customWords.nextId++), word, requester: nickname, by: nickname, at: Date.now() });
      saveCustomWords();
      socket.emit("dictionary:status", { ok: true, message: `'${word}' 등록을 신청했습니다. 관리자 승인 후 게임에 반영됩니다.` });
      console.log(`[DICT] ${nickname} 단어 신청: ${word}`);
    } catch (err) { console.error("사전 신청 오류:", err); }
  });

  socket.on("dictionary:cancel", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "").trim();
      const id = String(data?.id || "");
      const idx = customWords.pending.findIndex(p => String(p.id) === id && String(p.requester || p.by || "") === nickname);
      if (idx === -1) { socket.emit("dictionary:status", { ok: false, reason: "본인의 신청만 취소할 수 있습니다." }); return; }
      customWords.pending.splice(idx, 1);
      saveCustomWords();
      socket.emit("dictionary:status", { ok: true, message: "단어 신청을 취소했습니다." });
    } catch (err) { console.error("사전 신청 취소 오류:", err); }
  });

  socket.on("admin:dictionaryList", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:dictionary", { ok: false, reason: reg.reason }); return; }
      socket.emit("admin:dictionary", { ok: true, pending: customWords.pending, approved: customWords.approved });
    } catch (err) { console.error("관리자 사전 목록 오류:", err); }
  });

  socket.on("admin:dictionaryApprove", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:dictionary", { ok: false, reason: reg.reason }); return; }
      const id = String(data?.id || "");
      const idx = customWords.pending.findIndex(p => String(p.id) === id);
      if (idx === -1) { socket.emit("admin:dictionary", { ok: false, reason: "승인 대기 신청을 찾을 수 없습니다." }); return; }
      const [item] = customWords.pending.splice(idx, 1);
      customWords.approved.push(item.word);
      customWords.rejected = customWords.rejected.filter(r => r.word !== item.word);
      saveCustomWords();
      rebuildWordViews();
      notifyRequester(item.requester || item.by, `'${item.word}' 단어가 승인되어 게임에 반영되었습니다!`);
      socket.emit("admin:dictionary", { ok: true, pending: customWords.pending, approved: customWords.approved, message: `'${item.word}' 승인 완료` });
      console.log(`[DICT] ${reg.nickname} 승인: ${item.word} (by ${item.requester || item.by})`);
    } catch (err) { console.error("사전 승인 오류:", err); }
  });

  socket.on("admin:dictionaryReject", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:dictionary", { ok: false, reason: reg.reason }); return; }
      const id = String(data?.id || "");
      const idx = customWords.pending.findIndex(p => String(p.id) === id);
      if (idx === -1) { socket.emit("admin:dictionary", { ok: false, reason: "승인 대기 신청을 찾을 수 없습니다." }); return; }
      const [item] = customWords.pending.splice(idx, 1);
      customWords.rejected.push({ word: item.word, by: item.requester || item.by, at: Date.now() });
      if (customWords.rejected.length > 200) customWords.rejected.splice(0, customWords.rejected.length - 200);
      saveCustomWords();
      notifyRequester(item.requester || item.by, `'${item.word}' 단어 신청이 반려되었습니다.`);
      socket.emit("admin:dictionary", { ok: true, pending: customWords.pending, approved: customWords.approved, message: `'${item.word}' 반려 완료` });
      console.log(`[DICT] ${reg.nickname} 반려: ${item.word} (by ${item.requester || item.by})`);
    } catch (err) { console.error("사전 반려 오류:", err); }
  });


  /* 감시 목록 — 등록된 닉네임의 로그인 시 최고 관리자에게 알림 */
  socket.on("admin:setWatchlist", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:panel", { ok: false, reason: "최고 관리자만 감시 목록을 바꿀 수 있습니다." });
        return;
      }
      watchNicks = Array.isArray(data?.watchlist)
        ? data.watchlist.map(w => String(w || "").trim()).filter(Boolean)
        : [];
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: reg.role, isSuper: true, config: getConfig(),
        startSyllables: STARTING_SYLLABLES, watchlist: watchNicks,
        message: "감시 목록이 저장되었습니다."
      });
      console.log(`[ADMIN] 감시 목록 저장: ${watchNicks.join(", ") || "(없음)"}`);
    } catch (err) { console.error("감시 목록 오류:", err); }
  });

  /* -- 운영 제재: 밴(접속 차단) / 뮤트(채팅 차단) (최고 관리자) ---- */
  const emitModeration = (message) => socket.emit("admin:moderation", {
    ok: true, ...listModeration(), message: message || ""
  });

  const moderationAction = async (data, kind, action) => {
    const reg = await requireNickname(socket);
    if (!reg.ok) return { ok: false, reason: reg.reason };
    if (reg.role !== "super") return { ok: false, reason: "최고 관리자만 제재를 관리할 수 있습니다." };
    const nickname = String(data?.nickname || "").trim();
    if (!nickname) return { ok: false, reason: "닉네임을 입력해주세요." };
    const reason = String(data?.reason || "").trim().slice(0, 100);
    const label = kind === "banned" ? "차단" : "음소거";

    if (action === "add") {
      /* 같은 계정(uid)이 다른 이름으로 이미 제재돼 있으면 중복 방지 */
      let uid = "";
      try {
        const id = await findPlayerIdByNickname(nickname);
        if (id) { const pd = await getPlayerData(id); uid = String(pd.firebaseUid || ""); }
      } catch (e) { /* 조회 실패는 계속 진행 */ }
      /* 채팅정지(뮤트) 기간 — days>0이면 N일 후 만료, 없으면 영구.
         계정정지(밴)는 항상 영구 */
      const days = Number(data?.days);
      const r = addModeration(kind, nickname, {
        by: reg.nickname, reason, uid,
        days: (kind !== "banned" && Number.isFinite(days) && days > 0) ? Math.floor(days) : 0
      });
      if (!r.ok) return r;

      if (kind === "banned") {
        /* 접속 중인 대상은 방에서 제거하고 연결을 끊는다 */
        const tId = onlineNicks.get(r.key);
        const ts = tId ? io.sockets.sockets.get(tId) : null;
        if (ts) {
          try {
            removeFromRankedQueue(ts.id);
            leaveRoomForSocket(ts, "ban");
            ts.emit("player:banned", {
              ok: false,
              reason: `이 계정은 이용이 정지되었습니다${reason ? ` (사유: ${reason})` : ""}.`
            });
            setTimeout(() => { try { ts.disconnect(true); } catch (e) { /* 무시 */ } }, 400);
          } catch (e) { console.warn("밴 대상 정리 실패:", e.message); }
        }
        /* 같은 uid의 다른 온라인 소켓도 함께 차단 */
        if (uid) {
          /* onlineNicks는 닉네임키 → 소켓ID 맵이다. 같은 UID로 접속한 다른 소켓만 끊는다 */
          for (const [nickKey, socketId] of [...onlineNicks]) {
            if (nickKey === r.key) continue;
            const other = io.sockets.sockets.get(socketId);
            if (!other) continue;
            if (String(socketFirebaseUid.get(socketId) || "") !== uid) continue;
            try { leaveRoomForSocket(other, "ban"); other.disconnect(true); } catch (e) { /* 무시 */ }
          }
        }
        console.log(`[ADMIN] 밴: '${r.entry.nick}' by ${reg.nickname}${reason ? ` (${reason})` : ""}`);
        return { ok: true, message: `'${r.entry.nick}' 닉네임을 차단했습니다.` };
      }

      const tId = onlineNicks.get(r.key);
      const ts = tId ? io.sockets.sockets.get(tId) : null;
      if (ts) ts.emit("player:muted", { ok: true, reason: reason || "관리자 조치", until: r.entry.until || null });
      console.log(`[ADMIN] 뮤트: '${r.entry.nick}' by ${reg.nickname}${reason ? ` (${reason})` : ""}${r.entry.until ? ` until=${r.entry.until}` : " (영구)"}`);
      const span = r.entry.until ? `${Math.round((Date.parse(r.entry.until) - Date.now()) / 86400000) || 1}일간` : "영구적으로";
      return { ok: true, message: `'${r.entry.nick}' 닉네임을 ${span} 음소거했습니다.` };
    }

    const existed = removeModeration(kind, nickname);
    if (!existed) return { ok: false, reason: `'${nickname}' 항목이 ${label} 목록에 없습니다.` };
    if (kind === "banned") {
      const tId = onlineNicks.get(normKey(nickname));
      const ts = tId ? io.sockets.sockets.get(tId) : null;
      if (ts) ts.emit("player:unbanned", { ok: true });
    } else {
      const tId = onlineNicks.get(normKey(nickname));
      const ts = tId ? io.sockets.sockets.get(tId) : null;
      if (ts) ts.emit("player:unmuted", { ok: true });
    }
    console.log(`[ADMIN] ${label} 해제: '${nickname}' by ${reg.nickname}`);
    return { ok: true, message: `'${nickname}' ${label}을 해제했습니다.` };
  };

  socket.on("admin:moderationList", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:moderation", { ok: false, reason: reg.reason }); return; }
      emitModeration();
    } catch (err) { console.error("제재 목록 오류:", err); }
  });

  socket.on("admin:ban", async (data) => {
    try {
      const r = await moderationAction(data, "banned", "add");
      if (!r.ok) socket.emit("admin:moderation", r);
      else emitModeration(r.message);
    } catch (err) { console.error("밴 오류:", err); socket.emit("admin:moderation", { ok: false, reason: "차단 처리에 실패했습니다." }); }
  });

  socket.on("admin:unban", async (data) => {
    try {
      const r = await moderationAction(data, "banned", "remove");
      if (!r.ok) socket.emit("admin:moderation", r);
      else emitModeration(r.message);
    } catch (err) { console.error("밴 해제 오류:", err); socket.emit("admin:moderation", { ok: false, reason: "해제에 실패했습니다." }); }
  });

  socket.on("admin:mute", async (data) => {
    try {
      const r = await moderationAction(data, "muted", "add");
      if (!r.ok) socket.emit("admin:moderation", r);
      else emitModeration(r.message);
    } catch (err) { console.error("뮤트 오류:", err); socket.emit("admin:moderation", { ok: false, reason: "음소거 처리에 실패했습니다." }); }
  });

  socket.on("admin:unmute", async (data) => {
    try {
      const r = await moderationAction(data, "muted", "remove");
      if (!r.ok) socket.emit("admin:moderation", r);
      else emitModeration(r.message);
    } catch (err) { console.error("뮤트 해제 오류:", err); socket.emit("admin:moderation", { ok: false, reason: "해제에 실패했습니다." }); }
  });

  /* 관리자: 전체 채팅 이력 비우기 — 저장소(kv_store/파일)까지 즉시 비운다 */
  socket.on("admin:chatClear", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:chatClearResult", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:chatClearResult", { ok: false, reason: "최고 관리자만 채팅 이력을 비울 수 있습니다." });
        return;
      }
      GLOBAL_CHAT_HISTORY.length = 0;
      saveChatHistoryNow();
      io.emit("chat:cleared");
      socket.emit("admin:chatClearResult", { ok: true, reason: "전체 채팅 이력을 비웠습니다." });
      console.log(`[ADMIN] 전체 채팅 이력 비움 by ${reg.nickname}`);
    } catch (err) { console.error("채팅 비우기 오류:", err); socket.emit("admin:chatClearResult", { ok: false, reason: "채팅 이력 비우기에 실패했습니다." }); }
  });

  /* 관리자: 계정 전체 삭제 (최고 관리자) — 전적·돈·칭호 등 영구 삭제 */
  socket.on("admin:deletePlayer", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:deletePlayerResult", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:deletePlayerResult", { ok: false, reason: "최고 관리자만 계정을 삭제할 수 있습니다." });
        return;
      }
      const nickname = String(data?.nickname || "").trim();
      if (!nickname) { socket.emit("admin:deletePlayerResult", { ok: false, reason: "삭제할 닉네임을 입력해주세요." }); return; }
      const r = await deletePlayerAccount(nickname);
      if (!r.ok) { socket.emit("admin:deletePlayerResult", r); return; }
      socket.emit("admin:deletePlayerResult", {
        ok: true,
        message: r.removed > 0
          ? `'${nickname}' 계정 ${r.removed}건을 삭제했습니다.`
          : `'${nickname}'에 해당하는 계정이 없습니다.`
      });
      console.log(`[ADMIN] 계정 삭제: '${nickname}' → ${r.removed}건 by ${reg.nickname}`);
    } catch (err) {
      console.error("계정 삭제 오류:", err);
      socket.emit("admin:deletePlayerResult", { ok: false, reason: "계정 삭제에 실패했습니다." });
    }
  });

  /* 관리자: 전체 공지 — 접속 중인 모든 유저에게 즉시 알림 */
  socket.on("admin:notice", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:noticeResult", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:noticeResult", { ok: false, reason: "최고 관리자만 전체 공지를 보낼 수 있습니다." });
        return;
      }
      const text = String(data?.text || "").trim().slice(0, 200);
      if (!text) { socket.emit("admin:noticeResult", { ok: false, reason: "공지 내용을 입력해주세요." }); return; }
      io.emit("notice:global", { text, at: new Date().toISOString(), by: reg.nickname });
      socket.emit("admin:noticeResult", { ok: true, message: `전체 공지를 보냈습니다. (${text.length}자)` });
      console.log(`[ADMIN] 전체 공지 by ${reg.nickname}: ${text}`);
    } catch (err) {
      console.error("공지 오류:", err);
      socket.emit("admin:noticeResult", { ok: false, reason: "공지 전송에 실패했습니다." });
    }
  });

  /* 관리자: 개별 쪽지(우편) — 대상 쪽지함에 코인과 함께 저장 */
  socket.on("admin:mailSend", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:mailResult", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:mailResult", { ok: false, reason: "최고 관리자만 쪽지를 보낼 수 있습니다." });
        return;
      }
      const nickname = String(data?.nickname || "").trim();
      if (!nickname) { socket.emit("admin:mailResult", { ok: false, reason: "받는 닉네임을 입력해주세요." }); return; }
      let title = String(data?.title || "").trim().slice(0, 40);
      if (!title) title = "관리자 쪽지";
      const body = String(data?.body || "").trim().slice(0, 200);
      const coin = Math.min(MAIL_COIN_MAX, Math.max(0, Math.floor(Number(data?.coin) || 0)));

      let targetId = await findPlayerIdByNickname(nickname);
      if (!targetId) targetId = await findPlayerIdByNickname(normalizeWord(nickname));
      if (!targetId) { socket.emit("admin:mailResult", { ok: false, reason: "존재하지 않는 닉네임입니다." }); return; }

      const pd = await getPlayerData(targetId);
      const list = Array.isArray(pd.mail) ? pd.mail : [];
      list.unshift({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        title, body, coin,
        at: new Date().toISOString(),
        from: "관리자",
        read: false
      });
      /* 보관 상한 초과분은 오래된 것(읽은 것 우선)부터 제거 */
      while (list.length > MAIL_MAX) {
        const idx = list.findIndex(m => m && m.read);
        list.splice(idx >= 0 ? idx : list.length - 1, 1);
      }
      pd.mail = list;
      await savePlayerData(targetId, pd);

      /* 대상이 온라인이면 새 쪽지 알림 */
      const sid = onlineNicks.get(normKey(nickname));
      const targetSocket = sid ? io.sockets.sockets.get(sid) : null;
      if (targetSocket) targetSocket.emit("mail:new", { title, coin });
      notifyPush(normKey(nickname), {
        title: "새 쪽지", body: title + (coin ? " (+" + coin.toLocaleString() + "코인)" : ""),
        url: "/", tag: "mail:" + Date.now()
      });

      socket.emit("admin:mailResult", {
        ok: true,
        message: `'${nickname}' 쪽지함에 '${title}' 쪽지를 보냈습니다${coin ? ` (+${coin.toLocaleString()}코인)` : ""}.`
      });
      console.log(`[ADMIN] 쪽지 발송: '${nickname}' ← '${title}'${coin ? ` +${coin}` : ""} by ${reg.nickname}`);
    } catch (err) {
      console.error("쪽지 발송 오류:", err);
      socket.emit("admin:mailResult", { ok: false, reason: "쪽지 발송에 실패했습니다." });
    }
  });

  /* -- 관전자 전용 채팅 — 플레이어 방 채팅과 완전히 분리된 채널 ---------- */
  socket.on("spectate:chat", (data) => {
    try {
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("chat:error", { reason: "채팅은 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      const room = getPlayerRoom(socket);
      const spectators = ensureSpectatorState(room);
      if (!room || !spectators.has(socket.id)) {
        socket.emit("chat:error", { reason: "관전 중인 방이 없습니다." });
        return;
      }
      const nickname = socketNicks.get(socket.id) || spectators.get(socket.id).nickname || "관전자";
      const banned = banGuard(nickname) || banGuardByUid(socketFirebaseUid.get(socket.id) || "");
      if (banned) { socket.emit("chat:error", { reason: banned }); return; }
      const mute = getMute(nickname, socketFirebaseUid.get(socket.id) || "");
      if (mute) {
        socket.emit("chat:error", { reason: "채팅이 차단되었습니다." });
        return;
      }
      const verdict = chatFilter(data?.text);
      if (!verdict.ok) { socket.emit("chat:error", { reason: verdict.reason }); return; }
      const rate = takeChatSlot(chatRateKey(socketFirebaseUid.get(socket.id) || "", nickname), Date.now());
      if (!rate.ok) { socket.emit("chat:error", { reason: rate.reason }); return; }
      const payload = {
        from: nickname,
        text: verdict.clean,
        at: new Date().toISOString(),
        id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        scope: "spectate"
      };
      room.spectatorChat.push(payload);
      if (room.spectatorChat.length > GLOBAL_CHAT_MAX) room.spectatorChat.shift();
      io.to(spectatorChannel(room)).emit("spectate:chat:message", payload);
    } catch (err) { console.error("관전 채팅 오류:", err); }
  });

  socket.on("spectate:chat:history", () => {
    try {
      const room = getPlayerRoom(socket);
      if (!room || !ensureSpectatorState(room).has(socket.id)) {
        socket.emit("spectate:chat:history", { ok: false, messages: [] });
        return;
      }
      socket.emit("spectate:chat:history", {
        ok: true, roomId: room.id,
        messages: (room.spectatorChat || []).slice(-30)
      });
    } catch (err) { console.error("관전 채팅 이력 오류:", err); }
  });

  /* -- 실시간 채팅 (방 단위) ---------------------------- */
  socket.on("chat:send", (data) => {
    try {
      /* 채팅은 Google 로그인 세션으로만 가능하다 (게스트는 채팅 불가) */
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("chat:error", { reason: "채팅은 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      const room = getPlayerRoom(socket);
      const me = room ? getPlayerBySocket(room, socket.id) : null;
      const nickname = (me && me.nickname) || socketNicks.get(socket.id) || "";
      if (!nickname) { socket.emit("chat:error", { reason: "먼저 이름을 설정해주세요." }); return; }
      /* 방 관전자는 플레이어 채팅에 끼어들 수 없다 — 관전 채팅을 따로 쓴다. */
      if (room && !me) {
        socket.emit("chat:error", { reason: "관전자는 관전 채팅을 이용해주세요." });
        return;
      }

      /* 뮤트 여부 (닉네임·계정 UID 기준, 기간 만료 자동 해제) */
      const mute = getMute(nickname, socketFirebaseUid.get(socket.id) || "");
      if (mute) {
        const when = mute.until ? ` (${new Date(mute.until).toLocaleString()}까지)` : "";
        socket.emit("chat:error", { reason: `채팅이 차단되었습니다${mute.reason ? ` (${mute.reason})` : ""}${when}. 관리자에게 문의하세요.` });
        return;
      }

      /* 길이·빈 내용 필터 + 속도 제한: 최소 간격 + 시간창 내 최대 횟수 */
      const verdict = chatFilter(data?.text);
      if (!verdict.ok) { socket.emit("chat:error", { reason: verdict.reason }); return; }

      const now = Date.now();
      const sd = socket.data || (socket.data = {});
      /* 계정(UID 우선) 단위 제한 — 새 소켓/재접속으로 제한을 우회할 수 없다 */
      const rate = takeChatSlot(
        chatRateKey(socketFirebaseUid.get(socket.id) || "", nickname),
        now
      );
      if (!rate.ok) {
        socket.emit("chat:error", { reason: rate.reason });
        return;
      }

      const payload = {
        from: nickname,
        text: verdict.clean,
        at: new Date().toISOString(),
        id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      };
      /* 온라인/파티/랭크 방이면 방 단위, 그 외(싱글·대기실·로비)는 전체 채팅 */
      if (room && room.mode !== "ai") {
        payload.scope = "room";
        /* 방 단위 이력 — 방이 살아 있는 동안 유지 (재접속·패널 재개 시 복원).
           방이 사라지면 함께 사라진다 (전역 이력에는 쌓이지 않음) */
        if (!Array.isArray(room.chat)) room.chat = [];
        room.chat.push(payload);
        if (room.chat.length > GLOBAL_CHAT_MAX) room.chat.shift();
        /* 플레이어 채팅은 관전자 채널로 보내지 않는다 — 관전자는 관전 채팅만 본다. */
        io.to(room.id).except(spectatorChannel(room)).emit("chat:message", payload);
      } else {
        payload.scope = "global";
        GLOBAL_CHAT_HISTORY.push(payload);
        if (GLOBAL_CHAT_HISTORY.length > GLOBAL_CHAT_MAX) GLOBAL_CHAT_HISTORY.shift();
        scheduleSaveChatHistory();
        io.emit("chat:message", payload);
      }
    } catch (err) { console.error("채팅 오류:", err); }
  });

  /* 채팅 이력 — roomId를 주면 그 방의 이력, 없으면 전체 이력을 돌려준다.
     읽기는 로그인 없이도 허용한다(보이는 채팅), 쓰기·신고만 Google 로그인 게이트 */
  socket.on("chat:history", (data) => {
    try {
      const roomId = String(data?.roomId || "");
      if (roomId) {
        const room = ROOMS.get(roomId);
        const isPlayer = !!(room && room.players && room.players.some(p => p.socketId === socket.id));
        const isSpectator = !!(room && ensureSpectatorState(room).has(socket.id));
        if (room && isPlayer) {
          socket.emit("chat:history", { ok: true, scope: "room", roomId, messages: (room.chat || []).slice(-30) });
          return;
        }
        if (room && isSpectator) {
          socket.emit("chat:history", { ok: true, scope: "spectate", roomId, messages: (room.spectatorChat || []).slice(-30) });
          return;
        }
      }
      socket.emit("chat:history", { ok: true, scope: "global", messages: GLOBAL_CHAT_HISTORY.slice(-30) });
    } catch (err) { console.error("채팅 이력 오류:", err); }
  });

  /* 채팅 메시지 신고 → 버그 제보함에 '채팅 신고'로 접수 */
  socket.on("chat:report", (data) => {
    try {
      if (!socketFirebaseUid.get(socket.id)) {
        socket.emit("chat:reportResult", { ok: false, reason: "신고는 Google 로그인 후 이용할 수 있습니다." });
        return;
      }
      const room = getPlayerRoom(socket);
      const target = String(data?.nickname || "").trim();
      const text = String(data?.text || "").trim().slice(0, 200);
      if (!target) { socket.emit("chat:reportResult", { ok: false, reason: "신고할 대상이 없습니다." }); return; }
      const reporter = socketNicks.get(socket.id) || "익명";
      bugReports.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        nickname: reporter,
        category: "채팅 신고",
        message: `[대상: ${target}]${room ? ` (방 ${room.id})` : ""} ${text || "(내용 없음)"}`,
        createdAt: new Date().toISOString()
      });
      if (bugReports.length > 200) bugReports.length = 200;
      saveBugReports();
      /* 반복 신고 자동 뮤트 — 24시간 내 다른 신고자 3명 누적 시 10분 채팅정지 */
      try {
        const targetKey = normKey(target);
        const reporterKey = normKey(reporter);
        if (targetKey && reporterKey && targetKey !== reporterKey) {
          const now = Date.now();
          let rec = chatReportCounts.get(targetKey);
          if (!rec || now - rec.firstAt > 24 * 3600000) {
            rec = { firstAt: now, reporters: new Set() };
            chatReportCounts.set(targetKey, rec);
          }
          if (!rec.reporters.has(reporterKey)) {
            rec.reporters.add(reporterKey);
            if (rec.reporters.size >= CHAT_AUTO_MUTE_REPORTS) {
              chatReportCounts.delete(targetKey);
              mutedMap.set(targetKey, {
                nick: target,
                by: "auto-reports",
                at: new Date().toISOString(),
                reason: `반복 채팅 신고 ${CHAT_AUTO_MUTE_REPORTS}건 누적 (자동)`,
                uid: "",
                until: new Date(now + CHAT_AUTO_MUTE_MINUTES * 60000).toISOString()
              });
              saveModeration();
              console.log(`[CHAT AUTO-MUTE] '${target}' — 신고 ${CHAT_AUTO_MUTE_REPORTS}명 누적 → ${CHAT_AUTO_MUTE_MINUTES}분 뮤트`);
              const tId = onlineNicks.get(targetKey);
              if (tId && io.sockets.sockets.has(tId)) {
                io.to(tId).emit("player:muted", { reason: `반복 신고로 ${CHAT_AUTO_MUTE_MINUTES}분간 채팅이 차단되었습니다.` });
              }
            }
          }
        }
      } catch (e) { console.warn("자동 뮤트 처리 오류:", e.message); }
      socket.emit("chat:reportResult", { ok: true, reason: `'${target}' 님을 신고했습니다. 검토 후 조치하겠습니다.` });
      notifySuperAdmins({ nickname: reporter, at: new Date().toISOString(), reason: "chat-report", target });
      console.log(`[CHAT REPORT] '${reporter}' → '${target}': ${text.slice(0, 60)}`);
    } catch (err) { console.error("채팅 신고 오류:", err); socket.emit("chat:reportResult", { ok: false, reason: "신고 접수에 실패했습니다." }); }
  });

  /* 이모지 리액션 — 방 전체 브로드캐스트 (뮤트·속도 제한 적용) */
  socket.on("game:react", (data) => {
    try {
      const room = getPlayerRoom(socket);
      if (!room) { socket.emit("react:error", { reason: "방에 들어와 있을 때만 리액션을 보낼 수 있습니다." }); return; }
      const me = getPlayerBySocket(room, socket.id);
      const nickname = (me && me.nickname) || socketNicks.get(socket.id) || "";
      if (!nickname) { socket.emit("react:error", { reason: "닉네임을 먼저 설정해주세요." }); return; }
      const mute = getMute(nickname, socketFirebaseUid.get(socket.id) || "");
      if (mute) {
        socket.emit("react:error", { reason: `리액션이 차단되었습니다${mute.reason ? ` (${mute.reason})` : ""}. 관리자에게 문의하세요.` });
        return;
      }
      const emoji = String(data?.emoji || "");
      if (!REACT_EMOJIS.includes(emoji)) {
        socket.emit("react:error", { reason: "사용할 수 없는 이모지입니다." });
        return;
      }
      const now = Date.now();
      const sd = socket.data || (socket.data = {});
      if (now - Number(sd.reactLastAt || 0) < REACT_COOLDOWN_MS) return;   /* 조용히 무시 */
      sd.reactLastAt = now;
      io.to(room.id).emit("game:react", { from: nickname, emoji, at: now, roomId: room.id });
    } catch (err) { console.error("리액션 오류:", err); }
  });

  /* -- 추천인 등록(레퍼럴) — 계정당 1회, 등록 즉시 양쪽 코인 지급 ---------- */
  socket.on("referral:register", async (data) => {
    try {
      const myNick = socketNicks.get(socket.id) || "";
      if (!myNick) { socket.emit("referral:result", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const refNick = normalizeWord(String(data?.nickname || ""));
      if (!refNick) { socket.emit("referral:result", { ok: false, reason: "추천인 닉네임을 입력해주세요." }); return; }

      const myId = normKey(myNick);
      const myPd = await getPlayerData(myId);
      if (myPd.referredBy) {
        socket.emit("referral:result", { ok: false, reason: "이미 추천인이 등록되어 있습니다.", referredBy: myPd.referredBy });
        return;
      }
      if (normKey(refNick) === myId) {
        socket.emit("referral:result", { ok: false, reason: "자기 자신을 추천인으로 등록할 수 없습니다." });
        return;
      }
      let refId = await findPlayerIdByNickname(refNick);
      if (!refId) refId = await findPlayerIdByNickname(normalizeWord(refNick));
      if (!refId) {
        socket.emit("referral:result", { ok: false, reason: "존재하지 않는 닉네임입니다. 정확히 입력해주세요." });
        return;
      }
      if (normKey(String(refId)) === myId || normKey(String(refId.nickname || "")) === myId) {
        socket.emit("referral:result", { ok: false, reason: "자기 자신을 추천인으로 등록할 수 없습니다." });
        return;
      }

      const refPd = await getPlayerData(refId);
      if (myPd.referredBy) {
        socket.emit("referral:result", { ok: false, reason: "이미 추천인이 등록되어 있습니다.", referredBy: myPd.referredBy });
        return;
      }
      const myAccountId = normKey(myPd.nickname) || myId;
      const refAccountId = normKey(refPd.nickname) || normKey(String(refId));
      const txMine = await beginEconomyTx({
        accountId: myAccountId, idemKey: `referral:join:${myAccountId}`,
        delta: REFERRAL_JOIN_COIN, reason: "referral_join", ref: refNick
      });
      if (!txMine.ok) {
        socket.emit("referral:result", { ok: false, reason: "이미 추천인 보상을 받았습니다." });
        return;
      }
      const txRef = await beginEconomyTx({
        accountId: refAccountId, idemKey: `referral:invite:${myAccountId}`,
        delta: REFERRAL_INVITE_COIN, reason: "referral_invite", ref: myNick
      });
      if (!txRef.ok) {
        await abortEconomyTx(txMine);
        socket.emit("referral:result", { ok: false, reason: "추천 보상을 이미 지급했습니다." });
        return;
      }
      myPd.referredBy = refNick;
      myPd.referredAt = new Date().toISOString();
      myPd.money = Math.max(0, (Number(myPd.money) || 0) + REFERRAL_JOIN_COIN);
      refPd.referralCount = Math.max(0, Math.floor(Number(refPd.referralCount) || 0)) + 1;
      refPd.money = Math.max(0, (Number(refPd.money) || 0) + REFERRAL_INVITE_COIN);
      try {
        await Promise.all([savePlayerData(myId, myPd), savePlayerData(refId, refPd)]);
        await finishEconomyTx(txMine, myPd.money);
        await finishEconomyTx(txRef, refPd.money);
      } catch (e) {
        await abortEconomyTx(txMine);
        await abortEconomyTx(txRef);
        throw e;
      }

      /* 추천인이 지금 온라인이면 보상 알림을 바로 보낸다 */
      const refSid = onlineNicks.get(normKey(refNick));
      const refSocket = refSid ? io.sockets.sockets.get(refSid) : null;
      if (refSocket) {
        refSocket.emit("referral:reward", {
          from: myNick,
          count: refPd.referralCount,
          coin: REFERRAL_INVITE_COIN,
          money: Math.max(0, Math.floor(Number(refPd.money) || 0))
        });
      }

      socket.emit("referral:result", {
        ok: true, referredBy: refNick, coin: REFERRAL_JOIN_COIN,
        money: Math.max(0, Math.floor(Number(myPd.money) || 0)),
        message: `'${refNick}' 님을 추천인으로 등록했습니다. +${REFERRAL_JOIN_COIN}코인 지급!`
      });
      console.log(`[REFERRAL] '${myNick}' ← '${refNick}' (누적 ${refPd.referralCount}회)`);
    } catch (err) {
      console.error("추천인 등록 오류:", err);
      socket.emit("referral:result", { ok: false, reason: "추천인 등록에 실패했습니다." });
    }
  });

  /* 추천인 등록 상태 */
  socket.on("referral:status", async () => {
    try {
      const myNick = socketNicks.get(socket.id) || "";
      if (!myNick) { socket.emit("referral:status", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const myPd = await getPlayerData(normKey(myNick));
      socket.emit("referral:status", {
        ok: true,
        referredBy: myPd.referredBy || null,
        count: Math.max(0, Math.floor(Number(myPd.referralCount) || 0)),
        joinCoin: REFERRAL_JOIN_COIN,
        inviteCoin: REFERRAL_INVITE_COIN
      });
    } catch (err) { console.error("추천인 상태 오류:", err); }
  });

  /* -- 우편(쪽지)함 — 목록 / 수령 ------------------------ */
  socket.on("mail:list", async () => {
    try {
      const myNick = socketNicks.get(socket.id) || "";
      if (!myNick) { socket.emit("mail:list", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const myPd = await getPlayerData(normKey(myNick));
      const mail = (Array.isArray(myPd.mail) ? myPd.mail : [])
        .map(m => ({
          id: String(m?.id || ""),
          title: String(m?.title || "쪽지"),
          body: String(m?.body || ""),
          coin: Math.max(0, Math.floor(Number(m?.coin) || 0)),
          at: String(m?.at || ""),
          from: String(m?.from || ""),
          read: !!m?.read
        }))
        .filter(m => m.id);
      const unread = mail.filter(m => !m.read).length;
      socket.emit("mail:list", { ok: true, mail, unread });
    } catch (err) { console.error("쪽지함 조회 오류:", err); socket.emit("mail:list", { ok: false, reason: "쪽지함을 불러오지 못했습니다." }); }
  });

  socket.on("mail:claim", async (data) => {
    try {
      const myNick = socketNicks.get(socket.id) || "";
      if (!myNick) { socket.emit("mail:claim", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const mailId = String(data?.id || "");
      if (!mailId) { socket.emit("mail:claim", { ok: false, reason: "쪽지가 지정되지 않았습니다." }); return; }
      const myId = normKey(myNick);
      const myPd = await getPlayerData(myId);
      const mail = Array.isArray(myPd.mail) ? myPd.mail : [];
      const entry = mail.find(m => String(m?.id || "") === mailId);
      if (!entry) { socket.emit("mail:claim", { ok: false, reason: "찾을 수 없는 쪽지입니다." }); return; }
      if (entry.read) { socket.emit("mail:claim", { ok: false, reason: "이미 수령한 쪽지입니다." }); return; }
      const coin = Math.min(MAIL_COIN_MAX, Math.max(0, Math.floor(Number(entry.coin) || 0)));
      const tx = await beginEconomyTx({
        accountId: myId, idemKey: `mail:${myId}:${mailId}`,
        delta: coin, reason: "mail", ref: `mail:${mailId}`
      });
      if (!tx.ok) { socket.emit("mail:claim", { ok: false, reason: "이미 수령한 쪽지입니다." }); return; }
      entry.read = true;
      myPd.money = Math.max(0, (Number(myPd.money) || 0) + coin);
      myPd.mail = mail;
      try {
        await savePlayerData(myId, myPd);
        await finishEconomyTx(tx, myPd.money);
      } catch (e) {
        await abortEconomyTx(tx);
        throw e;
      }
      const unread = mail.filter(m => !m?.read).length;
      socket.emit("mail:claim", {
        ok: true, id: mailId, coin,
        money: Math.max(0, Math.floor(Number(myPd.money) || 0)),
        unread,
        message: coin > 0 ? `쪽지를 수령했습니다. +${coin.toLocaleString()}코인!` : "쪽지를 확인했습니다."
      });
    } catch (err) {
      console.error("쪽지 수령 오류:", err);
      socket.emit("mail:claim", { ok: false, reason: "쪽지 수령에 실패했습니다." });
    }
  });

  /* -- 길드/클랜 — 생성 / 가입 / 나가기 / 추방 / 해산 ------- */
  socket.on("guild:create", async (data) => {
    try {
      const nick = socketNicks.get(socket.id) || "";
      if (!nick) { socket.emit("guild:state", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const name = String(data?.name || "").trim().slice(0, 12);
      if (name.length < 2) { socket.emit("guild:state", { ok: false, reason: "길드 이름은 2자 이상 입력해주세요." }); return; }
      const nk = normKey(nick);
      const pd = await getPlayerData(nk);
      await loadGuilds();
      if (guildOf(nk)) { socket.emit("guild:state", { ok: false, reason: "이미 길드에 가입되어 있습니다." }); return; }
      const gkey = normKey(name);
      if (guildCache[gkey]) { socket.emit("guild:state", { ok: false, reason: "이미 존재하는 길드 이름입니다." }); return; }
      const cost = GUILD_CREATE_COIN;
      if ((Number(pd.money) || 0) < cost) {
        socket.emit("guild:state", { ok: false, reason: `길드 생성에는 ${cost.toLocaleString()}코인이 필요합니다.` });
        return;
      }
      const tx = await beginEconomyTx({
        accountId: nk, idemKey: `guild:create:${nk}:${gkey}`,
        delta: -cost, reason: "guild_create", ref: gkey
      });
      if (!tx.ok) {
        socket.emit("guild:state", { ok: false, reason: tx.duplicate ? "이미 처리된 길드 생성입니다." : "길드 생성 기록에 실패했습니다." });
        return;
      }
      pd.money = Math.max(0, (Number(pd.money) || 0) - cost);
      try {
        await savePlayerData(nk, pd);
        await finishEconomyTx(tx, pd.money);
      } catch (e) {
        await abortEconomyTx(tx);
        throw e;
      }
      const now = new Date().toISOString();
      guildCache[gkey] = {
        key: gkey, name, leader: nk, leaderNick: nick, createdAt: now,
        members: [{ key: nk, nick, joinedAt: now }]
      };
      guildWeek.ensureGuildWeek(guildCache[gkey], getKstWeek());
      saveGuilds();
      socket.emit("guild:state", {
        ...buildGuildState(nick),
        message: `'${name}' 길드를 만들었습니다! (-${cost.toLocaleString()}코인)`,
        money: Math.max(0, Math.floor(Number(pd.money) || 0))
      });
    } catch (err) { console.error("길드 생성 오류:", err); socket.emit("guild:state", { ok: false, reason: "길드 생성에 실패했습니다." }); }
  });

  socket.on("guild:join", async (data) => {
    try {
      const nick = socketNicks.get(socket.id) || "";
      if (!nick) { socket.emit("guild:state", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const name = String(data?.name || "").trim();
      if (!name) { socket.emit("guild:state", { ok: false, reason: "가입할 길드 이름을 입력해주세요." }); return; }
      const nk = normKey(nick);
      await loadGuilds();
      const g = guildCache[normKey(name)];
      if (!g) { socket.emit("guild:state", { ok: false, reason: "존재하지 않는 길드입니다." }); return; }
      if (guildOf(nk)) { socket.emit("guild:state", { ok: false, reason: "이미 길드에 가입되어 있습니다. 먼저 나가야 합니다." }); return; }
      if (g.members.length >= GUILD_MAX_MEMBERS) {
        socket.emit("guild:state", { ok: false, reason: "길드 인원이 가득 찼습니다." });
        return;
      }
      g.members.push({ key: nk, nick, joinedAt: new Date().toISOString() });
      saveGuilds();
      socket.emit("guild:state", { ...buildGuildState(nick), message: `'${g.name}' 길드에 가입했습니다!` });
      notifyGuildMembers(g, `'${nick}' 님이 가입했습니다.`, nk);
    } catch (err) { console.error("길드 가입 오류:", err); socket.emit("guild:state", { ok: false, reason: "길드 가입에 실패했습니다." }); }
  });

  socket.on("guild:leave", async () => {
    try {
      const nick = socketNicks.get(socket.id) || "";
      if (!nick) { socket.emit("guild:state", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const nk = normKey(nick);
      await loadGuilds();
      const g = guildOf(nk);
      if (!g) { socket.emit("guild:state", { ok: false, reason: "가입된 길드가 없습니다." }); return; }

      if (g.members.length <= 1) {
        /* 마지막 멤버가 나가면 길드 해산 */
        delete guildCache[g.key];
        saveGuilds();
        socket.emit("guild:state", { ok: true, guild: null, message: `'${g.name}' 길드를 해산했습니다.` });
        return;
      }
      const wasLeader = g.leader === nk;
      g.members = g.members.filter(m => m.key !== nk);
      if (wasLeader) {
        /* 리더가 나가면 가장 오래된 멤버가 리더 승계 */
        g.leader = g.members[0].key;
        g.leaderNick = g.members[0].nick;
      }
      saveGuilds();
      socket.emit("guild:state", { ok: true, guild: null, message: `'${g.name}' 길드에서 나갔습니다.` });
      notifyGuildMembers(g, `'${nick}' 님이 ${wasLeader ? "리더 자리를 넘기고 " : ""}나갔습니다.`, nk);
    } catch (err) { console.error("길드 나가기 오류:", err); socket.emit("guild:state", { ok: false, reason: "길드 나가기에 실패했습니다." }); }
  });

  socket.on("guild:kick", async (data) => {
    try {
      const nick = socketNicks.get(socket.id) || "";
      if (!nick) { socket.emit("guild:state", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const nk = normKey(nick);
      const targetNick = String(data?.nickname || "").trim();
      const tk = normKey(targetNick);
      if (!tk) { socket.emit("guild:state", { ok: false, reason: "추방할 닉네임을 입력해주세요." }); return; }
      if (tk === nk) { socket.emit("guild:state", { ok: false, reason: "자기 자신은 추방할 수 없습니다." }); return; }
      await loadGuilds();
      const g = guildOf(nk);
      if (!g) { socket.emit("guild:state", { ok: false, reason: "가입된 길드가 없습니다." }); return; }
      if (g.leader !== nk) { socket.emit("guild:state", { ok: false, reason: "리더만 멤버를 추방할 수 있습니다." }); return; }
      if (!g.members.some(m => m.key === tk)) { socket.emit("guild:state", { ok: false, reason: "길드 멤버가 아닙니다." }); return; }
      g.members = g.members.filter(m => m.key !== tk);
      saveGuilds();
      socket.emit("guild:state", { ...buildGuildState(nick), message: `'${targetNick}' 님을 추방했습니다.` });
      notifyGuildMembers(g, `'${targetNick}' 님이 추방되었습니다.`, tk);
      /* 추방된 대상이 온라인이면 즉시 알림 */
      const tsid = onlineNicks.get(tk);
      const tsock = tsid ? io.sockets.sockets.get(tsid) : null;
      if (tsock) {
        tsock.emit("guild:state", { ok: true, guild: null, reason: `'${g.name}' 길드에서 추방되었습니다.` });
        tsock.emit("guild:notice", { text: `'${g.name}' 길드에서 추방되었습니다.`, guild: g.name });
      }
    } catch (err) { console.error("길드 추방 오류:", err); socket.emit("guild:state", { ok: false, reason: "추방에 실패했습니다." }); }
  });

  socket.on("guild:disband", async () => {
    try {
      const nick = socketNicks.get(socket.id) || "";
      if (!nick) { socket.emit("guild:state", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      const nk = normKey(nick);
      await loadGuilds();
      const g = guildOf(nk);
      if (!g) { socket.emit("guild:state", { ok: false, reason: "가입된 길드가 없습니다." }); return; }
      if (g.leader !== nk) { socket.emit("guild:state", { ok: false, reason: "리더만 길드를 해산할 수 있습니다." }); return; }
      notifyGuildMembers(g, `'${g.name}' 길드가 해산되었습니다.`, nk);
      delete guildCache[g.key];
      saveGuilds();
      socket.emit("guild:state", { ok: true, guild: null, message: `'${g.name}' 길드를 해산했습니다.` });
    } catch (err) { console.error("길드 해산 오류:", err); socket.emit("guild:state", { ok: false, reason: "길드 해산에 실패했습니다." }); }
  });

  socket.on("guild:info", async () => {
    try {
      const nick = socketNicks.get(socket.id) || "";
      if (!nick) { socket.emit("guild:state", { ok: false, reason: "먼저 닉네임을 설정해주세요." }); return; }
      await ensureGuildWeekRollover();
      await loadGuilds();
      if (guildDuel.ensurePairings(guildCache, getKstWeek())) saveGuilds();
      socket.emit("guild:state", buildGuildState(nick));
    } catch (err) { console.error("길드 조회 오류:", err); socket.emit("guild:state", { ok: false, reason: "길드 정보를 불러오지 못했습니다." }); }
  });

  /* 길드 주간 대항전 순위 — 로그인/닉네임 없이도 볼 수 있다. */
  socket.on("guild:weekly", async () => {
    try {
      await ensureGuildWeekRollover();
      await loadGuilds();
      if (guildDuel.ensurePairings(guildCache, getKstWeek())) saveGuilds();
      const nick = socketNicks.get(socket.id) || "";
      socket.emit("guild:weekly", { ok: true, ...buildGuildWeekBoard(nick) });
    } catch (err) {
      console.error("길드 주간 순위 오류:", err);
      socket.emit("guild:weekly", { ok: false, reason: "주간 순위를 불러오지 못했습니다." });
    }
  });

  /* -- 계정 복구 · 기기 연결 ----------------------------- */
  socket.on("account:recoveryCode", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      if (!pd.nickname || isGhostRecord(pd)) {
        socket.emit("account:recoveryCode", { ok: false, reason: "먼저 닉네임을 설정해주세요." });
        return;
      }
      const code = randomRecoveryCode(RECOVERY_CODE_LENGTH);
      pd.recoveryHash = hashRecoveryCode(code, normKey(pd.nickname));
      pd.recoveryAt = new Date().toISOString();
      await savePlayerData(socket.id, pd);
      socket.emit("account:recoveryCode", {
        ok: true, code, createdAt: pd.recoveryAt,
        message: "복구 코드를 안전한 곳에 보관하세요. 이 코드는 다시 보여주지 않습니다."
      });
    } catch (err) {
      console.error("복구 코드 발급 오류:", err);
      socket.emit("account:recoveryCode", { ok: false, reason: "복구 코드를 만들지 못했습니다." });
    }
  });

  socket.on("account:recover", async (data) => {
    try {
      if (!recoveryAttemptAllowed(socket.id)) {
        socket.emit("account:recoverResult", { ok: false, reason: "복구 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." });
        return;
      }
      const nickname = normalizeWord(data?.nickname);
      const code = normalizeRecoveryCode(data?.code);
      if (!nickname || !code) {
        socket.emit("account:recoverResult", { ok: false, reason: "닉네임과 복구 코드를 입력해주세요." });
        return;
      }
      const target = await getPlayerData(normKey(nickname));
      if (!target.recoveryHash || !sameRecoveryHash(hashRecoveryCode(code, normKey(nickname)), target.recoveryHash)) {
        socket.emit("account:recoverResult", { ok: false, reason: "닉네임 또는 복구 코드가 올바르지 않습니다." });
        return;
      }
      const result = await adoptAccountForSocket(socket, target.nickname, "recovery");
      socket.emit("account:recoverResult", result);
    } catch (err) {
      console.error("계정 복구 오류:", err);
      socket.emit("account:recoverResult", { ok: false, reason: "계정 복구에 실패했습니다." });
    }
  });

  socket.on("account:linkCode", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      if (!pd.nickname || isGhostRecord(pd)) {
        socket.emit("account:linkCode", { ok: false, reason: "먼저 닉네임을 설정해주세요." });
        return;
      }
      const code = issueLinkCode(normKey(pd.nickname));
      socket.emit("account:linkCode", {
        ok: true, code, expiresInMs: LINK_CODE_TTL_MS,
        message: "10분 안에 다른 기기에서 이 코드를 입력하세요. 한 번만 사용할 수 있습니다."
      });
    } catch (err) {
      console.error("기기 연결 코드 발급 오류:", err);
      socket.emit("account:linkCode", { ok: false, reason: "연결 코드를 만들지 못했습니다." });
    }
  });

  socket.on("account:linkRedeem", async (data) => {
    try {
      if (data?.confirm !== true) {
        socket.emit("account:linkResult", { ok: false, reason: "이 기기의 기존 게스트 데이터를 대체한다는 확인이 필요합니다." });
        return;
      }
      const ownerKey = redeemLinkCode(data?.code);
      if (!ownerKey) {
        socket.emit("account:linkResult", { ok: false, reason: "연결 코드가 만료되었거나 이미 사용되었습니다." });
        return;
      }
      const owner = await getPlayerData(ownerKey);
      if (!owner || !owner.nickname || normKey(owner.nickname) !== normKey(ownerKey)) {
        socket.emit("account:linkResult", { ok: false, reason: "연결할 계정을 찾을 수 없습니다." });
        return;
      }
      const result = await adoptAccountForSocket(socket, owner.nickname, "device");
      socket.emit("account:linkResult", result);
    } catch (err) {
      console.error("기기 연결 오류:", err);
      socket.emit("account:linkResult", { ok: false, reason: "기기 연결에 실패했습니다." });
    }
  });

  /* 표시 이름 설정 — 로그인 여부와 무관하게 가능하다 (게스트 포함).
     이름은 정규화(공백 제거·소문자) 후 대소문자 무시로 고유해야 하며,
     서버/DB에서 원자적으로 선점한다.
     - 최초 설정: 해당 이름의 기존 행(본인 계정)을 그대로 채택한다.
     - 이름 변경: 기존 계정 전체를 새 이름으로 승계하고 옛 행은 제거한다.
       같은 계정이 이름만 바꾼 경우에도 능력치·코인·랭킹이 초기화되지 않는다.
       비용은 1회 무료, 이후 회당 RENAME_PRICE */
  socket.on("player:setName", async (data) => {
    try {
      const nickname = normalizeWord(data?.nickname);
      if (!nickname) {
        socket.emit("player:nameUpdated", { ok: false, reason: "이름을 입력해주세요." });
        return;
      }
      if (nickname.length > 12) {
        socket.emit("player:nameUpdated", { ok: false, reason: "이름은 12자 이내로 입력해주세요." });
        return;
      }
      /* 입력창 안내문이 그대로 이름으로 저장되던 경로 차단 */
      if (isPlaceholderNickname(nickname)) {
        socket.emit("player:nameUpdated", { ok: false, reason: "사용할 수 없는 이름입니다. 다른 이름을 입력해주세요." });
        return;
      }
      /* 운영 제재 — 밴 계정은 이름을 설정할 수 없다 */
      const banMsg = banGuard(nickname);
      if (banMsg) {
        socket.emit("player:nameUpdated", { ok: false, reason: banMsg, banned: true });
        return;
      }
      /* 로그인 세션의 UID — 게스트(미로그인)는 빈 값으로도 이름을 정할 수 있다 */
      const uid = socketFirebaseUid.get(socket.id) || "";
      const prevNick = socketNicks.get(socket.id) || "";
      const prevKey = prevNick ? normKey(prevNick) : "";
      const isRename = !!prevKey && prevKey !== normKey(nickname);

      /* 이름 변경 전 검사 — 대상 이름 충돌과 비용을 선점 확인한다 */
      let renameCost = 0;
      let prevOwned = false;
      let prevRow = null;
      if (isRename) {
        /* 대상 이름은 미사용이거나 본인 UID 소유 행만 허용한다.
           남의 계정 행을 덮어쓰거나 빈 행에 승계해 파괴하지 않도록 */
        let targetUid = null;
        if (dbMode === "pg") {
          const r = await dbPool.query("SELECT firebase_uid FROM players WHERE id = $1", [normKey(nickname)]);
          if (r.rows.length) targetUid = String(r.rows[0].firebase_uid || "");
        } else {
          const row = playerCache.get(normKey(nickname));
          if (row && row.nickname && normKey(row.nickname) === normKey(nickname)) targetUid = String(row.firebaseUid || "");
        }
        if (targetUid !== null && !(uid && targetUid === uid)) {
          socket.emit("player:nameUpdated", { ok: false, reason: "이미 사용 중인 이름입니다." });
          return;
        }
        /* 옛 계정 행 — 본인 소유일 때만 승계한다 */
        prevRow = await getPlayerData(prevKey);
        prevOwned = !!prevRow && (!prevRow.firebaseUid || (uid && prevRow.firebaseUid === uid));
        if (prevOwned) {
          const done = Number(prevRow.nameChanges || 0);
          renameCost = done >= 1 ? RENAME_PRICE : 0;
          if (renameCost > 0 && Number(prevRow.money || 0) < renameCost) {
            socket.emit("player:nameUpdated", {
              ok: false,
              reason: `이름 변경 비용이 부족합니다. (${renameCost.toLocaleString()} 코인 필요, 현재 ${Number(prevRow.money || 0).toLocaleString()} 코인)`
            });
            return;
          }
        }
      }

      const claim = await claimDisplayName(uid, nickname);
      if (!claim.ok) {
        socket.emit("player:nameUpdated", { ok: false, reason: claim.reason });
        return;
      }
      const room = getPlayerRoom(socket);
      if (room) {
        const dup = room.players.find(p => !p.isBot && p.socketId !== socket.id && normKey(p.nickname) === claim.key);
        if (dup) {
          socket.emit("player:nameUpdated", { ok: false, reason: "이미 사용 중인 이름입니다." });
          return;
        }
        const me = room.players.find(p => p.socketId === socket.id);
        if (me) me.nickname = nickname;
      }

      /* 승계(개명)이면 옛 계정 데이터가 곧 새 행의 base, 아니면 대상 행을 채택 */
      const playerData = (isRename && prevOwned && prevRow) ? prevRow : await getPlayerData(claim.key);
      playerData.nickname = nickname;
      playerData.id = claim.key;
      if (uid) {
        playerData.firebaseUid = uid;
        const email = socketFirebaseEmail.get(socket.id) || "";
        if (email) {
          playerData.firebaseEmail = email;
          if (!playerData.email) playerData.email = email;
        }
      }
      if (isRename && prevOwned) {
        playerData.nameChanges = Number(prevRow.nameChanges || 0) + 1;
        if (renameCost > 0) playerData.money = Math.max(0, Number(playerData.money || 0) - renameCost);
      }
      const welcomeReward = applyWelcomeReward(playerData, socket);
      await savePlayerData(claim.key, playerData);
      if (welcomeReward) await recordWelcomeLedger(claim.key, welcomeReward, playerData.money);
      /* 옛 이름 행 제거 — 랭킹/리더보드에 옛 이름이 남아 초기화·중복의 원인이 되지 않게 한다 */
      if (isRename && prevOwned && prevKey !== claim.key) {
        try {
          if (dbMode === "pg") {
            await dbPool.query("DELETE FROM players WHERE id = $1", [prevKey]);
            playerCache.delete(prevKey);
          } else {
            playerCache.delete(prevKey);
            saveJsonDb();
          }
        } catch (e) { console.error("이름 변경 옛 계정 정리 오류:", e.message); }
        /* 친구/초대/길드에 남은 옛 키를 새 계정 키로 치환 — 키를 갱신하지 않으면
           목록 조회 시 옛 행을 못 찾아 친구·길드가 사라진다 */
        renameAccountRefs(prevKey, claim.key, nickname);
        await renameEconomyAccount(prevKey, claim.key);
        await pushManager.renameAccount(prevKey, claim.key);
      }
      registerOnline(socket.id, nickname);
      socket.emit("player:nameUpdated", {
        ok: true, nickname, previousNickname: prevNick || "",
        renamed: isRename && prevOwned, nameChanges: Number(playerData.nameChanges || 0),
        cost: renameCost, money: Number(playerData.money || 0),
        appliedAt: new Date().toISOString()
      });
      if (room) broadcastRoomState(room);
      /* 개명을 전체에 알림 — 친구·길드·채팅 화면의 옛 이름이 즉시 새 이름으로 바뀐다.
         (이 알림이 없으면 다른 유저 화면은 새로고침 전까지 옛 이름을 유지한다) */
      if (isRename && prevOwned && prevKey !== claim.key) {
        io.emit("profile:nickChanged", { old: prevNick, oldKey: prevKey, new: nickname });
      }

      /* 감시 목록(로그인 알림) — 최고 관리자에게 접속 알림 */
      if (watchNicks.some(w => normKey(w) === normKey(nickname))) {
        notifySuperAdmins({ nickname, at: new Date().toISOString(), reason: "login" });
      }
    } catch (err) { console.error("닉네임 설정 오류:", err); }
  });

  /* Firebase(Google) 로그인 — 검증된 UID/이메일을 소켓 세션에 기록한다.
     이름이 아직 없으면 needNickname으로 알리고, 이름은 player:setName에서 정한다.
     관리자 이메일이면 이 세션에 관리자 권한을 부여한다 (서버 측 상태, 클라이언트 조작 불가) */
  socket.on("player:firebaseAuth", async (data) => {
    try {
      if (!firebaseReady) {
        socket.emit("player:firebaseAuthResult", { ok: false, reason: "서버에 Firebase가 설정되지 않았습니다. (FIREBASE_SERVICE_ACCOUNT)" });
        return;
      }
      const idToken = String(data?.idToken || "");
      if (!idToken) {
        socket.emit("player:firebaseAuthResult", { ok: false, reason: "로그인 토큰이 없습니다." });
        return;
      }
      const decoded = await verifyFirebaseIdToken(idToken);
      const uid = String(decoded.uid || "");
      const email = String(decoded.email || "");
      if (!uid) {
        socket.emit("player:firebaseAuthResult", { ok: false, reason: "토큰에서 사용자 ID를 확인하지 못했습니다." });
        return;
      }
      /* 운영 제재 — 밴된 계정(Google UID)은 로그인 자체를 차단 */
      const uidBanMsg = banGuardByUid(uid);
      if (uidBanMsg) {
        socket.emit("player:firebaseAuthResult", { ok: false, reason: uidBanMsg, banned: true });
        return;
      }
      /* 검증된 UID/이메일은 관리자 여부와 무관하게 세션에 유지한다.
         (비관리자까지 지웠던 이전 코드 때문에 로그인 후에도 이름 변경이
          계속 "Google 로그인을 해주세요"로 거부되는 버그가 있었다) */
      socketFirebaseUid.set(socket.id, uid);
      socketFirebaseEmail.set(socket.id, email);
      if (isAdminEmail(email)) {
        adminAuthed.set(socket.id, { role: "super", email });
      } else {
        adminAuthed.delete(socket.id);
      }
      const pd = await getPlayerData(socket.id);
      const nick = pd.nickname && normKey(pd.nickname) !== normKey("플레이어") ? pd.nickname : "";
      if (!nick) {
        /* 같은 UID가 이미 가진 이름이 있으면 자동 복원 */
        let restored = "";
        if (dbMode === "pg") {
          try {
            const r = await dbPool.query("SELECT nickname FROM players WHERE firebase_uid = $1 LIMIT 1", [uid]);
            if (r.rows.length && r.rows[0].nickname) restored = String(r.rows[0].nickname);
          } catch (e) { /* 무시하고 이름 입력으로 진행 */ }
        } else {
          for (const p of playerCache.values()) {
            if (p && String(p.firebaseUid || "") === uid && p.nickname && normKey(p.nickname) !== normKey("플레이어")) {
              restored = p.nickname;
              break;
            }
          }
        }
        if (restored) {
          registerOnline(socket.id, restored);
          socket.emit("player:firebaseAuthResult", {
            ok: true, uid, email,
            name: decoded.name || "", picture: decoded.picture || "", nickname: restored,
            isAdmin: isAdminEmail(email)
          });
          socket.emit("player:nameUpdated", { ok: true, nickname: restored });
          socket.emit("player:ranking", await getRankingPayload(socket.id));
          try {
            const rpd = await getPlayerData(restored);
            const prevSeen = String(rpd.lastSeen || "");
            const reward = applyWelcomeReward(rpd, socket);
            if (reward !== null || prevSeen !== rpd.lastSeen) await savePlayerData(restored, rpd);
            if (reward) await recordWelcomeLedger(restored, reward, rpd.money);
          } catch (e) { console.error("복귀 보상 저장 오류:", e.message); }
          console.log(`[FIREBASE] '${restored}' ← ${email || uid} (복원)`);
          return;
        }
        socket.emit("player:firebaseAuthResult", {
          ok: true, needNickname: true, uid, email,
          name: decoded.name || "", picture: decoded.picture || "",
          isAdmin: isAdminEmail(email),
          reason: "표시할 이름을 정해주세요. (다른 사람과 중복될 수 없습니다)"
        });
        return;
      }
      /* 기존 이름 행에 UID 연결 (원자적 선점으로 도용 방지) */
      const claim = await claimDisplayName(uid, nick);
      if (!claim.ok) {
        socket.emit("player:firebaseAuthResult", {
          ok: true, needNickname: true, uid, email,
          name: decoded.name || "", picture: decoded.picture || "",
          isAdmin: isAdminEmail(email),
          reason: "기존 이름이 다른 계정에 연결되어 있습니다. 새 이름을 정해주세요."
        });
        return;
      }
      pd.firebaseUid = uid;
      pd.firebaseEmail = email;
      pd.firebaseName = decoded.name || "";
      const welcomeReward = applyWelcomeReward(pd, socket);
      await savePlayerData(socket.id, pd);
      if (welcomeReward) await recordWelcomeLedger(normKey(pd.nickname) || socket.id, welcomeReward, pd.money);
      registerOnline(socket.id, pd.nickname);
      socket.emit("player:firebaseAuthResult", {
        ok: true, uid, email,
        name: decoded.name || "", picture: decoded.picture || "", nickname: pd.nickname,
        isAdmin: isAdminEmail(email)
      });
      console.log(`[FIREBASE] '${pd.nickname}' ← ${email || uid}`);
    } catch (err) {
      socket.emit("player:firebaseAuthResult", { ok: false, reason: "Firebase 인증 실패: " + err.message });
    }
  });

  /* 로그아웃 — 클라이언트의 Firebase signOut에 맞춰 소켓 세션의 로그인 정보를 제거한다.
     채팅·랭킹은 이 세션 상태로 게이트된다 */
  socket.on("player:firebaseLogout", () => {
    socketFirebaseUid.delete(socket.id);
    socketFirebaseEmail.delete(socket.id);
    adminAuthed.delete(socket.id);
    socket.emit("player:firebaseAuthResult", { ok: false, loggedOut: true, reason: "로그아웃되었습니다." });
  });

  /* =========================================================
     친구 — 신청/수락/거절/삭제/목록, 온라인 상태 포함 (양방향 친구)
  ========================================================= */
  const emitFriendsUpdated = async (socket, ok, reason, extra) => {
    const nm = socketNicks.get(socket.id);
    if (!nm) {
      socket.emit("friends:updated", { ok: false, reason: "닉네임을 먼저 설정해주세요.", registered: false, friends: [] });
      return;
    }
    const me = normKey(nm);
    const list = me ? [...(friendsMap.get(me) || new Set())]
      .map(f => ({ nickname: nicknameDisplay(f), online: onlineNicks.has(f) && io.sockets.sockets.has(onlineNicks.get(f)) })) : [];
    /* 받은 친구 신청 목록 (나를 신청한 쪽) */
    const requests = [];
    for (const [fromKey, toSet] of friendRequests) {
      if (me && toSet.has(me)) requests.push(nicknameDisplay(fromKey));
    }
    socket.emit("friends:updated", { ok, reason, registered: true, friends: list, requests, ...(extra || {}) });
  };

  const notifyFriendsChanged = (key, payload) => {
    const tId = onlineNicks.get(key);
    if (tId && io.sockets.sockets.has(tId)) io.to(tId).emit("friends:updated", { ...payload });
  };

  const makeFriends = (me, target) => {
    if (!friendsMap.has(me)) friendsMap.set(me, new Set());
    if (!friendsMap.has(target)) friendsMap.set(target, new Set());
    friendsMap.get(me).add(target);
    friendsMap.get(target).add(me);
  };

  socket.on("friends:add", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const myNick = String(pd.nickname || "").trim();
      const me = normKey(myNick);
      const target = normKey(data?.nickname);
      if (!me || !myNick) { await emitFriendsUpdated(socket, false, "닉네임을 먼저 설정해주세요."); return; }
      if (!target) { await emitFriendsUpdated(socket, false, "친구로 추가할 이름을 입력해주세요."); return; }
      if (target === me) { await emitFriendsUpdated(socket, false, "자기 자신은 친구로 추가할 수 없습니다."); return; }
      if (!(await nicknameKnown(target))) { await emitFriendsUpdated(socket, false, `'${String(data?.nickname).trim()}' 닉네임을 찾을 수 없습니다.`); return; }
      if ((friendsMap.get(me) || new Set()).has(target)) { await emitFriendsUpdated(socket, false, "이미 친구입니다."); return; }
      if ((friendRequests.get(me) || new Set()).has(target)) { await emitFriendsUpdated(socket, false, "이미 친구 신청을 보냈습니다. 상대가 수락할 때까지 기다려주세요."); return; }

      /* 상대가 먼저 나에게 신청해 둔 상태라면 즉시 친구가 된다 */
      if ((friendRequests.get(target) || new Set()).has(me)) {
        friendRequests.get(target).delete(me);
        makeFriends(me, target);
        saveFriends();
        await emitFriendsUpdated(socket, true, `'${String(data?.nickname).trim()}' 님과 친구가 되었습니다.`);
        notifyFriendsChanged(target, { ok: true, reason: `'${myNick}' 님이 친구 신청을 수락했습니다.` });
        console.log(`[FRIENDS] '${myNick}' ↔ '${String(data?.nickname).trim()}' 친구 (상호 신청)`);
        return;
      }

      if (!friendRequests.has(me)) friendRequests.set(me, new Set());
      friendRequests.get(me).add(target);
      saveFriends();
      await emitFriendsUpdated(socket, true, `'${String(data?.nickname).trim()}' 님에게 친구 신청을 보냈습니다.`);
      notifyFriendsChanged(target, { ok: true, reason: `'${myNick}' 님이 친구 신청을 보냈습니다.`, requestFrom: myNick });
      notifyPush(target, {
        title: "친구 신청", body: myNick + " 님이 친구 신청을 보냈습니다.",
        url: "/", tag: "friend:" + me
      });
      console.log(`[FRIENDS] '${myNick}' → '${String(data?.nickname).trim()}' 친구 신청`);
    } catch (err) { console.error("친구 신청 오류:", err); }
  });

  socket.on("friends:accept", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const myNick = String(pd.nickname || "").trim();
      const me = normKey(myNick);
      const target = normKey(data?.nickname);
      if (!me || !target) { await emitFriendsUpdated(socket, false, "이름을 확인해주세요."); return; }
      if (!(friendRequests.get(target) || new Set()).has(me)) {
        await emitFriendsUpdated(socket, false, `'${String(data?.nickname).trim()}' 님의 친구 신청이 없습니다.`);
        return;
      }
      friendRequests.get(target).delete(me);
      makeFriends(me, target);
      saveFriends();
      await emitFriendsUpdated(socket, true, `'${String(data?.nickname).trim()}' 님과 친구가 되었습니다.`);
      notifyFriendsChanged(target, { ok: true, reason: `'${myNick}' 님이 친구 신청을 수락했습니다.` });
      console.log(`[FRIENDS] '${myNick}' ↔ '${String(data?.nickname).trim()}' 친구 (수락)`);
    } catch (err) { console.error("친구 수락 오류:", err); }
  });

  socket.on("friends:reject", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const me = normKey(String(pd.nickname || "").trim());
      const target = normKey(data?.nickname);
      if (!me || !target) { await emitFriendsUpdated(socket, false, "이름을 확인해주세요."); return; }
      if (!(friendRequests.get(target) || new Set()).delete(me)) {
        await emitFriendsUpdated(socket, false, "받은 친구 신청이 없습니다.");
        return;
      }
      saveFriends();
      await emitFriendsUpdated(socket, true, `'${String(data?.nickname).trim()}' 님의 친구 신청을 거절했습니다.`);
      console.log(`[FRIENDS] '${String(data?.nickname).trim()}' → 신청 거절`);
    } catch (err) { console.error("친구 신청 거절 오류:", err); }
  });

  socket.on("friends:remove", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const me = normKey(String(pd.nickname || "").trim());
      const target = normKey(data?.nickname);
      if (!me || !target) { await emitFriendsUpdated(socket, false, "이름을 확인해주세요."); return; }
      if (friendsMap.has(me) && friendsMap.get(me).delete(target)) {
        friendsMap.get(target)?.delete(me);
        saveFriends();
        await emitFriendsUpdated(socket, true, `'${String(data?.nickname).trim()}' 친구를 삭제했습니다.`);
      } else {
        await emitFriendsUpdated(socket, false, "등록된 친구가 아닙니다.");
      }
    } catch (err) { console.error("친구 삭제 오류:", err); }
  });

  socket.on("friends:list", async () => {
    try {
      await emitFriendsUpdated(socket, true);
    } catch (err) { console.error("친구 목록 오류:", err); }
  });

  /* =========================================================
     초대 — 온라인 닉네임으로 초대, 대상에게 초대 알림
  ========================================================= */
  socket.on("room:invite", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const myNick = String(pd.nickname || "").trim();
      const target = String(data?.nickname || "").trim();
      if (!target) { socket.emit("room:inviteSent", { ok: false, reason: "초대할 이름을 입력해주세요." }); return; }
      const tId = onlineNicks.get(normKey(target));
      if (!tId || tId === socket.id || !io.sockets.sockets.has(tId)) {
        socket.emit("room:inviteSent", { ok: false, reason: `'${target}' 님이 현재 온라인이 아닙니다.` });
        return;
      }
      const room = getPlayerRoom(socket);
      if (!room || room.mode === "ai" || room.finished) {
        socket.emit("room:inviteSent", { ok: false, reason: "초대는 온라인 방에서만 보낼 수 있습니다." });
        return;
      }
      io.to(tId).emit("room:inviteReceived", { from: myNick, roomId: room.id });
      socket.emit("room:inviteSent", { ok: true, nickname: target, roomId: room.id });
      console.log(`[INVITE] '${myNick}' → '${target}' (${room.id})`);
    } catch (err) { console.error("초대 오류:", err); }
  });
});

/* =========================================================
   서버 시작
========================================================= */

initDatabase().then(async () => {
  /* 게임 코어 lease — DB가 있으면 게임 코어가 하나만 뜨도록 보호한다.
     web 릴레이는 lease를 잡지 않고 노드 heartbeat만 기록한다. */
  const clusterStart = await cluster.start(dbPool);
  if (cluster.isGameCore && !clusterStart.ok) {
    console.error("게임 코어를 시작할 수 없습니다:", clusterStart.reason || "알 수 없는 이유");
    process.exit(1);
  }
  /* Firebase(로그인 토큰 검증 + Firestore 랭킹 미러링) 초기화 */
  initFirebase();
  /* JSON 모드로 굴리다가 PG로 넘어왔을 때, 살아있는 유저 기록을 DB로 1회만 이관한다.
     마커 보호라서 재배포돼도 두 번 실행되지 않는다. 게임 코어에서만 실행한다. */
  if (cluster.isGameCore) await migrateJsonPlayersToPg();
  /* PG 모드에서는 파일이 남아있지 않아도 DB(kv_store)에서 보조 저장소를 복구한다 */
  await Promise.all([
    loadAdminConfig(),
    loadModeration(),
    loadFriends(),
    loadGuilds(),
    loadBugReports(),
    loadChatHistory(),
    hydrateCustomWordsFromPG()
  ]);
  /* 구 커스텀 사전(customDict) 병합은 hydrate 완료 후 순차 실행 — 병렬 실행하면
     hydrate가 병합 결과를 덮어써 구 데이터가 유실될 수 있다 */
  await loadCustomDict();
  rebuildWordViews();
  if (!seasonStore) await loadSeasonStore();
  if (cluster.isGameCore) {
    await pushManager.init();
    await loadGuildWeekStore();
  }
  /* 시즌 전환은 게임 코어에서만 실행한다. web 인스턴스가 여러 개 떠도
     같은 시즌 마감/보상 지급이 중복 실행되지 않도록 하기 위함이다. */
  if (cluster.isGameCore) {
    ensureSeasonRollover().catch(err => console.error("시작 시 시즌 전환 오류:", err.message));
    setInterval(() => { ensureSeasonRollover().catch(() => {}); }, 60 * 60 * 1000);
    ensureGuildWeekRollover().catch(err => console.error("시작 시 길드 주간 전환 오류:", err.message));
    setInterval(() => { ensureGuildWeekRollover().catch(() => {}); }, 60 * 60 * 1000);
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log("========================================");
    console.log(`끝말잇기 서버 실행 중: http://localhost:${PORT}`);
    console.log(`빌드 커밋: ${BUILD_COMMIT || "로컬"}`);
    console.log(`단어: ${WORD_SET.size.toLocaleString()}개`);
    console.log(`공격 단어: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`);
    console.log(`방어 단어: ${DEFENSE_WORDS.size.toLocaleString()}개`);
    console.log(`데이터베이스: ${dbMode === "pg" ? "PostgreSQL" : "JSON 파일"}`);
    console.log(`Firebase: ${firebaseReady ? "연결됨 (로그인 + 파이어 랭킹)" : "미설정"}`);
    console.log(`클러스터 역할: ${cluster.role} / 인스턴스: ${cluster.instanceId}`);
    if (cluster.role === "web") console.log(`게임 코어로 릴레이: ${cluster.gameUrl}`);
    console.log(`공격 단어 금지 턴: ${ONESHOT_FREE_TURNS}턴`);
    if (dbMode === "json") {
      console.log("⚠ 데이터가 JSON 파일로만 저장됩니다 — 재배포/새 클론 시 유실될 수 있습니다.");
      console.log("  DATABASE_URL(PostgreSQL) 또는 KK_DATA_DIR(영속 디스크) 설정을 권장합니다.");
    }
    console.log("========================================");
    startKeepAlivePing();
  });
}).catch(err => {
  if (err && err.code === "DB_UNAVAILABLE") {
    console.error("서버 시작 실패:", err.message);
    console.error("DATABASE_URL 연결을 확인하세요. JSON 파일 모드로 임시 기동하려면 ALLOW_JSON_FALLBACK=1을 설정하세요.");
    process.exit(1);
  }
  console.error("서버 시작 실패:", err);
  /* 이미 포트를 연 뒤의 초기화 오류라면 다시 listen하지 않는다 — ERR_SERVER_ALREADY_LISTEN이
     원래 오류를 가리므로, 원인을 남기고 종료해 플랫폼이 재시작하게 둔다. */
  if (server.listening) process.exit(1);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`끝말잇기 서버 실행 중 (DB 없음): http://localhost:${PORT}`);
    console.log(`빌드 커밋: ${BUILD_COMMIT || "로컬"}`);
  });
});

/* =========================================================
   무료 플랜 슬립 방지 — PUBLIC_URL(RENDER_EXTERNAL_URL)로 주기적 셀프 핑.
   Render는 라우터를 통해 들어온 요청이 없으면 약 15분 후 인스턴스를 재우고,
   첫 방문자가 콜드워크 대기를 겪는다. 같은 인스턴스라도 PUBLIC 경로로
   되돌아 오는 요청은 외부 트래픽으로 집계되어 슬립을 막아준다.
========================================================= */
const PUBLIC_URL = String(process.env.RENDER_EXTERNAL_URL || process.env.KK_PUBLIC_URL || "").replace(/\/+$/, "");
function startKeepAlivePing() {
  if (!PUBLIC_URL || typeof fetch !== "function") {
    if (!PUBLIC_URL) console.log("스립 방지 핑: 미설정 (RENDER_EXTERNAL_URL 또는 KK_PUBLIC_URL 설정 시 활성화)");
    return;
  }
  setInterval(() => {
    fetch(`${PUBLIC_URL}/`, { signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined })
      .then(r => { if (r.body && typeof r.body.cancel === "function") r.body.cancel(); })
      .catch(() => {});
  }, 10 * 60 * 1000).unref?.();
  console.log(`스립 방지 핑: 10분마다 ${PUBLIC_URL}/`);
}

function shutdown(signal) {
  for (const room of ROOMS.values()) stopTurnTimer(room);
  if (chatSaveTimer) { clearTimeout(chatSaveTimer); chatSaveTimer = null; saveChatHistoryNow(); }
  Promise.resolve(cluster.stop(dbPool)).catch(() => {})
    .then(() => flushFirebaseScores())
    .catch(() => {})
    .finally(() => server.close(() => process.exit(0)));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

/* 놓친 프로미스 하나가 게임 코어 전체를 내리지 않게 남긴다. 원인 추적을 위해 스택을 남기고,
   프로세스 상태를 신뢰할 수 없는 uncaughtException만 종료해 플랫폼이 재시작하게 한다. */
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED] 처리되지 않은 프로미스 거부:", reason && reason.stack ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT] 처리되지 않은 예외 — 종료 후 재시작합니다:", err && err.stack ? err.stack : err);
  process.exit(1);
});
