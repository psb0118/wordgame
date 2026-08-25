"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

const express = require("express");
const { Server } = require("socket.io");


/* =========================================================
   경로
========================================================= */

const ROOT = path.join(__dirname, "..");

const CLIENT_DIR =
  path.join(ROOT, "client");

const DATA_DIR =
  path.join(ROOT, "data");

const WORD_FILE =
  path.join(DATA_DIR, "word.txt");

const ATTACK_FILE =
  path.join(DATA_DIR, "attack.txt");

const WORD_FILE = path.join(DATA_DIR, "word.txt");
const ATTACK_FILE = path.join(DATA_DIR, "attack.txt");


/* =========================================================
   Express
========================================================= */

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});


app.use(
  express.static(ROOT)
);


/* =========================================================
   데이터
========================================================= */

let words = new Set();

let byFirst = Object.create(null);

let attackDepth = Object.create(null);

let dueum = Object.create(null);

let startFirst = [];

let dataReady = false;


/* =========================================================
   두음법칙
========================================================= */

dueum = {

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

  "량": ["량", "양"],
  "려": ["려", "여"],
  "력": ["력", "역"],
  "련": ["련", "연"],
  "렬": ["렬", "열"],
  "렴": ["렴", "염"],
  "령": ["령", "영"],

  "례": ["례", "예"],
  "로": ["로", "노"],
  "론": ["론", "논"],
  "뢰": ["뢰", "뇌"],
  "료": ["료", "요"],
  "룡": ["룡", "용"],

  "륙": ["륙", "육"],
  "률": ["률", "율"],
  "륭": ["륭", "융"],
  "리": ["리", "이"],

  "림": ["림", "임"],
  "립": ["립", "입"],

  "래": ["래", "내"],
  "냬": ["냬", "얘"],
  "녜": ["녜", "예"],
  "늬": ["늬", "의"]
};


