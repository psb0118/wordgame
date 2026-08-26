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

const CLIENT_DIR = path.join(
  ROOT_DIR,
  "client"
);

const PUBLIC_DIR = path.join(
  ROOT_DIR,
  "public"
);

const DATA_DIR = path.join(
  ROOT_DIR,
  "data"
);

/* =========================================================
   데이터 파일 후보
========================================================= */

const WORD_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "word.txt"),
  path.join(DATA_DIR, "word.txt"),
  path.join(CLIENT_DIR, "word.txt"),
  path.join(PUBLIC_DIR, "word.txt")
];

const ATTACK_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "attack.txt"),
  path.join(DATA_DIR, "attack.txt"),
  path.join(CLIENT_DIR, "attack.txt"),
  path.join(PUBLIC_DIR, "attack.txt")
];

/* =========================================================
   Express
========================================================= */

app.use(express.json());

/*
 * client 폴더 공개
 */
if (fs.existsSync(CLIENT_DIR)) {
  app.use(
    express.static(CLIENT_DIR)
  );
}

/*
 * public 폴더가 있으면 공개
 */
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR)
  );
}

/*
 * ROOT 전체를 static으로 공개하지 않는다.
 */

/* =========================================================
   /
========================================================= */

app.get("/", (req, res) => {
  const indexFile =
    path.join(
      CLIENT_DIR,
      "index.html"
    );

  if (!fs.existsSync(indexFile)) {
    return res
      .status(404)
      .send(
        "client/index.html을 찾을 수 없습니다."
      );
  }

  res.sendFile(indexFile);
});

/* =========================================================
   데이터
========================================================= */

const WORDS = new Set();

const ATTACK_DEPTH =
  Object.create(null);

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
   허용 첫 글자
========================================================= */

function allowedFirstChars(lastChar) {
  lastChar =
    normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result = new Set();

  /*
   * 원래 글자
   */
  result.add(lastChar);

  /*
   * 직접 두음
   */
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
   word.txt
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
      "검색 위치:"
    );

    for (
      const candidate
      of WORD_FILE_CANDIDATES
    ) {
      console.error(
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
   attack.txt
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

    if (
      Number.isFinite(depth)
    ) {
      ATTACK_DEPTH[word] =
        depth;
    }
  }

  console.log(
    `공격 단어 로딩 완료: ${Object.keys(
      ATTACK_DEPTH
    ).length.toLocaleString()}개`
  );

  console.log(
    `attack.txt: ${file}`
  );
}

/* =========================================================
   데이터 로드
========================================================= */

loadWords();
loadAttackWords();

/* =========================================================
   단어 인덱스
========================================================= */

const WORD_INDEX =
  new Map();

