"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

/* =========================================================
   기본 설정
========================================================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

const PORT = Number(process.env.PORT) || 3000;

/*
 * 최대 플레이어 수.
 *
 * 환경변수 MAX_PLAYERS가 있으면 그것을 사용하고
 * 없으면 8명.
 *
 * 2~N명 구조.
 */
const MAX_PLAYERS =
  Math.max(
    2,
    Number(process.env.MAX_PLAYERS) || 8
  );

/*
 * 한 턴 제한시간.
 * 기본 15초.
 */
const TURN_TIME =
  Math.max(
    5,
    Number(process.env.TURN_TIME) || 15
  );

/*
 * 하트.
 */
const MAX_HEARTS = 2;

/* =========================================================
   경로
========================================================= */

const ROOT_DIR =
  path.join(__dirname, "..");

const PUBLIC_DIR =
  path.join(ROOT_DIR, "public");

const CLIENT_DIR =
  path.join(ROOT_DIR, "client");

const DATA_DIR =
  path.join(ROOT_DIR, "data");

/* =========================================================
   데이터 파일 후보
========================================================= */

const WORD_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "word.txt"),
  path.join(DATA_DIR, "word.txt"),
  path.join(PUBLIC_DIR, "word.txt")
];

const ATTACK_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "attack.txt"),
  path.join(DATA_DIR, "attack.txt"),
  path.join(PUBLIC_DIR, "attack.txt")
];

/* =========================================================
   정적 파일
========================================================= */

app.use(express.json());

/*
 * 프로젝트 전체를 정적으로 제공.
 *
 * 이렇게 해두면
 *
 * /
 * /index.html
 * /client/script.js
 * /public/...
 *
 * 등이 정상적으로 접근 가능.
 */
app.use(
  express.static(ROOT_DIR)
);

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR)
  );
}

/* =========================================================
   데이터
========================================================= */

const WORDS =
  new Set();

const ATTACK_DEPTH =
  Object.create(null);

const WORD_INDEX =
  new Map();

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

function findExistingFile(files) {
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

function allowedFirstChars(lastChar) {
  lastChar =
    normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result =
    new Set();

  result.add(lastChar);

  const direct =
    DUEUM[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      result.add(char);
    }
  }

  for (
    const [from, values]
    of Object.entries(DUEUM)
  ) {
    if (!Array.isArray(values)) {
      continue;
    }

    if (values.includes(lastChar)) {
      result.add(from);
    }
  }

  return [...result];
}

function canConnect(
  previousWord,
  nextWord
) {
  previousWord =
    normalizeWord(previousWord);

  nextWord =
    normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
    return false;
  }

  const last =
    previousWord.at(-1);

  const first =
    nextWord.at(0);

  return allowedFirstChars(last)
    .includes(first);
}

/* =========================================================
   단어 로딩
========================================================= */

function loadWords() {
  const file =
    findExistingFile(
      WORD_FILE_CANDIDATES
    );

  if (!file) {
    console.error(
      "ERROR: word.txt를 찾을 수 없습니다."
    );

    return;
  }

  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

  WORDS.clear();

  for (
    const line
    of text.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    /*
     * 첫 번째 필드를 단어로 사용.
     */
    const word =
      normalizeWord(
        trimmed.split(/\s+/)[0]
      );

    if (word) {
      WORDS.add(word);
    }
  }

  console.log(
    `단어 로딩: ${WORDS.size.toLocaleString()}개`
  );

  console.log(
    `word.txt: ${file}`
  );
}

/* =========================================================
   공격 단어 로딩
========================================================= */

