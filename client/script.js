"use strict";

/* =========================================================
   끝말잇기 client/script.js
   server/server.js Socket.IO 이벤트와 1:1 대응
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
   상태
========================================================= */

let socketConnected = false;

let roomId = null;
let playerIndex = null;

let gameState = null;

let myNickname = "플레이어";

let localHistory = [];
let localUsedWords = new Set();

let isSubmitting = false;

/* =========================================================
   DOM 헬퍼
========================================================= */

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}

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
   두음법칙
========================================================= */

function allowedFirstChars(lastChar) {
  lastChar = normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result = new Set();

  result.add(lastChar);

  const direct = DUEUM[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      if (char) {
        result.add(char);
      }
    }
  }

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
   현재 플레이어 정보
========================================================= */

function getMyPlayer() {
  if (!gameState || playerIndex === null) {
    return null;
  }

  return gameState.players?.find(
    player => player.playerIndex === playerIndex
  ) || null;
}

function getOpponentPlayer() {
  if (!gameState || playerIndex === null) {
    return null;
  }

  return gameState.players?.find(
    player => player.playerIndex !== playerIndex
  ) || null;
}

/* =========================================================
   내가 현재 턴인지
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
   UI 헬퍼
========================================================= */

function setText(selectors, value) {
  for (const selector of selectors) {
    const element = $(selector);

    if (element) {
      element.textContent = value;
    }
  }
}

function setDisabled(selectors, disabled) {
  for (const selector of selectors) {
    const element = $(selector);

    if (element) {
      element.disabled = disabled;
    }
  }
}

/* =========================================================
   메시지 출력
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

  let displayed = false;

  for (const selector of selectors) {
    const element = $(selector);

    if (!element) {
      continue;
    }

    element.textContent = text;
    element.dataset.type = type;

    displayed = true;
    break;
  }

  if (!displayed) {
    console.log(`[${type}] ${text}`);
  }
}

/* =========================================================
   방 코드 표시
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
    gameState.players || [];

  const me =
    players.find(
      p => p.playerIndex === playerIndex
    );

  const opponent =
    players.find(
      p => p.playerIndex !== playerIndex
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
   현재 단어 표시
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
   턴 표시
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
      showMessage("게임에서 승리했습니다.", "win");
    } else {
      showMessage("게임에서 패배했습니다.", "lose");
    }

    return;
  }

  if (gameState.playerCount < 2) {
    showMessage("상대방을 기다리는 중입니다.", "waiting");
    return;
  }

  if (isMyTurn()) {
    showMessage("당신의 차례입니다.", "my-turn");
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

  if (input) {
    input.value = "";
    input.focus();
  }
}

/* =========================================================
   입력 가능 여부
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
    isSubmitting;

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
   기록 렌더링
========================================================= */

function renderHistory() {
  const history =
    gameState?.history || [];

  localHistory =
    history.slice();

  localUsedWords =
    new Set(
      history.map(
        item => item.word
      )
    );

  const containers = [
    "#history",
    "#wordHistory",
    "#gameHistory",
    "[data-history]"
  ];

  let container = null;

  for (const selector of containers) {
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
        p =>
          p.playerIndex ===
          item.player
      )?.nickname ||
      `플레이어 ${item.player + 1}`;

    const depth =
      item.depth !== null &&
      item.depth !== undefined
        ? `깊이 ${item.depth}`
        : "";

    row.textContent =
      `${item.turn}. ${playerName}: ${item.word}${depth ? ` (${depth})` : ""}`;

    container.appendChild(row);
  }

  container.scrollTop =
    container.scrollHeight;
}

/* =========================================================
   두음 정보 표시
========================================================= */

