"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

/* =========================================================
   기본 서버
========================================================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

/* =========================================================
   경로
========================================================= */

const ROOT_DIR = path.join(__dirname, "..");
const CLIENT_DIR = path.join(ROOT_DIR, "client");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");

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
   HTTP
========================================================= */

app.use(express.json());

/*
 * /client
 * /public
 * 프로젝트 루트
 */
app.use(express.static(CLIENT_DIR));
app.use(express.static(PUBLIC_DIR));
app.use(express.static(ROOT_DIR));

/*
 * Cannot GET /
 * 방지
 */
app.get("/", (req, res) => {
  const indexFile = path.join(CLIENT_DIR, "index.html");

  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }

  res.status(404).send(
    "client/index.html 파일을 찾을 수 없습니다."
  );
});

/* =========================================================
   데이터
========================================================= */

const WORDS = new Set();
const ATTACK_DEPTH = Object.create(null);

const WORD_INDEX = new Map();

/* =========================================================
   두음법칙
========================================================= */

const DEFAULT_DUEUM = {
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
   정규화
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

/* =========================================================
   두음 허용 글자
========================================================= */

function allowedFirstChars(lastChar) {
  lastChar = normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result = new Set();

  result.add(lastChar);

  const direct = DEFAULT_DUEUM[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      result.add(char);
    }
  }

  for (const [from, values] of Object.entries(DEFAULT_DUEUM)) {
    if (!Array.isArray(values)) {
      continue;
    }

    if (values.includes(lastChar)) {
      result.add(from);
    }
  }

  return [...result];
}

/* =========================================================
   연결 판정
========================================================= */

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
   파일 찾기
========================================================= */

function findExistingFile(files) {
  for (const file of files) {
    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}

/* =========================================================
   word.txt
========================================================= */

function loadWords() {
  const file = findExistingFile(
    WORD_FILE_CANDIDATES
  );

  if (!file) {
    console.error(
      "[DATA] word.txt를 찾을 수 없습니다."
    );
    return;
  }

  const text = fs.readFileSync(
    file,
    "utf8"
  );

  WORDS.clear();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const word = normalizeWord(
      trimmed.split(/\s+/)[0]
    );

    if (word) {
      WORDS.add(word);
    }
  }

  console.log(
    `[DATA] 단어 ${WORDS.size.toLocaleString()}개 로딩`
  );

  console.log(
    `[DATA] ${file}`
  );
}

/* =========================================================
   attack.txt
========================================================= */

function loadAttackWords() {
  const file = findExistingFile(
    ATTACK_FILE_CANDIDATES
  );

  if (!file) {
    console.warn(
      "[DATA] attack.txt를 찾을 수 없습니다."
    );
    return;
  }

  const text = fs.readFileSync(
    file,
    "utf8"
  );

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split(/\s+/);

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
    `[DATA] 공격 단어 ${Object.keys(
      ATTACK_DEPTH
    ).length.toLocaleString()}개 로딩`
  );
}

/* =========================================================
   인덱스
========================================================= */

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
    `[DATA] 시작 글자 인덱스 ${WORD_INDEX.size}개 생성`
  );
}

/* =========================================================
   초기화
========================================================= */

loadWords();
loadAttackWords();
buildWordIndex();

/* =========================================================
   단어 검사
========================================================= */

function hasWord(word) {
  return WORDS.has(
    normalizeWord(word)
  );
}

/* =========================================================
   후보 검색
========================================================= */

