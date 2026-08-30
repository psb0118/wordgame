const express = require("express");
const { Server } = require("socket.io");

/* =========================================================
   기본 설정
========================================================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
cors: {
origin: "*",
methods: ["GET", "POST"]
  }
  },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;

const ROOT_DIR = path.join(__dirname, "..");
const CLIENT_DIR = path.join(ROOT_DIR, "client");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");

app.use(express.json());

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}
const PORT = Number(process.env.PORT) || 3000;

/*
 * 최대 플레이어 수.
 *
 * 환경변수 MAX_PLAYERS가 있으면 그것을 사용하고
 * 없으면 8명.
 *
 * 2~N명 구조.
 */
const MAX_PLAYERS =
  Math.max(
    2,
    Number(process.env.MAX_PLAYERS) || 8
  );

if (fs.existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR));
}
/*
 * 한 턴 제한시간.
 * 기본 15초.
 */
const TURN_TIME =
  Math.max(
    5,
    Number(process.env.TURN_TIME) || 15
  );

app.use(express.static(ROOT_DIR));
/*
 * 하트.
 */
const MAX_HEARTS = 2;

/* =========================================================
   설정
   경로
========================================================= */

const DEFAULT_HEARTS = 2;
const DEFAULT_TURN_TIME = 15;
const ROOT_DIR =
  path.join(__dirname, "..");

const PUBLIC_DIR =
  path.join(ROOT_DIR, "public");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 20;
const CLIENT_DIR =
  path.join(ROOT_DIR, "client");

const MIN_TURN_TIME = 5;
const MAX_TURN_TIME = 60;
const DATA_DIR =
  path.join(ROOT_DIR, "data");

/* =========================================================
   데이터 경로
   데이터 파일 후보
========================================================= */

