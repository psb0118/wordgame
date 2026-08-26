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

  /* 원래 글자 */
  result.add(lastChar);

  /* 정방향 */
  const direct = DEFAULT_DUEUM[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      if (char) {
        result.add(char);
      }
    }
  }

  /* 역방향 */
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
   단어 목록 로딩
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
    const line
    of text.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    /*
     * 일반적인 형식:
     *
     * 단어
     *
     * 또는
     *
     * 단어 기타정보
     */
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

    /*
     * attack.txt 형식:
     *
     * 단어 깊이
     */
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
    `공격 단어 로딩 완료: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
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
    new Set(
      allowedFirstChars(
        previousWord.at(-1)
      )
    );

  const result = [];

  /*
   * 단어 50만 개를 매번 전체 순회하는 것은
   * 온라인 게임에서 비효율적이므로
   * 여기서는 서버 시작 시 인덱스를 만든다.
   */

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
   첫 글자 인덱스
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
   게임 종료 여부
========================================================= */

function checkGameOver(
  game,
  lastPlayer
) {
  const next =
    getCandidates(
      game.currentWord,
      game.usedWords
    );

  if (next.length > 0) {
    return false;
  }

  game.finished = true;

  game.winner =
    lastPlayer;

  game.loser =
    lastPlayer === 0
      ? 1
      : 0;

  return true;
}

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
   방
========================================================= */

const ROOMS = new Map();

/*
 * room = {
 *
 *   id,
 *
 *   players: [
 *     {
 *       socketId,
 *       playerIndex,
 *       nickname
 *     }
 *   ],
 *
 *   startChar,
 *   currentWord,
 *   turnPlayer,
 *   history,
 *   usedWords,
 *   finished,
 *   winner,
 *   loser
 *
 * }
 */

/* =========================================================
   공개 방 상태
========================================================= */

function getPublicRoomState(
  room
) {
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
      room.history.map(
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
   방 브로드캐스트
========================================================= */

function broadcastRoomState(
  room
) {
  if (!room) {
    return;
  }

  io.to(room.id).emit(
    "game:state",
    getPublicRoomState(room)
  );
}

/* =========================================================
   방 찾기
========================================================= */

function findRoomBySocket(
  socketId
) {
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
  nickname = "플레이어",
  startChar = ""
}) {
  const roomId =
    createRoomId();

  const room = {
    id: roomId,

    players: [
      {
        socketId,
        playerIndex: 0,
        nickname
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
  nickname = "플레이어"
) {
  if (!room) {
    return {
      ok: false,
      reason:
        "방을 찾을 수 없습니다."
    };
  }

  if (
    room.players.length >= 2
  ) {
    return {
      ok: false,
      reason:
        "방이 가득 찼습니다."
    };
  }

  if (
    room.finished
  ) {
    return {
      ok: false,
      reason:
        "이미 종료된 방입니다."
    };
  }

  room.players.push({
    socketId,
    playerIndex: 1,
    nickname
  });

  return {
    ok: true
  };
}

/* =========================================================
   방 나가기
========================================================= */

function removePlayerFromRoom(
  room,
  socketId
) {
  if (!room) {
    return;
  }

  const index =
    room.players.findIndex(
      player =>
        player.socketId ===
        socketId
    );

  if (index === -1) {
    return;
  }

  room.players.splice(
    index,
    1
  );

  /*
   * 남은 플레이어가 있으면
   * 0번으로 재배정.
   */
  if (
    room.players.length === 1
  ) {
    room.players[0]
      .playerIndex = 0;
  }

  if (
    room.players.length === 0
  ) {
    ROOMS.delete(
      room.id
    );
  }
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
  if (
    !room.currentWord
  ) {
    if (
      room.startChar
    ) {
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
  else if (
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
   * 게임 종료 검사
   */
  const ended =
    checkGameOver(
      room,
      playerIndex
    );

  if (!ended) {
    room.turnPlayer =
      playerIndex === 0
        ? 1
        : 0;
  }

  return {
    ok: true,

    finished:
      room.finished,

    word,

    depth,

    nextTurn:
      room.turnPlayer,

    winner:
      room.winner,

    loser:
      room.loser,

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
   방 삭제
========================================================= */

function deleteRoom(
  room
) {
  if (!room) {
    return;
  }

  ROOMS.delete(
    room.id
  );
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
       기본 연결 확인
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
       방 생성
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

          /*
           * 기존 방이 있으면 제거
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
            1;

          socket.emit(
            "room:joined",
            {
              ok: true,

              roomId:
                room.id,

              playerIndex:
                1,

              state:
                getPublicRoomState(
                  room
                )
            }
          );

          /*
           * 방 전체에 상태 전달
           */
          broadcastRoomState(
            room
          );

          /*
           * 상대방 입장 알림
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
            `[ROOM JOIN] ${room.id} / ${socket.id}`
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
          getPublicRoomState(
            room
          )
        );
      }
    );

    /* =====================================================
       온라인 단어 제출
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
           * 성공한 단어를 방 전체에 전달
           */
          io.to(room.id).emit(
            "game:word",
            {
              ok: true,

              word:
                result.word,

              player:
                player.playerIndex,

              depth:
                result.depth,

              finished:
                result.finished,

              winner:
                result.winner,

              loser:
                result.loser
            }
          );

          /*
           * 최신 상태
           */
          broadcastRoomState(
            room
          );

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
       game:submit
       
       클라이언트에서 이 이벤트 이름을 사용해도
       game:word와 동일하게 처리한다.
    ===================================================== */

    socket.on(
      "game:submit",
      data => {
        socket.emit(
          "game:submit:redirect"
        );

        /*
         * 직접 처리
         */
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
              player.playerIndex,

            depth:
              result.depth,

            finished:
              result.finished,

            winner:
              result.winner,

            loser:
              result.loser
          }
        );

        broadcastRoomState(
          room
        );

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
      }
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

        /*
         * 두 명이 있어야 재시작
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

        room.startChar =
          normalizeWord(
            data?.startChar
          ).at(0) ||
          room.startChar ||
          "";

        room.currentWord =
          null;

        room.turnPlayer =
          0;

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

        io.to(room.id).emit(
          "room:playerLeft",
          {
            ok: true,

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
          removePlayerFromRoom(
            room,
            socket.id
          );

          io.to(room.id).emit(
            "room:playerLeft",
            {
              ok: true,

              reason:
                "상대방의 연결이 종료되었습니다.",

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
      "========================================"
    );
  }
);

/* =========================================================
   종료 처리
========================================================= */

function shutdown(
  signal
) {
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
