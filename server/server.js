const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const {
  normalizeWord,
  createGame,
  playWord,
  chooseBotWord
} = require("./game");

const app = express();

const server = http.createServer(app);

const io = new Server(server);

const PORT =
  process.env.PORT || 3000;


/* =========================================================
   프로젝트 경로
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
   단어 로드
========================================================= */

function loadWordFile() {
  if (!fs.existsSync(WORD_FILE)) {
    throw new Error(
      `word.txt를 찾을 수 없습니다: ${WORD_FILE}`
    );
  }

  const text = fs.readFileSync(
    WORD_FILE,
    "utf8"
  );

  return new Set(
    text
      .split(/\r?\n/)
      .map(normalizeWord)
      .filter(Boolean)
  );
}


/* =========================================================
   attack.txt 파싱
========================================================= */

function loadAttackFile() {
  const result = {};

  if (!fs.existsSync(ATTACK_FILE)) {
    console.warn(
      "attack.txt를 찾을 수 없습니다. 공격 데이터 없이 실행합니다."
    );

    return result;
  }

  const text = fs.readFileSync(
    ATTACK_FILE,
    "utf8"
  );

  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(
      /^깊이\s+(\d+)\s*:\s*(.*)$/
    );

    if (!match) continue;

    const depth = Number(match[1]);

    const words = match[2]
      .split(",")
      .map(normalizeWord)
      .filter(Boolean);

    for (const word of words) {
      result[word] = depth;
    }
  }

  console.log(
    `attack.txt 로드 완료: ${Object.keys(result).length.toLocaleString()}개`
  );

  return result;
}


const WORDS = loadWordFile();
const ATTACK_DEPTH = loadAttackFile();

console.log(
  `word.txt 로드 완료: ${WORDS.size.toLocaleString()}개`
);


/* =========================================================
   클라이언트
========================================================= */

app.use(
  express.static(CLIENT_DIR)
);

app.get("/", (req, res) => {
  res.sendFile(
    path.join(CLIENT_DIR, "index.html")
  );
});


/* =========================================================
   API
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    words: WORDS.size,
    attacks: Object.keys(ATTACK_DEPTH).length
  });
});


app.get("/api/data", (req, res) => {
  res.json({
    ready: true,
    wordCount: WORDS.size,
    attackCount: Object.keys(ATTACK_DEPTH).length,
    dueum: DUEUM
  });
});


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
      code += chars[
        Math.floor(
          Math.random() * chars.length
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

  return rooms.get(
    socket.roomCode
  ) || null;
}


function roomState(room) {
  return {
    code: room.code,

    started: room.started,

    players: room.players.map(
      (p, i) => ({
        id: p.id,
        name: p.name,
        index: i
      })
    ),

    game: room.game
      ? {
          currentWord:
            room.game.currentWord,

          turnPlayer:
            room.game.turnPlayer,

          history:
            room.game.history
        }
      : null
  };
}


function broadcastRoom(room) {
  io.to(room.code).emit(
    "roomState",
    roomState(room)
  );
}


/* =========================================================
   싱글 게임
========================================================= */

function randomStartWord() {
  /*
   * 첫 단어가 바로 끝내는 공격 단어가 되지 않도록 한다.
   */

  const candidates = [];

  for (const word of WORDS) {
    if (ATTACK_DEPTH[word] != null) {
      continue;
    }

    const test = createGame({
      startChar: ""
    });

    const result = playWord(
      test,
      word,
      WORDS,
      DUEUM,
      ATTACK_DEPTH
    );

    if (
      result.ok &&
      !result.finished
    ) {
      candidates.push(word);
    }

    /*
     * 충분히 찾았으면 더 돌지 않는다.
     */
    if (candidates.length >= 300) {
      break;
    }
  }

  if (!candidates.length) {
    return [...WORDS][
      Math.floor(
        Math.random() * WORDS.size
      )
    ];
  }

  return candidates[
    Math.floor(
      Math.random() * candidates.length
    )
  ];
}


function getStrength(difficulty) {
  switch (Number(difficulty)) {
    case 1:
      return 0.25;

    case 2:
      return 0.38;

    case 3:
      return 0.50;

    case 4:
      return 0.65;

    case 5:
      return 0.80;

    default:
      return 0.50;
  }
}


/* =========================================================
   Socket.IO
========================================================= */

