"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
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
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, "..");
const CLIENT_DIR = path.join(ROOT_DIR, "client");
const DATA_DIR = path.join(ROOT_DIR, "data");
/* 런타임 데이터(유저/시즌/친구/관리자 설정/커스텀 사전/버그 제보) 저장 위치.
   재배포 시 저장소를 새로 클론하면 JSON 파일이 사라지므로, KK_DATA_DIR로
   영속 디스크 경로를 지정할 수 있다. 미지정 시 기존과 동일하게 data/ 를 쓴다. */
const RUNTIME_DATA_DIR = process.env.KK_DATA_DIR ? path.resolve(process.env.KK_DATA_DIR) : DATA_DIR;
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

let adminPassword = null;
let subAdmins = [];
let watchNicks = [];
const ADMIN_NICKNAME = "blossomlng_0";
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
/* 접속 중인 소켓이 관리자 계정(닉네임+비밀번호) 인증을 통과했는지 — 닉네임만으로 관리자가 되지 못하게 함 */
const adminAuthed = new Map();
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
    writeStoreFile(adminConfigPath, { adminPassword, subAdmins, watchlist: watchNicks, config: getConfig() }, "adminConfig");
  } catch (e) { console.warn("관리자 설정 저장 실패:", e.message); }
}

function applyAdminConfig(data) {
  if (!data || typeof data !== "object") return;
  if (typeof data.adminPassword === "string" && data.adminPassword) adminPassword = data.adminPassword;
  if (Array.isArray(data.subAdmins)) {
    /* 관리자는 닉네임 이름으로만 등록 — 계정 비밀번호는 본인이 계정 탭에서 설정/변경한다 */
    subAdmins = data.subAdmins
      .filter(s => s && String(s.nickname || "").trim())
      .map(s => ({ nickname: String(s.nickname).trim(), password: String(s.password || "") }));
  }
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
   데이터 로드
========================================================= */

const baseWordData = loadData(DATA_DIR, ROOT_DIR);
/* 게임 검색 뷰 — 커스텀 사전 승인 단어가 합쳐진다. 관리자 승인 시 rebuildWordViews()로 재구성 */
let WORD_SET = baseWordData.WORD_SET;
let WORD_INDEX = baseWordData.WORD_INDEX;
const BASE_WORD_SET = baseWordData.WORD_SET;
const { ATTACK_DEPTH, ROOT_WORDS, RARE_ROOT_WORDS, DEFENSE_WORDS, DOLRIM_WORDS } = baseWordData;

function rebuildWordViews() {
  const merged = mergeCustomWords(BASE_WORD_SET, baseWordData.WORD_INDEX, customDict.approved);
  WORD_SET = merged.WORD_SET;
  WORD_INDEX = merged.WORD_INDEX;
}

/* =========================================================
   커스텀 사전 — 유저 단어 신청 → 관리자 승인 시 게임 사전에 포함
========================================================= */
const customDictPath = path.join(ROOT_DIR, "custom-words.json");
let customDict = { nextId: 1, pending: [], approved: [], rejected: [] };

function applyCustomDict(data) {
  if (!data || typeof data !== "object") return;
  customDict = {
    nextId: Number(data.nextId) || 1,
    pending: Array.isArray(data.pending) ? data.pending : [],
    approved: Array.isArray(data.approved) ? data.approved : [],
    rejected: Array.isArray(data.rejected) ? data.rejected : []
  };
}

async function loadCustomDict() {
  try {
    const data = await loadStoreJSON("customDict", customDictPath, null);
    if (data) {
      applyCustomDict(data);
      console.log(`커스텀 사전 로드(${dbMode === "pg" ? "DB" : "파일"}): 승인 ${customDict.approved.length}개 / 대기 ${customDict.pending.length}개`);
    }
  } catch (e) { console.warn("커스텀 사전 로드 실패:", e.message); }
}

function saveCustomDict() {
  try {
    writeStoreFile(customDictPath, customDict, "customDict");
  } catch (e) { console.warn("커스텀 사전 저장 실패:", e.message); }
}

/* =========================================================
   커스텀 사전 — 사용자 단어 신청 → 관리자 승인 (JSON 영속)
   - approved: 게임 사전(WORD_SET/WORD_INDEX)에 반영된 단어
   - pending: 승인 대기 신청  / rejected: 거절된 신청
========================================================= */

const customWordsPath = path.join(RUNTIME_DATA_DIR, "custom-words.json");
let customWords = { pending: [], approved: [], rejected: [] };

function applyCustomWordsData(data) {
  if (!data || typeof data !== "object") return;
  customWords.pending = Array.isArray(data.pending) ? data.pending : [];
  customWords.approved = Array.isArray(data.approved) ? data.approved : [];
  customWords.rejected = Array.isArray(data.rejected) ? data.rejected : [];
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


/* 실사용자 이름이 없는 레코드(소켓 ID 키 + '플레이어' 닉네임)는 고스트로 분류 —
   랭킹/리더보드에서 제외하고, 계정을 만들면 사라진다 */
function isGhostRecord(p) {
  const n = String(p?.nickname || "").trim();
  return !(n.length > 0 && normKey(n) !== normKey("플레이어"));
}

/* 같은 닉네임(단일 계정) 레코드 2개를 하나로 병합 — 과거 소켓 ID 기준 저장 데이터 정규화용 */
function mergePlayerRecords(a, b) {
  const sumMode = (x, y) => ({
    rating: Math.max(Number(x?.rating) || 1000, Number(y?.rating) || 1000),
    wins: (Number(x?.wins) || 0) + (Number(y?.wins) || 0),
    losses: (Number(x?.losses) || 0) + (Number(y?.losses) || 0)
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

function nicknameKnown(nickname) {
  const key = normKey(nickname);
  if (!key) return false;
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
  } catch (e) { console.warn("JSON DB 저장 실패:", e.message); }
}

async function initDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const { Pool } = require("pg");
      dbPool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
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
          season TEXT DEFAULT '{}'
        )
      `);
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
          ADD COLUMN IF NOT EXISTS season TEXT DEFAULT '{}'
      `);
      /* 보조 저장소(친구/시즌/관리자 설정/커스텀 사전/버그 제보) — 재배포에도 유지 */
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      dbMode = "pg";
      console.log("데이터베이스: PostgreSQL 연결 완료");
      return;
    } catch (err) {
      console.warn("PostgreSQL 연결 실패:", err.message);
    }
  }
  dbMode = "json";
  loadJsonDb();
  console.log("데이터베이스: JSON 파일 모드");
}

const MODE_DEFAULT = { rating: 1000, wins: 0, losses: 0, streak: 0, bestStreak: 0 };
const SEASON_DEFAULT = { rating: 1000, wins: 0, losses: 0, games: 0, streak: 0, bestStreak: 0 };

