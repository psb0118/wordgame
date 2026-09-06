"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const {
  DUEUM, normalizeWord, allowedFirstChars, canConnect,
  loadData, hasWord, getAttackDepth, isAttackWord,
  getCandidates, getStartCandidates, chooseStartWord,
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
const MAX_HEARTS = 2;
const TURN_TIME = 15;
const MAX_PLAYERS = 2;

/* =========================================================
   데이터 로드
========================================================= */

const { WORD_SET, ATTACK_DEPTH, WORD_INDEX } = loadData(DATA_DIR, ROOT_DIR);

/* =========================================================
   데이터베이스
   PostgreSQL (DATABASE_URL) 또는 JSON 파일 폴백
========================================================= */

let dbPool = null;
let dbMode = null;
let playerCache = new Map();

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
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      dbMode = "pg";
      console.log("데이터베이스: PostgreSQL 연결 완료");
      return;
    } catch (err) {
      console.warn("PostgreSQL 연결 실패, JSON 파일 폴백:", err.message);
    }
  }

  dbMode = "json";
  console.log("데이터베이스: JSON 파일 모드");
}

async function getPlayerData(playerId) {
  if (playerCache.has(playerId)) return playerCache.get(playerId);

  if (dbMode === "pg") {
    try {
      const result = await dbPool.query("SELECT * FROM players WHERE id = $1", [playerId]);
      if (result.rows.length > 0) {
        const data = result.rows[0];
        playerCache.set(playerId, data);
        return data;
      }
    } catch (err) {
      console.error("DB 읽기 오류:", err.message);
    }
  }

  const defaultData = { id: playerId, nickname: "플레이어", rating: 1000, wins: 0, losses: 0 };
  playerCache.set(playerId, defaultData);
  return defaultData;
}

async function savePlayerData(playerId, data) {
  playerCache.set(playerId, data);

  if (dbMode === "pg") {
    try {
      await dbPool.query(`
        INSERT INTO players (id, nickname, rating, wins, losses, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          nickname = $2, rating = $3, wins = $4, losses = $5, updated_at = NOW()
      `, [playerId, data.nickname || "플레이어", data.rating, data.wins, data.losses]);
    } catch (err) {
      console.error("DB 쓰기 오류:", err.message);
    }
  }
}

async function updateRating(winnerId, loserId, winnerNickname, loserNickname) {
  const winner = await getPlayerData(winnerId);
  const loser = await getPlayerData(loserId);

  const { newWinnerRating, newLoserRating } = calculateElo(winner.rating, loser.rating);

  winner.rating = newWinnerRating;
  winner.wins += 1;
  winner.nickname = winnerNickname || winner.nickname;

  loser.rating = newLoserRating;
  loser.losses += 1;
  loser.nickname = loserNickname || loser.nickname;

  await savePlayerData(winnerId, winner);
  await savePlayerData(loserId, loser);

  return {
    winner: { ...winner, rank: calculateRank(winner.rating) },
    loser: { ...loser, rank: calculateRank(loser.rating) }
  };
}

/* =========================================================
   방 관리
========================================================= */

const ROOMS = new Map();

function createRoomId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (ROOMS.has(id));
  return id;
}

function createRoom(socketId, nickname, mode, aiLevel) {
  const roomId = createRoomId();
  const room = {
    id: roomId,
    hostSocketId: socketId,
    mode: mode === "ai" ? "ai" : "online",
    aiLevel: Math.min(5, Math.max(1, Number(aiLevel) || 3)),
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
    id: socketId,
    socketId: socketId,
    playerIndex: playerIndex,
    nickname: nickname || `플레이어 ${playerIndex + 1}`,
    isBot: false,
    alive: true,
    connected: true,
    hearts: MAX_HEARTS,
    eliminated: false
  };
  room.players.push(player);
  return player;
}

function addBot(room) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const playerIndex = room.players.length;
  const player = {
    id: `AI_${room.id}`,
    socketId: null,
    playerIndex: playerIndex,
    nickname: `AI Lv.${room.aiLevel}`,
    isBot: true,
    alive: true,
    connected: true,
    hearts: MAX_HEARTS,
    eliminated: false
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
  return room.players.filter(p => !p.eliminated);
}

