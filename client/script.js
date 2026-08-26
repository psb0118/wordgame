"use strict";

/* =========================================================
   끝말잇기
   client/script.js

   server/server.js와 이벤트 완전 통일

   room:create
   room:created

   room:join
   room:joined
   room:ready
   room:error

   room:state
   room:leave
   room:playerLeft

   game:word
   game:error
   game:state
   game:started
   game:finished

   server:ready
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

let socketConnected =
  false;

let roomId =
  null;

let playerIndex =
  null;

let gameState =
  null;

let myNickname =
  "플레이어";

let localUsedWords =
  new Set();

let isSubmitting =
  false;

/* =========================================================
   DOM
========================================================= */

function $(selector) {
  return document.querySelector(
    selector
  );
}

function $all(selector) {
  return [
    ...document.querySelectorAll(
      selector
    )
  ];
}

/* =========================================================
   정규화
========================================================= */

function normalizeWord(word) {
  if (
    typeof word !==
    "string"
  ) {
    return "";
  }

  return word
    .trim()
    .replace(/\s+/g, "")
    .normalize("NFC");
}

/* =========================================================
   두음 허용
========================================================= */

function allowedFirstChars(
  lastChar
) {
  lastChar =
    normalizeWord(
      lastChar
    );

  if (!lastChar) {
    return [];
  }

  const result =
    new Set();

  result.add(
    lastChar
  );

  const direct =
    DUEUM[lastChar];

  if (
    Array.isArray(direct)
  ) {
    for (
      const char
      of direct
    ) {
      if (char) {
        result.add(char);
      }
    }
  }

  for (
    const [from, values]
    of Object.entries(DUEUM)
  ) {
    if (
      !Array.isArray(values)
    ) {
      continue;
    }

    if (
      values.includes(
        lastChar
      )
    ) {
      result.add(from);
    }
  }

  return [
    ...result
  ];
}

/* =========================================================
   연결
========================================================= */

function canConnect(
  previousWord,
  nextWord
) {
  previousWord =
    normalizeWord(
      previousWord
    );

  nextWord =
    normalizeWord(
      nextWord
    );

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

  return allowedFirstChars(
    last
  ).includes(
    first
  );
}

/* =========================================================
   UI
========================================================= */

function setText(
  selectors,
  value
) {
  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector);

    if (element) {
      element.textContent =
        value;
    }
  }
}

function setDisabled(
  selectors,
  disabled
) {
  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector);

    if (element) {
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
  const text =
    String(
      message ?? ""
    );

  const selectors = [
    "#message",
    "#status",
    "#gameMessage",
    ".message",
    ".status"
  ];

  for (
    const selector
    of selectors
  ) {
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
   닉네임
========================================================= */

function getNickname() {
  const selectors = [
    "#nickname",
    "#nicknameInput",
    "input[name='nickname']"
  ];

  for (
    const selector
    of selectors
  ) {
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
   시작 글자
========================================================= */

function getStartChar() {
  const selectors = [
    "#startChar",
    "#startCharInput",
    "input[name='startChar']"
  ];

  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector);

    if (element) {
      return (
        normalizeWord(
          element.value
        ).at(0) || ""
      );
    }
  }

  return "";
}

/* =========================================================
   최대 인원
========================================================= */

function getMaxPlayers() {
  const selectors = [
    "#maxPlayers",
    "#maxPlayer",
    "#playerLimit",
    "input[name='maxPlayers']",
    "select[name='maxPlayers']"
  ];

  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector);

    if (element) {
      const value =
        Number(
          element.value
        );

      if (
        Number.isFinite(
          value
        )
      ) {
        return Math.min(
          20,
          Math.max(
            2,
            Math.floor(value)
          )
        );
      }
    }
  }

  return 2;
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

  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector);

    if (element) {
      return String(
        element.value ||
        ""
      )
        .trim()
        .toUpperCase();
    }
  }

  return "";
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

  for (
    const selector
    of selectors
  ) {
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

  if (input) {
    input.value = "";

    if (
      !input.disabled
    ) {
      input.focus();
    }
  }
}

/* =========================================================
   플레이어
========================================================= */

