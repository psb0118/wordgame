"use strict";

/* =========================================================
   client/script.js

   server/server.js와 이벤트 완전 대응

   CLIENT -> SERVER
   ---------------------------------------------------------
   room:create
   room:join
   room:state
   game:word
   game:submit
   game:restart
   room:leave

   SERVER -> CLIENT
   ---------------------------------------------------------
   server:ready
   room:created
   room:joined
   room:ready
   room:error
   game:state
   game:word
   game:error
   game:finished
   game:started
   room:playerLeft
   game:submit:redirect
========================================================= */


/* =========================================================
   Socket.IO
========================================================= */

const socket = io();


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
   기본 상태
========================================================= */

let socketConnected = false;

let roomId = null;
let playerIndex = null;

let gameState = null;

let myNickname = "플레이어";

let localHistory = [];
let localUsedWords = new Set();

let isSubmitting = false;

let isAutoStarting = false;

let wordListCache = null;


/* =========================================================
   DOM
========================================================= */

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}


/* =========================================================
   문자열 정규화
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
   두음법칙
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
   * 직접 매핑
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
   * 역방향 매핑
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
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
    return false;
  }

  const last = previousWord.at(-1);
  const first = nextWord.at(0);

  return allowedFirstChars(last).includes(first);
}


/* =========================================================
   플레이어
========================================================= */

function getMyPlayer() {
  if (!gameState || playerIndex === null) {
    return null;
  }

  return (
    gameState.players?.find(
      player =>
        player.playerIndex === playerIndex
    ) || null
  );
}

function getOpponentPlayer() {
  if (!gameState || playerIndex === null) {
    return null;
  }

  return (
    gameState.players?.find(
      player =>
        player.playerIndex !== playerIndex
    ) || null
  );
}


/* =========================================================
   내 턴
========================================================= */

function isMyTurn() {
  if (!gameState) {
    return false;
  }

  return (
    gameState.turnPlayer === playerIndex &&
    gameState.playerCount >= 2 &&
    !gameState.finished
  );
}


/* =========================================================
   UI
========================================================= */

function setText(selectors, value) {
  for (const selector of selectors) {
    const element = $(selector);

    if (!element) {
      continue;
    }

    element.textContent = value;
  }
}

function setDisabled(selectors, disabled) {
  for (const selector of selectors) {
    const element = $(selector);

    if (!element) {
      continue;
    }

    element.disabled = disabled;
  }
}


/* =========================================================
   메시지
========================================================= */

function showMessage(message, type = "info") {
  const text = String(message ?? "");

  const selectors = [
    "#message",
    "#status",
    "#gameMessage",
    ".message",
    ".status"
  ];

  for (const selector of selectors) {
    const element = $(selector);

    if (!element) {
      continue;
    }

    element.textContent = text;
    element.dataset.type = type;

    return;
  }

  console.log(`[${type}] ${text}`);
}


/* =========================================================
   방 코드
========================================================= */

function renderRoomId() {
  setText(
    [
      "#roomId",
      "#roomCode",
      "[data-room-id]"
    ],
    roomId || "-"
  );
}


/* =========================================================
   플레이어 표시
========================================================= */

function renderPlayers() {
  if (!gameState) {
    return;
  }

  const players =
    Array.isArray(gameState.players)
      ? gameState.players
      : [];

  const me =
    players.find(
      player =>
        player.playerIndex === playerIndex
    );

  const opponent =
    players.find(
      player =>
        player.playerIndex !== playerIndex
    );

  setText(
    [
      "#myNickname",
      "#playerName",
      "[data-player-name]"
    ],
    me?.nickname || myNickname
  );

  setText(
    [
      "#opponentNickname",
      "#enemyName",
      "[data-opponent-name]"
    ],
    opponent?.nickname || "상대방 대기 중"
  );

  setText(
    [
      "#playerCount",
      "[data-player-count]"
    ],
    `${players.length}/2`
  );
}


/* =========================================================
   현재 단어
========================================================= */

function renderCurrentWord() {
  const word =
    gameState?.currentWord || "";

  setText(
    [
      "#currentWord",
      "#lastWord",
      "#wordDisplay",
      "[data-current-word]"
    ],
    word || "-"
  );
}


/* =========================================================
   턴
========================================================= */