io.on("connection", socket => {

  console.log(
    "접속:",
    socket.id
  );


  /* =======================================================
     싱글 게임 시작
  ======================================================= */

  socket.on(
    "singleNewGame",
    data => {

      const difficulty =
        Number(data?.difficulty) || 3;

      const startWord =
        randomStartWord();

      const game =
        createGame();

      /*
       * 시작 단어를 플레이어가 먼저 낸 것으로 처리
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
        socket.emit(
          "singleError",
          "게임 시작에 실패했습니다."
        );

        return;
      }

      socket.singleGame = game;

      socket.singleDifficulty =
        difficulty;

      socket.emit(
        "singleStarted",
        {
          startWord,
          difficulty,

          currentWord:
            game.currentWord,

          turnPlayer:
            game.turnPlayer,

          history:
            game.history,

          depth:
            getAttackDepth(
              startWord,
              ATTACK_DEPTH
            ),

          nextCount:
            result.nextCount
        }
      );
    }
  );


  /* =======================================================
     싱글 단어 입력
  ======================================================= */

  socket.on(
    "singlePlay",
    data => {

      const game =
        socket.singleGame;

      if (!game) {
        socket.emit(
          "singleError",
          "먼저 새 게임을 시작해주세요."
        );

        return;
      }

      /*
       * 플레이어 = 0
       * AI = 1
       */

      if (game.turnPlayer !== 0) {
        socket.emit(
          "singleError",
          "지금은 AI의 차례입니다."
        );

        return;
      }

      const word =
        normalizeWord(data?.word);

      const result =
        playWord(
          game,
          word,
          WORDS,
          DUEUM,
          ATTACK_DEPTH
        );

      if (!result.ok) {
        socket.emit(
          "wordRejected",
          {
            mode: "single",
            reason: result.reason,
            allowed: result.allowed || []
          }
        );

        return;
      }

      socket.emit(
        "singleWordPlayed",
        {
          word,
          player: 0,
          depth:
            result.depth,
          nextCount:
            result.nextCount,
          history:
            game.history
        }
      );


      /*
       * 플레이어가 AI를 끝냈음
       */

      if (result.finished) {

        socket.emit(
          "singleFinished",
          {
            winner: 0,
            loser: 1,
            history:
              game.history
          }
        );

        return;
      }


      /*
       * AI 생각 시간
       */

      setTimeout(() => {

        if (
          !socket.singleGame ||
          socket.singleGame !== game ||
          game.finished
        ) {
          return;
        }

        if (game.turnPlayer !== 1) {
          return;
        }


        const strength =
          getStrength(
            socket.singleDifficulty
          );


        const aiWord =
          chooseBotWord({
            currentWord:
              game.currentWord,

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


        if (!aiWord) {

          game.finished = true;
          game.winner = 0;
          game.loser = 1;

          socket.emit(
            "singleFinished",
            {
              winner: 0,
              loser: 1,
              history:
                game.history
            }
          );

          return;
        }


        const aiResult =
          playWord(
            game,
            aiWord,
            WORDS,
            DUEUM,
            ATTACK_DEPTH
          );


        if (!aiResult.ok) {
          socket.emit(
            "singleError",
            "AI 처리 중 오류가 발생했습니다."
          );

          return;
        }


        socket.emit(
          "singleWordPlayed",
          {
            word: aiWord,

            player: 1,

            depth:
              aiResult.depth,

            nextCount:
              aiResult.nextCount,

            history:
              game.history
          }
        );


        if (
          aiResult.finished
        ) {

          socket.emit(
            "singleFinished",
            {
              winner:
                aiResult.winner,

              loser:
                aiResult.loser,

              history:
                game.history
            }
          );

          return;
        }

      }, 350);
    }
  );


  /* =======================================================
     온라인 방 만들기
  ======================================================= */

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
          ? data.name.trim().slice(0, 20)
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

      socket.join(code);
      socket.roomCode = code;

      socket.emit(
        "roomCreated",
        { code }
      );

      broadcastRoom(room);
    }
  );


  /* =======================================================
     온라인 방 참가
  ======================================================= */

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
          ? data.code.trim().toUpperCase()
          : "";

      const name =
        typeof data?.name === "string" &&
        data.name.trim()
          ? data.name.trim().slice(0, 20)
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

      socket.join(code);
      socket.roomCode = code;

      socket.emit(
        "joinedRoom",
        { code }
      );

      broadcastRoom(room);
    }
  );


  /* =======================================================
     온라인 시작
  ======================================================= */

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

      if (room.players.length !== 2) {
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

      room.game =
        createGame();

      room.started = true;

      io.to(room.code).emit(
        "onlineStarted",
        {
          turnPlayer:
            room.game.turnPlayer
        }
      );

      broadcastRoom(room);
    }
  );


  /* =======================================================
     온라인 단어 입력
  ======================================================= */

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
          p =>
            p.id === socket.id
        );

      if (
        playerIndex !==
        room.game.turnPlayer
      ) {
        socket.emit(
          "wordRejected",
          {
            mode: "online",
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
          ATTACK_DEPTH
        );

      if (!result.ok) {
        socket.emit(
          "wordRejected",
          {
            mode: "online",
            reason: result.reason,
            allowed:
              result.allowed || []
          }
        );

        return;
      }

      io.to(room.code).emit(
        "wordPlayed",
        {
          word: result.word,

          player:
            playerIndex,

          depth:
            result.depth,

          nextCount:
            result.nextCount,

          history:
            room.game.history,

          nextTurn:
            room.game.turnPlayer
        }
      );


      if (result.finished) {

        room.started = false;

        io.to(room.code).emit(
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

        broadcastRoom(room);
        return;
      }

      broadcastRoom(room);
    }
  );


  /* =======================================================
     방 나가기
  ======================================================= */

  socket.on(
    "leaveRoom",
    () => {

      const room =
        getRoom(socket);

      if (!room) return;

      room.players =
        room.players.filter(
          p =>
            p.id !== socket.id
        );

      socket.leave(room.code);
      socket.roomCode = null;

      if (!room.players.length) {
        rooms.delete(room.code);
        return;
      }

      room.started = false;
      room.game = null;

      io.to(room.code).emit(
        "roomMessage",
        "상대방이 방을 나갔습니다."
      );

      broadcastRoom(room);
    }
  );


  /* =======================================================
     연결 종료
  ======================================================= */

  socket.on(
    "disconnect",
    () => {

      console.log(
        "접속 종료:",
        socket.id
      );

      const room =
        getRoom(socket);

      if (!room) return;

      room.players =
        room.players.filter(
          p =>
            p.id !== socket.id
        );

      if (!room.players.length) {
        rooms.delete(room.code);
        return;
      }

      room.started = false;
      room.game = null;

      io.to(room.code).emit(
        "roomMessage",
        "상대방이 나갔습니다."
      );

      broadcastRoom(room);
    }
  );
});


/* =========================================================
   시작
========================================================= */

server.listen(
  PORT,
  () => {
    console.log(
      `끝말잇기 서버 실행: ${PORT}`
    );

    console.log(
      `단어: ${WORDS.size.toLocaleString()}개`
    );

    console.log(
      `공격: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
    );
  }
);