function findNextAlivePlayer(room, currentIndex) {
  const total = room.players.length;
  for (let i = 1; i <= total; i++) {
    const index = (currentIndex + i) % total;
    const player = room.players[index];
    if (player && !player.eliminated) return player.playerIndex;
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
    mode: room.mode,
    aiLevel: room.aiLevel,
    currentWord: room.currentWord,
    turnPlayer: room.turnPlayerIndex,
    turnNumber: room.turnNumber,
    started: room.started,
    finished: room.finished,
    winner: room.winner,
    loser: room.loser,
    history: room.history.map(item => ({
      word: item.word,
      player: item.player,
      nickname: item.nickname,
      depth: item.depth,
      turn: item.turn
    })),
    players: room.players.map(p => ({
      id: p.id,
      playerIndex: p.playerIndex,
      nickname: p.nickname,
      isBot: p.isBot,
      hearts: p.hearts,
      alive: p.alive,
      connected: p.connected,
      eliminated: p.eliminated
    })),
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    turnStartedAt: room.turnStartedAt,
    turnEndsAt: room.turnEndsAt,
    turnTime: TURN_TIME
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
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.turnStartedAt = null;
  room.turnEndsAt = null;
}

function startTurnTimer(room, gameSessionId) {
  stopTurnTimer(room);
  if (!room || room.finished || !room.started) return;

  const player = getPlayerByIndex(room, room.turnPlayerIndex);
  if (!player || player.eliminated) return;

  const now = Date.now();
  room.turnStartedAt = now;
  room.turnEndsAt = now + TURN_TIME * 1000;

  broadcastRoomState(room);

  room.timer = setTimeout(() => {
    if (room.gameSessionId !== gameSessionId) return;
    handleTurnTimeout(room, gameSessionId);
  }, TURN_TIME * 1000);

  if (player.isBot) {
    setTimeout(() => {
      if (room.gameSessionId !== gameSessionId) return;
      runAI(room, gameSessionId);
    }, 800);
  }
}

function handleTurnTimeout(room, gameSessionId) {
  if (!room || room.finished || room.gameSessionId !== gameSessionId) return;

  const player = getPlayerByIndex(room, room.turnPlayerIndex);
  if (!player || player.eliminated) return;

  player.hearts--;
  if (player.hearts <= 0) {
    player.hearts = 0;
    player.eliminated = true;
  }

  io.to(room.id).emit("game:timeout", {
    player: player.playerIndex,
    nickname: player.nickname,
    hearts: player.hearts,
    eliminated: player.eliminated
  });

  const alive = getAlivePlayers(room);
  if (alive.length <= 1) {
    finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, player.playerIndex);
    return;
  }

  const next = findNextAlivePlayer(room, player.playerIndex);
  if (next === null) {
    finishGame(room, null, player.playerIndex);
    return;
  }

  room.turnPlayerIndex = next;
  room.turnNumber++;
  startTurnTimer(room, gameSessionId);
}

/* =========================================================
   게임 종료
========================================================= */

function finishGame(room, winnerIndex, loserIndex) {
  if (!room || room.finished) return;
  room.finished = true;
  room.winner = winnerIndex;
  room.loser = loserIndex;
  stopTurnTimer(room);

  io.to(room.id).emit("game:finished", {
    winner: winnerIndex,
    loser: loserIndex,
    state: getPublicRoomState(room)
  });

  broadcastRoomState(room);
}

/* =========================================================
   게임 시작
========================================================= */

function startNewGame(room) {
  if (!room) return false;
  room.gameSessionId++;
  stopTurnTimer(room);

  for (const player of room.players) {
    player.hearts = MAX_HEARTS;
    player.alive = true;
    player.eliminated = false;
  }

  room.currentWord = null;
  room.turnPlayerIndex = 0;
  room.turnNumber = 0;
  room.history = [];
  room.usedWords = new Set();
  room.finished = false;
  room.started = true;
  room.winner = null;
  room.loser = null;

  const startWord = chooseStartWord(room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH);
  if (!startWord) {
    room.started = false;
    return false;
  }

  room.currentWord = startWord;
  room.usedWords.add(startWord);
  room.history.push({
    word: startWord,
    player: -1,
    nickname: "시작 단어",
    depth: getAttackDepth(startWord, ATTACK_DEPTH),
    turn: 0
  });

  io.to(room.id).emit("game:started", {
    ok: true,
    startWord: startWord,
    state: getPublicRoomState(room)
  });

  startTurnTimer(room, room.gameSessionId);
  return true;
}