function getCandidates(previousWord, usedWords) {
  previousWord = normalizeWord(previousWord);

  if (!previousWord) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const allowed = allowedFirstChars(
    previousWord.at(-1)
  );

  const result = [];

  for (const firstChar of allowed) {
    const bucket =
      WORD_INDEX.get(firstChar);

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

/* =========================================================
   안전한 시작 단어
========================================================= */

function isUsableStartWord(word) {
  if (!WORDS.has(word)) {
    return false;
  }

  /*
   * 공격 단어의 깊이가 있는 단어라도
   * 시작 단어에서는 일단 사용할 수 있다.
   *
   * 단, 바로 게임이 끝나는 단어는 제외.
   */
  const next = getCandidates(
    word,
    new Set([word])
  );

  return next.length > 0;
}

/* =========================================================
   시작 단어 자동 선택
========================================================= */

function chooseStartWord() {
  /*
   * 충분히 랜덤하게 후보를 뽑되
   * 실제로 다음 단어가 존재하는 것만 사용한다.
   */

  const words = [...WORDS];

  if (words.length === 0) {
    return "";
  }

  for (let i = 0; i < 500; i++) {
    const word =
      words[
        Math.floor(
          Math.random() * words.length
        )
      ];

    if (isUsableStartWord(word)) {
      return word;
    }
  }

  /*
   * 랜덤 탐색 실패 시 전체 검사
   */
  for (const word of words) {
    if (isUsableStartWord(word)) {
      return word;
    }
  }

  return "";
}

/* =========================================================
   AI
========================================================= */

function getAttackDepth(word) {
  const depth = ATTACK_DEPTH[word];

  return Number.isFinite(depth)
    ? depth
    : null;
}

function analyzeCandidate(
  word,
  usedWords
) {
  const next = getCandidates(
    word,
    new Set([
      ...usedWords,
      word
    ])
  );

  return {
    word,
    nextCount: next.length,
    depth: getAttackDepth(word),
    oneShot: next.length === 0
  };
}

/*
 * AI의 핵심 선택
 *
 * Lv1:
 *   랜덤에 가까움
 *
 * Lv2:
 *   선택지가 많은 단어 선호
 *
 * Lv3:
 *   공격 단어 일부 사용
 *
 * Lv4:
 *   깊은 공격 단어 우선
 *
 * Lv5:
 *   상대 선택지를 최대한 줄임
 */
function chooseAIWord(room, playerIndex) {
  const candidates = getCandidates(
    room.currentWord,
    room.usedWords
  );

  if (candidates.length === 0) {
    return null;
  }

  const level =
    Math.max(
      1,
      Math.min(
        5,
        Number(room.aiLevel) || 1
      )
    );

  const analyzed =
    candidates.map(word =>
      analyzeCandidate(
        word,
        room.usedWords
      )
    );

  /*
   * 즉시 끝내는 단어
   */
  const winning =
    analyzed.filter(
      item => item.oneShot
    );

  /*
   * AI가 이길 수 있으면
   * 높은 레벨에서는 우선 사용.
   */
  if (
    winning.length > 0 &&
    level >= 4
  ) {
    return winning[
      Math.floor(
        Math.random() *
        winning.length
      )
    ].word;
  }

  /*
   * 점수 계산
   */
  const scored = analyzed.map(item => {
    let score = 0;

    /*
     * 선택지가 적을수록 상대에게 유리한 공격
     */
    score +=
      (100000 -
        Math.min(
          item.nextCount,
          100000
        )) *
      level;

    /*
     * 공격 깊이
     */
    if (item.depth !== null) {
      score +=
        item.depth *
        1000 *
        level;
    }

    /*
     * 즉사 단어
     */
    if (item.oneShot) {
      score +=
        level >= 4
          ? 100000000
          : -50000;
    }

    /*
     * 낮은 레벨은 너무 완벽하게 하지 않는다.
     */
    score +=
      Math.random() *
      (6 - level) *
      1000000;

    return {
      ...item,
      score
    };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score
  );

  /*
   * Lv1~2:
   * 상위 여러 개 중 랜덤
   *
   * Lv3~5:
   * 상위 후보를 좁게 선택
   */
  let poolSize;

  if (level === 1) {
    poolSize = Math.min(
      20,
      scored.length
    );
  } else if (level === 2) {
    poolSize = Math.min(
      12,
      scored.length
    );
  } else if (level === 3) {
    poolSize = Math.min(
      7,
      scored.length
    );
  } else if (level === 4) {
    poolSize = Math.min(
      3,
      scored.length
    );
  } else {
    poolSize = 1;
  }

  return scored[
    Math.floor(
      Math.random() * poolSize
    )
  ].word;
}

/* =========================================================
   방
========================================================= */

const ROOMS = new Map();

/*
room = {
  id,
  maxPlayers,
  mode,
  aiLevel,

  players: [
    {
      socketId,
      playerIndex,
      nickname,
      connected
    }
  ],

  currentWord,
  startWord,
  turnPlayer,

  history,
  usedWords,

  finished,
  winner,
  loser,

  version
}
*/

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
   방 공개 상태
========================================================= */

function getPublicRoomState(room) {
  if (!room) {
    return null;
  }

  return {
    roomId: room.id,

    maxPlayers:
      room.maxPlayers,

    mode:
      room.mode,

    aiLevel:
      room.aiLevel,

    currentWord:
      room.currentWord,

    startWord:
      room.startWord,

    turnPlayer:
      room.turnPlayer,

    history:
      room.history.map(item => ({
        word: item.word,
        player: item.player,
        turn: item.turn,
        depth: item.depth,
        nickname: item.nickname
      })),

    finished:
      room.finished,

    winner:
      room.winner,

    loser:
      room.loser,

    playerCount:
      room.players.length,

    players:
      room.players.map(player => ({
        playerIndex:
          player.playerIndex,

        nickname:
          player.nickname,

        connected:
          player.connected,

        isAI:
          Boolean(player.isAI)
      }))
  };
}

/* =========================================================
   상태 전송
========================================================= */

function broadcastState(room) {
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
   방 생성
========================================================= */

function createRoom({
  socketId,
  nickname,
  maxPlayers = 2,
  mode = "online",
  aiLevel = 3
}) {
  const id = createRoomId();

  maxPlayers = Math.max(
    2,
    Math.min(
      20,
      Number(maxPlayers) || 2
    )
  );

  mode =
    mode === "ai"
      ? "ai"
      : "online";

  const room = {
    id,

    maxPlayers,

    mode,

    aiLevel:
      Math.max(
        1,
        Math.min(
          5,
          Number(aiLevel) || 3
        )
      ),

    players: [
      {
        socketId,
        playerIndex: 0,
        nickname:
          normalizeWord(
            nickname
          ) || "플레이어",
        connected: true,
        isAI: false
      }
    ],

    currentWord: null,
    startWord: null,

    /*
     * 시작 단어 이후
     * 0번 플레이어가 시작
     */
    turnPlayer: 0,

    history: [],
    usedWords: new Set(),

    finished: false,

    winner: null,
    loser: null,

    version: 0
  };

  ROOMS.set(id, room);

  return room;
}

/* =========================================================
   AI 플레이어 추가
========================================================= */

function addAIPlayer(room) {
  if (!room || room.mode !== "ai") {
    return;
  }

  if (
    room.players.some(
      player => player.isAI
    )
  ) {
    return;
  }

  room.players.push({
    socketId: null,
    playerIndex: 1,
    nickname:
      `AI Lv.${room.aiLevel}`,
    connected: true,
    isAI: true
  });
}

/* =========================================================
   게임 초기화
========================================================= */

function resetGame(room) {
  if (!room) {
    return {
      ok: false,
      reason:
        "방을 찾을 수 없습니다."
    };
  }

  if (
    room.mode === "online" &&
    room.players.length < 2
  ) {
    return {
      ok: false,
      reason:
        "게임을 시작하려면 최소 2명이 필요합니다."
    };
  }

  if (
    room.mode === "ai" &&
    room.players.length < 2
  ) {
    addAIPlayer(room);
  }

  const startWord =
    chooseStartWord();

  if (!startWord) {
    return {
      ok: false,
      reason:
        "사용할 수 있는 시작 단어를 찾지 못했습니다."
    };
  }

  room.currentWord =
    startWord;

  room.startWord =
    startWord;

  room.usedWords =
    new Set([startWord]);

  room.history = [
    {
      word: startWord,
      player: -1,
      turn: 0,
      depth:
        getAttackDepth(
          startWord
        ),
      nickname: "시작 단어"
    }
  ];

  room.turnPlayer = 0;

  room.finished = false;

  room.winner = null;
  room.loser = null;

  room.version++;

  return {
    ok: true,
    startWord
  };
}

/* =========================================================
   다음 플레이어
========================================================= */

function getNextPlayer(room, currentPlayer) {
  if (!room || room.players.length === 0) {
    return null;
  }

  const count =
    room.players.length;

  for (let i = 1; i <= count; i++) {
    const next =
      (currentPlayer + i) %
      count;

    const player =
      room.players.find(
        p =>
          p.playerIndex === next
      );

    if (
      player &&
      player.connected
    ) {
      return next;
    }
  }

  return null;
}

/* =========================================================
   게임 종료
========================================================= */

function finishIfNoMove(room, lastPlayer) {
  const next =
    getCandidates(
      room.currentWord,
      room.usedWords
    );

  if (next.length > 0) {
    return false;
  }

  room.finished = true;

  room.winner =
    lastPlayer;

  room.loser =
    getNextPlayer(
      room,
      lastPlayer
    );

  return true;
}

/* =========================================================
   단어 플레이
========================================================= */

function playWord(
  room,
  playerIndex,
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
        "이미 끝난 게임입니다."
    };
  }

  const player =
    room.players.find(
      p =>
        p.playerIndex ===
        playerIndex
    );

  if (!player) {
    return {
      ok: false,
      reason:
        "플레이어를 찾을 수 없습니다."
    };
  }

  if (!player.connected) {
    return {
      ok: false,
      reason:
        "연결되지 않은 플레이어입니다."
    };
  }

  if (
    room.turnPlayer !==
    playerIndex
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
    return {
      ok: false,
      reason:
        "단어를 입력해주세요."
    };
  }

  if (!hasWord(word)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }

  if (room.usedWords.has(word)) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }

  if (!canConnect(
    room.currentWord,
    word
  )) {
    const last =
      room.currentWord.at(-1);

    return {
      ok: false,

      reason:
        `"${last}" 다음에 연결할 수 없는 단어입니다.`,

      allowed:
        allowedFirstChars(last)
    };
  }

  room.currentWord =
    word;

  room.usedWords.add(word);

  const depth =
    getAttackDepth(word);

  room.history.push({
    word,

    player:
      playerIndex,

    turn:
      room.history.length,

    depth,

    nickname:
      player.nickname
  });

  const ended =
    finishIfNoMove(
      room,
      playerIndex
    );

  if (!ended) {
    const nextPlayer =
      getNextPlayer(
        room,
        playerIndex
      );

    if (nextPlayer === null) {
      room.finished = true;
      room.winner = playerIndex;
      room.loser = null;
    } else {
      room.turnPlayer =
        nextPlayer;
    }
  }

  room.version++;

  return {
    ok: true,

    word,

    player:
      playerIndex,

    depth,

    finished:
      room.finished,

    winner:
      room.winner,

    loser:
      room.loser,

    nextTurn:
      room.turnPlayer,

    nextCount:
      room.finished
        ? 0
        : getCandidates(
            word,
            room.usedWords
          ).length
  };
}

/* =========================================================
   AI 턴
========================================================= */

function runAITurn(room) {
  if (!room) {
    return;
  }

  if (room.mode !== "ai") {
    return;
  }

  if (room.finished) {
    return;
  }

  const ai =
    room.players.find(
      player => player.isAI
    );

  if (!ai) {
    return;
  }

  if (
    room.turnPlayer !==
    ai.playerIndex
  ) {
    return;
  }

  const word =
    chooseAIWord(
      room,
      ai.playerIndex
    );

  if (!word) {
    /*
     * AI가 낼 단어가 없으면
     * 직전 플레이어 승리
     */
    room.finished = true;

    room.winner =
      getNextPlayer(
        room,
        ai.playerIndex
      );

    room.loser =
      ai.playerIndex;

    broadcastState(room);

    io.to(room.id).emit(
      "game:finished",
      {
        ok: true,
        winner: room.winner,
        loser: room.loser,
        state:
          getPublicRoomState(
            room
          )
      }
    );

    return;
  }

  const result =
    playWord(
      room,
      ai.playerIndex,
      word
    );

  if (!result.ok) {
    console.error(
      "[AI ERROR]",
      result
    );

    return;
  }

  io.to(room.id).emit(
    "game:word",
    result
  );

  broadcastState(room);

  if (room.finished) {
    io.to(room.id).emit(
      "game:finished",
      {
        ok: true,

        winner:
          room.winner,

        loser:
          room.loser,

        state:
          getPublicRoomState(
            room
          )
      }
    );

    return;
  }

  /*
   * AI 연속 호출 방지
   */
  if (
    room.turnPlayer ===
    ai.playerIndex
  ) {
    setTimeout(
      () => runAITurn(room),
      350
    );
  }
}

/* =========================================================
   게임 시작
========================================================= */

function startGame(room) {
  const result =
    resetGame(room);

  if (!result.ok) {
    return result;
  }

  broadcastState(room);

  io.to(room.id).emit(
    "game:started",
    {
      ok: true,

      startWord:
        room.startWord,

      state:
        getPublicRoomState(
          room
        )
    }
  );

  /*
   * 시작 단어 이후
   * AI가 첫 턴이면 실행
   */
  if (
    room.mode === "ai" &&
    room.turnPlayer === 1
  ) {
    setTimeout(
      () => runAITurn(room),
      500
    );
  }

  return {
    ok: true
  };
}

/* =========================================================
   연결된 인원 수
========================================================= */

function connectedHumanCount(room) {
  return room.players.filter(
    player =>
      !player.isAI &&
      player.connected
  ).length;
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
          ).length
      }
    );

    /* =====================================================
       방 생성
    ===================================================== */

    socket.on(
      "room:create",
      data => {
        try {
          const oldRoom =
            findRoomBySocket(
              socket.id
            );

          if (oldRoom) {
            removeSocketFromRoom(
              oldRoom,
              socket.id
            );
          }

          const room =
            createRoom({
              socketId:
                socket.id,

              nickname:
                data?.nickname,

              maxPlayers:
                data?.maxPlayers,

              mode:
                data?.mode,

              aiLevel:
                data?.aiLevel
            });

          socket.join(room.id);

          socket.data.roomId =
            room.id;

          socket.data.playerIndex =
            0;

          /*
           * AI 모드면 바로 AI 추가
           */
          if (room.mode === "ai") {
            addAIPlayer(room);
          }

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
           * AI 모드는 바로 시작
           */
          if (
            room.mode === "ai"
          ) {
            startGame(room);
          } else {
            broadcastState(room);
          }

          console.log(
            `[ROOM CREATE] ${room.id}`
          );
        } catch (error) {
          console.error(
            "[room:create]",
            error
          );

          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "방 생성 중 오류가 발생했습니다."
            }
          );
        }
      }
    );

    /* =====================================================
       방 참가
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

          if (!room) {
            socket.emit(
              "room:error",
              {
                ok: false,

                reason:
                  "존재하지 않는 방입니다."
              }
            );

            return;
          }

          if (room.mode === "ai") {
            socket.emit(
              "room:error",
              {
                ok: false,

                reason:
                  "AI 방에는 다른 플레이어가 참가할 수 없습니다."
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

          const playerIndex =
            room.players.length;

          room.players.push({
            socketId:
              socket.id,

            playerIndex,

            nickname:
              normalizeWord(
                data?.nickname
              ) ||
              `플레이어 ${playerIndex + 1}`,

            connected: true,

            isAI: false
          });

          socket.join(room.id);

          socket.data.roomId =
            room.id;

          socket.data.playerIndex =
            playerIndex;

          socket.emit(
            "room:joined",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          io.to(room.id).emit(
            "room:ready",
            {
              ok: true,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          /*
           * 두 번째 사람이 들어오면
           * 자동으로 게임 시작.
           */
          if (
            room.players.length >= 2 &&
            !room.currentWord
          ) {
            startGame(room);
          } else {
            broadcastState(room);
          }

          console.log(
            `[ROOM JOIN] ${room.id} / ${socket.id}`
          );
        } catch (error) {
          console.error(
            "[room:join]",
            error
          );

          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "방 참가 중 오류가 발생했습니다."
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
                "참여 중인 방이 없습니다."
            }
          );

          return;
        }

        socket.emit(
          "game:state",
          getPublicRoomState(
            room
          )
        );
      }
    );

    /* =====================================================
       단어 제출
    ===================================================== */

    socket.on(
      "game:submit",
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
            return;
          }

          const result =
            playWord(
              room,

              player.playerIndex,

              data?.word ??
                data?.inputWord ??
                ""
            );

          if (!result.ok) {
            socket.emit(
              "game:error",
              result
            );

            return;
          }

          io.to(room.id).emit(
            "game:word",
            result
          );

          broadcastState(room);

          if (room.finished) {
            io.to(room.id).emit(
              "game:finished",
              {
                ok: true,

                winner:
                  room.winner,

                loser:
                  room.loser,

                state:
                  getPublicRoomState(
                    room
                  )
              }
            );

            return;
          }

          /*
           * AI 차례라면 실행
           */
          if (
            room.mode === "ai" &&
            room.turnPlayer === 1
          ) {
            setTimeout(
              () => runAITurn(room),
              450
            );
          }
        } catch (error) {
          console.error(
            "[game:submit]",
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
       새 게임
    ===================================================== */

    socket.on(
      "game:restart",
      () => {
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
                "참여 중인 방이 없습니다."
            }
          );

          return;
        }

        if (
          room.mode === "online" &&
          connectedHumanCount(room) < 2
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
          startGame(room);

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
          return;
        }

        socket.leave(room.id);

        removeSocketFromRoom(
          room,
          socket.id
        );

        socket.data.roomId =
          null;

        socket.data.playerIndex =
          null;
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

        const playerIndex =
          Number(
            data?.playerIndex
          );

        const room =
          ROOMS.get(roomId);

        if (!room) {
          socket.emit(
            "room:reconnect:error",
            {
              ok: false,

              reason:
                "방을 찾을 수 없습니다."
            }
          );

          return;
        }

        const player =
          room.players.find(
            p =>
              p.playerIndex ===
              playerIndex &&
              !p.isAI
          );

        if (!player) {
          socket.emit(
            "room:reconnect:error",
            {
              ok: false,

              reason:
                "플레이어 정보를 찾을 수 없습니다."
            }
          );

          return;
        }

        /*
         * 기존 socket 연결 해제
         */
        player.socketId =
          socket.id;

        player.connected = true;

        socket.join(room.id);

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
              getPublicRoomState(
                room
              )
          }
        );

        broadcastState(room);

        console.log(
          `[RECONNECT] ${room.id} / player ${playerIndex}`
        );
      }
    );

    /* =====================================================
       disconnect
    ===================================================== */

    socket.on(
      "disconnect",
      reason => {
        const room =
          findRoomBySocket(
            socket.id
          );

        if (!room) {
          return;
        }

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
        }

        io.to(room.id).emit(
          "room:playerLeft",
          {
            ok: true,

            playerIndex:
              player?.playerIndex ??
              null,

            reason:
              "플레이어의 연결이 종료되었습니다.",

            state:
              getPublicRoomState(
                room
              )
          }
        );

        broadcastState(room);

        console.log(
          `[DISCONNECT] ${socket.id} / ${reason}`
        );
      }
    );
  }
);

