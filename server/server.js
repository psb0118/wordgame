"use strict";

/*
 * =========================================================
 * 끝말잇기 멀티플레이어 서버
 * =========================================================
 *
 * 기능
 *
 * 1. Express + Socket.IO
 * 2. word.txt 실제 단어만 허용
 * 3. attack.txt 공격 깊이 사용
 * 4. 두음법칙 서버 판정
 * 5. 중복 단어 방지
 * 6. 서버 authoritative 판정
 * 7. 2명 이상 멀티플레이 지원
 * 8. 방 생성
 * 9. 방 참가
 * 10. 방 나가기
 * 11. 게임 시작
 * 12. 턴 관리
 * 13. 시작 단어 자동 선택
 * 14. 첫 단어 한방/공격 단어 방지
 * 15. 실시간 roomState
 * 16. 실시간 wordPlayed
 * 17. 플레이어 퇴장 처리
 * 18. 게임 종료 처리
 * 19. 잘못된 요청 방어
 *
 * =========================================================
 */

const path = require("path");
const fs = require("fs");
const http = require("http");

const express = require("express");
const { Server } = require("socket.io");

const gameEngine = require("./game");


/* =========================================================
   기본 설정
========================================================= */

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT =
  process.env.PORT || 3000;


/* =========================================================
   경로
========================================================= */

const ROOT =
  path.join(__dirname, "..");

const CLIENT_DIR =
  path.join(ROOT, "client");

const DATA_DIR =
  path.join(ROOT, "data");

const WORD_FILE =
  path.join(DATA_DIR, "word.txt");

const ATTACK_FILE =
  path.join(DATA_DIR, "attack.txt");


/* =========================================================
   게임 데이터
========================================================= */

let WORDS = new Set();

let BY_FIRST =
  Object.create(null);

let ATTACK_DEPTH =
  Object.create(null);

let DUEUM =
  Object.create(null);

let DATA_LOADED = false;


/* =========================================================
   두음법칙
========================================================= */

DUEUM = {

  "녀": ["녀", "여"],
  "년": ["년", "연"],
  "녕": ["녕", "영"],
  "녜": ["녜", "예"],
  "뇨": ["뇨", "요"],
  "뉴": ["뉴", "유"],
  "니": ["니", "이"],

  "냐": ["냐", "야"],
  "냥": ["냥", "양"],

  "랴": ["랴", "야"],
  "려": ["려", "여"],
  "례": ["례", "예"],
  "료": ["료", "요"],
  "류": ["류", "유"],
  "리": ["리", "이"],

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
  "륭": ["륭", "융"],

  "릉": ["릉", "능"]
};


/* =========================================================
   기본 처리
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
   두음 허용 첫 글자
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

      if (char) {
        result.add(char);
      }
    }
  }

  /*
   * 역방향도 허용
   *
   * 여 -> 녀
   * 연 -> 년
   * 율 -> 률
   * 윰 -> 륨 등
   */

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


/* =========================================================
   연결 가능 여부
========================================================= */