function getMyPlayer() {
  if (
    !gameState ||
    playerIndex === null
  ) {
    return null;
  }

  return (
    gameState.players
      ?.find(
        player =>
          player.playerIndex ===
          playerIndex
      ) ||
    null
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
    gameState.players
      ?.filter(
        player =>
          player.playerIndex !==
          playerIndex
      ) ||
    []
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
    gameState.playerCount >= 2 &&
    !gameState.finished
  );
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
    gameState.players ||
    [];

  const me =
    players.find(
      player =>
        player.playerIndex ===
        playerIndex
    );

  setText(
    [
      "#myNickname",
      "#playerName",
      "[data-player-name]"
    ],
    me?.nickname ||
      myNickname
  );

  /*
   * 기존 2인 UI 호환
   */
  const opponents =
    getOpponentPlayers();

  setText(
    [
      "#opponentNickname",
      "#enemyName",
      "[data-opponent-name]"
    ],
    opponents.length
      ? opponents
          .map(
            p =>
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

  /*
   * N명 플레이어 목록
   */
  const selectors = [
    "#players",
    "#playerList",
    "[data-player-list]"
  ];

  let container =
    null;

  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector);

    if (element) {
      container =
        element;

      break;
    }
  }

  if (!container) {
    return;
  }

  container.innerHTML =
    "";

  const sorted =
    [...players].sort(
      (a, b) =>
        a.playerIndex -
        b.playerIndex
    );

  for (
    const player
    of sorted
  ) {
    const row =
      document.createElement(
        "div"
      );

    row.className =
      "player-item";

    const turnMark =
      gameState.turnPlayer ===
      player.playerIndex &&
      !gameState.finished
        ? " ▶"
        : "";

    const meMark =
      player.playerIndex ===
      playerIndex
        ? " (나)"
        : "";

    row.textContent =
      `${player.playerIndex + 1}. ${player.nickname}${meMark}${turnMark}`;

    container.appendChild(
      row
    );
  }
}

/* =========================================================
   현재 단어
========================================================= */

