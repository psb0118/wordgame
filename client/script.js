"use strict";

/* =========================================================
   끝말잇기 client/script.js

   서버 이벤트와 정확히 대응

   room:create
   room:created

   room:join
   room:joined
   room:ready
   room:error
   room:state
   room:playerLeft
   room:leave

   game:word
   game:error
   game:state
   game:started
   game:finished
   game:restart

   player:heartLost
   player:eliminated

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

let connected = false;

let roomId = null;
let playerId = null;

let state = null;

let submitting = false;

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

function setText(selectors, value) {
  for (const selector of selectors) {
    const el = $(selector);

    if (el) {
      el.textContent =
        String(value ?? "");
    }
  }
}

function setDisabled(selectors, value) {
  for (const selector of selectors) {
    const el = $(selector);

    if (el) {
      el.disabled = value;
    }
  }
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
   두음
========================================================= */

function allowedFirstChars(char) {
  char = normalizeWord(char);

  if (!char) {
    return [];
  }

  const result = new Set();

  result.add(char);

  if (Array.isArray(DUEUM[char])) {
    for (const value of DUEUM[char]) {
      result.add(value);
    }
  }

  for (const [from, values] of Object.entries(DUEUM)) {
    if (
      Array.isArray(values) &&
      values.includes(char)
    ) {
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

  return allowedFirstChars(
    previousWord.at(-1)
  ).includes(
    nextWord.at(0)
  );
}

/* =========================================================
   메시지
========================================================= */

function showMessage(
  message,
  type = "info"
) {
  const text =
    String(message ?? "");

  const targets = [
    "#message",
    "#status",
    "#gameMessage",
    ".message",
    ".status"
  ];

  let found = false;

  for (const selector of targets) {
    const el = $(selector);

    if (!el) {
      continue;
    }

    el.textContent = text;
    el.dataset.type = type;

    found = true;
    break;
  }

  if (!found) {
    console.log(
      `[${type}] ${text}`
    );
  }
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
    const el = $(selector);

    if (el) {
      return el;
    }
  }

  return null;
}

function clearInput() {
  const input =
    getWordInput();

  if (!input) {
    return;
  }

  input.value = "";

  /*
   * Enter 이후에도 바로 다시 입력 가능
   */
  if (!input.disabled) {
    requestAnimationFrame(() => {
      input.focus();
    });
  }
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
    const el = $(selector);

    if (el) {
      return (
        normalizeWord(
          el.value
        ) || "플레이어"
      );
    }
  }

  return "플레이어";
}

/* =========================================================
   방 코드
========================================================= */

function getRoomIdInput() {
  const selectors = [
    "#roomIdInput",
    "#roomCodeInput",
    "#roomInput",
    "input[name='roomId']",
    "input[name='roomCode']"
  ];

  for (const selector of selectors) {
    const el = $(selector);

    if (el) {
      return String(
        el.value || ""
      )
        .trim()
        .toUpperCase();
    }
  }

  return "";
}

/* =========================================================
   설정
========================================================= */

function getNumber(
  selectors,
  fallback
) {
  for (const selector of selectors) {
    const el = $(selector);

    if (el) {
      const value =
        Number(el.value);

      if (
        Number.isFinite(value)
      ) {
        return value;
      }
    }
  }

  return fallback;
}

function getMaxPlayers() {
  return Math.min(
    20,
    Math.max(
      2,
      getNumber(
        [
          "#maxPlayers",
          "#playerLimit"
        ],
        2
      )
    )
  );
}

function getTurnTime() {
  return Math.min(
    60,
    Math.max(
      5,
      getNumber(
        [
          "#turnTime",
          "#timeLimit"
        ],
        15
      )
    )
  );
}

function getAIEnabled() {
  const selectors = [
    "#aiEnabled",
    "#useAI",
    "#botEnabled"
  ];

  for (const selector of selectors) {
    const el = $(selector);

    if (el) {
      return !!el.checked;
    }
  }

  return false;
}

function getAILevel() {
  return Math.min(
    5,
    Math.max(
      1,
      getNumber(
        [
          "#aiLevel",
          "#botLevel"
        ],
        3
      )
    )
  );
}

/* =========================================================
   내 플레이어
========================================================= */

function getMe() {
  return (
    state?.players?.find(
      player =>
        player.id === playerId
    ) || null
  );
}