function buildWordIndex() {
  WORD_INDEX.clear();

  for (const word of WORDS) {
    const first =
      word.at(0);

    if (!first) {
      continue;
    }

    if (
      !WORD_INDEX.has(first)
    ) {
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
   후보 검색
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

  for (
    const firstChar
    of allowed
  ) {
    const bucket =
      WORD_INDEX.get(
        firstChar
      );

    if (!bucket) {
      continue;
    }

    for (
      const word
      of bucket
    ) {
      if (
        used.has(word)
      ) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}

/* =========================================================
   방
========================================================= */

const ROOMS = new Map();

/*
room = {
  id,
  maxPlayers,

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
   방 ID
========================================================= */

function createRoomId() {
  let id;

  do {
    id =
      Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();
  } while (
    ROOMS.has(id)
  );

  return id;
}

/* =========================================================
   최대 인원 정리
========================================================= */

function normalizeMaxPlayers(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return 2;
  }

  return Math.min(
    20,
    Math.max(
      2,
      Math.floor(number)
    )
  );
}

/* =========================================================
   공개 상태
========================================================= */

function getPublicRoomState(room) {
  if (!room) {
    return null;
  }

  return {
    roomId:
      room.id,

    maxPlayers:
      room.maxPlayers,

    startChar:
      room.startChar,

    currentWord:
      room.currentWord,

    turnPlayer:
      room.turnPlayer,

    history:
      room.history.map(
        item => ({
          word:
            item.word,

          player:
            item.player,

          nickname:
            item.nickname,

          turn:
            item.turn,

          depth:
            item.depth
        })
      ),

    finished:
      room.finished,

    winner:
      room.winner,

    loser:
      room.loser,

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
      )
  };
}

/* =========================================================
   브로드캐스트
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
   소켓으로 방 찾기
========================================================= */

function findRoomBySocket(socketId) {
  for (
    const room
    of ROOMS.values()
  ) {
    if (
      room.players.some(
        player =>
          player.socketId ===
          socketId
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
  startChar,
  maxPlayers
}) {
  const roomId =
    createRoomId();

  const room = {
    id: roomId,

    maxPlayers:
      normalizeMaxPlayers(
        maxPlayers
      ),

    players: [
      {
        socketId,
        playerIndex: 0,
        nickname
      }
    ],

    startChar:
      normalizeWord(
        startChar
      ).at(0) || "",

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
   빈 플레이어 슬롯 찾기
========================================================= */

function getNextPlayerIndex(room) {
  const used =
    new Set(
      room.players.map(
        player =>
          player.playerIndex
      )
    );

  for (
    let i = 0;
    i < room.maxPlayers;
    i++
  ) {
    if (!used.has(i)) {
      return i;
    }
  }

  return -1;
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

  if (
    room.players.length >=
    room.maxPlayers
  ) {
    return {
      ok: false,
      reason:
        "방이 가득 찼습니다."
    };
  }

  if (room.finished) {
    return {
      ok: false,
      reason:
        "이미 종료된 방입니다."
    };
  }

  const playerIndex =
    getNextPlayerIndex(room);

  if (playerIndex === -1) {
    return {
      ok: false,
      reason:
        "플레이어 자리를 찾을 수 없습니다."
    };
  }

  room.players.push({
    socketId,
    playerIndex,
    nickname
  });

  return {
    ok: true,
    playerIndex
  };
}

/* =========================================================
   다음 플레이어
========================================================= */

function getNextTurnPlayer(
  room,
  currentPlayer
) {
  if (
    !room ||
    room.players.length === 0
  ) {
    return null;
  }

  /*
   * playerIndex 순서대로
   * 0 → 1 → 2 → ... → N-1 → 0
   */

  const sorted =
    [...room.players]
      .sort(
        (a, b) =>
          a.playerIndex -
          b.playerIndex
      );

  const currentPosition =
    sorted.findIndex(
      player =>
        player.playerIndex ===
        currentPlayer
    );

  if (
    currentPosition === -1
  ) {
    return sorted[0]
      .playerIndex;
  }

  const next =
    sorted[
      (currentPosition + 1) %
      sorted.length
    ];

  return next.playerIndex;
}

/* =========================================================
   게임 종료 검사
========================================================= */

function checkGameOver(
  room,
  lastPlayer
) {
  const next =
    getCandidates(
      room.currentWord,
      room.usedWords
    );

  if (next.length > 0) {
    return false;
  }

  room.finished = true;

  /*
   * 마지막으로 단어를 낸 사람이 승리
   */
  room.winner =
    lastPlayer;

  /*
   * 나머지 플레이어
   * 중에서 현재 다음 차례가 될 사람이 패배
   */
  room.loser =
    getNextTurnPlayer(
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

  if (
    room.players.length < 2
  ) {
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
        "플레이어 정보를 찾을 수 없습니다."
    };
  }

  if (
    room.turnPlayer !==
    playerIndex
  ) {
    return {
      ok: false,
      reason:
        "지금은 당신의 차례가 아닙니다."
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

  if (!hasWord(word)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }

  if (
    room.usedWords.has(word)
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
          allowedFirstChars(
            last
          )
      };
    }
  }

  /*
   * 등록
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

    nickname:
      player.nickname,

    turn:
      room.history.length + 1,

    depth
  });

  /*
   * 게임 종료
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
      getNextTurnPlayer(
        room,
        playerIndex
      );

    room.turnPlayer =
      nextTurn;
  }

  return {
    ok: true,

    word,

    player:
      playerIndex,

    nickname:
      player.nickname,

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
      room.finished
        ? 0
        : getCandidates(
            word,
            room.usedWords
          ).length
  };
}

/* =========================================================
   방에서 플레이어 제거
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

  const removed =
    room.players[index];

  const wasTurn =
    room.turnPlayer ===
    removed.playerIndex;

  room.players.splice(
    index,
    1
  );

  /*
   * 모두 나가면 방 삭제
   */
  if (
    room.players.length === 0
  ) {
    ROOMS.delete(
      room.id
    );

    return removed;
  }

  /*
   * 나간 사람이 현재 턴이었다면
   * 남아있는 사람 중 다음 순서
   */
  if (
    wasTurn &&
    !room.finished
  ) {
    const sorted =
      [...room.players]
        .sort(
          (a, b) =>
            a.playerIndex -
            b.playerIndex
        );

    room.turnPlayer =
      sorted[0].playerIndex;
  }

  return removed;
}

/* =========================================================
   게임 초기화
========================================================= */

function resetGame(
  room,
  startChar
) {
  room.startChar =
    normalizeWord(
      startChar
    ).at(0) ||
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
   * 가장 낮은 playerIndex부터 시작
   */
  const first =
    [...room.players]
      .sort(
        (a, b) =>
          a.playerIndex -
          b.playerIndex
      )[0];

  room.turnPlayer =
    first
      ? first.playerIndex
      : 0;
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

    /* =====================================================
       서버 준비
    ===================================================== */

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
          const nickname =
            normalizeWord(
              data?.nickname
            ) ||
            "플레이어";

          const startChar =
            normalizeWord(
              data?.startChar
            ).at(0) || "";

          const maxPlayers =
            normalizeMaxPlayers(
              data?.maxPlayers
            );

          /*
           * 기존 방 탈퇴
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

            broadcastRoomState(
              oldRoom
            );
          }

          const room =
            createRoom({
              socketId:
                socket.id,

              nickname,

              startChar,

              maxPlayers
            });

          socket.join(
            room.id
          );

          socket.data.roomId =
            room.id;

          socket.data.playerIndex =
            0;

          socket.emit(
            "room:created",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex:
                0,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          broadcastRoomState(
            room
          );

          console.log(
            `[ROOM CREATE] ${room.id} / ${socket.id} / ${maxPlayers}명`
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

          const nickname =
            normalizeWord(
              data?.nickname
            ) ||
            "플레이어";

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

          socket.emit(
            "room:joined",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex:
                result.playerIndex,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          broadcastRoomState(
            room
          );

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

          const result =
            playRoomWord(
              room,
              player.playerIndex,
              data?.word ?? ""
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

              nickname:
                result.nickname,

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
           * 최신 전체 상태
           */
          broadcastRoomState(
            room
          );

          /*
           * 종료
           */
          if (
            room.finished
          ) {
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
       game:restart
    ===================================================== */

    socket.on(
      "game:restart",
      data => {
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

        resetGame(
          room,
          data?.startChar
        );

        broadcastRoomState(
          room
        );

        io.to(room.id).emit(
          "game:started",
          {
            ok: true,

            state:
              getPublicRoomState(
                room
              )
          }
        );
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
          socket.data.roomId =
            null;

          socket.data.playerIndex =
            null;

          return;
        }

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
         * 방이 아직 존재하면 알림
         */
        if (
          ROOMS.has(room.id)
        ) {
          io.to(room.id).emit(
            "room:playerLeft",
            {
              ok: true,

              reason:
                "플레이어가 방을 나갔습니다.",

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          broadcastRoomState(
            room
          );
        }
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
          removePlayerFromRoom(
            room,
            socket.id
          );

          if (
            ROOMS.has(room.id)
          ) {
            io.to(room.id).emit(
              "room:playerLeft",
              {
                ok: true,

                reason:
                  "플레이어의 연결이 종료되었습니다.",

                state:
                  getPublicRoomState(
                    room
                  )
              }
            );

            broadcastRoomState(
              room
            );
          }
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
      `ATTACK: ${Object.keys(
        ATTACK_DEPTH
      ).length.toLocaleString()}`
    );

    console.log(
      `CLIENT: ${CLIENT_DIR}`
    );

    console.log(
      "========================================"
    );
  }
);

/* =========================================================
   종료
========================================================= */

function shutdown(signal) {
  console.log(
    `${signal} 수신. 서버 종료 중...`
  );

  server.close(
    () => {
      console.log(
        "서버가 종료되었습니다."
      );

      process.exit(0);
    }
  );
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