function migratePlayerData(p) {
  p.single = Object.assign({ ...MODE_DEFAULT }, p.single || {});
  p.multi = Object.assign({ ...MODE_DEFAULT }, p.multi || {});
  p.ranked = Object.assign({ ...MODE_DEFAULT }, p.ranked || {});
  p.season = Object.assign({ ...SEASON_DEFAULT }, p.season && typeof p.season === "object" ? p.season : {});
  p.ranked.streak = Number.isFinite(p.ranked.streak) ? Math.max(0, Math.floor(p.ranked.streak)) : 0;
  p.ranked.bestStreak = Number.isFinite(p.ranked.bestStreak) ? Math.max(0, Math.floor(p.ranked.bestStreak)) : 0;
  if (typeof p.money !== "number" || !Number.isFinite(p.money)) p.money = typeof p.money === "number" ? Math.max(0, p.money) : 0;
  p.money = Math.max(0, Math.floor(p.money));
  if (!Number.isFinite(p.moneyMultiplier) || p.moneyMultiplier < 1) p.moneyMultiplier = 1;
  p.moneyMultiplier = Math.min(99, Math.floor(p.moneyMultiplier));
  if (!Number.isFinite(p.ratingBoostGames) || p.ratingBoostGames < 0) p.ratingBoostGames = 0;
  p.ratingBoostGames = Math.floor(p.ratingBoostGames);
  if (!Array.isArray(p.titles)) p.titles = [];
  p.currentTitle = typeof p.currentTitle === "string" ? p.currentTitle : "";
  p.lastCheckDate = typeof p.lastCheckDate === "string" ? p.lastCheckDate : "";
  p.attendanceStreak = Number.isFinite(p.attendanceStreak) ? Math.max(0, Math.floor(p.attendanceStreak)) : 0;
  if (!Array.isArray(p.recentGames)) p.recentGames = [];
  else p.recentGames = p.recentGames.slice(-10).filter(g => g && typeof g === "object");
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

async function getPlayerData(playerId) {
  const key = resolvePlayerId(playerId);
  if (playerCache.has(key)) return migratePlayerData({ ...playerCache.get(key) });
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
          season: (() => { try { const v = JSON.parse(row.season || "null"); return v && typeof v === "object" ? v : null; } catch { return null; } })()
        };
        const migrated = migratePlayerData(data);
        playerCache.set(key, migrated);
        return { ...migrated };
      }
    } catch (err) { console.error("DB 읽기 오류:", err.message); }
  }
  /* 이름 없는 소켓 기본값 — 고스트를 캐시에 쌓지 않는다 (랭킹 초기화/중복의 원인이었음) */
  const defaultData = migratePlayerData({ id: key, nickname: "플레이어" });
  return { ...defaultData };
}