function canConnect(
  previousWord,
  nextWord
) {

  previousWord =
    normalizeWord(previousWord);

  nextWord =
    normalizeWord(nextWord);

  if (
    !previousWord ||
    !nextWord
  ) {
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
   단어 존재
========================================================= */

function hasWord(word) {

  word =
    normalizeWord(word);

  return (
    !!word &&
    WORDS.has(word)
  );
}


/* =========================================================
   후보 검색
========================================================= */

function getCandidates(
  previousWord,
  usedWords = new Set()
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

  const allowed =
    allowedFirstChars(
      previousWord.at(-1)
    );

  const result = [];

  for (const first of allowed) {

    const list =
      BY_FIRST[first];

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
   시작 후보
========================================================= */

function getStartCandidates(
  startChar = "",
  usedWords = new Set()
) {

  startChar =
    normalizeWord(startChar);

  if (!startChar) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const allowed =
    allowedFirstChars(startChar);

  const result = [];

  for (const first of allowed) {

    const list =
      BY_FIRST[first];

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
   공격 깊이
========================================================= */

function getAttackDepth(word) {

  word =
    normalizeWord(word);

  if (!word) {
    return null;
  }

  const value =
    ATTACK_DEPTH[word];

  if (value == null) {
    return null;
  }

  const depth =
    Number(value);

  return Number.isFinite(depth)
    ? depth
    : null;
}


function isWinningAttack(word) {

  const depth =
    getAttackDepth(word);

  return (
    depth != null &&
    depth % 2 === 1
  );
}


function isLosingAttack(word) {

  const depth =
    getAttackDepth(word);

  return (
    depth != null &&
    depth % 2 === 0
  );
}


/* =========================================================
   데이터 로드
========================================================= */

function loadData() {

  console.log(
    "단어 데이터 로딩 시작..."
  );


  if (!fs.existsSync(WORD_FILE)) {

    throw new Error(
      `word.txt를 찾을 수 없습니다: ${WORD_FILE}`
    );
  }


  if (!fs.existsSync(ATTACK_FILE)) {

    throw new Error(
      `attack.txt를 찾을 수 없습니다: ${ATTACK_FILE}`
    );
  }


  /*
   * -------------------------------------------------------
   * word.txt
   * -------------------------------------------------------
   */

  const wordText =
    fs.readFileSync(
      WORD_FILE,
      "utf8"
    );

  WORDS =
    new Set();


  for (
    const line
    of wordText.split(/\r?\n/)
  ) {

    /*
     * word.txt가
     *
     * 단어
     *
     * 형태라고 가정한다.
     *
     * 혹시 뒤에 불필요한 데이터가 있어도
     * 첫 번째 토큰만 사용한다.
     */

    const word =
      normalizeWord(
        line.trim().split(/\s+/)[0]
      );

    if (word) {
      WORDS.add(word);
    }
  }


  /*
   * -------------------------------------------------------
   * 첫 글자 인덱스
   * -------------------------------------------------------
   */

  BY_FIRST =
    Object.create(null);

  for (const word of WORDS) {

    const first =
      word.at(0);

    if (!first) {
      continue;
    }

    if (!BY_FIRST[first]) {
      BY_FIRST[first] = [];
    }

    BY_FIRST[first].push(word);
  }


  /*
   * -------------------------------------------------------
   * attack.txt
   * -------------------------------------------------------
   */

  ATTACK_DEPTH =
    Object.create(null);

  const attackText =
    fs.readFileSync(
      ATTACK_FILE,
      "utf8"
    );

  for (
    const line
    of attackText.split(/\r?\n/)
  ) {

    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    /*
     * 지원 형식:
     *
     * 가녘 1
     * 가마깥 3
     * 가문비 5
     */

    const match =
      trimmed.match(
        /^(\S+)\s+(-?\d+(?:\.\d+)?)$/
      );

    if (!match) {
      continue;
    }

    const word =
      normalizeWord(match[1]);

    const depth =
      Number(match[2]);

    if (
      !word ||
      !Number.isFinite(depth)
    ) {
      continue;
    }

    ATTACK_DEPTH[word] =
      depth;
  }


  DATA_LOADED = true;


  console.log(
    `단어 ${WORDS.size.toLocaleString()}개 로드`
  );

  console.log(
    `공격 단어 ${
      Object.keys(ATTACK_DEPTH)
        .length
        .toLocaleString()
    }개 로드`
  );
}


try {

  loadData();

} catch (error) {

  console.error(
    "데이터 로드 실패:",
    error
  );

  process.exit(1);
}


/* =========================================================
   API
========================================================= */

app.get(
  "/api/data",
  (req, res) => {

    if (!DATA_LOADED) {

      return res
        .status(503)
        .json({
          error:
            "단어 데이터가 준비되지 않았습니다."
        });
    }

    res.json({

      byFirst:
        BY_FIRST,

      attackDepth:
        ATTACK_DEPTH,

      dueum:
        DUEUM,

      startFirst:
        Object.keys(BY_FIRST)
    });
  }
);


/* =========================================================
   정적 파일
========================================================= */

app.use(
  express.static(
    CLIENT_DIR
  )
);


/* =========================================================
   SPA fallback
========================================================= */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        CLIENT_DIR,
        "index.html"
      )
    );
  }
);


/* =========================================================
   방 설정
========================================================= */

/*
 * 최대 인원
 *
 * 2명 이상 가능.
 * 필요하면 20, 50 등으로 변경 가능.
 */

const MAX_PLAYERS = 10;


/*
 * 최소 게임 인원
 */

const MIN_PLAYERS = 2;


/*
 * 방 코드
 */

const rooms =
  new Map();


/* =========================================================
   방 코드 생성
========================================================= */

function generateRoomCode() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {

    code = "";

    for (
      let i = 0;
      i < 5;
      i++
    ) {

      code +=
        chars[
          Math.floor(
            Math.random() *
            chars.length
          )
        ];
    }

  } while (
    rooms.has(code)
  );

  return code;
}


/* =========================================================
   플레이어 이름
========================================================= */

function cleanPlayerName(name) {

  name =
    normalizeWord(name);

  if (!name) {
    return "Player";
  }

  /*
   * 이름이 너무 길어지는 것을 방지
   */

  return name.slice(0, 20);
}


/* =========================================================
   방 찾기
========================================================= */

function getRoomBySocket(socket) {

  for (
    const room
    of rooms.values()
  ) {

    if (
      room.players.some(
        player =>
          player.id === socket.id
      )
    ) {

      return room;
    }
  }

  return null;
}


/* =========================================================
   플레이어 인덱스
========================================================= */

function getPlayerIndex(
  room,
  socket
) {

  if (!room) {
    return -1;
  }

  return room.players.findIndex(
    player =>
      player.id === socket.id
  );
}


/* =========================================================
   공개 플레이어 정보
========================================================= */

function getPublicPlayers(room) {

  return room.players.map(
    (player, index) => ({

      index,

      id:
        player.id,

      name:
        player.name,

      connected:
        player.connected !== false
    })
  );
}


/* =========================================================
   방 공개 상태
========================================================= */

function getRoomState(room) {

  if (!room) {
    return null;
  }

  return {

    code:
      room.code,

    maxPlayers:
      MAX_PLAYERS,

    minPlayers:
      MIN_PLAYERS,

    players:
      getPublicPlayers(room),

    started:
      room.started,

    startChar:
      room.game?.startChar || "",

    currentWord:
      room.game?.currentWord || null,

    turnPlayer:
      room.game?.turnPlayer ?? null,

    turnPlayerId:
      room.game
        ? room.players[
            room.game.turnPlayer
          ]?.id || null
        : null,

    history:
      room.game
        ? room.game.history.map(
            item => ({

              word:
                item.word,

              player:
                item.player,

              playerId:
                room.players[
                  item.player
                ]?.id || null,

              turn:
                item.turn,

              depth:
                item.depth
            })
          )
        : [],

    finished:
      room.game?.finished || false,

    winner:
      room.game?.winner ?? null,

    loser:
      room.game?.loser ?? null,

    winnerId:
      room.game &&
      room.game.winner != null
        ? room.players[
            room.game.winner
          ]?.id || null
        : null,

    loserId:
      room.game &&
      room.game.loser != null
        ? room.players[
            room.game.loser
          ]?.id || null
        : null
  };
}


/* =========================================================
   방 상태 전송
========================================================= */

function emitRoomState(room) {

  if (!room) {
    return;
  }

  io.to(room.code).emit(
    "roomState",
    getRoomState(room)
  );
}


/* =========================================================
   오류 전송
========================================================= */

function sendError(
  socket,
  message,
  code = "ERROR"
) {

  socket.emit(
    "errorMessage",
    {
      code,
      message
    }
  );
}


/* =========================================================
   방 메시지
========================================================= */

function roomMessage(
  room,
  message
) {

  if (!room) {
    return;
  }

  io.to(room.code).emit(
    "roomMessage",
    message
  );
}


/* =========================================================
   방 생성
========================================================= */

function createRoom(
  socket,
  name
) {

  const oldRoom =
    getRoomBySocket(socket);

  if (oldRoom) {

    leaveRoom(
      socket,
      oldRoom,
      false
    );
  }


  const code =
    generateRoomCode();

  const cleanName =
    cleanPlayerName(name);


  const room = {

    code,

    players: [
      {
        id:
          socket.id,

        name:
          cleanName,

        connected:
          true
      }
    ],

    started:
      false,

    game:
      null
  };


  rooms.set(
    code,
    room
  );

  socket.join(code);


  socket.emit(
    "roomCreated",
    {
      code,
      playerIndex: 0
    }
  );


  /*
   * 호환용
   */

  socket.emit(
    "createdRoom",
    {
      code,
      playerIndex: 0
    }
  );


  emitRoomState(room);


  roomMessage(
    room,
    `${cleanName}님이 방을 만들었습니다.`
  );


  console.log(
    `방 생성: ${code} / ${cleanName}`
  );


  return room;
}


/* =========================================================
   방 참가
========================================================= */

function joinRoom(
  socket,
  code,
  name
) {

  code =
    String(code || "")
      .trim()
      .toUpperCase();


  if (!code) {

    sendError(
      socket,
      "방 코드를 입력해주세요.",
      "INVALID_ROOM_CODE"
    );

    return null;
  }


  const room =
    rooms.get(code);


  if (!room) {

    sendError(
      socket,
      "존재하지 않는 방입니다.",
      "ROOM_NOT_FOUND"
    );

    return null;
  }


  if (
    room.players.length >=
    MAX_PLAYERS
  ) {

    sendError(
      socket,
      "방이 가득 찼습니다.",
      "ROOM_FULL"
    );

    return null;
  }


  if (room.started) {

    sendError(
      socket,
      "이미 게임이 시작된 방입니다.",
      "GAME_ALREADY_STARTED"
    );

    return null;
  }


  const oldRoom =
    getRoomBySocket(socket);

  if (oldRoom) {

    leaveRoom(
      socket,
      oldRoom,
      false
    );
  }


  const cleanName =
    cleanPlayerName(name);

  const playerIndex =
    room.players.length;


  room.players.push({

    id:
      socket.id,

    name:
      cleanName,

    connected:
      true
  });


  socket.join(code);


  socket.emit(
    "joinedRoom",
    {
      code,
      playerIndex
    }
  );


  /*
   * 호환용
   */

  socket.emit(
    "roomJoined",
    {
      code,
      playerIndex
    }
  );


  emitRoomState(room);


  roomMessage(
    room,
    `${cleanName}님이 방에 참가했습니다.`
  );


  console.log(
    `방 참가: ${code} / ${cleanName}`
  );


  return room;
}


/* =========================================================
   방 나가기
========================================================= */

function leaveRoom(
  socket,
  room = null,
  notify = true
) {

  room =
    room || getRoomBySocket(socket);

  if (!room) {
    return;
  }


  const index =
    getPlayerIndex(
      room,
      socket
    );


  if (index < 0) {
    return;
  }


  const player =
    room.players[index];


  room.players.splice(
    index,
    1
  );


  socket.leave(
    room.code
  );


  /*
   * 게임 중이었으면
   * 나간 사람의 상대를 승자로 처리.
   */

  if (
    room.started &&
    room.game &&
    !room.game.finished
  ) {

    room.game.finished =
      true;


    /*
     * 나간 플레이어가
     * 패배 처리된다.
     *
     * 플레이어 배열이 줄어들기 때문에
     * winner index는 현재 배열 기준으로
     * 다시 계산한다.
     */

    if (room.players.length > 0) {

      room.game.winner = 0;
      room.game.loser = null;
    }
  }


  if (notify) {

    roomMessage(
      room,
      `${player.name}님이 방을 나갔습니다.`
    );
  }


  /*
   * 플레이어가 한 명도 없으면
   * 방 삭제.
   */

  if (!room.players.length) {

    rooms.delete(
      room.code
    );

    console.log(
      `방 삭제: ${room.code}`
    );

    return;
  }


  /*
   * 아직 시작하지 않았다면
   * 정상적으로 대기방 유지.
   */

  if (!room.started) {

    emitRoomState(room);
    return;
  }


  /*
   * 게임 중이면 상태 전달.
   */

  emitRoomState(room);
}


/* =========================================================
   시작 글자 생성
========================================================= */

function getRandomStartChar() {

  const chars =
    Object.keys(BY_FIRST);

  if (!chars.length) {
    return "";
  }

  /*
   * 한 글자 시작점만 사용.
   */

  return chars[
    Math.floor(
      Math.random() *
      chars.length
    )
  ];
}


/* =========================================================
   첫 단어가 안전한지 검사
========================================================= */

function isSafeStartWord(
  word
) {

  word =
    normalizeWord(word);

  if (!word) {
    return false;
  }

  /*
   * 실제 단어 목록
   */

  if (!WORDS.has(word)) {
    return false;
  }

  /*
   * 공격 단어 금지
   */

  if (
    ATTACK_DEPTH[word] != null
  ) {
    return false;
  }

  /*
   * 사용 단어 없음
   */

  const next =
    getCandidates(
      word,
      new Set([word])
    );

  /*
   * 한방단어 금지
   */

  if (!next.length) {
    return false;
  }

  return true;
}


/* =========================================================
   첫 단어 선택
========================================================= */

function chooseStartWord(
  startChar
) {

  const candidates =
    getStartCandidates(
      startChar,
      new Set()
    );


  /*
   * 안전 후보
   */

  const safe =
    candidates.filter(
      isSafeStartWord
    );


  if (safe.length) {

    /*
     * 완전 랜덤보다는
     * 후보가 적당히 있는 단어를
     * 우선해서 첫 플레이어가
     * 시작부터 터지는 것을 방지.
     */

    const scored =
      safe.map(
        word => {

          const nextCount =
            getCandidates(
              word,
              new Set([word])
            ).length;

          return {
            word,
            nextCount
          };
        }
      );


    scored.sort(
      (a, b) =>
        b.nextCount -
        a.nextCount
    );


    const pool =
      scored.slice(
        0,
        Math.min(
          20,
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


  /*
   * 안전 단어가 없을 경우
   * 일반 단어 중 한방이 아닌 것.
   */

  const fallback =
    candidates.filter(
      word => {

        if (!WORDS.has(word)) {
          return false;
        }

        const next =
          getCandidates(
            word,
            new Set([word])
          );

        return next.length > 0;
      }
    );


  if (fallback.length) {

    return fallback[
      Math.floor(
        Math.random() *
        fallback.length
      )
    ];
  }


  return null;
}


/* =========================================================
   게임 생성
========================================================= */

function createRoomGame(
  room,
  startChar = ""
) {

  if (!startChar) {
    startChar =
      getRandomStartChar();
  }

  /*
   * 게임 시작 시에는
   * 플레이어 0부터 시작.
   */

  return {

    startChar,

    currentWord:
      null,

    turnPlayer:
      0,

    history: [],

    usedWords:
      new Set(),

    finished:
      false,

    winner:
      null,

    loser:
      null
  };
}


/* =========================================================
   게임 시작
========================================================= */

function startRoomGame(
  room,
  socket
) {

  if (!room) {

    sendError(
      socket,
      "방을 찾을 수 없습니다.",
      "ROOM_NOT_FOUND"
    );

    return;
  }


  if (
    room.players.length <
    MIN_PLAYERS
  ) {

    sendError(
      socket,
      `최소 ${MIN_PLAYERS}명이 필요합니다.`,
      "NOT_ENOUGH_PLAYERS"
    );

    return;
  }


  if (room.started) {

    sendError(
      socket,
      "이미 게임이 시작되었습니다.",
      "GAME_ALREADY_STARTED"
    );

    return;
  }


  /*
   * 방장만 시작 가능.
   */

  const playerIndex =
    getPlayerIndex(
      room,
      socket
    );

  if (playerIndex !== 0) {

    sendError(
      socket,
      "방장만 게임을 시작할 수 있습니다.",
      "NOT_HOST"
    );

    return;
  }


  const startChar =
    getRandomStartChar();


  const game =
    createRoomGame(
      room,
      startChar
    );


  /*
   * 첫 시작 단어는
   * 바로 내는 것이 아니라
   * 시작 글자만 정해 놓는다.
   *
   * 즉 첫 플레이어가 직접
   * 안전한 단어를 입력한다.
   */

  room.game =
    game;

  room.started =
    true;


  io.to(room.code).emit(
    "gameStarted",
    getRoomState(room)
  );


  /*
   * 호환용
   */

  io.to(room.code).emit(
    "gameStart",
    getRoomState(room)
  );


  emitRoomState(room);


  roomMessage(
    room,
    `게임이 시작되었습니다. ${room.players[0].name}님부터 시작합니다.`
  );


  console.log(
    `게임 시작: ${room.code}`
  );
}


/* =========================================================
   서버 게임 상태 검증
========================================================= */

function validateWord(
  room,
  playerIndex,
  word
) {

  word =
    normalizeWord(word);


  if (!room) {

    return {
      ok: false,
      reason: "방을 찾을 수 없습니다."
    };
  }


  if (!room.started) {

    return {
      ok: false,
      reason: "아직 게임이 시작되지 않았습니다."
    };
  }


  if (!room.game) {

    return {
      ok: false,
      reason: "게임 정보를 찾을 수 없습니다."
    };
  }


  if (room.game.finished) {

    return {
      ok: false,
      reason: "이미 끝난 게임입니다."
    };
  }


  if (
    playerIndex !==
    room.game.turnPlayer
  ) {

    return {
      ok: false,
      reason: "지금은 당신의 차례가 아닙니다."
    };
  }


  if (!word) {

    return {
      ok: false,
      reason: "단어를 입력해주세요."
    };
  }


  /*
   * 실제 word.txt
   */

  if (!WORDS.has(word)) {

    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }


  /*
   * 중복
   */

  if (
    room.game.usedWords.has(word)
  ) {

    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /*
   * 첫 단어
   */

  if (
    !room.game.currentWord
  ) {

    const allowed =
      allowedFirstChars(
        room.game.startChar
      );

    if (
      !allowed.includes(
        word.at(0)
      )
    ) {

      return {
        ok: false,
        reason:
          `"${room.game.startChar}"으로 시작할 수 없는 단어입니다.`,
        allowed
      };
    }

    /*
     * 첫 단어는 공격/한방 금지.
     *
     * 게임 시작 직후부터
     * 한방 공격으로 터지는 것을 방지.
     */

    if (
      ATTACK_DEPTH[word] != null
    ) {

      return {
        ok: false,
        reason:
          "첫 단어에는 공격 단어를 사용할 수 없습니다."
      };
    }

    const next =
      getCandidates(
        word,
        new Set([word])
      );

    if (!next.length) {

      return {
        ok: false,
        reason:
          "첫 단어에는 한방단어를 사용할 수 없습니다."
      };
    }

  }


  /*
   * 일반 연결
   */

  if (
    room.game.currentWord &&
    !canConnect(
      room.game.currentWord,
      word
    )
  ) {

    const last =
      room.game.currentWord.at(-1);

    return {
      ok: false,

      reason:
        `"${last}" 다음에 연결할 수 없는 단어입니다.`,

      allowed:
        allowedFirstChars(last)
    };
  }


  return {
    ok: true,
    word
  };
}


/* =========================================================
   단어 제출
========================================================= */

function submitWord(
  socket,
  payload
) {

  const room =
    getRoomBySocket(socket);


  if (!room) {

    sendError(
      socket,
      "먼저 방에 참가해주세요.",
      "NOT_IN_ROOM"
    );

    return;
  }


  const playerIndex =
    getPlayerIndex(
      room,
      socket
    );


  /*
   * payload 호환
   *
   * submitWord("단어")
   * submitWord({word:"단어"})
   */

  let word = "";

  if (
    typeof payload === "string"
  ) {

    word = payload;

  } else if (
    payload &&
    typeof payload === "object"
  ) {

    word =
      payload.word ||
      payload.text ||
      "";
  }


  word =
    normalizeWord(word);


  const validation =
    validateWord(
      room,
      playerIndex,
      word
    );


  if (!validation.ok) {

    socket.emit(
      "wordRejected",
      {
        word,
        reason:
          validation.reason,

        allowed:
          validation.allowed || []
      }
    );

    sendError(
      socket,
      validation.reason,
      "INVALID_WORD"
    );

    return;
  }


  /*
   * 현재 플레이어
   */

  const player =
    room.players[playerIndex];


  const depth =
    getAttackDepth(word);


  /*
   * 단어 등록
   */

  room.game.currentWord =
    word;

  room.game.usedWords.add(
    word
  );

  room.game.history.push({

    word,

    player:
      playerIndex,

    turn:
      room.game.history.length + 1,

    depth
  });


  /*
   * 다음 후보
   */

  const next =
    getCandidates(
      word,
      room.game.usedWords
    );


  /*
   * 결과 기본값
   */

  let finished = false;

  let winner = null;

  let loser = null;


  /*
   * 한방
   */

  if (!next.length) {

    finished = true;

    winner =
      playerIndex;

    /*
     * 다음 차례 플레이어.
     */

    loser =
      findNextPlayerIndex(
        room,
        playerIndex
      );


    room.game.finished =
      true;

    room.game.winner =
      winner;

    room.game.loser =
      loser;

  } else {

    /*
     * 다음 플레이어
     */

    room.game.turnPlayer =
      findNextPlayerIndex(
        room,
        playerIndex
      );
  }


  /*
   * 모든 플레이어에게 전달
   */

  const result = {

    ok: true,

    word,

    player:
      playerIndex,

    playerId:
      player.id,

    depth,

    nextCount:
      next.length,

    finished,

    winner,

    loser,

    currentWord:
      room.game.currentWord,

    nextTurn:
      room.game.turnPlayer,

    nextTurnId:
      room.players[
        room.game.turnPlayer
      ]?.id || null
  };


  io.to(room.code).emit(
    "wordPlayed",
    result
  );


  /*
   * 기존 클라이언트 호환용
   */

  io.to(room.code).emit(
    "word",
    result
  );


  emitRoomState(room);


  if (finished) {

    io.to(room.code).emit(
      "gameFinished",
      {
        ...result,

        winnerName:
          room.players[
            winner
          ]?.name || "",

        loserName:
          room.players[
            loser
          ]?.name || ""
      }
    );


    roomMessage(
      room,
      `${room.players[winner]?.name || "플레이어"}님이 승리했습니다.`
    );

  } else {

    roomMessage(
      room,
      `${player.name}님: ${word}`
    );
  }
}


/* =========================================================
   다음 플레이어
========================================================= */

function findNextPlayerIndex(
  room,
  currentIndex
) {

  const count =
    room.players.length;

  if (count <= 1) {
    return currentIndex;
  }


  /*
   * 일반적인 순환 턴.
   *
   * 0 -> 1 -> 2 -> 3 -> 0
   */

  for (
    let offset = 1;
    offset <= count;
    offset++
  ) {

    const next =
      (currentIndex + offset) %
      count;

    const player =
      room.players[next];

    if (
      player &&
      player.connected !== false
    ) {

      return next;
    }
  }


  return currentIndex;
}


/* =========================================================
   방 목록
========================================================= */

function getRoomList() {

  return [
    ...rooms.values()
  ].map(
    room => ({

      code:
        room.code,

      playerCount:
        room.players.length,

      maxPlayers:
        MAX_PLAYERS,

      started:
        room.started,

      canJoin:
        !room.started &&
        room.players.length <
          MAX_PLAYERS
    })
  );
}


/* =========================================================
   Socket.IO
========================================================= */

io.on(
  "connection",
  socket => {

    console.log(
      `연결: ${socket.id}`
    );


    /*
     * 연결 직후 서버 데이터 상태
     */

    socket.emit(
      "serverReady",
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


    /*
     * -----------------------------------------------------
     * 방 생성
     * -----------------------------------------------------
     */

    socket.on(
      "createRoom",
      payload => {

        let name = "";

        if (
          typeof payload ===
          "string"
        ) {

          name =
            payload;

        } else if (
          payload &&
          typeof payload === "object"
        ) {

          name =
            payload.name ||
            payload.playerName ||
            "";
        }

        createRoom(
          socket,
          name
        );
      }
    );


    /*
     * -----------------------------------------------------
     * 방 참가
     * -----------------------------------------------------
     */

    socket.on(
      "joinRoom",
      payload => {

        let code = "";
        let name = "";

        if (
          typeof payload ===
          "string"
        ) {

          code =
            payload;

        } else if (
          payload &&
          typeof payload === "object"
        ) {

          code =
            payload.code ||
            payload.roomCode ||
            "";

          name =
            payload.name ||
            payload.playerName ||
            "";
        }

        joinRoom(
          socket,
          code,
          name
        );
      }
    );


    /*
     * -----------------------------------------------------
     * 방 나가기
     * -----------------------------------------------------
     */

    socket.on(
      "leaveRoom",
      () => {

        const room =
          getRoomBySocket(socket);

        if (!room) {
          return;
        }

        leaveRoom(
          socket,
          room
        );
      }
    );


    /*
     * -----------------------------------------------------
     * 게임 시작
     * -----------------------------------------------------
     */

    socket.on(
      "startGame",
      () => {

        const room =
          getRoomBySocket(socket);

        startRoomGame(
          room,
          socket
        );
      }
    );


    /*
     * 호환용
     */

    socket.on(
      "start",
      () => {

        const room =
          getRoomBySocket(socket);

        startRoomGame(
          room,
          socket
        );
      }
    );


    /*
     * -----------------------------------------------------
     * 단어 제출
     * -----------------------------------------------------
     */

    socket.on(
      "submitWord",
      payload => {

        submitWord(
          socket,
          payload
        );
      }
    );


    /*
     * 호환용
     */

    socket.on(
      "playWord",
      payload => {

        submitWord(
          socket,
          payload
        );
      }
    );


    socket.on(
      "wordSubmit",
      payload => {

        submitWord(
          socket,
          payload
        );
      }
    );


    /*
     * -----------------------------------------------------
     * 방 상태 요청
     * -----------------------------------------------------
     */

    socket.on(
      "getRoomState",
      () => {

        const room =
          getRoomBySocket(socket);

        if (!room) {

          sendError(
            socket,
            "방에 참가하지 않았습니다.",
            "NOT_IN_ROOM"
          );

          return;
        }

        socket.emit(
          "roomState",
          getRoomState(room)
        );
      }
    );


    /*
     * -----------------------------------------------------
     * 방 목록
     * -----------------------------------------------------
     */

    socket.on(
      "getRooms",
      () => {

        socket.emit(
          "roomList",
          getRoomList()
        );
      }
    );


    /*
     * -----------------------------------------------------
     * disconnect
     * -----------------------------------------------------
     */

    socket.on(
      "disconnect",
      reason => {

        console.log(
          `연결 종료: ${socket.id} / ${reason}`
        );


        const room =
          getRoomBySocket(socket);


        if (!room) {
          return;
        }


        const index =
          getPlayerIndex(
            room,
            socket
          );


        if (index < 0) {
          return;
        }


        const player =
          room.players[index];


        /*
         * 게임 시작 전에는
         * 그냥 방에서 제거.
         */

        if (!room.started) {

          room.players.splice(
            index,
            1
          );


          roomMessage(
            room,
            `${player.name}님의 연결이 종료되었습니다.`
          );


          if (!room.players.length) {

            rooms.delete(
              room.code
            );

          } else {

            emitRoomState(room);
          }

          return;
        }


        /*
         * 게임 중이면
         * 연결 끊긴 플레이어를
         * 비활성 상태로 표시.
         *
         * 배열 인덱스를 유지해야
         * history의 player 번호가
         * 꼬이지 않는다.
         */

        player.connected =
          false;


        /*
         * 다른 플레이어가 있으면
         * 게임 종료.
         */

        if (
          room.game &&
          !room.game.finished
        ) {

          const winner =
            room.players.findIndex(
              p =>
                p.connected !== false
            );


          if (winner >= 0) {

            room.game.finished =
              true;

            room.game.winner =
              winner;

            room.game.loser =
              index;
          }
        }


        roomMessage(
          room,
          `${player.name}님의 연결이 종료되었습니다.`
        );


        emitRoomState(room);


        if (
          room.game &&
          room.game.finished
        ) {

          io.to(room.code).emit(
            "gameFinished",
            {
              finished: true,

              winner:
                room.game.winner,

              loser:
                room.game.loser,

              winnerName:
                room.players[
                  room.game.winner
                ]?.name || ""
            }
          );
        }
      }
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
      `ATTACK: ${
        Object.keys(
          ATTACK_DEPTH
        ).length.toLocaleString()
      }`
    );

    console.log(
      `MAX PLAYERS: ${MAX_PLAYERS}`
    );

    console.log(
      "========================================"
    );
  }
);


/* =========================================================
   종료 처리
========================================================= */

function shutdown() {

  console.log(
    "서버 종료 중..."
  );

  io.close();

  server.close(
    () => {
      process.exit(0);
    }
  );
}


process.on(
  "SIGTERM",
  shutdown
);

process.on(
  "SIGINT",
  shutdown
);


/* =========================================================
   디버깅용 공개
========================================================= */

module.exports = {

  app,

  server,

  io,

  rooms,

  normalizeWord,

  allowedFirstChars,

  canConnect,

  getCandidates,

  getAttackDepth,

  isWinningAttack,

  isLosingAttack,

  getRoomState
};
