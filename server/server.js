"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

/* =========================================================
   기본 설정
========================================================= */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const ROOT_DIR = path.join(__dirname, "..");

/*
 * 프로젝트 구조가
 *
 * /
 * ├─ index.html
 * ├─ style.css
 * ├─ script.js
 * ├─ data/
 * │  ├─ word.txt
 * │  └─ attack.txt
 * └─ server/
 *    └─ server.js
 *
 * 라는 기준.
 *
 * public / client 구조도 자동 지원한다.
 */

const DATA_DIR = path.join(ROOT_DIR, "data");

const WORD_FILE = path.join(DATA_DIR, "word.txt");
const ATTACK_FILE = path.join(DATA_DIR, "attack.txt");

const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CLIENT_DIR = path.join(ROOT_DIR, "client");


/* =========================================================
   데이터
========================================================= */

let WORDS = new Set();

let BY_FIRST = Object.create(null);

let ATTACK_DEPTH = Object.create(null);

let DATA_READY = false;


/* =========================================================
   두음법칙
========================================================= */

/*
 * 필요할 경우 여기에 규칙을 추가할 수 있음.
 *
 * 배열의 첫 번째 값은 원래 초성,
 * 나머지는 두음 적용 가능 글자.
 */

const DUEUM = {
  "녀": ["녀", "여"],
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
  "래": ["래", "내"],
  "로": ["로", "노"],
  "뢰": ["뢰", "뇌"],
  "루": ["루", "누"],
  "르": ["르", "느"],

  "랴": ["랴", "야"],
  "려": ["려", "여"],
  "례": ["례", "예"],
  "료": ["료", "요"],
  "류": ["류", "유"],
  "리": ["리", "이"],

  "녀": ["녀", "여"],
  "뇨": ["뇨", "요"],
  "뉴": ["뉴", "유"],
  "니": ["니", "이"]
};


/* =========================================================
   문자열 처리
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
   두음 연결
========================================================= */