function renderTurn() {
  if (!gameState) {
    return;
  }

  if (gameState.finished) {
    if (
      gameState.winner !== null &&
      gameState.winner === playerIndex
    ) {
      showMessage(
        "게임에서 승리했습니다.",
        "win"
      );
    } else {
      showMessage(
        "게임에서 패배했습니다.",
        "lose"
      );
    }

    return;
  }

  if (gameState.playerCount < 2) {
    showMessage(
      "상대방을 기다리는 중입니다.",
      "waiting"
    );

    return;
  }

  if (isMyTurn()) {
    showMessage(
      "당신의 차례입니다.",
      "my-turn"
    );
  } else {
    const opponent =
      getOpponentPlayer();

    showMessage(
      `${opponent?.nickname || "상대방"}의 차례입니다.`,
      "opponent-turn"
    );
  }
}


/* =========================================================
   입력창
========================================================= */

function getWordInput() {
  const selectors = [
    "#wordInput",
    "#inputWord",
    "#word",
    "input[name='word']"
  ];

  for (const selector of selectors) {
    const input = $(selector);

    if (input) {
      return input;
    }
  }

  return null;
}

function clearWordInput() {
  const input =
    getWordInput();

  if (!input) {
    return;
  }

  input.value = "";
  input.focus();
}


/* =========================================================
   입력 상태
========================================================= */

function updateInputState() {
  const input =
    getWordInput();

  const disabled =
    !socketConnected ||
    !roomId ||
    !gameState ||
    gameState.playerCount < 2 ||
    gameState.finished ||
    !isMyTurn() ||
    isSubmitting ||
    isAutoStarting;

  if (input) {
    input.disabled = disabled;
  }

  setDisabled(
    [
      "#submitWord",
      "#submitButton",
      "#wordSubmit",
      "#sendWord",
      "#submit"
    ],
    disabled
  );
}


/* =========================================================
   기록
========================================================= */

function renderHistory() {
  const history =
    Array.isArray(gameState?.history)
      ? gameState.history
      : [];

  localHistory =
    history.slice();

  localUsedWords =
    new Set(
      history
        .map(item =>
          normalizeWord(item.word)
        )
        .filter(Boolean)
    );

  const selectors = [
    "#history",
    "#wordHistory",
    "#gameHistory",
    "[data-history]"
  ];

  let container = null;

  for (const selector of selectors) {
    const element = $(selector);

    if (element) {
      container = element;
      break;
    }
  }

  if (!container) {
    return;
  }

  container.innerHTML = "";

  for (const item of history) {
    const row =
      document.createElement("div");

    row.className =
      "history-item";

    const playerName =
      gameState.players?.find(
        player =>
          player.playerIndex ===
          item.player
      )?.nickname ||
      `플레이어 ${Number(item.player) + 1}`;

    const depth =
      item.depth !== null &&
      item.depth !== undefined
        ? ` (깊이 ${item.depth})`
        : "";

    row.textContent =
      `${item.turn}. ${playerName}: ${item.word}${depth}`;

    container.appendChild(row);
  }

  container.scrollTop =
    container.scrollHeight;
}


/* =========================================================
   두음 정보
========================================================= */

function renderDueumInfo() {
  if (!gameState) {
    return;
  }

  if (!gameState.currentWord) {
    setText(
      [
        "#allowedChars",
        "#nextChars",
        "[data-allowed-chars]"
      ],
      "-"
    );

    return;
  }

  const last =
    gameState.currentWord.at(-1);

  const allowed =
    allowedFirstChars(last);

  setText(
    [
      "#allowedChars",
      "#nextChars",
      "[data-allowed-chars]"
    ],
    allowed.join(", ")
  );
}


/* =========================================================
   전체 상태
========================================================= */

function renderGameState(state) {
  if (!state) {
    return;
  }

  gameState = state;

  if (state.roomId) {
    roomId =
      state.roomId;
  }

  renderRoomId();
  renderPlayers();
  renderCurrentWord();
  renderTurn();
  renderHistory();
  renderDueumInfo();
  updateInputState();
}


/* =========================================================
   닉네임
========================================================= */

