"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const {
  normalizeWord,
  allowedFirstChars,
  canConnect,
  getCandidates,
  getCandidatesFromChar,
  getAttackDepth,
  analyzeWord,
  createGame,
  playWord,
  chooseBotWord,
  getPublicGameState
} = require("./game");


/* =========================================================
   기본 설정
========================================================= */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;

const ROOT = path.join(__dirname, "..");

const CLIENT_DIR = path.join(ROOT, "client");
const DATA_DIR = path.join(ROOT, "data");

const WORD_FILE = path.join(DATA_DIR, "word.txt");
const ATTACK_FILE = path.join(DATA_DIR, "attack.txt");


app.use(express.json());


/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
  "녀": ["여"],
  "년": ["연"],
  "녈": ["열"],
  "녹": ["록"],
  "논": ["론"],
  "뇨": ["요"],
  "뉴": ["유"],
  "니": ["이"],

  "랴": ["야"],
  "려": ["여"],
  "례": ["예"],
  "료": ["요"],
  "류": ["유"],
  "리": ["이"],

  "라": ["나"],
  "래": ["내"],
  "로": ["노"],
  "뢰": ["뇌"],
  "루": ["누"],
  "르": ["느"]
};


/* =========================================================
   단어 데이터
========================================================= */

let WORDS = new Set();

let BY_FIRST = {};

let ATTACK_DEPTH = {};


/* =========================================================
   단어 로드
========================================================= */

function loadWordFile() {
  if (!fs.existsSync(WORD_FILE)) {
    console.error("");
    console.error("========================================");
    console.error("word.txt를 찾을 수 없습니다.");
    console.error(WORD_FILE);
    console.error("========================================");
    console.error("");

    process.exit(1);
  }

  const text = fs.readFileSync(
    WORD_FILE,
    "utf8"
  );

  const set = new Set();

  for (const line of text.split(/\r?\n/)) {
    const word = normalizeWord(line);

    if (word) {
      set.add(word);
    }
  }

  WORDS = set;

  BY_FIRST = {};

  for (const word of WORDS) {
    const first = word.at(0);

    if (!first) {
      continue;
    }

    if (!BY_FIRST[first]) {
      BY_FIRST[first] = [];
    }

    BY_FIRST[first].push(word);
  }

  for (const first of Object.keys(BY_FIRST)) {
    BY_FIRST[first].sort((a, b) =>
      a.localeCompare(b, "ko")
    );
  }

  console.log(
    `word.txt 로드 완료: ${WORDS.size.toLocaleString()}개`
  );
}


/* =========================================================
   attack.txt 로드
========================================================= */

/*
 * 지원 형식:
 *
 * 가녘 1
 * 가녘: 1
 * 가녘\t1
 * 1 : 가녘
 * 깊이 1 : 가녘, 가믐, 가마솣
 * [가]
 * 깊이 1 : 가녘, 가믐
 *
 * 네가 보여준 attack.txt 형식도 처리한다.
 */

