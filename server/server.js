"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const {
  normalizeWord,
  allowedFirstChars,
  getCandidates,
  getAttackDepth,
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

const PORT =
  process.env.PORT || 3000;

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

let WORD_INDEX = {};

let ATTACK_DEPTH = {};


/* =========================================================
   word.txt 로드
========================================================= */

function loadWords() {
  if (!fs.existsSync(WORD_FILE)) {
    console.error(
      "word.txt를 찾을 수 없습니다:",
      WORD_FILE
    );

    process.exit(1);
  }

  const text =
    fs.readFileSync(
      WORD_FILE,
      "utf8"
    );

  WORDS =
    new Set(
      text
        .split(/\r?\n/)
        .map(normalizeWord)
        .filter(Boolean)
    );


  WORD_INDEX = {};


  for (const word of WORDS) {
    const first =
      word.at(0);

    if (!first) {
      continue;
    }

    if (!WORD_INDEX[first]) {
      WORD_INDEX[first] = [];
    }

    WORD_INDEX[first].push(word);
  }


  /*
   * 가나다순 정렬
   */

  for (
    const first of Object.keys(
      WORD_INDEX
    )
  ) {
    WORD_INDEX[first].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "ko"
        )
    );
  }


  console.log(
    `word.txt 로드 완료: ${WORDS.size.toLocaleString()}개`
  );
}


/* =========================================================
   attack.txt 파서
========================================================= */

/*
 * 입력 형식:
 *
 * [가]
 * 깊이 1 : 가녘, 가믐, 가마솣
 * 깊이 3 : 가레갊, 가걔
 *
 * 결과:
 *
 * ATTACK_DEPTH["가녘"] = 1
 * ATTACK_DEPTH["가믐"] = 1
 * ATTACK_DEPTH["가레갊"] = 3
 */

function loadAttackWords() {
  if (!fs.existsSync(ATTACK_FILE)) {
    console.warn(
      "attack.txt를 찾을 수 없습니다:",
      ATTACK_FILE
    );

    ATTACK_DEPTH = {};

    return;
  }


  const text =
    fs.readFileSync(
      ATTACK_FILE,
      "utf8"
    );


  const lines =
    text.split(/\r?\n/);


  const result = {};


  for (const rawLine of lines) {
    const line =
      rawLine.trim();


    if (!line) {
      continue;
    }


    /*
     * [가]
     * 같은 그룹 표시이므로
     * 실제 데이터 처리에는 필요 없음.
     */

    if (
      line.startsWith("[") &&
      line.endsWith("]")
    ) {
      continue;
    }


    /*
     * 깊이 N : 단어1, 단어2
     */

    const match =
      line.match(
        /^깊이\s+(\d+)\s*:\s*(.*)$/
      );


    if (!match) {
      continue;
    }


    const depth =
      Number(match[1]);


    if (!Number.isFinite(depth)) {
      continue;
    }


    const words =
      match[2]
        .split(",")
        .map(normalizeWord)
        .filter(Boolean);


    for (const word of words) {
      /*
       * 공격 파일에 있는 단어만 저장
       */

      result[word] = depth;
    }
  }


  ATTACK_DEPTH =
    result;


  console.log(
    `attack.txt 로드 완료: ${Object.keys(
      ATTACK_DEPTH
    ).length.toLocaleString()}개`
  );
}


/* =========================================================
   데이터 로드
========================================================= */

loadWords();
loadAttackWords();


/* =========================================================
   클라이언트
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
   데이터 API
========================================================= */