function allowedFirstChars(lastChar) {
  if (!lastChar) {
    return [];
  }

  const result = new Set();

  result.add(lastChar);

  const direct = DUEUM[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      if (char) {
        result.add(char);
      }
    }
  }

  /*
   * 역방향 허용
   *
   * 예:
   * 여 -> 녀
   */
  for (const [from, values] of Object.entries(DUEUM)) {
    if (
      Array.isArray(values) &&
      values.includes(lastChar)
    ) {
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
   파일 찾기
========================================================= */

function findExistingFile(...locations) {
  for (const file of locations) {
    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}


/* =========================================================
   단어 데이터 로드
========================================================= */

function loadWordData() {
  console.log("단어 데이터 로딩 시작...");

  const actualWordFile = findExistingFile(
    WORD_FILE,
    path.join(ROOT_DIR, "word.txt"),
    path.join(ROOT_DIR, "data", "word.txt"),
    path.join(ROOT_DIR, "client", "data", "word.txt"),
    path.join(ROOT_DIR, "public", "data", "word.txt")
  );

  const actualAttackFile = findExistingFile(
    ATTACK_FILE,
    path.join(ROOT_DIR, "attack.txt"),
    path.join(ROOT_DIR, "data", "attack.txt"),
    path.join(ROOT_DIR, "client", "data", "attack.txt"),
    path.join(ROOT_DIR, "public", "data", "attack.txt")
  );


  /* -------------------------------------------------------
     word.txt
  ------------------------------------------------------- */

  if (!actualWordFile) {
    throw new Error(
      "word.txt를 찾을 수 없습니다."
    );
  }

  console.log(
    "단어 파일:",
    actualWordFile
  );

  const wordText =
    fs.readFileSync(
      actualWordFile,
      "utf8"
    );

  const lines =
    wordText
      .split(/\r?\n/)
      .map(normalizeWord)
      .filter(Boolean);


  WORDS = new Set(lines);

  BY_FIRST = Object.create(null);

  for (const word of WORDS) {
    const first = word.at(0);

    if (!BY_FIRST[first]) {
      BY_FIRST[first] = [];
    }

    BY_FIRST[first].push(word);
  }


  /* -------------------------------------------------------
     attack.txt
  ------------------------------------------------------- */

  ATTACK_DEPTH = Object.create(null);

  if (actualAttackFile) {

    console.log(
      "공격 파일:",
      actualAttackFile
    );

    const attackText =
      fs.readFileSync(
        actualAttackFile,
        "utf8"
      );

    parseAttackData(attackText);

  } else {

    console.warn(
      "attack.txt를 찾지 못했습니다. 공격 깊이 없이 실행합니다."
    );
  }


  DATA_READY = true;

  console.log(
    `단어 ${WORDS.size.toLocaleString()}개 로드 완료`
  );

  console.log(
    `공격 단어 ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개 로드 완료`
  );
}


/* =========================================================
   attack.txt 파서
========================================================= */

function parseAttackData(text) {

  /*
   * 지원:
   *
   * 가녘 1
   * 가녘\t1
   * 가녘:1
   * 가녘,1
   *
   * [가]
   * 깊이 1 : 가녘, 가믐, 가마솣
   *
   * 처럼 현재 사용하는 형식도 지원.
   */

  let currentDepth = null;

  const lines =
    text.split(/\r?\n/);

  for (let rawLine of lines) {

    let line =
      rawLine.trim();

    if (!line) {
      continue;
    }


    /* -----------------------------------------------------
       [가] 같은 머리글
    ----------------------------------------------------- */

    if (
      line.startsWith("[") &&
      line.endsWith("]")
    ) {
      continue;
    }


    /* -----------------------------------------------------
       깊이 1 : 단어, 단어, 단어
    ----------------------------------------------------- */

    const depthMatch =
      line.match(
        /깊이\s*(\d+)\s*:\s*(.*)/
      );

    if (depthMatch) {

      currentDepth =
        Number(depthMatch[1]);

      const wordsPart =
        depthMatch[2];

      const attackWords =
        wordsPart
          .split(/[,\s]+/)
          .map(normalizeWord)
          .filter(Boolean);

      for (const word of attackWords) {

        if (
          word &&
          Number.isFinite(currentDepth)
        ) {
          ATTACK_DEPTH[word] =
            currentDepth;
        }
      }

      continue;
    }


    /* -----------------------------------------------------
       일반적인
       단어 depth
    ----------------------------------------------------- */

    let match =
      line.match(
        /^(.+?)\s*[,:\t ]\s*(\d+)$/
      );

    if (match) {

      const word =
        normalizeWord(match[1]);

      const depth =
        Number(match[2]);

      if (
        word &&
        Number.isFinite(depth)
      ) {
        ATTACK_DEPTH[word] =
          depth;
      }

      continue;
    }


    /*
     * depth 단어 형식:
     * 1 가녘
     */
    match =
      line.match(
        /^(\d+)\s+(.+)$/
      );

    if (match) {

      const depth =
        Number(match[1]);

      const word =
        normalizeWord(match[2]);

      if (
        word &&
        Number.isFinite(depth)
      ) {
        ATTACK_DEPTH[word] =
          depth;
      }

      continue;
    }


    /*
     * 이미 깊이가 선언된 상태에서
     * 단어만 있는 경우
     */
    if (currentDepth != null) {

      const words =
        line
          .split(/[,\s]+/)
          .map(normalizeWord)
          .filter(Boolean);

      for (const word of words) {

        if (
          word &&
          WORDS.has(word)
        ) {
          ATTACK_DEPTH[word] =
            currentDepth;
        }
      }
    }
  }
}


/* =========================================================
   후보
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
      : new Set(usedWords || []);

  const chars =
    allowedFirstChars(
      previousWord.at(-1)
    );

  const result = [];

  for (const char of chars) {

    const list =
      BY_FIRST[char];

    if (!Array.isArray(list)) {
      continue;
    }

    for (const word of list) {

      if (used.has(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}


/* =========================================================
   시작 단어 후보
========================================================= */

function getStartWords() {

  const result = [];

  /*
   * 공격 단어 및 한방 단어를
   * 시작 단어에서 최대한 제외.
   */

  for (const word of WORDS) {

    if (
      ATTACK_DEPTH[word] != null
    ) {
      continue;
    }

    const next =
      getCandidates(
        word,
        new Set([word])
      );

    if (!next.length) {
      continue;
    }

    result.push(word);

    /*
     * 서버가 시작할 때
     * 전체를 다시 계산하지 않도록 제한.
     */
    if (result.length >= 3000) {
      break;
    }
  }

  return result;
}


/* =========================================================
   시작 단어 캐시
========================================================= */

let START_WORD_CACHE = [];


function buildStartCache() {

  console.log(
    "안전한 시작 단어 캐시 생성..."
  );

  START_WORD_CACHE =
    getStartWords();

  console.log(
    `시작 단어 ${START_WORD_CACHE.length.toLocaleString()}개 준비 완료`
  );
}


/* =========================================================
   온라인 방
========================================================= */

const rooms = new Map();


function generateRoomCode() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  do {

    code = "";

    for (let i = 0; i < 6; i++) {

      code +=
        chars[
          Math.floor(
            Math.random() *
            chars.length
          )
        ];
    }

  } while (rooms.has(code));

  return code;
}


/* =========================================================
   온라인 방 상태
========================================================= */

function publicRoom(room) {

  return {
    code: room.code,

    players:
      room.players.map(player => ({
        id: player.id,
        name: player.name
      })),

    started: room.started,

    currentWord:
      room.currentWord,

    turnPlayer:
      room.turnPlayer,

    history:
      room.history.map(item => ({
        word: item.word,
        player: item.player,
        turn: item.turn,
        depth: item.depth
      })),

    finished:
      room.finished,

    winner:
      room.winner,

    loser:
      room.loser
  };
}


function broadcastRoom(room) {

  io.to(room.code).emit(
    "roomState",
    publicRoom(room)
  );
}


/* =========================================================
   게임 시작
========================================================= */

function startRoomGame(room) {

  if (room.players.length !== 2) {
    return {
      ok: false,
      reason:
        "두 명이 모두 들어와야 게임을 시작할 수 있습니다."
    };
  }

  if (room.started) {
    return {
      ok: false,
      reason:
        "이미 게임이 시작되었습니다."
    };
  }

  if (!START_WORD_CACHE.length) {
    buildStartCache();
  }

  const start =
    START_WORD_CACHE[
      Math.floor(
        Math.random() *
        START_WORD_CACHE.length
      )
    ];

  if (!start) {
    return {
      ok: false,
      reason:
        "시작 단어를 만들 수 없습니다."
    };
  }


  /*
   * 시작 단어는 방장이 먼저 사용.
   */
  room.started = true;

  room.finished = false;

  room.currentWord = start;

  room.turnPlayer = 1;

  room.usedWords =
    new Set([start]);

  room.history = [{
    word: start,
    player: 0,
    turn: 1,
    depth:
      ATTACK_DEPTH[start] ?? null
  }];

  room.winner = null;
  room.loser = null;


  io.to(room.code).emit(
    "onlineStarted",
    {
      startWord: start,
      currentWord: start,
      turnPlayer: 1
    }
  );


  io.to(room.code).emit(
    "wordPlayed",
    {
      word: start,
      player: 0,
      nextTurn: 1,
      depth:
        ATTACK_DEPTH[start] ?? null
    }
  );


  broadcastRoom(room);

  return {
    ok: true
  };
}


/* =========================================================
   온라인 단어 처리
========================================================= */

function playRoomWord(
  room,
  socket,
  word
) {

  if (!room.started) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "아직 게임이 시작되지 않았습니다."
      }
    );

    return;
  }


  if (room.finished) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "이미 끝난 게임입니다."
      }
    );

    return;
  }


  const playerIndex =
    room.players.findIndex(
      player =>
        player.id === socket.id
    );


  if (playerIndex === -1) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "이 방의 플레이어가 아닙니다."
      }
    );

    return;
  }


  /* 턴 */

  if (
    playerIndex !== room.turnPlayer
  ) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "상대방의 차례입니다."
      }
    );

    return;
  }


  word =
    normalizeWord(word);


  if (!word) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "단어를 입력해주세요."
      }
    );

    return;
  }


  /* 단어 존재 여부 */

  if (!WORDS.has(word)) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "단어 목록에 없는 단어입니다."
      }
    );

    return;
  }


  /* 중복 */

  if (
    room.usedWords.has(word)
  ) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "이미 사용한 단어입니다."
      }
    );

    return;
  }


  /* 연결 */

  if (
    !canConnect(
      room.currentWord,
      word
    )
  ) {

    const last =
      room.currentWord.at(-1);

    socket.emit(
      "wordRejected",
      {
        reason:
          `"${last}" 다음에 연결할 수 없는 단어입니다.`,

        allowed:
          allowedFirstChars(last)
      }
    );

    return;
  }


  /* 등록 */

  room.currentWord =
    word;

  room.usedWords.add(word);

  room.history.push({
    word,
    player: playerIndex,
    turn:
      room.history.length + 1,
    depth:
      ATTACK_DEPTH[word] ?? null
  });


  const nextPlayer =
    playerIndex === 0
      ? 1
      : 0;


  room.turnPlayer =
    nextPlayer;


  /* 다음 후보 */

  const next =
    getCandidates(
      word,
      room.usedWords
    );


  /*
   * 상대가 이어갈 단어가 없으면
   * 현재 플레이어 승리.
   */

  if (!next.length) {

    room.finished = true;

    room.started = false;

    room.winner =
      playerIndex;

    room.loser =
      nextPlayer;


    io.to(room.code).emit(
      "wordPlayed",
      {
        word,
        player: playerIndex,
        nextTurn: nextPlayer,
        depth:
          ATTACK_DEPTH[word] ?? null
      }
    );


    io.to(room.code).emit(
      "gameFinished",
      {
        winner: playerIndex,
        loser: nextPlayer,
        word
      }
    );


    broadcastRoom(room);

    return;
  }


  /* 정상 진행 */

  io.to(room.code).emit(
    "wordPlayed",
    {
      word,
      player: playerIndex,
      nextTurn: nextPlayer,
      depth:
        ATTACK_DEPTH[word] ?? null
    }
  );


  broadcastRoom(room);
}


