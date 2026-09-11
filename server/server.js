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
  chooseAIWord, calculateRank, calculateElo
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
const STARTING_SYLLABLES = [
  "가", "나", "다", "마", "자", "기", "지", "아", "이"
];

/* =========================================================
   관리자 설정 — 수치로 조정 가능한 모든 값
========================================================= */

let adminPassword = null;
let subAdmins = [];
const ADMIN_NICKNAME = "blossomIng_0";
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

const { WORD_SET, ATTACK_DEPTH, WORD_INDEX, ROOT_WORDS, DEFENSE_WORDS } = loadData(DATA_DIR, ROOT_DIR);

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
          ADD COLUMN IF NOT EXISTS single_losses INTEGER DEFAULT 0
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
  /* 이전 단일 rating 스키마 → 싱글/멀티 분리 스키마 변환 */
  if (p && !p.single && !p.multi && typeof p.rating === "number") {
    p.single = { rating: p.rating, wins: p.wins || 0, losses: p.losses || 0 };
    p.multi = { rating: p.rating, wins: p.wins || 0, losses: p.losses || 0 };
  }
  p.single = Object.assign({ ...MODE_DEFAULT }, p.single || {});
  p.multi = Object.assign({ ...MODE_DEFAULT }, p.multi || {});
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
          single: { rating: row.single_rating, wins: row.single_wins, losses: row.single_losses }
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
  safe.single = { rating: num(safe.single.rating, 1000), wins: num(safe.single.wins, 0), losses: num(safe.single.losses, 0) };
  safe.multi = { rating: num(safe.multi.rating, 1000), wins: num(safe.multi.wins, 0), losses: num(safe.multi.losses, 0) };
  playerCache.set(playerId, safe);
  if (dbMode === "pg") {
    try {
      await dbPool.query(`
        INSERT INTO players (id, nickname, rating, wins, losses, single_rating, single_wins, single_losses, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (id) DO UPDATE SET
          nickname=$2, rating=$3, wins=$4, losses=$5,
          single_rating=$6, single_wins=$7, single_losses=$8, updated_at=NOW()
      `, [
        playerId, safe.nickname || "플레이어",
        safe.multi.rating, safe.multi.wins, safe.multi.losses,
        safe.single.rating, safe.single.wins, safe.single.losses
      ]);
    } catch (err) { console.error("DB 쓰기 오류:", err.message); }
  } else {
    saveJsonDb();
  }
}

async function updateRating(winnerId, loserId, winnerNickname, loserNickname, mode = "multi") {
  const key = mode === "single" ? "single" : "multi";
  const winner = await getPlayerData(winnerId);
  const loser = await getPlayerData(loserId);
  const { newWinnerRating, newLoserRating } = calculateElo(winner[key].rating, loser[key].rating);
  winner[key].rating = newWinnerRating; winner[key].wins += 1; winner.nickname = winnerNickname || winner.nickname;
  loser[key].rating = newLoserRating; loser[key].losses += 1; loser.nickname = loserNickname || loser.nickname;
  await savePlayerData(winnerId, winner);
  await savePlayerData(loserId, loser);
  return {
    winner: { ...winner, rank: calculateRank(winner[key].rating) },
    loser: { ...loser, rank: calculateRank(loser[key].rating) }
  };
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
      waiting: p.waiting || false
    })),
    playerCount: room.players.filter(p => !p.isBot && !p.waiting).length,
    maxPlayers: MAX_PLAYERS,
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

