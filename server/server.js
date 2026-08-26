"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

const ROOT_DIR = path.join(__dirname, "..");
const CLIENT_DIR = path.join(ROOT_DIR, "client");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");

app.use(express.json());

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

if (fs.existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR));
}

app.use(express.static(ROOT_DIR));

/* =========================================================
   설정
========================================================= */

const DEFAULT_HEARTS = 2;
const DEFAULT_TURN_TIME = 15;

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 20;

const MIN_TURN_TIME = 5;
const MAX_TURN_TIME = 60;

/* =========================================================
   데이터 경로
========================================================= */

const WORD_FILES = [
  path.join(ROOT_DIR, "word.txt"),
  path.join(DATA_DIR, "word.txt"),
  path.join(PUBLIC_DIR, "word.txt")
];

const ATTACK_FILES = [
  path.join(ROOT_DIR, "attack.txt"),
  path.join(DATA_DIR, "attack.txt"),
  path.join(PUBLIC_DIR, "attack.txt")
];

/* =========================================================
   데이터
========================================================= */

const WORDS = new Set();
const ATTACK_DEPTH = Object.create(null);
const WORD_INDEX = new Map();

/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
  "녀": ["녀", "여"],
  "년": ["년", "연"],
  "녕": ["녕", "영"],
  "녜": ["녜", "예"],
  "뇨": ["뇨", "요"],
  "뉴": ["뉴", "유"],
  "니": ["니", "이"],

  "랴": ["랴", "야"],
  "려": ["려", "여"],
  "례": ["례", "예"],
  "료": ["료", "요"],
  "류": ["류", "유"],
  "리": ["리", "이"],

  "라": ["라", "나"],
  "락": ["락", "낙"],
  "란": ["란", "난"],
  "랄": ["랄", "날"],
  "람": ["람", "남"],
  "랍": ["랍", "납"],
  "랏": ["랏", "낫"],
  "랑": ["랑", "낭"],
  "래": ["래", "내"],
  "랭": ["랭", "냉"],

  "략": ["략", "약"],
  "량": ["량", "양"],
  "련": ["련", "연"],
  "렬": ["렬", "열"],
  "령": ["령", "영"],

  "로": ["로", "노"],
  "록": ["록", "녹"],
  "론": ["론", "논"],
  "롤": ["롤", "놀"],
  "롬": ["롬", "놈"],
  "롭": ["롭", "놉"],
  "롯": ["롯", "놋"],
  "롱": ["롱", "농"],
  "뢰": ["뢰", "뇌"],

  "루": ["루", "누"],
  "륙": ["륙", "육"],
  "률": ["률", "율"],
  "륜": ["륜", "윤"],
  "륭": ["륭", "융"]
};

/* =========================================================
   유틸
========================================================= */

function normalizeWord(word) {
  if (typeof word !== "string") {
    return "";
  }

  return word
    .trim()
    .replace(/\s+/g, "")
    .normalize("NFC");
}

function findFile(files) {
  for (const file of files) {
    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}

/* =========================================================
   두음
========================================================= */

function allowedFirstChars(char) {
  char = normalizeWord(char);

  if (!char) {
    return [];
  }

  const result = new Set();

  result.add(char);

  const direct = DUEUM[char];

  if (Array.isArray(direct)) {
    for (const value of direct) {
      result.add(value);
    }
  }

  for (const [from, values] of Object.entries(DUEUM)) {
    if (Array.isArray(values) && values.includes(char)) {
      result.add(from);
    }
  }

  return [...result];
}

function canConnect(previousWord, nextWord) {
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
    return false;
  }

  const last = previousWord.at(-1);
  const first = nextWord.at(0);

  return allowedFirstChars(last).includes(first);
}

/* =========================================================
   단어 로딩
========================================================= */

