
/* =========================================================
  끝말잇기 client/script.js
   server/server.js와 이벤트 1:1 대응
========================================================= */

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
/* =========================================================
   Socket.IO
========================================================= */

const socket = io();
const socket =
  typeof io === "function"
    ? io({
        transports: [
          "websocket",
          "polling"
        ],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      })
    : null;

/* =========================================================
  두음법칙
@@ -89,50 +81,47 @@ const DUEUM = {
  상태
========================================================= */

let connected = false;
let socketConnected = false;

let roomId = null;
let playerId = null;

let state = null;
let playerIndex = null;

let gameState = null;

let myNickname =
  "플레이어";

let localUsedWords =
  new Set();

let submitting = false;
let isSubmitting =
  false;

let reconnecting =
  false;

let countdownTimer =
  null;

/* =========================================================
  DOM
========================================================= */

function $(selector) {
  return document.querySelector(selector);
  return document.querySelector(
    selector
  );
}

function $all(selector) {
return [
    ...document.querySelectorAll(selector)
    ...document.querySelectorAll(
      selector
    )
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
@@ -152,27 +141,35 @@ function normalizeWord(word) {
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

  result.add(lastChar);

  result.add(char);
  const direct =
    DUEUM[lastChar];

  if (Array.isArray(DUEUM[char])) {
    for (const value of DUEUM[char]) {
      result.add(value);
  if (Array.isArray(direct)) {
    for (const char of direct) {
      result.add(char);
}
}

  for (const [from, values] of Object.entries(DUEUM)) {
  for (
    const [from, values]
    of Object.entries(DUEUM)
  ) {
if (
Array.isArray(values) &&
      values.includes(char)
      values.includes(lastChar)
) {
result.add(from);
}
@@ -181,6 +178,10 @@ function allowedFirstChars(char) {
return [...result];
}

/* =========================================================
   연결
========================================================= */

function canConnect(
previousWord,
nextWord
@@ -191,18 +192,52 @@ function canConnect(
nextWord =
normalizeWord(nextWord);

  if (
    !previousWord ||
    !nextWord
  ) {
  if (!previousWord || !nextWord) {
return false;
}

  return allowedFirstChars(
    previousWord.at(-1)
  ).includes(
    nextWord.at(0)
  );
  const last =
    previousWord.at(-1);

  const first =
    nextWord.at(0);

  return allowedFirstChars(last)
    .includes(first);
}

/* =========================================================
   DOM 텍스트
========================================================= */

function setText(
  selectors,
  value
) {
  for (const selector of selectors) {
    const element =
      $(selector);

    if (element) {
      element.textContent =
        String(value ?? "");
    }
  }
}

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
@@ -216,61 +251,67 @@ function showMessage(
const text =
String(message ?? "");

  const targets = [
  const selectors = [
"#message",
"#status",
"#gameMessage",
".message",
".status"
];

  let found = false;
  let shown = false;

  for (const selector of targets) {
    const el = $(selector);
  for (const selector of selectors) {
    const element =
      $(selector);

    if (!el) {
    if (!element) {
continue;
}

    el.textContent = text;
    el.dataset.type = type;
    element.textContent =
      text;

    element.dataset.type =
      type;

    found = true;
    shown = true;
break;
}

  if (!found) {
  if (!shown) {
console.log(
`[${type}] ${text}`
);
}
}

/* =========================================================
   입력
   입력창
========================================================= */

function getWordInput() {
const selectors = [
"#wordInput",
"#inputWord",
"#word",
    "input[name='word']"
    "input[name='word']",
    "input[data-word-input]"
];

for (const selector of selectors) {
    const el = $(selector);
    const input =
      $(selector);

    if (el) {
      return el;
    if (input) {
      return input;
}
}

return null;
}

function clearInput() {
function clearWordInput() {
const input =
getWordInput();

@@ -281,12 +322,15 @@ function clearInput() {
input.value = "";

/*
   * Enter 이후에도 바로 다시 입력 가능
   * 브라우저가 disabled 상태를
   * 유지하지 않도록.
  */
  if (!input.disabled) {
    requestAnimationFrame(() => {
      input.focus();
    });
  if (
    !input.disabled
  ) {
    requestAnimationFrame(
      () => input.focus()
    );
}
}

@@ -298,29 +342,60 @@ function getNickname() {
const selectors = [
"#nickname",
"#nicknameInput",
    "input[name='nickname']"
    "input[name='nickname']",
    "input[data-nickname]"
];

for (const selector of selectors) {
    const el = $(selector);
    const element =
      $(selector);

    if (el) {
    if (element) {
return (
normalizeWord(
          el.value
        ) || "플레이어"
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
    "input[name='startChar']",
    "input[data-start-char]"
  ];

  for (const selector of selectors) {
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
  방 코드
========================================================= */

function getRoomIdInput() {
function getRoomCode() {
const selectors = [
"#roomIdInput",
"#roomCodeInput",
@@ -330,11 +405,12 @@ function getRoomIdInput() {
];

for (const selector of selectors) {
    const el = $(selector);
    const element =
      $(selector);

    if (el) {
    if (element) {
return String(
        el.value || ""
        element.value || ""
)
.trim()
.toUpperCase();
@@ -345,180 +421,133 @@ function getRoomIdInput() {
}

/* =========================================================
   설정
   플레이어 수
========================================================= */

function getNumber(
  selectors,
  fallback
) {
function getMaxPlayers() {
  const selectors = [
    "#maxPlayers",
    "#playerCountInput",
    "input[name='maxPlayers']"
  ];

for (const selector of selectors) {
    const el = $(selector);
    const element =
      $(selector);

    if (el) {
    if (element) {
const value =
        Number(el.value);
        Number(element.value);

if (
        Number.isFinite(value)
        Number.isFinite(value) &&
        value >= 2
) {
        return value;
        return Math.floor(value);
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
  /*
   * select가 있다면.
   */
  const select =
    $("#maxPlayersSelect");

  for (const selector of selectors) {
    const el = $(selector);
  if (select) {
    const value =
      Number(select.value);

    if (el) {
      return !!el.checked;
    if (
      Number.isFinite(value) &&
      value >= 2
    ) {
      return Math.floor(value);
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
  return 2;
}

/* =========================================================
   내 플레이어
   게임 모드
========================================================= */

function getMe() {
  return (
    state?.players?.find(
      player =>
        player.id === playerId
    ) || null
  );
}
function getGameMode() {
  const aiCheckbox =
    $("#aiMode");

function getCurrentPlayer() {
  return (
    state?.players?.find(
      player =>
        player.id ===
        state.turnPlayer
    ) || null
  );
}
  if (
    aiCheckbox &&
    aiCheckbox.checked
  ) {
    return "ai";
  }

function isMyTurn() {
  const me = getMe();
  const modeSelect =
    $("#gameMode");

  if (!me) {
    return false;
  if (
    modeSelect &&
    modeSelect.value === "ai"
  ) {
    return "ai";
}

  return (
    me.alive &&
    state &&
    state.started &&
    !state.finished &&
    state.turnPlayer ===
      playerId
  );
  const aiSelect =
    $("#modeSelect");

  if (
    aiSelect &&
    aiSelect.value === "ai"
  ) {
    return "ai";
  }

  return "online";
}

/* =========================================================
   UI 상태
   AI 레벨
========================================================= */

function updateInputState() {
  const input =
    getWordInput();
function getAILevel() {
  const selectors = [
    "#aiLevel",
    "#aiDifficulty",
    "select[name='aiLevel']"
  ];

  const me = getMe();
  for (const selector of selectors) {
    const element =
      $(selector);

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
    if (element) {
      const value =
        Number(element.value);

  if (input) {
    input.disabled =
      disabled;
      if (
        Number.isFinite(value)
      ) {
        return Math.min(
          5,
          Math.max(
            1,
            Math.floor(value)
          )
        );
      }
    }
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
  return 5;
}

/* =========================================================
   방 정보
   방 ID 표시
========================================================= */

function renderRoom() {
function renderRoomId() {
setText(
[
"#roomId",
@@ -527,157 +556,370 @@ function renderRoom() {
],
roomId || "-"
);
}

  if (!state) {
/* =========================================================
   플레이어 렌더링
========================================================= */

function renderPlayers() {
  if (!gameState) {
return;
}

  setText(
    [
      "#playerCount",
      "[data-player-count]"
    ],
    `${state.playerCount}/${state.maxPlayers}`
  );
  const players =
    gameState.players || [];

  const me =
    players.find(
      player =>
        player.playerIndex ===
        playerIndex
    );

  const me = getMe();
  const opponent =
    players.find(
      player =>
        player.playerIndex !==
        playerIndex
    );

setText(
[
"#myNickname",
"#playerName",
"[data-player-name]"
],
    me?.nickname || "-"
    me?.nickname ||
      myNickname
);
}

/* =========================================================
   플레이어
========================================================= */
  setText(
    [
      "#opponentNickname",
      "#enemyName",
      "[data-opponent-name]"
    ],
    opponent?.nickname ||
      "상대방 대기 중"
  );

function renderPlayers() {
  if (!state) {
    return;
  }
  setText(
    [
      "#playerCount",
      "[data-player-count]"
    ],
    `${players.length}/${gameState.maxPlayers || 2}`
  );

  /*
   * 플레이어 목록이 존재한다면
   * 2~N명을 전부 표시.
   */
const container =
    $("#players") ||
    $("#playerList") ||
    $("[data-players]");

  if (!container) {
    return;
  }
    $(
      "#playersList"
    ) ||
    $(
      "#playerList"
    ) ||
    $(
      "[data-player-list]"
    );

  container.innerHTML = "";
  if (container) {
    container.innerHTML = "";

    for (const player of players) {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "player-item";

      const hearts =
        "♥".repeat(
          Math.max(
            0,
            player.hearts ?? 0
          )
        ) +
        "♡".repeat(
          Math.max(
            0,
            2 -
              (player.hearts ?? 0)
          )
        );

      const status =
        player.eliminated
          ? "탈락"
          : player.connected
          ? "접속 중"
          : "연결 끊김";

      row.textContent =
        `${player.nickname} — ${hearts} — ${status}`;

  for (const player of state.players) {
    const row =
      document.createElement("div");
      if (
        player.playerIndex ===
        playerIndex
      ) {
        row.dataset.me =
          "true";
      }

    row.className =
      "player";
      if (
        player.playerIndex ===
        gameState.turnPlayer
      ) {
        row.dataset.turn =
          "true";
      }

    const hearts =
      "♥".repeat(
        Math.max(0, player.hearts)
      ) +
      "♡".repeat(
        Math.max(
          0,
          2 - player.hearts
        )
      container.appendChild(
        row
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
  }

    container.appendChild(row);
  /*
   * 내 하트 표시.
   */
  if (me) {
    renderHearts(
      me.hearts
    );
}
}

/* =========================================================
   단어
   하트
========================================================= */

function renderWord() {
function renderHearts(
  hearts
) {
  const value =
    Math.max(
      0,
      Number(hearts) || 0
    );

  const text =
    "♥".repeat(value) +
    "♡".repeat(
      Math.max(
        0,
        2 - value
      )
    );

setText(
[
      "#currentWord",
      "#lastWord",
      "#wordDisplay",
      "[data-current-word]"
      "#hearts",
      "#life",
      "#lives",
      "[data-hearts]"
],
    state?.currentWord || "-"
    text
);
}

  setText(
    [
      "#heartCount",
      "[data-heart-count]"
    ],
    value
  );
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
   타이머
   턴
========================================================= */

let timerInterval = null;
function isMyTurn() {
  if (!gameState) {
    return false;
  }

function renderTimer() {
  clearInterval(timerInterval);
  return (
    gameState.started &&
    !gameState.finished &&
    gameState.playerCount >= 2 &&
    gameState.turnPlayer ===
      playerIndex
  );
}

  const timerElements = [
    "#timer",
    "#timeLeft",
    "[data-timer]"
  ];
function renderTurn() {
  if (!gameState) {
    return;
  }

  function update() {
  if (gameState.finished) {
if (
      !state ||
      !state.turnExpiresAt ||
      state.finished
      gameState.winner ===
      playerIndex
) {
      setText(
        timerElements,
        "-"
      showMessage(
        "게임에서 승리했습니다.",
        "win"
      );
    } else if (
      gameState.winner !== null
    ) {
      showMessage(
        "게임에서 패배했습니다.",
        "lose"
);
      return;
}

    const remaining =
      Math.max(
        0,
        state.turnExpiresAt -
          Date.now()
      );
    return;
  }

  if (!gameState.started) {
    showMessage(
      "게임을 시작하는 중입니다.",
      "waiting"
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

    const seconds =
      Math.ceil(
        remaining / 1000
  if (isMyTurn()) {
    showMessage(
      "당신의 차례입니다.",
      "my-turn"
    );
  } else {
    const opponent =
      gameState.players?.find(
        player =>
          player.playerIndex ===
          gameState.turnPlayer
);

    showMessage(
      `${opponent?.nickname || "상대방"}의 차례입니다.`,
      "opponent-turn"
    );
  }
}

/* =========================================================
   카운트다운
========================================================= */

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(
      countdownTimer
    );

    countdownTimer = null;
  }
}

function renderCountdown() {
  stopCountdown();

  if (
    !gameState ||
    !gameState.turnEndsAt ||
    gameState.finished ||
    !gameState.started
  ) {
setText(
      timerElements,
      seconds
      [
        "#timer",
        "#countdown",
        "#timeLeft",
        "[data-timer]"
      ],
      "-"
);

    return;
}

  const update =
    () => {
      if (!gameState?.turnEndsAt) {
        stopCountdown();
        return;
      }

      const remaining =
        Math.max(
          0,
          gameState.turnEndsAt -
            Date.now()
        );

      const seconds =
        Math.ceil(
          remaining / 1000
        );

      setText(
        [
          "#timer",
          "#countdown",
          "#timeLeft",
          "[data-timer]"
        ],
        `${seconds}s`
      );

      if (
        remaining <= 0
      ) {
        stopCountdown();
      }
    };

update();

  timerInterval =
  countdownTimer =
setInterval(
update,
      100
      200
);
}

@@ -686,126 +928,184 @@ function renderTimer() {
========================================================= */

function renderHistory() {
  const history =
    gameState?.history || [];

  localUsedWords =
    new Set(
      history
        .filter(
          item =>
            item.word
        )
        .map(
          item =>
            item.word
        )
    );

const container =
    $("#history") ||
    $("#wordHistory") ||
    $("#gameHistory") ||
    $("[data-history]");
    $(
      "#history"
    ) ||
    $(
      "#wordHistory"
    ) ||
    $(
      "#gameHistory"
    ) ||
    $(
      "[data-history]"
    );

  if (!container || !state) {
  if (!container) {
return;
}

container.innerHTML = "";

  for (const item of state.history) {
  for (const item of history) {
const row =
      document.createElement("div");
      document.createElement(
        "div"
      );

row.className =
"history-item";

    let playerName =
      "시작 단어";

    if (
      item.player >= 0
    ) {
      playerName =
        gameState.players?.find(
          player =>
            player.playerIndex ===
            item.player
        )?.nickname ||
        `플레이어 ${item.player + 1}`;
    }

const depth =
item.depth !== null &&
item.depth !== undefined
        ? ` [${item.depth}]`
        ? ` (깊이 ${item.depth})`
: "";

row.textContent =
      `${item.nickname}: ${item.word}${depth}`;
      item.turn === 0
        ? `시작: ${item.word}`
        : `${item.turn}. ${playerName}: ${item.word}${depth}`;

    container.appendChild(row);
    container.appendChild(
      row
    );
}

container.scrollTop =
container.scrollHeight;
}

/* =========================================================
   턴
   두음 정보
========================================================= */

function renderTurn() {
  if (!state) {
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

  if (state.finished) {
    const winner =
      state.players?.find(
        p =>
          p.id === state.winner
      );
  const last =
    gameState.currentWord.at(-1);

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
  const allowed =
    allowedFirstChars(last);

    return;
  }
  setText(
    [
      "#allowedChars",
      "#nextChars",
      "[data-allowed-chars]"
    ],
    allowed.join(", ")
  );
}

  if (!state.started) {
    showMessage(
      "게임 시작을 기다리는 중입니다.",
      "waiting"
    );
/* =========================================================
   입력 상태
========================================================= */

    return;
  }
function updateInputState() {
  const input =
    getWordInput();

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
  const disabled =
    !socketConnected ||
    !roomId ||
    !gameState ||
    !gameState.started ||
    gameState.finished ||
    gameState.playerCount < 2 ||
    !isMyTurn() ||
    isSubmitting;

    showMessage(
      `${current?.nickname || "상대방"}의 차례입니다.`,
      "opponent-turn"
    );
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
   전체 렌더
   전체 상태
========================================================= */

function renderState(newState) {
  if (!newState) {
function renderGameState(
  state
) {
  if (!state) {
return;
}

  state = newState;
  gameState =
    state;

if (state.roomId) {
roomId =
state.roomId;
}

  renderRoom();
  renderRoomId();
renderPlayers();
  renderWord();
  renderHistory();
  renderCurrentWord();
renderTurn();
  renderTimer();

  renderHistory();
  renderDueumInfo();
  renderCountdown();
updateInputState();
}

@@ -814,44 +1114,79 @@ function renderState(newState) {
========================================================= */

function createRoom() {
  if (!connected) {
  if (!socket) {
showMessage(
      "서버에 연결하는 중입니다.",
      "Socket.IO를 불러오지 못했습니다.",
"error"
);

    return;
  }

  if (!socketConnected) {
    showMessage(
      "서버에 연결하는 중입니다.",
      "waiting"
    );

return;
}

  /*
   * 기존 방이 있다면 먼저 나가지 않고
   * 서버가 안전하게 기존 방을 정리.
   */
  myNickname =
    getNickname();

socket.emit(
"room:create",
{
nickname:
        getNickname(),
        myNickname,

      maxPlayers:
        getMaxPlayers(),
      startChar:
        getStartChar(),

      turnTime:
        getTurnTime(),
      mode:
        getGameMode(),

      aiEnabled:
        getAIEnabled(),
      maxPlayers:
        getMaxPlayers(),

aiLevel:
getAILevel()
}
);

  showMessage(
    "방을 생성하는 중...",
    "waiting"
  );
}

/* =========================================================
  방 입장
========================================================= */

function joinRoom() {
  const id =
    getRoomIdInput();
  if (!socket) {
    return;
  }

  if (!socketConnected) {
    showMessage(
      "서버에 연결하는 중입니다.",
      "waiting"
    );

  if (!id) {
    return;
  }

  const code =
    getRoomCode();

  if (!code) {
showMessage(
"방 코드를 입력해주세요.",
"error"
@@ -860,15 +1195,24 @@ function joinRoom() {
return;
}

  myNickname =
    getNickname();

socket.emit(
"room:join",
{
      roomId: id,
      roomId:
        code,

nickname:
        getNickname()
        myNickname
}
);

  showMessage(
    "방에 입장하는 중...",
    "waiting"
  );
}

/* =========================================================
@@ -877,30 +1221,63 @@ function joinRoom() {

function submitWord() {
/*
   * 중복 Enter 방지
   * 이 함수 하나만 실제 제출 담당.
  */
  if (submitting) {
  if (!socket) {
return;
}

  if (!connected) {
  if (isSubmitting) {
    return;
  }

  if (!socketConnected) {
showMessage(
      "서버와 연결되지 않았습니다.",
      "서버에 연결되어 있지 않습니다.",
"error"
);

return;
}

  if (!roomId || !state) {
  if (!roomId) {
showMessage(
      "먼저 게임에 참가해주세요.",
      "먼저 방에 들어가주세요.",
"error"
);

return;
}

  if (!gameState) {
    showMessage(
      "게임 상태를 불러오는 중입니다.",
      "waiting"
    );

    return;
  }

  if (!gameState.started) {
    showMessage(
      "게임이 아직 시작되지 않았습니다.",
      "waiting"
    );

    return;
  }

  if (
    gameState.finished
  ) {
    showMessage(
      "게임이 끝났습니다.",
      "info"
    );

    return;
  }

if (!isMyTurn()) {
showMessage(
"지금은 당신의 차례가 아닙니다.",
@@ -939,19 +1316,11 @@ function submitWord() {
}

/*
   * 클라이언트 빠른 검증
   *
   * 서버 검증이 최종 판정
   * 중복은 클라이언트에서 먼저 검사.
  */
  const used =
    new Set(
      (state.history || [])
        .map(
          item => item.word
        )
    );

  if (used.has(word)) {
  if (
    localUsedWords.has(word)
  ) {
showMessage(
"이미 사용한 단어입니다.",
"error"
@@ -960,26 +1329,35 @@ function submitWord() {
return;
}

  /*
   * 연결도 클라이언트에서 빠르게 검사.
   *
   * 최종 판정은 서버.
   */
if (
    state.currentWord &&
    gameState.currentWord &&
!canConnect(
      state.currentWord,
      gameState.currentWord,
word
)
) {
    const last =
      gameState.currentWord.at(-1);

showMessage(
      `"${state.currentWord.at(-1)}" 다음에 연결할 수 없습니다.`,
      `"${last}" 다음에 연결할 수 없는 단어입니다.`,
"error"
);

return;
}

/*
   * 여기서 잠깐 잠그지만
   * 서버 응답이 오면 무조건 풀린다.
   * 첫 제출부터 버튼이 여러 번 눌려도
   * 하나만 서버로 보냄.
  */
  submitting = true;
  isSubmitting =
    true;

updateInputState();

@@ -996,7 +1374,20 @@ function submitWord() {
========================================================= */

function restartGame() {
  if (!roomId) {
  if (!socket) {
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
@@ -1005,16 +1396,34 @@ function restartGame() {
return;
}

  isSubmitting =
    false;

  updateInputState();

socket.emit(
    "game:restart"
    "game:restart",
    {
      startChar:
        getStartChar()
    }
  );

  showMessage(
    "새 게임을 시작하는 중...",
    "waiting"
);
}

/* =========================================================
   나가기
   방 나가기
========================================================= */

function leaveRoom() {
  if (!socket) {
    return;
  }

if (!roomId) {
return;
}
@@ -1023,526 +1432,899 @@ function leaveRoom() {
"room:leave"
);

  roomId = null;
  playerId = null;
  state = null;
  stopCountdown();

  submitting = false;
  roomId =
    null;

  clearInterval(
    timerInterval
  );
  playerIndex =
    null;

  gameState =
    null;

  localUsedWords =
    new Set();

  isSubmitting =
    false;

  renderRoom();
  renderRoomId();
updateInputState();

showMessage(
    "방에서 나왔습니다.",
    "방에서 나가는 중...",
"info"
);
}

/* =========================================================
   Socket.IO
   상태 요청
========================================================= */

socket.on(
  "connect",
  () => {
    connected = true;
function requestRoomState() {
  if (
    socket &&
    roomId
  ) {
    socket.emit(
      "room:state"
    );
  }
}

    submitting = false;
/* =========================================================
   재접속 요청
========================================================= */

    console.log(
      "[Socket.IO] connected",
      socket.id
    );
function requestReconnect() {
  if (
    !socket ||
    !socketConnected ||
    !roomId ||
    playerIndex === null
  ) {
    return;
  }

    showMessage(
      "서버에 연결되었습니다.",
      "success"
    );
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

if (socket) {
  socket.on(
    "connect",
    () => {
      socketConnected =
        true;

    /*
     * 재접속 시 방 상태 요청
     */
    if (roomId) {
      socket.emit(
        "room:state"
      reconnecting =
        false;

      console.log(
        "[Socket.IO] 연결:",
        socket.id
);

      showMessage(
        "서버에 연결되었습니다.",
        "success"
      );

      /*
       * 새 Socket ID로 연결된 경우
       * 기존 방 재접속.
       */
      if (
        roomId &&
        playerIndex !== null
      ) {
        requestReconnect();
      }

      updateInputState();
}
  );

    updateInputState();
  }
);
  /* =======================================================
     연결 종료
  ======================================================= */

socket.on(
  "disconnect",
  reason => {
    connected = false;
  socket.on(
    "disconnect",
    reason => {
      socketConnected =
        false;

    submitting = false;
      isSubmitting =
        false;

    console.warn(
      "[Socket.IO] disconnected",
      reason
    );
      reconnecting =
        true;

    showMessage(
      "서버와 연결이 끊어졌습니다.",
      "error"
    );
      stopCountdown();

    updateInputState();
  }
);
      updateInputState();

/* =========================================================
   서버 준비
========================================================= */
      console.warn(
        "[Socket.IO] 연결 종료:",
        reason
      );

socket.on(
  "server:ready",
  data => {
    console.log(
      "[server:ready]",
      data
    );
  }
);
      showMessage(
        "서버와 연결이 끊어졌습니다. 재접속 중...",
        "error"
      );
    }
  );

/* =========================================================
   방 생성
========================================================= */
  /* =======================================================
     서버 준비
  ======================================================= */

socket.on(
  "room:created",
  data => {
    if (!data?.ok) {
      return;
  socket.on(
    "server:ready",
    data => {
      console.log(
        "[server:ready]",
        data
      );

      setText(
        [
          "#serverWordCount",
          "[data-server-words]"
        ],
        Number(
          data?.words || 0
        ).toLocaleString()
      );

      setText(
        [
          "#serverAttackCount",
          "[data-server-attacks]"
        ],
        Number(
          data?.attackWords || 0
        ).toLocaleString()
      );
}
  );

    roomId =
      data.roomId;
  /* =======================================================
     방 생성
  ======================================================= */

    playerId =
      data.state?.players?.find(
        p =>
          !p.isAI &&
          p.playerIndex === 0
      )?.id || socket.id;
  socket.on(
    "room:created",
    data => {
      if (!data?.ok) {
        return;
      }

    submitting = false;
      roomId =
        data.roomId;

    renderState(
      data.state
    );
      playerIndex =
        data.playerIndex;

    showMessage(
      `방이 생성되었습니다. 코드: ${roomId}`,
      "success"
    );
  }
);
      gameState =
        data.state;

/* =========================================================
   방 입장
========================================================= */
      isSubmitting =
        false;

socket.on(
  "room:joined",
  data => {
    if (!data?.ok) {
      return;
      renderGameState(
        gameState
      );

      showMessage(
        `방 생성 완료: ${roomId}`,
        "success"
      );

      console.log(
        "[room:created]",
        data
      );
}
  );

    roomId =
      data.roomId;
  /* =======================================================
     방 입장
  ======================================================= */

    playerId =
      data.playerId;
  socket.on(
    "room:joined",
    data => {
      if (!data?.ok) {
        return;
      }

    submitting = false;
      roomId =
        data.roomId;

    renderState(
      data.state
    );
      playerIndex =
        data.playerIndex;

    showMessage(
      "방에 입장했습니다.",
      "success"
    );
  }
);
      gameState =
        data.state;

/* =========================================================
   상대 입장
========================================================= */
      isSubmitting =
        false;

      renderGameState(
        gameState
      );

socket.on(
  "room:ready",
  data => {
    submitting = false;
      showMessage(
        data.reconnect
          ? "방에 재접속했습니다."
          : "방에 입장했습니다.",
        "success"
      );

    if (data?.state) {
      renderState(
        data.state
      console.log(
        "[room:joined]",
        data
);
}
  );

    showMessage(
      "플레이어가 입장했습니다.",
      "success"
    );
  }
);
  /* =======================================================
     재접속 완료
  ======================================================= */

/* =========================================================
   방 오류
========================================================= */
  socket.on(
    "room:reconnected",
    data => {
      if (!data?.ok) {
        return;
      }

socket.on(
  "room:error",
  data => {
    submitting = false;
      roomId =
        data.roomId;

    showMessage(
      data?.reason ||
        "방 처리 중 오류",
      "error"
    );
      playerIndex =
        data.playerIndex;

    updateInputState();
  }
);
      gameState =
        data.state;

/* =========================================================
   게임 상태
========================================================= */
      isSubmitting =
        false;

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
      renderGameState(
        gameState
      );

/* =========================================================
   게임 시작
========================================================= */
      showMessage(
        "게임에 재접속했습니다.",
        "success"
      );
    }
  );

  /* =======================================================
     다른 플레이어 입장
  ======================================================= */

  socket.on(
    "room:playerJoined",
    data => {
      if (data?.state) {
        renderGameState(
          data.state
        );
      }
    }
  );

socket.on(
  "game:started",
  data => {
    submitting = false;
  /* =======================================================
     방 오류
  ======================================================= */

    if (data?.state) {
      renderState(
        data.state
  socket.on(
    "room:error",
    data => {
      isSubmitting =
        false;

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
  /* =======================================================
     게임 상태
  ======================================================= */

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

    showMessage(
      "새 게임이 시작되었습니다.",
      "success"
    );
  /* =======================================================
     게임 시작
  ======================================================= */

    updateInputState();
  }
);
  socket.on(
    "game:started",
    data => {
      isSubmitting =
        false;

/* =========================================================
   단어 성공
========================================================= */
      if (data?.state) {
        renderGameState(
          data.state
        );
      }

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

socket.on(
  "game:word",
  data => {
    submitting = false;
      showMessage(
        `게임 시작! 시작 단어: ${data?.startWord || gameState?.currentWord || "-"}`,
        "success"
      );

    if (!data?.ok) {
updateInputState();
      return;
    }

    if (
      data.playerId ===
      playerId
    ) {
      clearInput();
      console.log(
        "[game:started]",
        data
      );
}
  );

    /*
     * 실제 상태는 바로 뒤의 game:state로 동기화
     */
    updateInputState();
  }
);
  /* =======================================================
     단어 성공
  ======================================================= */

/* =========================================================
   단어 오류
========================================================= */

socket.on(
  "game:error",
  data => {
    submitting = false;
  socket.on(
    "game:word",
    data => {
      if (!data?.ok) {
        return;
      }

    showMessage(
      data?.reason ||
        "단어 입력에 실패했습니다.",
      "error"
    );
      isSubmitting =
        false;

    /*
     * 서버가 상태를 다시 보내기 때문에
     * 입력 잠금이 풀린다.
     */
    updateInputState();
  }
);
      if (data.word) {
        localUsedWords.add(
          normalizeWord(
            data.word
          )
        );
      }

/* =========================================================
   하트 감소
========================================================= */
      /*
       * 내가 성공적으로 입력했을 때만
       * 입력창 비우기.
       */
      if (
        data.player ===
        playerIndex
      ) {
        clearWordInput();
      }

socket.on(
  "player:heartLost",
  data => {
    console.log(
      "[heart lost]",
      data
    );
      updateInputState();

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
      console.log(
        "[game:word]",
        data
);
}
  }
);
  );

/* =========================================================
   탈락
========================================================= */
  /* =======================================================
     단어 오류
  ======================================================= */

  socket.on(
    "game:error",
    data => {
      isSubmitting =
        false;

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
        data?.reason ||
          "단어 입력에 실패했습니다.",
        "error"
);
    } else {
      showMessage(
        `${data.nickname}님이 탈락했습니다.`,
        "info"

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

      if (
        data?.hearts !==
        undefined
      ) {
        renderHearts(
          data.hearts
        );
      }

      updateInputState();

      console.warn(
        "[game:error]",
        data
);
}
  }
);
  );

/* =========================================================
   게임 종료
========================================================= */
  /* =======================================================
     실수
  ======================================================= */

socket.on(
  "game:finished",
  data => {
    submitting = false;
  socket.on(
    "game:mistake",
    data => {
      if (
        data?.player ===
        playerIndex
      ) {
        renderHearts(
          data.hearts
        );

        showMessage(
          `${data.reason || "잘못된 입력"} 하트 ${data.hearts}개 남음`,
          "error"
        );
      }

    if (data?.state) {
      renderState(
        data.state
      );
      if (gameState) {
        requestRoomState();
      }
}
  );

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
  /* =======================================================
     시간 초과
  ======================================================= */

  socket.on(
    "game:timeout",
    data => {
      if (
        data?.player ===
        playerIndex
      ) {
        renderHearts(
          data.hearts
        );

        showMessage(
          `시간 초과! 하트 ${data.hearts}개 남음`,
          "error"
        );
      } else {
        const player =
          gameState?.players?.find(
            p =>
              p.playerIndex ===
              data?.player
          );

        showMessage(
          `${player?.nickname || "플레이어"}의 시간이 초과되었습니다.`,
          "info"
        );
      }

      requestRoomState();
    }
  );

  /* =======================================================
     게임 종료
  ======================================================= */

  socket.on(
    "game:finished",
    data => {
      isSubmitting =
        false;

      stopCountdown();

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

    updateInputState();
  }
);
  /* =======================================================
     상대방 나감
  ======================================================= */

/* =========================================================
   상대방 퇴장
========================================================= */
  socket.on(
    "room:playerLeft",
    data => {
      isSubmitting =
        false;

socket.on(
  "room:playerLeft",
  data => {
    submitting = false;
      if (data?.state) {
        renderGameState(
          data.state
        );
      }

    if (data?.state) {
      renderState(
        data.state
      showMessage(
        data?.reason ||
          "플레이어가 방을 나갔습니다.",
        "error"
);

      updateInputState();
}
  );

  /* =======================================================
     상대방 연결 끊김
  ======================================================= */

  socket.on(
    "room:playerDisconnected",
    data => {
      if (data?.state) {
        renderGameState(
          data.state
        );
      }

      const player =
        gameState?.players?.find(
          p =>
            p.playerIndex ===
            data?.playerIndex
        );

    if (data?.nickname) {
showMessage(
        `${data.nickname}님이 방을 나갔습니다.`,
        `${player?.nickname || "플레이어"}의 연결이 끊겼습니다. 재접속을 기다리는 중...`,
"error"
);

      updateInputState();
}
  );

    updateInputState();
  }
);
  /* =======================================================
     방 나가기 완료
  ======================================================= */

  socket.on(
    "room:left",
    data => {
      stopCountdown();

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

      if (data?.ok) {
        showMessage(
          "방에서 나왔습니다.",
          "info"
        );
      }
    }
  );
}

/* =========================================================
   클릭 바인딩
   클릭 이벤트
========================================================= */

function bindClick(
selectors,
handler
) {
for (const selector of selectors) {
    for (const element of $all(selector)) {
    for (
      const element
      of $all(selector)
    ) {
      /*
       * 중복 바인딩 방지.
       */
      if (
        element.dataset.wordgameBound ===
        "true"
      ) {
        continue;
      }

      element.dataset.wordgameBound =
        "true";

element.addEventListener(
"click",
event => {
event.preventDefault();
          event.stopPropagation();

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
   DOM 준비 후 이벤트 등록
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    const input =
      getWordInput();
function bindAllEvents() {
  bindClick(
    [
      "#createRoom",
      "#createRoomButton",
      "#roomCreate",
      "[data-action='create-room']"
    ],
    createRoom
  );

    if (
      !input ||
      event.target !== input
    ) {
      return;
    }
  bindClick(
    [
      "#joinRoom",
      "#joinRoomButton",
      "#roomJoin",
      "[data-action='join-room']"
    ],
    joinRoom
  );

    if (
      event.key === "Enter"
    ) {
      event.preventDefault();
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

      /*
       * disabled 상태가 아니면 무조건 제출
       */
      if (!input.disabled) {
        submitWord();
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

  bindClick(
    [
      "#refreshRoom",
      "#refreshState",
      "[data-action='refresh-room']"
    ],
    requestRoomState
  );

  /*
   * AI 모드 버튼이 따로 있는 경우.
   */
  bindClick(
    [
      "#startAI",
      "#aiStart",
      "[data-action='start-ai']"
    ],
    () => {
      const mode =
        $("#gameMode");

      if (mode) {
        mode.value =
          "ai";
}

      createRoom();
}
  );
}

/* =========================================================
   Enter 입력
========================================================= */

function bindInputEvents() {
  const input =
    getWordInput();

  if (!input) {
    return;
}
);

  if (
    input.dataset.wordgameEnterBound ===
    "true"
  ) {
    return;
  }

  input.dataset.wordgameEnterBound =
    "true";

  input.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Enter"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      submitWord();
    }
  );
}

/* =========================================================
   전체 초기화
========================================================= */

function initializeClient() {
  bindAllEvents();
  bindInputEvents();

  updateInputState();
  renderRoomId();

  console.log(
    "========================================"
  );

  console.log(
    "client/script.js 로드 완료"
  );

  console.log(
    "Socket.IO 이벤트 연결 완료"
  );

  console.log(
    "끝말잇기 멀티플레이 클라이언트 준비 완료"
  );

  console.log(
    "========================================"
  );
}

/* =========================================================
   전역 함수
   DOMContentLoaded
========================================================= */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeClient,
    {
      once: true
    }
  );
} else {
  initializeClient();
}

/* =========================================================
   전역 API
========================================================= */

window.createRoom =
@@ -1560,6 +2342,9 @@ window.restartGame =
window.leaveRoom =
leaveRoom;

window.requestRoomState =
  requestRoomState;

window.canConnect =
canConnect;

@@ -1569,15 +2354,5 @@ window.allowedFirstChars =
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
window.requestReconnect =
  requestReconnect;