function finishGame(room, winnerIndex, loserIndex) {
  if (!room || room.finished) return;
  room.finished = true;
  room.winner = winnerIndex;
  room.loser = loserIndex;
  stopTurnTimer(room);

  const winnerName = winnerIndex !== null ? room.players[winnerIndex]?.nickname : "무승부";
  console.log(`[GAME END] Room:${room.id} Winner:${winnerName} (${winnerIndex}) Loser:(${loserIndex})`);

  /* 레이팅 반영 — 온라인 2인 또는 싱글(AI) 대전 */
  const w = winnerIndex != null ? room.players[winnerIndex] : null;
  const l = loserIndex != null ? room.players[loserIndex] : null;
  if (w && l && w.id !== l.id && (room.mode === "online" || w.isBot || l.isBot)) {
    const winnerId = w.isBot ? AI_PLAYER_ID : w.id;
    const loserId = l.isBot ? AI_PLAYER_ID : l.id;
    updateRating(
      winnerId, loserId,
      w.nickname || "플레이어", l.nickname || "플레이어",
      room.mode === "ai" ? "single" : "multi"
    )
      .then((result) => {
        for (const [data, p] of [[result.winner, w], [result.loser, l]]) {
          if (p && !p.isBot && p.socketId) {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.emit("player:ranking", { ...data, rank: data.rank });
          }
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

  /* 시작 음절 — 이전 라운드와 같은 음절이 반복되지 않도록 회피 */
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
    const syllable = room.startSyllable || "";
    const legal = (w) => {
      if (room.usedWords.has(w)) return false;
      if (isAttackWord(w, ATTACK_DEPTH)) return false;
      if (isOneShot(w, room.usedWords, WORD_INDEX)) return false;
      return true;
    };
    const candidates = [];
    for (const [firstChar, bucket] of WORD_INDEX) {
      if (firstChar !== syllable) continue;
      for (const w of bucket) {
        if (w.startsWith(syllable) && legal(w)) candidates.push(w);
      }
    }
    word = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  } else {
    word = chooseAIWord(room.currentWord, room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, room.turnNumber, DEFENSE_WORDS);
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
    let fallbackPool;
    if (room.turnNumber === 0) {
      const syllable = room.startSyllable || "";
      fallbackPool = getCandidates(syllable, room.usedWords, WORD_INDEX)
        .filter(w => w.startsWith(syllable)
          && !isAttackWord(w, ATTACK_DEPTH)
          && !isOneShot(w, room.usedWords, WORD_INDEX));
    } else {
      fallbackPool = getCandidates(room.currentWord || "", room.usedWords, WORD_INDEX)
        .filter(w => canConnect(room.currentWord || "", w));
    }
    if (fallbackPool.length > 0) {
      const retry = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
      playWord(room, player, retry, gameSessionId);
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
    const mode = req.query.mode === "single" ? "single" : "multi";
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "10"), 10) || 10));
    let rows = [];
    if (dbMode === "pg") {
      const col = mode === "single" ? "single_rating" : "rating";
      rows = (await dbPool.query(
        `SELECT id, nickname, ${col} AS stat_rating, ${
          mode === "single" ? "single_wins" : "wins"
        } AS stat_wins, ${
          mode === "single" ? "single_losses" : "losses"
        } AS stat_losses FROM players WHERE id <> $1 ORDER BY ${col} DESC LIMIT $2`,
        [AI_PLAYER_ID, limit]
      )).rows;
    } else {
      rows = [...playerCache.values()]
        .filter(p => p && p.id !== AI_PLAYER_ID)
        .map(p => {
          const s = (p && (mode === "single" ? p.single : p.multi)) ||
            (typeof p.rating === "number"
              ? { rating: p.rating, wins: p.wins, losses: p.losses }
              : { rating: 1000, wins: 0, losses: 0 });
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
      if (room.finished || !room.started) { socket.emit("game:error", { ok: false, reason: "게임이 진행 중이 아닙니다." }); return; }
      const player = getPlayerBySocket(room, socket.id);
      if (!player) { socket.emit("game:error", { ok: false, reason: "플레이어를 찾을 수 없습니다." }); return; }
      if (player.eliminated) { socket.emit("game:error", { ok: false, reason: "탈락한 플레이어입니다." }); return; }

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
            && !isOneShot(w, room.usedWords, WORD_INDEX));
      } else {
        const aiPick = chooseAIWord(room.currentWord, room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, room.turnNumber, DEFENSE_WORDS);
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
        multi: { ...data.multi, rank: calculateRank(data.multi.rating) }
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
    if (isAdminNick(nickname)) {
      return { ok: true, nickname, role: "super" };
    }
    const sub = findSubAdmin(nickname);
    if (sub) {
      return { ok: true, nickname, role: "sub", subAdmin: sub };
    }
    return { ok: false, reason: "관리자 권한이 없습니다." };
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
        player: { id, nickname: pd.nickname, single: { ...pd.single }, multi: { ...pd.multi } }
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
      const mode = data?.mode === "multi" ? "multi" : "single";
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
        player: { id, nickname: pd.nickname, single: { ...pd.single }, multi: { ...pd.multi } }
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
      if (!checkAdminPw(reg, data?.password)) {
        socket.emit("admin:panel", { ok: false, reason: "관리자 비밀번호가 올바르지 않습니다." });
        return;
      }
      const nickname = String(data?.nickname ?? "").trim();
      const password = String(data?.adminPassword ?? "").trim();
      if (!nickname || nickname.length < 2 || nickname.length > 20) {
        socket.emit("admin:panel", { ok: false, reason: "관리자 닉네임은 2~20자여야 합니다." });
        return;
      }
      if (password.length < 4) {
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
      subAdmins.push({ nickname, password });
      saveAdminConfig();
      socket.emit("admin:panel", {
        ok: true, role: reg.role, isSuper: true, hasPassword: !!adminPassword,
        subAdmins: subAdmins.map(s => s.nickname), config: getConfig(),
        startSyllables: STARTING_SYLLABLES, message: `'${nickname}' 관리자가 추가되었습니다.`
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
      socket.emit("player:nameUpdated", { ok: true, nickname });
      if (room) broadcastRoomState(room);
    } catch (err) { console.error("닉네임 설정 오류:", err); }
  });
});

/* =========================================================
   서버 시작
========================================================= */

initDatabase().then(() => {
  loadAdminConfig();
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
