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
  chooseAIWord, chooseAIStartWord, calculateRank, calculateElo
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
let MAX_HEARTS = 2;
let TURN_TIME = 20;
let MAX_PLAYERS = 10;
let ONESHOT_FREE_TURNS = 1;
let MISTAKES_PER_LIFE = 5;
const AI_PLAYER_ID = "ai";
const STARTING_SYLLABLES = ["가", "기", "나", "다", "마", "자", "시"];

/* =========================================================
   관리자 설정 — 수치로 조정 가능한 모든 값
========================================================= */

let adminPassword = null;
let subAdmins = [];
const ADMIN_NICKNAME = "blossomIng_0";
/* 접속 중인 소켓이 관리자 계정(닉네임+비밀번호) 인증을 통과했는지 — 닉네임만으로 관리자가 되지 못하게 함 */
const adminAuthed = new Map();
const adminConfigPath = path.join(DATA_DIR, "admin-config.json");

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
    fs.writeFileSync(adminConfigPath, JSON.stringify({ adminPassword, subAdmins, config: getConfig() }, null, 2));
  } catch (e) { console.warn("관리자 설정 저장 실패:", e.message); }
}

function loadAdminConfig() {
  try {
    if (fs.existsSync(adminConfigPath)) {
      const data = JSON.parse(fs.readFileSync(adminConfigPath, "utf8"));
      if (typeof data.adminPassword === "string" && data.adminPassword) adminPassword = data.adminPassword;
      if (Array.isArray(data.subAdmins)) {
        subAdmins = data.subAdmins
          .filter(s => s && String(s.nickname || "").trim() && String(s.password || "").length >= 4)
          .map(s => ({ nickname: String(s.nickname).trim(), password: String(s.password) }));
      }
      const c = data.config || {};
      for (const key of Object.keys(CONFIG_RANGES)) {
        if (typeof c[key] === "number") applyConfigValue(key, c[key]);
      }
      console.log("관리자 설정 로드 완료:", JSON.stringify(getConfig()));
    }
  } catch (e) { console.warn("관리자 설정 로드 실패:", e.message); }
}

/* =========================================================
   데이터 로드
========================================================= */

const { WORD_SET, ATTACK_DEPTH, WORD_INDEX, ROOT_WORDS, RARE_ROOT_WORDS, DEFENSE_WORDS } = loadData(DATA_DIR, ROOT_DIR);

/* =========================================================
   데이터베이스 — PostgreSQL 또는 JSON 파일 폴백
========================================================= */

let dbPool = null;
let dbMode = null;
const playerCache = new Map();
const jsonPath = path.join(ROOT_DIR, "player-data.json");

function loadJsonDb() {
  try {
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      for (const [k, v] of Object.entries(data)) playerCache.set(k, v);
      console.log(`JSON DB 로드: ${playerCache.size}명`);
    }
  } catch (e) { console.warn("JSON DB 로드 실패:", e.message); }
}

/* =========================================================
   친구 & 초대 — 닉네임이 곧 계정. 친구 목록/초대 대상 조회에 사용한다
========================================================= */
const friendsJsonPath = path.join(DATA_DIR, "friends.json");
const friendsMap = new Map();            /* 정규화 닉네임 -> Set<정규화 닉네임> */
const onlineNicks = new Map();           /* 정규화 닉네임 -> socketId(접속 중) */
const socketNicks = new Map();           /* socketId -> 등록된 닉네임 (닉네임 재적용 전 새 소켓 구분) */
const normKey = (nick) => String(nick || "").replace(/\s+/g, "").toLowerCase();

function loadFriends() {
  try {
    if (fs.existsSync(friendsJsonPath)) {
      const data = JSON.parse(fs.readFileSync(friendsJsonPath, "utf8"));
      for (const [k, arr] of Object.entries(data)) {
        friendsMap.set(normKey(k), new Set((arr || []).map(f => normKey(f))));
      }
      console.log(`친구 데이터 로드: ${friendsMap.size}명`);
    }
  } catch (e) { console.warn("친구 데이터 로드 실패:", e.message); }
}