app.get(
  "/api/data",
  (req, res) => {
    res.json({
      ready: true,

      wordCount:
        WORDS.size,

      /*
       * 클라이언트에는 전체 단어를
       * 보내지 않는다.
       *
       * 싱글 AI는 서버에서 처리한다.
       */

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
  }
);


/* =========================================================
   Health Check
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
   싱글 게임 API
========================================================= */

app.post(
  "/api/single/start",
  (req, res) => {
    const difficulty =
      Math.max(
        1,
        Math.min(
          5,
          Number(
            req.body?.difficulty
          ) || 3
        )
      );


    const startFirst =
      [
        "가",
        "나",
        "다",
        "마",
        "사",
        "자",
        "기",
        "시"
      ];


    const startChar =
      startFirst[
        Math.floor(
          Math.random() *
          startFirst.length
        )
      ];


    const game =
      createGame({
        startChar,
        startPlayer: 0
      });


    /*
     * 서버는 게임 ID를 만들고
     * 메모리에 보관한다.
     */

    const id =
      Math.random()
        .toString(36)
        .slice(2) +
      Date.now()
        .toString(36);


    singleGames.set(
      id,
      {
        game,
        difficulty
      }
    );


    /*
     * 너무 오래된 게임 방지
     */

    if (
      singleGames.size > 1000
    ) {
      const first =
        singleGames.keys().next().value;

      singleGames.delete(first);
    }


    res.json({
      ok: true,

      id,

      startChar,

      state:
        getPublicGameState(
          game
        )
    });
  }
);


/* =========================================================
   싱글 단어 입력
========================================================= */

app.post(
  "/api/single/play",
  (req, res) => {
    const id =
      typeof req.body?.id === "string"
        ? req.body.id
        : "";


    const item =
      singleGames.get(id);


    if (!item) {
      return res.json({
        ok: false,
        reason:
          "게임을 찾을 수 없습니다."
      });
    }


    const {
      game,
      difficulty
    } = item;


    /*
     * 플레이어 차례인지 검사
     */

    if (
      game.turnPlayer !== 0
    ) {
      return res.json({
        ok: false,
        reason:
          "지금은 AI의 차례입니다."
      });
    }


    const result =
      playWord(
        game,
        req.body?.word,
        WORDS,
        DUEUM,
        ATTACK_DEPTH,
        WORD_INDEX
      );


    if (!result.ok) {
      return res.json(
        result
      );
    }


    /*
     * 플레이어가 바로 승리
     */

    if (result.finished) {
      return res.json({
        ok: true,

        finished: true,

        result,

        state:
          getPublicGameState(
            game
          )
      });
    }


    /*
     * AI 차례
     */

    const aiWord =
      chooseBotWord({
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

        wordIndex:
          WORD_INDEX,

        strength:
          getDifficultyStrength(
            difficulty
          ),

        botWinRate:
          getBotWinRate(
            game
          )
      });


    /*
     * AI가 낼 수가 없음
     */

    if (!aiWord) {
      game.finished = true;

      game.winner = 0;
      game.loser = 1;

      return res.json({
        ok: true,

        finished: true,

        result: {
          ok: true,
          finished: true,
          winner: 0,
          loser: 1
        },

        aiWord: null,

        state:
          getPublicGameState(
            game
          )
      });
    }


    /*
     * AI 단어 실제 적용
     */

    const aiResult =
      playWord(
        game,
        aiWord,
        WORDS,
        DUEUM,
        ATTACK_DEPTH,
        WORD_INDEX
      );


    if (!aiResult.ok) {
      console.error(
        "AI 단어 적용 실패:",
        aiResult
      );

      return res.json({
        ok: false,
        reason:
          "AI 단어 처리 중 오류가 발생했습니다."
      });
    }


    res.json({
      ok: true,

      playerResult:
        result,

      aiWord,

      aiResult,

      finished:
        aiResult.finished,

      state:
        getPublicGameState(
          game
        )
    });
  }
);


/* =========================================================
   싱글 게임 데이터
========================================================= */

const singleGames =
  new Map();


/*
 * 난이도 → 강도
 */

function getDifficultyStrength(
  difficulty
) {
  switch (Number(difficulty)) {
    case 1:
      return 0.25;

    case 2:
      return 0.38;

    case 3:
      return 0.50;

    case 4:
      return 0.70;

    case 5:
      return 0.90;

    default:
      return 0.50;
  }
}


/*
 * 현재까지의 봇 승률
 *
 * 단일 게임 중에는
 * 아직 실제 누적 전적이 없으므로
 * 기본값 50%.
 */

function getBotWinRate(game) {
  if (!game.games) {
    return 0.5;
  }

  const total =
    game.botWins +
    game.playerWins;

  if (!total) {
    return 0.5;
  }

  return (
    game.botWins /
    total
  );
}


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
      room.game
        ? getPublicGameState(
            room.game
          )
        : null
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


  if (
    room.players.length === 0
  ) {
    rooms.delete(
      room.code
    );

    return;
  }


  room.started =
    false;

  room.game =
    null;


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


  broadcastRoom(
    room
  );
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


    /* -----------------------------------------------------
       방 참가
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       온라인 시작
    ----------------------------------------------------- */

    socket.on(
      "startOnline",
      () => {

        const room =
          getRoom(socket);


        if (!room) {
          socket.emit(
            "errorMessage",
            "먼저 방에 참가해주세요."
          );

          return;
        }


        if (
          room.players.length !== 2
        ) {
          socket.emit(
            "errorMessage",
            "플레이어 2명이 필요합니다."
          );

          return;
        }


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
         * 온라인은 방장이 먼저
         */

        room.game =
          createGame({
            startChar: "",
            startPlayer: 0
          });


        room.started =
          true;


        io
          .to(room.code)
          .emit(
            "onlineStarted"
          );


        broadcastRoom(
          room
        );
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


        if (
          playerIndex < 0
        ) {
          socket.emit(
            "errorMessage",
            "플레이어 정보를 찾을 수 없습니다."
          );

          return;
        }


        /*
         * 서버에서 차례 검사
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


        const result =
          playWord(
            room.game,
            data?.word,
            WORDS,
            DUEUM,
            ATTACK_DEPTH,
            WORD_INDEX
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
         * 모두에게 정상 입력 전달
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

              history:
                room.game.history,

              nextTurn:
                room.game.turnPlayer
            }
          );


        /*
         * 게임 종료
         */

        if (
          result.finished
        ) {
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


    /* -----------------------------------------------------
       방 나가기
    ----------------------------------------------------- */

    socket.on(
      "leaveRoom",
      () => {
        leaveRoom(
          socket
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
   서버 시작
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `끝말잇기 서버 실행: ${PORT}`
    );

    console.log(
      `단어 수: ${WORDS.size.toLocaleString()}`
    );

    console.log(
      `공격 단어 수: ${Object.keys(
        ATTACK_DEPTH
      ).length.toLocaleString()}`
    );
  }
);