function getNickname() {
  const selectors = [
    "#nickname",
    "#nicknameInput",
    "input[name='nickname']"
  ];

  for (const selector of selectors) {
    const element = $(selector);

    if (!element) {
      continue;
    }

    return (
      normalizeWord(
        element.value
      ) || "플레이어"
    );
  }

  return "플레이어";
}


/* =========================================================
   시작 글자
========================================================= */

function getStartChar() {
  const selectors = [
    "#startChar",
    "#startCharInput",
    "input[name='startChar']"
  ];

  for (const selector of selectors) {
    const element = $(selector);

    if (!element) {
      continue;
    }

    return (
      normalizeWord(
        element.value
      ).at(0) || ""
    );
  }

  return "";
}


/* =========================================================
   방 코드
========================================================= */

function getRoomCode() {
  const selectors = [
    "#roomIdInput",
    "#roomCodeInput",
    "#roomInput",
    "input[name='roomId']",
    "input[name='roomCode']"
  ];

  for (const selector of selectors) {
    const element = $(selector);

    if (!element) {
      continue;
    }

    return String(
      element.value || ""
    )
      .trim()
      .toUpperCase();
  }

  return "";
}


/* =========================================================
   방 생성
========================================================= */

function createRoom() {
  if (!socketConnected) {
    showMessage(
      "서버에 연결되어 있지 않습니다.",
      "error"
    );

    return;
  }

  const nickname =
    getNickname();

  const startChar =
    getStartChar();

  myNickname =
    nickname;

  socket.emit(
    "room:create",
    {
      nickname,
      startChar
    }
  );
}


/* =========================================================
   방 입장
========================================================= */

function joinRoom() {
  if (!socketConnected) {
    showMessage(
      "서버에 연결되어 있지 않습니다.",
      "error"
    );

    return;
  }

  const roomCode =
    getRoomCode();

  if (!roomCode) {
    showMessage(
      "방 코드를 입력해주세요.",
      "error"
    );

    return;
  }

  const nickname =
    getNickname();

  myNickname =
    nickname;

  socket.emit(
    "room:join",
    {
      roomId: roomCode,
      nickname
    }
  );
}


/* =========================================================
   단어 제출
========================================================= */

function submitWord() {
  if (isSubmitting) {
    return;
  }

  if (isAutoStarting) {
    return;
  }

  if (!socketConnected) {
    showMessage(
      "서버에 연결되어 있지 않습니다.",
      "error"
    );

    return;
  }

  if (!roomId) {
    showMessage(
      "먼저 방에 들어가주세요.",
      "error"
    );

    return;
  }

  if (!gameState) {
    showMessage(
      "게임 상태를 불러오는 중입니다.",
      "error"
    );

    return;
  }

  if (gameState.playerCount < 2) {
    showMessage(
      "상대방을 기다리는 중입니다.",
      "waiting"
    );

    return;
  }

  if (gameState.finished) {
    return;
  }

  if (!isMyTurn()) {
    showMessage(
      "지금은 당신의 차례가 아닙니다.",
      "error"
    );

    return;
  }

  const input =
    getWordInput();

  if (!input) {
    showMessage(
      "단어 입력창을 찾을 수 없습니다.",
      "error"
    );

    return;
  }

  const word =
    normalizeWord(
      input.value
    );

  if (!word) {
    showMessage(
      "단어를 입력해주세요.",
      "error"
    );

    return;
  }

  /*
   * 클라이언트 빠른 중복 검사
   */
  if (localUsedWords.has(word)) {
    showMessage(
      "이미 사용한 단어입니다.",
      "error"
    );

    return;
  }

  /*
   * 연결 검사
   */
  if (gameState.currentWord) {
    if (
      !canConnect(
        gameState.currentWord,
        word
      )
    ) {
      const last =
        gameState.currentWord.at(-1);

      showMessage(
        `"${last}" 다음에 연결할 수 없는 단어입니다.`,
        "error"
      );

      return;
    }
  }

  /*
   * 첫 단어 시작 글자 검사
   */
  else if (gameState.startChar) {
    const allowed =
      allowedFirstChars(
        gameState.startChar
      );

    if (
      !allowed.includes(
        word.at(0)
      )
    ) {
      showMessage(
        `"${gameState.startChar}"으로 시작할 수 없는 단어입니다.`,
        "error"
      );

      return;
    }
  }

  /*
   * 서버가 최종 판정
   */
  isSubmitting = true;

  updateInputState();

  socket.emit(
    "game:word",
    {
      word
    }
  );
}