/* =========================================================
   단어 제출
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
  if (!word) return { ok: false, reason: "단어를 입력해주세요." };
  if (!hasWord(word, WORD_SET)) return { ok: false, reason: "단어 목록에 없는 단어입니다." };
  if (room.usedWords.has(word)) return { ok: false, reason: "이미 사용한 단어입니다." };

  if (room.currentWord && !canConnect(room.currentWord, word)) {
    const last = room.currentWord.at(-1);
    return {
      ok: false,
      reason: `"${last}" 다음에 연결할 수 없는 단어입니다.`,
      allowed: allowedFirstChars(last)
    };
  }

  stopTurnTimer(room);
  room.currentWord = word;
  room.usedWords.add(word);
  const depth = getAttackDepth(word, ATTACK_DEPTH);

  room.history.push({
    word: word,
    player: player.playerIndex,
    nickname: player.nickname,
    depth: depth,
    turn: room.history.length
  });

  const nextCandidates = getCandidates(word, room.usedWords, WORD_INDEX);

  io.to(room.id).emit("game:word", {
    ok: true,
    word: word,
    player: player.playerIndex,
    nickname: player.nickname,
    depth: depth,
    nextCount: nextCandidates.length
  });

  if (nextCandidates.length === 0) {
    const next = findNextAlivePlayer(room, player.playerIndex);
    finishGame(room, player.playerIndex, next);
    return { ok: true, finished: true };
  }

  const nextAlive = findNextAlivePlayer(room, player.playerIndex);
  if (nextAlive === null) {
    finishGame(room, player.playerIndex, null);
    return { ok: true, finished: true };
  }

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

  const player = getPlayerByIndex(room, room.turnPlayerIndex);
  if (!player || !player.isBot || player.eliminated) return;

  const word = chooseAIWord(room.currentWord, room.usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH);

  if (!word) {
    const next = findNextAlivePlayer(room, player.playerIndex);
    finishGame(room, next, player.playerIndex);
    return;
  }

  playWord(room, player, word, gameSessionId);
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

    io.to(room.id).emit("room:playerLeft", {
      playerIndex: player.playerIndex,
      nickname: player.nickname,
      reason: reason || "leave"
    });

    const alive = getAlivePlayers(room);
    if (alive.length <= 1) {
      finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, player.playerIndex);
      return;
    }

    if (room.turnPlayerIndex === player.playerIndex) {
      const next = findNextAlivePlayer(room, player.playerIndex);
      if (next !== null) {
        room.turnPlayerIndex = next;
        room.turnNumber++;
        startTurnTimer(room, room.gameSessionId);
      }
    }
  } else {
    room.players.splice(index, 1);
    for (let i = index; i < room.players.length; i++) {
      room.players[i].playerIndex = i;
    }
  }

  broadcastRoomState(room);
}

/* =========================================================
   정적 파일
========================================================= */

app.use(express.static(ROOT_DIR));
app.use(express.static(CLIENT_DIR));

app.get("/", (req, res) => {
  const candidates = [
    path.join(CLIENT_DIR, "index.html"),
    path.join(ROOT_DIR, "index.html")
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  res.status(404).send("index.html을 찾을 수 없습니다.");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    words: WORD_SET.size,
    attackWords: Object.keys(ATTACK_DEPTH).length,
    rooms: ROOMS.size,
    uptime: process.uptime()
  });
});

/* =========================================================
   Socket.IO 이벤트
========================================================= */