/* =========================================================
   기본 함수
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

  const result =
    new Set([lastChar]);


  const direct =
    dueum[lastChar];

  if (Array.isArray(direct)) {

    for (const char of direct) {

      if (char) {
        result.add(char);
      }
    }
  }


  /*
   * 역방향
   *
   * 예:
   * 녀 -> 여
   *
   * 마지막 글자가 여라면
   * 녀도 허용
   */

  for (
    const [from, values]
    of Object.entries(dueum)
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
      : new Set(
          usedWords || []
        );


  const chars =
    allowedFirstChars(
      previousWord.at(-1)
    );


  const result = [];


  for (const char of chars) {

    const list =
      byFirst[char] || [];


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
   attack.txt
========================================================= */

/*
 * 지원 형식
 *
 * 1.
 * 가녘 1
 *
 * 2.
 * 가녘: 1
 *
 * 3.
 * 깊이 1 : 가녘, 가믐, 가마솣
 *
 * 4.
 * [가]
 * 깊이 1 : 가녘, 가믐
 *
 * attack.txt에는 공격 단어만 들어있으므로
 * 여기에 등록된 단어만 공격 단어로 취급한다.
 */

function loadAttackFile() {

  attackDepth =
    Object.create(null);


  if (!fs.existsSync(ATTACK_FILE)) {

    console.warn(
      "[WARNING] attack.txt를 찾지 못했습니다."
    );

    return;
  }


  const text =
    fs.readFileSync(
      ATTACK_FILE,
      "utf8"
    );


  const lines =
    text.split(/\r?\n/);


  let currentDepth = null;


  for (let raw of lines) {

    let line =
      raw.trim();


    if (!line) {
      continue;
    }


    /*
     * [가]
     * 같은 제목은 무시
     */

    if (
      line.startsWith("[") &&
      line.endsWith("]")
    ) {
      continue;
    }


    /*
     * 깊이 1 : 단어, 단어
     */

    const depthMatch =
      line.match(
        /^깊이\s*(\d+)\s*:\s*(.*)$/
      );


    if (depthMatch) {

      currentDepth =
        Number(
          depthMatch[1]
        );


      const wordText =
        depthMatch[2]
          .trim();


      if (wordText) {

        const list =
          wordText
            .split(",")
            .map(normalizeWord)
            .filter(Boolean);


        for (const word of list) {

          attackDepth[word] =
            currentDepth;
        }
      }


      continue;
    }


    /*
     * 깊이만 적힌 경우
     */

    const onlyDepth =
      line.match(
        /^깊이\s*(\d+)\s*:?\s*$/
      );


    if (onlyDepth) {

      currentDepth =
        Number(
          onlyDepth[1]
        );

      continue;
    }


    /*
     * "단어 깊이"
     */

    const wordDepth =
      line.match(
        /^(.+?)\s*[:：]\s*(\d+)$/
      );


    if (wordDepth) {

      const word =
        normalizeWord(
          wordDepth[1]
        );

      const depth =
        Number(
          wordDepth[2]
        );


      if (word) {
        attackDepth[word] =
          depth;
      }

      continue;
    }


    /*
     * 현재 깊이가 있는 상태에서
     * 콤마로 이어진 단어들
     */

    if (
      currentDepth != null &&
      line.includes(",")
    ) {

      const list =
        line
          .split(",")
          .map(normalizeWord)
          .filter(Boolean);


      for (const word of list) {

        attackDepth[word] =
          currentDepth;
      }
    }
  }


  console.log(
    `[DATA] 공격 단어 ${Object.keys(attackDepth).length.toLocaleString()}개 로드`
  );
}


/* =========================================================
   word.txt 로드
========================================================= */

function loadWordFile() {

  if (!fs.existsSync(WORD_FILE)) {

    throw new Error(
      `word.txt를 찾을 수 없습니다: ${WORD_FILE}`
    );
  }


  const text =
    fs.readFileSync(
      WORD_FILE,
      "utf8"
    );


  const lines =
    text.split(/\r?\n/);


  words =
    new Set();


  byFirst =
    Object.create(null);


  for (const raw of lines) {

    const word =
      normalizeWord(raw);


    if (!word) {
      continue;
    }


    /*
     * 혹시 word.txt에
     * 빈 줄이나 중복이 있어도 자동 처리
     */

    if (words.has(word)) {
      continue;
    }


    words.add(word);


    const first =
      word.at(0);


    if (!byFirst[first]) {
      byFirst[first] = [];
    }


    byFirst[first].push(word);
  }


  startFirst =
    Object.keys(byFirst);


  console.log(
    `[DATA] 전체 단어 ${words.size.toLocaleString()}개 로드`
  );


  console.log(
    `[DATA] 시작 글자 ${startFirst.length}개`
  );
}


/* =========================================================
   데이터 전체 초기화
========================================================= */

function loadAllData() {

  console.time(
    "[DATA] 데이터 로드"
  );


  loadWordFile();

  loadAttackFile();


  dataReady = true;


  console.timeEnd(
    "[DATA] 데이터 로드"
  );
}


/* =========================================================
   시작 단어
========================================================= */

function getRandomStartWord() {

  if (!dataReady) {
    return null;
  }


  /*
   * 랜덤한 첫 글자를 고른다.
   */

  for (let attempt = 0; attempt < 50; attempt++) {

    if (!startFirst.length) {
      return null;
    }


    const first =
      startFirst[
        Math.floor(
          Math.random() *
          startFirst.length
        )
      ];


    const list =
      byFirst[first] || [];


    if (!list.length) {
      continue;
    }


    /*
     * 무작위로 최대 30개만 검사.
     * 시작 게임을 위해 전체 단어를 순회하지 않는다.
     */

    const count =
      Math.min(
        list.length,
        30
      );


    for (let i = 0; i < count; i++) {

      const word =
        list[
          Math.floor(
            Math.random() *
            list.length
          )
        ];


      /*
       * 공격 단어 시작 금지
       */

      if (
        attackDepth[word] != null
      ) {
        continue;
      }


      const next =
        getCandidates(
          word,
          new Set([word])
        );


      /*
       * 한방 단어 시작 금지
       */

      if (!next.length) {
        continue;
      }


      return word;
    }
  }


  /*
   * 혹시 랜덤으로 못 찾았을 때
   * 글자별 후보에서 조금 더 탐색
   */

  for (const first of startFirst) {

    const list =
      byFirst[first] || [];


    for (
      let i = 0;
      i < Math.min(list.length, 100);
      i++
    ) {

      const word =
        list[i];


      if (
        attackDepth[word] != null
      ) {
        continue;
      }


      const next =
        getCandidates(
          word,
          new Set([word])
        );


      if (next.length) {
        return word;
      }
    }
  }


  return null;
}


/* =========================================================
   API
========================================================= */

app.get(
  "/api/data",
  (req, res) => {

    if (!dataReady) {

      return res.status(503).json({
        ok: false,
        error: "데이터가 아직 준비되지 않았습니다."
      });
    }


    /*
     * 클라이언트가 필요한 정보만 전달.
     *
     * words 전체 배열은 보내지 않는다.
     * byFirst만 보내므로 초기 로딩이 훨씬 가볍다.
     */

    return res.json({
      ok: true,

      byFirst,

      attackDepth,

      dueum,

      startFirst
    });
  }
);


/* =========================================================
   온라인 방
========================================================= */

const rooms =
  new Map();


function createRoomCode() {

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


/* =========================================================
   방 공개 상태
========================================================= */

function getRoomState(room) {

  return {
    code: room.code,

    started:
      room.started,

    players:
      room.players.map(
        player => ({
          id: player.id,
          name: player.name
        })
      ),

    currentWord:
      room.game
        ? room.game.currentWord
        : null,

    turnPlayer:
      room.game
        ? room.game.turnPlayer
        : null,

    history:
      room.game
        ? room.game.history.map(
            item => ({
              word: item.word,
              player: item.player,
              turn: item.turn,
              depth: item.depth
            })
          )
        : [],

    finished:
      room.game
        ? room.game.finished
        : false,

    winner:
      room.game
        ? room.game.winner
        : null
  };
}


/* =========================================================
   방 상태 전송
========================================================= */

function broadcastRoom(room) {

  io.to(room.code).emit(
    "roomState",
    getRoomState(room)
  );
}


/* =========================================================
   Socket.IO
========================================================= */

io.on(
  "connection",
  socket => {

    console.log(
      `[SOCKET] 연결: ${socket.id}`
    );


    /* -----------------------------------------------------
       방 만들기
    ----------------------------------------------------- */

    socket.on(
      "createRoom",
      data => {

        const name =
          normalizeWord(
            data?.name
          ) || "Player";


        const code =
          createRoomCode();


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
          `[ROOM] 생성 ${code} / ${name}`
        );
      }
    );


    /* -----------------------------------------------------
       방 참가
    ----------------------------------------------------- */

    socket.on(
      "joinRoom",
      data => {

        const code =
          String(
            data?.code || ""
          )
            .trim()
            .toUpperCase();


        const name =
          normalizeWord(
            data?.name
          ) || "Player";


        if (!code) {

          socket.emit(
            "errorMessage",
            "방 코드를 입력해주세요."
          );

          return;
        }


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
            "이미 시작된 게임입니다."
          );

          return;
        }


        room.players.push({
          id: socket.id,
          name
        });


        socket.join(code);

        socket.data.roomCode =
          code;


        socket.emit(
          "joinedRoom",
          {
            code
          }
        );


        io.to(code).emit(
          "roomMessage",
          `${name}님이 참가했습니다.`
        );


        broadcastRoom(room);


        console.log(
          `[ROOM] 참가 ${code} / ${name}`
        );
      }
    );


    /* -----------------------------------------------------
       온라인 게임 시작
    ----------------------------------------------------- */

    socket.on(
      "startOnline",
      () => {

        const code =
          socket.data.roomCode;


        if (!code) {

          socket.emit(
            "errorMessage",
            "먼저 방을 만들어주세요."
          );

          return;
        }


        const room =
          rooms.get(code);


        if (!room) {
          return;
        }


        /*
         * 방장만 시작 가능
         */

        if (
          room.players[0]?.id !==
          socket.id
        ) {

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
            "플레이어 2명이 모두 들어와야 합니다."
          );

          return;
        }


        if (room.started) {
          return;
        }


        const start =
          getRandomStartWord();


        if (!start) {

          socket.emit(
            "errorMessage",
            "시작 단어를 찾지 못했습니다."
          );

          return;
        }


        /*
         * 온라인 게임 상태
         */

        room.started = true;


        room.game = {

          startChar:
            start.at(0),

          currentWord:
            start,

          turnPlayer:
            1,

          history: [
            {
              word: start,
              player: 0,
              turn: 1,
              depth:
                attackDepth[start]
                  ?? null
            }
          ],

          usedWords:
            new Set([start]),

          finished: false,

          winner: null,

          loser: null
        };


        /*
         * 두 플레이어 모두에게
         * 게임 시작을 알림
         */

        io.to(code).emit(
          "onlineStarted",
          {
            startWord: start,
            turnPlayer: 1
          }
        );


        broadcastRoom(room);


        /*
         * 시작 단어도 history에 표시
         */

        io.to(code).emit(
          "wordPlayed",
          {
            word: start,
            player: 0,
            nextTurn: 1,
            depth:
              attackDepth[start]
                ?? null
          }
        );


        console.log(
          `[GAME] ${code} 시작 / 시작 단어: ${start}`
        );
      }
    );


    /* -----------------------------------------------------
       온라인 단어 입력
    ----------------------------------------------------- */

    socket.on(
      "playWord",
      data => {

        const code =
          socket.data.roomCode;


        const room =
          rooms.get(code);


        if (!room) {

          socket.emit(
            "wordRejected",
            {
              reason:
                "방을 찾을 수 없습니다."
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


        const game =
          room.game;


        if (
          !game ||
          game.finished
        ) {

          socket.emit(
            "wordRejected",
            {
              reason:
                "게임이 종료되었습니다."
            }
          );

          return;
        }


        /*
         * 내 플레이어 번호
         */

        const playerIndex =
          room.players.findIndex(
            player =>
              player.id === socket.id
          );


        if (playerIndex < 0) {

          socket.emit(
            "wordRejected",
            {
              reason:
                "이 방의 플레이어가 아닙니다."
            }
          );

          return;
        }


        /*
         * 턴 검사
         */

        if (
          game.turnPlayer !==
          playerIndex
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


        /*
         * 단어 목록
         */

        if (!words.has(word)) {

          socket.emit(
            "wordRejected",
            {
              reason:
                "단어 목록에 없는 단어입니다."
            }
          );

          return;
        }


        /*
         * 중복
         */

        if (
          game.usedWords.has(word)
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


        /*
         * 연결 검사
         */

        if (
          !canConnect(
            game.currentWord,
            word
          )
        ) {

          const last =
            game.currentWord.at(-1);


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


        /*
         * 정상 등록
         */

        game.currentWord =
          word;


        game.usedWords.add(word);


        const turn =
          game.history.length + 1;


        game.history.push({

          word,

          player:
            playerIndex,

          turn,

          depth:
            attackDepth[word]
              ?? null
        });


        /*
         * 다음 플레이어
         */

        game.turnPlayer =
          playerIndex === 0
            ? 1
            : 0;


        /*
         * 다음 후보
         */

        const next =
          getCandidates(
            word,
            game.usedWords
          );


        /*
         * 상대가 이어갈 단어가 없음
         */

        if (!next.length) {

          game.finished = true;

          game.winner =
            playerIndex;

          game.loser =
            game.turnPlayer;


          io.to(code).emit(
            "wordPlayed",
            {
              word,
              player: playerIndex,
              nextTurn:
                game.turnPlayer,
              depth:
                attackDepth[word]
                  ?? null
            }
          );


          io.to(code).emit(
            "gameFinished",
            {
              winner:
                game.winner,

              loser:
                game.loser
            }
          );


          broadcastRoom(room);


          console.log(
            `[GAME] ${code} 종료 / 승자: ${playerIndex}`
          );


          return;
        }


        /*
         * 정상 진행
         */

        io.to(code).emit(
          "wordPlayed",
          {
            word,
            player: playerIndex,

            nextTurn:
              game.turnPlayer,

            depth:
              attackDepth[word]
                ?? null
          }
        );


        broadcastRoom(room);
      }
    );


    /* -----------------------------------------------------
       연결 종료
    ----------------------------------------------------- */

    socket.on(
      "disconnect",
      () => {

        const code =
          socket.data.roomCode;


        if (!code) {

          console.log(
            `[SOCKET] 종료: ${socket.id}`
          );

          return;
        }


        const room =
          rooms.get(code);


        if (!room) {
          return;
        }


        const playerIndex =
          room.players.findIndex(
            player =>
              player.id === socket.id
          );


        if (playerIndex >= 0) {

          const name =
            room.players[playerIndex].name;


          room.players.splice(
            playerIndex,
            1
          );


          /*
           * 게임 중 나가면
           * 남은 플레이어 승리
           */

          if (
            room.started &&
            room.game &&
            !room.game.finished
          ) {

            if (
              room.players.length === 1
            ) {

              const remaining =
                room.players[0];


              const remainingIndex =
                0;


              room.game.finished =
                true;


              room.game.winner =
                remainingIndex;


              room.game.loser =
                playerIndex;


              io.to(room.code).emit(
                "gameFinished",
                {
                  winner:
                    remainingIndex,

                  loser:
                    playerIndex,

                  reason:
                    "상대방이 게임을 나갔습니다."
                }
              );
            }
          }


          /*
           * 빈 방이면 삭제
           */

          if (
            room.players.length === 0
          ) {

            rooms.delete(code);

          } else {

            io.to(code).emit(
              "roomMessage",
              `${name}님이 나갔습니다.`
            );


            broadcastRoom(room);
          }
        }


        console.log(
          `[SOCKET] 종료: ${socket.id}`
        );
      }
    );
  }
);


/* =========================================================
   기본 페이지
========================================================= */

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
   오류 처리
========================================================= */

app.use(
  (err, req, res, next) => {

    console.error(err);


    if (res.headersSent) {
      return next(err);
    }


    res.status(500).json({
      ok: false,
      error:
        "서버 내부 오류가 발생했습니다."
    });
  }
);


/* =========================================================
   시작
========================================================= */

const PORT =
  process.env.PORT || 3000;


try {

  loadAllData();


  server.listen(
    PORT,
    () => {

      console.log("");
      console.log(
        "========================================"
      );
      console.log(
        "       끝말잇기 AI 서버 시작"
      );
      console.log(
        "========================================"
      );
      console.log(
        `PORT: ${PORT}`
      );
      console.log(
        `WORDS: ${words.size.toLocaleString()}`
      );
      console.log(
        `ATTACK: ${Object.keys(attackDepth).length.toLocaleString()}`
      );
      console.log(
        `ROOMS: ${rooms.size}`
      );
      console.log(
        "========================================"
      );
      console.log("");
    }
  );

} catch (error) {

  console.error(
    "[FATAL] 데이터 로드 실패"
  );

  console.error(error);

  process.exit(1);
}