function loadWords() {
  const file = findFile(WORD_FILES);

  if (!file) {
    console.error("word.txt를 찾을 수 없습니다.");
    return;
  }

  const text = fs.readFileSync(file, "utf8");

  WORDS.clear();

  for (const line of text.split(/\r?\n/)) {
    const first = line.trim().split(/\s+/)[0];

    if (!first) {
      continue;
    }

    const word = normalizeWord(first);

    if (word) {
      WORDS.add(word);
    }
  }

  console.log(
    `단어 로딩 완료: ${WORDS.size.toLocaleString()}개`
  );
  console.log(`word.txt: ${file}`);
}

function loadAttackWords() {
  const file = findFile(ATTACK_FILES);

  if (!file) {
    console.warn("attack.txt를 찾을 수 없습니다.");
    return;
  }

  const text = fs.readFileSync(file, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);

    if (!parts[0]) {
      continue;
    }

    const word = normalizeWord(parts[0]);
    const depth = Number(parts[1]);

    if (
      word &&
      Number.isFinite(depth)
    ) {
      ATTACK_DEPTH[word] = depth;
    }
  }

  console.log(
    `공격 단어 로딩 완료: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
  );
}

function buildWordIndex() {
  WORD_INDEX.clear();

  for (const word of WORDS) {
    const first = word.at(0);

    if (!first) {
      continue;
    }

    if (!WORD_INDEX.has(first)) {
      WORD_INDEX.set(first, []);
    }

    WORD_INDEX.get(first).push(word);
  }

  console.log(
    `단어 인덱스 생성 완료: ${WORD_INDEX.size}개`
  );
}

loadWords();
loadAttackWords();
buildWordIndex();

/* =========================================================
   후보
========================================================= */

function getCandidates(previousWord, usedWords) {
  if (!previousWord) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const result = [];

  for (
    const firstChar
    of allowedFirstChars(previousWord.at(-1))
  ) {
    const bucket = WORD_INDEX.get(firstChar);

    if (!bucket) {
      continue;
    }

    for (const word of bucket) {
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

function getStartCandidates(usedWords = new Set()) {
  const result = [];

  for (const word of WORDS) {
    if (usedWords.has(word)) {
      continue;
    }

    const next = getCandidates(
      word,
      new Set([word])
    );

    if (next.length > 0) {
      result.push(word);
    }
  }

  return result;
}

/* =========================================================
   시작 단어
========================================================= */

function chooseStartWord() {
  const candidates = getStartCandidates();

  if (!candidates.length) {
    return null;
  }

  return candidates[
    Math.floor(Math.random() * candidates.length)
  ];
}

/* =========================================================
   방
========================================================= */

const ROOMS = new Map();

function createRoomId() {
  let id;

  do {
    id = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
  } while (ROOMS.has(id));

  return id;
}

function createRoom({
  socketId,
  nickname,
  maxPlayers,
  turnTime,
  aiEnabled,
  aiLevel
}) {
  const id = createRoomId();

  const room = {
    id,

    hostSocketId: socketId,

    maxPlayers,

    turnTime,

    aiEnabled: !!aiEnabled,

    aiLevel: Number(aiLevel) || 3,

    players: [],

    currentWord: null,

    turnIndex: 0,

    history: [],

    usedWords: new Set(),

    finished: false,

    winner: null,

    started: false,

    timer: null,

    turnStartedAt: null,

    turnExpiresAt: null
  };

  ROOMS.set(id, room);

  addPlayer(
    room,
    socketId,
    nickname,
    false
  );

  return room;
}

/* =========================================================
   플레이어
========================================================= */

function addPlayer(
  room,
  socketId,
  nickname,
  isAI = false
) {
  if (room.players.length >= room.maxPlayers) {
    return null;
  }

  const player = {
    id:
      isAI
        ? `AI_${room.id}`
        : socketId,

    socketId:
      isAI
        ? null
        : socketId,

    nickname:
      nickname || "플레이어",

    hearts: DEFAULT_HEARTS,

    alive: true,

    isAI,

    aiLevel:
      isAI
        ? room.aiLevel
        : null
  };

  room.players.push(player);

  return player;
}

function getPlayerBySocket(room, socketId) {
  return room.players.find(
    player =>
      player.socketId === socketId
  );
}

function getAlivePlayers(room) {
  return room.players.filter(
    player => player.alive
  );
}

function getCurrentPlayer(room) {
  return room.players[room.turnIndex] || null;
}

/* =========================================================
   턴 이동
========================================================= */

function moveToNextAlivePlayer(room) {
  if (!room.players.length) {
    return null;
  }

  const count = room.players.length;

  for (let i = 1; i <= count; i++) {
    const index =
      (room.turnIndex + i) % count;

    const player = room.players[index];

    if (player && player.alive) {
      room.turnIndex = index;
      return player;
    }
  }

  return null;
}

/* =========================================================
   상태
========================================================= */

function getPublicState(room) {
  const current = getCurrentPlayer(room);

  return {
    roomId: room.id,

    maxPlayers: room.maxPlayers,

    playerCount: room.players.length,

    turnTime: room.turnTime,

    currentWord: room.currentWord,

    turnPlayer: current
      ? current.id
      : null,

    turnIndex: room.turnIndex,

    turnStartedAt:
      room.turnStartedAt,

    turnExpiresAt:
      room.turnExpiresAt,

    started:
      room.started,

    finished:
      room.finished,

    winner:
      room.winner,

    players:
      room.players.map(player => ({
        id: player.id,

        playerIndex:
          room.players.indexOf(player),

        nickname:
          player.nickname,

        hearts:
          player.hearts,

        alive:
          player.alive,

        isAI:
          player.isAI
      })),

    history:
      room.history.map(item => ({
        word: item.word,
        playerId: item.playerId,
        playerIndex: item.playerIndex,
        nickname: item.nickname,
        depth: item.depth,
        turn: item.turn
      }))
  };
}

function broadcastState(room) {
  io.to(room.id).emit(
    "game:state",
    getPublicState(room)
  );
}

/* =========================================================
   하트
========================================================= */

function damagePlayer(
  room,
  player,
  reason
) {
  if (!player || !player.alive) {
    return;
  }

  player.hearts--;

  io.to(room.id).emit(
    "player:heartLost",
    {
      playerId: player.id,

      playerIndex:
        room.players.indexOf(player),

      hearts:
        player.hearts,

      reason
    }
  );

  if (player.hearts <= 0) {
    player.hearts = 0;
    player.alive = false;

    io.to(room.id).emit(
      "player:eliminated",
      {
        playerId: player.id,

        playerIndex:
          room.players.indexOf(player),

        nickname:
          player.nickname
      }
    );
  }
}

/* =========================================================
   게임 종료
========================================================= */

function checkFinished(room) {
  const alive = getAlivePlayers(room);

  if (alive.length <= 1) {
    room.finished = true;

    room.winner =
      alive.length === 1
        ? alive[0].id
        : null;

    clearTurnTimer(room);

    io.to(room.id).emit(
      "game:finished",
      {
        winner: room.winner,

        state:
          getPublicState(room)
      }
    );

    return true;
  }

  return false;
}

/* =========================================================
   타이머
========================================================= */

function clearTurnTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function startTurnTimer(room) {
  clearTurnTimer(room);

  if (
    !room.started ||
    room.finished
  ) {
    return;
  }

  const player =
    getCurrentPlayer(room);

  if (!player || !player.alive) {
    return;
  }

  room.turnStartedAt =
    Date.now();

  room.turnExpiresAt =
    Date.now() +
    room.turnTime * 1000;

  broadcastState(room);

  room.timer = setTimeout(() => {
    handleTimeout(room);
  }, room.turnTime * 1000 + 50);

  if (player.isAI) {
    setTimeout(() => {
      if (
        room.finished ||
        !player.alive ||
        getCurrentPlayer(room)?.id !== player.id
      ) {
        return;
      }

      aiPlay(room, player);
    }, 500);
  }
}

function handleTimeout(room) {
  if (room.finished) {
    return;
  }

  const player =
    getCurrentPlayer(room);

  if (!player || !player.alive) {
    return;
  }

  damagePlayer(
    room,
    player,
    "timeout"
  );

  if (checkFinished(room)) {
    broadcastState(room);
    return;
  }

  moveToNextAlivePlayer(room);

  startTurnTimer(room);
}

/* =========================================================
   단어 판정
========================================================= */

function validateWord(
  room,
  player,
  rawWord
) {
  const word =
    normalizeWord(rawWord);

  if (!word) {
    return {
      ok: false,
      reason: "단어를 입력해주세요."
    };
  }

  if (!room.started) {
    return {
      ok: false,
      reason: "게임이 아직 시작되지 않았습니다."
    };
  }

  if (room.finished) {
    return {
      ok: false,
      reason: "이미 게임이 끝났습니다."
    };
  }

  if (!player || !player.alive) {
    return {
      ok: false,
      reason: "현재 플레이어가 아닙니다."
    };
  }

  const current =
    getCurrentPlayer(room);

  if (!current || current.id !== player.id) {
    return {
      ok: false,
      reason: "지금은 당신의 차례가 아닙니다."
    };
  }

  if (!WORDS.has(word)) {
    return {
      ok: false,
      reason: "단어 목록에 없는 단어입니다."
    };
  }

  if (room.usedWords.has(word)) {
    return {
      ok: false,
      reason: "이미 사용한 단어입니다."
    };
  }

  if (
    room.currentWord &&
    !canConnect(
      room.currentWord,
      word
    )
  ) {
    return {
      ok: false,
      reason:
        `"${room.currentWord.at(-1)}" 다음에 연결할 수 없는 단어입니다.`,
      allowed:
        allowedFirstChars(
          room.currentWord.at(-1)
        )
    };
  }

  return {
    ok: true,
    word
  };
}

/* =========================================================
   단어 등록
========================================================= */

function playWord(
  room,
  player,
  rawWord
) {
  const result =
    validateWord(
      room,
      player,
      rawWord
    );

  if (!result.ok) {
    return result;
  }

  clearTurnTimer(room);

  const word = result.word;

  room.currentWord = word;

  room.usedWords.add(word);

  const depth =
    Number.isFinite(
      ATTACK_DEPTH[word]
    )
      ? ATTACK_DEPTH[word]
      : null;

  const playerIndex =
    room.players.indexOf(player);

  room.history.push({
    word,

    playerId:
      player.id,

    playerIndex,

    nickname:
      player.nickname,

    depth,

    turn:
      room.history.length + 1
  });

  io.to(room.id).emit(
    "game:word",
    {
      ok: true,

      word,

      playerId:
        player.id,

      playerIndex,

      nickname:
        player.nickname,

      depth
    }
  );

  if (
    checkFinished(room)
  ) {
    broadcastState(room);
    return {
      ok: true,
      finished: true
    };
  }

  moveToNextAlivePlayer(room);

  broadcastState(room);

  startTurnTimer(room);

  return {
    ok: true,
    finished: false
  };
}

/* =========================================================
   AI
========================================================= */

function scoreAIWord(
  room,
  word,
  level
) {
  const candidates =
    getCandidates(
      word,
      new Set([
        ...room.usedWords,
        word
      ])
    );

  let score = 0;

  const depth =
    Number.isFinite(
      ATTACK_DEPTH[word]
    )
      ? ATTACK_DEPTH[word]
      : null;

  /*
   * 다음 선택지가 적을수록 공격적인 단어
   */
  score +=
    Math.max(
      0,
      100 - candidates.length
    );

  /*
   * 공격 단어
   */
  if (depth !== null) {
    score += depth * 20 * level;
  }

  /*
   * 즉사 공격
   */
  if (candidates.length === 0) {
    score += 10000 * level;
  }

  /*
   * 낮은 레벨은 너무 강한 공격을 자제
   */
  if (
    level <= 2 &&
    depth !== null &&
    depth >= 7
  ) {
    score -= 150;
  }

  /*
   * 랜덤성
   */
  score += Math.random() * 100;

  return score;
}

function chooseAIWord(room, level) {
  const player =
    getCurrentPlayer(room);

  if (!player) {
    return null;
  }

  let candidates =
    room.currentWord
      ? getCandidates(
          room.currentWord,
          room.usedWords
        )
      : chooseStartCandidatesForAI(room);

  if (!candidates.length) {
    return null;
  }

  /*
   * AI 레벨별 후보 제한
   */
  if (level <= 1) {
    return candidates[
      Math.floor(
        Math.random() *
        candidates.length
      )
    ];
  }

  if (level === 2) {
    candidates =
      candidates
        .map(word => ({
          word,
          score:
            scoreAIWord(
              room,
              word,
              0.3
            )
        }))
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(
          0,
          Math.min(10, candidates.length)
        )
        .map(item => item.word);
  } else {
    candidates =
      candidates
        .map(word => ({
          word,
          score:
            scoreAIWord(
              room,
              word,
              level
            )
        }))
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(
          0,
          Math.min(
            20,
            candidates.length
          )
        )
        .map(item => item.word);
  }

  return candidates[
    Math.floor(
      Math.random() *
      candidates.length
    )
  ];
}

function chooseStartCandidatesForAI(room) {
  const candidates =
    getStartCandidates(
      room.usedWords
    );

  return candidates;
}

function aiPlay(room, player) {
  if (
    room.finished ||
    !player.alive ||
    getCurrentPlayer(room)?.id !== player.id
  ) {
    return;
  }

  const word =
    chooseAIWord(
      room,
      player.aiLevel || room.aiLevel
    );

  if (!word) {
    handleTimeout(room);
    return;
  }

  playWord(
    room,
    player,
    word
  );
}

/* =========================================================
   새 게임
========================================================= */

function startNewGame(room) {
  clearTurnTimer(room);

  for (const player of room.players) {
    player.hearts = DEFAULT_HEARTS;
    player.alive = true;
  }

  room.currentWord = null;

  room.turnIndex = 0;

  room.history = [];

  room.usedWords = new Set();

  room.finished = false;

  room.winner = null;

  room.started = true;

  /*
   * 새 게임 시작 단어 자동 생성
   */
  const startWord =
    chooseStartWord();

  if (!startWord) {
    room.started = false;

    return {
      ok: false,
      reason:
        "사용할 수 있는 시작 단어를 찾지 못했습니다."
    };
  }

  room.currentWord = startWord;

  room.usedWords.add(startWord);

  room.history.push({
    word: startWord,

    playerId: "SYSTEM",

    playerIndex: -1,

    nickname: "시작 단어",

    depth:
      Number.isFinite(
        ATTACK_DEPTH[startWord]
      )
        ? ATTACK_DEPTH[startWord]
        : null,

    turn: 0
  });

  /*
   * 첫 번째 플레이어가 시작
   */
  room.turnIndex = 0;

  io.to(room.id).emit(
    "game:started",
    {
      ok: true,

      startWord,

      state:
        getPublicState(room)
    }
  );

  broadcastState(room);

  startTurnTimer(room);

  return {
    ok: true,
    startWord
  };
}

/* =========================================================
   소켓
========================================================= */

io.on("connection", socket => {
  console.log(
    `[CONNECT] ${socket.id}`
  );

  socket.emit(
    "server:ready",
    {
      ok: true,

      words:
        WORDS.size,

      attackWords:
        Object.keys(
          ATTACK_DEPTH
        ).length
    }
  );

  /* =======================================================
     방 생성
  ======================================================= */

  socket.on(
    "room:create",
    data => {
      try {
        const nickname =
          normalizeWord(
            data?.nickname
          ) || "플레이어";

        const maxPlayers =
          Math.min(
            MAX_PLAYERS,
            Math.max(
              MIN_PLAYERS,
              Number(
                data?.maxPlayers
              ) || 2
            )
          );

        const turnTime =
          Math.min(
            MAX_TURN_TIME,
            Math.max(
              MIN_TURN_TIME,
              Number(
                data?.turnTime
              ) || DEFAULT_TURN_TIME
            )
          );

        const room =
          createRoom({
            socketId:
              socket.id,

            nickname,

            maxPlayers,

            turnTime,

            aiEnabled:
              !!data?.aiEnabled,

            aiLevel:
              Number(
                data?.aiLevel
              ) || 3
          });

        socket.join(room.id);

        socket.data.roomId =
          room.id;

        socket.data.playerId =
          socket.id;

        socket.emit(
          "room:created",
          {
            ok: true,

            roomId:
              room.id,

            state:
              getPublicState(room)
          }
        );

        /*
         * AI 방
         */
        if (
          room.aiEnabled &&
          room.players.length < room.maxPlayers
        ) {
          addPlayer(
            room,
            null,
            `AI Lv.${room.aiLevel}`,
            true
          );

          broadcastState(room);

          startNewGame(room);
        }

      } catch (error) {
        console.error(error);

        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "방을 생성하지 못했습니다."
          }
        );
      }
    }
  );

  /* =======================================================
     방 입장
  ======================================================= */

  socket.on(
    "room:join",
    data => {
      const roomId =
        String(
          data?.roomId || ""
        )
          .trim()
          .toUpperCase();

      const nickname =
        normalizeWord(
          data?.nickname
        ) || "플레이어";

      const room =
        ROOMS.get(roomId);

      if (!room) {
        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "방을 찾을 수 없습니다."
          }
        );

        return;
      }

      if (
        room.players.length >=
        room.maxPlayers
      ) {
        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "방이 가득 찼습니다."
          }
        );

        return;
      }

      if (room.finished) {
        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "이미 종료된 게임입니다."
          }
        );

        return;
      }

      const player =
        addPlayer(
          room,
          socket.id,
          nickname,
          false
        );

      socket.join(room.id);

      socket.data.roomId =
        room.id;

      socket.data.playerId =
        player.id;

      socket.emit(
        "room:joined",
        {
          ok: true,

          roomId:
            room.id,

          playerId:
            player.id,

          state:
            getPublicState(room)
        }
      );

      io.to(room.id).emit(
        "room:ready",
        {
          ok: true,

          state:
            getPublicState(room)
        }
      );

      /*
       * 인원이 2명 이상이면 자동 시작
       */
      if (
        !room.started &&
        room.players.length >= 2
      ) {
        startNewGame(room);
      } else {
        broadcastState(room);
      }
    }
  );

  /* =======================================================
     상태 요청
  ======================================================= */

  socket.on(
    "room:state",
    () => {
      const room =
        ROOMS.get(
          socket.data.roomId
        );

      if (!room) {
        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "참여 중인 방이 없습니다."
          }
        );

        return;
      }

      socket.emit(
        "game:state",
        getPublicState(room)
      );
    }
  );

  /* =======================================================
     단어 제출
  ======================================================= */

  socket.on(
    "game:word",
    data => {
      const room =
        ROOMS.get(
          socket.data.roomId
        );

      if (!room) {
        socket.emit(
          "game:error",
          {
            ok: false,
            reason:
              "게임 방에 참여하지 않았습니다."
          }
        );

        return;
      }

      const player =
        getPlayerBySocket(
          room,
          socket.id
        );

      const word =
        data?.word ??
        data?.inputWord ??
        "";

      const result =
        playWord(
          room,
          player,
          word
        );

      if (!result.ok) {
        /*
         * 잘못된 단어도 실패로 간주하여
         * 하트 감소
         */
        if (
          player &&
          player.alive &&
          room.started &&
          getCurrentPlayer(room)?.id === player.id
        ) {
          clearTurnTimer(room);

          damagePlayer(
            room,
            player,
            "invalid"
          );

          if (
            checkFinished(room)
          ) {
            broadcastState(room);
            return;
          }

          moveToNextAlivePlayer(room);

          broadcastState(room);

          startTurnTimer(room);
        }

        socket.emit(
          "game:error",
          result
        );

        return;
      }

      broadcastState(room);
    }
  );

  /* =======================================================
     새 게임
  ======================================================= */

  socket.on(
    "game:restart",
    () => {
      const room =
        ROOMS.get(
          socket.data.roomId
        );

      if (!room) {
        socket.emit(
          "game:error",
          {
            ok: false,
            reason:
              "참여 중인 방이 없습니다."
          }
        );

        return;
      }

      if (
        socket.id !==
        room.hostSocketId
      ) {
        socket.emit(
          "game:error",
          {
            ok: false,
            reason:
              "방장만 새 게임을 시작할 수 있습니다."
          }
        );

        return;
      }

      if (
        room.players.filter(
          player =>
            !player.isAI
        ).length < 1
      ) {
        return;
      }

      startNewGame(room);
    }
  );

  /* =======================================================
     방 나가기
  ======================================================= */

  socket.on(
    "room:leave",
    () => {
      leaveRoom(socket);
    }
  );

  /* =======================================================
     연결 종료
  ======================================================= */

  socket.on(
    "disconnect",
    reason => {
      console.log(
        `[DISCONNECT] ${socket.id} / ${reason}`
      );

      leaveRoom(socket, true);
    }
  );
});

/* =========================================================
   방 나가기
========================================================= */

function leaveRoom(
  socket,
  disconnected = false
) {
  const roomId =
    socket.data.roomId;

  if (!roomId) {
    return;
  }

  const room =
    ROOMS.get(roomId);

  if (!room) {
    return;
  }

  const player =
    getPlayerBySocket(
      room,
      socket.id
    );

  if (!player) {
    return;
  }

  const index =
    room.players.indexOf(player);

  room.players.splice(
    index,
    1
  );

  if (room.players.length === 0) {
    clearTurnTimer(room);
    ROOMS.delete(room.id);
    return;
  }

  /*
   * 나간 사람이 현재 턴이면
   * 다음 사람으로 넘긴다.
   */
  if (
    index === room.turnIndex
  ) {
    room.turnIndex =
      Math.max(
        0,
        room.turnIndex - 1
      );

    moveToNextAlivePlayer(room);

    if (
      room.started &&
      !room.finished
    ) {
      startTurnTimer(room);
    }
  } else if (
    index < room.turnIndex
  ) {
    room.turnIndex--;
  }

  /*
   * 방장이 나갔으면 남은 사람에게 이전
   */
  if (
    room.hostSocketId === socket.id
  ) {
    const next =
      room.players.find(
        p => !p.isAI
      );

    room.hostSocketId =
      next?.socketId || null;
  }

  /*
   * 살아있는 사람이 한 명뿐이면 종료
   */
  if (
    room.started &&
    checkFinished(room)
  ) {
    broadcastState(room);
    return;
  }

  io.to(room.id).emit(
    "room:playerLeft",
    {
      ok: true,

      playerId:
        player.id,

      nickname:
        player.nickname,

      disconnected,

      state:
        getPublicState(room)
    }
  );

  broadcastState(room);

  socket.data.roomId = null;
  socket.data.playerId = null;
}

/* =========================================================
   API
========================================================= */

app.get("/", (req, res) => {
  const indexCandidates = [
    path.join(CLIENT_DIR, "index.html"),
    path.join(PUBLIC_DIR, "index.html"),
    path.join(ROOT_DIR, "index.html")
  ];

  for (const file of indexCandidates) {
    if (fs.existsSync(file)) {
      res.sendFile(file);
      return;
    }
  }

  res.status(404).send(
    "index.html을 찾을 수 없습니다."
  );
});

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      words:
        WORDS.size,

      attackWords:
        Object.keys(
          ATTACK_DEPTH
        ).length,

      rooms:
        ROOMS.size
    });
  }
);

/* =========================================================
   서버 시작
========================================================= */

server.listen(
  PORT,
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "끝말잇기 서버 시작"
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      `WORDS: ${WORDS.size.toLocaleString()}`
    );

    console.log(
      `ATTACK: ${Object.keys(
        ATTACK_DEPTH
      ).length.toLocaleString()}`
    );

    console.log(
      "========================================"
    );
  }
);

/* =========================================================
   종료
========================================================= */

function shutdown(signal) {
  console.log(
    `${signal} 수신. 서버 종료`
  );

  for (const room of ROOMS.values()) {
    clearTurnTimer(room);
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