io.on("connection", (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.emit("server:ready", {
    ok: true,
    words: WORD_SET.size,
    attackWords: Object.keys(ATTACK_DEPTH).length,
    maxPlayers: MAX_PLAYERS,
    turnTime: TURN_TIME,
    maxHearts: MAX_HEARTS,
    defaultRating: 1000
  });

  /* -- 방 만들기 ---------------------------------------- */
  socket.on("room:create", async (data) => {
    try {
      const nickname = normalizeWord(data?.nickname) || "플레이어";
      const mode = data?.mode === "ai" ? "ai" : "online";
      const aiLevel = Math.min(5, Math.max(1, Number(data?.aiLevel) || 3));

      const oldRoom = findRoomBySocket(socket.id);
      if (oldRoom) {
        socket.leave(oldRoom.id);
        removePlayer(oldRoom, socket.id, "recreate");
      }

      const room = createRoom(socket.id, nickname, mode, aiLevel);
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerIndex = 0;
      socket.data.playerId = socket.id;

      socket.emit("room:created", {
        ok: true,
        roomId: room.id,
        playerIndex: 0,
        state: getPublicRoomState(room)
      });

      if (mode === "ai") {
        addBot(room);
        startNewGame(room);
      } else {
        broadcastRoomState(room);
      }
      console.log(`[ROOM CREATE] ${room.id} / ${socket.id} / ${mode}`);
    } catch (error) {
      console.error("room:create 오류:", error);
      socket.emit("room:error", { ok: false, reason: "방을 생성하지 못했습니다." });
    }
  });

  /* -- 방 참가 ------------------------------------------ */
  socket.on("room:join", (data) => {
    try {
      const roomId = String(data?.roomId || "").trim().toUpperCase();
      const nickname = normalizeWord(data?.nickname) || "플레이어";

      if (!roomId) {
        socket.emit("room:error", { ok: false, reason: "방 코드를 입력해주세요." });
        return;
      }

      const room = ROOMS.get(roomId);
      if (!room) {
        socket.emit("room:error", { ok: false, reason: "방을 찾을 수 없습니다." });
        return;
      }

      if (room.mode === "ai") {
        socket.emit("room:error", { ok: false, reason: "이 방은 AI 모드입니다." });
        return;
      }

      if (room.players.filter(p => !p.isBot).length >= MAX_PLAYERS) {
        socket.emit("room:error", { ok: false, reason: "방이 가득 찼습니다." });
        return;
      }

      const existing = room.players.find(p => p.socketId === socket.id);
      if (existing) {
        existing.connected = true;
        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.playerIndex = existing.playerIndex;
        socket.data.playerId = socket.id;

        socket.emit("room:joined", {
          ok: true,
          roomId: room.id,
          playerIndex: existing.playerIndex,
          reconnect: true,
          state: getPublicRoomState(room)
        });
        broadcastRoomState(room);
        return;
      }

      const player = addPlayer(room, socket.id, nickname);
      if (!player) {
        socket.emit("room:error", { ok: false, reason: "방에 입장할 수 없습니다." });
        return;
      }

      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerIndex = player.playerIndex;
      socket.data.playerId = socket.id;

      socket.emit("room:joined", {
        ok: true,
        roomId: room.id,
        playerIndex: player.playerIndex,
        state: getPublicRoomState(room)
      });

      io.to(room.id).emit("room:playerJoined", {
        playerIndex: player.playerIndex,
        nickname: player.nickname,
        state: getPublicRoomState(room)
      });

      if (room.players.filter(p => !p.isBot).length >= 2 && !room.started) {
        startNewGame(room);
      }

      broadcastRoomState(room);
      console.log(`[ROOM JOIN] ${room.id} / ${socket.id} / player ${player.playerIndex}`);
    } catch (error) {
      console.error("room:join 오류:", error);
      socket.emit("room:error", { ok: false, reason: "방에 입장하지 못했습니다." });
    }
  });

  /* -- 단어 제출 ---------------------------------------- */
  socket.on("game:word", (data) => {
    try {
      const room = findRoomBySocket(socket.id);
      if (!room) {
        socket.emit("game:error", { ok: false, reason: "게임 방에 참여하지 않았습니다." });
        return;
      }

      const player = getPlayerBySocket(room, socket.id);
      if (!player) {
        socket.emit("game:error", { ok: false, reason: "플레이어를 찾을 수 없습니다." });
        return;
      }

      const word = data?.word ?? data?.inputWord ?? "";
      const result = playWord(room, player, word, room.gameSessionId);

      if (!result.ok) {
        if (result.allowed) {
          player.hearts--;
          if (player.hearts <= 0) {
            player.hearts = 0;
            player.eliminated = true;
            const alive = getAlivePlayers(room);
            if (alive.length <= 1) {
              finishGame(room, alive.length === 1 ? alive[0].playerIndex : null, player.playerIndex);
            }
          }
          socket.emit("game:error", { ok: false, reason: result.reason, hearts: player.hearts, allowed: result.allowed });
          broadcastRoomState(room);
          if (room.finished) return;
          const next = findNextAlivePlayer(room, player.playerIndex);
          if (next !== null) {
            room.turnPlayerIndex = next;
            room.turnNumber++;
            startTurnTimer(room, room.gameSessionId);
          }
        } else {
          socket.emit("game:error", result);
        }
      }
    } catch (error) {
      console.error("game:word 오류:", error);
      socket.emit("game:error", { ok: false, reason: "단어 처리 중 오류가 발생했습니다." });
    }
  });

  /* -- 새 게임 ------------------------------------------ */
  socket.on("game:restart", () => {
    try {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      if (socket.id !== room.hostSocketId) {
        socket.emit("game:error", { ok: false, reason: "방장만 새 게임을 시작할 수 있습니다." });
        return;
      }
      startNewGame(room);
      console.log(`[GAME RESTART] ${room.id}`);
    } catch (error) {
      console.error("game:restart 오류:", error);
    }
  });

  /* -- 방 나가기 ---------------------------------------- */
  socket.on("room:leave", () => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = ROOMS.get(roomId);
      if (!room) return;

      socket.leave(roomId);
      removePlayer(room, socket.id, "leave");

      const realPlayers = room.players.filter(p => !p.isBot);
      if (realPlayers.length === 0) {
        stopTurnTimer(room);
        ROOMS.delete(room.id);
      }

      socket.data.roomId = null;
      socket.data.playerIndex = null;
      socket.emit("room:left", { ok: true });
    } catch (error) {
      console.error("room:leave 오류:", error);
    }
  });

  /* -- 연결 종료 ---------------------------------------- */
  socket.on("disconnect", (reason) => {
    console.log(`[DISCONNECT] ${socket.id} / ${reason}`);
    const room = findRoomBySocket(socket.id);
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (player) {
      if (room.started && !room.finished) {
        player.connected = false;
        io.to(room.id).emit("room:playerDisconnected", {
          playerIndex: player.playerIndex,
          nickname: player.nickname
        });
        broadcastRoomState(room);
      } else {
        removePlayer(room, socket.id, "disconnect");
        const realPlayers = room.players.filter(p => !p.isBot);
        if (realPlayers.length === 0) {
          stopTurnTimer(room);
          ROOMS.delete(room.id);
        }
      }
    }
  });

  /* -- 상태 요청 ---------------------------------------- */
  socket.on("room:state", () => {
    const room = findRoomBySocket(socket.id);
    if (room) {
      socket.emit("game:state", getPublicRoomState(room));
    }
  });

  /* -- 랭킹 요청 ---------------------------------------- */
  socket.on("player:getRanking", async () => {
    try {
      const data = await getPlayerData(socket.id);
      socket.emit("player:ranking", {
        ...data,
        rank: calculateRank(data.rating)
      });
    } catch (err) {
      console.error("랭킹 조회 오류:", err);
    }
  });
});

/* =========================================================
   서버 시작
========================================================= */

initDatabase().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log("========================================");
    console.log(`끝말잇기 서버 실행 중: http://localhost:${PORT}`);
    console.log(`단어: ${WORD_SET.size.toLocaleString()}개`);
    console.log(`공격 단어: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`);
    console.log(`데이터베이스: ${dbMode === "pg" ? "PostgreSQL" : "JSON 파일"}`);
    console.log("========================================");
  });
}).catch(err => {
  console.error("서버 시작 실패:", err);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`끝말잇기 서버 실행 중 (DB 없음): http://localhost:${PORT}`);
  });
});

function shutdown(signal) {
  console.log(`${signal} 수신. 서버 종료 중...`);
  for (const room of ROOMS.values()) {
    stopTurnTimer(room);
  }
  server.close(() => {
    console.log("서버가 종료되었습니다.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