const WORD_FILES = [
const WORD_FILE_CANDIDATES = [
path.join(ROOT_DIR, "word.txt"),
path.join(DATA_DIR, "word.txt"),
path.join(PUBLIC_DIR, "word.txt")
];

const ATTACK_FILES = [
const ATTACK_FILE_CANDIDATES = [
path.join(ROOT_DIR, "attack.txt"),
path.join(DATA_DIR, "attack.txt"),
path.join(PUBLIC_DIR, "attack.txt")
];

/* =========================================================
   정적 파일
========================================================= */

app.use(express.json());

/*
 * 프로젝트 전체를 정적으로 제공.
 *
 * 이렇게 해두면
 *
 * /
 * /index.html
 * /client/script.js
 * /public/...
 *
 * 등이 정상적으로 접근 가능.
 */
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
const WORDS =
  new Set();

const ATTACK_DEPTH =
  Object.create(null);

const WORD_INDEX =
  new Map();

/* =========================================================
  두음법칙
@@ -141,7 +194,7 @@ function normalizeWord(word) {
.normalize("NFC");
}

function findFile(files) {
function findExistingFile(files) {
for (const file of files) {
if (fs.existsSync(file)) {
return file;
@@ -155,800 +208,1561 @@ function findFile(files) {
  두음
========================================================= */

function allowedFirstChars(char) {
  char = normalizeWord(char);
function allowedFirstChars(lastChar) {
  lastChar =
    normalizeWord(lastChar);

  if (!char) {
  if (!lastChar) {
return [];
}

  const result = new Set();
  const result =
    new Set();

  result.add(char);
  result.add(lastChar);

  const direct = DUEUM[char];
  const direct =
    DUEUM[lastChar];

if (Array.isArray(direct)) {
    for (const value of direct) {
      result.add(value);
    for (const char of direct) {
      result.add(char);
}
}

  for (const [from, values] of Object.entries(DUEUM)) {
    if (Array.isArray(values) && values.includes(char)) {
  for (
    const [from, values]
    of Object.entries(DUEUM)
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

function canConnect(previousWord, nextWord) {
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);
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

  const last = previousWord.at(-1);
  const first = nextWord.at(0);
  const last =
    previousWord.at(-1);

  const first =
    nextWord.at(0);

  return allowedFirstChars(last).includes(first);
  return allowedFirstChars(last)
    .includes(first);
}

/* =========================================================
  단어 로딩
========================================================= */

function loadWords() {
  const file = findFile(WORD_FILES);
  const file =
    findExistingFile(
      WORD_FILE_CANDIDATES
    );

if (!file) {
    console.error("word.txt를 찾을 수 없습니다.");
    console.error(
      "ERROR: word.txt를 찾을 수 없습니다."
    );

return;
}

  const text = fs.readFileSync(file, "utf8");
  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

WORDS.clear();

  for (const line of text.split(/\r?\n/)) {
    const first = line.trim().split(/\s+/)[0];
  for (
    const line
    of text.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (!first) {
    if (!trimmed) {
continue;
}

    const word = normalizeWord(first);
    /*
     * 첫 번째 필드를 단어로 사용.
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
    `단어 로딩: ${WORDS.size.toLocaleString()}개`
  );

  console.log(
    `word.txt: ${file}`
);
  console.log(`word.txt: ${file}`);
}

/* =========================================================
   공격 단어 로딩
========================================================= */

function loadAttackWords() {
  const file = findFile(ATTACK_FILES);
  const file =
    findExistingFile(
      ATTACK_FILE_CANDIDATES
    );

if (!file) {
    console.warn("attack.txt를 찾을 수 없습니다.");
    console.warn(
      "WARNING: attack.txt를 찾을 수 없습니다."
    );

return;
}

  const text = fs.readFileSync(file, "utf8");
  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
  for (
    const line
    of text.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (!parts[0]) {
    if (!trimmed) {
continue;
}

    const word = normalizeWord(parts[0]);
    const depth = Number(parts[1]);
    const parts =
      trimmed.split(/\s+/);

    const word =
      normalizeWord(parts[0]);

    const depth =
      Number(parts[1]);

if (
word &&
Number.isFinite(depth)
) {
      ATTACK_DEPTH[word] = depth;
      ATTACK_DEPTH[word] =
        depth;
}
}

console.log(
    `공격 단어 로딩 완료: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
    `공격 단어 로딩: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`
);
}

/* =========================================================
   인덱스
========================================================= */

function buildWordIndex() {
WORD_INDEX.clear();

for (const word of WORDS) {
    const first = word.at(0);
    const first =
      word.at(0);

if (!first) {
continue;
}

if (!WORD_INDEX.has(first)) {
      WORD_INDEX.set(first, []);
      WORD_INDEX.set(
        first,
        []
      );
}

    WORD_INDEX.get(first).push(word);
    WORD_INDEX
      .get(first)
      .push(word);
}

console.log(
    `단어 인덱스 생성 완료: ${WORD_INDEX.size}개`
    `단어 인덱스 생성: ${WORD_INDEX.size}개 시작 글자`
);
}

/* =========================================================
   초기화
========================================================= */

loadWords();
loadAttackWords();
buildWordIndex();

/* =========================================================
   후보
   단어 후보
========================================================= */

function getCandidates(previousWord, usedWords) {
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
      : new Set(usedWords || []);
      : new Set(
          usedWords || []
        );

const result = [];

  for (
    const firstChar
    of allowedFirstChars(previousWord.at(-1))
  ) {
    const bucket = WORD_INDEX.get(firstChar);
  const allowed =
    allowedFirstChars(
      previousWord.at(-1)
    );

  for (const first of allowed) {
    const bucket =
      WORD_INDEX.get(first);

if (!bucket) {
continue;
}

for (const word of bucket) {
      if (!used.has(word)) {
        result.push(word);
      if (used.has(word)) {
        continue;
}

      result.push(word);
}
}

return result;
}

function getStartCandidates(usedWords = new Set()) {
  const result = [];

  for (const word of WORDS) {
    if (usedWords.has(word)) {
      continue;
    }
/* =========================================================
   단어 검사
========================================================= */

    const next = getCandidates(
      word,
      new Set([word])
    );
function hasWord(word) {
  return WORDS.has(
    normalizeWord(word)
  );
}

    if (next.length > 0) {
      result.push(word);
    }
  }
function getAttackDepth(word) {
  const depth =
    ATTACK_DEPTH[word];

  return result;
  return Number.isFinite(depth)
    ? depth
    : null;
}

/* =========================================================
   시작 단어
   시작 단어 자동 선택
========================================================= */

function chooseStartWord() {
  const candidates = getStartCandidates();
function chooseStartWord(
  startChar,
  usedWords
) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set();

  let candidates = [];

  if (!candidates.length) {
  /*
   * 사용자가 시작 글자를 정한 경우.
   */
  if (startChar) {
    const allowed =
      allowedFirstChars(
        startChar
      );

    for (const first of allowed) {
      const bucket =
        WORD_INDEX.get(first);

      if (!bucket) {
        continue;
      }

      for (const word of bucket) {
        if (!used.has(word)) {
          candidates.push(word);
        }
      }
    }
  }

  /*
   * 시작 글자가 없다면 전체 단어에서 선택.
   */
  if (candidates.length === 0) {
    for (const word of WORDS) {
      if (!used.has(word)) {
        candidates.push(word);
      }

      /*
       * 무작위 시작을 위한 샘플 제한.
       */
      if (candidates.length >= 5000) {
        break;
      }
    }
  }

  if (candidates.length === 0) {
return null;
}

  return candidates[
    Math.floor(Math.random() * candidates.length)
  /*
   * 시작하자마자 한방으로 끝나는 단어는
   * 가능한 한 피한다.
   */
  const safe = [];

  for (const word of candidates) {
    const next =
      getCandidates(
        word,
        used
      );

    if (next.length > 0) {
      safe.push(word);
    }
  }

  const pool =
    safe.length > 0
      ? safe
      : candidates;

  return pool[
    Math.floor(
      Math.random() * pool.length
    )
];
}

/* =========================================================
  방
========================================================= */

const ROOMS = new Map();
const ROOMS =
  new Map();

/* =========================================================
   방 ID
========================================================= */

function createRoomId() {
let id;

do {
    id = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
    id =
      Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();
} while (ROOMS.has(id));

return id;
}

function createRoom({
/* =========================================================
   플레이어
========================================================= */

function createPlayer({
socketId,
  playerIndex,
nickname,
  maxPlayers,
  turnTime,
  aiEnabled,
  aiLevel
  isBot = false
}) {
  const id = createRoomId();

  const room = {
    id,

    hostSocketId: socketId,

    maxPlayers,

    turnTime,

    aiEnabled: !!aiEnabled,
  return {
    socketId:
      socketId || null,

    aiLevel: Number(aiLevel) || 3,
    playerIndex,

    players: [],
    nickname:
      nickname || `플레이어 ${playerIndex + 1}`,

    currentWord: null,
    isBot,

    turnIndex: 0,
    connected:
      !isBot,

    history: [],
    hearts:
      MAX_HEARTS,

    usedWords: new Set(),
    eliminated:
      false
  };
}

    finished: false,
/* =========================================================
   방 생성
========================================================= */

    winner: null,
function createRoom({
  socketId,
  nickname,
  startChar,
  mode,
  maxPlayers,
  aiLevel
}) {
  const roomId =
    createRoomId();

    started: false,
  const room = {
    id: roomId,

    mode:
      mode === "ai"
        ? "ai"
        : "online",

    maxPlayers:
      Math.min(
        MAX_PLAYERS,
        Math.max(
          2,
          Number(maxPlayers) || 2
        )
      ),

    timer: null,
    aiLevel:
      Math.min(
        5,
        Math.max(
          1,
          Number(aiLevel) || 5
        )
      ),

    turnStartedAt: null,
    players: [],

    turnExpiresAt: null
  };
    startChar:
      normalizeWord(startChar).at(0) || "",

  ROOMS.set(id, room);
    currentWord:
      null,

  addPlayer(
    room,
    socketId,
    nickname,
    false
  );
    turnPlayer:
      0,

  return room;
}
    turnNumber:
      0,

/* =========================================================
   플레이어
========================================================= */
    history: [],

function addPlayer(
  room,
  socketId,
  nickname,
  isAI = false
) {
  if (room.players.length >= room.maxPlayers) {
    return null;
  }
    usedWords:
      new Set(),

  const player = {
    id:
      isAI
        ? `AI_${room.id}`
        : socketId,
    finished:
      false,

    socketId:
      isAI
        ? null
        : socketId,
    started:
      false,

    nickname:
      nickname || "플레이어",
    winner:
      null,

    hearts: DEFAULT_HEARTS,
    loser:
      null,

    alive: true,
    turnStartedAt:
      null,

    isAI,
    turnEndsAt:
      null,

    aiLevel:
      isAI
        ? room.aiLevel
        : null
    timer:
      null
};

  room.players.push(player);

  return player;
}
  const firstPlayer =
    createPlayer({
      socketId,
      playerIndex: 0,
      nickname
    });

function getPlayerBySocket(room, socketId) {
  return room.players.find(
    player =>
      player.socketId === socketId
  room.players.push(
    firstPlayer
);
}

function getAlivePlayers(room) {
  return room.players.filter(
    player => player.alive
  /*
   * AI 방이면 AI를 바로 추가.
   */
  if (room.mode === "ai") {
    room.players.push(
      createPlayer({
        playerIndex: 1,
        nickname:
          `AI Lv.${room.aiLevel}`,
        isBot: true
      })
    );
  }

  ROOMS.set(
    roomId,
    room
);
}

function getCurrentPlayer(room) {
  return room.players[room.turnIndex] || null;
  return room;
}

/* =========================================================
   턴 이동
   공개 상태
========================================================= */

function moveToNextAlivePlayer(room) {
  if (!room.players.length) {
function getPublicRoomState(room) {
  if (!room) {
return null;
}

  const count = room.players.length;

  for (let i = 1; i <= count; i++) {
    const index =
      (room.turnIndex + i) % count;
  return {
    roomId:
      room.id,

    const player = room.players[index];
    mode:
      room.mode,

    if (player && player.alive) {
      room.turnIndex = index;
      return player;
    }
  }
    maxPlayers:
      room.maxPlayers,

  return null;
}
    aiLevel:
      room.aiLevel,

/* =========================================================
   상태
========================================================= */
    startChar:
      room.startChar,

function getPublicState(room) {
  const current = getCurrentPlayer(room);
    currentWord:
      room.currentWord,

  return {
    roomId: room.id,
    turnPlayer:
      room.turnPlayer,

    maxPlayers: room.maxPlayers,
    turnNumber:
      room.turnNumber,

    playerCount: room.players.length,
    history:
      room.history.map(item => ({
        word:
          item.word,

    turnTime: room.turnTime,
        player:
          item.player,

    currentWord: room.currentWord,
        turn:
          item.turn,

    turnPlayer: current
      ? current.id
      : null,
        depth:
          item.depth,

    turnIndex: room.turnIndex,
        timestamp:
          item.timestamp
      })),

    turnStartedAt:
      room.turnStartedAt,
    usedCount:
      room.usedWords.size,

    turnExpiresAt:
      room.turnExpiresAt,
    finished:
      room.finished,

started:
room.started,

    finished:
      room.finished,

winner:
room.winner,

    loser:
      room.loser,

    playerCount:
      room.players.length,

    turnStartedAt:
      room.turnStartedAt,

    turnEndsAt:
      room.turnEndsAt,

    turnTime:
      TURN_TIME,

players:
room.players.map(player => ({
        id: player.id,

playerIndex:
          room.players.indexOf(player),
          player.playerIndex,

nickname:
player.nickname,

        hearts:
          player.hearts,
        isBot:
          player.isBot,

        alive:
          player.alive,
        connected:
          player.connected,

        isAI:
          player.isAI
      })),
        hearts:
          player.hearts,

    history:
      room.history.map(item => ({
        word: item.word,
        playerId: item.playerId,
        playerIndex: item.playerIndex,
        nickname: item.nickname,
        depth: item.depth,
        turn: item.turn
        eliminated:
          player.eliminated
}))
};
}

function broadcastState(room) {
  io.to(room.id).emit(
    "game:state",
    getPublicState(room)
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
   하트
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
   실제 플레이어
========================================================= */

function damagePlayer(
function getPlayer(
room,
  player,
  reason
  playerIndex
) {
  return room?.players.find(
    player =>
      player.playerIndex ===
      playerIndex
  ) || null;
}

/* =========================================================
   살아있는 플레이어
========================================================= */

function getAlivePlayers(room) {
  return room.players.filter(
    player =>
      !player.eliminated
  );
}

/* =========================================================
   승자 판정
========================================================= */

function finishGame(
  room,
  winnerIndex,
  loserIndex
) {
  if (!player || !player.alive) {
  if (!room || room.finished) {
return;
}

  player.hearts--;
  room.finished = true;

  room.winner =
    winnerIndex;

  room.loser =
    loserIndex;

  stopTurnTimer(room);

io.to(room.id).emit(
    "player:heartLost",
    "game:finished",
{
      playerId: player.id,
      ok: true,

      playerIndex:
        room.players.indexOf(player),
      winner:
        winnerIndex,

      hearts:
        player.hearts,
      loser:
        loserIndex,

      reason
      state:
        getPublicRoomState(room)
}
);

  if (player.hearts <= 0) {
    player.hearts = 0;
    player.alive = false;

    io.to(room.id).emit(
      "player:eliminated",
      {
        playerId: player.id,

        playerIndex:
          room.players.indexOf(player),

        nickname:
          player.nickname
      }
    );
  }
  broadcastRoomState(room);
}

/* =========================================================
   게임 종료
   턴 플레이어 찾기
========================================================= */

function checkFinished(room) {
  const alive = getAlivePlayers(room);

  if (alive.length <= 1) {
    room.finished = true;

    room.winner =
      alive.length === 1
        ? alive[0].id
        : null;
function findNextAlivePlayer(
  room,
  currentIndex
) {
  if (!room.players.length) {
    return null;
  }

    clearTurnTimer(room);
  const total =
    room.players.length;

    io.to(room.id).emit(
      "game:finished",
      {
        winner: room.winner,
  for (let i = 1; i <= total; i++) {
    const index =
      (currentIndex + i) % total;

        state:
          getPublicState(room)
      }
    );
    const player =
      room.players[index];

    return true;
    if (
      player &&
      !player.eliminated
    ) {
      return player.playerIndex;
    }
}

  return false;
  return null;
}

/* =========================================================
   타이머
   턴 타이머
========================================================= */

function clearTurnTimer(room) {
function stopTurnTimer(room) {
  if (!room) {
    return;
  }

if (room.timer) {
clearTimeout(room.timer);
room.timer = null;
}

  room.turnStartedAt = null;
  room.turnEndsAt = null;
}

function startTurnTimer(room) {
  clearTurnTimer(room);

  if (
    !room.started ||
    room.finished
  ) {
  if (!room || room.finished) {
return;
}

  stopTurnTimer(room);

const player =
    getCurrentPlayer(room);
    getPlayer(
      room,
      room.turnPlayer
    );

  if (!player || !player.alive) {
  if (!player || player.eliminated) {
return;
}

  room.turnStartedAt =
  const now =
Date.now();

  room.turnExpiresAt =
    Date.now() +
    room.turnTime * 1000;

  broadcastState(room);
  room.turnStartedAt =
    now;

  room.timer = setTimeout(() => {
    handleTimeout(room);
  }, room.turnTime * 1000 + 50);
  room.turnEndsAt =
    now +
    TURN_TIME * 1000;

  if (player.isAI) {
  room.timer =
setTimeout(() => {
      if (
        room.finished ||
        !player.alive ||
        getCurrentPlayer(room)?.id !== player.id
      ) {
        return;
      }
      handleTurnTimeout(room);
    }, TURN_TIME * 1000);

      aiPlay(room, player);
    }, 500);
  broadcastRoomState(room);

  /*
   * AI 차례면 AI 처리.
   */
  if (player.isBot) {
    setTimeout(() => {
      runAI(room);
    }, 300);
}
}

function handleTimeout(room) {
  if (room.finished) {
/* =========================================================
   시간 초과
========================================================= */

function handleTurnTimeout(room) {
  if (!room || room.finished) {
return;
}

const player =
    getCurrentPlayer(room);
    getPlayer(
      room,
      room.turnPlayer
    );

  if (!player || !player.alive) {
  if (!player || player.eliminated) {
return;
}

  damagePlayer(
    room,
    player,
    "timeout"
  player.hearts--;

  stopTurnTimer(room);

  io.to(room.id).emit(
    "game:timeout",
    {
      ok: true,

      player:
        player.playerIndex,

      hearts:
        player.hearts
    }
);

  if (checkFinished(room)) {
    broadcastState(room);
  /*
   * 하트가 0이면 탈락.
   */
  if (player.hearts <= 0) {
    player.eliminated = true;

    const alive =
      getAlivePlayers(room);

    if (alive.length <= 1) {
      if (alive.length === 1) {
        finishGame(
          room,
          alive[0].playerIndex,
          player.playerIndex
        );
      } else {
        finishGame(
          room,
          null,
          player.playerIndex
        );
      }

      return;
    }

    /*
     * 다음 생존 플레이어로.
     */
    const next =
      findNextAlivePlayer(
        room,
        player.playerIndex
      );

    if (next === null) {
      finishGame(
        room,
        null,
        player.playerIndex
      );

      return;
    }

    room.turnPlayer =
      next;

    room.turnNumber++;

    broadcastRoomState(room);

    startTurnTimer(room);

return;
}

  moveToNextAlivePlayer(room);
  /*
   * 하트가 남았으면 같은 플레이어가
   * 다시 기회를 얻는다.
   */
  room.turnNumber++;

  broadcastRoomState(room);

startTurnTimer(room);
}

/* =========================================================
   단어 판정
   단어 성공 후 다음 턴
========================================================= */

function validateWord(
function advanceTurn(
room,
  player,
  rawWord
  currentPlayerIndex
) {
  const word =
    normalizeWord(rawWord);
  const next =
    findNextAlivePlayer(
      room,
      currentPlayerIndex
    );

  if (!word) {
    return {
      ok: false,
      reason: "단어를 입력해주세요."
    };
  }
  if (next === null) {
    finishGame(
      room,
      currentPlayerIndex,
      null
    );

  if (!room.started) {
    return {
      ok: false,
      reason: "게임이 아직 시작되지 않았습니다."
    };
    return;
}

  if (room.finished) {
    return {
      ok: false,
      reason: "이미 게임이 끝났습니다."
    };
  }
  room.turnPlayer =
    next;

  if (!player || !player.alive) {
    return {
      ok: false,
      reason: "현재 플레이어가 아닙니다."
    };
  }
  room.turnNumber++;

  const current =
    getCurrentPlayer(room);
  startTurnTimer(room);
}

  if (!current || current.id !== player.id) {
    return {
      ok: false,
      reason: "지금은 당신의 차례가 아닙니다."
    };
  }
/* =========================================================
   게임 시작
========================================================= */

  if (!WORDS.has(word)) {
function startNewGame(room) {
  if (!room) {
return {
ok: false,
      reason: "단어 목록에 없는 단어입니다."
      reason:
        "방을 찾을 수 없습니다."
};
}

  if (room.usedWords.has(word)) {
    return {
      ok: false,
      reason: "이미 사용한 단어입니다."
    };
  }
  const alive =
    getAlivePlayers(room);

if (
    room.currentWord &&
    !canConnect(
      room.currentWord,
      word
    )
    alive.length < 2
) {
return {
ok: false,
reason:
        `"${room.currentWord.at(-1)}" 다음에 연결할 수 없는 단어입니다.`,
      allowed:
        allowedFirstChars(
          room.currentWord.at(-1)
        )
        "게임을 시작하려면 최소 2명이 필요합니다."
};
}

  return {
    ok: true,
    word
  };
}
  stopTurnTimer(room);

/* =========================================================
   단어 등록
========================================================= */
  room.currentWord = null;

function playWord(
  room,
  player,
  rawWord
) {
  const result =
    validateWord(
      room,
      player,
      rawWord
    );
  room.history = [];

  if (!result.ok) {
    return result;
  }
  room.usedWords =
    new Set();

  clearTurnTimer(room);
  room.finished = false;

  const word = result.word;
  room.started = false;

  room.currentWord = word;
  room.winner = null;

  room.usedWords.add(word);
  room.loser = null;

  const depth =
    Number.isFinite(
      ATTACK_DEPTH[word]
    )
      ? ATTACK_DEPTH[word]
      : null;
  room.turnNumber = 0;

  const playerIndex =
    room.players.indexOf(player);
  room.turnPlayer =
    alive[0].playerIndex;

  room.history.push({
    word,
  /*
   * 하트 초기화.
   */
  for (const player of room.players) {
    player.hearts =
      MAX_HEARTS;

    playerId:
      player.id,
    player.eliminated =
      false;
  }

    playerIndex,
  /*
   * 시작 단어 자동 생성.
   */
  const startWord =
    chooseStartWord(
      room.startChar,
      room.usedWords
    );

    nickname:
      player.nickname,
  if (!startWord) {
    return {
      ok: false,
      reason:
        "시작할 수 있는 단어를 찾지 못했습니다."
    };
  }

  room.currentWord =
    startWord;

  room.usedWords.add(
    startWord
  );

  room.history.push({
    word:
      startWord,

    depth,
    player:
      -1,

turn:
      room.history.length + 1
      0,

    depth:
      getAttackDepth(startWord),

    timestamp:
      Date.now()
});

  room.started = true;

  /*
   * 시작 단어를 전체에 알림.
   */
io.to(room.id).emit(
    "game:word",
    "game:started",
{
ok: true,

      word,

      playerId:
        player.id,
      startWord,

      playerIndex,
      state:
        getPublicRoomState(room)
    }
  );

  broadcastRoomState(room);

  startTurnTimer(room);

  return {
    ok: true
  };
}

/* =========================================================
   게임 자동 시작 조건
========================================================= */

      nickname:
        player.nickname,
function tryStartRoom(room) {
  if (!room || room.finished) {
    return;
  }

      depth
  const alive =
    getAlivePlayers(room);

  /*
   * AI 방은 생성 직후.
   * 온라인 방은 2명 이상이면 시작.
   */
  if (
    room.mode === "ai" ||
    alive.length >= 2
  ) {
    if (!room.started) {
      startNewGame(room);
}
  }
}

/* =========================================================
   잘못된 단어 처리
========================================================= */

function handleInvalidWord(
  room,
  player,
  reason,
  allowed
) {
  if (!room || !player) {
    return;
  }

  /*
   * AI는 잘못된 단어를 제출하지 않는다.
   * 안전장치.
   */
  if (player.isBot) {
    return;
  }

  player.hearts--;

  const payload = {
    ok: false,

    reason,

    hearts:
      player.hearts,

    player:
      player.playerIndex
  };

  if (Array.isArray(allowed)) {
    payload.allowed =
      allowed;
  }

  playerError(
    player,
    "game:error",
    payload
);

  io.to(room.id).emit(
    "game:mistake",
    {
      ok: true,

      player:
        player.playerIndex,

      hearts:
        player.hearts,

      reason
    }
  );

  /*
   * 실패해도 하트가 남아 있으면
   * 같은 턴에서 다시 입력 가능.
   */
  if (player.hearts <= 0) {
    player.eliminated =
      true;

    stopTurnTimer(room);

    const alive =
      getAlivePlayers(room);

    if (alive.length <= 1) {
      if (alive.length === 1) {
        finishGame(
          room,
          alive[0].playerIndex,
          player.playerIndex
        );
      } else {
        finishGame(
          room,
          null,
          player.playerIndex
        );
      }

      return;
    }

    const next =
      findNextAlivePlayer(
        room,
        player.playerIndex
      );

    if (next === null) {
      finishGame(
        room,
        null,
        player.playerIndex
      );

      return;
    }

    room.turnPlayer =
      next;

    room.turnNumber++;

    broadcastRoomState(room);

    startTurnTimer(room);

    return;
  }

  broadcastRoomState(room);
}

/* =========================================================
   개별 오류
========================================================= */

function playerError(
  player,
  event,
  data
) {
  if (
    player &&
    player.socketId
  ) {
    io.to(
      player.socketId
    ).emit(
      event,
      data
    );
  }
}

/* =========================================================
   단어 제출
========================================================= */

function playWord(
  room,
  player,
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
        "게임이 이미 끝났습니다."
    };
  }

  if (!room.started) {
    return {
      ok: false,
      reason:
        "게임이 아직 시작되지 않았습니다."
    };
  }

  if (!player) {
    return {
      ok: false,
      reason:
        "플레이어를 찾을 수 없습니다."
    };
  }

  if (player.eliminated) {
    return {
      ok: false,
      reason:
        "탈락한 플레이어입니다."
    };
  }

if (
    checkFinished(room)
    room.turnPlayer !==
    player.playerIndex
) {
    broadcastState(room);
    return {
      ok: false,
      reason:
        "지금은 당신의 차례가 아닙니다."
    };
  }

  const word =
    normalizeWord(rawWord);

  if (!word) {
    handleInvalidWord(
      room,
      player,
      "단어를 입력해주세요."
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 실제 단어 목록.
   */
  if (!hasWord(word)) {
    handleInvalidWord(
      room,
      player,
      "단어 목록에 없는 단어입니다."
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 중복.
   */
  if (room.usedWords.has(word)) {
    handleInvalidWord(
      room,
      player,
      "이미 사용한 단어입니다."
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 연결.
   */
  if (
    room.currentWord &&
    !canConnect(
      room.currentWord,
      word
    )
  ) {
    const last =
      room.currentWord.at(-1);

    handleInvalidWord(
      room,
      player,
      `"${last}" 다음에 연결할 수 없는 단어입니다.`,
      allowedFirstChars(last)
    );

    return {
      ok: false,
      handled: true
    };
  }

  /*
   * 성공.
   */
  stopTurnTimer(room);

  room.currentWord =
    word;

  room.usedWords.add(
    word
  );

  room.history.push({
    word,

    player:
      player.playerIndex,

    turn:
      room.history.length,

    depth:
      getAttackDepth(word),

    timestamp:
      Date.now()
  });

  const next =
    getCandidates(
      word,
      room.usedWords
    );

  /*
   * 더 이상 단어가 없으면
   * 방금 단어를 낸 사람이 승리.
   */
  if (next.length === 0) {
    finishGame(
      room,
      player.playerIndex,
      findNextAlivePlayer(
        room,
        player.playerIndex
      )
    );

    io.to(room.id).emit(
      "game:word",
      {
        ok: true,

        word,

        player:
          player.playerIndex,

        depth:
          getAttackDepth(word),

        nextCount:
          0,

        finished:
          true,

        winner:
          room.winner,

        loser:
          room.loser
      }
    );

return {
ok: true,
finished: true
};
}

  moveToNextAlivePlayer(room);
  io.to(room.id).emit(
    "game:word",
    {
      ok: true,

      word,

      player:
        player.playerIndex,

      depth:
        getAttackDepth(word),

      nextCount:
        next.length,

      finished:
        false,

  broadcastState(room);
      winner:
        null,

      loser:
        null
    }
  );

  /*
   * 다음 생존 플레이어.
   */
  const nextPlayer =
    findNextAlivePlayer(
      room,
      player.playerIndex
    );

  if (nextPlayer === null) {
    finishGame(
      room,
      player.playerIndex,
      null
    );

    return {
      ok: true,
      finished: true
    };
  }

  room.turnPlayer =
    nextPlayer;

  room.turnNumber++;

  broadcastRoomState(room);

startTurnTimer(room);

@@ -964,10 +1778,9 @@ function playWord(

function scoreAIWord(
room,
  word,
  level
  word
) {
  const candidates =
  const next =
getCandidates(
word,
new Set([
@@ -976,872 +1789,1205 @@ function scoreAIWord(
])
);

  let score = 0;

const depth =
    Number.isFinite(
      ATTACK_DEPTH[word]
    getAttackDepth(word);

  let score =
    Math.random() * 10;

  /*
   * 공격 단어 우선.
   */
  if (depth !== null) {
    score +=
      depth * 20;
  }

  /*
   * 바로 상대를 끝낼 수 있는 단어.
   */
  if (next.length === 0) {
    score += 100000;
  }

  /*
   * 선택지가 적은 단어도 공격적.
   */
  if (next.length > 0) {
    score +=
      Math.max(
        0,
        100 - next.length
      );
  }

  /*
   * 너무 많은 선택지를 남기는 것은 약간 감점.
   */
  score -=
    Math.min(
      next.length,
      100
    ) * 0.15;

  return score;
}

function chooseAIWord(room) {
  const candidates =
    getCandidates(
      room.currentWord,
      room.usedWords
    );

  if (!candidates.length) {
    return null;
  }

  /*
   * AI 레벨별 후보 샘플.
   */
  let sampleSize;

  switch (room.aiLevel) {
    case 1:
      sampleSize = 30;
      break;

    case 2:
      sampleSize = 80;
      break;

    case 3:
      sampleSize = 200;
      break;

    case 4:
      sampleSize = 500;
      break;

    default:
      sampleSize = 1000;
      break;
  }

  const shuffled =
    candidates
      .slice()
      .sort(
        () =>
          Math.random() - 0.5
      )
      .slice(
        0,
        Math.min(
          sampleSize,
          candidates.length
        )
      );

  /*
   * Lv1은 공격 단어를 과도하게
   * 사용하지 않도록 랜덤성이 큼.
   */
  if (room.aiLevel === 1) {
    return shuffled[
      Math.floor(
        Math.random() *
        shuffled.length
      )
    ];
  }

  const scored =
    shuffled.map(word => ({
      word,
      score:
        scoreAIWord(
          room,
          word
        )
    }));

  scored.sort(
    (a, b) =>
      b.score - a.score
  );

  /*
   * Lv2~4도 무조건 1등만 선택하지 않고
   * 상위 후보에서 선택.
   */
  let poolSize;

  if (room.aiLevel === 2) {
    poolSize = 8;
  } else if (room.aiLevel === 3) {
    poolSize = 4;
  } else if (room.aiLevel === 4) {
    poolSize = 2;
  } else {
    poolSize = 1;
  }

  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );

  return pool[
    Math.floor(
      Math.random() *
      pool.length
)
      ? ATTACK_DEPTH[word]
      : null;
  ].word;
}

/* =========================================================
   AI 실행
========================================================= */

function runAI(room) {
  if (
    !room ||
    room.finished ||
    !room.started
  ) {
    return;
  }

  const player =
    getPlayer(
      room,
      room.turnPlayer
    );

  if (
    !player ||
    !player.isBot ||
    player.eliminated
  ) {
    return;
  }

  const word =
    chooseAIWord(room);

  if (!word) {
    finishGame(
      room,
      player.playerIndex,
      findNextAlivePlayer(
        room,
        player.playerIndex
      )
    );

    return;
  }

  playWord(
    room,
    player,
    word
  );
}

/* =========================================================
   방 참가
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

  if (room.mode !== "online") {
    return {
      ok: false,
      reason:
        "이 방은 AI 모드입니다."
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

/*
   * 다음 선택지가 적을수록 공격적인 단어
   * 이미 같은 소켓이 있다면
   * 재입장 취급.
  */
  score +=
    Math.max(
      0,
      100 - candidates.length
  const existing =
    room.players.find(
      player =>
        player.socketId === socketId
);

  /*
   * 공격 단어
   */
  if (depth !== null) {
    score += depth * 20 * level;
  }
  if (existing) {
    existing.connected = true;

  /*
   * 즉사 공격
   */
  if (candidates.length === 0) {
    score += 10000 * level;
    return {
      ok: true,
      playerIndex:
        existing.playerIndex,
      reconnect: true
    };
}

/*
   * 낮은 레벨은 너무 강한 공격을 자제
   * 빈 playerIndex 사용.
  */
  if (
    level <= 2 &&
    depth !== null &&
    depth >= 7
  let playerIndex = 0;

  while (
    room.players.some(
      player =>
        player.playerIndex ===
        playerIndex
    )
) {
    score -= 150;
    playerIndex++;
}

  /*
   * 랜덤성
   */
  score += Math.random() * 100;
  const player =
    createPlayer({
      socketId,
      playerIndex,
      nickname
    });

  return score;
  room.players.push(
    player
  );

  return {
    ok: true,
    playerIndex
  };
}

function chooseAIWord(room, level) {
  const player =
    getCurrentPlayer(room);
/* =========================================================
   방 나가기
========================================================= */

  if (!player) {
function removePlayer(
  room,
  socketId,
  reason = "leave"
) {
  if (!room) {
return null;
}

  let candidates =
    room.currentWord
      ? getCandidates(
          room.currentWord,
          room.usedWords
        )
      : chooseStartCandidatesForAI(room);
  const index =
    room.players.findIndex(
      player =>
        player.socketId === socketId
    );

  if (!candidates.length) {
  if (index === -1) {
return null;
}

  const player =
    room.players[index];

/*
   * AI 레벨별 후보 제한
   * AI는 삭제 금지.
  */
  if (level <= 1) {
    return candidates[
      Math.floor(
        Math.random() *
        candidates.length
      )
    ];
  if (player.isBot) {
    return null;
}

  if (level === 2) {
    candidates =
      candidates
        .map(word => ({
          word,
          score:
            scoreAIWord(
              room,
              word,
              0.3
            )
        }))
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(
          0,
          Math.min(10, candidates.length)
        )
        .map(item => item.word);
  } else {
    candidates =
      candidates
        .map(word => ({
          word,
          score:
            scoreAIWord(
              room,
              word,
              level
            )
        }))
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(
          0,
          Math.min(
            20,
            candidates.length
          )
        )
        .map(item => item.word);
  }
  room.players.splice(
    index,
    1
  );

  return candidates[
    Math.floor(
      Math.random() *
      candidates.length
    )
  ];
}
  /*
   * 게임 중이었다면 퇴장 플레이어 탈락.
   */
  if (
    room.started &&
    !room.finished
  ) {
    player.eliminated = true;

function chooseStartCandidatesForAI(room) {
  const candidates =
    getStartCandidates(
      room.usedWords
    );
    const alive =
      getAlivePlayers(room);

  return candidates;
}
    if (alive.length <= 1) {
      if (alive.length === 1) {
        finishGame(
          room,
          alive[0].playerIndex,
          player.playerIndex
        );
      }

function aiPlay(room, player) {
  if (
    room.finished ||
    !player.alive ||
    getCurrentPlayer(room)?.id !== player.id
  ) {
    return;
  }
      return player;
    }

  const word =
    chooseAIWord(
      room,
      player.aiLevel || room.aiLevel
    );
    if (
      room.turnPlayer ===
      player.playerIndex
    ) {
      stopTurnTimer(room);

  if (!word) {
    handleTimeout(room);
    return;
      const next =
        findNextAlivePlayer(
          room,
          player.playerIndex
        );

      if (next !== null) {
        room.turnPlayer =
          next;

        room.turnNumber++;

        startTurnTimer(room);
      }
    }
}

  playWord(
    room,
    player,
    word
  );
  return player;
}

/* =========================================================
   새 게임
   Socket.IO
========================================================= */

function startNewGame(room) {
  clearTurnTimer(room);

  for (const player of room.players) {
    player.hearts = DEFAULT_HEARTS;
    player.alive = true;
  }
io.on(
  "connection",
  socket => {
    console.log(
      `[CONNECT] ${socket.id}`
    );

  room.currentWord = null;
    socket.emit(
      "server:ready",
      {
        ok: true,

  room.turnIndex = 0;
        words:
          WORDS.size,

  room.history = [];
        attackWords:
          Object.keys(
            ATTACK_DEPTH
          ).length,

  room.usedWords = new Set();
        maxPlayers:
          MAX_PLAYERS,

  room.finished = false;
        turnTime:
          TURN_TIME,

  room.winner = null;
        maxHearts:
          MAX_HEARTS
      }
    );

  room.started = true;
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

          const mode =
            data?.mode === "ai"
              ? "ai"
              : "online";

          const maxPlayers =
            mode === "ai"
              ? 2
              : Math.min(
                  MAX_PLAYERS,
                  Math.max(
                    2,
                    Number(
                      data?.maxPlayers
                    ) || 2
                  )
                );

          const aiLevel =
            Math.min(
              5,
              Math.max(
                1,
                Number(
                  data?.aiLevel
                ) || 5
              )
            );

          /*
           * 기존 방 제거.
           */
          const oldRoom =
            findRoomBySocket(
              socket.id
            );

          if (oldRoom) {
            socket.leave(
              oldRoom.id
            );

            removePlayer(
              oldRoom,
              socket.id,
              "recreate"
            );

  /*
   * 새 게임 시작 단어 자동 생성
   */
  const startWord =
    chooseStartWord();
            broadcastRoomState(
              oldRoom
            );
          }

  if (!startWord) {
    room.started = false;
          const room =
            createRoom({
              socketId:
                socket.id,

    return {
      ok: false,
      reason:
        "사용할 수 있는 시작 단어를 찾지 못했습니다."
    };
  }
              nickname,

  room.currentWord = startWord;
              startChar,

  room.usedWords.add(startWord);
              mode,

  room.history.push({
    word: startWord,
              maxPlayers,

    playerId: "SYSTEM",
              aiLevel
            });

    playerIndex: -1,
          socket.join(
            room.id
          );

    nickname: "시작 단어",
          socket.data.roomId =
            room.id;

    depth:
      Number.isFinite(
        ATTACK_DEPTH[startWord]
      )
        ? ATTACK_DEPTH[startWord]
        : null,
          socket.data.playerIndex =
            0;

    turn: 0
  });
          socket.emit(
            "room:created",
            {
              ok: true,

  /*
   * 첫 번째 플레이어가 시작
   */
  room.turnIndex = 0;
              roomId:
                room.id,

  io.to(room.id).emit(
    "game:started",
    {
      ok: true,
              playerIndex:
                0,

      startWord,
              state:
                getPublicRoomState(
                  room
                )
            }
          );

      state:
        getPublicState(room)
    }
  );
          /*
           * AI 방은 즉시 시작.
           */
          if (room.mode === "ai") {
            tryStartRoom(room);
          }

  broadcastState(room);
          broadcastRoomState(room);

  startTurnTimer(room);
          console.log(
            `[ROOM CREATE] ${room.id} / ${socket.id} / ${room.mode}`
          );
        } catch (error) {
          console.error(
            "room:create 오류:",
            error
          );

  return {
    ok: true,
    startWord
  };
}
          socket.emit(
            "room:error",
            {
              ok: false,

/* =========================================================
   소켓
========================================================= */
              reason:
                "방을 생성하지 못했습니다."
            }
          );
        }
      }
    );

io.on("connection", socket => {
  console.log(
    `[CONNECT] ${socket.id}`
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

  socket.emit(
    "server:ready",
    {
      ok: true,
            return;
          }

      words:
        WORDS.size,
          const room =
            ROOMS.get(roomId);

      attackWords:
        Object.keys(
          ATTACK_DEPTH
        ).length
    }
  );
          const result =
            joinRoom(
              room,
              socket.id,
              nickname
            );

  /* =======================================================
     방 생성
  ======================================================= */
          if (!result.ok) {
            socket.emit(
              "room:error",
              result
            );

  socket.on(
    "room:create",
    data => {
      try {
        const nickname =
          normalizeWord(
            data?.nickname
          ) || "플레이어";

        const maxPlayers =
          Math.min(
            MAX_PLAYERS,
            Math.max(
              MIN_PLAYERS,
              Number(
                data?.maxPlayers
              ) || 2
            )
          );
            return;
          }

        const turnTime =
          Math.min(
            MAX_TURN_TIME,
            Math.max(
              MIN_TURN_TIME,
              Number(
                data?.turnTime
              ) || DEFAULT_TURN_TIME
            )
          socket.join(
            room.id
);

        const room =
          createRoom({
            socketId:
              socket.id,
          socket.data.roomId =
            room.id;

            nickname,
          socket.data.playerIndex =
            result.playerIndex;

            maxPlayers,
          socket.emit(
            "room:joined",
            {
              ok: true,

            turnTime,
              roomId:
                room.id,

            aiEnabled:
              !!data?.aiEnabled,
              playerIndex:
                result.playerIndex,

            aiLevel:
              Number(
                data?.aiLevel
              ) || 3
          });
              reconnect:
                !!result.reconnect,

        socket.join(room.id);
              state:
                getPublicRoomState(
                  room
                )
            }
          );

        socket.data.roomId =
          room.id;
          io.to(room.id).emit(
            "room:playerJoined",
            {
              ok: true,

        socket.data.playerId =
          socket.id;
              playerIndex:
                result.playerIndex,

        socket.emit(
          "room:created",
          {
            ok: true,
              state:
                getPublicRoomState(
                  room
                )
            }
          );

            roomId:
              room.id,
          tryStartRoom(room);

            state:
              getPublicState(room)
          }
        );
          broadcastRoomState(room);

        /*
         * AI 방
         */
        if (
          room.aiEnabled &&
          room.players.length < room.maxPlayers
        ) {
          addPlayer(
            room,
            null,
            `AI Lv.${room.aiLevel}`,
            true
          console.log(
            `[ROOM JOIN] ${room.id} / ${socket.id} / player ${result.playerIndex}`
          );
        } catch (error) {
          console.error(
            "room:join 오류:",
            error
);

          broadcastState(room);
          socket.emit(
            "room:error",
            {
              ok: false,

          startNewGame(room);
              reason:
                "방에 입장하지 못했습니다."
            }
          );
}

      } catch (error) {
        console.error(error);

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
    );

  /* =======================================================
     방 입장
  ======================================================= */
    /* =====================================================
       상태 요청
    ===================================================== */

  socket.on(
    "room:join",
    data => {
      const roomId =
        String(
          data?.roomId || ""
        )
          .trim()
          .toUpperCase();
    socket.on(
      "room:state",
      () => {
        const room =
          findRoomBySocket(
            socket.id
          );

      const nickname =
        normalizeWord(
          data?.nickname
        ) || "플레이어";
        if (!room) {
          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "현재 참여 중인 방이 없습니다."
            }
          );

      const room =
        ROOMS.get(roomId);
          return;
        }

      if (!room) {
socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "방을 찾을 수 없습니다."
          }
          "game:state",
          getPublicRoomState(room)
);

        return;
}
    );

      if (
        room.players.length >=
        room.maxPlayers
      ) {
        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "방이 가득 찼습니다."
    /* =====================================================
       단어
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
        );

        return;
      }
          const player =
            room.players.find(
              p =>
                p.socketId ===
                socket.id
            );

      if (room.finished) {
        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "이미 종료된 게임입니다."
          if (!player) {
            socket.emit(
              "game:error",
              {
                ok: false,

                reason:
                  "플레이어를 찾을 수 없습니다."
              }
            );

            return;
}
        );

        return;
      }
          const word =
            data?.word ??
            data?.inputWord ??
            "";

      const player =
        addPlayer(
          room,
          socket.id,
          nickname,
          false
        );
          playWord(
            room,
            player,
            word
          );
        } catch (error) {
          console.error(
            "game:word 오류:",
            error
          );

      socket.join(room.id);
          socket.emit(
            "game:error",
            {
              ok: false,

      socket.data.roomId =
        room.id;
              reason:
                "단어 처리 중 오류가 발생했습니다."
            }
          );
        }
      }
    );

      socket.data.playerId =
        player.id;
    /* =====================================================
       game:submit
       이전 클라이언트 호환
    ===================================================== */

      socket.emit(
        "room:joined",
        {
          ok: true,
    socket.on(
      "game:submit",
      data => {
        const room =
          findRoomBySocket(
            socket.id
          );

          roomId:
            room.id,
        if (!room) {
          socket.emit(
            "game:error",
            {
              ok: false,

          playerId:
            player.id,
              reason:
                "게임 방에 참여하지 않았습니다."
            }
          );

          state:
            getPublicState(room)
          return;
}
      );

      io.to(room.id).emit(
        "room:ready",
        {
          ok: true,
        const player =
          room.players.find(
            p =>
              p.socketId ===
              socket.id
          );

          state:
            getPublicState(room)
        if (!player) {
          return;
}
      );

      /*
       * 인원이 2명 이상이면 자동 시작
       */
      if (
        !room.started &&
        room.players.length >= 2
      ) {
        startNewGame(room);
      } else {
        broadcastState(room);
      }
    }
  );

  /* =======================================================
     상태 요청
  ======================================================= */

  socket.on(
    "room:state",
    () => {
      const room =
        ROOMS.get(
          socket.data.roomId
        );

      if (!room) {
        socket.emit(
          "room:error",
          {
            ok: false,
            reason:
              "참여 중인 방이 없습니다."
          }
        playWord(
          room,
          player,
          data?.word ??
            data?.inputWord ??
            ""
);

        return;
}
    );

      socket.emit(
        "game:state",
        getPublicState(room)
      );
    }
  );

  /* =======================================================
     단어 제출
  ======================================================= */
    /* =====================================================
       새 게임
    ===================================================== */

  socket.on(
    "game:word",
    data => {
      const room =
        ROOMS.get(
          socket.data.roomId
        );
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
              "게임 방에 참여하지 않았습니다."
          }
        );
        if (!room) {
          socket.emit(
            "game:error",
            {
              ok: false,

        return;
      }
              reason:
                "방에 참여하지 않았습니다."
            }
          );

      const player =
        getPlayerBySocket(
          room,
          socket.id
        );
          return;
        }

      const word =
        data?.word ??
        data?.inputWord ??
        "";
        /*
         * 시작 글자를 새로 지정할 수 있음.
         */
        const requested =
          normalizeWord(
            data?.startChar
          ).at(0);

      const result =
        playWord(
          room,
          player,
          word
        );
        if (requested) {
          room.startChar =
            requested;
        }

      if (!result.ok) {
/*
         * 잘못된 단어도 실패로 간주하여
         * 하트 감소
         * 온라인 방은 최소 2명.
        */
if (
          player &&
          player.alive &&
          room.started &&
          getCurrentPlayer(room)?.id === player.id
          room.mode === "online" &&
          getAlivePlayers(room).length < 2
) {
          clearTurnTimer(room);

          damagePlayer(
            room,
            player,
            "invalid"
          socket.emit(
            "game:error",
            {
              ok: false,

              reason:
                "새 게임을 시작하려면 최소 2명이 필요합니다."
            }
);

          if (
            checkFinished(room)
          ) {
            broadcastState(room);
            return;
          }
          return;
        }

          moveToNextAlivePlayer(room);
        const result =
          startNewGame(room);

          broadcastState(room);
        if (!result.ok) {
          socket.emit(
            "game:error",
            result
          );

          startTurnTimer(room);
          return;
}

        socket.emit(
          "game:error",
          result
        console.log(
          `[GAME RESTART] ${room.id}`
);

        return;
}
    );

      broadcastState(room);
    }
  );
    /* =====================================================
       방 나가기
    ===================================================== */

  /* =======================================================
     새 게임
  ======================================================= */
    socket.on(
      "room:leave",
      () => {
        const room =
          findRoomBySocket(
            socket.id
          );

  socket.on(
    "game:restart",
    () => {
      const room =
        ROOMS.get(
          socket.data.roomId
        );
        if (!room) {
          socket.emit(
            "room:left",
            {
              ok: true
            }
          );

      if (!room) {
        socket.emit(
          "game:error",
          {
            ok: false,
            reason:
              "참여 중인 방이 없습니다."
          }
          return;
        }

        const player =
          removePlayer(
            room,
            socket.id,
            "leave"
          );

        socket.leave(
          room.id
);

        return;
      }
        socket.data.roomId =
          null;

        socket.data.playerIndex =
          null;

      if (
        socket.id !==
        room.hostSocketId
      ) {
socket.emit(
          "game:error",
          "room:left",
{
            ok: false,
            reason:
              "방장만 새 게임을 시작할 수 있습니다."
            ok: true
}
);

        return;
      }

      if (
        room.players.filter(
          player =>
            !player.isAI
        ).length < 1
      ) {
        return;
      }

      startNewGame(room);
    }
  );
        if (player) {
          io.to(room.id).emit(
            "room:playerLeft",
            {
              ok: true,

  /* =======================================================
     방 나가기
  ======================================================= */
              playerIndex:
                player.playerIndex,

  socket.on(
    "room:leave",
    () => {
      leaveRoom(socket);
    }
  );
              reason:
                "상대방이 방을 나갔습니다.",

  /* =======================================================
     연결 종료
  ======================================================= */
              state:
                getPublicRoomState(room)
            }
          );
        }

  socket.on(
    "disconnect",
    reason => {
      console.log(
        `[DISCONNECT] ${socket.id} / ${reason}`
      );
        broadcastRoomState(room);

      leaveRoom(socket, true);
    }
  );
});
        /*
         * 사람이 하나도 없으면 방 삭제.
         */
        const realPlayers =
          room.players.filter(
            p => !p.isBot
          );

/* =========================================================
   방 나가기
========================================================= */
        if (
          realPlayers.length === 0
        ) {
          stopTurnTimer(room);
          ROOMS.delete(room.id);
        }
      }
    );

function leaveRoom(
  socket,
  disconnected = false
) {
  const roomId =
    socket.data.roomId;
    /* =====================================================
       재접속
    ===================================================== */

  if (!roomId) {
    return;
  }
    socket.on(
      "room:reconnect",
      data => {
        const roomId =
          String(
            data?.roomId || ""
          )
            .trim()
            .toUpperCase();

  const room =
    ROOMS.get(roomId);
        const room =
          ROOMS.get(roomId);

  if (!room) {
    return;
  }
        if (!room) {
          socket.emit(
            "room:error",
            {
              ok: false,

  const player =
    getPlayerBySocket(
      room,
      socket.id
    );
              reason:
                "재접속할 방을 찾을 수 없습니다."
            }
          );

  if (!player) {
    return;
  }
          return;
        }

  const index =
    room.players.indexOf(player);
        const playerIndex =
          Number(
            data?.playerIndex
          );

  room.players.splice(
    index,
    1
  );
        const player =
          getPlayer(
            room,
            playerIndex
          );

  if (room.players.length === 0) {
    clearTurnTimer(room);
    ROOMS.delete(room.id);
    return;
  }
        if (
          !player ||
          player.isBot
        ) {
          socket.emit(
            "room:error",
            {
              ok: false,

              reason:
                "재접속할 플레이어를 찾을 수 없습니다."
            }
          );

  /*
   * 나간 사람이 현재 턴이면
   * 다음 사람으로 넘긴다.
   */
  if (
    index === room.turnIndex
  ) {
    room.turnIndex =
      Math.max(
        0,
        room.turnIndex - 1
      );
          return;
        }

    moveToNextAlivePlayer(room);
        player.socketId =
          socket.id;

    if (
      room.started &&
      !room.finished
    ) {
      startTurnTimer(room);
    }
  } else if (
    index < room.turnIndex
  ) {
    room.turnIndex--;
  }
        player.connected =
          true;

  /*
   * 방장이 나갔으면 남은 사람에게 이전
   */
  if (
    room.hostSocketId === socket.id
  ) {
    const next =
      room.players.find(
        p => !p.isAI
      );
        socket.join(
          room.id
        );

    room.hostSocketId =
      next?.socketId || null;
  }
        socket.data.roomId =
          room.id;

  /*
   * 살아있는 사람이 한 명뿐이면 종료
   */
  if (
    room.started &&
    checkFinished(room)
  ) {
    broadcastState(room);
    return;
  }
        socket.data.playerIndex =
          playerIndex;

  io.to(room.id).emit(
    "room:playerLeft",
    {
      ok: true,
        socket.emit(
          "room:reconnected",
          {
            ok: true,

      playerId:
        player.id,
            roomId:
              room.id,

      nickname:
        player.nickname,
            playerIndex,

      disconnected,
            state:
              getPublicRoomState(room)
          }
        );

      state:
        getPublicState(room)
    }
  );
        broadcastRoomState(room);

  broadcastState(room);
        /*
         * 턴이 끊겨 있었다면 타이머 재설정.
         */
        if (
          room.started &&
          !room.finished &&
          room.turnEndsAt
        ) {
          const remaining =
            room.turnEndsAt -
            Date.now();

          if (remaining <= 0) {
            handleTurnTimeout(room);
          } else {
            if (room.timer) {
              clearTimeout(room.timer);
            }

            room.timer =
              setTimeout(
                () => {
                  handleTurnTimeout(room);
                },
                remaining
              );
          }
        }
      }
    );

  socket.data.roomId = null;
  socket.data.playerId = null;
}
    /* =====================================================
       연결 종료
    ===================================================== */

/* =========================================================
   API
========================================================= */
    socket.on(
      "disconnect",
      reason => {
        const room =
          findRoomBySocket(
            socket.id
          );

app.get("/", (req, res) => {
  const indexCandidates = [
    path.join(CLIENT_DIR, "index.html"),
    path.join(PUBLIC_DIR, "index.html"),
    path.join(ROOT_DIR, "index.html")
  ];
        if (room) {
          const player =
            room.players.find(
              p =>
                p.socketId ===
                socket.id
            );

          if (player) {
            /*
             * 즉시 삭제하지 않고
             * disconnected 상태로 유지.
             *
             * 재접속 가능.
             */
            player.connected =
              false;

            player.socketId =
              socket.id;

            io.to(room.id).emit(
              "room:playerDisconnected",
              {
                ok: true,

                playerIndex:
                  player.playerIndex,

                reason:
                  "플레이어의 연결이 끊어졌습니다.",

                state:
                  getPublicRoomState(room)
              }
            );

            broadcastRoomState(room);
          }
        }

  for (const file of indexCandidates) {
    if (fs.existsSync(file)) {
      res.sendFile(file);
      return;
    }
        console.log(
          `[DISCONNECT] ${socket.id} / ${reason}`
        );
      }
    );
}
);

  res.status(404).send(
    "index.html을 찾을 수 없습니다."
  );
});
/* =========================================================
   HTTP API
========================================================= */

app.get(
"/api/health",
@@ -1858,11 +3004,93 @@ app.get(
).length,

rooms:
        ROOMS.size
        ROOMS.size,

      maxPlayers:
        MAX_PLAYERS,

      turnTime:
        TURN_TIME,

      maxHearts:
        MAX_HEARTS,

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
   루트
========================================================= */

/*
 * Cannot GET / 방지.
 *
 * index.html 위치를 여러 군데 확인.
 */
app.get(
  "/",
  (req, res) => {
    const candidates = [
      path.join(
        ROOT_DIR,
        "index.html"
      ),

      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    ];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        return res.sendFile(file);
      }
    }

    res.status(404).send(
      `
      <!doctype html>
      <html lang="ko">
      <head>
        <meta charset="utf-8">
        <title>끝말잇기 서버</title>
      </head>
      <body>
        <h1>끝말잇기 서버는 정상적으로 실행 중입니다.</h1>
        <p>index.html 파일을 찾을 수 없습니다.</p>
      </body>
      </html>
      `
    );
  }
);

/* =========================================================
  서버 시작
========================================================= */
@@ -1892,6 +3120,18 @@ server.listen(
     ).length.toLocaleString()}`
);

    console.log(
      `MAX PLAYERS: ${MAX_PLAYERS}`
    );

    console.log(
      `TURN TIME: ${TURN_TIME}s`
    );

    console.log(
      `HEARTS: ${MAX_HEARTS}`
    );

console.log(
"========================================"
);
@@ -1904,14 +3144,18 @@ server.listen(

function shutdown(signal) {
console.log(
    `${signal} 수신. 서버 종료`
    `${signal} 수신. 서버 종료 중...`
);

for (const room of ROOMS.values()) {
    clearTurnTimer(room);
    stopTurnTimer(room);
}

server.close(() => {
    console.log(
      "서버가 종료되었습니다."
    );

process.exit(0);
});
}
