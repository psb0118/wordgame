"use strict";

/* =========================================================
   끝말잇기 client/script.js

   server/server.js와 이벤트 완전 대응
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

let isSubmitting = false;

let reconnecting = false;

/* =========================================================
   DOM
========================================================= */

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [
    ...document.querySelectorAll(selector)
  ];
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
  lastChar =
    normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result =
    new Set();

  result.add(lastChar);

  const direct =
    DUEUM[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      result.add(char);
    }
  }

  for (
    const [from, values]
    of Object.entries(DUEUM)
  ) {
    if (
      Array.isArray(values) &&
      values.includes(lastChar)
    ) {
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
   상태 정보
========================================================= */

function getMyPlayer() {
  if (
    !gameState ||
    playerIndex === null
  ) {
    return null;
  }

  return (
    gameState.players?.find(
      player =>
        player.playerIndex ===
        playerIndex
    ) || null
  );
}

function getOpponentPlayers() {
  if (
    !gameState ||
    playerIndex === null
  ) {
    return [];
  }

  return (
    gameState.players?.filter(
      player =>
        player.playerIndex !==
        playerIndex
    ) || []
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
    gameState.turnPlayer ===
      playerIndex &&
    !gameState.finished &&
    gameState.playerCount >= 2
  );
}

/* =========================================================
   텍스트
========================================================= */

function setText(
  selectors,
  value
) {
  for (const selector of selectors) {
    const element = $(selector);

    if (element) {
      element.textContent =
        String(value ?? "");
    }
  }
}

/* =========================================================
   disabled
========================================================= */

function setDisabled(
  selectors,
  disabled
) {
  for (const selector of selectors) {
    for (
      const element
      of $all(selector)
    ) {
      element.disabled =
        disabled;
    }
  }
}

/* =========================================================
   메시지
========================================================= */

function showMessage(
  message,
  type = "info"
) {
  const selectors = [
    "#message",
    "#status",
    "#gameMessage",
    ".message",
    ".status"
  ];

  const text =
    String(message ?? "");

  for (const selector of selectors) {
    const element =
      $(selector);

    if (!element) {
      continue;
    }

    element.textContent =
      text;

    element.dataset.type =
      type;

    return;
  }

  console.log(
    `[${type}] ${text}`
  );
}

/* =========================================================
   방 코드
========================================================= */

function renderRoom() {
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
   플레이어
========================================================= */

function renderPlayers() {
  if (!gameState) {
    return;
  }

  const players =
    gameState.players || [];

  const me =
    getMyPlayer();

  const opponents =
    getOpponentPlayers();

  setText(
    [
      "#myNickname",
      "#playerName",
      "[data-player-name]"
    ],
    me?.nickname ||
      myNickname
  );

  setText(
    [
      "#opponentNickname",
      "#enemyName",
      "[data-opponent-name]"
    ],
    opponents.length > 0
      ? opponents
          .map(p =>
            p.nickname
          )
          .join(", ")
      : "상대방 대기 중"
  );

  setText(
    [
      "#playerCount",
      "[data-player-count]"
    ],
    `${players.length}/${gameState.maxPlayers || 2}`
  );
}

/* =========================================================
   현재 단어
========================================================= */

function renderCurrentWord() {
  setText(
    [
      "#currentWord",
      "#lastWord",
      "#wordDisplay",
      "[data-current-word]"
    ],
    gameState?.currentWord ||
      "-"
  );

  setText(
    [
      "#startWord",
      "[data-start-word]"
    ],
    gameState?.startWord ||
      "-"
  );
}

/* =========================================================
   허용 글자
========================================================= */

function renderAllowedChars() {
  const word =
    gameState?.currentWord;

  if (!word) {
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
    word.at(-1);

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
   턴
========================================================= */

function renderTurn() {
  if (!gameState) {
    return;
  }

  if (gameState.finished) {
    if (
      gameState.winner ===
      playerIndex
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

  if (
    gameState.playerCount <
    2
  ) {
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

    return;
  }

  const player =
    gameState.players?.find(
      p =>
        p.playerIndex ===
        gameState.turnPlayer
    );

  showMessage(
    `${player?.nickname || "상대방"}의 차례입니다.`,
    "opponent-turn"
  );
}

/* =========================================================
   입력
========================================================= */

function getWordInput() {
  const selectors = [
    "#wordInput",
    "#inputWord",
    "#word",
    "input[name='word']"
  ];

  for (const selector of selectors) {
    const input =
      $(selector);

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
    isSubmitting;

  if (input) {
    input.disabled =
      disabled;
  }

  setDisabled(
    [
      "#submitWord",
      "#submitButton",
      "#wordSubmit",
      "#sendWord",
      "#submit",
      "[data-action='submit-word']"
    ],
    disabled
  );
}

/* =========================================================
   기록
========================================================= */

function renderHistory() {
  const history =
    gameState?.history || [];

  const containerSelectors = [
    "#history",
    "#wordHistory",
    "#gameHistory",
    "[data-history]"
  ];

  let container = null;

  for (
    const selector
    of containerSelectors
  ) {
    const element =
      $(selector);

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
      document.createElement(
        "div"
      );

    row.className =
      "history-item";

    const player =
      gameState.players?.find(
        p =>
          p.playerIndex ===
          item.player
      );

    const name =
      item.player === -1
        ? "시작"
        : player?.nickname ||
          `플레이어 ${item.player + 1}`;

    const depth =
      item.depth !== null &&
      item.depth !== undefined
        ? ` · 깊이 ${item.depth}`
        : "";

    row.textContent =
      `${item.turn}. ${name}: ${item.word}${depth}`;

    container.appendChild(
      row
    );
  }

  container.scrollTop =
    container.scrollHeight;
}

/* =========================================================
   전체 상태
========================================================= */

function renderGameState(state) {
  if (!state) {
    return;
  }

  gameState =
    state;

  if (state.roomId) {
    roomId =
      state.roomId;
  }

  renderRoom();
  renderPlayers();
  renderCurrentWord();
  renderAllowedChars();
  renderHistory();
  renderTurn();

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
    const element =
      $(selector);

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
   최대 인원
========================================================= */

function getMaxPlayers() {
  const selectors = [
    "#maxPlayers",
    "#playerCountInput",
    "input[name='maxPlayers']"
  ];

  for (const selector of selectors) {
    const element =
      $(selector);

    if (element) {
      const value =
        Number(element.value);

      if (
        Number.isFinite(value)
      ) {
        return Math.max(
          2,
          Math.min(
            20,
            value
          )
        );
      }
    }
  }

  return 2;
}

/* =========================================================
   AI 레벨
========================================================= */

function getAILevel() {
  const selectors = [
    "#aiLevel",
    "#difficulty",
    "select[name='aiLevel']"
  ];

  for (const selector of selectors) {
    const element =
      $(selector);

    if (element) {
      const value =
        Number(element.value);

      if (
        Number.isFinite(value)
      ) {
        return Math.max(
          1,
          Math.min(
            5,
            value
          )
        );
      }
    }
  }

  return 3;
}

/* =========================================================
   모드
========================================================= */

function getGameMode() {
  const select =
    $(
      "#gameMode, select[name='mode']"
    );

  if (select) {
    return select.value === "ai"
      ? "ai"
      : "online";
  }

  return "online";
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
    const element =
      $(selector);

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

  myNickname =
    getNickname();

  const mode =
    getGameMode();

  socket.emit(
    "room:create",
    {
      nickname:
        myNickname,

      maxPlayers:
        getMaxPlayers(),

      mode,

      aiLevel:
        getAILevel()
    }
  );

  showMessage(
    "방을 생성하는 중입니다...",
    "info"
  );
}

/* =========================================================
   방 참가
========================================================= */

function joinRoom() {
  if (!socketConnected) {
    showMessage(
      "서버에 연결되어 있지 않습니다.",
      "error"
    );

    return;
  }

  const code =
    getRoomCode();

  if (!code) {
    showMessage(
      "방 코드를 입력해주세요.",
      "error"
    );

    return;
  }

  myNickname =
    getNickname();

  socket.emit(
    "room:join",
    {
      roomId:
        code,

      nickname:
        myNickname
    }
  );

  showMessage(
    "방에 참가하는 중입니다...",
    "info"
  );
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
      "먼저 방을 만들어주세요.",
      "error"
    );

    return;
  }

  if (!gameState) {
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
   * 클라이언트 빠른 검사
   */
  const used =
    new Set(
      (gameState.history || [])
        .map(item =>
          normalizeWord(
            item.word
          )
        )
    );

  if (used.has(word)) {
    showMessage(
      "이미 사용한 단어입니다.",
      "error"
    );

    return;
  }

  if (
    gameState.currentWord &&
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

  /*
   * 최종 판정은 서버
   */
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
   새 게임
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

  socket.emit(
    "game:restart"
  );

  showMessage(
    "새 게임을 시작하는 중입니다...",
    "info"
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

  isSubmitting = false;

  renderRoom();
  updateInputState();

  showMessage(
    "방에서 나왔습니다.",
    "info"
  );
}

/* =========================================================
   상태 요청
========================================================= */

function requestRoomState() {
  if (!socketConnected || !roomId) {
    return;
  }

  socket.emit(
    "room:state"
  );
}

/* =========================================================
   재접속 시도
========================================================= */

function tryReconnectRoom() {
  if (
    reconnecting ||
    !roomId ||
    playerIndex === null
  ) {
    return;
  }

  reconnecting = true;

  socket.emit(
    "room:reconnect",
    {
      roomId,
      playerIndex
    }
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
      "[Socket.IO] connected",
      socket.id
    );

    /*
     * 이전 방 정보가 있으면
     * 서버에 재접속 요청
     */
    if (
      roomId !== null &&
      playerIndex !== null
    ) {
      tryReconnectRoom();
    } else {
      showMessage(
        "서버에 연결되었습니다.",
        "success"
      );
    }

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

    reconnecting = false;

    console.warn(
      "[Socket.IO] disconnected",
      reason
    );

    showMessage(
      "서버와 연결이 끊어졌습니다. 재연결을 시도합니다...",
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
   방 생성
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

    renderGameState(
      gameState
    );

    showMessage(
      `방 생성 완료. 방 코드: ${roomId}`,
      "success"
    );

    console.log(
      "[room:created]",
      data
    );
  }
);

/* =========================================================
   방 참가
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

    isSubmitting = false;

    renderGameState(
      gameState
    );

    showMessage(
      "방에 참가했습니다.",
      "success"
    );

    console.log(
      "[room:joined]",
      data
    );
  }
);

/* =========================================================
   방 준비
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

    showMessage(
      data?.reason ||
        "방 처리 중 오류가 발생했습니다.",
      "error"
    );

    updateInputState();

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

    /*
     * 여기서 시작 단어가 반드시 화면에 표시됨.
     */
    if (data?.startWord) {
      showMessage(
        `새 게임 시작! 시작 단어: ${data.startWord}`,
        "success"
      );
    } else {
      showMessage(
        "새 게임이 시작되었습니다.",
        "success"
      );
    }

    updateInputState();

    console.log(
      "[game:started]",
      data
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
      return;
    }

    /*
     * 서버에서 game:state도 바로 보내므로
     * 최종 상태는 game:state가 담당한다.
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
   단어 오류
========================================================= */

socket.on(
  "game:error",
  data => {
    isSubmitting = false;

    showMessage(
      data?.reason ||
        "게임 처리 중 오류가 발생했습니다.",
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
        "게임 종료 — 승리!",
        "win"
      );
    } else {
      showMessage(
        "게임 종료 — 패배!",
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
   상대방 퇴장
========================================================= */

socket.on(
  "room:playerLeft",
  data => {
    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    isSubmitting = false;

    /*
     * 내가 명시적으로 나간 경우
     * 이미 roomId를 지웠기 때문에
     * 이 메시지를 게임 화면에 덮어쓰지 않는다.
     */
    if (roomId) {
      showMessage(
        data?.reason ||
          "플레이어가 방을 나갔습니다.",
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
   재접속 성공
========================================================= */

socket.on(
  "room:reconnected",
  data => {
    reconnecting = false;

    if (!data?.ok) {
      return;
    }

    roomId =
      data.roomId;

    playerIndex =
      data.playerIndex;

    gameState =
      data.state;

    isSubmitting = false;

    renderGameState(
      gameState
    );

    showMessage(
      "게임에 재접속했습니다.",
      "success"
    );

    console.log(
      "[room:reconnected]",
      data
    );
  }
);

/* =========================================================
   재접속 실패
========================================================= */

socket.on(
  "room:reconnect:error",
  data => {
    reconnecting = false;

    /*
     * 서버가 방을 찾지 못하면
     * 로컬 방 정보 제거.
     */
    roomId = null;
    playerIndex = null;
    gameState = null;

    isSubmitting = false;

    renderRoom();
    updateInputState();

    showMessage(
      data?.reason ||
        "게임에 재접속하지 못했습니다.",
      "error"
    );

    console.warn(
      "[room:reconnect:error]",
      data
    );
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
    for (
      const element
      of $all(selector)
    ) {
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
   방 참가
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
   새 게임
========================================================= */

bindClick(
  [
    "#restartGame",
    "#restartButton",
    "#gameRestart",
    "#newGame",
    "#newGameButton",
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
   Enter
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
   전역 API
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
   초기
========================================================= */

renderRoom();
updateInputState();

console.log(
  "client/script.js 로드 완료"
);

console.log(
  "Socket.IO multiplayer client ready"
);
