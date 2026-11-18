"use strict";

/* 방 상태 스냅샷 — 게임 코어가 재시작돼도 진행 중인 방을 복구한다.
   소켓·타이머는 저장하지 않는다. 복구된 방은 모든 사람이 재접속할 때까지
   startTurnTimer가 자동으로 대기하므로(기존 재접속 유예 규칙) 안전하게 멈춰 있다. */

const SNAPSHOT_VERSION = 1;
const MAX_ROOMS = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MODES = new Set(["online", "ranked", "tournament", "party"]);

function toInt(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function shouldPersist(room, now = Date.now()) {
  if (!room || room.finished) return false;
  if (!SNAPSHOT_MODES.has(room.mode)) return false;
  if (!Array.isArray(room.players)) return false;
  if (!room.players.some(p => p && !p.isBot && cleanText(p.nickname, 20))) return false;
  const createdAt = toInt(room.createdAt, now);
  return now - createdAt <= MAX_AGE_MS;
}

function serializeRoom(room) {
  if (!shouldPersist(room)) return null;
  return {
    id: cleanText(room.id, 12),
    mode: room.mode,
    modeId: room.modeId || null,
    practice: !!room.practice,
    tournament: !!room.tournament,
    tournamentId: room.tournamentId || null,
    createdAt: toInt(room.createdAt, Date.now()),
    started: !!room.started,
    currentWord: room.currentWord || null,
    startSyllable: room.startSyllable || null,
    lastSyllable: room.lastSyllable || null,
    turnPlayerIndex: toInt(room.turnPlayerIndex, 0),
    turnNumber: toInt(room.turnNumber, 0),
    gameSessionId: toInt(room.gameSessionId, 0),
    hintsUsed: toInt(room.hintsUsed, 0),
    history: (Array.isArray(room.history) ? room.history : [])
      .filter(item => item && typeof item.word === "string")
      .slice(-200)
      .map(item => ({
        word: cleanText(item.word, 40),
        player: toInt(item.player, 0),
        nickname: cleanText(item.nickname, 20),
        depth: toInt(item.depth, 0),
        turn: toInt(item.turn, 0)
      })),
    usedWords: [...(room.usedWords instanceof Set ? room.usedWords : [])]
      .filter(word => typeof word === "string")
      .slice(-5000),
    players: room.players
      .filter(p => p && !p.isBot && cleanText(p.nickname, 20))
      .map(p => ({
        id: cleanText(p.id, 60) || null,
        nickname: cleanText(p.nickname, 20),
        playerIndex: toInt(p.playerIndex, 0),
        alive: p.alive !== false,
        hearts: Math.max(1, toInt(p.hearts, 2)),
        eliminated: !!p.eliminated,
        mistakes: Math.max(0, toInt(p.mistakes, 0)),
        teamOf: (p.teamOf === 0 || p.teamOf === 1) ? p.teamOf : null
      }))
  };
}

function deserializeRoom(snapshot, now = Date.now()) {
  if (!snapshot || !SNAPSHOT_MODES.has(snapshot.mode)) return null;
  const id = cleanText(snapshot.id, 12);
  if (!/^[A-Z0-9]{4,12}$/.test(id)) return null;
  const createdAt = toInt(snapshot.createdAt, now);
  if (now - createdAt > MAX_AGE_MS) return null;

  const players = [];
  for (const raw of Array.isArray(snapshot.players) ? snapshot.players : []) {
    const nickname = cleanText(raw && raw.nickname, 20);
    if (!nickname || players.some(p => p.nickname === nickname)) continue;
    players.push({
      id: cleanText(raw.id, 60) || nickname,
      socketId: null,
      playerIndex: players.length,
      nickname,
      isBot: false,
      alive: raw.alive !== false,
      connected: false,
      hearts: Math.max(1, toInt(raw.hearts, 2)),
      eliminated: !!raw.eliminated,
      mistakes: Math.max(0, toInt(raw.mistakes, 0)),
      waiting: false,
      teamOf: (raw.teamOf === 0 || raw.teamOf === 1) ? raw.teamOf : null
    });
  }
  if (!players.length) return null;

  let turnPlayerIndex = Math.max(0, Math.min(players.length - 1, toInt(snapshot.turnPlayerIndex, 0)));
  if (snapshot.started) {
    const alive = players.map((p, i) => (p.alive && !p.eliminated ? i : -1)).filter(i => i >= 0);
    if (!alive.includes(turnPlayerIndex)) turnPlayerIndex = alive.length ? alive[0] : 0;
  }

  return {
    id,
    hostSocketId: null,
    mode: snapshot.mode,
    modeId: snapshot.modeId || null,
    teamOf: null,
    partyId: null,
    createdAt,
    players,
    currentWord: cleanText(snapshot.currentWord, 40) || null,
    startSyllable: cleanText(snapshot.startSyllable, 4) || null,
    lastSyllable: cleanText(snapshot.lastSyllable, 4) || null,
    turnPlayerIndex,
    turnNumber: Math.max(0, toInt(snapshot.turnNumber, 0)),
    history: (Array.isArray(snapshot.history) ? snapshot.history : [])
      .filter(item => item && typeof item.word === "string")
      .slice(-200)
      .map(item => ({
        word: cleanText(item.word, 40),
        player: toInt(item.player, 0),
        nickname: cleanText(item.nickname, 20),
        depth: toInt(item.depth, 0),
        turn: toInt(item.turn, 0)
      })),
    usedWords: new Set(
      (Array.isArray(snapshot.usedWords) ? snapshot.usedWords : [])
        .filter(word => typeof word === "string")
        .slice(-5000)
    ),
    started: !!snapshot.started,
    finished: false,
    winner: null,
    loser: null,
    timer: null,
    turnStartedAt: null,
    turnEndsAt: null,
    gameSessionId: Math.max(0, toInt(snapshot.gameSessionId, 0)),
    hintsUsed: Math.max(0, toInt(snapshot.hintsUsed, 0)),
    difficulty: "normal",
    aiThinkMs: 800,
    practice: !!snapshot.practice,
    tournament: !!snapshot.tournament,
    tournamentId: snapshot.tournamentId || null,
    spectators: new Map(),
    spectatorChat: [],
    chat: [],
    restored: true
  };
}

function collectRooms(rooms, { now = Date.now(), limit = MAX_ROOMS } = {}) {
  const out = [];
  for (const room of rooms || []) {
    if (!shouldPersist(room, now)) continue;
    const snapshot = serializeRoom(room);
    if (snapshot) out.push(snapshot);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return {
    version: SNAPSHOT_VERSION,
    savedAt: now,
    rooms: out.slice(0, Math.max(1, Math.floor(Number(limit) || MAX_ROOMS)))
  };
}

function restoreRooms(payload, { now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  const savedAt = Array.isArray(payload) ? now : toInt(payload && payload.savedAt, 0);
  if (!savedAt || now - savedAt > maxAgeMs) return [];
  const list = Array.isArray(payload) ? payload : (Array.isArray(payload.rooms) ? payload.rooms : []);
  const seen = new Set();
  const out = [];
  for (const snapshot of list) {
    const room = deserializeRoom(snapshot, now);
    if (!room || seen.has(room.id)) continue;
    seen.add(room.id);
    out.push(room);
    if (out.length >= MAX_ROOMS) break;
  }
  return out;
}

function allHumansConnected(room) {
  if (!room || !Array.isArray(room.players)) return false;
  return room.players.filter(p => p && !p.isBot).every(p => p.connected);
}

module.exports = {
  SNAPSHOT_VERSION,
  MAX_ROOMS,
  MAX_AGE_MS,
  shouldPersist,
  serializeRoom,
  deserializeRoom,
  collectRooms,
  restoreRooms,
  allHumansConnected
};
