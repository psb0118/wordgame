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

/*
 * 방 하나에 들어올 수 있는 최대 인원
 *
 * 2명 이상 N명 구조.
 * 예: 10이면 최대 10명.
 * 더 늘리고 싶으면 숫자만 변경.
 */
const MAX_PLAYERS = 10;

/* =========================================================
   경로
========================================================= */

const ROOT_DIR = path.join(__dirname, "..");

const PUBLIC_DIR = path.join(
  ROOT_DIR,
  "public"
);

const DATA_DIR = path.join(
  ROOT_DIR,
  "data"
);

const WORD_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "word.txt"),
  path.join(DATA_DIR, "word.txt"),
  path.join(PUBLIC_DIR, "word.txt")
];

const ATTACK_FILE_CANDIDATES = [
  path.join(ROOT_DIR, "attack.txt"),
  path.join(DATA_DIR, "attack.txt"),
  path.join(PUBLIC_DIR, "attack.txt")
];

/* =========================================================
   정적 파일
========================================================= */

app.use(express.json());

app.use(
  express.static(ROOT_DIR)
);

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR)
  );
}

/* =========================================================
   데이터
========================================================= */

const WORDS = new Set();
const ATTACK_DEPTH = Object.create(null);

const WORD_INDEX = new Map();

/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
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

  /*
   * 원래 글자
   */
  result.add(lastChar);

  /*
   * 정방향
   */
  const direct = DUEUM[lastChar];

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
  for (const [from, values] of Object.entries(DUEUM)) {
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

function canConnect(previousWord, nextWord) {
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
      "word.txt를 찾을 수 없습니다."
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
    const line of text.split(/\r?\n/)
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
    const line of text.split(/\r?\n/)
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
    `공격 단어 로딩 완료: ${Object.keys(
      ATTACK_DEPTH
    ).length.toLocaleString()}개`
  );

  console.log(
    `attack.txt: ${file}`
  );
}

/* =========================================================
   데이터 초기화
========================================================= */

loadWords();
loadAttackWords();

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
   플레이어가 현재 게임에 참여 가능한지
========================================================= */

function getActivePlayers(room) {
  return room.players
    .filter(player => player.connected !== false)
    .sort(
      (a, b) =>
        a.playerIndex -
        b.playerIndex
    );
}

/* =========================================================
   다음 플레이어
========================================================= */

function getNextPlayerIndex(
  room,
  currentPlayerIndex
) {
  const players =
    getActivePlayers(room);

  if (players.length === 0) {
    return null;
  }

  const currentPosition =
    players.findIndex(
      player =>
        player.playerIndex ===
        currentPlayerIndex
    );

  /*
   * 현재 플레이어가 이미 나간 경우
   * 가장 앞의 플레이어부터.
   */
  if (currentPosition === -1) {
    return players[0].playerIndex;
  }

  const nextPosition =
    (currentPosition + 1) %
    players.length;

  return players[nextPosition]
    .playerIndex;
}

/* =========================================================
   게임 종료
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

  room.finished = true;

  /*
   * 마지막 단어를 낸 사람이 승리.
   */
  room.winner =
    lastPlayer;

  room.loser = null;

  return true;
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
   방 공개 상태
========================================================= */

