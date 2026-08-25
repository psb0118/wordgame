"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const {
  normalizeWord,
  createGame,
  playWord,
  chooseBotWord,
  getCandidates,
  getAttackDepth,
  getPublicGameState
} = require("./game");


/* =========================================================
   기본 설정
========================================================= */

const app = express();

const server =
  http.createServer(app);

const io =
  new Server(server);

const PORT =
  process.env.PORT || 3000;

const ROOT =
  path.join(__dirname, "..");

const CLIENT_DIR =
  path.join(
    ROOT,
    "client"
  );

const DATA_DIR =
  path.join(
    ROOT,
    "data"
  );

const WORD_FILE =
  path.join(
    DATA_DIR,
    "word.txt"
  );

const ATTACK_FILE =
  path.join(
    DATA_DIR,
    "attack.txt"
  );


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
   데이터
========================================================= */

let WORDS = new Set();
let ATTACK_DEPTH = {};
let BY_FIRST = {};


function loadData() {
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
   * 전체 단어
   */
  const wordText =
    fs.readFileSync(
      WORD_FILE,
      "utf8"
    );

  WORDS =
    new Set(
      wordText
        .split(/\r?\n/)
        .map(normalizeWord)
        .filter(Boolean)
    );


  /*
   * 공격 단어
   *
   * 지원:
   *
   * 단어 5
   * 단어\t5
   *
   * 또는
   *
   * 단어,5
   */
  const attackText =
    fs.readFileSync(
      ATTACK_FILE,
      "utf8"
    );

  ATTACK_DEPTH = {};

  for (
    const rawLine of
    attackText.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (!line) continue;

    let word = "";
    let depth = null;


    /*
     * 쉼표
     */
    if (line.includes(",")) {
      const parts =
        line.split(",");

      word =
        normalizeWord(
          parts[0]
        );

      depth =
        Number(
          parts[1]
        );
    }

    /*
     * 탭
     */
    else if (line.includes("\t")) {
      const parts =
        line.split(/\t+/);

      word =
        normalizeWord(
          parts[0]
        );

      depth =
        Number(
          parts[1]
        );
    }

    /*
     * 공백
     */
    else {
      const parts =
        line.split(/\s+/);

      word =
        normalizeWord(
          parts[0]
        );

      depth =
        Number(
          parts[1]
        );
    }


    if (
      word &&
      Number.isFinite(depth)
    ) {
      ATTACK_DEPTH[word] =
        depth;
    }
  }


  /*
   * 첫 글자별 분류
   */
  BY_FIRST = {};

  for (const word of WORDS) {
    const first =
      word.at(0);

    if (!first) continue;

    if (!BY_FIRST[first]) {
      BY_FIRST[first] = [];
    }

    BY_FIRST[first].push(word);
  }


  for (
    const first of
    Object.keys(BY_FIRST)
  ) {
    BY_FIRST[first].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "ko"
        )
    );
  }


  console.log(
    `전체 단어: ${WORDS.size.toLocaleString()}개`
  );

  console.log(
    `공격 단어: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
  );
}


loadData();


/* =========================================================
   정적 파일
========================================================= */

app.use(
  express.json()
);

app.use(
  express.static(
    CLIENT_DIR
  )
);


app.get(
  "/",
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
   API
========================================================= */

app.get(
  "/api/data",
  (req, res) => {
    res.json({
      ready: true,

      wordCount:
        WORDS.size,

      attackCount:
        Object.keys(
          ATTACK_DEPTH
        ).length,

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
      ],

      /*
       * 클라이언트가 공격 깊이를
       * 표시할 수 있도록 전달
       */
      attackDepth:
        ATTACK_DEPTH
    });
  }
);


/* =========================================================
   싱글플레이
========================================================= */

const singleGames =
  new Map();


function makeId() {
  return (
    Date.now()
      .toString(36) +
    Math.random()
      .toString(36)
      .slice(2)
  );
}


/*
 * 난이도 → 기본 봇 강도
 */
function difficultyStrength(level) {
  const values = {
    1: 0.25,
    2: 0.38,
    3: 0.50,
    4: 0.65,
    5: 0.80
  };

  return (
    values[
      Number(level)
    ] ?? 0.50
  );
}


/*
 * 시작 단어용 첫 글자
 */
function randomStartChar() {
  const chars = [
    "가",
    "나",
    "다",
    "마",
    "사",
    "자",
    "기",
    "시"
  ];

  return (
    chars[
      Math.floor(
        Math.random() *
        chars.length
      )
    ]
  );
}


/*
 * 시작 단어 생성
 */
function findStartWord(
  startChar,
  game
) {
  const candidates =
    BY_FIRST[
      startChar
    ] || [];

  if (!candidates.length) {
    return null;
  }


  /*
   * 첫 단어에서 바로 끝나는 단어를
   * 최대한 피한다.
   */
  const safe =
    candidates.filter(
      word => {
        const next =
          getCandidates(
            word,
            game.usedWords,
            WORDS,
            DUEUM
          );

        return (
          next.length > 0 &&
          getAttackDepth(
            word,
            ATTACK_DEPTH
          ) == null
        );
      }
    );


  const source =
    safe.length
      ? safe
      : candidates;


  return source[
    Math.floor(
      Math.random() *
      source.length
    )
  ];
}


/*
 * 싱글 게임 시작
 */
app.post(
  "/api/single/start",
  (req, res) => {
    const level =
      Number(
        req.body?.difficulty
      ) || 3;

    const id =
      makeId();

    const startChar =
      randomStartChar();


    const game =
      createGame({
        startChar,
        startPlayer: 0
      });


    /*
     * 실제 시작 단어를
     * 서버가 하나 넣는다.
     */
    const startWord =
      findStartWord(
        startChar,
        game
      );


    if (!startWord) {
      return res.status(500)
        .json({
          ok: false,
          message:
            "시작 단어를 찾을 수 없습니다."
        });
    }


    const result =
      playWord(
        game,
        startWord,
        WORDS,
        DUEUM,
        ATTACK_DEPTH
      );


    if (!result.ok) {
      return res.status(500)
        .json({
          ok: false,
          message:
            result.reason
        });
    }


    singleGames.set(
      id,
      {
        game,
        level,
        wins: 0,
        losses: 0
      }
    );


    res.json({
      ok: true,
      id,

      startWord,

      state:
        getPublicGameState(
          game
        )
    });
  }
);


/*
 * 싱글 단어 입력
 */
app.post(
  "/api/single/play",
  (req, res) => {
    const id =
      String(
        req.body?.id || ""
      );

    const item =
      singleGames.get(id);


    if (!item) {
      return res.status(404)
        .json({
          ok: false,
          message:
            "게임을 찾을 수 없습니다."
        });
    }


    const result =
      playWord(
        item.game,
        req.body?.word,
        WORDS,
        DUEUM,
        ATTACK_DEPTH
      );


    if (!result.ok) {
      return res.json({
        ok: false,
        reason:
          result.reason,

        allowed:
          result.allowed || []
      });
    }


    /*
     * 플레이어가 이긴 경우
     */
    if (result.finished) {
      item.wins++;

      return res.json({
        ok: true,

        finished: true,

        result,

        state:
          getPublicGameState(
            item.game
          )
      });
    }


    /*
     * 이제 AI 차례
     */
    const strength =
      difficultyStrength(
        item.level
      );


    const botWord =
      chooseBotWord({
        currentWord:
          item.game.currentWord,

        startChar:
          item.game.startChar,

        usedWords:
          item.game.usedWords,

        words:
          WORDS,

        dueum:
          DUEUM,

        attackDepth:
          ATTACK_DEPTH,

        strength
      });


    if (!botWord) {
      /*
       * AI가 낼 수 없으면
       * 플레이어 승리
       */
      item.game.finished = true;
      item.game.winner = 0;
      item.game.loser = 1;

      item.wins++;

      return res.json({
        ok: true,

        finished: true,

        botWord: null,

        result,

        state:
          getPublicGameState(
            item.game
          )
      });
    }


    const botResult =
      playWord(
        item.game,
        botWord,
        WORDS,
        DUEUM,
        ATTACK_DEPTH
      );


    res.json({
      ok: true,

      finished:
        botResult.finished,

      playerResult:
        result,

      botResult,

      botWord,

      botDepth:
        getAttackDepth(
          botWord,
          ATTACK_DEPTH
        ),

      botNextCount:
        botResult.nextCount,

      state:
        getPublicGameState(
          item.game
        )
    });
  }
);


/* =========================================================
   온라인 방
========================================================= */

const rooms =
  new Map();


function makeRoomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = "";

    for (
      let i = 0;
      i < 6;
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


function roomState(room) {
  return {
    code:
      room.code,

    started:
      room.started,

    players:
      room.players.map(
        (p, index) => ({
          id: p.id,
          name: p.name,
          index
        })
      ),

    game:
      room.game
        ? getPublicGameState(
            room.game
          )
        : null
  };
}


function broadcastRoom(room) {
  io.to(
    room.code
  ).emit(
    "roomState",
    roomState(room)
  );
}


function leaveRoom(socket) {
  const room =
    getRoom(socket);

  if (!room) return;


  room.players =
    room.players.filter(
      p =>
        p.id !==
        socket.id
    );


  socket.leave(
    room.code
  );

  socket.roomCode =
    null;


  if (!room.players.length) {
    rooms.delete(
      room.code
    );

    return;
  }


  room.started = false;
  room.game = null;


  io.to(
    room.code
  ).emit(
    "roomMessage",
    "상대방이 방을 나갔습니다."
  );


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


    /* -----------------------------------------------------
       방 만들기
    ----------------------------------------------------- */

    socket.on(
      "createRoom",
      data => {

        if (socket.roomCode) {
          return socket.emit(
            "errorMessage",
            "이미 방에 참가 중입니다."
          );
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


        broadcastRoom(room);
      }
    );


    /* -----------------------------------------------------
       방 참가
    ----------------------------------------------------- */

    socket.on(
      "joinRoom",
      data => {

        if (socket.roomCode) {
          return socket.emit(
            "errorMessage",
            "이미 방에 참가 중입니다."
          );
        }


        const code =
          String(
            data?.code || ""
          )
            .trim()
            .toUpperCase();


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
          return socket.emit(
            "errorMessage",
            "존재하지 않는 방입니다."
          );
        }


        if (
          room.players.length >= 2
        ) {
          return socket.emit(
            "errorMessage",
            "방이 가득 찼습니다."
          );
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


        broadcastRoom(room);
      }
    );


    /* -----------------------------------------------------
       게임 시작
    ----------------------------------------------------- */

    socket.on(
      "startOnline",
      () => {

        const room =
          getRoom(socket);


        if (!room) {
          return socket.emit(
            "errorMessage",
            "먼저 방에 참가해주세요."
          );
        }


        if (
          room.players.length !== 2
        ) {
          return socket.emit(
            "errorMessage",
            "플레이어 2명이 필요합니다."
          );
        }


        if (
          room.players[0].id !==
          socket.id
        ) {
          return socket.emit(
            "errorMessage",
            "방장만 시작할 수 있습니다."
          );
        }


        const startChar =
          randomStartChar();


        room.game =
          createGame({
            startChar,
            startPlayer: 0
          });


        room.started = true;


        io.to(
          room.code
        ).emit(
          "onlineStarted",
          {
            startChar
          }
        );


        broadcastRoom(room);
      }
    );


    /* -----------------------------------------------------
       온라인 단어 입력
    ----------------------------------------------------- */

    socket.on(
      "playWord",
      data => {

        const room =
          getRoom(socket);


        if (!room) {
          return socket.emit(
            "errorMessage",
            "방에 참가하지 않았습니다."
          );
        }


        if (
          !room.started ||
          !room.game
        ) {
          return socket.emit(
            "errorMessage",
            "게임이 시작되지 않았습니다."
          );
        }


        const playerIndex =
          room.players.findIndex(
            p =>
              p.id ===
              socket.id
          );


        if (
          playerIndex < 0
        ) {
          return;
        }


        /*
         * 서버에서 차례 검사
         */
        if (
          room.game.turnPlayer !==
          playerIndex
        ) {
          return socket.emit(
            "wordRejected",
            {
              reason:
                "지금은 당신의 차례가 아닙니다."
            }
          );
        }


        const result =
          playWord(
            room.game,
            data?.word,
            WORDS,
            DUEUM,
            ATTACK_DEPTH
          );


        if (!result.ok) {
          return socket.emit(
            "wordRejected",
            {
              reason:
                result.reason,

              allowed:
                result.allowed || []
            }
          );
        }


        io.to(
          room.code
        ).emit(
          "wordPlayed",
          {
            word:
              result.word,

            player:
              playerIndex,

            depth:
              result.depth,

            nextCount:
              result.nextCount,

            state:
              getPublicGameState(
                room.game
              )
          }
        );


        if (result.finished) {

          room.started =
            false;


          io.to(
            room.code
          ).emit(
            "gameFinished",
            {
              winner:
                result.winner,

              loser:
                result.loser,

              state:
                getPublicGameState(
                  room.game
                )
            }
          );


          broadcastRoom(room);

          return;
        }


        broadcastRoom(room);
      }
    );


    /* -----------------------------------------------------
       나가기
    ----------------------------------------------------- */

    socket.on(
      "leaveRoom",
      () => {
        leaveRoom(socket);
      }
    );


    /* -----------------------------------------------------
       종료
    ----------------------------------------------------- */

    socket.on(
      "disconnect",
      () => {

        console.log(
          "접속 종료:",
          socket.id
        );

        leaveRoom(socket);
      }
    );
  }
);


/* =========================================================
   Health
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,

      words:
        WORDS.size,

      attacks:
        Object.keys(
          ATTACK_DEPTH
        ).length,

      rooms:
        rooms.size
    });
  }
);


/* =========================================================
   서버 시작
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `끝말잇기 서버 실행: PORT ${PORT}`
    );

    console.log(
      `단어: ${WORDS.size.toLocaleString()}개`
    );

    console.log(
      `공격: ${Object.keys(
        ATTACK_DEPTH
      ).length.toLocaleString()}개`
    );
  }
);