async function savePlayerData(playerId, data) {
  const safe = migratePlayerData(data);
  const nk = normKey(String(safe.nickname || "").trim());
  const hasRealNick = nk.length > 0 && nk !== normKey("플레이어");
  /* 저장 키는 닉네임(계정) 키를 우선 — 소켓 ID와 무관하게 한 명당 한 레코드 */
  let key = hasRealNick ? nk : (socketNicks.has(playerId) ? normKey(socketNicks.get(playerId)) : playerId);
  safe.id = key;
  if (key !== playerId && playerCache.has(playerId)) playerCache.delete(playerId);
  if (!hasRealNick) return;   /* 이름 없는 고스트 소켓은 영속하지 않는다 */
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  const rankedStreak = Math.max(0, Math.floor(num(data.ranked && data.ranked.streak, 0)));
  const rankedBestStreak = Math.max(0, Math.floor(num(data.ranked && data.ranked.bestStreak, 0)));
  const modeCore = (m) => ({
    rating: num(m.rating, 1000),
    wins: Math.max(0, num(m.wins, 0)),
    losses: Math.max(0, num(m.losses, 0))
  });
  safe.single = modeCore(safe.single);
  safe.multi = modeCore(safe.multi);
  safe.ranked = modeCore(safe.ranked);
  safe.ranked.streak = rankedStreak;
  safe.ranked.bestStreak = rankedBestStreak;
  safe.money = Math.max(0, Math.floor(num(safe.money, 0)));
  safe.moneyMultiplier = Math.min(99, Math.max(1, Math.floor(num(safe.moneyMultiplier, 1))));
  safe.ratingBoostGames = Math.max(0, Math.floor(num(safe.ratingBoostGames, 0)));
  safe.titles = Array.isArray(safe.titles) ? safe.titles.filter(t => t && typeof t === "object") : [];
  safe.currentTitle = typeof safe.currentTitle === "string" ? safe.currentTitle : "";
  safe.lastCheckDate = typeof safe.lastCheckDate === "string" ? safe.lastCheckDate : "";
  safe.attendanceStreak = Math.max(0, Math.floor(num(safe.attendanceStreak, 0)));
  safe.recentGames = Array.isArray(safe.recentGames) ? safe.recentGames.slice(-10).filter(g => g && typeof g === "object") : [];
  safe.daily = initDailyData(safe.daily, getKstDate());
  safe.weekly = initWeeklyData(safe.weekly, getKstWeek());
  safe.monthly = initMonthlyData(safe.monthly, getKstMonth());
  playerCache.set(key, safe);
  if (dbMode === "pg") {
    try {
      await dbPool.query(`
        INSERT INTO players
          (id, nickname, rating, wins, losses, streak, best_streak,
           single_rating, single_wins, single_losses,
           ranked_rating, ranked_wins, ranked_losses, ranked_streak, ranked_best_streak,
           money, money_multiplier, rating_boost_games,
           titles, current_title, last_check_date, attendance_streak,
           recent_games, daily, weekly, monthly, season, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW())
        ON CONFLICT (id) DO UPDATE SET
          nickname=$2, rating=$3, wins=$4, losses=$5,
          streak=$6, best_streak=$7,
          single_rating=$8, single_wins=$9, single_losses=$10,
          ranked_rating=$11, ranked_wins=$12, ranked_losses=$13,
          ranked_streak=$14, ranked_best_streak=$15,
          money=$16, money_multiplier=$17, rating_boost_games=$18,
          titles=$19, current_title=$20, last_check_date=$21, attendance_streak=$22,
          recent_games=$23, daily=$24, weekly=$25, monthly=$26, season=$27, updated_at=NOW()
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
        JSON.stringify(safe.season || {})
      ]);
    } catch (err) { console.error("DB 쓰기 오류:", err.message); }
  } else {
    saveJsonDb();
  }
}

function updateSingleResult(playerId, won) {
  return (async () => {
    const pd = await getPlayerData(playerId);
    if (won) pd.single.wins = (pd.single.wins || 0) + 1;
    else pd.single.losses = (pd.single.losses || 0) + 1;
    const r = Number(pd.single.rating) || 1000;
    const expected = 1 / (1 + Math.pow(10, (1000 - r) / 400));
    const next = Math.round(r + 32 * ((won ? 1 : 0) - expected));
    pd.single.rating = Number.isFinite(next) ? next : 1000;
    await savePlayerData(playerId, pd);
    const s = io.sockets.sockets.get(playerId);
    if (s) s.emit("player:ranking", {
      ...pd,
      single: { ...pd.single, rank: calculateRank(pd.single.rating) }
    });
    return pd;
  })();
}

async function updateRating(winnerId, loserId, winnerNickname, loserNickname, mode = "multi", opts = {}) {
  const key = mode === "ranked" ? "ranked" : "multi";
  const winner = await getPlayerData(winnerId);
  const loser = await getPlayerData(loserId);
  const { newWinnerRating, newLoserRating } = calculateElo(winner[key].rating, loser[key].rating);
  let wGain = newWinnerRating - winner[key].rating;
  let lChange = newLoserRating - loser[key].rating;
  const wBoost = opts.winnerBoost || 1;
  const lBoost = opts.loserBoost || 1;
  winner[key].rating = Math.round(winner[key].rating + wGain * wBoost);
  loser[key].rating = Math.round(loser[key].rating + lChange * lBoost);
  winner[key].wins += 1; winner.nickname = winnerNickname || winner.nickname;
  loser[key].losses += 1; loser.nickname = loserNickname || loser.nickname;
  if (key === "ranked" || key === "multi") {
    winner[key].streak = Math.max(0, (winner[key].streak || 0)) + 1;
    winner[key].bestStreak = Math.max((winner[key].bestStreak || 0), winner[key].streak);
    loser[key].streak = 0;
  }
  if (!Number.isFinite(winner[key].rating)) winner[key].rating = 1000;
  if (!Number.isFinite(loser[key].rating)) loser[key].rating = 1000;
  if (opts.decBoostWinner) winner.ratingBoostGames = Math.max(0, (winner.ratingBoostGames || 0) - 1);
  if (opts.decBoostLoser) loser.ratingBoostGames = Math.max(0, (loser.ratingBoostGames || 0) - 1);

  await savePlayerData(winnerId, winner);
  await savePlayerData(loserId, loser);
  return {
    winner: { ...winner, rank: calculateRank(winner[key].rating) },
    loser: { ...loser, rank: calculateRank(loser[key].rating) }
  };
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

/* 랭크 대결 초대(2인전) — inviterSocketId -> { targetSocketId, from, fromRating, at }.
   친구에게 지명 랭크 대결을 신청하고 수락하면 그 둘끼리 새 랭크 매치를 시작한다 */
const RANKED_INVITES = new Map();

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
  io.emit("ranked:queueSize", { size: RANKED_QUEUE.length, inQueue: [...RANKED_QUEUE_MAP.keys()] });
}

async function getRankingPayload(socketId) {
  const data = await getPlayerData(socketId);
  return {
    nickname: data.nickname,
    single: { ...data.single, rank: calculateRank(data.single.rating) },
    multi: { ...data.multi, rank: calculateRank(data.multi.rating) },
    ranked: { ...data.ranked, rank: calculateRank(data.ranked.rating) },
    money: data.money,
    moneyMultiplier: data.moneyMultiplier,
    ratingBoostGames: data.ratingBoostGames,
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
    for (const r of rows) {
      const rew = seasonRewardFor(r.rank);
      const pd = await getPlayerData(r.id);
      pd.money += rew.amount;
      if (rew.title && !pd.titles.some(t => t && t.id === rew.title.id)) {
        pd.titles.push({ id: rew.title.id, name: rew.title.name });
        if (!pd.currentTitle) pd.currentTitle = rew.title.name;
      }
      pd.season = null;
      await savePlayerData(r.id, pd);
      awarded++;
    }
    const store = getSeasonStore();
    store.history.push({
      season: key,
      closedAt: new Date().toISOString(),
      champion: rows.length ? rows[0].nickname : null,
      participants: rows.length,
      top: rows.slice(0, 10).map(r => ({ nickname: r.nickname, rank: r.rank, rating: r.rating, wins: r.wins, losses: r.losses }))
    });
    saveSeasonStore();
    console.log(`[시즌 종료] ${key} — 참가 ${rows.length}명, 보상 지급 ${awarded}명`);
  } catch (err) {
    console.error("시즌 종료 처리 오류:", err.message);
  }
}

/* 시즌 전환 감지 → 이전 시즌 종료 처리. 시작 직후/API/소켓/주기 타이머에서 호출 */
async function ensureSeasonRollover() {
  const key = currentSeasonKey();
  const store = getSeasonStore();
  if (!store.lastClosed) {
    store.lastClosed = key;
    saveSeasonStore();
    return key;
  }
  if (store.lastClosed === key) return key;
  const closed = store.lastClosed;
  await closeSeason(closed);
  store.lastClosed = key;
  saveSeasonStore();
  return key;
}

function buildSeasonInfo() {
  const key = currentSeasonKey();
  const store = getSeasonStore();
  const hist = store.history.length ? store.history[store.history.length - 1] : null;
  return {
    ok: true,
    key,
    endsAt: seasonEndMs(key),
    now: nowForSeason(),
    daysLeft: Math.max(0, Math.ceil((seasonEndMs(key) - nowForSeason()) / 86400000)),
    previous: hist ? { season: hist.season, champion: hist.champion, participants: hist.participants } : null,
    rewards: [
      { rank: "1위", value: "500,000원 + 🏆 시즌 챔피언 칭호" },
      { rank: "2~3위", value: "200,000원" },
      { rank: "4~10위", value: "50,000원" },
      { rank: "11~50위", value: "10,000원" },
      { rank: "참가", value: "1,000원" }
    ]
  };
}

/* 최근 10판 전적 기록 — 종료된 방의 각 인간 플레이어에 기록 */
async function recordMatchHistory(room, winnerIndex, loserIndex) {
  if (!room || !room.players) return;
  for (const p of room.players) {
    if (p.isBot) continue;
    try {
      const pd = await getPlayerData(p.id);
      const mine = (room.history || []).filter(h => h.player === p.playerIndex && typeof h.word === "string" && h.word.length > 0);
      const wordCount = mine.length;
      const avgWordLen = wordCount > 0 ? Math.round((mine.reduce((a, w) => a + w.word.length, 0) / wordCount) * 10) / 10 : 0;
      const opp = room.players.find(o => o.playerIndex !== p.playerIndex && !o.isBot && o.id !== p.id);
      const result = winnerIndex === null ? "draw" : (p.playerIndex === winnerIndex ? "win" : "lose");
      const list = Array.isArray(pd.recentGames) ? pd.recentGames : [];
      list.push({
        date: new Date().toISOString(),
        mode: room.mode || "single",
        result,
        vs: opp ? opp.nickname : "AI",
        wordCount,
        avgWordLen
      });
      pd.recentGames = list.slice(-10);
      await savePlayerData(p.id, pd);
    } catch (e) { console.error("전적 기록 오류:", e.message); }
  }
}

function tryMatchRanked() {
  while (RANKED_QUEUE.length >= 2) {
    /* 레이팅이 가까운 상대끼리 매칭되도록 정렬 후 2명 선택 */
    RANKED_QUEUE.sort((a, b) => a.joinedAt - b.joinedAt);
    RANKED_QUEUE.sort((a, b) => Math.abs(a.rating - b.rating) - Math.abs(a.rating - b.rating));
    const a = RANKED_QUEUE.shift();
    const b = RANKED_QUEUE.shift();
    RANKED_QUEUE_MAP.delete(a.socketId);
    RANKED_QUEUE_MAP.delete(b.socketId);

    if (!io.sockets.sockets.has(a.socketId) || !io.sockets.sockets.has(b.socketId)) {
      continue;
    }

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
    rankedRatingB: b.rating
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
   방 관리
========================================================= */

const ROOMS = new Map();

function createRoomId() {
  let id;
  do { id = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (ROOMS.has(id));
  return id;
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
    aiThinkMs: { easy: 1500, normal: 800, hard: 300 }[opts.difficulty || "normal"] || 800
  };
  addPlayer(room, socketId, nickname);
  ROOMS.set(roomId, room);
  return room;
}

function addPlayer(room, socketId, nickname, opts = {}) {
  if (room.players.length >= MAX_PLAYERS) return null;
  if (room.mode === "party") {
    /* 2v2 파티 — 좌석을 A1,B1,A2,B2 순서로 배치(인터리브)해서 기존의 선형
       턴 순회(findNextAlivePlayer)가 자동으로 팀이 번갈아 가며 차례를 갖게 한다.
       즉 '한방'은 항상 상대 팀(다음 살아있는 상대)을 노리게 되므로 턴/한방/종료
       엔진을 전혀 건드리지 않고 2v2가 성립한다. teamOf는 0 또는 1. */
    const teamOf = opts.teamOf == null ? (typeof room.partyTeamCounts === "object" ? (room.players.filter(p => p.teamOf === 1).length < PARTY_TEAM_COUNT ? 1 : 0) : 1) : opts.teamOf;
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

/* 플레이어가 장착 중인 칭호 — 저장된 계정 데이터에서 조회 (소켓 ID → 닉네임 키) */
function playerTitle(player) {
  if (!player || player.isBot) return "";
  return (playerCache.get(resolvePlayerId(player.id))?.currentTitle) || "";
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
function leaveRoomForSocket(socket, reason) {
  const room = getPlayerRoom(socket);
  if (!room) return;
  socket.leave(room.id);
  socket.data.roomId = null;
  socket.data.playerIndex = null;
  removePlayer(room, socket.id, reason || "leave");
  const realConnected = room.players.filter(p => !p.isBot && p.connected);
  if (realConnected.length === 0) { stopTurnTimer(room); ROOMS.delete(room.id); }
}

function getPublicRoomState(room) {
  if (!room) return null;
  return {
    roomId: room.id,
    hostSocketId: room.hostSocketId,
    mode: room.mode,
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
      title: playerTitle(p)
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
    maxPlayers: MAX_PLAYERS,
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

function startTurnTimer(room, gameSessionId) {
  stopTurnTimer(room);
  if (!room || room.finished || !room.started) return;
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
  if (alive.length === 0) { finishGame(room, null, null); return; }
  if (alive.length === 1) {
    finishGame(room, alive[0].playerIndex, player.playerIndex);
    return;
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

async function finishGame(room, winnerIndex, loserIndex) {
  if (!room || room.finished) return;
  room.finished = true;
  room.winner = winnerIndex;
  room.loser = loserIndex;
  stopTurnTimer(room);

  const winnerName = winnerIndex !== null ? room.players[winnerIndex]?.nickname : "무승부";
  console.log(`[GAME END] Room:${room.id} Winner:${winnerName} (${winnerIndex}) Loser:(${loserIndex})`);

  /* 레이팅 반영 — 싱글(AI)은 레이팅 미반영, 온라인=멀티 레이팅, 랭크드=랭크드 레이팅+돈 보상 */
  const w = winnerIndex != null ? room.players[winnerIndex] : null;
  const l = loserIndex != null ? room.players[loserIndex] : null;
  const humanOnly = w && l && !w.isBot && !l.isBot;
  if (w && l && w.id !== l.id && (room.mode === "online" || room.mode === "ranked") && humanOnly) {
    const mode = room.mode === "ranked" ? "ranked" : "multi";
    const updateOpts = {};
    if (room.mode === "ranked") {
      const [wData, lData] = await Promise.all([getPlayerData(w.id), getPlayerData(l.id)]);
      updateOpts.winnerBoost = ((wData.ratingBoostGames || 0) > 0) ? 2 : 1;
      updateOpts.loserBoost = ((lData.ratingBoostGames || 0) > 0) ? 2 : 1;
      updateOpts.decBoostWinner = true;
      updateOpts.decBoostLoser = true;
    }
    updateRating(
      w.id, l.id,
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

        if (room.mode === "ranked") {
          /* 일일 미션 — 랭크 승리 누적, 연승 2회 달성 */
          await bumpDaily(w.id, "rankedWins");
          if ((result.winner.ranked && result.winner.ranked.streak) >= 2) await bumpDaily(w.id, "streakDone");
          const winnerData = await getPlayerData(w.id);
          const base = rollMoney();
          const earned = computeMoneyReward(base, winnerData);
          winnerData.money += earned;
          await savePlayerData(w.id, winnerData);
          const ws = io.sockets.sockets.get(w.socketId);
          if (ws) ws.emit("money:received", { amount: earned, base, multiplier: Math.round(earned / base), roomId: room.id });
        }

        /* 시즌 참가 누적 — 승/패 각각 현재 시즌에 기록 */
        if (room.mode === "ranked") {
          await bumpSeasonFor(w.id, "win");
          await bumpSeasonFor(l.id, "lose");
        }

        /* 전적 기록은 레이팅/미션 저장이 모두 끝난 뒤에 — 동시 기록 시 덮어쓰기 손실 방지 */
        await recordMatchHistory(room, winnerIndex, loserIndex);
      })
      .catch((err) => console.error("레이팅 반영 오류:", err.message));
  } else {
    /* 레이팅 미반영 경기(AI/싱글, 방장 이탈 등)는 즉시 전적 기록 */
    recordMatchHistory(room, winnerIndex, loserIndex).catch(err => console.error("전적 기록 오류:", err.message));
    /* 싱글(AI) — 인간 플레이어의 승/패와 레이팅을 서버에 누적 (계정 통계 3모드 통일) */
    if (room.mode === "ai" && winnerIndex !== null) {
      const human = room.players.find(p => !p.isBot);
      if (human && human.playerIndex !== undefined) {
        updateSingleResult(human.id, human.playerIndex === winnerIndex)
          .catch(err => console.error("싱글 레이팅 반영 오류:", err.message));
      }
    }
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
    ROOMS.delete(room.id);
  }
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

  if (room.players.length === 0) { ROOMS.delete(room.id); return false; }

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

    /* 일일 미션 — '한방 단어' 성공 횟수 누적 */
    if (!player.isBot) bumpDaily(player.id, "oneShots");

    const alive = getAlivePlayers(room);
    if (alive.length === 0) { finishGame(room, null, null); return { ok: true, finished: true }; }
    if (alive.length === 1) {
      finishGame(room, alive[0].playerIndex, loser);
      return { ok: true, finished: true };
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
      /* 보통: 기존 최강 전략. 어려움: 강제 승리 탐색을 더 넓게/깊게 하고 최선의 수에 가깝게 결정 */
      word = chooseAIWord(room.currentWord, room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, room.turnNumber, DEFENSE_WORDS, RARE_ROOT_WORDS, DOLRIM_WORDS, difficulty === "hard" ? { strong: true } : undefined);
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
      const fallbackPool = getCandidates(room.currentWord || "", room.usedWords, WORD_INDEX)
        .filter(w => canConnect(room.currentWord || "", w));
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
    if (alive.length <= 1) {
      finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, player.playerIndex);
      return;
    }
    if (room.turnPlayerIndex === player.playerIndex) {
      const next = findNextAlivePlayer(room, player.playerIndex);
      if (next !== null) { room.turnPlayerIndex = next; room.turnNumber++; startTurnTimer(room, room.gameSessionId); }
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true, words: WORD_SET.size, attackWords: Object.keys(ATTACK_DEPTH).length,
    rooms: ROOMS.size, customApproved: customDict.approved.length,
    customPending: customDict.pending.length, seasonId: currentSeasonKey(),
    db: dbMode === "pg" ? "postgres" : "json",
    dataDir: RUNTIME_DATA_DIR || null,
    uptime: process.uptime()
  });
});

/* 시즌 정보 — 아래의 단일 /api/season 핸들러(월 단위 buildSeasonInfo)가 응답한다 */

app.get("/api/leaderboard", async (req, res) => {
  try {
    const rawMode = String(req.query.mode || "multi");
    const mode = ["multi", "single", "ranked", "money", "streak", "tier"].includes(rawMode)
      ? rawMode : (rawMode === "ai" ? "single" : "multi");
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "10"), 10) || 10));

    /* 시즌 모드 — 현재 시즌(season) 또는 지난 시즌 아카이브(?seasonId 지정).
       시즌은 매월 1일로 전환되는 월 단위. 현재 시즌은 해당 시즌에 1판 이상
       랭크 게임을 한 플레이어를 현재 랭크 레이팅 순으로, 지난 시즌은
       종료 시 집계 기록(seasonStore.history)에서 조회한다. */
    if (rawMode === "season" || rawMode === "seasonHistory") {
      const seasonKey = String(req.query.seasonId || "");
      let entries;
      if (seasonKey) {
        const hist = getSeasonStore().history.find(h => h.season === seasonKey);
        entries = hist ? (hist.top || []).map(t => ({
          id: t.nickname, nickname: t.nickname,
          rating: Number(t.rating) || 0, wins: Number(t.wins) || 0,
          losses: Number(t.losses) || 0, games: 0, streak: 0
        })) : [];
      } else {
        const key = currentSeasonKey();
        entries = (await listAllPlayers())
          .filter(p => p.season && p.season.season === key && (p.season.games || 0) > 0)
          .map(p => ({
            id: p.id, nickname: p.nickname || "플레이어",
            rating: Number(p.season.rating) || 1000,
            wins: p.season.wins || 0, losses: p.season.losses || 0,
            games: p.season.games || 0, streak: p.season.bestStreak || 0
          }));
      }
      const seenNicks = new Set();
      const rows = entries
        .filter(r => {
          const k = String(r.nickname || "").trim();
          if (!k) return true;
          if (seenNicks.has(k)) return false;
          seenNicks.add(k);
          return true;
        })
        .sort((a, b) => ((Number(b.rating) || 0) - (Number(a.rating) || 0)) || ((Number(b.games) || 0) - (Number(a.games) || 0)))
        .slice(0, limit)
        .map((r, i) => ({
          id: r.id, nickname: r.nickname,
          mode: seasonKey ? "seasonHistory" : "season",
          ranking: Number(r.rating) || 0, wins: Number(r.wins) || 0, losses: Number(r.losses) || 0,
          money: 0, streak: Number(r.streak) || 0, bestStreak: Number(r.streak) || 0,
          games: Number(r.games) || 0, rank: i + 1,
          tier: calculateRank(Number(r.rating) || 0)
        }));
      return res.json(rows);
    }

    let rows = [];
    if (dbMode === "pg") {
      let sql;
      let params = [AI_PLAYER_ID, limit];
      if (mode === "money") {
        sql = `SELECT id, nickname, money AS stat_rating, 0 AS stat_wins, 0 AS stat_losses,
                      money AS stat_money, 0 AS stat_streak, 0 AS stat_best_streak
               FROM players WHERE id <> $1 ORDER BY money DESC LIMIT $2`;
      } else if (mode === "streak") {
        sql = `SELECT id, nickname, ranked_rating AS stat_rating, ranked_wins AS stat_wins,
                      ranked_losses AS stat_losses, 0 AS stat_money,
                      ranked_streak AS stat_streak, ranked_best_streak AS stat_best_streak
               FROM players WHERE id <> $1
               ORDER BY ranked_best_streak DESC, ranked_rating DESC LIMIT $2`;
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
                      ${bstCol} AS stat_best_streak
               FROM players WHERE id <> $1 ORDER BY ${col} DESC LIMIT $2`;
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
          return { id: p.id, nickname: p.nickname, ...s };
        })
        .sort((a, b) => {
          if (mode === "streak") return (b.bestStreak - a.bestStreak) || ((b.rating || 1000) - (a.rating || 1000));
          const da = (mode === "money" ? a.money : a.rating) || 0;
          const db = (mode === "money" ? b.money : b.rating) || 0;
          return db - da;
        })
        .slice(0, limit)
        .map(r => ({
          id: r.id, nickname: r.nickname, stat_rating: r.rating, stat_wins: r.wins, stat_losses: r.losses,
          stat_money: r.money, stat_streak: r.streak, stat_best_streak: r.bestStreak
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
    rows = rows.filter(r => {
      const k = String(r.nickname || "").trim();
      if (!k || !normKey(k) || normKey(k) === normKey("플레이어")) return false;
      if (seenNicks.has(k)) return false;
      seenNicks.add(k);
      return true;
    });
    res.json(rows.map((r, i) => ({
      id: r.id, nickname: r.nickname, mode,
      ranking: r.stat_rating, wins: r.stat_wins, losses: r.stat_losses,
      money: r.stat_money || 0,
      streak: r.stat_streak || 0, bestStreak: r.stat_best_streak || 0,
      rank: i + 1,
      tier: (mode === "money" || mode === "streak") ? null : calculateRank(r.stat_rating)
    })));
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

/* =========================================================
   Socket.IO 이벤트
========================================================= */

io.on("connection", (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.emit("server:ready", {
    ok: true, words: WORD_SET.size, attackWords: Object.keys(ATTACK_DEPTH).length,
    maxPlayers: MAX_PLAYERS, turnTime: TURN_TIME, maxHearts: MAX_HEARTS,
    customApproved: customDict.approved.length, customPending: customDict.pending.length
  });

  socket.on("room:create", async (data) => {
    try {
      const nickname = normalizeWord(data?.nickname) || "플레이어";
      const mode = data?.mode === "ai" ? "ai" : "online";
      /* 싱글 난이도 — 잘못된 값이면 보통으로 폴백 */
      const difficulty = ["easy", "normal", "hard"].includes(data?.difficulty) ? data.difficulty : "normal";
      leaveRoomForSocket(socket, "recreate");

      const room = createRoom(socket.id, nickname, mode, { difficulty });
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

      const room = ROOMS.get(roomId);
      if (!room) { socket.emit("room:error", { ok: false, reason: "방을 찾을 수 없습니다." }); return; }
      if (room.players.filter(p => !p.isBot).length >= MAX_PLAYERS) {
        socket.emit("room:error", { ok: false, reason: "방이 가득 찼습니다." }); return;
      }

      const existing = room.players.find(p => p.socketId === socket.id);
      if (existing) {
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

  /* -- 방 목록 브라우저 ---------------------------------- */
  socket.on("room:list", () => {
    try {
      const rooms = [];
      for (const room of ROOMS.values()) {
        if (room.mode !== "online") continue;
        if (room.started || room.finished) continue;
        const humans = room.players.filter(p => !p.isBot);
        if (humans.length >= MAX_PLAYERS) continue;
        if (humans.some(p => p.socketId === socket.id)) continue;
        rooms.push({
          roomId: room.id,
          host: room.players[0] ? room.players[0].nickname : "",
          playerCount: humans.length,
          max: MAX_PLAYERS,
          createdAt: room.createdAt || 0
        });
      }
      rooms.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      socket.emit("room:list", { ok: true, rooms });
    } catch (error) {
      console.error("room:list 오류:", error);
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
          if (alive.length === 0) { finishGame(room, null, null); return; }
          if (alive.length === 1) {
            finishGame(room, alive[0].playerIndex, player.playerIndex);
            return;
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
      if (room.mode !== "online") {
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
      startNewGame(room);
      console.log(`[GAME START] ${room.id} by ${socket.id}`);
    } catch (error) { console.error("game:start 오류:", error); }
  });

  socket.on("game:restart", () => {
    try {
      const room = getPlayerRoom(socket);
      if (!room) return;
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
      if (!room) return;
      socket.leave(roomId);
      removePlayer(room, socket.id, "leave");
      /* 연결된 실제 플레이어가 아무도 없으면 방 즉시 정리 —
         싱글(AI) 방은 인간이 나가도 좀비로 남아 이벤트를 뿜는 문제 방지 */
      const realConnected = room.players.filter(p => !p.isBot && p.connected);
      if (realConnected.length === 0) { stopTurnTimer(room); ROOMS.delete(room.id); }
      socket.data.roomId = null;
      socket.data.playerIndex = null;
      socket.emit("room:left", { ok: true });
    } catch (error) { console.error("room:leave 오류:", error); }
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
        .filter(r => r && r.mode === "online" && !r.finished)
        .map(r => {
          const humans = r.players.filter(p => !p.isBot);
          const host = humans.find(p => p.socketId === r.hostSocketId) || humans[0] || null;
          return {
            roomId: r.id,
            host: host ? host.nickname : "플레이어",
            playerCount: r.players.filter(p => !p.isBot && !p.waiting).length,
            maxPlayers: MAX_PLAYERS,
            started: !!r.started
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
    REMATCHES.delete(socket.id);
    cancelRankedInvitesFor(socket.id);
    removeFromRankedQueue(socket.id);
    broadcastRankedQueue();
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
            if (realConnected.length === 0) { stopTurnTimer(r2); ROOMS.delete(r2.id); }
            broadcastRoomState(r2);
          }, RECONNECT_GRACE_MS);
          disconnectedPlayers.set(socket.id, { roomId: room.id, nickname: player.nickname || "", timer });
        }
      } else {
        removePlayer(room, socket.id, "disconnect");
        const realPlayers = room.players.filter(p => !p.isBot);
        if (realPlayers.length === 0) { stopTurnTimer(room); ROOMS.delete(room.id); }
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
      REMATCHES.delete(socket.id);
      cancelRankedInvitesFor(socket.id);
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "플레이어").trim();
      if (!nickname) { socket.emit("ranked:queueStatus", { ok: false, reason: "닉네임을 먼저 설정해주세요." }); return; }
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

  /* -- 랭크 복수전 (다시 대결) --------------------------- */
  socket.on("ranked:rematch", async () => {
    try {
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
      pd.lastCheckDate = today;
      pd.attendanceStreak = streak;
      pd.money += reward;
      await savePlayerData(socket.id, pd);
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
        multiplierPrices: SHOP_MULTIPLIER_PRICES
      });
    } catch (err) { console.error("상점 조회 오류:", err); }
  });

  socket.on("shop:buyTitle", async (data) => {
    try {
      const titleId = String(data?.titleId || "");
      const title = SHOP_TITLES.find(t => t.id === titleId);
      if (!title) { socket.emit("shop:result", { ok: false, reason: "존재하지 않는 칭호입니다." }); return; }
      const pd = await getPlayerData(socket.id);
      if (pd.titles.some(t => t.id === titleId)) { socket.emit("shop:result", { ok: false, reason: "이미 보유한 칭호입니다." }); return; }
      if (pd.money < title.price) { socket.emit("shop:result", { ok: false, reason: "돈이 부족합니다." }); return; }
      pd.money -= title.price;
      pd.titles.push({ id: title.id, name: title.name });
      pd.currentTitle = title.name;
      await savePlayerData(socket.id, pd);
      socket.emit("shop:result", { ok: true, message: `칭호 '${title.name}'을 구매했습니다.`, money: pd.money, titles: pd.titles, currentTitle: pd.currentTitle });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
    } catch (err) { console.error("칭호 구매 오류:", err); }
  });

  socket.on("shop:setTitle", async (data) => {
    try {
      const titleId = String(data?.titleId || "");
      const pd = await getPlayerData(socket.id);
      const title = pd.titles.find(t => t.id === titleId);
      if (!title) { socket.emit("shop:result", { ok: false, reason: "보유하지 않은 칭호입니다." }); return; }
      pd.currentTitle = title.name;
      await savePlayerData(socket.id, pd);
      socket.emit("shop:result", { ok: true, message: `칭호 '${title.name}'(으)로 변경했습니다.`, currentTitle: pd.currentTitle });
      socket.emit("player:ranking", await getRankingPayload(socket.id));
      broadcastRoomState(getPlayerRoom(socket));
    } catch (err) { console.error("칭호 변경 오류:", err); }
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
      await savePlayerData(socket.id, pd);
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
        potionPrice: SHOP_POTION_PRICE, multiplierPrices: SHOP_MULTIPLIER_PRICES
      });
    } catch (err) { console.error("미션 보상 수령 오류:", err); }
  });

  socket.on("shop:buyPotion", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      if (pd.money < SHOP_POTION_PRICE) { socket.emit("shop:result", { ok: false, reason: "돈이 부족합니다." }); return; }
      pd.money -= SHOP_POTION_PRICE;
      pd.ratingBoostGames += 10;
      await savePlayerData(socket.id, pd);
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
      pd.money -= row.price;
      pd.moneyMultiplier = target;
      await savePlayerData(socket.id, pd);
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
      if (!checkAdminPw(reg, data?.password)) { socket.emit("admin:moneyResult", { ok: false, reason: "관리자 비밀번호가 올바르지 않습니다." }); return; }
      const nickname = String(data?.nickname ?? "").trim();
      const amount = clampNum(data?.amount, -999999999, 999999999, 0);
      if (!nickname) { socket.emit("admin:moneyResult", { ok: false, reason: "닉네임을 입력해주세요." }); return; }
      const id = await findPlayerIdByNickname(nickname);
      if (!id) { socket.emit("admin:moneyResult", { ok: false, reason: `'${nickname}' 닉네임을 찾을 수 없습니다.` }); return; }
      const pd = await getPlayerData(id);
      pd.money += amount;
      if (pd.money < 0) pd.money = 0;
      await savePlayerData(id, pd);
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
  const emitCustomWords = (socket) => socket.emit("admin:words", {
    ok: true,
    pending: customWords.pending.map(p => ({ word: p.word, by: p.by, at: p.at })),
    approved: customWords.approved,
    rejected: customWords.rejected.map(r => ({ word: r.word, by: r.by, at: r.at, reason: r.reason }))
  });

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
      if (realPlayers.length === 0) { stopTurnTimer(room); ROOMS.delete(room.id); }
    } catch (err) { console.error("추방 오류:", err); }
  });

  socket.on("player:getRanking", async () => {
    try {
      /* setName 등록이 아직 안 끝난 새 소켓에서 오면 초기(0) 화면이 잠깐 보일 수 있다.
         닉네임이 등록될 때까지 잠깐 기다렸다가 진짜 계정 데이터를 보낸다 */
      if (!socketNicks.has(socket.id)) await new Promise(r => setTimeout(r, 500));
      socket.emit("player:ranking", await getRankingPayload(socket.id));
    } catch (err) { console.error("랭킹 조회 오류:", err); }
  });

  /* -- 관리자 패널 ------------------------------------- */
  /* name 정규화(공백 제거) 후 대소문자 무시 비교 */
  const isAdminNick = (nick) => String(nick || "").replace(/\s+/g, "").toLowerCase() === ADMIN_NICKNAME.replace(/\s+/g, "").toLowerCase();
  const normNick = (nick) => String(nick || "").replace(/\s+/g, "").toLowerCase();
  const findSubAdmin = (nick) => subAdmins.find(s => normNick(s.nickname) === normNick(nick)) || null;

  const requireNickname = async (socket) => {
    const pd = await getPlayerData(socket.id);
    const nickname = String(pd.nickname || "").trim();
    let role = null;
    let subAdmin = null;
    if (isAdminNick(nickname)) {
      role = "super";
    } else {
      const sub = findSubAdmin(nickname);
      if (sub) { role = "sub"; subAdmin = sub; }
    }
    if (!role) {
      return { ok: false, reason: "관리자 권한이 없습니다." };
    }
    const authed = adminAuthed.get(socket.id);
    if (!authed || authed.role !== role) {
      return { ok: false, reason: "관리자 계정 비밀번호로 인증되지 않았습니다. 닉네임과 계정 비밀번호를 다시 입력해주세요." };
    }
    return { ok: true, nickname, role, subAdmin };
  };

  /* 역할별 비밀번호 검증 — 최고관리자는 관리자 비밀번호, 서브관리자는 본인 비밀번호 */
  const checkAdminPw = (reg, pw) => {
    if (!pw || typeof pw !== "string") return false;
    if (reg.role === "super") return !!adminPassword && pw === adminPassword;
    if (reg.role === "sub" && reg.subAdmin) return pw === reg.subAdmin.password;
    return false;
  };

  /* 닉네임으로 플레이어 조회 (JSON DB / PostgreSQL 공통) */
  const findPlayerIdByNickname = async (nickname) => {
    if (dbMode === "pg") {
      const result = await dbPool.query("SELECT id FROM players WHERE nickname = $1 LIMIT 1", [nickname]);
      return result.rows.length ? result.rows[0].id : null;
    }
    for (const [id, p] of playerCache) {
      if (String(p?.nickname || "").trim() === nickname) return id;
    }
    return null;
  };

  /* 같은 닉네임의 모든 레코드 조회 — 소켓 ID는 재접속마다 바뀌므로 좀비 레코드가 여러 개
     남아 랭킹에 같은 유저가 중복 표시되는 것을 막기 위해 전부 찾는다 */
  const findAllPlayerIdsByNickname = async (nickname) => {
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
  };

  socket.on("admin:getPanel", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      socket.emit("admin:panel", {
        ok: true,
        role: reg.role,
        isSuper: reg.role === "super",
        hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname),
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
      if (!checkAdminPw(reg, data?.password)) {
        socket.emit("admin:findResult", { ok: false, reason: "관리자 비밀번호가 올바르지 않습니다." });
        return;
      }
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
      if (!checkAdminPw(reg, data?.password)) {
        socket.emit("admin:statsUpdated", { ok: false, reason: "관리자 비밀번호가 올바르지 않습니다." });
        return;
      }
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

  socket.on("admin:setPassword", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:panel", { ok: false, reason: "전체 설정은 최고 관리자만 변경할 수 있습니다." });
        return;
      }
      const current = String(data?.current ?? "");
      const next = String(data?.next ?? "");
      if (next.length < 4) {
        socket.emit("admin:panel", { ok: false, reason: "비밀번호는 4자 이상이어야 합니다." });
        return;
      }
      if (adminPassword && current !== adminPassword) {
        socket.emit("admin:panel", { ok: false, reason: "현재 비밀번호가 올바르지 않습니다." });
        return;
      }
      adminPassword = next;
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: reg.role, isSuper: true, hasPassword: true,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, watchlist: watchNicks,
        message: adminPassword ? "비밀번호가 변경되었습니다." : "비밀번호가 설정되었습니다."
      });
    } catch (err) { console.error("관리자 비밀번호 오류:", err); }
  });

  socket.on("admin:updateConfig", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:panel", { ok: false, reason: "수치 조정은 최고 관리자만 할 수 있습니다." });
        return;
      }
      if (!checkAdminPw(reg, data?.password)) {
        socket.emit("admin:panel", { ok: false, reason: "관리자 비밀번호가 올바르지 않습니다." });
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

  socket.on("admin:addSubAdmin", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:panel", { ok: false, reason: "최고 관리자만 관리자를 추가할 수 있습니다." });
        return;
      }
      const nickname = String(data?.nickname ?? "").trim();
      let password = String(data?.adminPassword ?? "").trim();
      if (!nickname || nickname.length < 2 || nickname.length > 20) {
        socket.emit("admin:panel", { ok: false, reason: "관리자 닉네임은 2~20자여야 합니다." });
        return;
      }
      if (password && password.length < 4) {
        socket.emit("admin:panel", { ok: false, reason: "관리자 비밀번호는 4자 이상이어야 합니다." });
        return;
      }
      if (isAdminNick(nickname)) {
        socket.emit("admin:panel", { ok: false, reason: "최고 관리자 닉네임은 추가할 수 없습니다." });
        return;
      }
      if (findSubAdmin(nickname)) {
        socket.emit("admin:panel", { ok: false, reason: "이미 등록된 서브 관리자입니다." });
        return;
      }
      /* 닉네임으로만 등록 — 비밀번호는 해당 관리자가 계정 탭에서 직접 설정/변경 */
      subAdmins.push({ nickname, password });
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: reg.role, isSuper: true, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, watchlist: watchNicks,
        message: `'${nickname}' 님을 관리자로 추가했습니다. 계정 비밀번호는 '${nickname}'님이 계정 탭에서 직접 설정/변경할 수 있습니다.`
      });
      console.log(`[ADMIN] ${reg.nickname}님이 서브 관리자 '${nickname}' 추가`);
    } catch (err) { console.error("관리자 추가 오류:", err); }
  });

  socket.on("admin:removeSubAdmin", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:panel", { ok: false, reason: "최고 관리자만 관리자를 제거할 수 있습니다." });
        return;
      }
      if (!checkAdminPw(reg, data?.password)) {
        socket.emit("admin:panel", { ok: false, reason: "관리자 비밀번호가 올바르지 않습니다." });
        return;
      }
      const nickname = String(data?.nickname ?? "").trim();
      const idx = subAdmins.findIndex(s => normNick(s.nickname) === normNick(nickname));
      if (idx === -1) {
        socket.emit("admin:panel", { ok: false, reason: "등록된 서브 관리자를 찾을 수 없습니다." });
        return;
      }
      subAdmins.splice(idx, 1);
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: reg.role, isSuper: true, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, watchlist: watchNicks,
        message: `'${nickname}' 관리자가 제거되었습니다.`
      });
      console.log(`[ADMIN] ${reg.nickname}님이 서브 관리자 '${nickname}' 제거`);
    } catch (err) { console.error("관리자 제거 오류:", err); }
  });

  socket.on("admin:setSubPassword", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "sub" || !reg.subAdmin) {
        socket.emit("admin:panel", { ok: false, reason: "서브 관리자만 자신의 비밀번호를 바꿀 수 있습니다." });
        return;
      }
      const current = String(data?.current ?? "");
      const next = String(data?.next ?? "");
      if (next.length < 4) {
        socket.emit("admin:panel", { ok: false, reason: "비밀번호는 4자 이상이어야 합니다." });
        return;
      }
      if (current !== (reg.subAdmin.password || "")) {
        socket.emit("admin:panel", { ok: false, reason: "현재 비밀번호가 올바르지 않습니다." });
        return;
      }
      reg.subAdmin.password = next;
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: "sub", isSuper: false, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, watchlist: watchNicks,
        message: "서브 관리자 비밀번호가 변경되었습니다."
      });
      console.log(`[ADMIN] 서브 관리자 '${reg.nickname}' 비밀번호 변경`);
    } catch (err) { console.error("서브 관리자 비밀번호 오류:", err); }
  });

  /* -- 커스텀 사전 — 유저 단어 신청 → 관리자 승인 시 게임 반영 -- */
  socket.on("dictionary:status", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "").trim();
      const mine = customDict.pending
        .filter(p => String(p.requester || "") === nickname)
        .map(p => ({ id: p.id, word: p.word, at: p.at }));
      socket.emit("dictionary:status", {
        ok: true, mine, nickname,
        approvedTotal: customDict.approved.length,
        pendingTotal: customDict.pending.length,
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
      if (WORD_SET.has(word) || customDict.approved.includes(word)) {
        socket.emit("dictionary:status", { ok: false, reason: `'${word}'는 이미 등록된 단어입니다.` }); return;
      }
      const mineCount = customDict.pending.filter(p => String(p.requester || "") === nickname).length;
      if (mineCount >= 3) {
        socket.emit("dictionary:status", { ok: false, reason: "진행 중인 신청이 3개 이상입니다. 처리 후 다시 시도해주세요." }); return;
      }
      if (customDict.pending.some(p => p.word === word)) {
        socket.emit("dictionary:status", { ok: false, reason: `'${word}'는 이미 신청 대기 중인 단어입니다.` }); return;
      }
      if (customDict.pending.length >= 200) {
        socket.emit("dictionary:status", { ok: false, reason: "승인 대기 목록이 꽉 찼습니다. 잠시 후 다시 시도해주세요." }); return;
      }
      customDict.pending.push({ id: String(customDict.nextId++), word, requester: nickname, at: Date.now() });
      saveCustomDict();
      socket.emit("dictionary:status", { ok: true, message: `'${word}' 등록을 신청했습니다. 관리자 승인 후 게임에 반영됩니다.` });
      console.log(`[DICT] ${nickname} 단어 신청: ${word}`);
    } catch (err) { console.error("사전 신청 오류:", err); }
  });

  socket.on("dictionary:cancel", async (data) => {
    try {
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "").trim();
      const id = String(data?.id || "");
      const idx = customDict.pending.findIndex(p => String(p.id) === id && String(p.requester || "") === nickname);
      if (idx === -1) { socket.emit("dictionary:status", { ok: false, reason: "본인의 신청만 취소할 수 있습니다." }); return; }
      customDict.pending.splice(idx, 1);
      saveCustomDict();
      socket.emit("dictionary:status", { ok: true, message: "단어 신청을 취소했습니다." });
    } catch (err) { console.error("사전 신청 취소 오류:", err); }
  });

  const notifyRequester = (requester, msg) => {
    const targetSocketId = onlineNicks.get(normKey(requester));
    if (!targetSocketId) return;
    const ts = io.sockets.sockets.get(targetSocketId);
    if (ts) ts.emit("dictionary:status", { ok: true, message: msg, refreshed: true });
  };

  socket.on("admin:dictionaryList", async () => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:dictionary", { ok: false, reason: reg.reason }); return; }
      socket.emit("admin:dictionary", { ok: true, pending: customDict.pending, approved: customDict.approved });
    } catch (err) { console.error("관리자 사전 목록 오류:", err); }
  });

  socket.on("admin:dictionaryApprove", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:dictionary", { ok: false, reason: reg.reason }); return; }
      const id = String(data?.id || "");
      const idx = customDict.pending.findIndex(p => String(p.id) === id);
      if (idx === -1) { socket.emit("admin:dictionary", { ok: false, reason: "승인 대기 신청을 찾을 수 없습니다." }); return; }
      const [item] = customDict.pending.splice(idx, 1);
      customDict.approved.push(item.word);
      customDict.rejected = customDict.rejected.filter(r => r.word !== item.word);
      saveCustomDict();
      rebuildWordViews();
      notifyRequester(item.requester, `'${item.word}' 단어가 승인되어 게임에 반영되었습니다!`);
      socket.emit("admin:dictionary", { ok: true, pending: customDict.pending, approved: customDict.approved, message: `'${item.word}' 승인 완료` });
      console.log(`[DICT] ${reg.nickname} 승인: ${item.word} (by ${item.requester})`);
    } catch (err) { console.error("사전 승인 오류:", err); }
  });

  socket.on("admin:dictionaryReject", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:dictionary", { ok: false, reason: reg.reason }); return; }
      const id = String(data?.id || "");
      const idx = customDict.pending.findIndex(p => String(p.id) === id);
      if (idx === -1) { socket.emit("admin:dictionary", { ok: false, reason: "승인 대기 신청을 찾을 수 없습니다." }); return; }
      const [item] = customDict.pending.splice(idx, 1);
      customDict.rejected.push({ word: item.word, by: item.requester, at: Date.now() });
      if (customDict.rejected.length > 200) customDict.rejected.splice(0, customDict.rejected.length - 200);
      saveCustomDict();
      notifyRequester(item.requester, `'${item.word}' 단어 신청이 반려되었습니다.`);
      socket.emit("admin:dictionary", { ok: true, pending: customDict.pending, approved: customDict.approved, message: `'${item.word}' 반려 완료` });
      console.log(`[DICT] ${reg.nickname} 반려: ${item.word} (by ${item.requester})`);
    } catch (err) { console.error("사전 반려 오류:", err); }
  });

  /* 최고 관리자가 서브 관리자 계정의 비밀번호를 재설정 — 계정별 비밀번호를 직접 관리 */
  socket.on("admin:resetSubPassword", async (data) => {
    try {
      const reg = await requireNickname(socket);
      if (!reg.ok) { socket.emit("admin:panel", { ok: false, reason: reg.reason }); return; }
      if (reg.role !== "super") {
        socket.emit("admin:panel", { ok: false, reason: "최고 관리자만 계정 비밀번호를 재설정할 수 있습니다." });
        return;
      }
      if (!checkAdminPw(reg, data?.password)) {
        socket.emit("admin:panel", { ok: false, reason: "관리자 비밀번호가 올바르지 않습니다." });
        return;
      }
      const nickname = String(data?.nickname ?? "").trim();
      const newPassword = String(data?.newPassword ?? "");
      const sub = findSubAdmin(nickname);
      if (!sub) {
        socket.emit("admin:panel", { ok: false, reason: "등록된 서브 관리자를 찾을 수 없습니다." });
        return;
      }
      if (newPassword.length < 4) {
        socket.emit("admin:panel", { ok: false, reason: "비밀번호는 4자 이상이어야 합니다." });
        return;
      }
      sub.password = newPassword;
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: reg.role, isSuper: true, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, watchlist: watchNicks,
        message: `'${nickname}' 관리자 계정 비밀번호가 재설정되었습니다.`
      });
      console.log(`[ADMIN] ${reg.nickname}님이 서브 관리자 '${nickname}' 비밀번호 재설정`);
    } catch (err) { console.error("관리자 계정 비밀번호 재설정 오류:", err); }
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
        ok: true, role: reg.role, isSuper: true, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, watchlist: watchNicks,
        message: "감시 목록이 저장되었습니다."
      });
      console.log(`[ADMIN] 감시 목록 저장: ${watchNicks.join(", ") || "(없음)"}`);
    } catch (err) { console.error("감시 목록 오류:", err); }
  });

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

      /* 관리자 계정(최고/서브)은 닉네임만으로 등록되지 않고, 계정 비밀번호 인증이 필요하다 —
         그래야 닉네임 도용으로 관리자 권한을 뺏기지 않는다 */
      const asSuper = isAdminNick(nickname);
      const asSub = asSuper ? null : findSubAdmin(nickname);
      if (asSuper || asSub) {
        const pw = String(data?.password ?? "");
        if (asSuper) {
          if (!adminPassword) {
            /* 최초 로그인 = 관리자 계정(비밀번호) 생성 */
            if (pw.length < 4) {
              socket.emit("player:nameUpdated", {
                ok: false, adminRequired: true,
                reason: "최초 관리자 계정입니다. 계정 비밀번호(4자 이상)를 설정해주세요."
              });
              return;
            }
            adminPassword = pw;
            saveAdminConfig();
          } else if (pw !== adminPassword) {
            socket.emit("player:nameUpdated", {
              ok: false, adminRequired: true,
              reason: "관리자 계정 비밀번호가 올바르지 않습니다."
            });
            return;
          }
          adminAuthed.set(socket.id, { role: "super", nickname });
        } else {
          /* 서브 관리자 — 비밀번호가 없으면 최초 로그인 시 본인이 직접 설정한다 */
          if (!asSub.password) {
            if (pw.length < 4) {
              socket.emit("player:nameUpdated", {
                ok: false, adminRequired: true,
                reason: "관리자 계정입니다. 계정 탭에서 계정 비밀번호(4자 이상)를 먼저 설정해주세요."
              });
              return;
            }
            asSub.password = pw;
            saveAdminConfig();
          } else if (pw !== asSub.password) {
            socket.emit("player:nameUpdated", {
              ok: false, adminRequired: true,
              reason: "관리자 계정 비밀번호가 올바르지 않습니다."
            });
            return;
          }
          adminAuthed.set(socket.id, { role: "sub", nickname });
        }
      } else {
        adminAuthed.delete(socket.id);
      }

      const room = getPlayerRoom(socket);
      if (room) {
        const dup = room.players.find(p => !p.isBot && p.socketId !== socket.id && p.nickname === nickname);
        if (dup) {
          socket.emit("player:nameUpdated", { ok: false, reason: "이미 사용 중인 닉네임입니다." });
          return;
        }
        const me = room.players.find(p => p.socketId === socket.id);
        if (me) me.nickname = nickname;
      }
      /* 닉네임(정규화 키)이 곧 계정 저장 키 — 소켓 ID에 얽매이지 않아 재접속시에도
         돈/랭킹/연승이 초기화되는 문제가 없다 */
      const playerData = await getPlayerData(socket.id);
      playerData.nickname = nickname;
      await savePlayerData(socket.id, playerData);
      registerOnline(socket.id, nickname);
      socket.emit("player:nameUpdated", { ok: true, nickname });
      if (room) broadcastRoomState(room);

      /* 감시 목록(로그인 알림) — 최고 관리자에게 접속 알림 */
      if (watchNicks.some(w => normKey(w) === normKey(nickname))) {
        notifySuperAdmins({ nickname, at: new Date().toISOString(), reason: "login" });
      }
    } catch (err) { console.error("닉네임 설정 오류:", err); }
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
      if (!nicknameKnown(target)) { await emitFriendsUpdated(socket, false, `'${String(data?.nickname).trim()}' 닉네임을 찾을 수 없습니다.`); return; }
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
  /* PG 모드에서는 파일이 남아있지 않아도 DB(kv_store)에서 보조 저장소를 복구한다 */
  await Promise.all([
    loadAdminConfig(),
    loadFriends(),
    loadBugReports(),
    loadCustomDict(),
    hydrateCustomWordsFromPG()
  ]);
  rebuildWordViews();
  if (!seasonStore) await loadSeasonStore();
  ensureSeasonRollover().catch(err => console.error("시작 시 시즌 전환 오류:", err.message));
  /* 한 시간마다 시즌 전환 감지 — 달이 바뀌는 순간을 놓치지 않도록 */
  setInterval(() => { ensureSeasonRollover().catch(() => {}); }, 60 * 60 * 1000);
  server.listen(PORT, "0.0.0.0", () => {
    console.log("========================================");
    console.log(`끝말잇기 서버 실행 중: http://localhost:${PORT}`);
    console.log(`단어: ${WORD_SET.size.toLocaleString()}개`);
    console.log(`공격 단어: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`);
    console.log(`방어 단어: ${DEFENSE_WORDS.size.toLocaleString()}개`);
    console.log(`데이터베이스: ${dbMode === "pg" ? "PostgreSQL" : "JSON 파일"}`);
    console.log(`공격 단어 금지 턴: ${ONESHOT_FREE_TURNS}턴`);
    if (dbMode === "json") {
      console.log("⚠ 데이터가 JSON 파일로만 저장됩니다 — 재배포/새 클론 시 유실될 수 있습니다.");
      console.log("  DATABASE_URL(PostgreSQL) 또는 KK_DATA_DIR(영속 디스크) 설정을 권장합니다.");
    }
    console.log("========================================");
  });
}).catch(err => {
  console.error("서버 시작 실패:", err);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`끝말잇기 서버 실행 중 (DB 없음): http://localhost:${PORT}`);
  });
});

process.on("SIGINT", () => { for (const room of ROOMS.values()) stopTurnTimer(room); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { for (const room of ROOMS.values()) stopTurnTimer(room); server.close(() => process.exit(0)); });