function getCurrentPlayer() {
  return (
    state?.players?.find(
      player =>
        player.id ===
        state.turnPlayer
    ) || null
  );
}

function isMyTurn() {
  const me = getMe();

  if (!me) {
    return false;
  }

  return (
    me.alive &&
    state &&
    state.started &&
    !state.finished &&
    state.turnPlayer ===
      playerId
  );
}

/* =========================================================
   UI 상태
========================================================= */

function updateInputState() {
  const input =
    getWordInput();

  const me = getMe();

  const disabled =
    !connected ||
    !roomId ||
    !state ||
    !state.started ||
    state.finished ||
    !me ||
    !me.alive ||
    !isMyTurn() ||
    submitting;

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
      "#submit"
    ],
    disabled
  );
}

/* =========================================================
   방 정보
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

  if (!state) {
    return;
  }

  setText(
    [
      "#playerCount",
      "[data-player-count]"
    ],
    `${state.playerCount}/${state.maxPlayers}`
  );

  const me = getMe();

  setText(
    [
      "#myNickname",
      "#playerName",
      "[data-player-name]"
    ],
    me?.nickname || "-"
  );
}

/* =========================================================
   플레이어
========================================================= */

function renderPlayers() {
  if (!state) {
    return;
  }

  const container =
    $("#players") ||
    $("#playerList") ||
    $("[data-players]");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  for (const player of state.players) {
    const row =
      document.createElement("div");

    row.className =
      "player";

    const hearts =
      "♥".repeat(
        Math.max(0, player.hearts)
      ) +
      "♡".repeat(
        Math.max(
          0,
          2 - player.hearts
        )
      );

    row.textContent =
      `${player.nickname} ${hearts}`;

    if (
      player.id ===
      state.turnPlayer
    ) {
      row.dataset.turn =
        "true";
    }

    if (!player.alive) {
      row.dataset.eliminated =
        "true";
    }

    container.appendChild(row);
  }
}

/* =========================================================
   단어
========================================================= */

function renderWord() {
  setText(
    [
      "#currentWord",
      "#lastWord",
      "#wordDisplay",
      "[data-current-word]"
    ],
    state?.currentWord || "-"
  );
}

/* =========================================================
   타이머
========================================================= */

let timerInterval = null;

function renderTimer() {
  clearInterval(timerInterval);

  const timerElements = [
    "#timer",
    "#timeLeft",
    "[data-timer]"
  ];

  function update() {
    if (
      !state ||
      !state.turnExpiresAt ||
      state.finished
    ) {
      setText(
        timerElements,
        "-"
      );
      return;
    }

    const remaining =
      Math.max(
        0,
        state.turnExpiresAt -
          Date.now()
      );

    const seconds =
      Math.ceil(
        remaining / 1000
      );

    setText(
      timerElements,
      seconds
    );
  }

  update();

  timerInterval =
    setInterval(
      update,
      100
    );
}

/* =========================================================
   기록
========================================================= */

function renderHistory() {
  const container =
    $("#history") ||
    $("#wordHistory") ||
    $("#gameHistory") ||
    $("[data-history]");

  if (!container || !state) {
    return;
  }

  container.innerHTML = "";

  for (const item of state.history) {
    const row =
      document.createElement("div");

    row.className =
      "history-item";

    const depth =
      item.depth !== null &&
      item.depth !== undefined
        ? ` [${item.depth}]`
        : "";

    row.textContent =
      `${item.nickname}: ${item.word}${depth}`;

    container.appendChild(row);
  }

  container.scrollTop =
    container.scrollHeight;
}

/* =========================================================
   턴
========================================================= */

function renderTurn() {
  if (!state) {
    return;
  }

  if (state.finished) {
    const winner =
      state.players?.find(
        p =>
          p.id === state.winner
      );

    if (
      winner?.id ===
      playerId
    ) {
      showMessage(
        "게임에서 승리했습니다.",
        "win"
      );
    } else {
      showMessage(
        `게임 종료 — ${winner?.nickname || "승자"} 승리`,
        "lose"
      );
    }

    return;
  }

  if (!state.started) {
    showMessage(
      "게임 시작을 기다리는 중입니다.",
      "waiting"
    );

    return;
  }

  if (
    state.turnPlayer ===
    playerId
  ) {
    showMessage(
      "당신의 차례입니다. 단어를 입력하세요.",
      "my-turn"
    );
  } else {
    const current =
      getCurrentPlayer();

    showMessage(
      `${current?.nickname || "상대방"}의 차례입니다.`,
      "opponent-turn"
    );
  }
}