/* =========================================================
   HTTP
========================================================= */

app.use(
  express.json()
);


/* =========================================================
   데이터 API
========================================================= */

app.get(
  "/api/data",
  (req, res) => {

    if (!DATA_READY) {

      return res.status(503).json({
        ok: false,
        error:
          "단어 데이터를 아직 준비하는 중입니다."
      });
    }


    res.json({
      ok: true,

      /*
       * 클라이언트가 사용하는 데이터
       */

      byFirst: BY_FIRST,

      attackDepth: ATTACK_DEPTH,

      dueum: DUEUM,

      startFirst:
        Object.keys(BY_FIRST)
    });
  }
);


/* =========================================================
   상태 확인
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      dataReady: DATA_READY,
      words: WORDS.size,
      attackWords:
        Object.keys(ATTACK_DEPTH).length,
      rooms: rooms.size
    });
  }
);


/* =========================================================
   정적 파일
========================================================= */

/*
 * public이 있으면 public 우선.
 * 없으면 client.
 * 그래도 없으면 프로젝트 루트.
 */

if (fs.existsSync(PUBLIC_DIR)) {

  app.use(
    express.static(PUBLIC_DIR)
  );

}

if (fs.existsSync(CLIENT_DIR)) {

  app.use(
    express.static(CLIENT_DIR)
  );
}