/* =========================================================
   game:submit 호환
========================================================= */

function submitWordLegacy() {
  if (isSubmitting) {
    return;
  }

  const input =
    getWordInput();

  if (!input) {
    return;
  }

  const word =
    normalizeWord(
      input.value
    );

  if (!word) {
    return;
  }

  isSubmitting = true;

  updateInputState();

  socket.emit(
    "game:submit",
    {
      word
    }
  );
}


/* =========================================================
   재시작
========================================================= */

function restartGame() {
  if (!socketConnected) {
    showMessage(
      "서버에 연결되어 있지 않습니다.",
      "error"
    );

    return;
  }

  if (!roomId) {
    showMessage(
      "먼저 방에 들어가주세요.",
      "error"
    );

    return;
  }

  if (
    !gameState ||
    gameState.playerCount < 2
  ) {
    showMessage(
      "상대방이 있어야 새 게임을 시작할 수 있습니다.",
      "error"
    );

    return;
  }

  isSubmitting = false;
  isAutoStarting = false;

  socket.emit(
    "game:restart",
    {
      startChar:
        getStartChar()
    }
  );
}


/* =========================================================
   방 나가기
========================================================= */

function leaveRoom() {
  if (!roomId) {
    return;
  }

  socket.emit(
    "room:leave"
  );

  roomId = null;
  playerIndex = null;
  gameState = null;

  localHistory = [];
  localUsedWords =
    new Set();

  isSubmitting = false;
  isAutoStarting = false;

  renderRoomId();

  renderCurrentWord();

  updateInputState();

  showMessage(
    "방에서 나왔습니다.",
    "info"
  );
}


/* =========================================================
   방 상태 요청
========================================================= */

function requestRoomState() {
  if (!roomId) {
    return;
  }

  socket.emit(
    "room:state"
  );
}


/* =========================================================
   단어 목록 가져오기
========================================================= */

async function loadWordList() {
  if (Array.isArray(wordListCache)) {
    return wordListCache;
  }

  const candidates = [
    "/word.txt",
    "/data/word.txt",
    "/public/word.txt"
  ];

  for (const url of candidates) {
    try {
      const response =
        await fetch(
          `${url}?v=${Date.now()}`
        );

      if (!response.ok) {
        continue;
      }

      const text =
        await response.text();

      const words = [];

      for (
        const line of
        text.split(/\r?\n/)
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
          words.push(word);
        }
      }

      if (words.length > 0) {
        wordListCache =
          words;

        console.log(
          `[WORD LIST] ${words.length.toLocaleString()}개 로드`
        );

        return words;
      }
    } catch (error) {
      console.warn(
        `[WORD LIST] ${url} 로드 실패`,
        error
      );
    }
  }

  console.warn(
    "[WORD LIST] 클라이언트에서 단어 목록을 불러오지 못했습니다."
  );

  return [];
}


/* =========================================================
   첫 단어 후보
========================================================= */

function getStartCandidates(words) {
  if (!Array.isArray(words)) {
    return [];
  }

  const startChar =
    gameState?.startChar || "";

  const used =
    localUsedWords;

  const candidates = [];

  for (const word of words) {
    if (!word) {
      continue;
    }

    if (used.has(word)) {
      continue;
    }

    /*
     * 시작 글자가 지정되어 있으면
     * 두음법칙까지 적용
     */
    if (startChar) {
      const allowed =
        allowedFirstChars(
          startChar
        );

      if (
        !allowed.includes(
          word.at(0)
        )
      ) {
        continue;
      }
    }

    candidates.push(word);
  }

  return candidates;
}


/* =========================================================
   첫 단어 선택
========================================================= */

function chooseAutomaticStartWord(words) {
  const candidates =
    getStartCandidates(words);

  if (candidates.length === 0) {
    return null;
  }

  /*
   * 가능한 한 너무 짧은/이상한 시작어를 피하고
   * 일반적인 단어를 우선한다.
   *
   * 최종 유효성은 서버가 검사한다.
   */
  const filtered =
    candidates.filter(
      word =>
        word.length >= 2
    );

  const pool =
    filtered.length > 0
      ? filtered
      : candidates;

  const index =
    Math.floor(
      Math.random() *
      pool.length
    );

  return pool[index] || null;
}


