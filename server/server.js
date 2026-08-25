"use strict";

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

const server =
  http.createServer(app);

const io =
  new Server(server, {
    cors: {
      origin: "*"
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
   데이터
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

/*
 * 서버에서도 클라이언트와 동일한
 * 두음법칙을 사용한다.
 *
 * 필요하면 여기의 데이터를
 * 실제 script.js의 DUEUM과
 * 완전히 동일하게 맞추면 된다.
 */

DUEUM = {

  "녀": ["녀", "여"],
  "년": ["년", "연"],
  "녈": ["녈", "열"],
  "념": ["념", "염"],
  "녕": ["녕", "영"],
  "뇨": ["뇨", "요"],
  "뉴": ["뉴", "유"],
  "뉵": ["뉵", "육"],

  "니": ["니", "이"],
  "냐": ["냐", "야"],
  "냥": ["냥", "양"],

  "녀": ["녀", "여"],
  "녜": ["녜", "예"],

  "려": ["려", "여"],
  "례": ["례", "예"],
  "료": ["료", "요"],
  "류": ["류", "유"],
  "리": ["리", "이"],
  "랴": ["랴", "야"],
  "례": ["례", "예"],

  "렬": ["렬", "열"],
  "련": ["련", "연"],
  "렴": ["렴", "염"],
  "령": ["령", "영"],

  "례": ["례", "예"],

  "라": ["라", "나"],
  "락": ["락", "낙"],
  "란": ["란", "난"],
  "랄": ["랄", "날"],
  "람": ["람", "남"],
  "랍": ["랍", "납"],
  "랑": ["랑", "낭"],

  "로": ["로", "노"],
  "록": ["록", "녹"],
  "론": ["론", "논"],
  "롤": ["롤", "놀"],
  "롬": ["롬", "놈"],
  "롭": ["롭", "놉"],
  "롱": ["롱", "농"],

  "루": ["루", "누"],
  "륙": ["륙", "육"],

  "릉": ["릉", "능"],

  "리": ["리", "이"],

  "마": ["마"],
  "바": ["바"],
  "사": ["사"],
  "자": ["자"],
  "차": ["차"],
  "카": ["카"],
  "타": ["타"],
  "파": ["파"],
  "하": ["하"]
};


/* =========================================================
   단어 정규화
========================================================= */

function normalizeWord(word) {

  return gameEngine
    .normalizeWord(word);
}


/* =========================================================
   데이터 로드
========================================================= */

function loadData() {

  console.log("단어 데이터 로딩 시작...");


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


  /* -------------------------------------------------------
     word.txt
  ------------------------------------------------------- */

  const wordText =
    fs.readFileSync(
      WORD_FILE,
      "utf8"
    );


  const wordLines =
    wordText
      .split(/\r?\n/)
      .map(normalizeWord)
      .filter(Boolean);


  WORDS =
    new Set(wordLines);


  /* -------------------------------------------------------
     첫 글자 인덱스
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     attack.txt
  ------------------------------------------------------- */

  const attackText =
    fs.readFileSync(
      ATTACK_FILE,
      "utf8"
    );


  ATTACK_DEPTH =
    Object.create(null);


  const attackLines =
    attackText.split(/\r?\n/);


  for (const line of attackLines) {

    const trimmed =
      line.trim();


    if (!trimmed) {
      continue;
    }


    /*
     * 일반적인 형태:
     *
     * 가녘 1
     * 가마깥 3
     *
     * 탭이나 여러 공백도 허용
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
      Object.keys(ATTACK_DEPTH).length.toLocaleString()
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
   API 데이터
========================================================= */

app.get(
  "/api/data",
  (req, res) => {

    if (!DATA_LOADED) {

      return res
        .status(503)
        .json({
          error:
            "단어 데이터가 아직 준비되지 않았습니다."
        });
    }


    /*
     * byFirst를 그대로 보내서
     * 클라이언트가 매번 50만 단어를
     * 다시 처리하지 않도록 한다.
     */

    res.json({

      byFirst:
        BY_FIRST,

      attackDepth:
        ATTACK_DEPTH,

      dueum:
        DUEUM,

      /*
       * 시작 글자로 사용할 수 있는
       * 첫 글자 목록
       */
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
   기본 페이지
========================================================= */

app.get("/{*splat}", (req, res) => {

    res.sendFile(
      path.join(
        CLIENT_DIR,
        "index.html"
      )
    );
  }
);


/* =========================================================
   방 관리
========================================================= */

const rooms =
  new Map();


/*
 * 방 코드 생성
 */

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
   방 공개 상태
========================================================= */

function getRoomState(room) {

  if (!room) {
    return null;
  }


  return {

    code:
      room.code,

    players:
      room.players.map(
        player => ({
          id:
            player.id,

          name:
            player.name
        })
      ),

    started:
      room.started,

    startChar:
      room.game?.startChar ||
      "",

    currentWord:
      room.game?.currentWord ||
      null,

    turnPlayer:
      room.game?.turnPlayer ??
      0,

    history:
      room.game
        ? room.game.history.map(
            item => ({
              word:
                item.word,

              player:
                item.player,

              turn:
                item.turn,

              depth:
                item.depth
            })
          )
        : [],

    finished:
      room.game?.finished ||
      false,

    winner:
      room.game?.winner ??
      null,

    loser:
      room.game?.loser ??
      null
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
   방 찾기
========================================================= */

function getRoomBySocket(socket) {

  for (const room of rooms.values()) {

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
   소켓의 플레이어 번호
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
   방 생성
========================================================= */

function createRoom(
  socket,
  name
) {

  /*
   * 이미 다른 방에 있다면
   * 기존 방을 나간다.
   */

  const oldRoom =
    getRoomBySocket(socket);


  if (oldRoom) {

    leaveRoom(
      socket,
      oldRoom
    );
  }


  const code =
    generateRoomCode();


  const cleanName =
    normalizeWord(name) ||
    "Player";


  const room = {

    code,

    players: [
      {
        id:
          socket.id,

        name:
          cleanName
      }
    ],

    started: false,

    game: null
  };


  rooms.set(
    code,
    room
  );


  socket.join(code);


  socket.emit(
    "roomCreated",
    {
      code
    }
  );


  emitRoomState(room);


  console.log(
    `방 생성: ${code} / ${cleanName}`
  );
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
    String(
      code || ""
    )
      .trim()
      .toUpperCase();


  const room =
    rooms.get(code);


  if (!room) {

    socket.emit(
      "errorMessage",
      "존재하지 않는 방입니다."
    );

    return;
  }


  if (
    room.players.length >= 2
  ) {

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


  /*
   * 다른 방에 있었다면
   * 먼저 기존 방을 정리한다.
   */

  const oldRoom =
    getRoomBySocket(socket);


  if (oldRoom) {

    leaveRoom(
      socket,
      oldRoom
    );
  }


  const cleanName =
    normalizeWord(name) ||
    "Player";


  room.players.push({

    id:
      socket.id,

    name:
      cleanName
  });


  socket.join(code);


  socket.emit(
    "joinedRoom",
    {
      code
    }
  );


  emitRoomState(room);


  io.to(code).emit(
    "roomMessage",
    `${cleanName}님이 방에 참가했습니다.`
  );


  console.log(
    `방 참가: ${code} / ${cleanName}`
  );
}


/* =========================================================
   방 나가기
========================================================= */

function leaveRoom(
  socket,
  room
) {

  if (!room) {
    return;
  }


  const index =
    getPlayerIndex(
      room,
      socket
    );


  if (index >= 0) {

    const player =
      room.players[index];


    room.players.splice(
      index,
      1
    );


    socket.leave(
      room.code
    );


    io.to(room.code).emit(
      "roomMessage",
      `${
        player?.name ||
        "Player"
      }님이 나갔습니다.`
    );
  }


  /*
   * 게임이 시작된 뒤 한 명이 나가면
   * 남은 플레이어의 승리로 처리한다.
   */

  if (
    room.started &&
    room.game &&
    !room.game.finished &&
    room.players.length === 1
  ) {

    const remainingIndex =
      0;


    room.game.finished = true;

    room.game.winner =
      remainingIndex;

    room.game.loser =
      index === 0
        ? 0
        : 1;


    io.to(room.code).emit(
      "onlineFinished",
      {
        winner:
          remainingIndex,

        reason:
          "상대방이 게임을 나갔습니다.",

        state:
          getRoomState(room)
      }
    );
  }


  /*
   * 아무도 없으면 방 삭제
   */

  if (
    room.players.length === 0
  ) {

    rooms.delete(
      room.code
    );

    console.log(
      `방 삭제: ${room.code}`
    );

    return;
  }


  /*
   * 게임 시작 전이면
   * 다시 시작 가능한 상태로 유지.
   */

  if (
    !room.started
  ) {

    room.game = null;
  }


  emitRoomState(room);
}


/* =========================================================
   온라인 시작 단어
========================================================= */

function getSafeOnlineStartWord() {

  const firstChars =
    Object.keys(
      BY_FIRST
    );


  if (!firstChars.length) {
    return null;
  }


  /*
   * 시작 단어는
   *
   * 1. 실제 word.txt에 존재
   * 2. attack.txt에 없음
   * 3. 첫 단어부터 즉사하지 않음
   *
   * 을 만족해야 한다.
   */

  const shuffled =
    [...firstChars];


  for (
    let i =
      shuffled.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );


    [
      shuffled[i],
      shuffled[j]
    ] =
    [
      shuffled[j],
      shuffled[i]
    ];
  }


  /*
   * 여러 글자에서 시도
   */

  for (
    const first of shuffled
  ) {

    const list =
      BY_FIRST[first];


    if (
      !Array.isArray(list) ||
      !list.length
    ) {
      continue;
    }


    /*
     * 무작위 일부를 먼저 확인
     */

    const attempts =
      Math.min(
        list.length,
        200
      );


    for (
      let i = 0;
      i < attempts;
      i++
    ) {

      const word =
        list[
          Math.floor(
            Math.random() *
            list.length
          )
        ];


      /*
       * 공격 단어 제외
       */

      if (
        gameEngine.getAttackDepth(
          word,
          ATTACK_DEPTH
        ) != null
      ) {
        continue;
      }


      /*
       * 첫 단어 이후 상대에게
       * 최소 한 수 이상 있어야 한다.
       */

      const next =
        gameEngine.getCandidates(
          word,
          new Set([word]),
          WORDS,
          DUEUM
        );


      if (!next.length) {
        continue;
      }


      return word;
    }
  }


  /*
   * 최후의 안전 검사
   */

  for (
    const first of shuffled
  ) {

    const list =
      BY_FIRST[first];


    if (!Array.isArray(list)) {
      continue;
    }


    for (
      const word of list
    ) {

      if (
        gameEngine.getAttackDepth(
          word,
          ATTACK_DEPTH
        ) != null
      ) {
        continue;
      }


      const next =
        gameEngine.getCandidates(
          word,
          new Set([word]),
          WORDS,
          DUEUM
        );


      if (next.length) {
        return word;
      }
    }
  }


  return null;
}


/* =========================================================
   온라인 게임 시작
========================================================= */

function startRoomGame(
  socket
) {

  const room =
    getRoomBySocket(socket);


  if (!room) {

    socket.emit(
      "errorMessage",
      "먼저 방에 참가해주세요."
    );

    return;
  }


  const playerIndex =
    getPlayerIndex(
      room,
      socket
    );


  if (playerIndex !== 0) {

    socket.emit(
      "errorMessage",
      "방장만 게임을 시작할 수 있습니다."
    );

    return;
  }


  if (
    room.players.length !== 2
  ) {

    socket.emit(
      "errorMessage",
      "플레이어 2명이 있어야 시작할 수 있습니다."
    );

    return;
  }


  if (room.started) {

    socket.emit(
      "errorMessage",
      "이미 게임이 시작되었습니다."
    );

    return;
  }


  const startWord =
    getSafeOnlineStartWord();


  if (!startWord) {

    socket.emit(
      "errorMessage",
      "안전한 시작 단어를 찾지 못했습니다."
    );

    return;
  }


  /*
   * 온라인 게임은
   * 시작 단어를 방장이 먼저 사용하는 방식.
   */

  room.game =
    gameEngine.createGame({
      startChar:
        startWord.at(0),

      startPlayer:
        0
    });


  /*
   * 서버 엔진으로 시작 단어 등록.
   */

  const result =
    gameEngine.playWord(
      room.game,
      startWord,
      WORDS,
      DUEUM,
      ATTACK_DEPTH
    );


  if (!result.ok) {

    room.game = null;


    socket.emit(
      "errorMessage",
      "게임 시작 중 오류가 발생했습니다."
    );

    return;
  }


  room.started = true;


  /*
   * 시작 단어는 이미 방장이 냈으므로
   * 실제 다음 턴은 플레이어 2.
   */

  io.to(room.code).emit(
    "onlineStarted",
    {
      state:
        getRoomState(room),

      startWord,

      turnPlayer:
        room.game.turnPlayer
    }
  );


  emitRoomState(room);


  console.log(
    `게임 시작: ${room.code} / ${startWord}`
  );
}


/* =========================================================
   온라인 단어 처리
========================================================= */

function playOnlineWord(
  socket,
  rawWord
) {

  const room =
    getRoomBySocket(socket);


  if (!room) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "방에 참가되어 있지 않습니다."
      }
    );

    return;
  }


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


  if (!room.game) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "게임 정보를 찾을 수 없습니다."
      }
    );

    return;
  }


  if (room.game.finished) {

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
    getPlayerIndex(
      room,
      socket
    );


  if (playerIndex < 0) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "플레이어 정보를 찾을 수 없습니다."
      }
    );

    return;
  }


  /*
   * 턴 검사는 반드시 서버에서 한다.
   */

  if (
    room.game.turnPlayer !==
    playerIndex
  ) {

    socket.emit(
      "wordRejected",
      {
        reason:
          "지금은 상대방 차례입니다."
      }
    );

    return;
  }


  const word =
    normalizeWord(rawWord);


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


  /*
   * 실제 게임 엔진을 통해
   * 단어를 검증하고 등록한다.
   */

  const result =
    gameEngine.playWord(
      room.game,
      word,
      WORDS,
      DUEUM,
      ATTACK_DEPTH
    );


  if (!result.ok) {

    socket.emit(
      "wordRejected",
      {
        reason:
          result.reason,

        allowed:
          result.allowed || null
      }
    );

    return;
  }


  /*
   * 모든 플레이어에게 동일한 결과 전달
   */

  io.to(room.code).emit(
    "wordPlayed",
    {
      word:
        result.word,

      player:
        playerIndex,

      depth:
        result.depth,

      nextTurn:
        result.nextTurn,

      finished:
        result.finished,

      winner:
        result.winner,

      loser:
        result.loser,

      state:
        getRoomState(room)
    }
  );


  /*
   * 게임 종료
   */

  if (result.finished) {

    room.started = false;


    io.to(room.code).emit(
      "onlineFinished",
      {
        winner:
          result.winner,

        loser:
          result.loser,

        state:
          getRoomState(room)
      }
    );


    emitRoomState(room);

    return;
  }


  emitRoomState(room);
}


/* =========================================================
   Socket.IO
========================================================= */

io.on(
  "connection",
  socket => {

    console.log(
      `Socket 연결: ${socket.id}`
    );


    /* -----------------------------------------------------
       방 생성
    ----------------------------------------------------- */

    socket.on(
      "createRoom",
      data => {

        createRoom(
          socket,
          data?.name
        );
      }
    );


    /* -----------------------------------------------------
       방 참가
    ----------------------------------------------------- */

    socket.on(
      "joinRoom",
      data => {

        joinRoom(
          socket,
          data?.code,
          data?.name
        );
      }
    );


    /* -----------------------------------------------------
       게임 시작
    ----------------------------------------------------- */

    socket.on(
      "startOnline",
      () => {

        startRoomGame(
          socket
        );
      }
    );


    /*
     * 혹시 기존 클라이언트가
     * startGame이라는 이름으로 보내더라도
     * 호환
     */

    socket.on(
      "startGame",
      () => {

        startRoomGame(
          socket
        );
      }
    );


    /* -----------------------------------------------------
       단어
    ----------------------------------------------------- */

    socket.on(
      "playWord",
      data => {

        playOnlineWord(
          socket,
          data?.word
        );
      }
    );


    /* -----------------------------------------------------
       상태 요청
    ----------------------------------------------------- */

    socket.on(
      "requestRoomState",
      () => {

        const room =
          getRoomBySocket(socket);


        if (room) {

          socket.emit(
            "roomState",
            getRoomState(room)
          );
        }
      }
    );


    /* -----------------------------------------------------
       연결 종료
    ----------------------------------------------------- */

    socket.on(
      "disconnect",
      () => {

        const room =
          getRoomBySocket(socket);


        if (room) {

          leaveRoom(
            socket,
            room
          );
        }


        console.log(
          `Socket 종료: ${socket.id}`
        );
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
      `끝말잇기 서버 실행: ${PORT}`
    );

    console.log(
      `단어: ${WORDS.size.toLocaleString()}개`
    );

    console.log(
      `공격: ${
        Object.keys(
          ATTACK_DEPTH
        ).length.toLocaleString()
      }개`
    );

    console.log(
      "========================================"
    );
  }
);