function renderDueumInfo() {
  if (!gameState?.currentWord) {
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
   전체 상태 렌더링
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
   방 생성
========================================================= */

function createRoom() {
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
  const roomCode =
    getRoomCode();

  const nickname =
    getNickname();

  if (!roomCode) {
    showMessage(
      "방 코드를 입력해주세요.",
      "error"
    );

    return;
  }

  myNickname =
    nickname;

  socket.emit(
    "room:join",
    {
      roomId:
        roomCode,

      nickname
    }
  );
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

    if (element) {
      return (
        normalizeWord(
          element.value
        ) ||
        "플레이어"
      );
    }
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

    if (element) {
      return normalizeWord(
        element.value
      ).at(0) || "";
    }
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

    if (element) {
      return String(
        element.value || ""
      )
        .trim()
        .toUpperCase();
    }
  }

  return "";
}

/* =========================================================
   단어 제출
========================================================= */

function submitWord() {
  if (isSubmitting) {
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
   * 클라이언트에서도 먼저 빠르게 검사.
   * 최종 판정은 반드시 서버가 담당한다.
   */

  if (localUsedWords.has(word)) {
    showMessage(
      "이미 사용한 단어입니다.",
      "error"
    );

    return;
  }

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
  } else if (gameState.startChar) {
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

  isSubmitting = true;
  updateInputState();

  /*
   * 서버 server.js:
   *
   * socket.on("game:word", ...)
   *
   * 정확히 이 이벤트로 전송
   */
  socket.emit(
    "game:word",
    {
      word
    }
  );
}

/* =========================================================
   game:submit 호환용
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

  /*
   * 서버에도 game:submit이 구현되어 있으므로
   * 필요한 경우 이 이벤트를 사용할 수 있다.
   */
  socket.emit(
    "game:submit",
    {
      word
    }
  );
}

/* =========================================================
   게임 재시작
========================================================= */

function restartGame() {
  if (!roomId) {
    showMessage(
      "먼저 방에 들어가주세요.",
      "error"
    );

    return;
  }

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

  renderRoomId();
  updateInputState();

  showMessage(
    "방에서 나왔습니다.",
    "info"
  );
}

/* =========================================================
   서버 상태 요청
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
   Socket.IO 연결
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
  }
);

/* =========================================================
   연결 종료
========================================================= */

socket.on(
  "disconnect",
  reason => {
    socketConnected = false;
    isSubmitting = false;

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
   서버 준비
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
   방 생성 성공
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

    localHistory = [];
    localUsedWords =
      new Set();

    isSubmitting = false;

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
   방 입장 성공
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
          item => item.word
        )
      );

    isSubmitting = false;

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
   방 준비 완료
========================================================= */

socket.on(
  "room:ready",
  data => {
    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    showMessage(
      "상대방이 입장했습니다.",
      "success"
    );

    isSubmitting = false;
    updateInputState();

    console.log(
      "[room:ready]",
      data
    );
  }
);

/* =========================================================
   방 오류
========================================================= */

socket.on(
  "room:error",
  data => {
    isSubmitting = false;

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
   게임 상태
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
  }
);

/* =========================================================
   단어 성공
========================================================= */

socket.on(
  "game:word",
  data => {
    isSubmitting = false;

    if (!data?.ok) {
      updateInputState();
      return;
    }

    /*
     * 서버가 최종 승인한 단어만 기록
     */
    const word =
      normalizeWord(
        data.word
      );

    if (word) {
      localUsedWords.add(
        word
      );
    }

    /*
     * 내 단어가 성공적으로 처리된 경우
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

    /*
     * game:word 다음에 서버가 game:state도 보내므로
     * 상태는 game:state에서 최종 동기화된다.
     */

    updateInputState();
  }
);

/* =========================================================
   단어 오류
========================================================= */

socket.on(
  "game:error",
  data => {
    isSubmitting = false;

    showMessage(
      data?.reason ||
        "단어 처리 중 오류가 발생했습니다.",
      "error"
    );

    /*
     * 서버가 허용 글자를 보내준 경우 표시
     */
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
   게임 종료
========================================================= */

socket.on(
  "game:finished",
  data => {
    isSubmitting = false;

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
   게임 시작
========================================================= */

socket.on(
  "game:started",
  data => {
    isSubmitting = false;

    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    showMessage(
      "새 게임이 시작되었습니다.",
      "success"
    );

    updateInputState();

    console.log(
      "[game:started]",
      data
    );
  }
);

/* =========================================================
   상대방 나감
========================================================= */

socket.on(
  "room:playerLeft",
  data => {
    isSubmitting = false;

    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    /*
     * 내가 방을 나간 직후 서버가 보내는 이벤트가 아니라
     * 상대방이 나갔을 때 처리
     */
    if (
      data?.reason
    ) {
      showMessage(
        data.reason,
        "error"
      );
    } else {
      showMessage(
        "상대방이 방을 나갔습니다.",
        "error"
      );
    }

    updateInputState();

    console.log(
      "[room:playerLeft]",
      data
    );
  }
);

/* =========================================================
   game:submit redirect
   서버가 game:submit을 받으면 이것을 보내므로
   혹시 기존 코드에서 사용해도 오류가 나지 않게 처리
========================================================= */

socket.on(
  "game:submit:redirect",
  () => {
    /*
     * 서버 호환 이벤트.
     * 실제 성공/실패는 game:word / game:error로 처리된다.
     */
  }
);

/* =========================================================
   버튼 이벤트 자동 연결
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
   방 생성 버튼
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
   방 입장 버튼
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
   단어 제출 버튼
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
   재시작 버튼
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
   나가기 버튼
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
   방 상태 새로고침 버튼
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
   엔터키 단어 제출
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    const input =
      getWordInput();

    if (
      !input ||
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
   페이지 종료 전
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {
    /*
     * Socket.IO disconnect가 자동으로 발생하므로
     * 여기서 room:leave를 강제로 보내지 않는다.
     */
  }
);

/* =========================================================
   전역 API
   HTML의 onclick 등 기존 코드와도 연결 가능
========================================================= */

window.createRoom =
  createRoom;

window.joinRoom =
  joinRoom;

window.submitWord =
  submitWord;

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
   초기 상태
========================================================= */

updateInputState();

console.log(
  "client/script.js 로드 완료"
);
console.log(
  "Socket.IO 이벤트 연결 완료"
);