/* =========================================================
   자동 첫 단어 시작
========================================================= */

async function startAutomaticFirstWord() {
  if (isAutoStarting) {
    return;
  }

  if (!gameState) {
    return;
  }

  /*
   * 첫 번째 플레이어만 시작
   */
  if (playerIndex !== 0) {
    return;
  }

  /*
   * 이미 단어가 있으면 하지 않음
   */
  if (gameState.currentWord) {
    return;
  }

  /*
   * 게임이 끝났으면 하지 않음
   */
  if (gameState.finished) {
    return;
  }

  /*
   * 상대방이 없으면 하지 않음
   */
  if (gameState.playerCount < 2) {
    return;
  }

  /*
   * 반드시 내 턴이어야 함
   */
  if (!isMyTurn()) {
    return;
  }

  isAutoStarting = true;
  isSubmitting = true;

  updateInputState();

  try {
    const words =
      await loadWordList();

    if (!words.length) {
      throw new Error(
        "단어 목록을 불러오지 못했습니다."
      );
    }

    /*
     * 상태가 바뀌었으면 중단
     */
    if (
      !gameState ||
      gameState.currentWord ||
      gameState.finished ||
      gameState.playerCount < 2 ||
      gameState.turnPlayer !== 0
    ) {
      return;
    }

    const word =
      chooseAutomaticStartWord(
        words
      );

    if (!word) {
      throw new Error(
        "사용할 수 있는 시작 단어가 없습니다."
      );
    }

    console.log(
      "[AUTO START WORD]",
      word
    );

    socket.emit(
      "game:word",
      {
        word
      }
    );

  } catch (error) {
    console.error(
      "[AUTO START ERROR]",
      error
    );

    isSubmitting = false;

    showMessage(
      "새 게임의 시작 단어를 만들지 못했습니다. word.txt 위치를 확인해주세요.",
      "error"
    );

  } finally {
    isAutoStarting = false;

    /*
     * 서버 응답이 오기 전에는
     * isSubmitting을 바로 풀지 않는다.
     *
     * game:word / game:error / game:state에서
     * 다시 상태를 정리한다.
     */
    updateInputState();
  }
}


/* =========================================================
   자동 시작 검사
========================================================= */

function checkAutomaticStart() {
  if (!gameState) {
    return;
  }

  if (
    gameState.playerCount < 2
  ) {
    return;
  }

  if (
    gameState.finished
  ) {
    return;
  }

  if (
    gameState.currentWord
  ) {
    return;
  }

  if (
    gameState.turnPlayer !== 0
  ) {
    return;
  }

  if (
    playerIndex !== 0
  ) {
    return;
  }

  startAutomaticFirstWord();
}


/* =========================================================
   Socket.IO CONNECT
========================================================= */

socket.on(
  "connect",
  () => {
    socketConnected = true;

    console.log(
      "[Socket.IO] 연결됨:",
      socket.id
    );

    showMessage(
      "서버에 연결되었습니다.",
      "success"
    );

    updateInputState();

    /*
     * 기존 방 정보가 있었다면
     * 서버 상태 재요청
     */
    if (roomId) {
      socket.emit(
        "room:state"
      );
    }
  }
);


/* =========================================================
   DISCONNECT
========================================================= */

socket.on(
  "disconnect",
  reason => {
    socketConnected = false;

    isSubmitting = false;
    isAutoStarting = false;

    console.warn(
      "[Socket.IO] 연결 종료:",
      reason
    );

    showMessage(
      "서버와 연결이 끊어졌습니다.",
      "error"
    );

    updateInputState();
  }
);


/* =========================================================
   server:ready
========================================================= */

socket.on(
  "server:ready",
  data => {
    console.log(
      "[server:ready]",
      data
    );
  }
);


/* =========================================================
   room:created
========================================================= */