function getPublicRoomState(room) {
  if (!room) {
    return null;
  }

  return {
    roomId:
      room.id,

    maxPlayers:
      MAX_PLAYERS,

    startChar:
      room.startChar,

    currentWord:
      room.currentWord,

    turnPlayer:
      room.turnPlayer,

    turnNumber:
      room.history.length + 1,

    history:
      room.history.map(item => ({
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
      })),

    finished:
      room.finished,

    winner:
      room.winner,

    loser:
      room.loser,

    started:
      room.started,

    playerCount:
      room.players.length,

    players:
      room.players.map(player => ({
        playerIndex:
          player.playerIndex,

        nickname:
          player.nickname,

        connected:
          player.connected !== false
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
   소켓으로 방 찾기
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
   플레이어 인덱스
========================================================= */

function getAvailablePlayerIndex(room) {
  const used =
    new Set(
      room.players.map(
        player =>
          player.playerIndex
      )
    );

  for (
    let i = 0;
    i < MAX_PLAYERS;
    i++
  ) {
    if (!used.has(i)) {
      return i;
    }
  }

  return null;
}

/* =========================================================
   게임 시작
========================================================= */

function startRoomGame(room) {
  if (!room) {
    return;
  }

  if (room.players.length < 2) {
    return;
  }

  if (room.started && !room.finished) {
    return;
  }

  room.started = true;
  room.finished = false;
  room.currentWord = null;
  room.turnPlayer =
    getActivePlayers(room)[0]
      ?.playerIndex ?? null;

  room.history = [];
  room.usedWords = new Set();

  room.winner = null;
  room.loser = null;

  broadcastRoomState(room);

  io.to(room.id).emit(
    "game:started",
    {
      ok: true,

      state:
        getPublicRoomState(room)
    }
  );
}

/* =========================================================
   방 생성
========================================================= */

function createRoom({
  socketId,
  nickname = "플레이어",
  startChar = ""
}) {
  const roomId =
    createRoomId();

  const room = {
    id:
      roomId,

    players: [
      {
        socketId,

        playerIndex:
          0,

        nickname,

        connected:
          true
      }
    ],

    startChar:
      normalizeWord(startChar)
        .at(0) || "",

    currentWord:
      null,

    turnPlayer:
      0,

    history: [],

    usedWords:
      new Set(),

    started:
      false,

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

  if (
    room.players.length >=
    MAX_PLAYERS
  ) {
    return {
      ok: false,

      reason:
        `방이 가득 찼습니다. 최대 ${MAX_PLAYERS}명입니다.`
    };
  }

  /*
   * 이미 같은 소켓이 있는지 확인
   */
  if (
    room.players.some(
      player =>
        player.socketId === socketId
    )
  ) {
    return {
      ok: false,

      reason:
        "이미 이 방에 참여 중입니다."
    };
  }

  const playerIndex =
    getAvailablePlayerIndex(room);

  if (playerIndex === null) {
    return {
      ok: false,

      reason:
        "사용 가능한 플레이어 자리가 없습니다."
    };
  }

  room.players.push({
    socketId,

    playerIndex,

    nickname,

    connected:
      true
  });

  return {
    ok: true,

    playerIndex
  };
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
        "플레이어 정보를 찾을 수 없습니다."
    };
  }

  if (
    player.connected === false
  ) {
    return {
      ok: false,

      reason:
        "현재 연결되어 있지 않습니다."
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

  /*
   * 실제 word.txt 검사
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
   * 일반 연결
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
   * 단어 등록
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

  let nextTurn = null;

  if (!ended) {
    nextTurn =
      getNextPlayerIndex(
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
   * 사람이 한 명도 없으면 방 삭제
   */
  if (room.players.length === 0) {
    ROOMS.delete(room.id);

    return removed;
  }

  /*
   * 2명 미만이면 게임 중지 상태
   */
  if (room.players.length < 2) {
    room.started = false;
    room.finished = false;
    room.currentWord = null;
    room.history = [];
    room.usedWords = new Set();
    room.winner = null;
    room.loser = null;

    const first =
      getActivePlayers(room)[0];

    room.turnPlayer =
      first?.playerIndex ?? null;

    return removed;
  }

  /*
   * 현재 턴인 사람이 나갔다면
   * 그 다음 사람에게 턴 넘김
   */
  if (wasTurn) {
    room.turnPlayer =
      getNextPlayerIndex(
        room,
        removed.playerIndex
      );
  }

  /*
   * 남은 플레이어가 현재 턴이 없으면
   * 첫 플레이어 지정
   */
  if (
    room.turnPlayer === null ||
    room.turnPlayer === undefined
  ) {
    room.turnPlayer =
      getActivePlayers(room)[0]
        ?.playerIndex ?? null;
  }

  return removed;
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
          ).length,

        maxPlayers:
          MAX_PLAYERS
      }
    );

    /* =====================================================
       방 생성
    ===================================================== */

    socket.on(
      "room:create",
      data => {
        try {
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
       방 입장
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

          const oldRoom =
            findRoomBySocket(
              socket.id
            );

          if (oldRoom) {
            socket.emit(
              "room:error",
              {
                ok: false,

                reason:
                  "이미 다른 방에 참여 중입니다."
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

          /*
           * 두 명 이상이면 게임 시작
           */
          if (
            room.players.length >= 2 &&
            !room.started
          ) {
            startRoomGame(room);
          } else {
            broadcastRoomState(room);
          }

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
       방 상태 요청
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
          getPublicRoomState(room)
        );
      }
    );

    /* =====================================================
       단어 처리 공통 함수
    ===================================================== */

    function handleWordSubmit(data) {
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

        const word =
          data?.word ??
          data?.inputWord ??
          "";

        const result =
          playRoomWord(
            room,
            player.playerIndex,
            word
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
         * 전체 상태
         */
        broadcastRoomState(room);

        /*
         * 종료
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

    /* =====================================================
       온라인 단어 제출
    ===================================================== */

    socket.on(
      "game:word",
      handleWordSubmit
    );

    /* =====================================================
       기존 game:submit 호환
    ===================================================== */

    socket.on(
      "game:submit",
      handleWordSubmit
    );

    /* =====================================================
       게임 재시작
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

        if (room.players.length < 2) {
          socket.emit(
            "game:error",
            {
              ok: false,

              reason:
                "게임을 시작하려면 2명 이상이 필요합니다."
            }
          );

          return;
        }

        const requestedStart =
          normalizeWord(
            data?.startChar
          ).at(0);

        if (requestedStart) {
          room.startChar =
            requestedStart;
        }

        room.started = true;
        room.finished = false;

        room.currentWord =
          null;

        room.history =
          [];

        room.usedWords =
          new Set();

        room.winner =
          null;

        room.loser =
          null;

        room.turnPlayer =
          getActivePlayers(room)[0]
            ?.playerIndex ?? null;

        broadcastRoomState(room);

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
       방 나가기
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

        const removed =
          removePlayerFromRoom(
            room,
            socket.id
          );

        socket.leave(
          room.id
        );

        socket.data.roomId =
          null;

        socket.data.playerIndex =
          null;

        /*
         * 방 자체가 삭제된 경우
         */
        if (!ROOMS.has(room.id)) {
          return;
        }

        io.to(room.id).emit(
          "room:playerLeft",
          {
            ok: true,

            playerIndex:
              removed?.playerIndex,

            nickname:
              removed?.nickname,

            state:
              getPublicRoomState(
                room
              )
          }
        );

        broadcastRoomState(room);
      }
    );

    /* =====================================================
       연결 종료
    ===================================================== */

    socket.on(
      "disconnect",
      reason => {
        const room =
          findRoomBySocket(
            socket.id
          );

        if (room) {
          const removed =
            removePlayerFromRoom(
              room,
              socket.id
            );

          /*
           * 방 삭제
           */
          if (
            !ROOMS.has(room.id)
          ) {
            console.log(
              `[ROOM DELETE] ${room.id}`
            );
          } else {
            io.to(room.id).emit(
              "room:playerLeft",
              {
                ok: true,

                reason:
                  "플레이어의 연결이 종료되었습니다.",

                playerIndex:
                  removed?.playerIndex,

                nickname:
                  removed?.nickname,

                state:
                  getPublicRoomState(
                    room
                  )
              }
            );

            broadcastRoomState(room);
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

      maxPlayers:
        MAX_PLAYERS,

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
      "끝말잇기 온라인 멀티플레이 서버 시작"
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      `MAX PLAYERS: ${MAX_PLAYERS}`
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