/* =========================================================
   소켓 제거
========================================================= */

function removeSocketFromRoom(
  room,
  socketId
) {
  if (!room) {
    return;
  }

  const index =
    room.players.findIndex(
      player =>
        player.socketId ===
        socketId
    );

  if (index === -1) {
    return;
  }

  const removed =
    room.players[index];

  /*
   * AI는 제거하지 않는다.
   */
  if (removed.isAI) {
    return;
  }

  room.players.splice(index, 1);

  /*
   * 플레이어 인덱스 재정렬
   */
  room.players.forEach(
    (player, i) => {
      player.playerIndex = i;
    }
  );

  /*
   * 현재 턴 플레이어 보정
   */
  if (
    room.players.length === 0
  ) {
    ROOMS.delete(room.id);
    return;
  }

  if (
    !room.players.some(
      player =>
        player.playerIndex ===
        room.turnPlayer
    )
  ) {
    room.turnPlayer = 0;
  }

  io.to(room.id).emit(
    "room:playerLeft",
    {
      ok: true,

      playerIndex:
        removed.playerIndex,

      reason:
        "플레이어가 방을 나갔습니다.",

      state:
        getPublicRoomState(
          room
        )
    }
  );

  broadcastState(room);
}

/* =========================================================
   API
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
    `${signal} 수신. 서버 종료 중...`
  );

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