socket.on(
  "room:created",
  data => {
    if (!data?.ok) {
      return;
    }

    roomId =
      data.roomId;

    playerIndex =
      data.playerIndex;

    gameState =
      data.state;

    localHistory =
      gameState?.history?.slice() || [];

    localUsedWords =
      new Set(
        localHistory.map(
          item =>
            normalizeWord(
              item.word
            )
        )
      );

    isSubmitting = false;
    isAutoStarting = false;

    renderGameState(
      gameState
    );

    showMessage(
      `방이 생성되었습니다. 방 코드: ${roomId}`,
      "success"
    );

    console.log(
      "[room:created]",
      data
    );
  }
);


/* =========================================================
   room:joined
========================================================= */

socket.on(
  "room:joined",
  data => {
    if (!data?.ok) {
      return;
    }

    roomId =
      data.roomId;

    playerIndex =
      data.playerIndex;

    gameState =
      data.state;

    localHistory =
      gameState?.history?.slice() || [];

    localUsedWords =
      new Set(
        localHistory.map(
          item =>
            normalizeWord(
              item.word
            )
        )
      );

    isSubmitting = false;
    isAutoStarting = false;

    renderGameState(
      gameState
    );

    showMessage(
      "방에 입장했습니다.",
      "success"
    );

    console.log(
      "[room:joined]",
      data
    );
  }
);


/* =========================================================
   room:ready
========================================================= */

socket.on(
  "room:ready",
  data => {
    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    isSubmitting = false;
    isAutoStarting = false;

    showMessage(
      "상대방이 입장했습니다.",
      "success"
    );

    updateInputState();

    console.log(
      "[room:ready]",
      data
    );

    /*
     * 상대가 들어오면
     * 첫 번째 플레이어가 자동으로 시작
     */
    setTimeout(
      checkAutomaticStart,
      50
    );
  }
);


/* =========================================================
   room:error
========================================================= */

socket.on(
  "room:error",
  data => {
    isSubmitting = false;
    isAutoStarting = false;

    updateInputState();

    showMessage(
      data?.reason ||
        "방 처리 중 오류가 발생했습니다.",
      "error"
    );

    console.error(
      "[room:error]",
      data
    );
  }
);


/* =========================================================
   game:state
========================================================= */

socket.on(
  "game:state",
  state => {
    isSubmitting = false;

    renderGameState(
      state
    );

    console.log(
      "[game:state]",
      state
    );

    /*
     * 새 게임에서 currentWord가 비어 있으면
     * 첫 플레이어가 자동 시작
     */
    setTimeout(
      checkAutomaticStart,
      50
    );
  }
);


/* =========================================================
   game:word
========================================================= */

socket.on(
  "game:word",
  data => {
    isSubmitting = false;

    if (!data?.ok) {
      updateInputState();
      return;
    }

    const word =
      normalizeWord(
        data.word
      );

    /*
     * 서버가 승인한 단어만 기록
     */
    if (word) {
      localUsedWords.add(
        word
      );
    }

    /*
     * 내가 입력한 단어라면 입력창 비우기
     */
    if (
      data.player ===
      playerIndex
    ) {
      clearWordInput();
    }

    console.log(
      "[game:word]",
      data
    );

    updateInputState();
  }
);


/* =========================================================
   game:error
========================================================= */

socket.on(
  "game:error",
  data => {
    isSubmitting = false;
    isAutoStarting = false;

    showMessage(
      data?.reason ||
        "단어 처리 중 오류가 발생했습니다.",
      "error"
    );

    if (
      Array.isArray(
        data?.allowed
      )
    ) {
      setText(
        [
          "#allowedChars",
          "#nextChars",
          "[data-allowed-chars]"
        ],
        data.allowed.join(", ")
      );
    }

    updateInputState();

    console.warn(
      "[game:error]",
      data
    );
  }
);


/* =========================================================
   game:finished
========================================================= */

socket.on(
  "game:finished",
  data => {
    isSubmitting = false;
    isAutoStarting = false;

    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    if (
      data?.winner ===
      playerIndex
    ) {
      showMessage(
        "게임 종료 — 승리했습니다.",
        "win"
      );
    } else {
      showMessage(
        "게임 종료 — 패배했습니다.",
        "lose"
      );
    }

    updateInputState();

    console.log(
      "[game:finished]",
      data
    );
  }
);


/* =========================================================
   game:started
========================================================= */

