"use strict";

/* =========================================================
   끝말잇기 client/script.js
   server/server.js와 이벤트 1:1 대응
========================================================= */

/* =========================================================
   Socket.IO
========================================================= */

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

let myNickname =
  "플레이어";

let localUsedWords =
  new Set();

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
   연결
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
   메시지
========================================================= */

function showMessage(
  message,
  type = "info"
) {
  const text =
    String(message ?? "");

  const selectors = [
    "#message",
    "#status",
    "#gameMessage",
    ".message",
    ".status"
  ];

  let shown = false;

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

    shown = true;
    break;
  }

  if (!shown) {
    console.log(
      `[${type}] ${text}`
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
    "input[name='word']",
    "input[data-word-input]"
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

  /*
   * 브라우저가 disabled 상태를
   * 유지하지 않도록.
   */
  if (
    !input.disabled
  ) {
    requestAnimationFrame(
      () => input.focus()
    );
  }
}

/* =========================================================
   닉네임
========================================================= */

function getNickname() {
  const selectors = [
    "#nickname",
    "#nicknameInput",
    "input[name='nickname']",
    "input[data-nickname]"
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
   플레이어 수
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
        Number.isFinite(value) &&
        value >= 2
      ) {
        return Math.floor(value);
      }
    }
  }

  /*
   * select가 있다면.
   */
  const select =
    $("#maxPlayersSelect");

  if (select) {
    const value =
      Number(select.value);

    if (
      Number.isFinite(value) &&
      value >= 2
    ) {
      return Math.floor(value);
    }
  }

  return 2;
}

/* =========================================================
   게임 모드
========================================================= */

function getGameMode() {
  const aiCheckbox =
    $("#aiMode");

  if (
    aiCheckbox &&
    aiCheckbox.checked
  ) {
    return "ai";
  }

  const modeSelect =
    $("#gameMode");

  if (
    modeSelect &&
    modeSelect.value === "ai"
  ) {
    return "ai";
  }

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
   AI 레벨
========================================================= */

function getAILevel() {
  const selectors = [
    "#aiLevel",
    "#aiDifficulty",
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

  return 5;
}

/* =========================================================
   방 ID 표시
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
   플레이어 렌더링
========================================================= */

function renderPlayers() {
  if (!gameState) {
    return;
  }

  const players =
    gameState.players || [];

  const me =
    players.find(
      player =>
        player.playerIndex ===
        playerIndex
    );

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
    me?.nickname ||
      myNickname
  );

  setText(
    [
      "#opponentNickname",
      "#enemyName",
      "[data-opponent-name]"
    ],
    opponent?.nickname ||
      "상대방 대기 중"
  );

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
    $(
      "#playersList"
    ) ||
    $(
      "#playerList"
    ) ||
    $(
      "[data-player-list]"
    );

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

      if (
        player.playerIndex ===
        playerIndex
      ) {
        row.dataset.me =
          "true";
      }

      if (
        player.playerIndex ===
        gameState.turnPlayer
      ) {
        row.dataset.turn =
          "true";
      }

      container.appendChild(
        row
      );
    }
  }

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
   하트
========================================================= */

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
      "#hearts",
      "#life",
      "#lives",
      "[data-hearts]"
    ],
    text
  );

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
   턴
========================================================= */

function isMyTurn() {
  if (!gameState) {
    return false;
  }

  return (
    gameState.started &&
    !gameState.finished &&
    gameState.playerCount >= 2 &&
    gameState.turnPlayer ===
      playerIndex
  );
}

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
    } else if (
      gameState.winner !== null
    ) {
      showMessage(
        "게임에서 패배했습니다.",
        "lose"
      );
    }

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

  countdownTimer =
    setInterval(
      update,
      200
    );
}

/* =========================================================
   기록
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
        ? ` (깊이 ${item.depth})`
        : "";

    row.textContent =
      item.turn === 0
        ? `시작: ${item.word}`
        : `${item.turn}. ${playerName}: ${item.word}${depth}`;

    container.appendChild(
      row
    );
  }

  container.scrollTop =
    container.scrollHeight;
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
   입력 상태
========================================================= */

function updateInputState() {
  const input =
    getWordInput();

  const disabled =
    !socketConnected ||
    !roomId ||
    !gameState ||
    !gameState.started ||
    gameState.finished ||
    gameState.playerCount < 2 ||
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
  renderCountdown();
  updateInputState();
}