function loadAttackWords() {
  const file =
    findExistingFile(
      ATTACK_FILE_CANDIDATES
    );

  if (!file) {
    console.warn(
      "WARNING: attack.txt를 찾을 수 없습니다."
    );

    return;
  }

  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

  for (
    const line
    of text.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    const parts =
      trimmed.split(/\s+/);

    const word =
      normalizeWord(parts[0]);

    const depth =
      Number(parts[1]);

    if (
      word &&
      Number.isFinite(depth)
    ) {
      ATTACK_DEPTH[word] =
        depth;
    }
  }

  console.log(
    `공격 단어 로딩: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
  );
}

/* =========================================================
   인덱스
========================================================= */

function buildWordIndex() {
  WORD_INDEX.clear();

  for (const word of WORDS) {
    const first =
      word.at(0);

    if (!first) {
      continue;
    }

    if (!WORD_INDEX.has(first)) {
      WORD_INDEX.set(
        first,
        []
      );
    }

    WORD_INDEX
      .get(first)
      .push(word);
  }

  console.log(
    `단어 인덱스 생성: ${WORD_INDEX.size}개 시작 글자`
  );
}

/* =========================================================
   초기화
========================================================= */

loadWords();
loadAttackWords();
buildWordIndex();

/* =========================================================
   단어 후보
========================================================= */

function getCandidates(
  previousWord,
  usedWords
) {
  previousWord =
    normalizeWord(previousWord);

  if (!previousWord) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  const result = [];

  const allowed =
    allowedFirstChars(
      previousWord.at(-1)
    );

  for (const first of allowed) {
    const bucket =
      WORD_INDEX.get(first);

    if (!bucket) {
      continue;
    }

    for (const word of bucket) {
      if (used.has(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}

/* =========================================================
   단어 검사
========================================================= */

function hasWord(word) {
  return WORDS.has(
    normalizeWord(word)
  );
}

function getAttackDepth(word) {
  const depth =
    ATTACK_DEPTH[word];

  return Number.isFinite(depth)
    ? depth
    : null;
}

/* =========================================================
   시작 단어 자동 선택
========================================================= */

function chooseStartWord(
  startChar,
  usedWords
) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set();

  let candidates = [];

  /*
   * 사용자가 시작 글자를 정한 경우.
   */
  if (startChar) {
    const allowed =
      allowedFirstChars(
        startChar
      );

    for (const first of allowed) {
      const bucket =
        WORD_INDEX.get(first);

      if (!bucket) {
        continue;
      }

      for (const word of bucket) {
        if (!used.has(word)) {
          candidates.push(word);
        }
      }
    }
  }

  /*
   * 시작 글자가 없다면 전체 단어에서 선택.
   */
  if (candidates.length === 0) {
    for (const word of WORDS) {
      if (!used.has(word)) {
        candidates.push(word);
      }

      /*
       * 무작위 시작을 위한 샘플 제한.
       */
      if (candidates.length >= 5000) {
        break;
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  /*
   * 시작하자마자 한방으로 끝나는 단어는
   * 가능한 한 피한다.
   */
  const safe = [];

  for (const word of candidates) {
    const next =
      getCandidates(
        word,
        used
      );

    if (next.length > 0) {
      safe.push(word);
    }
  }

  const pool =
    safe.length > 0
      ? safe
      : candidates;

  return pool[
    Math.floor(
      Math.random() * pool.length
    )
  ];
}

/* =========================================================
   방
========================================================= */

const ROOMS =
  new Map();

/* =========================================================
   방 ID
========================================================= */

function createRoomId() {
  let id;

  do {
    id =
      Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();
  } while (ROOMS.has(id));

  return id;
}

/* =========================================================
   플레이어
========================================================= */

function createPlayer({
  socketId,
  playerIndex,
  nickname,
  isBot = false
}) {
  return {
    socketId:
      socketId || null,

    playerIndex,

    nickname:
      nickname || `플레이어 ${playerIndex + 1}`,

    isBot,

    connected:
      !isBot,

    hearts:
      MAX_HEARTS,

    eliminated:
      false
  };
}

/* =========================================================
   방 생성
========================================================= */

function createRoom({
  socketId,
  nickname,
  startChar,
  mode,
  maxPlayers,
  aiLevel
}) {
  const roomId =
    createRoomId();

  const room = {
    id: roomId,

    mode:
      mode === "ai"
        ? "ai"
        : "online",

    maxPlayers:
      Math.min(
        MAX_PLAYERS,
        Math.max(
          2,
          Number(maxPlayers) || 2
        )
      ),

    aiLevel:
      Math.min(
        5,
        Math.max(
          1,
          Number(aiLevel) || 5
        )
      ),

    players: [],

    startChar:
      normalizeWord(startChar).at(0) || "",

    currentWord:
      null,

    turnPlayer:
      0,

    turnNumber:
      0,

    history: [],

    usedWords:
      new Set(),

    finished:
      false,

    started:
      false,

    winner:
      null,

    loser:
      null,

    turnStartedAt:
      null,

    turnEndsAt:
      null,

    timer:
      null
  };

  const firstPlayer =
    createPlayer({
      socketId,
      playerIndex: 0,
      nickname
    });

  room.players.push(
    firstPlayer
  );

  /*
   * AI 방이면 AI를 바로 추가.
   */
  if (room.mode === "ai") {
    room.players.push(
      createPlayer({
        playerIndex: 1,
        nickname:
          `AI Lv.${room.aiLevel}`,
        isBot: true
      })
    );
  }

  ROOMS.set(
    roomId,
    room
  );

  return room;
}

/* =========================================================
   공개 상태
========================================================= */

function getPublicRoomState(room) {
  if (!room) {
    return null;
  }

  return {
    roomId:
      room.id,

    mode:
      room.mode,

    maxPlayers:
      room.maxPlayers,

    aiLevel:
      room.aiLevel,

    startChar:
      room.startChar,

    currentWord:
      room.currentWord,

    turnPlayer:
      room.turnPlayer,

    turnNumber:
      room.turnNumber,

    history:
      room.history.map(item => ({
        word:
          item.word,

        player:
          item.player,

        turn:
          item.turn,

        depth:
          item.depth,

        timestamp:
          item.timestamp
      })),

    usedCount:
      room.usedWords.size,

    finished:
      room.finished,

    started:
      room.started,

    winner:
      room.winner,

    loser:
      room.loser,

    playerCount:
      room.players.length,

    turnStartedAt:
      room.turnStartedAt,

    turnEndsAt:
      room.turnEndsAt,

    turnTime:
      TURN_TIME,

    players:
      room.players.map(player => ({
        playerIndex:
          player.playerIndex,

        nickname:
          player.nickname,

        isBot:
          player.isBot,

        connected:
          player.connected,

        hearts:
          player.hearts,

        eliminated:
          player.eliminated
      }))
  };
}

/* =========================================================
   브로드캐스트
========================================================= */

function broadcastRoomState(room) {
  if (!room) {
    return;
  }

  io.to(room.id).emit(
    "game:state",
    getPublicRoomState(room)
  );
}

/* =========================================================
   소켓으로 방 찾기
========================================================= */

function findRoomBySocket(socketId) {
  for (const room of ROOMS.values()) {
    if (
      room.players.some(
        player =>
          player.socketId === socketId
      )
    ) {
      return room;
    }
  }

  return null;
}

/* =========================================================
   실제 플레이어
========================================================= */

function getPlayer(
  room,
  playerIndex
) {
  return room?.players.find(
    player =>
      player.playerIndex ===
      playerIndex
  ) || null;
}

/* =========================================================
   살아있는 플레이어
========================================================= */

function getAlivePlayers(room) {
  return room.players.filter(
    player =>
      !player.eliminated
  );
}

/* =========================================================
   승자 판정
========================================================= */

function finishGame(
  room,
  winnerIndex,
  loserIndex
) {
  if (!room || room.finished) {
    return;
  }

  room.finished = true;

  room.winner =
    winnerIndex;

  room.loser =
    loserIndex;

  stopTurnTimer(room);

  io.to(room.id).emit(
    "game:finished",
    {
      ok: true,

      winner:
        winnerIndex,

      loser:
        loserIndex,

      state:
        getPublicRoomState(room)
    }
  );

  broadcastRoomState(room);
}

/* =========================================================
   턴 플레이어 찾기
========================================================= */

function findNextAlivePlayer(
  room,
  currentIndex
) {
  if (!room.players.length) {
    return null;
  }

  const total =
    room.players.length;

  for (let i = 1; i <= total; i++) {
    const index =
      (currentIndex + i) % total;

    const player =
      room.players[index];

    if (
      player &&
      !player.eliminated
    ) {
      return player.playerIndex;
    }
  }

  return null;
}

/* =========================================================
   턴 타이머
========================================================= */

function stopTurnTimer(room) {
  if (!room) {
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  room.turnStartedAt = null;
  room.turnEndsAt = null;
}

function startTurnTimer(room) {
  if (!room || room.finished) {
    return;
  }

  stopTurnTimer(room);

  const player =
    getPlayer(
      room,
      room.turnPlayer
    );

  if (!player || player.eliminated) {
    return;
  }

  const now =
    Date.now();

  room.turnStartedAt =
    now;

  room.turnEndsAt =
    now +
    TURN_TIME * 1000;

  room.timer =
    setTimeout(() => {
      handleTurnTimeout(room);
    }, TURN_TIME * 1000);

  broadcastRoomState(room);

  /*
   * AI 차례면 AI 처리.
   */
  if (player.isBot) {
    setTimeout(() => {
      runAI(room);
    }, 300);
  }
}

/* =========================================================
   시간 초과
========================================================= */

function handleTurnTimeout(room) {
  if (!room || room.finished) {
    return;
  }

  const player =
    getPlayer(
      room,
      room.turnPlayer
    );

  if (!player || player.eliminated) {
    return;
  }

  player.hearts--;

  stopTurnTimer(room);

  io.to(room.id).emit(
    "game:timeout",
    {
      ok: true,

      player:
        player.playerIndex,

      hearts:
        player.hearts
    }
  );

  /*
   * 하트가 0이면 탈락.
   */
  if (player.hearts <= 0) {
    player.eliminated = true;

    const alive =
      getAlivePlayers(room);

    if (alive.length <= 1) {
      if (alive.length === 1) {
        finishGame(
          room,
          alive[0].playerIndex,
          player.playerIndex
        );
      } else {
        finishGame(
          room,
          null,
          player.playerIndex
        );
      }

      return;
    }

    /*
     * 다음 생존 플레이어로.
     */
    const next =
      findNextAlivePlayer(
        room,
        player.playerIndex
      );

    if (next === null) {
      finishGame(
        room,
        null,
        player.playerIndex
      );

      return;
    }

    room.turnPlayer =
      next;

    room.turnNumber++;

    broadcastRoomState(room);

    startTurnTimer(room);

    return;
  }

  /*
   * 하트가 남았으면 같은 플레이어가
   * 다시 기회를 얻는다.
   */
  room.turnNumber++;

  broadcastRoomState(room);

  startTurnTimer(room);
}

/* =========================================================
   단어 성공 후 다음 턴
========================================================= */

function advanceTurn(
  room,
  currentPlayerIndex
) {
  const next =
    findNextAlivePlayer(
      room,
      currentPlayerIndex
    );

  if (next === null) {
    finishGame(
      room,
      currentPlayerIndex,
      null
    );

    return;
  }

  room.turnPlayer =
    next;

  room.turnNumber++;

  startTurnTimer(room);
}

/* =========================================================
   게임 시작
========================================================= */

function startNewGame(room) {
  if (!room) {
    return {
      ok: false,
      reason:
        "방을 찾을 수 없습니다."
    };
  }

  const alive =
    getAlivePlayers(room);

  if (
    alive.length < 2
  ) {
    return {
      ok: false,
      reason:
        "게임을 시작하려면 최소 2명이 필요합니다."
    };
  }

  stopTurnTimer(room);

  room.currentWord = null;

  room.history = [];

  room.usedWords =
    new Set();

  room.finished = false;

  room.started = false;

  room.winner = null;

  room.loser = null;

  room.turnNumber = 0;

  room.turnPlayer =
    alive[0].playerIndex;

  /*
   * 하트 초기화.
   */
  for (const player of room.players) {
    player.hearts =
      MAX_HEARTS;

    player.eliminated =
      false;
  }

  /*
   * 시작 단어 자동 생성.
   */
  const startWord =
    chooseStartWord(
      room.startChar,
      room.usedWords
    );

  if (!startWord) {
    return {
      ok: false,
      reason:
        "시작할 수 있는 단어를 찾지 못했습니다."
    };
  }

  room.currentWord =
    startWord;

  room.usedWords.add(
    startWord
  );

  room.history.push({
    word:
      startWord,

    player:
      -1,

    turn:
      0,

    depth:
      getAttackDepth(startWord),

    timestamp:
      Date.now()
  });

  room.started = true;

  /*
   * 시작 단어를 전체에 알림.
   */
  io.to(room.id).emit(
    "game:started",
    {
      ok: true,

      startWord,

      state:
        getPublicRoomState(room)
    }
  );

  broadcastRoomState(room);

  startTurnTimer(room);

  return {
    ok: true
  };
}

/* =========================================================
   게임 자동 시작 조건
========================================================= */

function tryStartRoom(room) {
  if (!room || room.finished) {
    return;
  }

  const alive =
    getAlivePlayers(room);

  /*
   * AI 방은 생성 직후.
   * 온라인 방은 2명 이상이면 시작.
   */
  if (
    room.mode === "ai" ||
    alive.length >= 2
  ) {
    if (!room.started) {
      startNewGame(room);
    }
  }
}

/* =========================================================
   잘못된 단어 처리
========================================================= */

function handleInvalidWord(
  room,
  player,
  reason,
  allowed
) {
  if (!room || !player) {
    return;
  }

  /*
   * AI는 잘못된 단어를 제출하지 않는다.
   * 안전장치.
   */
  if (player.isBot) {
    return;
  }

  player.hearts--;

  const payload = {
    ok: false,

    reason,

    hearts:
      player.hearts,

    player:
      player.playerIndex
  };

  if (Array.isArray(allowed)) {
    payload.allowed =
      allowed;
  }

  playerError(
    player,
    "game:error",
    payload
  );

  io.to(room.id).emit(
    "game:mistake",
    {
      ok: true,

      player:
        player.playerIndex,

      hearts:
        player.hearts,

      reason
    }
  );

  /*
   * 실패해도 하트가 남아 있으면
   * 같은 턴에서 다시 입력 가능.
   */
  if (player.hearts <= 0) {
    player.eliminated =
      true;

    stopTurnTimer(room);

    const alive =
      getAlivePlayers(room);

    if (alive.length <= 1) {
      if (alive.length === 1) {
        finishGame(
          room,
          alive[0].playerIndex,
          player.playerIndex
        );
      } else {
        finishGame(
          room,
          null,
          player.playerIndex
        );
      }

      return;
    }

    const next =
      findNextAlivePlayer(
        room,
        player.playerIndex
      );

    if (next === null) {
      finishGame(
        room,
        null,
        player.playerIndex
      );

      return;
    }

    room.turnPlayer =
      next;

    room.turnNumber++;

    broadcastRoomState(room);

    startTurnTimer(room);

    return;
  }

  broadcastRoomState(room);
}

/* =========================================================
   개별 오류
========================================================= */

function playerError(
  player,
  event,
  data
) {
  if (
    player &&
    player.socketId
  ) {
    io.to(
      player.socketId
    ).emit(
      event,
      data
    );
  }
}

/* =========================================================
   단어 제출
========================================================= */

function playWord(
  room,
  player,
  rawWord
) {
  if (!room) {
    return {
      ok: false,
      reason:
        "방을 찾을 수 없습니다."
    };
  }

  if (room.finished) {
    return {
      ok: false,
      reason:
        "게임이 이미 끝났습니다."
    };
  }

  if (!room.started) {
    return {
      ok: false,
      reason:
        "게임이 아직 시작되지 않았습니다."
    };
  }

  if (!player) {
    return {
      ok: false,
      reason:
        "플레이어를 찾을 수 없습니다."
    };
  }

  if (player.eliminated) {
    return {
      ok: false,
      reason:
        "탈락한 플레이어입니다."
    };
  }

  if (
    room.turnPlayer !==
    player.playerIndex
  ) {
    return {
      ok: false,
      reason:
        "지금은 당신의 차례가 아닙니다."
    };
  }

  const word =
    normalizeWord(rawWord);

  if (!word) {
    handleInvalidWord(
      room,
      player,
      "단어를 입력해주세요."
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 실제 단어 목록.
   */
  if (!hasWord(word)) {
    handleInvalidWord(
      room,
      player,
      "단어 목록에 없는 단어입니다."
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 중복.
   */
  if (room.usedWords.has(word)) {
    handleInvalidWord(
      room,
      player,
      "이미 사용한 단어입니다."
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 연결.
   */
  if (
    room.currentWord &&
    !canConnect(
      room.currentWord,
      word
    )
  ) {
    const last =
      room.currentWord.at(-1);

    handleInvalidWord(
      room,
      player,
      `"${last}" 다음에 연결할 수 없는 단어입니다.`,
      allowedFirstChars(last)
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 성공.
   */
  stopTurnTimer(room);

  room.currentWord =
    word;

  room.usedWords.add(
    word
  );

  room.history.push({
    word,

    player:
      player.playerIndex,

    turn:
      room.history.length,

    depth:
      getAttackDepth(word),

    timestamp:
      Date.now()
  });

  const next =
    getCandidates(
      word,
      room.usedWords
    );

  /*
   * 더 이상 단어가 없으면
   * 방금 단어를 낸 사람이 승리.
   */
  if (next.length === 0) {
    finishGame(
      room,
      player.playerIndex,
      findNextAlivePlayer(
        room,
        player.playerIndex
      )
    );

    io.to(room.id).emit(
      "game:word",
      {
        ok: true,

        word,

        player:
          player.playerIndex,

        depth:
          getAttackDepth(word),

        nextCount:
          0,

        finished:
          true,

        winner:
          room.winner,

        loser:
          room.loser
      }
    );

    return {
      ok: true,
      finished: true
    };
  }

  io.to(room.id).emit(
    "game:word",
    {
      ok: true,

      word,

      player:
        player.playerIndex,

      depth:
        getAttackDepth(word),

      nextCount:
        next.length,

      finished:
        false,

      winner:
        null,

      loser:
        null
    }
  );

  /*
   * 다음 생존 플레이어.
   */
  const nextPlayer =
    findNextAlivePlayer(
      room,
      player.playerIndex
    );

  if (nextPlayer === null) {
    finishGame(
      room,
      player.playerIndex,
      null
    );

    return {
      ok: true,
      finished: true
    };
  }

  room.turnPlayer =
    nextPlayer;

  room.turnNumber++;

  broadcastRoomState(room);

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
  word
) {
  const next =
    getCandidates(
      word,
      new Set([
        ...room.usedWords,
        word
      ])
    );

  const depth =
    getAttackDepth(word);

  let score =
    Math.random() * 10;

  /*
   * 공격 단어 우선.
   */
  if (depth !== null) {
    score +=
      depth * 20;
  }

  /*
   * 바로 상대를 끝낼 수 있는 단어.
   */
  if (next.length === 0) {
    score += 100000;
  }

  /*
   * 선택지가 적은 단어도 공격적.
   */
  if (next.length > 0) {
    score +=
      Math.max(
        0,
        100 - next.length
      );
  }

  /*
   * 너무 많은 선택지를 남기는 것은 약간 감점.
   */
  score -=
    Math.min(
      next.length,
      100
    ) * 0.15;

  return score;
}

function chooseAIWord(room) {
  const candidates =
    getCandidates(
      room.currentWord,
      room.usedWords
    );

  if (!candidates.length) {
    return null;
  }

  /*
   * AI 레벨별 후보 샘플.
   */
  let sampleSize;

  switch (room.aiLevel) {
    case 1:
      sampleSize = 30;
      break;

    case 2:
      sampleSize = 80;
      break;

    case 3:
      sampleSize = 200;
      break;

    case 4:
      sampleSize = 500;
      break;

    default:
      sampleSize = 1000;
      break;
  }

  const shuffled =
    candidates
      .slice()
      .sort(
        () =>
          Math.random() - 0.5
      )
      .slice(
        0,
        Math.min(
          sampleSize,
          candidates.length
        )
      );

  /*
   * Lv1은 공격 단어를 과도하게
   * 사용하지 않도록 랜덤성이 큼.
   */
  if (room.aiLevel === 1) {
    return shuffled[
      Math.floor(
        Math.random() *
        shuffled.length
      )
    ];
  }

  const scored =
    shuffled.map(word => ({
      word,
      score:
        scoreAIWord(
          room,
          word
        )
    }));

  scored.sort(
    (a, b) =>
      b.score - a.score
  );

  /*
   * Lv2~4도 무조건 1등만 선택하지 않고
   * 상위 후보에서 선택.
   */
  let poolSize;

  if (room.aiLevel === 2) {
    poolSize = 8;
  } else if (room.aiLevel === 3) {
    poolSize = 4;
  } else if (room.aiLevel === 4) {
    poolSize = 2;
  } else {
    poolSize = 1;
  }

  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );

  return pool[
    Math.floor(
      Math.random() *
      pool.length
    )
  ].word;
}

/* =========================================================
   AI 실행
========================================================= */

function runAI(room) {
  if (
    !room ||
    room.finished ||
    !room.started
  ) {
    return;
  }

  const player =
    getPlayer(
      room,
      room.turnPlayer
    );

  if (
    !player ||
    !player.isBot ||
    player.eliminated
  ) {
    return;
  }

  const word =
    chooseAIWord(room);

  if (!word) {
    finishGame(
      room,
      player.playerIndex,
      findNextAlivePlayer(
        room,
        player.playerIndex
      )
    );

    return;
  }

  playWord(
    room,
    player,
    word
  );
}

/* =========================================================
   방 참가
========================================================= */

function joinRoom(
  room,
  socketId,
  nickname
) {
  if (!room) {
    return {
      ok: false,
      reason:
        "방을 찾을 수 없습니다."
    };
  }

  if (room.mode !== "online") {
    return {
      ok: false,
      reason:
        "이 방은 AI 모드입니다."
    };
  }

  if (
    room.players.length >=
    room.maxPlayers
  ) {
    return {
      ok: false,
      reason:
        "방이 가득 찼습니다."
    };
  }

  /*
   * 이미 같은 소켓이 있다면
   * 재입장 취급.
   */
  const existing =
    room.players.find(
      player =>
        player.socketId === socketId
    );

  if (existing) {
    existing.connected = true;

    return {
      ok: true,
      playerIndex:
        existing.playerIndex,
      reconnect: true
    };
  }

  /*
   * 빈 playerIndex 사용.
   */
  let playerIndex = 0;

  while (
    room.players.some(
      player =>
        player.playerIndex ===
        playerIndex
    )
  ) {
    playerIndex++;
  }

  const player =
    createPlayer({
      socketId,
      playerIndex,
      nickname
    });

  room.players.push(
    player
  );

  return {
    ok: true,
    playerIndex
  };
}

/* =========================================================
   방 나가기
========================================================= */

function removePlayer(
  room,
  socketId,
  reason = "leave"
) {
  if (!room) {
    return null;
  }

  const index =
    room.players.findIndex(
      player =>
        player.socketId === socketId
    );

  if (index === -1) {
    return null;
  }

  const player =
    room.players[index];

  /*
   * AI는 삭제 금지.
   */
  if (player.isBot) {
    return null;
  }

  room.players.splice(
    index,
    1
  );

  /*
   * 게임 중이었다면 퇴장 플레이어 탈락.
   */
  if (
    room.started &&
    !room.finished
  ) {
    player.eliminated = true;

    const alive =
      getAlivePlayers(room);

    if (alive.length <= 1) {
      if (alive.length === 1) {
        finishGame(
          room,
          alive[0].playerIndex,
          player.playerIndex
        );
      }

      return player;
    }

    if (
      room.turnPlayer ===
      player.playerIndex
    ) {
      stopTurnTimer(room);

      const next =
        findNextAlivePlayer(
          room,
          player.playerIndex
        );

      if (next !== null) {
        room.turnPlayer =
          next;

        room.turnNumber++;

        startTurnTimer(room);
      }
    }
  }

  return player;
}

/* =========================================================
   Socket.IO
========================================================= */

io.on(
  "connection",
  socket => {
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
          ).length,

        maxPlayers:
          MAX_PLAYERS,

        turnTime:
          TURN_TIME,

        maxHearts:
          MAX_HEARTS
      }
    );

    /* =====================================================
       방 생성
    ===================================================== */

    socket.on(
      "room:create",
      data => {
        try {
          const nickname =
            normalizeWord(
              data?.nickname
            ) ||
            "플레이어";

          const startChar =
            normalizeWord(
              data?.startChar
            ).at(0) || "";

          const mode =
            data?.mode === "ai"
              ? "ai"
              : "online";

          const maxPlayers =
            mode === "ai"
              ? 2
              : Math.min(
                  MAX_PLAYERS,
                  Math.max(
                    2,
                    Number(
                      data?.maxPlayers
                    ) || 2
                  )
                );

          const aiLevel =
            Math.min(
              5,
              Math.max(
                1,
                Number(
                  data?.aiLevel
                ) || 5
              )
            );

          /*
           * 기존 방 제거.
           */
          const oldRoom =
            findRoomBySocket(
              socket.id
            );

          if (oldRoom) {
            socket.leave(
              oldRoom.id
            );

            removePlayer(
              oldRoom,
              socket.id,
              "recreate"
            );

            broadcastRoomState(
              oldRoom
            );
          }

          const room =
            createRoom({
              socketId:
                socket.id,

              nickname,

              startChar,

              mode,

              maxPlayers,

              aiLevel
            });

          socket.join(
            room.id
          );

          socket.data.roomId =
            room.id;

          socket.data.playerIndex =
            0;

          socket.emit(
            "room:created",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex:
                0,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          /*
           * AI 방은 즉시 시작.
           */
          if (room.mode === "ai") {
            tryStartRoom(room);
          }

          broadcastRoomState(room);

          console.log(
            `[ROOM CREATE] ${room.id} / ${socket.id} / ${room.mode}`
          );
        } catch (error) {
          console.error(
            "room:create 오류:",
            error
          );

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

    /* =====================================================
       방 입장
    ===================================================== */

    socket.on(
      "room:join",
      data => {
        try {
          const roomId =
            String(
              data?.roomId || ""
            )
              .trim()
              .toUpperCase();

          const nickname =
            normalizeWord(
              data?.nickname
            ) ||
            "플레이어";

          if (!roomId) {
            socket.emit(
              "room:error",
              {
                ok: false,

                reason:
                  "방 코드를 입력해주세요."
              }
            );

            return;
          }

          const room =
            ROOMS.get(roomId);

          const result =
            joinRoom(
              room,
              socket.id,
              nickname
            );

          if (!result.ok) {
            socket.emit(
              "room:error",
              result
            );

            return;
          }

          socket.join(
            room.id
          );

          socket.data.roomId =
            room.id;

          socket.data.playerIndex =
            result.playerIndex;

          socket.emit(
            "room:joined",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex:
                result.playerIndex,

              reconnect:
                !!result.reconnect,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          io.to(room.id).emit(
            "room:playerJoined",
            {
              ok: true,

              playerIndex:
                result.playerIndex,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          tryStartRoom(room);

          broadcastRoomState(room);

          console.log(
            `[ROOM JOIN] ${room.id} / ${socket.id} / player ${result.playerIndex}`
          );
        } catch (error) {
          console.error(
            "room:join 오류:",
            error
          );

          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "방에 입장하지 못했습니다."
            }
          );
        }
      }
    );

    /* =====================================================
       상태 요청
    ===================================================== */

    socket.on(
      "room:state",
      () => {
        const room =
          findRoomBySocket(
            socket.id
          );

        if (!room) {
          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "현재 참여 중인 방이 없습니다."
            }
          );

          return;
        }

        socket.emit(
          "game:state",
          getPublicRoomState(room)
        );
      }
    );

    /* =====================================================
       단어
    ===================================================== */

    socket.on(
      "game:word",
      data => {
        try {
          const room =
            findRoomBySocket(
              socket.id
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
            room.players.find(
              p =>
                p.socketId ===
                socket.id
            );

          if (!player) {
            socket.emit(
              "game:error",
              {
                ok: false,

                reason:
                  "플레이어를 찾을 수 없습니다."
              }
            );

            return;
          }

          const word =
            data?.word ??
            data?.inputWord ??
            "";

          playWord(
            room,
            player,
            word
          );
        } catch (error) {
          console.error(
            "game:word 오류:",
            error
          );

          socket.emit(
            "game:error",
            {
              ok: false,

              reason:
                "단어 처리 중 오류가 발생했습니다."
            }
          );
        }
      }
    );

    /* =====================================================
       game:submit
       이전 클라이언트 호환
    ===================================================== */

    socket.on(
      "game:submit",
      data => {
        const room =
          findRoomBySocket(
            socket.id
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
          room.players.find(
            p =>
              p.socketId ===
              socket.id
          );

        if (!player) {
          return;
        }

        playWord(
          room,
          player,
          data?.word ??
            data?.inputWord ??
            ""
        );
      }
    );

    /* =====================================================
       새 게임
    ===================================================== */

    socket.on(
      "game:restart",
      data => {
        const room =
          findRoomBySocket(
            socket.id
          );

        if (!room) {
          socket.emit(
            "game:error",
            {
              ok: false,

              reason:
                "방에 참여하지 않았습니다."
            }
          );

          return;
        }

        /*
         * 시작 글자를 새로 지정할 수 있음.
         */
        const requested =
          normalizeWord(
            data?.startChar
          ).at(0);

        if (requested) {
          room.startChar =
            requested;
        }

        /*
         * 온라인 방은 최소 2명.
         */
        if (
          room.mode === "online" &&
          getAlivePlayers(room).length < 2
        ) {
          socket.emit(
            "game:error",
            {
              ok: false,

              reason:
                "새 게임을 시작하려면 최소 2명이 필요합니다."
            }
          );

          return;
        }

        const result =
          startNewGame(room);

        if (!result.ok) {
          socket.emit(
            "game:error",
            result
          );

          return;
        }

        console.log(
          `[GAME RESTART] ${room.id}`
        );
      }
    );

    /* =====================================================
       방 나가기
    ===================================================== */

    socket.on(
      "room:leave",
      () => {
        const room =
          findRoomBySocket(
            socket.id
          );

        if (!room) {
          socket.emit(
            "room:left",
            {
              ok: true
            }
          );

          return;
        }

        const player =
          removePlayer(
            room,
            socket.id,
            "leave"
          );

        socket.leave(
          room.id
        );

        socket.data.roomId =
          null;

        socket.data.playerIndex =
          null;

        socket.emit(
          "room:left",
          {
            ok: true
          }
        );

        if (player) {
          io.to(room.id).emit(
            "room:playerLeft",
            {
              ok: true,

              playerIndex:
                player.playerIndex,

              reason:
                "상대방이 방을 나갔습니다.",

              state:
                getPublicRoomState(room)
            }
          );
        }

        broadcastRoomState(room);

        /*
         * 사람이 하나도 없으면 방 삭제.
         */
        const realPlayers =
          room.players.filter(
            p => !p.isBot
          );

        if (
          realPlayers.length === 0
        ) {
          stopTurnTimer(room);
          ROOMS.delete(room.id);
        }
      }
    );

    /* =====================================================
       재접속
    ===================================================== */

    socket.on(
      "room:reconnect",
      data => {
        const roomId =
          String(
            data?.roomId || ""
          )
            .trim()
            .toUpperCase();

        const room =
          ROOMS.get(roomId);

        if (!room) {
          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "재접속할 방을 찾을 수 없습니다."
            }
          );

          return;
        }

        const playerIndex =
          Number(
            data?.playerIndex
          );

        const player =
          getPlayer(
            room,
            playerIndex
          );

        if (
          !player ||
          player.isBot
        ) {
          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "재접속할 플레이어를 찾을 수 없습니다."
            }
          );

          return;
        }

        player.socketId =
          socket.id;

        player.connected =
          true;

        socket.join(
          room.id
        );

        socket.data.roomId =
          room.id;

        socket.data.playerIndex =
          playerIndex;

        socket.emit(
          "room:reconnected",
          {
            ok: true,

            roomId:
              room.id,

            playerIndex,

            state:
              getPublicRoomState(room)
          }
        );

        broadcastRoomState(room);

        /*
         * 턴이 끊겨 있었다면 타이머 재설정.
         */
        if (
          room.started &&
          !room.finished &&
          room.turnEndsAt
        ) {
          const remaining =
            room.turnEndsAt -
            Date.now();

          if (remaining <= 0) {
            handleTurnTimeout(room);
          } else {
            if (room.timer) {
              clearTimeout(room.timer);
            }

            room.timer =
              setTimeout(
                () => {
                  handleTurnTimeout(room);
                },
                remaining
              );
          }
        }
      }
    );

    /* =====================================================
       연결 종료
    ===================================================== */

    socket.on(
      "disconnect",
      reason => {
        const room =
          findRoomBySocket(
            socket.id
          );

        if (room) {
          const player =
            room.players.find(
              p =>
                p.socketId ===
                socket.id
            );

          if (player) {
            /*
             * 즉시 삭제하지 않고
             * disconnected 상태로 유지.
             *
             * 재접속 가능.
             */
            player.connected =
              false;

            player.socketId =
              socket.id;

            io.to(room.id).emit(
              "room:playerDisconnected",
              {
                ok: true,

                playerIndex:
                  player.playerIndex,

                reason:
                  "플레이어의 연결이 끊어졌습니다.",

                state:
                  getPublicRoomState(room)
              }
            );

            broadcastRoomState(room);
          }
        }

        console.log(
          `[DISCONNECT] ${socket.id} / ${reason}`
        );
      }
    );
  }
);

/* =========================================================
   HTTP API
========================================================= */

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
        ROOMS.size,

      maxPlayers:
        MAX_PLAYERS,

      turnTime:
        TURN_TIME,

      maxHearts:
        MAX_HEARTS,

      uptime:
        process.uptime()
    });
  }
);

app.get(
  "/api/words",
  (req, res) => {
    res.json({
      count:
        WORDS.size
    });
  }
);

app.get(
  "/api/attack",
  (req, res) => {
    res.json({
      count:
        Object.keys(
          ATTACK_DEPTH
        ).length
    });
  }
);

/* =========================================================
   루트
========================================================= */

/*
 * Cannot GET / 방지.
 *
 * index.html 위치를 여러 군데 확인.
 */
app.get(
  "/",
  (req, res) => {
    const candidates = [
      path.join(
        ROOT_DIR,
        "index.html"
      ),

      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    ];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        return res.sendFile(file);
      }
    }

    res.status(404).send(
      `
      <!doctype html>
      <html lang="ko">
      <head>
        <meta charset="utf-8">
        <title>끝말잇기 서버</title>
      </head>
      <body>
        <h1>끝말잇기 서버는 정상적으로 실행 중입니다.</h1>
        <p>index.html 파일을 찾을 수 없습니다.</p>
      </body>
      </html>
      `
    );
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
      `MAX PLAYERS: ${MAX_PLAYERS}`
    );

    console.log(
      `TURN TIME: ${TURN_TIME}s`
    );

    console.log(
      `HEARTS: ${MAX_HEARTS}`
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
    `${signal} 수신. 서버 종료 중...`
  );

  for (const room of ROOMS.values()) {
    stopTurnTimer(room);
  }

  server.close(() => {
    console.log(
      "서버가 종료되었습니다."
    );

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
