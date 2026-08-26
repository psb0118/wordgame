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
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CLIENT_DIR = path.join(ROOT_DIR, "client");
const DATA_DIR = path.join(ROOT_DIR, "data");

const WORD_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "word.txt"),
  path.join(DATA_DIR, "word.txt"),
  path.join(PUBLIC_DIR, "word.txt"),
  path.join(CLIENT_DIR, "word.txt")
];

const ATTACK_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "attack.txt"),
  path.join(DATA_DIR, "attack.txt"),
  path.join(PUBLIC_DIR, "attack.txt"),
  path.join(CLIENT_DIR, "attack.txt")
];

/* =========================================================
   Express
========================================================= */

app.use(express.json());

/*
 * client 폴더를 실제 웹 루트로 사용
 *
 * 프로젝트:
 *
 * project/
 * ├─ server/
 * │  └─ server.js
 * ├─ client/
 * │  ├─ index.html
 * │  └─ script.js
 * └─ data/
 *    ├─ word.txt
 *    └─ attack.txt
 */

if (fs.existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR));
}

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

/*
 * 루트 페이지
 *
 * client/index.html이 있으면 직접 전달한다.
 */
app.get("/", (req, res) => {
  const clientIndex = path.join(
    CLIENT_DIR,
    "index.html"
  );

  const publicIndex = path.join(
    PUBLIC_DIR,
    "index.html"
  );

  if (fs.existsSync(clientIndex)) {
    return res.sendFile(clientIndex);
  }

  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }

  return res.status(404).send(
    "index.html을 찾을 수 없습니다."
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

  const direct =
    DEFAULT_DUEUM[lastChar];

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
   * 여 -> 려
   * 연 -> 년
   */
  for (
    const [from, values]
    of Object.entries(DEFAULT_DUEUM)
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
   연결 판정
========================================================= */

function canConnect(
  previousWord,
  nextWord
) {
  previousWord =
    normalizeWord(previousWord);

  nextWord =
    normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
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
   파일 찾기
========================================================= */

function findExistingFile(paths) {
  for (const file of paths) {
    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}

/* =========================================================
   word.txt 로딩
========================================================= */

function loadWords() {
  const file =
    findExistingFile(
      WORD_FILE_CANDIDATES
    );

  if (!file) {
    console.error(
      "========================================"
    );

    console.error(
      "word.txt를 찾을 수 없습니다."
    );

    console.error(
      "찾은 경로:"
    );

    for (const candidate of WORD_FILE_CANDIDATES) {
      console.error(
        " -",
        candidate
      );
    }

    console.error(
      "========================================"
    );

    return;
  }

  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

  WORDS.clear();

  for (
    const line
    of text.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    const word =
      normalizeWord(
        trimmed.split(/\s+/)[0]
      );

    if (word) {
      WORDS.add(word);
    }
  }

  console.log(
    `단어 로딩 완료: ${WORDS.size.toLocaleString()}개`
  );

  console.log(
    `word.txt: ${file}`
  );
}

/* =========================================================
   attack.txt 로딩
========================================================= */

function loadAttackWords() {
  const file =
    findExistingFile(
      ATTACK_FILE_CANDIDATES
    );

  if (!file) {
    console.warn(
      "attack.txt를 찾을 수 없습니다."
    );

    return;
  }

  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

  for (
    const line
    of text.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    const parts =
      trimmed.split(/\s+/);

    const word =
      normalizeWord(parts[0]);

    if (!word) {
      continue;
    }

    const depth =
      Number(parts[1]);

    if (Number.isFinite(depth)) {
      ATTACK_DEPTH[word] =
        depth;
    }
  }

  console.log(
    `공격 단어 로딩 완료: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
  );

  console.log(
    `attack.txt: ${file}`
  );
}

/* =========================================================
   단어 인덱스
========================================================= */

function buildWordIndex() {
  WORD_INDEX.clear();

  for (const word of WORDS) {
    const first =
      word.at(0);

    if (!first) {
      continue;
    }

    if (!WORD_INDEX.has(first)) {
      WORD_INDEX.set(
        first,
        []
      );
    }

    WORD_INDEX
      .get(first)
      .push(word);
  }

  console.log(
    `단어 인덱스 생성 완료: ${WORD_INDEX.size}개 시작 글자`
  );
}

/* =========================================================
   데이터 초기화
========================================================= */

loadWords();
loadAttackWords();
buildWordIndex();

/* =========================================================
   단어 존재
========================================================= */

function hasWord(word) {
  return WORDS.has(
    normalizeWord(word)
  );
}

/* =========================================================
   후보 단어
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

  const allowed =
    allowedFirstChars(
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
      if (used.has(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}

/* =========================================================
   방 ID
========================================================= */

const ROOMS = new Map();

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
   방 구조
========================================================= */

/*
room = {
  id,

  players: [
    {
      socketId,
      playerIndex,
      nickname
    }
  ],

  startChar,
  currentWord,

  turnPlayer,

  history,
  usedWords,

  finished,
  winner,
  loser
}
*/

/* =========================================================
   공개 방 상태
========================================================= */

function getPublicRoomState(room) {
  if (!room) {
    return null;
  }

  return {
    roomId:
      room.id,

    startChar:
      room.startChar,

    currentWord:
      room.currentWord,

    turnPlayer:
      room.turnPlayer,

    history:
      room.history.map(item => ({
        word:
          item.word,

        player:
          item.player,

        turn:
          item.turn,

        depth:
          item.depth
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
          player.nickname
      }))
  };
}

/* =========================================================
   방 브로드캐스트
========================================================= */

function broadcastRoomState(room) {
  if (!room) {
    return;
  }

  io.to(room.id).emit(
    "game:state",
    getPublicRoomState(room)
  );
}

/* =========================================================
   소켓의 방 찾기
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
  startChar
}) {
  const roomId =
    createRoomId();

  const room = {
    id:
      roomId,

    players: [
      {
        socketId,
        playerIndex: 0,
        nickname:
          nickname || "플레이어"
      }
    ],

    startChar:
      normalizeWord(startChar).at(0) || "",

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

  ROOMS.set(
    roomId,
    room
  );

  return room;
}

/* =========================================================
   방 입장
========================================================= */

function joinRoom(
  room,
  socketId,
  nickname
) {
  if (!room) {
    return {
      ok: false,
      reason:
        "방을 찾을 수 없습니다."
    };
  }

  /*
   * N명까지 허용
   *
   * 필요하면 MAX_PLAYERS를 따로 설정 가능.
   */
  if (room.finished) {
    return {
      ok: false,
      reason:
        "이미 종료된 방입니다."
    };
  }

  if (
    room.players.some(
      player =>
        player.socketId === socketId
    )
  ) {
    return {
      ok: false,
      reason:
        "이미 방에 참여 중입니다."
    };
  }

  const playerIndex =
    room.players.length;

  room.players.push({
    socketId,
    playerIndex,
    nickname:
      nickname || "플레이어"
  });

  return {
    ok: true,
    playerIndex
  };
}

/* =========================================================
   턴 다음 플레이어
========================================================= */

function getNextPlayerIndex(
  room,
  currentPlayer
) {
  if (
    !room ||
    room.players.length === 0
  ) {
    return null;
  }

  const players =
    room.players;

  /*
   * 현재 인덱스 다음에 있는
   * 실제 플레이어를 찾는다.
   */
  for (
    let i = 1;
    i <= players.length;
    i++
  ) {
    const next =
      players.find(
        player =>
          player.playerIndex ===
          currentPlayer + i
      );

    if (next) {
      return next.playerIndex;
    }
  }

  /*
   * playerIndex가 중간에 비어 있을 수 있으므로
   * 순환 검색.
   */
  const currentPosition =
    players.findIndex(
      player =>
        player.playerIndex ===
        currentPlayer
    );

  if (currentPosition !== -1) {
    const nextPosition =
      (currentPosition + 1) %
      players.length;

    return players[nextPosition]
      .playerIndex;
  }

  return players[0]
    .playerIndex;
}

/* =========================================================
   게임 종료 검사
========================================================= */

function checkGameOver(
  room,
  lastPlayer
) {
  if (!room.currentWord) {
    return false;
  }

  const next =
    getCandidates(
      room.currentWord,
      room.usedWords
    );

  if (next.length > 0) {
    return false;
  }

  room.finished =
    true;

  /*
   * 마지막으로 단어를 낸 사람이 승리.
   */
  room.winner =
    lastPlayer;

  /*
   * 다음 턴이 올 플레이어가 패배자로 취급.
   */
  room.loser =
    getNextPlayerIndex(
      room,
      lastPlayer
    );

  return true;
}

/* =========================================================
   단어 플레이
========================================================= */

function playRoomWord(
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

  if (room.players.length < 2) {
    return {
      ok: false,
      reason:
        "상대방을 기다리는 중입니다."
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
        "방에 참여하지 않은 플레이어입니다."
    };
  }

  if (
    room.turnPlayer !==
    playerIndex
  ) {
    return {
      ok: false,
      reason:
        "지금은 당신의 차례가 아닙니다.",
      turnPlayer:
        room.turnPlayer
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

  /*
   * 실제 단어 목록 검사
   */
  if (!hasWord(word)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }

  /*
   * 중복 검사
   */
  if (room.usedWords.has(word)) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }

  /*
   * 첫 단어
   */
  if (!room.currentWord) {
    if (room.startChar) {
      const allowed =
        allowedFirstChars(
          room.startChar
        );

      if (
        !allowed.includes(
          word.at(0)
        )
      ) {
        return {
          ok: false,

          reason:
            `"${room.startChar}"으로 시작할 수 없는 단어입니다.`,

          allowed
        };
      }
    }
  }

  /*
   * 이후 단어
   */
  else {
    if (
      !canConnect(
        room.currentWord,
        word
      )
    ) {
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
  }

  /*
   * 실제 등록
   */
  room.currentWord =
    word;

  room.usedWords.add(
    word
  );

  const depth =
    Number.isFinite(
      ATTACK_DEPTH[word]
    )
      ? ATTACK_DEPTH[word]
      : null;

  room.history.push({
    word,

    player:
      playerIndex,

    turn:
      room.history.length + 1,

    depth
  });

  /*
   * 게임 종료 확인
   */
  const ended =
    checkGameOver(
      room,
      playerIndex
    );

  let nextTurn =
    null;

  if (!ended) {
    nextTurn =
      getNextPlayerIndex(
        room,
        playerIndex
      );

    room.turnPlayer =
      nextTurn;
  }

  const nextCandidates =
    ended
      ? []
      : getCandidates(
          word,
          room.usedWords
        );

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
      nextCandidates.length
  };
}

/* =========================================================
   플레이어 제거
========================================================= */

function removePlayerFromRoom(
  room,
  socketId
) {
  if (!room) {
    return null;
  }

  const index =
    room.players.findIndex(
      player =>
        player.socketId ===
        socketId
    );

  if (index === -1) {
    return null;
  }

  const removedPlayer =
    room.players[index];

  room.players.splice(
    index,
    1
  );

  /*
   * 사람이 한 명도 없으면 방 삭제.
   */
  if (room.players.length === 0) {
    ROOMS.delete(
      room.id
    );

    return removedPlayer;
  }

  /*
   * 플레이어 인덱스를
   * 0,1,2,... 순서로 재정렬.
   */
  const oldTurn =
    room.turnPlayer;

  const oldPlayers =
    room.players.slice();

  /*
   * 기존 플레이어 순서를 유지하면서
   * 새로운 playerIndex 부여.
   */
  for (
    let i = 0;
    i < room.players.length;
    i++
  ) {
    room.players[i]
      .playerIndex = i;
  }

  /*
   * 현재 턴 플레이어가 나간 경우
   * 다음 플레이어로 넘긴다.
   */
  if (
    removedPlayer.playerIndex ===
    oldTurn
  ) {
    if (room.players.length > 0) {
      room.turnPlayer = 0;
    }
  } else {
    /*
     * 기존 턴 플레이어를 찾아
     * 새로운 인덱스로 변환.
     */
    const oldTurnPlayer =
      oldPlayers.find(
        player =>
          player.playerIndex ===
          oldTurn
      );

    if (oldTurnPlayer) {
      const newTurnPlayer =
        room.players.find(
          player =>
            player.socketId ===
            oldTurnPlayer.socketId
        );

      if (newTurnPlayer) {
        room.turnPlayer =
          newTurnPlayer.playerIndex;
      } else {
        room.turnPlayer = 0;
      }
    } else {
      room.turnPlayer = 0;
    }
  }

  /*
   * 방에 두 명 이상이 남아 있으면
   * 게임은 계속한다.
   */
  if (room.players.length >= 2) {
    room.finished = false;
    room.winner = null;
    room.loser = null;
  }

  return removedPlayer;
}

/* =========================================================
   방 초기화
========================================================= */

function resetRoom(
  room,
  startChar
) {
  if (!room) {
    return;
  }

  room.startChar =
    normalizeWord(startChar).at(0) ||
    room.startChar ||
    "";

  room.currentWord =
    null;

  room.history =
    [];

  room.usedWords =
    new Set();

  room.finished =
    false;

  room.winner =
    null;

  room.loser =
    null;

  /*
   * 첫 플레이어부터 시작.
   */
  if (room.players.length > 0) {
    room.turnPlayer =
      room.players[0]
        .playerIndex;
  } else {
    room.turnPlayer = 0;
  }
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

    /*
     * 서버 준비
     */
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
       room:create
    ===================================================== */

    socket.on(
      "room:create",
      data => {
        try {
          /*
           * 기존 방에 있으면 먼저 제거.
           */
          const oldRoom =
            findRoomBySocket(
              socket.id
            );

          if (oldRoom) {
            socket.leave(
              oldRoom.id
            );

            removePlayerFromRoom(
              oldRoom,
              socket.id
            );

            if (
              ROOMS.has(oldRoom.id)
            ) {
              io.to(oldRoom.id).emit(
                "room:playerLeft",
                {
                  ok: true,

                  reason:
                    "플레이어가 다른 방으로 이동했습니다.",

                  state:
                    getPublicRoomState(
                      oldRoom
                    )
                }
              );

              broadcastRoomState(
                oldRoom
              );
            }
          }

          const nickname =
            normalizeWord(
              data?.nickname
            ) ||
            "플레이어";

          const startChar =
            normalizeWord(
              data?.startChar
            ).at(0) || "";

          const room =
            createRoom({
              socketId:
                socket.id,

              nickname,

              startChar
            });

          socket.join(
            room.id
          );

          socket.data.roomId =
            room.id;

          socket.data.playerIndex =
            0;

          const state =
            getPublicRoomState(
              room
            );

          socket.emit(
            "room:created",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex:
                0,

              state
            }
          );

          broadcastRoomState(
            room
          );

          console.log(
            `[ROOM CREATE] ${room.id} / ${socket.id}`
          );
        } catch (error) {
          console.error(
            "room:create 오류:",
            error
          );

          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "방을 생성하지 못했습니다."
            }
          );
        }
      }
    );

    /* =====================================================
       room:join
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

          const nickname =
            normalizeWord(
              data?.nickname
            ) ||
            "플레이어";

          /*
           * 이미 다른 방에 있으면 제거.
           */
          const oldRoom =
            findRoomBySocket(
              socket.id
            );

          if (oldRoom) {
            if (
              oldRoom.id === roomId
            ) {
              const existing =
                oldRoom.players.find(
                  player =>
                    player.socketId ===
                    socket.id
                );

              socket.emit(
                "room:joined",
                {
                  ok: true,

                  roomId:
                    oldRoom.id,

                  playerIndex:
                    existing?.playerIndex ??
                    0,

                  state:
                    getPublicRoomState(
                      oldRoom
                    )
                }
              );

              return;
            }

            socket.leave(
              oldRoom.id
            );

            removePlayerFromRoom(
              oldRoom,
              socket.id
            );

            if (
              ROOMS.has(oldRoom.id)
            ) {
              broadcastRoomState(
                oldRoom
              );
            }
          }

          const room =
            ROOMS.get(roomId);

          const result =
            joinRoom(
              room,
              socket.id,
              nickname
            );

          if (!result.ok) {
            socket.emit(
              "room:error",
              result
            );

            return;
          }

          socket.join(
            room.id
          );

          socket.data.roomId =
            room.id;

          socket.data.playerIndex =
            result.playerIndex;

          const state =
            getPublicRoomState(
              room
            );

          socket.emit(
            "room:joined",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex:
                result.playerIndex,

              state
            }
          );

          /*
           * 방 전체 상태
           */
          broadcastRoomState(
            room
          );

          /*
           * 입장 완료
           */
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

          console.log(
            `[ROOM JOIN] ${room.id} / ${socket.id} / player ${result.playerIndex}`
          );
        } catch (error) {
          console.error(
            "room:join 오류:",
            error
          );

          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "방에 입장하지 못했습니다."
            }
          );
        }
      }
    );

    /* =====================================================
       room:state
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
                "현재 참여 중인 방이 없습니다."
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

        if (player) {
          socket.data.playerIndex =
            player.playerIndex;
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
       game:word
    ===================================================== */

    socket.on(
      "game:word",
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
            socket.emit(
              "game:error",
              {
                ok: false,

                reason:
                  "플레이어 정보를 찾을 수 없습니다."
              }
            );

            return;
          }

          /*
           * playerIndex는 서버 상태를 기준으로 한다.
           */
          socket.data.playerIndex =
            player.playerIndex;

          const rawWord =
            data?.word ??
            data?.inputWord ??
            "";

          const result =
            playRoomWord(
              room,
              player.playerIndex,
              rawWord
            );

          if (!result.ok) {
            socket.emit(
              "game:error",
              result
            );

            return;
          }

          /*
           * 성공한 단어
           */
          io.to(room.id).emit(
            "game:word",
            {
              ok: true,

              word:
                result.word,

              player:
                result.player,

              depth:
                result.depth,

              finished:
                result.finished,

              winner:
                result.winner,

              loser:
                result.loser,

              nextTurn:
                result.nextTurn,

              nextCount:
                result.nextCount
            }
          );

          /*
           * 최신 상태
           */
          broadcastRoomState(
            room
          );

          /*
           * 게임 종료
           */
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
          }
        } catch (error) {
          console.error(
            "game:word 오류:",
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
       game:submit
       
       이전 클라이언트와의 호환.
       내부적으로 game:word와 동일한 처리.
    ===================================================== */

    socket.on(
      "game:submit",
      data => {
        /*
         * game:word와 동일한 로직으로 처리한다.
         */
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
            playRoomWord(
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
            {
              ok: true,

              word:
                result.word,

              player:
                result.player,

              depth:
                result.depth,

              finished:
                result.finished,

              winner:
                result.winner,

              loser:
                result.loser,

              nextTurn:
                result.nextTurn,

              nextCount:
                result.nextCount
            }
          );

          broadcastRoomState(
            room
          );

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
          }
        } catch (error) {
          console.error(
            "game:submit 오류:",
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
       game:restart
    ===================================================== */

    socket.on(
      "game:restart",
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
                  "방에 참여하지 않았습니다."
              }
            );

            return;
          }

          /*
           * 최소 2명 필요
           */
          if (
            room.players.length < 2
          ) {
            socket.emit(
              "game:error",
              {
                ok: false,

                reason:
                  "상대방을 기다리는 중입니다."
              }
            );

            return;
          }

          /*
           * 새 게임 시작
           */
          const requestedStartChar =
            normalizeWord(
              data?.startChar
            ).at(0) || "";

          resetRoom(
            room,
            requestedStartChar
          );

          /*
           * 방 전체에 새 상태 전송
           */
          const state =
            getPublicRoomState(
              room
            );

          broadcastRoomState(
            room
          );

          io.to(room.id).emit(
            "game:started",
            {
              ok: true,

              state
            }
          );

          console.log(
            `[GAME RESTART] ${room.id}`
          );
        } catch (error) {
          console.error(
            "game:restart 오류:",
            error
          );

          socket.emit(
            "game:error",
            {
              ok: false,

              reason:
                "새 게임을 시작하지 못했습니다."
            }
          );
        }
      }
    );

    /* =====================================================
       room:leave
    ===================================================== */

    socket.on(
      "room:leave",
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
                "현재 참여 중인 방이 없습니다."
            }
          );

          return;
        }

        const leavingPlayer =
          room.players.find(
            player =>
              player.socketId ===
              socket.id
          );

        socket.leave(
          room.id
        );

        removePlayerFromRoom(
          room,
          socket.id
        );

        socket.data.roomId =
          null;

        socket.data.playerIndex =
          null;

        /*
         * 방이 삭제된 경우
         */
        if (!ROOMS.has(room.id)) {
          return;
        }

        const state =
          getPublicRoomState(
            room
          );

        io.to(room.id).emit(
          "room:playerLeft",
          {
            ok: true,

            player:
              leavingPlayer?.playerIndex ??
              null,

            reason:
              "플레이어가 방에서 나갔습니다.",

            state
          }
        );

        broadcastRoomState(
          room
        );

        console.log(
          `[ROOM LEAVE] ${room.id} / ${socket.id}`
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

        if (room) {
          const leavingPlayer =
            room.players.find(
              player =>
                player.socketId ===
                socket.id
            );

          removePlayerFromRoom(
            room,
            socket.id
          );

          /*
           * 방이 완전히 삭제된 경우
           */
          if (
            !ROOMS.has(room.id)
          ) {
            console.log(
              `[DISCONNECT] ${socket.id} / ${reason}`
            );

            return;
          }

          const state =
            getPublicRoomState(
              room
            );

          io.to(room.id).emit(
            "room:playerLeft",
            {
              ok: true,

              player:
                leavingPlayer?.playerIndex ??
                null,

              reason:
                "상대방의 연결이 종료되었습니다.",

              state
            }
          );

          broadcastRoomState(
            room
          );
        }

        console.log(
          `[DISCONNECT] ${socket.id} / ${reason}`
        );
      }
    );
  }
);

/* =========================================================
   HTTP API
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
  });

app.get(
  "/api/rooms",
  (req, res) => {
    const rooms =
      [...ROOMS.values()]
        .map(room => ({
          roomId:
            room.id,

          playerCount:
            room.players.length,

          players:
            room.players.map(
              player => ({
                playerIndex:
                  player.playerIndex,

                nickname:
                  player.nickname
              })
            ),

          started:
            !!room.currentWord,

          finished:
            room.finished
        }));

    res.json({
      ok: true,
      rooms
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
      "끝말잇기 멀티플레이 서버 시작"
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
      `ROOMS: ${ROOMS.size}`
    );

    console.log(
      "========================================"
    );
  }
);

/* =========================================================
   종료 처리
========================================================= */

function shutdown(signal) {
  console.log(
    `${signal} 수신. 서버 종료 중...`
  );

  io.close(() => {
    server.close(() => {
      console.log(
        "서버가 종료되었습니다."
      );

      process.exit(0);
    });
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