function saveFriends() {
  try {
    const obj = {};
    for (const [k, set] of friendsMap) obj[k] = [...set];
    fs.writeFileSync(friendsJsonPath, JSON.stringify(obj, null, 2));
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

function saveJsonDb() {
  try {
    const obj = {};
    for (const [k, v] of playerCache) obj[k] = v;
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
          ranked_rating INTEGER DEFAULT 1000,
          ranked_wins INTEGER DEFAULT 0,
          ranked_losses INTEGER DEFAULT 0,
          money INTEGER DEFAULT 0,
          money_multiplier INTEGER DEFAULT 1,
          rating_boost_games INTEGER DEFAULT 0,
          titles TEXT DEFAULT '[]',
          current_title TEXT DEFAULT '',
          single_rating INTEGER DEFAULT 1000,
          single_wins INTEGER DEFAULT 0,
          single_losses INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await dbPool.query(`
        ALTER TABLE players
          ADD COLUMN IF NOT EXISTS single_rating INTEGER DEFAULT 1000,
          ADD COLUMN IF NOT EXISTS single_wins INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS single_losses INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS ranked_rating INTEGER DEFAULT 1000,
          ADD COLUMN IF NOT EXISTS ranked_wins INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS ranked_losses INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS money INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS money_multiplier INTEGER DEFAULT 1,
          ADD COLUMN IF NOT EXISTS rating_boost_games INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS titles TEXT DEFAULT '[]',
          ADD COLUMN IF NOT EXISTS current_title TEXT DEFAULT ''
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

const MODE_DEFAULT = { rating: 1000, wins: 0, losses: 0 };

function migratePlayerData(p) {
  p.single = Object.assign({ ...MODE_DEFAULT }, p.single || {});
  p.multi = Object.assign({ ...MODE_DEFAULT }, p.multi || {});
  p.ranked = Object.assign({ ...MODE_DEFAULT }, p.ranked || {});
  if (typeof p.money !== "number" || !Number.isFinite(p.money)) p.money = typeof p.money === "number" ? Math.max(0, p.money) : 0;
  p.money = Math.max(0, Math.floor(p.money));
  if (!Number.isFinite(p.moneyMultiplier) || p.moneyMultiplier < 1) p.moneyMultiplier = 1;
  p.moneyMultiplier = Math.min(99, Math.floor(p.moneyMultiplier));
  if (!Number.isFinite(p.ratingBoostGames) || p.ratingBoostGames < 0) p.ratingBoostGames = 0;
  p.ratingBoostGames = Math.floor(p.ratingBoostGames);
  if (!Array.isArray(p.titles)) p.titles = [];
  p.currentTitle = typeof p.currentTitle === "string" ? p.currentTitle : "";
  return p;
}

async function getPlayerData(playerId) {
  if (playerCache.has(playerId)) return migratePlayerData({ ...playerCache.get(playerId) });
  if (dbMode === "pg") {
    try {
      const result = await dbPool.query("SELECT * FROM players WHERE id = $1", [playerId]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        const data = {
          id: row.id,
          nickname: row.nickname,
          multi: { rating: row.rating, wins: row.wins, losses: row.losses },
          single: { rating: row.single_rating, wins: row.single_wins, losses: row.single_losses },
          ranked: { rating: row.ranked_rating, wins: row.ranked_wins, losses: row.ranked_losses },
          money: row.money,
          moneyMultiplier: row.money_multiplier,
          ratingBoostGames: row.rating_boost_games,
          titles: (() => { try { return JSON.parse(row.titles || "[]"); } catch { return []; } })(),
          currentTitle: row.current_title || ""
        };
        const migrated = migratePlayerData(data);
        playerCache.set(playerId, migrated);
        return { ...migrated };
      }
    } catch (err) { console.error("DB 읽기 오류:", err.message); }
  }
  const defaultData = migratePlayerData({ id: playerId, nickname: "플레이어" });
  playerCache.set(playerId, defaultData);
  return { ...defaultData };
}

async function savePlayerData(playerId, data) {
  const safe = migratePlayerData(data);
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  const modeCore = (m) => ({
    rating: num(m.rating, 1000),
    wins: Math.max(0, num(m.wins, 0)),
    losses: Math.max(0, num(m.losses, 0))
  });
  safe.single = modeCore(safe.single);
  safe.multi = modeCore(safe.multi);
  safe.ranked = modeCore(safe.ranked);
  safe.money = Math.max(0, Math.floor(num(safe.money, 0)));
  safe.moneyMultiplier = Math.min(99, Math.max(1, Math.floor(num(safe.moneyMultiplier, 1))));
  safe.ratingBoostGames = Math.max(0, Math.floor(num(safe.ratingBoostGames, 0)));
  safe.titles = Array.isArray(safe.titles) ? safe.titles.filter(t => t && typeof t === "object") : [];
  safe.currentTitle = typeof safe.currentTitle === "string" ? safe.currentTitle : "";
  playerCache.set(playerId, safe);
  if (dbMode === "pg") {
    try {
      await dbPool.query(`
        INSERT INTO players
          (id, nickname, rating, wins, losses, single_rating, single_wins, single_losses,
           ranked_rating, ranked_wins, ranked_losses, money, money_multiplier, rating_boost_games,
           titles, current_title, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
        ON CONFLICT (id) DO UPDATE SET
          nickname=$2, rating=$3, wins=$4, losses=$5,
          single_rating=$6, single_wins=$7, single_losses=$8,
          ranked_rating=$9, ranked_wins=$10, ranked_losses=$11,
          money=$12, money_multiplier=$13, rating_boost_games=$14,
          titles=$15, current_title=$16, updated_at=NOW()
      `, [
        playerId, safe.nickname || "플레이어",
        safe.multi.rating, safe.multi.wins, safe.multi.losses,
        safe.single.rating, safe.single.wins, safe.single.losses,
        safe.ranked.rating, safe.ranked.wins, safe.ranked.losses,
        safe.money, safe.moneyMultiplier, safe.ratingBoostGames,
        JSON.stringify(safe.titles), safe.currentTitle
      ]);
    } catch (err) { console.error("DB 쓰기 오류:", err.message); }
  } else {
    saveJsonDb();
  }
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

const bugReportsPath = path.join(DATA_DIR, "bug-reports.json");
let bugReports = [];

function loadBugReports() {
  try {
    if (fs.existsSync(bugReportsPath)) {
      bugReports = JSON.parse(fs.readFileSync(bugReportsPath, "utf8"));
      if (!Array.isArray(bugReports)) bugReports = [];
    }
  } catch (e) { console.warn("버그 제보 로드 실패:", e.message); }
}

function saveBugReports() {
  try {
    fs.writeFileSync(bugReportsPath, JSON.stringify(bugReports, null, 2));
  } catch (e) { console.warn("버그 제보 저장 실패:", e.message); }
}

/* =========================================================
   실시간 랭크 게임 — 매칭 큐
========================================================= */

const RANKED_QUEUE = [];
const RANKED_QUEUE_MAP = new Map(); /* socketId -> true */

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
    currentTitle: data.currentTitle
  };
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

    io.sockets.sockets.get(a.socketId).join(roomId);
    io.sockets.sockets.get(b.socketId).join(roomId);
    io.sockets.sockets.get(a.socketId).data.roomId = roomId;
    io.sockets.sockets.get(a.socketId).data.playerIndex = 0;
    io.sockets.sockets.get(b.socketId).data.roomId = roomId;
    io.sockets.sockets.get(b.socketId).data.playerIndex = 1;

    registerOnline(a.socketId, a.nickname);
    registerOnline(b.socketId, b.nickname);

    io.sockets.sockets.get(a.socketId).emit("ranked:matched", {
      ok: true, roomId, playerIndex: 0, opponent: b.nickname, opponentRating: b.rating,
      state: getPublicRoomState(room)
    });
    io.sockets.sockets.get(b.socketId).emit("ranked:matched", {
      ok: true, roomId, playerIndex: 1, opponent: a.nickname, opponentRating: a.rating,
      state: getPublicRoomState(room)
    });
    startNewGame(room);
    console.log(`[RANKED MATCH] ${a.nickname}(${a.rating}) vs ${b.nickname}(${b.rating}) → ${roomId}`);
  }
  broadcastRankedQueue();
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

function createRoom(socketId, nickname, mode) {
  const roomId = createRoomId();
  const room = {
    id: roomId,
    hostSocketId: socketId,
    mode: mode || "online",
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
    gameSessionId: 0
  };
  addPlayer(room, socketId, nickname);
  ROOMS.set(roomId, room);
  return room;
}

function addPlayer(room, socketId, nickname) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const playerIndex = room.players.length;
  const player = {
    id: socketId, socketId, playerIndex,
    nickname: nickname || `플레이어 ${playerIndex + 1}`,
    isBot: false, alive: true, connected: true,
    hearts: MAX_HEARTS, eliminated: false, mistakes: 0,
    waiting: false
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

/* 플레이어가 장착 중인 칭호 — 저장된 계정 데이터에서 조회 */
function playerTitle(player) {
  if (!player || player.isBot) return "";
  return (playerCache.get(player.id)?.currentTitle) || "";
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
        const d = playerCache.get(p.id);
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
    setTimeout(() => {
      if (room.gameSessionId !== gameSessionId) return;
      runAI(room, gameSessionId);
    }, 500);
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
    heartLost
  });

  const alive = getAlivePlayers(room);
  if (alive.length <= 1) {
    finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, player.playerIndex);
    return;
  }

  if (heartLost && !player.eliminated) {
    if (room.mode === "ai") {
      io.to(room.id).emit("game:roundReset", { reason: "하트 1개를 잃었습니다. 새 라운드를 시작합니다." });
      startNewGame(room, { preserveHearts: true });
    } else {
      const next = findNextAlivePlayer(room, player.playerIndex);
      if (next !== null) { room.turnPlayerIndex = next; room.turnNumber++; startTurnTimer(room, gameSessionId); }
    }
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
          const winnerData = await getPlayerData(w.id);
          const base = rollMoney();
          const earned = computeMoneyReward(base, winnerData);
          winnerData.money += earned;
          await savePlayerData(w.id, winnerData);
          const ws = io.sockets.sockets.get(w.socketId);
          if (ws) ws.emit("money:received", { amount: earned, base, multiplier: Math.round(earned / base), roomId: room.id });
        }
      })
      .catch((err) => console.error("레이팅 반영 오류:", err.message));
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

  /* 첫 선공 랜덤 — AI 모드에서는 AI가 먼저 시작할 수도 있다 */
  const eligibleFirst = room.players.filter(p => !p.eliminated && !p.waiting &&
    (room.mode === "ai" ? true : !p.isBot));
  if (eligibleFirst.length === 0) { room.started = false; return false; }
  room.turnPlayerIndex = eligibleFirst[Math.floor(Math.random() * eligibleFirst.length)].playerIndex;

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
    depth, nextCount: nextCandidates.length
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

    /* 랭크 전용: 중간에 한방단어로 매치가 끝나지 않도록
       마지막 하트라도 1개로 복구하고 새 라운드로 이어간다 */
    if (room.mode === "ranked" && loserPlayer.eliminated) {
      loserPlayer.eliminated = false;
      loserPlayer.hearts = 1;
      loserPlayer.alive = true;
    }

    io.to(room.id).emit("game:oneshot", {
      word, killer: player.playerIndex, killerNickname: player.nickname,
      target: loser, targetNickname: loserPlayer.nickname,
      hearts: loserPlayer.hearts, eliminated: loserPlayer.eliminated
    });

    const alive = getAlivePlayers(room);
    if (alive.length <= 1) {
      finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, loser);
      return { ok: true, finished: true };
    }

    /* 다음 라운드로 자연스럽게 이어짐 — 게임(목숨)은 유지 */
    io.to(room.id).emit("game:roundReset", {
      reason: `한방 단어 '${word}'! ${loserPlayer.nickname}님이 하트 1개를 잃었습니다.`
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
  if (room.turnNumber === 0) {
    word = chooseAIStartWord(room.startSyllable || "", room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, DEFENSE_WORDS, ROOT_WORDS);
  } else {
    word = chooseAIWord(room.currentWord, room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, room.turnNumber, DEFENSE_WORDS, RARE_ROOT_WORDS);
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
      const retry = chooseAIStartWord(room.startSyllable || "", blocked, WORD_SET, WORD_INDEX, ATTACK_DEPTH, DEFENSE_WORDS, ROOT_WORDS);
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
  res.json({ ok: true, words: WORD_SET.size, attackWords: Object.keys(ATTACK_DEPTH).length, rooms: ROOMS.size, uptime: process.uptime() });
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const mode = req.query.mode === "ranked" ? "ranked"
      : (req.query.mode === "single" || req.query.mode === "ai") ? "single"
      : "multi";
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "10"), 10) || 10));
    let rows = [];
    if (dbMode === "pg") {
      const isRanked = mode === "ranked";
      const isSingle = mode === "single";
      const col = isRanked ? "ranked_rating" : isSingle ? "single_rating" : "rating";
      const winCol = isRanked ? "ranked_wins" : isSingle ? "single_wins" : "wins";
      const lossCol = isRanked ? "ranked_losses" : isSingle ? "single_losses" : "losses";
      rows = (await dbPool.query(
        `SELECT id, nickname, ${col} AS stat_rating, ${winCol} AS stat_wins, ${lossCol} AS stat_losses
         FROM players WHERE id <> $1 ORDER BY ${col} DESC LIMIT $2`,
        [AI_PLAYER_ID, limit]
      )).rows;
    } else {
      rows = [...playerCache.values()]
        .filter(p => p && p.id !== AI_PLAYER_ID)
        .map(p => {
          const s = (p && (mode === "ranked" ? p.ranked : mode === "single" ? p.single : p.multi)) || { rating: 1000, wins: 0, losses: 0 };
          return {
            id: p.id, nickname: p.nickname,
            stat_rating: s.rating, stat_wins: s.wins, stat_losses: s.losses
          };
        })
        .sort((a, b) => (b.stat_rating || 1000) - (a.stat_rating || 1000))
        .slice(0, limit);
    }
    res.json(rows.map((r, i) => ({
      id: r.id, nickname: r.nickname, mode,
      ranking: r.stat_rating, wins: r.stat_wins, losses: r.stat_losses,
      rank: i + 1, tier: calculateRank(r.stat_rating)
    })));
  } catch (err) {
    console.error("리더보드 조회 오류:", err.message);
    res.status(500).json({ ok: false, error: "리더보드를 불러오지 못했습니다." });
  }
});

/* =========================================================
   Socket.IO 이벤트
========================================================= */

io.on("connection", (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.emit("server:ready", {
    ok: true, words: WORD_SET.size, attackWords: Object.keys(ATTACK_DEPTH).length,
    maxPlayers: MAX_PLAYERS, turnTime: TURN_TIME, maxHearts: MAX_HEARTS
  });

  socket.on("room:create", async (data) => {
    try {
      const nickname = normalizeWord(data?.nickname) || "플레이어";
      const mode = data?.mode === "ai" ? "ai" : "online";
      const oldRoom = findRoomBySocket(socket.id);
      if (oldRoom) { socket.leave(oldRoom.id); removePlayer(oldRoom, socket.id, "recreate"); }

      const room = createRoom(socket.id, nickname, mode);
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

      const nicknameExists = room.players.some(p => !p.isBot && p.nickname === nickname);
      if (nicknameExists) {
        socket.emit("room:error", { ok: false, reason: `"${nickname}" 닉네임은 이미 사용 중입니다.` });
        return;
      }

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

  socket.on("game:word", (data) => {
    try {
      const room = findRoomBySocket(socket.id);
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
          if (alive.length <= 1) {
            finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, player.playerIndex);
            return;
          }
          if (player.eliminated) {
            const next = findNextAlivePlayer(room, player.playerIndex);
            if (next !== null) { room.turnPlayerIndex = next; room.turnNumber++; startTurnTimer(room, room.gameSessionId); }
          } else if (heartLost) {
            if (room.mode === "ai") {
              io.to(room.id).emit("game:roundReset", { reason: "하트 1개를 잃었습니다. 새 라운드를 시작합니다." });
              startNewGame(room, { preserveHearts: true });
            } else {
              const next = findNextAlivePlayer(room, player.playerIndex);
              if (next !== null) { room.turnPlayerIndex = next; room.turnNumber++; startTurnTimer(room, room.gameSessionId); }
            }
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
      const room = findRoomBySocket(socket.id);
      if (!room) { socket.emit("game:hint", { ok: false, reason: "게임 방에 참여하지 않았습니다." }); return; }
      if (room.mode !== "ai") { socket.emit("game:hint", { ok: false, reason: "싱글플레이에서만 힌트를 사용할 수 있습니다." }); return; }
      if (!room.started || room.finished) { socket.emit("game:hint", { ok: false, reason: "게임이 진행 중이 아닙니다." }); return; }
      const player = getPlayerBySocket(room, socket.id);
      if (!player) { socket.emit("game:hint", { ok: false, reason: "플레이어를 찾을 수 없습니다." }); return; }
      if (player.eliminated) { socket.emit("game:hint", { ok: false, reason: "탈락한 플레이어입니다." }); return; }
      if (room.turnPlayerIndex !== player.playerIndex) { socket.emit("game:hint", { ok: false, reason: "지금은 당신의 차례가 아닙니다." }); return; }

      let candidates;
      if (room.turnNumber === 0) {
        const syllable = room.startSyllable || "";
        candidates = getCandidates(syllable, room.usedWords, WORD_INDEX)
          .filter(w => w.startsWith(syllable)
            && !isAttackWord(w, ATTACK_DEPTH)
            && !isOneShot(w, room.usedWords, WORD_INDEX)
            && !DEFENSE_WORDS.has(w));
      } else {
        const aiPick = chooseAIWord(room.currentWord, room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, room.turnNumber, DEFENSE_WORDS, RARE_ROOT_WORDS);
        candidates = aiPick ? [aiPick] : [];
      }

      if (candidates.length === 0) { socket.emit("game:hint", { ok: false, reason: "힌트를 찾을 수 없습니다." }); return; }

      /* 첫 턴도 '최선의 수' — 상대 선택지를 가장 적게 주는 단어를 권한다 */
      let word;
      if (room.turnNumber === 0) {
        let best = candidates[0];
        let bestCount = Infinity;
        for (const c of candidates) {
          const n = getCandidates(c, room.usedWords, WORD_INDEX).length;
          if (n < bestCount) { bestCount = n; best = c; }
        }
        word = best;
      } else {
        word = candidates[0];
      }
      socket.emit("game:hint", { ok: true, word });
    } catch (error) {
      console.error("game:hint 오류:", error);
      socket.emit("game:hint", { ok: false, reason: "힌트 처리 중 오류가 발생했습니다." });
    }
  });

  socket.on("game:start", () => {
    try {
      const room = findRoomBySocket(socket.id);
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
      const room = findRoomBySocket(socket.id);
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
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = ROOMS.get(roomId);
      if (!room) return;
      socket.leave(roomId);
      removePlayer(room, socket.id, "leave");
      const realPlayers = room.players.filter(p => !p.isBot);
      if (realPlayers.length === 0) { stopTurnTimer(room); ROOMS.delete(room.id); }
      socket.data.roomId = null;
      socket.data.playerIndex = null;
      socket.emit("room:left", { ok: true });
    } catch (error) { console.error("room:leave 오류:", error); }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[DISCONNECT] ${socket.id} / ${reason}`);
    adminAuthed.delete(socket.id);
    removeFromRankedQueue(socket.id);
    broadcastRankedQueue();
    unregisterOnline(socket.id);
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    const player = getPlayerBySocket(room, socket.id);
    if (player) {
      if (room.started && !room.finished) {
        player.connected = false;
        io.to(room.id).emit("room:playerDisconnected", { playerIndex: player.playerIndex, nickname: player.nickname });
        broadcastRoomState(room);
      } else {
        removePlayer(room, socket.id, "disconnect");
        const realPlayers = room.players.filter(p => !p.isBot);
        if (realPlayers.length === 0) { stopTurnTimer(room); ROOMS.delete(room.id); }
      }
    }
  });

  socket.on("room:state", () => {
    const room = findRoomBySocket(socket.id);
    if (room) socket.emit("game:state", getPublicRoomState(room));
  });

  /* -- 실시간 랭크 게임 매칭 ----------------------------- */
  socket.on("ranked:queue", async () => {
    try {
      const pd = await getPlayerData(socket.id);
      const nickname = String(pd.nickname || "플레이어").trim();
      if (!nickname) { socket.emit("ranked:queueStatus", { ok: false, reason: "닉네임을 먼저 설정해주세요." }); return; }
      if (findRoomBySocket(socket.id)) { removeFromRankedQueue(socket.id); }
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
    removeFromRankedQueue(socket.id);
    socket.emit("ranked:queueStatus", { ok: true, queued: false });
    broadcastRankedQueue();
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
      if (!pd.currentTitle) pd.currentTitle = title.name;
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
      broadcastRoomState(findRoomBySocket(socket.id));
    } catch (err) { console.error("칭호 변경 오류:", err); }
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

  /* 추방 — 방장 또는 관리자만 가능 */
  socket.on("room:kick", async (data) => {
    try {
      const room = findRoomBySocket(socket.id);
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
      const data = await getPlayerData(socket.id);
      socket.emit("player:ranking", {
        nickname: data.nickname,
        single: { ...data.single, rank: calculateRank(data.single.rating) },
        multi: { ...data.multi, rank: calculateRank(data.multi.rating) },
        ranked: { ...data.ranked, rank: calculateRank(data.ranked.rating) },
        money: data.money,
        moneyMultiplier: data.moneyMultiplier,
        ratingBoostGames: data.ratingBoostGames,
        titles: data.titles,
        currentTitle: data.currentTitle
      });
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
        startSyllables: STARTING_SYLLABLES
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
      pd[mode].rating = clampNum(data?.rating, 0, 9999, pd[mode].rating);
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
        ok: true, hasPassword: true,
        message: adminPassword ? "비밀번호가 변경되었습니다." : "비밀번호가 설정되었습니다.",
        config: getConfig()
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
      /* 닉네임만 입력하면 관리자로 추가 — 계정 비밀번호가 없으면 자동 발급 */
      let generatedPassword = null;
      if (!password) {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        password = "";
        for (let i = 0; i < 8; i++) password += chars[Math.floor(Math.random() * chars.length)];
        generatedPassword = password;
      }
      subAdmins.push({ nickname, password });
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: reg.role, isSuper: true, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES,
        generatedPassword,
        message: generatedPassword
          ? `'${nickname}' 관리자를 추가했습니다. 계정 비밀번호: ${generatedPassword} (이 비밀번호를 ${nickname}님에게 알려주세요)`
          : `'${nickname}' 관리자를 추가했습니다.`
      });
      console.log(`[ADMIN] ${reg.nickname}님이 서브 관리자 '${nickname}' 추가(비밀번호 ${generatedPassword ? "자동 발급" : "지정"})`);
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
        startSyllables: STARTING_SYLLABLES, message: `'${nickname}' 관리자가 제거되었습니다.`
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
      if (current !== reg.subAdmin.password) {
        socket.emit("admin:panel", { ok: false, reason: "현재 비밀번호가 올바르지 않습니다." });
        return;
      }
      reg.subAdmin.password = next;
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: "sub", isSuper: false, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, message: "서브 관리자 비밀번호가 변경되었습니다."
      });
      console.log(`[ADMIN] 서브 관리자 '${reg.nickname}' 비밀번호 변경`);
    } catch (err) { console.error("서브 관리자 비밀번호 오류:", err); }
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
        startSyllables: STARTING_SYLLABLES, message: `'${nickname}' 관리자 계정 비밀번호가 재설정되었습니다.`
      });
      console.log(`[ADMIN] ${reg.nickname}님이 서브 관리자 '${nickname}' 비밀번호 재설정`);
    } catch (err) { console.error("관리자 계정 비밀번호 재설정 오류:", err); }
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
          if (pw !== asSub.password) {
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

      const room = findRoomBySocket(socket.id);
      if (room) {
        const dup = room.players.find(p => !p.isBot && p.socketId !== socket.id && p.nickname === nickname);
        if (dup) {
          socket.emit("player:nameUpdated", { ok: false, reason: "이미 사용 중인 닉네임입니다." });
          return;
        }
        const me = room.players.find(p => p.socketId === socket.id);
        if (me) me.nickname = nickname;
      }
      const playerData = await getPlayerData(socket.id);
      playerData.nickname = nickname;
      await savePlayerData(socket.id, playerData);
      registerOnline(socket.id, nickname);
      socket.emit("player:nameUpdated", { ok: true, nickname });
      if (room) broadcastRoomState(room);
    } catch (err) { console.error("닉네임 설정 오류:", err); }
  });

  /* =========================================================
     친구 — 추가/삭제/목록, 온라인 상태 포함 (양방향 친구)
  ========================================================= */
  const emitFriendsUpdated = async (socket, ok, reason, extra) => {
    const nm = socketNicks.get(socket.id);
    if (!nm) {
      socket.emit("friends:updated", { ok: false, reason: "닉네임을 먼저 설정해주세요.", registered: false, friends: [] });
      return;
    }
    const me = normKey(nm);
    const list = me ? [...(friendsMap.get(me) || new Set())]
      .map(f => ({ nickname: f, online: onlineNicks.has(f) && io.sockets.sockets.has(onlineNicks.get(f)) })) : [];
    socket.emit("friends:updated", { ok, reason, registered: true, friends: list, ...(extra || {}) });
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
      if (!friendsMap.has(me)) friendsMap.set(me, new Set());
      if (friendsMap.get(me).has(target)) { await emitFriendsUpdated(socket, false, "이미 친구입니다."); return; }
      friendsMap.get(me).add(target);
      if (!friendsMap.has(target)) friendsMap.set(target, new Set());
      friendsMap.get(target).add(me);
      saveFriends();
      await emitFriendsUpdated(socket, true, `'${String(data?.nickname).trim()}' 님과 친구가 되었습니다.`);
      const tId = onlineNicks.get(target);
      if (tId && tId !== socket.id && io.sockets.sockets.has(tId)) {
        io.to(tId).emit("friends:updated", { ok: true, reason: `'${myNick}' 님이 친구로 추가했습니다.` });
      }
      console.log(`[FRIENDS] '${myNick}'님이 '${String(data?.nickname).trim()}' 친구 추가`);
    } catch (err) { console.error("친구 추가 오류:", err); }
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
      const room = findRoomBySocket(socket.id);
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

initDatabase().then(() => {
  loadAdminConfig();
  loadFriends();
  loadBugReports();
  server.listen(PORT, "0.0.0.0", () => {
    console.log("========================================");
    console.log(`끝말잇기 서버 실행 중: http://localhost:${PORT}`);
    console.log(`단어: ${WORD_SET.size.toLocaleString()}개`);
    console.log(`공격 단어: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`);
    console.log(`방어 단어: ${DEFENSE_WORDS.size.toLocaleString()}개`);
    console.log(`데이터베이스: ${dbMode === "pg" ? "PostgreSQL" : "JSON 파일"}`);
    console.log(`공격 단어 금지 턴: ${ONESHOT_FREE_TURNS}턴`);
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