function renderCurrentWord() {
  const word =
    gameState?.currentWord ||
    "";

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

  if (
    gameState.finished
  ) {
    if (
      gameState.winner ===
      playerIndex
    ) {
      showMessage(
        "게임에서 승리했습니다.",
        "win"
      );
    } else {
      const winner =
        gameState.players
          ?.find(
            p =>
              p.playerIndex ===
              gameState.winner
          );

      showMessage(
        `게임 종료 — ${winner?.nickname || "다른 플레이어"} 승리`,
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

  const current =
    gameState.players
      ?.find(
        p =>
          p.playerIndex ===
          gameState.turnPlayer
      );

  if (
    gameState.turnPlayer ===
    playerIndex
  ) {
    showMessage(
      "당신의 차례입니다.",
      "my-turn"
    );
  } else {
    showMessage(
      `${current?.nickname || "플레이어"}의 차례입니다.`,
      "opponent-turn"
    );
  }
}

/* =========================================================
   두음 정보
========================================================= */

function renderDueumInfo() {
  if (
    !gameState?.currentWord
  ) {
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
    allowedFirstChars(
      last
    );

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
   기록
========================================================= */

function renderHistory() {
  const history =
    gameState?.history ||
    [];

  localUsedWords =
    new Set(
      history.map(
        item =>
          item.word
      )
    );

  const selectors = [
    "#history",
    "#wordHistory",
    "#gameHistory",
    "[data-history]"
  ];

  let container =
    null;

  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector);

    if (element) {
      container =
        element;

      break;
    }
  }

  if (!container) {
    return;
  }

  container.innerHTML =
    "";

  for (
    const item
    of history
  ) {
    const row =
      document.createElement(
        "div"
      );

    row.className =
      "history-item";

    const depth =
      item.depth !==
        null &&
      item.depth !==
        undefined
        ? ` (깊이 ${item.depth})`
        : "";

    row.textContent =
      `${item.turn}. ${item.nickname || `플레이어 ${item.player + 1}`}: ${item.word}${depth}`;

    container.appendChild(
      row
    );
  }

  container.scrollTop =
    container.scrollHeight;
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
    gameState.playerCount <
      2 ||
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
   전체 상태
========================================================= */

function renderGameState(
  state
) {
  if (!state) {
    return;
  }

  gameState =
    state;

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

  const maxPlayers =
    getMaxPlayers();

  myNickname =
    nickname;

  socket.emit(
    "room:create",
    {
      nickname,

      startChar,

      maxPlayers
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
      roomId:
        roomCode,

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
   * 중복 빠른 검사
   */
  if (
    localUsedWords.has(
      word
    )
  ) {
    showMessage(
      "이미 사용한 단어입니다.",
      "error"
    );

    return;
  }

  /*
   * 연결 빠른 검사
   */
  if (
    gameState.currentWord
  ) {
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
  } else if (
    gameState.startChar
  ) {
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
   * 실제 서버 제출
   */
  isSubmitting =
    true;

  updateInputState();

  socket.emit(
    "game:word",
    {
      word
    }
  );
}

/* =========================================================
   재시작
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
   나가기
========================================================= */

function leaveRoom() {
  if (!roomId) {
    return;
  }

  socket.emit(
    "room:leave"
  );

  roomId =
    null;

  playerIndex =
    null;

  gameState =
    null;

  localUsedWords =
    new Set();

  isSubmitting =
    false;

  renderRoomId();

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
  if (!roomId) {
    return;
  }

  socket.emit(
    "room:state"
  );
}

/* =========================================================
   Socket.IO connect
========================================================= */

socket.on(
  "connect",
  () => {
    socketConnected =
      true;

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
   disconnect
========================================================= */

socket.on(
  "disconnect",
  reason => {
    socketConnected =
      false;

    isSubmitting =
      false;

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

    localUsedWords =
      new Set();

    isSubmitting =
      false;

    renderGameState(
      gameState
    );

    showMessage(
      `방 생성 완료 — 코드: ${roomId}`,
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

    localUsedWords =
      new Set(
        gameState?.history?.map(
          item =>
            item.word
        ) || []
      );

    isSubmitting =
      false;

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

    isSubmitting =
      false;

    updateInputState();

    console.log(
      "[room:ready]",
      data
    );
  }
);

/* =========================================================
   room:error
========================================================= */

socket.on(
  "room:error",
  data => {
    isSubmitting =
      false;

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
    isSubmitting =
      false;

    renderGameState(
      state
    );
  }
);

/* =========================================================
   game:word
========================================================= */

socket.on(
  "game:word",
  data => {
    isSubmitting =
      false;

    if (!data?.ok) {
      updateInputState();
      return;
    }

    if (data.word) {
      localUsedWords.add(
        normalizeWord(
          data.word
        )
      );
    }

    if (
      data.player ===
      playerIndex
    ) {
      clearWordInput();
    }

    updateInputState();

    console.log(
      "[game:word]",
      data
    );
  }
);

/* =========================================================
   game:error
========================================================= */

socket.on(
  "game:error",
  data => {
    isSubmitting =
      false;

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
        data.allowed.join(
          ", "
        )
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
   game:started
========================================================= */

socket.on(
  "game:started",
  data => {
    isSubmitting =
      false;

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
   game:finished
========================================================= */

socket.on(
  "game:finished",
  data => {
    isSubmitting =
      false;

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
        "게임 종료 — 당신이 승리했습니다.",
        "win"
      );
    } else {
      const winner =
        gameState?.players?.find(
          player =>
            player.playerIndex ===
            data?.winner
        );

      showMessage(
        `게임 종료 — ${winner?.nickname || "다른 플레이어"} 승리`,
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
   room:playerLeft
========================================================= */

socket.on(
  "room:playerLeft",
  data => {
    isSubmitting =
      false;

    if (data?.state) {
      renderGameState(
        data.state
      );
    }

    showMessage(
      data?.reason ||
        "플레이어가 방을 나갔습니다.",
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
   클릭 이벤트
========================================================= */

function bindClick(
  selectors,
  handler
) {
  for (
    const selector
    of selectors
  ) {
    const elements =
      $all(selector);

    for (
      const element
      of elements
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
   엔터
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    const input =
      getWordInput();

    if (
      !input ||
      event.target !==
        input
    ) {
      return;
    }

    if (
      event.key ===
      "Enter"
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

updateInputState();

console.log(
  "client/script.js 로드 완료"
);

console.log(
  "Socket.IO 멀티플레이 이벤트 연결 완료"
);