/* =========================================================
   방 생성
========================================================= */

function createRoom() {
  if (!socket) {
    showMessage(
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
        myNickname,

      startChar:
        getStartChar(),

      mode:
        getGameMode(),

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
  if (!socket) {
    return;
  }

  if (!socketConnected) {
    showMessage(
      "서버에 연결하는 중입니다.",
      "waiting"
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
    "방에 입장하는 중...",
    "waiting"
  );
}

/* =========================================================
   단어 제출
========================================================= */

function submitWord() {
  /*
   * 이 함수 하나만 실제 제출 담당.
   */
  if (!socket) {
    return;
  }

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
   * 중복은 클라이언트에서 먼저 검사.
   */
  if (
    localUsedWords.has(word)
  ) {
    showMessage(
      "이미 사용한 단어입니다.",
      "error"
    );

    return;
  }

  /*
   * 연결도 클라이언트에서 빠르게 검사.
   *
   * 최종 판정은 서버.
   */
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
   * 첫 제출부터 버튼이 여러 번 눌려도
   * 하나만 서버로 보냄.
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
   새 게임
========================================================= */

function restartGame() {
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
    );

    return;
  }

  isSubmitting =
    false;

  updateInputState();

  socket.emit(
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
   방 나가기
========================================================= */

function leaveRoom() {
  if (!socket) {
    return;
  }

  if (!roomId) {
    return;
  }

  socket.emit(
    "room:leave"
  );

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

  showMessage(
    "방에서 나가는 중...",
    "info"
  );
}

/* =========================================================
   상태 요청
========================================================= */

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

/* =========================================================
   재접속 요청
========================================================= */

function requestReconnect() {
  if (
    !socket ||
    !socketConnected ||
    !roomId ||
    playerIndex === null
  ) {
    return;
  }

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

  /* =======================================================
     연결 종료
  ======================================================= */

  socket.on(
    "disconnect",
    reason => {
      socketConnected =
        false;

      isSubmitting =
        false;

      reconnecting =
        true;

      stopCountdown();

      updateInputState();

      console.warn(
        "[Socket.IO] 연결 종료:",
        reason
      );

      showMessage(
        "서버와 연결이 끊어졌습니다. 재접속 중...",
        "error"
      );
    }
  );

  /* =======================================================
     서버 준비
  ======================================================= */

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

  /* =======================================================
     방 생성
  ======================================================= */

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

      isSubmitting =
        false;

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

  /* =======================================================
     방 입장
  ======================================================= */

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

      isSubmitting =
        false;

      renderGameState(
        gameState
      );

      showMessage(
        data.reconnect
          ? "방에 재접속했습니다."
          : "방에 입장했습니다.",
        "success"
      );

      console.log(
        "[room:joined]",
        data
      );
    }
  );

  /* =======================================================
     재접속 완료
  ======================================================= */

  socket.on(
    "room:reconnected",
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

      isSubmitting =
        false;

      renderGameState(
        gameState
      );

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

  /* =======================================================
     방 오류
  ======================================================= */

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

  /* =======================================================
     게임 시작
  ======================================================= */

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
        `게임 시작! 시작 단어: ${data?.startWord || gameState?.currentWord || "-"}`,
        "success"
      );

      updateInputState();

      console.log(
        "[game:started]",
        data
      );
    }
  );

  /* =======================================================
     단어 성공
  ======================================================= */

  socket.on(
    "game:word",
    data => {
      if (!data?.ok) {
        return;
      }

      isSubmitting =
        false;

      if (data.word) {
        localUsedWords.add(
          normalizeWord(
            data.word
          )
        );
      }

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

      updateInputState();

      console.log(
        "[game:word]",
        data
      );
    }
  );

  /* =======================================================
     단어 오류
  ======================================================= */

  socket.on(
    "game:error",
    data => {
      isSubmitting =
        false;

      showMessage(
        data?.reason ||
          "단어 입력에 실패했습니다.",
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
  );

  /* =======================================================
     실수
  ======================================================= */

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

      if (gameState) {
        requestRoomState();
      }
    }
  );

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

  /* =======================================================
     상대방 나감
  ======================================================= */

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

      showMessage(
        `${player?.nickname || "플레이어"}의 연결이 끊겼습니다. 재접속을 기다리는 중...`,
        "error"
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

/* =========================================================
   DOM 준비 후 이벤트 등록
========================================================= */

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

window.requestReconnect =
  requestReconnect;