/*
 * 루트 정적 파일
 */

app.use(
  express.static(ROOT_DIR)
);


/* =========================================================
   index.html
========================================================= */

app.get(
  "/",
  (req, res) => {

    const indexFile =
      findExistingFile(
        path.join(PUBLIC_DIR, "index.html"),
        path.join(CLIENT_DIR, "index.html"),
        path.join(ROOT_DIR, "index.html")
      );


    if (!indexFile) {

      return res.status(404).send(
        `
        <h1>index.html을 찾을 수 없습니다.</h1>
        <p>프로젝트 루트 또는 public/client 폴더에 index.html을 넣어주세요.</p>
        `
      );
    }


    res.sendFile(indexFile);
  }
);


/* =========================================================
   Socket.IO
========================================================= */

io.on(
  "connection",
  socket => {

    console.log(
      "Socket 연결:",
      socket.id
    );


    /* -----------------------------------------------------
       방 생성
    ----------------------------------------------------- */

    socket.on(
      "createRoom",
      ({ name } = {}) => {

        /*
         * 이미 다른 방에 있다면 제거.
         */
        leaveCurrentRoom(socket);


        const code =
          generateRoomCode();


        const playerName =
          normalizeWord(name) ||
          "Player";


        const room = {

          code,

          players: [{
            id: socket.id,
            name: playerName
          }],

          started: false,

          currentWord: null,

          turnPlayer: 0,

          usedWords:
            new Set(),

          history: [],

          finished: false,

          winner: null,

          loser: null
        };


        rooms.set(
          code,
          room
        );


        socket.join(code);

        socket.data.roomCode =
          code;


        socket.emit(
          "roomCreated",
          {
            code
          }
        );


        broadcastRoom(room);


        console.log(
          `방 생성: ${code} / ${playerName}`
        );
      }
    );


    /* -----------------------------------------------------
       방 참가
    ----------------------------------------------------- */

    socket.on(
      "joinRoom",
      ({ code, name } = {}) => {

        const roomCode =
          String(code || "")
            .trim()
            .toUpperCase();


        const room =
          rooms.get(roomCode);


        if (!room) {

          socket.emit(
            "errorMessage",
            "존재하지 않는 방입니다."
          );

          return;
        }


        if (room.players.length >= 2) {

          socket.emit(
            "errorMessage",
            "방이 가득 찼습니다."
          );

          return;
        }


        if (room.started) {

          socket.emit(
            "errorMessage",
            "이미 게임이 시작된 방입니다."
          );

          return;
        }


        leaveCurrentRoom(socket);


        room.players.push({
          id: socket.id,
          name:
            normalizeWord(name) ||
            "Player"
        });


        socket.join(roomCode);

        socket.data.roomCode =
          roomCode;


        socket.emit(
          "joinedRoom",
          {
            code: roomCode
          }
        );


        broadcastRoom(room);


        io.to(roomCode).emit(
          "roomMessage",
          "두 플레이어가 모두 들어왔습니다. 방장이 게임을 시작할 수 있습니다."
        );
      }
    );


    /* -----------------------------------------------------
       게임 시작
    ----------------------------------------------------- */

    socket.on(
      "startOnline",
      () => {

        const room =
          getSocketRoom(socket);

        if (!room) {

          socket.emit(
            "errorMessage",
            "먼저 방을 만들어주세요."
          );

          return;
        }


        const playerIndex =
          room.players.findIndex(
            player =>
              player.id === socket.id
          );


        if (playerIndex !== 0) {

          socket.emit(
            "errorMessage",
            "방장만 게임을 시작할 수 있습니다."
          );

          return;
        }


        const result =
          startRoomGame(room);


        if (!result.ok) {

          socket.emit(
            "errorMessage",
            result.reason
          );

          return;
        }
      }
    );


    /* -----------------------------------------------------
       단어 입력
    ----------------------------------------------------- */

    socket.on(
      "playWord",
      ({ word } = {}) => {

        const room =
          getSocketRoom(socket);


        if (!room) {

          socket.emit(
            "wordRejected",
            {
              reason:
                "먼저 게임방에 참가해주세요."
            }
          );

          return;
        }


        playRoomWord(
          room,
          socket,
          word
        );
      }
    );


    /* -----------------------------------------------------
       연결 종료
    ----------------------------------------------------- */

    socket.on(
      "disconnect",
      () => {

        console.log(
          "Socket 종료:",
          socket.id
        );


        const room =
          getSocketRoom(socket);


        if (!room) {
          return;
        }


        const index =
          room.players.findIndex(
            player =>
              player.id === socket.id
          );


        if (index !== -1) {

          room.players.splice(
            index,
            1
          );
        }


        /*
         * 사람이 모두 나가면 방 삭제.
         */
        if (!room.players.length) {

          rooms.delete(
            room.code
          );

          console.log(
            `빈 방 삭제: ${room.code}`
          );

          return;
        }


        /*
         * 게임 중이었다면
         * 남은 사람의 승리 처리.
         */

        if (room.started) {

          const winner =
            room.players[0];


          room.started = false;
          room.finished = true;

          room.winner =
            index === 0
              ? 1
              : 0;

          room.loser =
            index;


          io.to(room.code).emit(
            "gameFinished",
            {
              winner:
                room.winner,
              loser:
                room.loser,
              reason:
                "상대방이 방을 나갔습니다."
            }
          );
        }


        broadcastRoom(room);


        /*
         * 나간 사람 때문에
         * 방장은 다시 게임을 시작할 수 있도록
         * 상태 초기화.
         */

        room.started = false;
        room.finished = false;
        room.currentWord = null;
        room.turnPlayer = 0;
        room.usedWords = new Set();
        room.history = [];
        room.winner = null;
        room.loser = null;


        io.to(room.code).emit(
          "roomMessage",
          "상대방이 나갔습니다."
        );
      }
    );
  }
);