/* =========================================================
   전체 렌더
========================================================= */

function renderState(newState) {
  if (!newState) {
    return;
  }

  state = newState;

  if (state.roomId) {
    roomId =
      state.roomId;
  }

  renderRoom();
  renderPlayers();
  renderWord();
  renderHistory();
  renderTurn();
  renderTimer();

  updateInputState();
}

/* =========================================================
   방 생성
========================================================= */

function createRoom() {
  if (!connected) {
    showMessage(
      "서버에 연결하는 중입니다.",
      "error"
    );
    return;
  }

  socket.emit(
    "room:create",
    {
      nickname:
        getNickname(),

      maxPlayers:
        getMaxPlayers(),

      turnTime:
        getTurnTime(),

      aiEnabled:
        getAIEnabled(),

      aiLevel:
        getAILevel()
    }
  );
}

/* =========================================================
   방 입장
========================================================= */

function joinRoom() {
  const id =
    getRoomIdInput();

  if (!id) {
    showMessage(
      "방 코드를 입력해주세요.",
      "error"
    );

    return;
  }

  socket.emit(
    "room:join",
    {
      roomId: id,

      nickname:
        getNickname()
    }
  );
}

/* =========================================================
   단어 제출
========================================================= */

function submitWord() {
  /*
   * 중복 Enter 방지
   */
  if (submitting) {
    return;
  }

  if (!connected) {
    showMessage(
      "서버와 연결되지 않았습니다.",
      "error"
    );

    return;
  }

  if (!roomId || !state) {
    showMessage(
      "먼저 게임에 참가해주세요.",
      "error"
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

    input.focus();

    return;
  }

  /*
   * 클라이언트 빠른 검증
   *
   * 서버 검증이 최종 판정
   */
  const used =
    new Set(
      (state.history || [])
        .map(
          item => item.word
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
    state.currentWord &&
    !canConnect(
      state.currentWord,
      word
    )
  ) {
    showMessage(
      `"${state.currentWord.at(-1)}" 다음에 연결할 수 없습니다.`,
      "error"
    );

    return;
  }

  /*
   * 여기서 잠깐 잠그지만
   * 서버 응답이 오면 무조건 풀린다.
   */
  submitting = true;

  updateInputState();

  socket.emit(
    "game:word",
    {
      word
    }
  );
}

/* =========================================================
   새 게임
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
    "game:restart"
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

  roomId = null;
  playerId = null;
  state = null;

  submitting = false;

  clearInterval(
    timerInterval
  );

  renderRoom();
  updateInputState();

  showMessage(
    "방에서 나왔습니다.",
    "info"
  );
}

/* =========================================================
   Socket.IO
========================================================= */

socket.on(
  "connect",
  () => {
    connected = true;

    submitting = false;

    console.log(
      "[Socket.IO] connected",
      socket.id
    );

    showMessage(
      "서버에 연결되었습니다.",
      "success"
    );

    /*
     * 재접속 시 방 상태 요청
     */
    if (roomId) {
      socket.emit(
        "room:state"
      );
    }

    updateInputState();
  }
);

socket.on(
  "disconnect",
  reason => {
    connected = false;

    submitting = false;

    console.warn(
      "[Socket.IO] disconnected",
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

    playerId =
      data.state?.players?.find(
        p =>
          !p.isAI &&
          p.playerIndex === 0
      )?.id || socket.id;

    submitting = false;

    renderState(
      data.state
    );

    showMessage(
      `방이 생성되었습니다. 코드: ${roomId}`,
      "success"
    );
  }
);

/* =========================================================
   방 입장
========================================================= */

socket.on(
  "room:joined",
  data => {
    if (!data?.ok) {
      return;
    }

    roomId =
      data.roomId;

    playerId =
      data.playerId;

    submitting = false;

    renderState(
      data.state
    );

    showMessage(
      "방에 입장했습니다.",
      "success"
    );
  }
);

/* =========================================================
   상대 입장
========================================================= */

socket.on(
  "room:ready",
  data => {
    submitting = false;

    if (data?.state) {
      renderState(
        data.state
      );
    }

    showMessage(
      "플레이어가 입장했습니다.",
      "success"
    );
  }
);

/* =========================================================
   방 오류
========================================================= */

socket.on(
  "room:error",
  data => {
    submitting = false;

    showMessage(
      data?.reason ||
        "방 처리 중 오류",
      "error"
    );

    updateInputState();
  }
);

/* =========================================================
   게임 상태
========================================================= */

socket.on(
  "game:state",
  newState => {
    /*
     * 어떤 상황에서든 서버 상태가 오면
     * 입력 잠금을 해제하고 상태를 갱신
     */
    submitting = false;

    renderState(
      newState
    );
  }
);

/* =========================================================
   게임 시작
========================================================= */

socket.on(
  "game:started",
  data => {
    submitting = false;

    if (data?.state) {
      renderState(
        data.state
      );
    }

    /*
     * 서버가 자동 생성한 시작 단어
     */
    if (data?.startWord) {
      setText(
        [
          "#currentWord",
          "#lastWord",
          "#wordDisplay",
          "[data-current-word]"
        ],
        data.startWord
      );
    }

    showMessage(
      "새 게임이 시작되었습니다.",
      "success"
    );

    updateInputState();
  }
);

/* =========================================================
   단어 성공
========================================================= */

socket.on(
  "game:word",
  data => {
    submitting = false;

    if (!data?.ok) {
      updateInputState();
      return;
    }

    if (
      data.playerId ===
      playerId
    ) {
      clearInput();
    }

    /*
     * 실제 상태는 바로 뒤의 game:state로 동기화
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
    submitting = false;

    showMessage(
      data?.reason ||
        "단어 입력에 실패했습니다.",
      "error"
    );

    /*
     * 서버가 상태를 다시 보내기 때문에
     * 입력 잠금이 풀린다.
     */
    updateInputState();
  }
);

/* =========================================================
   하트 감소
========================================================= */

socket.on(
  "player:heartLost",
  data => {
    console.log(
      "[heart lost]",
      data
    );

    /*
     * 실제 하트 값은 game:state로 갱신
     */
    if (
      data.playerId ===
      playerId
    ) {
      showMessage(
        `실패했습니다. 남은 하트: ${data.hearts}`,
        "error"
      );
    }
  }
);

/* =========================================================
   탈락
========================================================= */

socket.on(
  "player:eliminated",
  data => {
    if (
      data.playerId ===
      playerId
    ) {
      showMessage(
        "하트를 모두 잃어 탈락했습니다.",
        "lose"
      );
    } else {
      showMessage(
        `${data.nickname}님이 탈락했습니다.`,
        "info"
      );
    }
  }
);

/* =========================================================
   게임 종료
========================================================= */

socket.on(
  "game:finished",
  data => {
    submitting = false;

    if (data?.state) {
      renderState(
        data.state
      );
    }

    if (
      data?.winner ===
      playerId
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
  }
);

/* =========================================================
   상대방 퇴장
========================================================= */

socket.on(
  "room:playerLeft",
  data => {
    submitting = false;

    if (data?.state) {
      renderState(
        data.state
      );
    }

    if (data?.nickname) {
      showMessage(
        `${data.nickname}님이 방을 나갔습니다.`,
        "error"
      );
    }

    updateInputState();
  }
);

/* =========================================================
   클릭 바인딩
========================================================= */

function bindClick(
  selectors,
  handler
) {
  for (const selector of selectors) {
    for (const element of $all(selector)) {
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

bindClick(
  [
    "#createRoom",
    "#createRoomButton",
    "#roomCreate",
    "[data-action='create-room']"
  ],
  createRoom
);

bindClick(
  [
    "#joinRoom",
    "#joinRoomButton",
    "#roomJoin",
    "[data-action='join-room']"
  ],
  joinRoom
);

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

bindClick(
  [
    "#restartGame",
    "#restartButton",
    "#gameRestart",
    "[data-action='restart-game']"
  ],
  restartGame
);

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

      /*
       * disabled 상태가 아니면 무조건 제출
       */
      if (!input.disabled) {
        submitWord();
      }
    }
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

window.restartGame =
  restartGame;

window.leaveRoom =
  leaveRoom;

window.canConnect =
  canConnect;

window.allowedFirstChars =
  allowedFirstChars;

window.normalizeWord =
  normalizeWord;

/* =========================================================
   시작
========================================================= */

updateInputState();

console.log(
  "client/script.js 로드 완료"
);
console.log(
  "Socket.IO multiplayer client ready"
);