function loadAttackFile() {
  ATTACK_DEPTH = {};

  if (!fs.existsSync(ATTACK_FILE)) {
    console.warn(
      "attack.txt를 찾을 수 없습니다. AI는 일반 단어 기준으로 작동합니다."
    );

    return;
  }

  const text = fs.readFileSync(
    ATTACK_FILE,
    "utf8"
  );

  let currentDepth = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    /*
     * 예:
     * 깊이 1 : 가녘, 가믐
     */
    const depthGroup =
      line.match(
        /^깊이\s*(\d+)\s*[:：]\s*(.+)$/
      );

    if (depthGroup) {
      const depth = Number(depthGroup[1]);
      const words = depthGroup[2]
        .split(",")
        .map(normalizeWord)
        .filter(Boolean);

      currentDepth = depth;

      for (const word of words) {
        ATTACK_DEPTH[word] = depth;
      }

      continue;
    }


    /*
     * 예:
     * 깊이 1
     */
    const depthOnly =
      line.match(
        /^깊이\s*(\d+)\s*$/
      );

    if (depthOnly) {
      currentDepth = Number(depthOnly[1]);
      continue;
    }


    /*
     * [가] 같은 글자 그룹
     */
    if (
      line.startsWith("[") &&
      line.endsWith("]")
    ) {
      continue;
    }


    /*
     * 일반 형식:
     * 가녘 1
     * 가녘:1
     * 가녘 : 1
     */
    const wordDepth =
      line.match(
        /^(.+?)\s*[:：,\t ]\s*(\d+)$/
      );

    if (wordDepth) {
      const word = normalizeWord(
        wordDepth[1]
      );

      const depth = Number(
        wordDepth[2]
      );

      if (word && Number.isFinite(depth)) {
        ATTACK_DEPTH[word] = depth;
      }

      continue;
    }


    /*
     * 현재 깊이가 지정되어 있는 경우
     * 한 줄에 단어 하나인 형식도 지원
     */
    if (currentDepth != null) {
      const word = normalizeWord(line);

      /*
       * "깊이"나 설명문은 제외
       */
      if (
        word &&
        !word.startsWith("깊이") &&
        WORDS.has(word)
      ) {
        ATTACK_DEPTH[word] =
          currentDepth;
      }
    }
  }

  console.log(
    `attack.txt 로드 완료: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
  );
}


loadWordFile();
loadAttackFile();


/* =========================================================
   정적 파일
========================================================= */

app.use(
  express.static(CLIENT_DIR)
);


/* =========================================================
   메인 페이지
========================================================= */

app.get("/", (req, res) => {
  const indexPath =
    path.join(
      CLIENT_DIR,
      "index.html"
    );

  if (!fs.existsSync(indexPath)) {
    return res.status(500).send(
      "client/index.html을 찾을 수 없습니다."
    );
  }

  res.sendFile(indexPath);
});


/* =========================================================
   API 데이터
========================================================= */

app.get("/api/data", (req, res) => {
  res.json({
    ready: true,

    wordCount:
      WORDS.size,

    attackCount:
      Object.keys(ATTACK_DEPTH).length,

    /*
     * 클라이언트에서 필요한 경우 사용
     */
    byFirst: BY_FIRST,

    attackDepth:
      ATTACK_DEPTH,

    dueum:
      DUEUM,

    startFirst: [
      "가",
      "나",
      "다",
      "마",
      "사",
      "자",
      "기",
      "시"
    ]
  });
});


/* =========================================================
   Health Check
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    words: WORDS.size,
    attacks:
      Object.keys(ATTACK_DEPTH).length,
    rooms: rooms.size
  });
});


/* =========================================================
   시작 단어 후보
========================================================= */

app.get(
  "/api/start-words",
  (req, res) => {
    const candidates = [];

    for (const word of WORDS) {
      /*
       * 공격 깊이가 홀수인 공격 단어는
       * 시작 단어로 쓰지 않는다.
       */
      if (
        getAttackDepth(
          word,
          ATTACK_DEPTH
        ) != null
      ) {
        continue;
      }

      /*
       * 첫 수부터 게임이 끝나는 단어도 제외
       */
      const next =
        getCandidates(
          word,
          new Set([word]),
          WORDS,
          DUEUM
        );

      if (next.length === 0) {
        continue;
      }

      candidates.push(word);
    }

    /*
     * 너무 큰 배열을 매번 보내지 않음
     */
    const result = [];

    const count = Math.min(
      1000,
      candidates.length
    );

    for (let i = 0; i < count; i++) {
      const index =
        Math.floor(
          Math.random() *
          candidates.length
        );

      result.push(
        candidates[index]
      );
    }

    res.json({
      words: result
    });
  }
);


/* =========================================================
   싱글 게임
========================================================= */

function makeSingleGame() {
  /*
   * 시작 단어는 안전한 일반 단어에서 선택
   */
  const candidates = [];

  for (const word of WORDS) {
    const depth =
      getAttackDepth(
        word,
        ATTACK_DEPTH
      );

    /*
     * attack.txt에 들어간 단어는
     * 시작 단어에서 제외
     */
    if (depth != null) {
      continue;
    }

    const next =
      getCandidates(
        word,
        new Set([word]),
        WORDS,
        DUEUM
      );

    if (next.length === 0) {
      continue;
    }

    candidates.push(word);
  }

  if (!candidates.length) {
    return null;
  }

  const startWord =
    candidates[
      Math.floor(
        Math.random() *
        candidates.length
      )
    ];

  const game =
    createGame({
      startChar: "",
      startPlayer: 0
    });

  /*
   * 시작 단어를 먼저 넣는다.
   */
  const result =
    playWord(
      game,
      startWord,
      WORDS,
      DUEUM,
      ATTACK_DEPTH
    );

  if (!result.ok) {
    return null;
  }

  return {
    game,
    startWord
  };
}


/* =========================================================
   새 싱글 게임 API
========================================================= */

app.post(
  "/api/new-game",
  (req, res) => {
    const result =
      makeSingleGame();

    if (!result) {
      return res.status(500).json({
        ok: false,
        reason:
          "게임을 시작할 수 있는 단어를 찾지 못했습니다."
      });
    }

    res.json({
      ok: true,

      startWord:
        result.startWord,

      game:
        getPublicGameState(
          result.game
        ),

      dueum:
        DUEUM
    });
  }
);


/* =========================================================
   싱글 AI
========================================================= */

/*
 * AI 난이도는 기존 5단계를 없애고
 * 하나의 "끝말잇기 AI" 시스템으로 사용한다.
 *
 * strength는 고정 0.50 근처에서 상황에 따라 조절.
 */

function calculateBotStrength(
  game
) {
  /*
   * 기본값
   */
  let strength = 0.50;

  if (!game || !game.currentWord) {
    return strength;
  }

  const candidates =
    getCandidates(
      game.currentWord,
      game.usedWords,
      WORDS,
      DUEUM
    );

  if (!candidates.length) {
    return 1;
  }


  /*
   * 현재 선택지 수
   */
  const count =
    candidates.length;


  /*
   * 선택지가 적으면
   * 봇이 공격적으로 움직일 수 있음
   */
  if (count === 0) {
    strength = 1.0;
  } else if (count === 1) {
    strength = 0.85;
  } else if (count <= 3) {
    strength = 0.70;
  } else if (count <= 10) {
    strength = 0.58;
  } else {
    strength = 0.50;
  }


  /*
   * 전체 게임 길이에 따른 약간의 조절
   */
  const turn =
    game.history.length;

  if (turn <= 2) {
    strength -= 0.08;
  }

  if (turn >= 20) {
    strength += 0.05;
  }


  return Math.max(
    0.35,
    Math.min(
      0.90,
      strength
    )
  );
}


/* =========================================================
   AI 수 계산
========================================================= */

function getBotMove(game) {
  if (!game) {
    return null;
  }

  const strength =
    calculateBotStrength(game);

  return chooseBotWord({
    currentWord:
      game.currentWord,

    startChar:
      game.startChar,

    usedWords:
      game.usedWords,

    words:
      WORDS,

    dueum:
      DUEUM,

    attackDepth:
      ATTACK_DEPTH,

    strength
  });
}


/* =========================================================
   싱글 단어 입력 API
========================================================= */

app.post(
  "/api/play",
  (req, res) => {
    /*
     * 클라이언트가 매번 game 전체를 보내는 방식.
     *
     * 실제 싱글 게임 상태는 서버 세션을 쓰지 않고
     * 요청 기반으로 처리할 수 있도록 설계.
     *
     * 현재 프로젝트에서는 아래 API보다
     * 브라우저의 로컬 게임 상태를 사용하는 경우도 있음.
     */

    const body =
      req.body || {};

    const word =
      normalizeWord(
        body.word
      );

    if (!word) {
      return res.status(400).json({
        ok: false,
        reason:
          "단어를 입력해주세요."
      });
    }

    /*
     * 단순 검증 API
     */
    if (!WORDS.has(word)) {
      return res.json({
        ok: false,
        reason:
          "단어 목록에 없는 단어입니다."
      });
    }

    res.json({
      ok: true,
      word
    });
  }
);


/* =========================================================
   온라인 방
========================================================= */

const rooms = new Map();


function makeRoomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

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


function getRoom(socket) {
  if (!socket.roomCode) {
    return null;
  }

  return (
    rooms.get(
      socket.roomCode
    ) || null
  );
}


/* =========================================================
   방 상태
========================================================= */

function getRoomState(room) {
  return {
    code:
      room.code,

    started:
      room.started,

    players:
      room.players.map(
        (player, index) => ({
          id:
            player.id,

          name:
            player.name,

          index
        })
      ),

    game:
      getPublicGameState(
        room.game
      )
  };
}


function broadcastRoom(room) {
  io
    .to(room.code)
    .emit(
      "roomState",
      getRoomState(room)
    );
}


/* =========================================================
   방 나가기
========================================================= */

function leaveRoom(socket) {
  const room =
    getRoom(socket);

  if (!room) {
    return;
  }

  room.players =
    room.players.filter(
      player =>
        player.id !==
        socket.id
    );

  socket.leave(
    room.code
  );

  socket.roomCode =
    null;


  if (room.players.length === 0) {
    rooms.delete(
      room.code
    );

    return;
  }


  /*
   * 한 명만 남으면 게임 초기화
   */
  room.started = false;
  room.game = null;


  const remaining =
    room.players[0];

  const remainingSocket =
    io.sockets.sockets.get(
      remaining.id
    );

  if (remainingSocket) {
    remainingSocket.emit(
      "roomMessage",
      "상대방이 방을 나갔습니다."
    );
  }


  broadcastRoom(room);
}


/* =========================================================
   Socket.IO
========================================================= */

io.on(
  "connection",
  socket => {

    console.log(
      "접속:",
      socket.id
    );


    /* =====================================================
       방 만들기
    ===================================================== */

    socket.on(
      "createRoom",
      data => {

        if (socket.roomCode) {
          socket.emit(
            "errorMessage",
            "이미 방에 참가하고 있습니다."
          );

          return;
        }


        const name =
          typeof data?.name === "string" &&
          data.name.trim()
            ? data.name
                .trim()
                .slice(0, 20)
            : "Player";


        const code =
          makeRoomCode();


        const room = {
          code,

          players: [
            {
              id:
                socket.id,

              name
            }
          ],

          started: false,

          game: null
        };


        rooms.set(
          code,
          room
        );


        socket.join(
          code
        );

        socket.roomCode =
          code;


        socket.emit(
          "roomCreated",
          {
            code
          }
        );


        broadcastRoom(
          room
        );
      }
    );


    /* =====================================================
       방 참가
    ===================================================== */

    socket.on(
      "joinRoom",
      data => {

        if (socket.roomCode) {
          socket.emit(
            "errorMessage",
            "이미 방에 참가하고 있습니다."
          );

          return;
        }


        const code =
          typeof data?.code === "string"
            ? data.code
                .trim()
                .toUpperCase()
            : "";


        const name =
          typeof data?.name === "string" &&
          data.name.trim()
            ? data.name
                .trim()
                .slice(0, 20)
            : "Player";


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


        room.players.push({
          id:
            socket.id,

          name
        });


        socket.join(
          code
        );

        socket.roomCode =
          code;


        socket.emit(
          "joinedRoom",
          {
            code
          }
        );


        broadcastRoom(
          room
        );
      }
    );


    /* =====================================================
       온라인 게임 시작
    ===================================================== */

    socket.on(
      "startOnline",
      () => {

        const room =
          getRoom(socket);


        if (!room) {
          socket.emit(
            "errorMessage",
            "먼저 방을 만들어야 합니다."
          );

          return;
        }


        if (
          room.players.length !== 2
        ) {
          socket.emit(
            "errorMessage",
            "플레이어 2명이 모두 들어와야 합니다."
          );

          return;
        }


        /*
         * 방장만 시작
         */
        if (
          room.players[0].id !==
          socket.id
        ) {
          socket.emit(
            "errorMessage",
            "방장만 게임을 시작할 수 있습니다."
          );

          return;
        }


        /*
         * 첫 플레이어는 랜덤으로 결정
         */
        const startPlayer =
          Math.random() < 0.5
            ? 0
            : 1;


        room.game =
          createGame({
            startChar: "",
            startPlayer
          });


        room.started =
          true;


        io
          .to(room.code)
          .emit(
            "onlineStarted",
            {
              firstPlayer:
                startPlayer
            }
          );


        broadcastRoom(
          room
        );
      }
    );


    /* =====================================================
       온라인 단어 입력
    ===================================================== */

    socket.on(
      "playWord",
      data => {

        const room =
          getRoom(socket);


        if (!room) {
          socket.emit(
            "errorMessage",
            "방에 참가하지 않았습니다."
          );

          return;
        }


        if (
          !room.started ||
          !room.game
        ) {
          socket.emit(
            "errorMessage",
            "게임이 시작되지 않았습니다."
          );

          return;
        }


        const playerIndex =
          room.players.findIndex(
            player =>
              player.id ===
              socket.id
          );


        if (playerIndex < 0) {
          socket.emit(
            "errorMessage",
            "플레이어 정보를 찾을 수 없습니다."
          );

          return;
        }


        /*
         * 차례 검사
         */
        if (
          room.game.turnPlayer !==
          playerIndex
        ) {
          socket.emit(
            "wordRejected",
            {
              reason:
                "지금은 당신의 차례가 아닙니다."
            }
          );

          return;
        }


        const word =
          normalizeWord(
            data?.word
          );


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


        const result =
          playWord(
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
                result.allowed || []
            }
          );

          return;
        }


        /*
         * 정상 입력
         */
        io
          .to(room.code)
          .emit(
            "wordPlayed",
            {
              word:
                result.word,

              player:
                playerIndex,

              depth:
                result.depth,

              currentWord:
                room.game.currentWord,

              nextTurn:
                room.game.turnPlayer,

              history:
                room.game.history
            }
          );


        /*
         * 종료
         */
        if (result.finished) {

          room.started =
            false;


          io
            .to(room.code)
            .emit(
              "gameFinished",
              {
                winner:
                  result.winner,

                loser:
                  result.loser,

                history:
                  room.game.history
              }
            );


          room.game =
            null;


          broadcastRoom(
            room
          );

          return;
        }


        broadcastRoom(
          room
        );
      }
    );


    /* =====================================================
       방 나가기
    ===================================================== */

    socket.on(
      "leaveRoom",
      () => {
        leaveRoom(socket);
      }
    );


    /* =====================================================
       연결 종료
    ===================================================== */

    socket.on(
      "disconnect",
      () => {

        console.log(
          "접속 종료:",
          socket.id
        );

        leaveRoom(
          socket
        );
      }
    );
  }
);


/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {

    /*
     * API 요청이면 JSON으로 응답.
     *
     * 이 부분이 없으면
     * fetch("/api/...")
     * 실패 시 HTML 404 페이지가 반환되어
     *
     * Unexpected token '<'
     *
     * 문제가 발생하기 쉬움.
     */
    if (
      req.path.startsWith("/api/")
    ) {
      return res.status(404).json({
        ok: false,
        reason:
          "존재하지 않는 API입니다."
      });
    }

    res.status(404).send(
      "페이지를 찾을 수 없습니다."
    );
  }
);


/* =========================================================
   서버 시작
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      "끝말잇기 서버 실행"
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      `WORDS: ${WORDS.size.toLocaleString()}`
    );

    console.log(
      `ATTACK: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}`
    );

    console.log(
      `CLIENT: ${CLIENT_DIR}`
    );

    console.log(
      `WORD FILE: ${WORD_FILE}`
    );

    console.log(
      `ATTACK FILE: ${ATTACK_FILE}`
    );

    console.log(
      "========================================"
    );

    console.log("");
  }
);