socket.on(
  "game:started",
  data => {
    isSubmitting = false;
    isAutoStarting = false;

    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    /*
     * game:restart 직후 서버는
     * currentWord를 null로 보낸다.
     *
     * 따라서 여기서 첫 번째 플레이어가
     * 실제 word.txt 단어를 하나 골라 제출한다.
     */
    showMessage(
      "새 게임이 시작되었습니다.",
      "success"
    );

    updateInputState();

    console.log(
      "[game:started]",
      data
    );

    setTimeout(
      checkAutomaticStart,
      50
    );
  }
);


/* =========================================================
   room:playerLeft
========================================================= */

socket.on(
  "room:playerLeft",
  data => {
    isSubmitting = false;
    isAutoStarting = false;

    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    showMessage(
      data?.reason ||
        "상대방이 방을 나갔습니다.",
      "error"
    );

    updateInputState();

    console.log(
      "[room:playerLeft]",
      data
    );
  }
);


/* =========================================================
   game:submit:redirect
========================================================= */

socket.on(
  "game:submit:redirect",
  () => {
    /*
     * 서버 호환 이벤트.
     *
     * 실제 결과:
     * game:word
     * game:error
     *
     * 에서 처리한다.
     */
  }
);


/* =========================================================
   클릭 이벤트
========================================================= */

function bindClick(
  selectors,
  handler
) {
  for (const selector of selectors) {
    const elements =
      $all(selector);

    for (const element of elements) {
      element.addEventListener(
        "click",
        event => {
          event.preventDefault();
          handler();
        }
      );
    }
  }
}


/* =========================================================
   방 생성
========================================================= */

bindClick(
  [
    "#createRoom",
    "#createRoomButton",
    "#roomCreate",
    "[data-action='create-room']"
  ],
  createRoom
);


/* =========================================================
   방 입장
========================================================= */

bindClick(
  [
    "#joinRoom",
    "#joinRoomButton",
    "#roomJoin",
    "[data-action='join-room']"
  ],
  joinRoom
);


/* =========================================================
   단어 제출
========================================================= */

bindClick(
  [
    "#submitWord",
    "#submitButton",
    "#wordSubmit",
    "#sendWord",
    "#submit",
    "[data-action='submit-word']"
  ],
  submitWord
);


/* =========================================================
   재시작
========================================================= */

bindClick(
  [
    "#restartGame",
    "#restartButton",
    "#gameRestart",
    "[data-action='restart-game']"
  ],
  restartGame
);


/* =========================================================
   나가기
========================================================= */

bindClick(
  [
    "#leaveRoom",
    "#leaveButton",
    "#roomLeave",
    "[data-action='leave-room']"
  ],
  leaveRoom
);


/* =========================================================
   상태 새로고침
========================================================= */

bindClick(
  [
    "#refreshRoom",
    "#refreshState",
    "[data-action='refresh-room']"
  ],
  requestRoomState
);


/* =========================================================
   Enter = 단어 제출
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    const input =
      getWordInput();

    if (!input) {
      return;
    }

    if (
      event.target !== input
    ) {
      return;
    }

    if (
      event.key === "Enter"
    ) {
      event.preventDefault();

      submitWord();
    }
  }
);


/* =========================================================
   페이지 종료
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {
    /*
     * disconnect는 Socket.IO가 자동 처리한다.
     *
     * 여기서 room:leave를 강제로 보내면
     * 페이지 이동 중 이벤트가 꼬일 수 있으므로
     * 보내지 않는다.
     */
  }
);


/* =========================================================
   전역 함수
========================================================= */

window.createRoom =
  createRoom;

window.joinRoom =
  joinRoom;

window.submitWord =
  submitWord;

window.submitWordLegacy =
  submitWordLegacy;

window.restartGame =
  restartGame;

window.leaveRoom =
  leaveRoom;

window.requestRoomState =
  requestRoomState;

window.canConnect =
  canConnect;

window.allowedFirstChars =
  allowedFirstChars;

window.normalizeWord =
  normalizeWord;


/* =========================================================
   초기화
========================================================= */

updateInputState();

console.log(
  "========================================"
);

console.log(
  "client/script.js 로드 완료"
);

console.log(
  "Socket.IO 서버 이벤트 연결 완료"
);

console.log(
  "현재 서버 모드: 2인 온라인"
);

console.log(
  "새 게임 자동 시작 단어 기능: ON"
);

console.log(
  "========================================"
);
