const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const {
  normalizeWord,
  createGame,
  playWord
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
  Number(process.env.PORT) || 3000;

const ROOT =
  path.join(__dirname, "..");

const WORD_FILE =
  path.join(ROOT, "data", "word.txt");


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
let BY_FIRST = Object.create(null);


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

  for (
    const first of Object.keys(BY_FIRST)
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
    `word.txt 로드 완료: ${WORDS.size.toLocaleString()}개`
  );
}


loadWords();


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

    for (let i = 0; i < 6; i++) {
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
          id: player.id,
          name: player.name,
          index
        })
      ),

    game:
      room.game
        ? {
            currentWord:
              room.game.currentWord,

            turn:
              room.game.turn,

            history:
              room.game.history
          }
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
        player.id !== socket.id
    );

  socket.leave(
    room.code
  );

  socket.roomCode =
    null;


  // 방에 아무도 없으면 삭제
  if (room.players.length === 0) {
    rooms.delete(
      room.code
    );

    return;
  }


  // 한 명만 남으면 게임 종료
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


  broadcastRoom(room);
}


/* =========================================================
   정적 파일
========================================================= */

app.use(
  express.static(ROOT)
);


app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        ROOT,
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

      byFirst:
        BY_FIRST,

      attackDepth:
        {},

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

      dueum:
        DUEUM,

      wordCount:
        WORDS.size
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
      words: WORDS.size,
      rooms: rooms.size
    });
  }
);


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
              id: socket.id,
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


        if (room.players.length >= 2) {
          socket.emit(
            "errorMessage",
            "방이 가득 찼습니다."
          );

          return;
        }


        room.players.push({
          id: socket.id,
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
          socket.emit(
            "errorMessage",
            "먼저 방을 만들어야 합니다."
          );

          return;
        }


        if (room.players.length !== 2) {
          socket.emit(
            "errorMessage",
            "플레이어 2명이 모두 들어와야 합니다."
          );

          return;
        }


        // 방장만 시작 가능
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


        room.game =
          createGame();

        room.started =
          true;


        io
          .to(room.code)
          .emit(
            "onlineStarted"
          );


        broadcastRoom(room);
      }
    );


    /* -----------------------------------------------------
       단어 입력
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


        if (playerIndex < 0) {
          socket.emit(
            "errorMessage",
            "플레이어 정보를 찾을 수 없습니다."
          );

          return;
        }


        // 서버에서 차례 검사
        if (
          room.game.turn !==
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


        const result =
          playWord(
            room.game,
            word,
            WORDS,
            DUEUM
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


        // 정상 입력
        io
          .to(room.code)
          .emit(
            "wordPlayed",
            {
              word:
                result.word,

              player:
                playerIndex,

              currentWord:
                room.game.currentWord,

              history:
                room.game.history,

              nextTurn:
                room.game.turn
            }
          );


        // 게임 종료
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


          broadcastRoom(room);

          return;
        }


        broadcastRoom(room);
      }
    );


    /* -----------------------------------------------------
       방 나가기
    ----------------------------------------------------- */

    socket.on(
      "leaveRoom",
      () => {
        leaveRoom(socket);
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

        leaveRoom(socket);
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
      `끝말잇기 서버 실행: http://localhost:${PORT}`
    );

    console.log(
      `단어 수: ${WORDS.size.toLocaleString()}개`
    );
  }
);
