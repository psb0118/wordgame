# script.js

```js
"use strict";


/* =========================================================
   DOM
========================================================= */

const $ = id =>
  document.getElementById(id);


/* =========================================================
   상태
========================================================= */

let data = null;

let used = new Set();

let current = "";

let startChar = "";

let turn = 0;

let over = false;


/*
 * 싱글:
 *
 * 0 = 플레이어 1
 * 1 = 플레이어 2
 */

let singlePlayer = 0;


/*
 * 온라인
 */

let socket = null;

let myId = null;

let myPlayerIndex = -1;

let onlineStarted = false;

let onlineTurn = -1;

let onlineLast = "";

let onlineStartChar = "";


/* =========================================================
   통계
========================================================= */

/*
 * 기존 AI 통계는 제거.
 *
 * 대신 싱글플레이에서
 * 플레이어 1 / 플레이어 2 승리 횟수를 기록한다.
 */

let player1Wins = 0;

let player2Wins = 0;

let totalGames = 0;

let totalTurns = 0;


/* =========================================================
   두음법칙
========================================================= */

let DUEUM = {};


function allowedFirstChars(lastChar) {
  if (!lastChar) {
    return [];
  }

  const result =
    new Set();

  result.add(lastChar);


  const alternatives =
    DUEUM[lastChar];


  if (Array.isArray(alternatives)) {
    for (const char of alternatives) {
      result.add(char);
    }
  }


  /*
   * 역방향
   */
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


  return [
    ...result
  ];
}


function canConnect(
  previousWord,
  nextWord
) {
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
   단어 검사
========================================================= */

function hasWord(word) {
  return !!(
    data &&
    data.wordSet &&
    data.wordSet.has(word)
  );
}


/* =========================================================
   후보
========================================================= */

function candidates(
  lastChar,
  usedSet = used
) {
  if (!data || !lastChar) {
    return [];
  }

  const result = [];

  const firstChars =
    allowedFirstChars(
      lastChar
    );


  for (
    const first
    of firstChars
  ) {

    const list =
      data.byFirst[first] ||
      [];


    for (
      const word
      of list
    ) {

      if (
        usedSet.has(word)
      ) {
        continue;
      }

      result.push(word);
    }
  }


  return result;
}


/* =========================================================
   첫 단어 선택
========================================================= */

function getRandomStartWord() {
  if (!data) {
    return null;
  }

  /*
   * 기존 startFirst를 우선 사용.
   */
  const firstChars =
    Array.isArray(
      data.startFirst
    ) &&
    data.startFirst.length
      ? data.startFirst
      : Object.keys(
          data.byFirst
        );


  const shuffled =
    [...firstChars];


  for (
    let i = shuffled.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );

    [
      shuffled[i],
      shuffled[j]
    ] = [
      shuffled[j],
      shuffled[i]
    ];
  }


  for (
    const first
    of shuffled
  ) {

    const list =
      data.byFirst[first] ||
      [];


    if (!list.length) {
      continue;
    }


    /*
     * 시작 단어는 실제 word.txt에 존재하면
     * 사용 가능.
     */
    const word =
      list[
        Math.floor(
          Math.random() *
          list.length
        )
      ];


    if (word) {
      return word;
    }
  }


  return null;
}


/* =========================================================
   HTML 정리
========================================================= */

function hideAiUI() {

  const difficulty =
    $("difficulty");

  if (difficulty) {
    const label =
      difficulty.closest(
        "label"
      );

    if (label) {
      label.style.display =
        "none";
    }
  }


  const depth =
    $("depth");

  if (depth) {
    const parent =
      depth.closest("b");

    if (parent) {
      parent.style.display =
        "none";
    }
  }


  const winrate =
    $("winrate");

  if (winrate) {
    const parent =
      winrate.closest("b");

    if (parent) {
      parent.style.display =
        "none";
    }
  }


  const wins =
    $("wins");

  if (wins) {
    const card =
      wins.closest(".cards > div");

    if (card) {
      card.innerHTML =
        '플레이어 1 승리<strong id="wins">0</strong>';
    }
  }


  const losses =
    $("losses");

  if (losses) {
    const card =
      losses.closest(".cards > div");

    if (card) {
      card.innerHTML =
        '플레이어 2 승리<strong id="losses">0</strong>';
    }
  }


  const header =
    document.querySelector(
      "header p"
    );

  if (header) {
    header.textContent =
      "끄글 단어 목록 기반 · 2인 끝말잇기 · 온라인 2인";
  }
}


/* =========================================================
   통계
========================================================= */

function saveStats() {
  localStorage.kkeulStats =
    JSON.stringify({
      player1Wins,
      player2Wins,
      totalGames,
      totalTurns
    });
}


function loadStats() {

  try {

    const raw =
      localStorage.kkeulStats;

    if (!raw) {
      return;
    }

    const saved =
      JSON.parse(raw);


    player1Wins =
      Number(
        saved.player1Wins || 0
      );

    player2Wins =
      Number(
        saved.player2Wins || 0
      );

    totalGames =
      Number(
        saved.totalGames || 0
      );

    totalTurns =
      Number(
        saved.totalTurns || 0
      );

  } catch {
    /*
     * 저장 데이터가 깨졌으면
     * 새 통계로 시작
     */
  }
}


function updateStats() {

  const wins =
    $("wins");

  const losses =
    $("losses");

  const games =
    $("games");

  const avg =
    $("avg");


  if (wins) {
    wins.textContent =
      player1Wins;
  }

  if (losses) {
    losses.textContent =
      player2Wins;
  }

  if (games) {
    games.textContent =
      totalGames;
  }

  if (avg) {

    avg.textContent =
      totalGames > 0
        ? (
            totalTurns /
            totalGames
          ).toFixed(1)
        : "-";
  }
}


/* =========================================================
   싱글플레이 새 게임
========================================================= */

function startSingleGame() {

  used =
    new Set();

  current =
    "";

  turn =
    0;

  singlePlayer =
    0;

  over =
    false;


  const input =
    $("singleInput");

  const send =
    $("singleSend");


  if (input) {
    input.disabled =
      false;

    input.value =
      "";
  }


  if (send) {
    send.disabled =
      false;
  }


  const word =
    getRandomStartWord();


  if (!word) {

    $("message").textContent =
      "시작 단어를 찾지 못했습니다.";

    return;
  }


  current =
    word;

  used.add(word);


  /*
   * 시작 단어는 플레이어 1의 단어.
   */
  turn =
    1;


  renderSingle();


  $("message").textContent =
    "플레이어 2의 차례입니다.";
}


/* =========================================================
   싱글 렌더
========================================================= */

function renderSingle() {

  const last =
    $("last");

  const turnEl =
    $("turn");

  const start =
    $("startWord");

  const history =
    $("history");


  if (last) {
    last.textContent =
      current
        ? current.at(-1)
        : "-";
  }


  if (turnEl) {
    turnEl.textContent =
      turn;
  }


  if (start) {
    start.value =
      current || "-";
  }


  if (history) {

    history.innerHTML =
      [...used]
        .map(
          (word, index) =>
            `<div>
              <span>${index + 1}</span>
              <b>플레이어 ${
                index % 2 === 0
                  ? 1
                  : 2
              }</b>
              ${esc(word)}
            </div>`
        )
        .join("");
  }
}


/* =========================================================
   싱글 단어 입력
========================================================= */

function singleSubmit() {

  if (over) {
    return;
  }


  const input =
    $("singleInput");


  const message =
    $("message");


  const word =
    input.value
      .trim()
      .normalize("NFC");


  if (!word) {
    return;
  }


  /*
   * 단어 목록
   */
  if (!hasWord(word)) {

    message.textContent =
      "단어 목록에 없는 단어입니다.";

    return;
  }


  /*
   * 중복
   */
  if (used.has(word)) {

    message.textContent =
      "이미 사용한 단어입니다.";

    return;
  }


  /*
   * 연결
   */
  if (
    current &&
    !canConnect(
      current,
      word
    )
  ) {

    const last =
      current.at(-1);

    const allowed =
      allowedFirstChars(
        last
      );


    message.textContent =
      allowed.length > 1
        ? `"${last}" 다음에는 ${allowed.join(", ")}으로 시작해야 합니다.`
        : `"${last}"으로 시작해야 합니다.`;

    return;
  }


  /*
   * 등록
   */
  used.add(word);

  current =
    word;


  /*
   * 현재 플레이어가
   * 마지막 단어를 냈으므로
   * 상대에게 턴 이동
   */
  const player =
    turn;


  turn =
    turn === 0
      ? 1
      : 0;


  input.value =
    "";


  /*
   * 다음 플레이어가
   * 낼 단어가 있는지 확인
   */
  const next =
    candidates(
      word.at(-1),
      used
    );


  renderSingle();


  if (!next.length) {

    finishSingle(
      player
    );

    return;
  }


  message.textContent =
    `플레이어 ${turn + 1}의 차례입니다.`;
}


/* =========================================================
   싱글 종료
========================================================= */

function finishSingle(
  winner
) {

  over =
    true;


  const input =
    $("singleInput");

  const send =
    $("singleSend");


  if (input) {
    input.disabled =
      true;
  }

  if (send) {
    send.disabled =
      true;
  }


  totalGames++;

  totalTurns +=
    used.size;


  if (winner === 0) {
    player1Wins++;
  } else {
    player2Wins++;
  }


  saveStats();
  updateStats();


  $("message").textContent =
    `플레이어 ${winner + 1} 승리!`;
}


/* =========================================================
   시작 버튼
========================================================= */

$("newStart")?.addEventListener(
  "click",
  startSingleGame
);


$("restart")?.addEventListener(
  "click",
  startSingleGame
);


$("singleSend")?.addEventListener(
  "click",
  singleSubmit
);


$("singleInput")?.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {

      event.preventDefault();

      singleSubmit();
    }
  }
);


/* =========================================================
   탭
========================================================= */

document
  .querySelectorAll(
    ".tabs button"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".tabs button"
            )
            .forEach(
              x =>
                x.classList.remove(
                  "active"
                )
            );


          button.classList.add(
            "active"
          );


          $("single")
            ?.classList.toggle(
              "hidden",
              button.dataset.mode !==
                "single"
            );


          $("online")
            ?.classList.toggle(
              "hidden",
              button.dataset.mode !==
                "online"
            );
        }
      );
    }
  );


/* =========================================================
   온라인 Socket.IO
========================================================= */

function setupSocket() {

  if (
    typeof io !==
    "function"
  ) {
    return;
  }


  socket =
    io();


  socket.on(
    "connect",
    () => {

      myId =
        socket.id;

    }
  );


  socket.on(
    "roomCreated",
    data => {

      $("roomCode").value =
        data.code;

      $("onlineMessage").textContent =
        `방이 만들어졌습니다. 코드: ${data.code}`;
    }
  );


  socket.on(
    "joinedRoom",
    data => {

      $("onlineMessage").textContent =
        `방 ${data.code}에 참가했습니다.`;
    }
  );


  socket.on(
    "roomState",
    state => {

      renderRoom(
        state
      );
    }
  );


  socket.on(
    "onlineStarted",
    () => {

      onlineStarted =
        true;

      $("onlineMessage").textContent =
        "게임이 시작되었습니다.";
    }
  );


  socket.on(
    "wordPlayed",
    data => {

      onlineLast =
        data.currentWord;

      onlineTurn =
        data.nextTurn;

      renderOnlineHistory(
        data.history
      );

      updateOnlineUI();
    }
  );


  socket.on(
    "wordRejected",
    data => {

      $("onlineMessage").textContent =
        data.reason ||
        "단어를 사용할 수 없습니다.";
    }
  );


  socket.on(
    "gameFinished",
    data => {

      onlineStarted =
        false;

      renderOnlineHistory(
        data.history
      );


      const winner =
        data.winner;


      $("onlineMessage").textContent =
        winner === myPlayerIndex
          ? "승리했습니다!"
          : "패배했습니다.";
    }
  );


  socket.on(
    "errorMessage",
    message => {

      $("onlineMessage").textContent =
        message;
    }
  );


  socket.on(
    "roomMessage",
    message => {

      $("onlineMessage").textContent =
        message;
    }
  );


  socket.on(
    "roomClosed",
    () => {

      onlineStarted =
        false;

      onlineTurn =
        -1;

      onlineLast =
        "";

      $("roomInfo").textContent =
        "방이 종료되었습니다.";

      $("onlineMessage").textContent =
        "상대방이 나갔습니다.";
    }
  );
}


/* =========================================================
   온라인 방 상태
========================================================= */

function renderRoom(state) {

  if (!state) {
    return;
  }


  const players =
    state.players || [];


  myPlayerIndex =
    players.findIndex(
      player =>
        player.id ===
        myId
    );


  onlineStarted =
    !!state.started;


  if (state.game) {

    onlineTurn =
      state.game.turn;

    onlineLast =
      state.game.currentWord || "";

    renderOnlineHistory(
      state.game.history || []
    );

  } else {

    onlineTurn =
      -1;

    onlineLast =
      "";
  }


  const roomInfo =
    $("roomInfo");


  if (roomInfo) {

    roomInfo.innerHTML =
      `
      <div>방 코드: <b>${esc(state.code)}</b></div>
      <div>
        ${players
          .map(
            (player, index) =>
              `<span>
                ${index + 1}P:
                ${esc(player.name)}
              </span>`
          )
          .join(" · ")}
      </div>
      `;
  }


  const startButton =
    $("startOnline");


  if (startButton) {

    const isHost =
      players[0]?.id ===
      myId;

    startButton.classList.toggle(
      "hidden",
      !(isHost &&
        players.length === 2 &&
        !state.started)
    );
  }


  updateOnlineUI();
}


/* =========================================================
   온라인 UI
========================================================= */

function updateOnlineUI() {

  const input =
    $("onlineInput");

  const send =
    $("onlineSend");


  const myTurn =
    onlineStarted &&
    onlineTurn ===
      myPlayerIndex;


  if (input) {
    input.disabled =
      !myTurn;
  }


  if (send) {
    send.disabled =
      !myTurn;
  }


  const last =
    $("last");


  if (
    last &&
    document
      .querySelector(
        ".tabs button.active"
      )
      ?.dataset.mode ===
      "online"
  ) {
    last.textContent =
      onlineLast
        ? onlineLast.at(-1)
        : "-";
  }
}


/* =========================================================
   온라인 기록
========================================================= */

function renderOnlineHistory(
  history
) {

  const box =
    $("onlineHistory");


  if (!box) {
    return;
  }


  box.innerHTML =
    (history || [])
      .map(
        item =>
          `<div>
            <span>${item.turn}</span>
            <b>플레이어 ${
              Number(item.player) + 1
            }</b>
            ${esc(item.word)}
          </div>`
      )
      .join("");
}


/* =========================================================
   방 만들기
========================================================= */

$("create")?.addEventListener(
  "click",
  () => {

    if (!socket) {
      return;
    }


    const name =
      $("name")
        .value
        .trim() ||
      "Player";


    socket.emit(
      "createRoom",
      {
        name
      }
    );
  }
);


/* =========================================================
   방 참가
========================================================= */

$("join")?.addEventListener(
  "click",
  () => {

    if (!socket) {
      return;
    }


    const name =
      $("name")
        .value
        .trim() ||
      "Player";


    const code =
      $("roomCode")
        .value
        .trim()
        .toUpperCase();


    if (!code) {
      $("onlineMessage").textContent =
        "방 코드를 입력해주세요.";

      return;
    }


    socket.emit(
      "joinRoom",
      {
        name,
        code
      }
    );
  }
);


/* =========================================================
   온라인 시작
========================================================= */

$("startOnline")?.addEventListener(
  "click",
  () => {

    socket?.emit(
      "startOnline"
    );
  }
);


/* =========================================================
   온라인 입력
========================================================= */

$("onlineSend")?.addEventListener(
  "click",
  onlineSubmit
);


$("onlineInput")?.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {

      event.preventDefault();

      onlineSubmit();
    }
  }
);


function onlineSubmit() {

  if (
    !socket ||
    !onlineStarted
  ) {
    return;
  }


  if (
    onlineTurn !==
    myPlayerIndex
  ) {

    $("onlineMessage").textContent =
      "아직 네 차례가 아니야.";

    return;
  }


  const input =
    $("onlineInput");


  const word =
    input.value
      .trim()
      .normalize("NFC");


  if (!word) {
    return;
  }


  /*
   * 클라이언트에서도 먼저 검사.
   * 최종 판정은 서버가 한다.
   */

  if (!hasWord(word)) {

    $("onlineMessage").textContent =
      "목록에 없는 단어야.";

    return;
  }


  if (
    onlineLast &&
    !canConnect(
      onlineLast,
      word
    )
  ) {

    const last =
      onlineLast.at(-1);

    const allowed =
      allowedFirstChars(
        last
      );


    $("onlineMessage").textContent =
      allowed.length > 1
        ? `"${last}" 다음에는 ${allowed.join(", ")}으로 시작해야 해.`
        : `"${last}"으로 시작해야 해.`;

    return;
  }


  socket.emit(
    "playWord",
    {
      word
    }
  );


  input.value =
    "";
}


/* =========================================================
   HTML escape
========================================================= */

function esc(value) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    char =>
      ({
        "&":
          "&amp;",
        "<":
          "&lt;",
        ">":
          "&gt;",
        '"':
          "&quot;",
        "'":
          "&#039;"
      })[char]
  );
}


/* =========================================================
   데이터 로딩
========================================================= */

async function loadData() {

  $("message").textContent =
    "게임 데이터를 불러오는 중...";


  try {

    const response =
      await fetch(
        "/api/data"
      );


    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const result =
      await response.json();


    if (!result.ready) {
      throw new Error(
        "게임 데이터가 준비되지 않았습니다."
      );
    }


    data = {

      byFirst:
        result.byFirst || {},

      startFirst:
        result.startFirst || [],

      wordSet:
        new Set(),

      attackDepth:
        {},

      dueum:
        result.dueum || {}
    };


    /*
     * word.txt 전체 단어 Set
     */
    for (
      const first
      of Object.keys(
        data.byFirst
      )
    ) {

      const list =
        data.byFirst[first] ||
        [];


      for (
        const word
        of list
      ) {

        data.wordSet.add(
          word
        );
      }
    }


    DUEUM =
      data.dueum;


    loadStats();
    updateStats();

    hideAiUI();

    startSingleGame();

    setupSocket();


    $("message").textContent =
      "플레이어 2의 차례입니다.";

  } catch (error) {

    console.error(
      "데이터 로딩 실패:",
      error
    );


    $("message").textContent =
      "게임 데이터를 불러오지 못했습니다.";


    setTimeout(
      loadData,
      1500
    );
  }
}


/* =========================================================
   시작
========================================================= */

loadData();
```