/* =========================================================
   방 찾기
========================================================= */

function getSocketRoom(socket) {

  const code =
    socket.data.roomCode;

  if (!code) {
    return null;
  }

  return rooms.get(code) || null;
}


/* =========================================================
   기존 방에서 나가기
========================================================= */

function leaveCurrentRoom(socket) {

  const room =
    getSocketRoom(socket);


  if (!room) {
    return;
  }


  const index =
    room.players.findIndex(
      player =>
        player.id === socket.id
    );


  if (index !== -1) {

    room.players.splice(
      index,
      1
    );
  }


  socket.leave(
    room.code
  );


  socket.data.roomCode =
    null;


  if (!room.players.length) {

    rooms.delete(
      room.code
    );

  } else {

    broadcastRoom(room);
  }
}


/* =========================================================
   오류 처리
========================================================= */

app.use(
  (err, req, res, next) => {

    console.error(
      "서버 오류:",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        "서버 내부 오류가 발생했습니다."
    });
  }
);


/* =========================================================
   서버 시작
========================================================= */

try {

  loadWordData();

  /*
   * 시작 단어 캐시는 서버 시작 시
   * 딱 한 번 만든다.
   *
   * 따라서 새 게임마다 50만 단어를
   * 다시 검색하지 않는다.
   */

  buildStartCache();

} catch (error) {

  console.error(
    "데이터 로드 실패:",
    error
  );

  process.exit(1);
}


server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "======================================"
    );

    console.log(
      `끝말잇기 서버 실행: PORT ${PORT}`
    );

    console.log(
      `단어: ${WORDS.size.toLocaleString()}개`
    );

    console.log(
      `공격 단어: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
    );

    console.log(
      `시작 단어: ${START_WORD_CACHE.length.toLocaleString()}개`
    );

    console.log(
      "Socket.IO: 활성화"
    );

    console.log(
      "======================================"
    );
  }
);
