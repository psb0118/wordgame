"use strict";

/* =========================================================
   끝말잇기 AI
   client/script.js
========================================================= */


/* =========================================================
   DOM
========================================================= */

const $ = id => document.getElementById(id);

const tabs =
  document.querySelectorAll(".tabs button");

const singlePanel =
  $("single");

const onlinePanel =
  $("online");


/* =========================================================
   싱글 DOM
========================================================= */

const difficulty =
  $("difficulty");

const startWordInput =
  $("startWord");

const newStartButton =
  $("newStart");

const lastElement =
  $("last");

const turnElement =
  $("turn");

const depthElement =
  $("depth");

const winrateElement =
  $("winrate");

const messageElement =
  $("message");

const historyElement =
  $("history");

const singleInput =
  $("singleInput");

const singleSend =
  $("singleSend");

const restartButton =
  $("restart");

const winsElement =
  $("wins");

const lossesElement =
  $("losses");

const gamesElement =
  $("games");

const avgElement =
  $("avg");


/* =========================================================
   온라인 DOM
========================================================= */

const nameInput =
  $("name");

const createButton =
  $("create");

const roomCodeInput =
  $("roomCode");

const joinButton =
  $("join");

const roomInfo =
  $("roomInfo");

const startOnlineButton =
  $("startOnline");

const onlineMessage =
  $("onlineMessage");

const onlineHistory =
  $("onlineHistory");

const onlineInput =
  $("onlineInput");

const onlineSend =
  $("onlineSend");


/* =========================================================
   게임 데이터
========================================================= */

let DATA = {
  ready: false,
  wordCount: 0,
  attackCount: 0,
  byFirst: {},
  attackDepth: {},
  dueum: {}
};


/* =========================================================
   싱글 상태
========================================================= */

let singleGame = null;

let singleBusy = false;

let singleGameStarted = false;


/* =========================================================
   온라인 상태
========================================================= */

let socket = null;

let mySocketId = null;

let onlineRoom = null;

let onlinePlayerIndex = -1;

let onlineStarted = false;

let onlineTurn = -1;


/* =========================================================
   통계
========================================================= */

const STORAGE_KEY =
  "kkeul-word-game-stats";


function getStats() {
  try {
    const data =
      JSON.parse(
        localStorage.getItem(
          STORAGE_KEY
        ) || "{}"
      );

    return {
      wins:
        Number(data.wins) || 0,

      losses:
        Number(data.losses) || 0,

      games:
        Number(data.games) || 0,

      totalTurns:
        Number(data.totalTurns) || 0
    };
  } catch {
    return {
      wins: 0,
      losses: 0,
      games: 0,
      totalTurns: 0
    };
  }
}


function saveStats(stats) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(stats)
  );
}


function updateStatsUI() {
  const stats =
    getStats();

  if (winsElement) {
    winsElement.textContent =
      stats.wins;
  }

  if (lossesElement) {
    lossesElement.textContent =
      stats.losses;
  }

  if (gamesElement) {
    gamesElement.textContent =
      stats.games;
  }

  if (avgElement) {
    avgElement.textContent =
      stats.games > 0
        ? (
            stats.totalTurns /
            stats.games
          ).toFixed(1)
        : "-";
  }

  const rate =
    stats.games > 0
      ? (
          stats.wins /
          stats.games *
          100
        )
      : 0;

  if (winrateElement) {
    winrateElement.textContent =
      `${rate.toFixed(1)}%`;
  }
}


function recordSingleResult(
  playerWon,
  turns
) {
  const stats =
    getStats();

  stats.games++;

  stats.totalTurns +=
    Number(turns) || 0;

  if (playerWon) {
    stats.wins++;
  } else {
    stats.losses++;
  }

  saveStats(stats);

  updateStatsUI();
}


/* =========================================================
   메시지
========================================================= */

function setMessage(
  text,
  type = ""
) {
  if (!messageElement) {
    return;
  }

  messageElement.textContent =
    text || "";

  messageElement.className =
    "message";

  if (type) {
    messageElement.classList.add(
      type
    );
  }
}


function setOnlineMessage(
  text,
  type = ""
) {
  if (!onlineMessage) {
    return;
  }

  onlineMessage.textContent =
    text || "";

  onlineMessage.className =
    "message";

  if (type) {
    onlineMessage.classList.add(
      type
    );
  }
}


/* =========================================================
   API
========================================================= */

async function api(
  url,
  options = {}
) {
  let response;

  try {
    response =
      await fetch(
        url,
        {
          ...options,

          headers: {
            "Content-Type":
              "application/json",

            ...(options.headers || {})
          }
        }
      );
  } catch (error) {
    throw new Error(
      "서버에 연결할 수 없습니다."
    );
  }

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    /*
     * Unexpected token '<'
     * 방지용
     */
    if (
      text.trimStart()
        .startsWith("<")
    ) {
      throw new Error(
        `서버가 JSON 대신 HTML을 반환했습니다. (${response.status})`
      );
    }

    throw new Error(
      `서버 응답을 읽을 수 없습니다. (${response.status})`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.reason ||
      "서버 요청에 실패했습니다."
    );
  }

  return data;
}


/* =========================================================
   데이터 로드
========================================================= */

async function loadData() {
  try {
    const data =
      await api(
        "/api/data"
      );

    DATA = {
      ...DATA,
      ...data
    };

    console.log(
      "게임 데이터 로드:",
      DATA.wordCount,
      "단어",
      DATA.attackCount,
      "공격 단어"
    );

    return true;
  } catch (error) {
    console.error(error);

    setMessage(
      error.message,
      "error"
    );

    return false;
  }
}


/* =========================================================
   두음법칙
========================================================= */

function allowedFirstChars(
  lastChar
) {
  if (!lastChar) {
    return [];
  }

  const result =
    new Set([
      lastChar
    ]);

  const values =
    DATA.dueum?.[
      lastChar
    ];

  if (Array.isArray(values)) {
    for (const char of values) {
      result.add(char);
    }
  }

  for (
    const [from, values]
    of Object.entries(
      DATA.dueum || {}
    )
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


/* =========================================================
   연결 검사
========================================================= */

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
   UI 초기화
========================================================= */

function resetHistory(element) {
  if (element) {
    element.innerHTML = "";
  }
}


function addHistoryItem(
  element,
  item
) {
  if (!element) {
    return;
  }

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "history-item";

  const playerText =
    item.player === 0
      ? "플레이어"
      : item.player === 1
        ? "끝말잇기 AI"
        : "상대";

  const depthText =
    item.depth != null
      ? ` · 깊이 ${item.depth}`
      : "";

  row.textContent =
    `${item.turn}. ${playerText} : ${item.word}${depthText}`;

  element.appendChild(
    row
  );

  element.scrollTop =
    element.scrollHeight;
}


function renderHistory(
  element,
  history
) {
  resetHistory(
    element
  );

  for (
    const item of history || []
  ) {
    addHistoryItem(
      element,
      item
    );
  }
}


/* =========================================================
   싱글 상태 UI
========================================================= */

function updateSingleUI() {
  if (!singleGame) {
    return;
  }

  const word =
    singleGame.currentWord;

  if (lastElement) {
    lastElement.textContent =
      word
        ? word.at(-1)
        : "-";
  }

  if (turnElement) {
    turnElement.textContent =
      singleGame.history.length;
  }

  const depth =
    word &&
    DATA.attackDepth
      ? DATA.attackDepth[word]
      : null;

  if (depthElement) {
    depthElement.textContent =
      depth != null
        ? depth
        : "-";
  }

  renderHistory(
    historyElement,
    singleGame.history
  );
}


/* =========================================================
   싱글 새 게임
========================================================= */

async function newSingleGame() {
  if (singleBusy) {
    return;
  }

  singleBusy = true;

  setMessage(
    "새 게임 준비 중..."
  );

  if (newStartButton) {
    newStartButton.disabled =
      true;
  }

  if (restartButton) {
    restartButton.disabled =
      true;
  }

  try {
    const result =
      await api(
        "/api/new-game",
        {
          method: "POST",
          body:
            JSON.stringify({})
        }
      );

    if (!result.ok) {
      throw new Error(
        result.reason ||
        "게임을 시작하지 못했습니다."
      );
    }

    singleGame =
      result.game;

    singleGameStarted =
      true;

    if (startWordInput) {
      startWordInput.value =
        result.startWord || "";
    }

    if (singleInput) {
      singleInput.value =
        "";

      singleInput.disabled =
        false;

      singleInput.focus();
    }

    if (singleSend) {
      singleSend.disabled =
        false;
    }

    updateSingleUI();

    setMessage(
      `"${result.startWord}"부터 시작합니다. 당신의 차례입니다.`,
      "success"
    );

  } catch (error) {
    console.error(
      "새 게임 오류:",
      error
    );

    singleGame =
      null;

    singleGameStarted =
      false;

    setMessage(
      error.message,
      "error"
    );

  } finally {
    singleBusy = false;

    if (newStartButton) {
      newStartButton.disabled =
        false;
    }

    if (restartButton) {
      restartButton.disabled =
        false;
    }
  }
}


/* =========================================================
   싱글 단어 입력
========================================================= */

async function playSingleWord() {
  if (
    singleBusy ||
    !singleGame ||
    !singleGameStarted
  ) {
    return;
  }

  if (
    singleGame.turnPlayer !== 0
  ) {
    return;
  }

  const raw =
    singleInput?.value || "";

  const word =
    raw
      .trim()
      .replace(/\s+/g, "")
      .normalize("NFC");

  if (!word) {
    setMessage(
      "단어를 입력해주세요.",
      "error"
    );

    return;
  }

  /*
   * 빠른 클라이언트 검사
   */
  if (
    singleGame.currentWord &&
    !canConnect(
      singleGame.currentWord,
      word
    )
  ) {
    const last =
      singleGame.currentWord.at(-1);

    const allowed =
      allowedFirstChars(
        last
      );

    setMessage(
      `"${last}" 다음에는 ${allowed.join(", ")}으로 시작해야 합니다.`,
      "error"
    );

    return;
  }

  /*
   * 서버에는 현재 게임 상태 전체를 보내지 않고
   * 단어 자체를 검증한다.
   *
   * 실제 싱글 게임 판정은 여기서 클라이언트가
   * 게임 엔진을 사용한다.
   */

  singleBusy = true;

  if (singleSend) {
    singleSend.disabled =
      true;
  }

  if (singleInput) {
    singleInput.disabled =
      true;
  }

  try {

    /*
     * 단어 목록 빠른 검사
     */
    if (
      DATA.byFirst &&
      !(
        DATA.byFirst[
          word.at(0)
        ] || []
      ).includes(word)
    ) {
      /*
       * 데이터가 일부만 로드되었을 수 있으므로
       * 서버 검증으로 최종 판단.
       */
      const check =
        await api(
          "/api/play",
          {
            method: "POST",

            body:
              JSON.stringify({
                word
              })
          }
        );

      if (!check.ok) {
        throw new Error(
          check.reason
        );
      }
    }


    /*
     * 현재 단어 등록
     */
    const player =
      singleGame.turnPlayer;

    const historyItem = {
      word,
      player,

      turn:
        singleGame.history.length + 1,

      depth:
        DATA.attackDepth?.[
          word
        ] ?? null
    };

    singleGame.currentWord =
      word;

    singleGame.usedWords =
      new Set(
        singleGame.usedWords || []
      );

    singleGame.usedWords.add(
      word
    );

    singleGame.history.push(
      historyItem
    );

    singleGame.turnPlayer =
      1;

    updateSingleUI();


    /*
     * 플레이어가 즉시 승리했는지
     */
    const nextCandidates =
      getClientCandidates(
        word,
        singleGame.usedWords
      );

    if (
      nextCandidates.length === 0
    ) {
      finishSingleGame(
        true
      );

      return;
    }


    setMessage(
      "끝말잇기 AI가 생각 중..."
    );


    /*
     * AI 응답
     */
    await wait(
      120
    );

    await playAI();


  } catch (error) {

    console.error(
      "단어 입력 오류:",
      error
    );

    setMessage(
      error.message,
      "error"
    );

  } finally {

    if (
      singleGameStarted &&
      singleGame &&
      singleGame.turnPlayer === 0
    ) {
      if (singleInput) {
        singleInput.disabled =
          false;

        singleInput.focus();
      }

      if (singleSend) {
        singleSend.disabled =
          false;
      }
    }

    singleBusy = false;
  }
}


/* =========================================================
   클라이언트 후보
========================================================= */

function getClientCandidates(
  previousWord,
  usedWords
) {
  if (
    !previousWord ||
    !DATA.byFirst
  ) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  const allowed =
    allowedFirstChars(
      previousWord.at(-1)
    );

  const result = [];

  for (
    const first
    of allowed
  ) {
    const list =
      DATA.byFirst[first] ||
      [];

    for (
      const word
      of list
    ) {
      if (
        used.has(word)
      ) {
        continue;
      }

      result.push(
        word
      );
    }
  }

  return result;
}


/* =========================================================
   AI
========================================================= */

async function playAI() {
  if (
    !singleGame ||
    !singleGameStarted
  ) {
    return;
  }

  if (
    singleGame.turnPlayer !== 1
  ) {
    return;
  }

  /*
   * AI가 사용할 수를 계산한다.
   *
   * 실제 선택 로직은 server/game.js와 동일한
   * 공격 깊이 데이터를 기준으로 동작하도록
   * 클라이언트에서도 후보를 분석한다.
   */

  const candidates =
    getClientCandidates(
      singleGame.currentWord,
      singleGame.usedWords
    );

  if (!candidates.length) {
    finishSingleGame(
      true
    );

    return;
  }


  const analyzed =
    candidates.map(
      word =>
        analyzeClientCandidate(
          word
        )
    );


  /*
   * AI 상황 분석
   */
  const choice =
    chooseAIClient(
      analyzed
    );


  if (!choice) {
    finishSingleGame(
      true
    );

    return;
  }


  const aiWord =
    choice.word;


  /*
   * AI 수 등록
   */
  singleGame.currentWord =
    aiWord;

  singleGame.usedWords.add(
    aiWord
  );

  singleGame.history.push({
    word:
      aiWord,

    player:
      1,

    turn:
      singleGame.history.length + 1,

    depth:
      DATA.attackDepth?.[
        aiWord
      ] ?? null
  });

  singleGame.turnPlayer =
    0;


  updateSingleUI();


  /*
   * AI 공격 깊이 표시
   */
  if (depthElement) {
    depthElement.textContent =
      choice.depth != null
        ? choice.depth
        : "-";
  }


  /*
   * AI가 방금 단어로 끝냈는지
   */
  const next =
    getClientCandidates(
      aiWord,
      singleGame.usedWords
    );

  if (!next.length) {
    finishSingleGame(
      false
    );

    return;
  }


  let message =
    `끝말잇기 AI: ${aiWord}`;

  if (
    choice.depth != null
  ) {
    message +=
      ` (공격 깊이 ${choice.depth})`;
  }

  if (
    choice.nextCount <= 1
  ) {
    message +=
      " · 강한 공격";
  } else if (
    choice.nextCount <= 3
  ) {
    message +=
      " · 공격";
  }

  setMessage(
    `${message} — 당신의 차례입니다.`
  );


  if (singleInput) {
    singleInput.disabled =
      false;

    singleInput.focus();
  }

  if (singleSend) {
    singleSend.disabled =
      false;
  }
}


/* =========================================================
   AI 후보 분석
========================================================= */

function analyzeClientCandidate(
  word
) {
  const used =
    new Set(
      singleGame.usedWords
    );

  used.add(word);

  const next =
    getClientCandidates(
      word,
      used
    );

  const depth =
    DATA.attackDepth?.[
      word
    ] ?? null;

  return {
    word,

    depth,

    nextCount:
      next.length,

    oneShot:
      next.length === 0,

    winningAttack:
      depth != null &&
      depth % 2 === 1
  };
}


/* =========================================================
   AI 선택
========================================================= */

function chooseAIClient(
  analyzed
) {
  if (!analyzed.length) {
    return null;
  }


  /*
   * 현재 AI 승률
   */
  const stats =
    getStats();

  const currentWinRate =
    stats.games > 0
      ? stats.wins /
        stats.games
      : 0.5;


  /*
   * 기본 점수
   */
  const scored =
    analyzed.map(
      info => {

        let score = 0;

        const depth =
          info.depth ?? 0;

        const count =
          info.nextCount;


        /*
         * 상대 선택지 0
         * 매우 강한 공격
         */
        if (
          count === 0
        ) {
          score +=
            10000;
        }


        /*
         * 상대 선택지 1
         * 강한 공격
         */
        else if (
          count === 1
        ) {
          score +=
            2500;
        }


        /*
         * 상대 선택지 적음
         */
        else if (
          count <= 3
        ) {
          score +=
            1000;
        }


        /*
         * 선택지가 적당히 많으면
         * 중간 정도
         */
        else {
          score +=
            Math.min(
              count,
              50
            ) * 5;
        }


        /*
         * 공격 깊이
         */
        if (
          info.winningAttack
        ) {
          score +=
            700 +
            depth * 35;
        }


        /*
         * 승률이 지나치게 높으면
         * 공격 강도를 낮춘다.
         */
        if (
          currentWinRate > 0.70
        ) {
          if (
            info.winningAttack
          ) {
            score -=
              800;
          }

          if (
            count <= 1
          ) {
            score -=
              1600;
          }
        }


        /*
         * 플레이어가 유리한 경우
         * 공격 적극 사용
         */
        if (
          currentWinRate < 0.35
        ) {
          if (
            info.winningAttack
          ) {
            score +=
              1300 +
              depth * 45;
          }
        }


        /*
         * 너무 많은 선택지를 만드는 수는
         * 공격성이 낮다.
         */
        if (
          count > 30
        ) {
          score -=
            100;
        }


        /*
         * 랜덤성을 약간 추가
         */
        score +=
          Math.random() *
          180;


        return {
          ...info,
          score
        };
      }
    );


  scored.sort(
    (a, b) =>
      b.score -
      a.score
  );


  /*
   * 너무 강하지 않도록 상위 후보 중 선택
   */
  let poolSize =
    7;

  if (
    currentWinRate < 0.35
  ) {
    poolSize =
      3;
  } else if (
    currentWinRate > 0.70
  ) {
    poolSize =
      10;
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
  ];
}


/* =========================================================
   싱글 게임 종료
========================================================= */

function finishSingleGame(
  playerWon
) {
  if (!singleGameStarted) {
    return;
  }

  singleGameStarted =
    false;

  const turns =
    singleGame?.history?.length ||
    0;

  recordSingleResult(
    playerWon,
    turns
  );


  if (singleInput) {
    singleInput.disabled =
      true;
  }

  if (singleSend) {
    singleSend.disabled =
      true;
  }


  if (playerWon) {
    setMessage(
      "게임 종료 — 플레이어 승리!",
      "success"
    );
  } else {
    setMessage(
      "게임 종료 — 끝말잇기 AI 승리!",
      "error"
    );
  }
}


/* =========================================================
   대기
========================================================= */

function wait(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


/* =========================================================
   탭
========================================================= */

function switchTab(
  mode
) {
  tabs.forEach(
    button => {
      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    }
  );

  if (singlePanel) {
    singlePanel.classList.toggle(
      "hidden",
      mode !== "single"
    );
  }

  if (onlinePanel) {
    onlinePanel.classList.toggle(
      "hidden",
      mode !== "online"
    );
  }
}


tabs.forEach(
  button => {
    button.addEventListener(
      "click",
      () => {
        switchTab(
          button.dataset.mode
        );
      }
    );
  }
);


/* =========================================================
   싱글 버튼
========================================================= */

if (newStartButton) {
  newStartButton.addEventListener(
    "click",
    newSingleGame
  );
}


if (restartButton) {
  restartButton.addEventListener(
    "click",
    newSingleGame
  );
}


if (singleSend) {
  singleSend.addEventListener(
    "click",
    playSingleWord
  );
}


if (singleInput) {
  singleInput.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();

        playSingleWord();
      }
    }
  );
}


/* =========================================================
   난이도 UI 제거
========================================================= */

/*
 * HTML에 예전 difficulty가 남아 있어도
 * AI는 이 값을 사용하지 않는다.
 *
 * 실제 AI는 하나의 시스템으로 동작한다.
 */

if (difficulty) {
  difficulty.style.display =
    "none";
}


/* =========================================================
   Socket.IO 연결
========================================================= */

function connectSocket() {
  if (socket) {
    return;
  }

  if (
    typeof io !== "function"
  ) {
    console.error(
      "Socket.IO를 찾을 수 없습니다."
    );

    setOnlineMessage(
      "Socket.IO 연결을 준비하지 못했습니다.",
      "error"
    );

    return;
  }


  socket =
    io();


  socket.on(
    "connect",
    () => {

      mySocketId =
        socket.id;

      console.log(
        "Socket.IO 연결:",
        socket.id
      );

      setOnlineMessage(
        "서버에 연결되었습니다.",
        "success"
      );
    }
  );


  socket.on(
    "disconnect",
    () => {

      mySocketId =
        null;

      setOnlineMessage(
        "서버 연결이 끊어졌습니다.",
        "error"
      );
    }
  );


  /* =====================================================
     방 생성
  ===================================================== */

  socket.on(
    "roomCreated",
    data => {

      if (
        data?.code
      ) {
        roomCodeInput.value =
          data.code;

        setOnlineMessage(
          `방이 생성되었습니다. 방 코드: ${data.code}`,
          "success"
        );
      }
    }
  );


  /* =====================================================
     방 참가
  ===================================================== */

  socket.on(
    "joinedRoom",
    data => {

      if (
        data?.code
      ) {
        roomCodeInput.value =
          data.code;

        setOnlineMessage(
          `방 ${data.code}에 참가했습니다.`,
          "success"
        );
      }
    }
  );


  /* =====================================================
     방 상태
  ===================================================== */

  socket.on(
    "roomState",
    room => {

      onlineRoom =
        room;

      renderOnlineRoom(
        room
      );
    }
  );


  /* =====================================================
     온라인 시작
  ===================================================== */

  socket.on(
    "onlineStarted",
    data => {

      onlineStarted =
        true;

      onlineTurn =
        Number(
          data?.firstPlayer
        );

      setOnlineMessage(
        onlineTurn ===
        onlinePlayerIndex
          ? "게임 시작! 당신의 차례입니다."
          : "게임 시작! 상대방의 차례입니다."
      );

      if (
        onlineTurn ===
        onlinePlayerIndex
      ) {
        focusOnlineInput();
      }
    }
  );


  /* =====================================================
     단어 입력
  ===================================================== */

  socket.on(
    "wordPlayed",
    data => {

      if (!onlineRoom) {
        return;
      }

      onlineTurn =
        Number(
          data.nextTurn
        );

      if (
        data.history
      ) {
        renderHistory(
          onlineHistory,
          data.history
        );
      }

      if (
        data.word
      ) {
        const who =
          Number(
            data.player
          ) ===
          onlinePlayerIndex
            ? "내가"
            : "상대가";

        const depthText =
          data.depth != null
            ? ` · 깊이 ${data.depth}`
            : "";

        setOnlineMessage(
          `${who} "${data.word}" 입력${depthText}`
        );
      }

      if (
        onlineTurn ===
        onlinePlayerIndex
      ) {
        setOnlineMessage(
          "당신의 차례입니다.",
          "success"
        );

        focusOnlineInput();
      } else {
        setOnlineMessage(
          "상대방의 차례입니다."
        );
      }
    }
  );


  /* =====================================================
     잘못된 단어
  ===================================================== */

  socket.on(
    "wordRejected",
    data => {

      setOnlineMessage(
        data?.reason ||
        "단어를 입력할 수 없습니다.",
        "error"
      );

      focusOnlineInput();
    }
  );


  /* =====================================================
     게임 종료
  ===================================================== */

  socket.on(
    "gameFinished",
    data => {

      onlineStarted =
        false;

      const winner =
        Number(
          data?.winner
        );

      if (
        winner ===
        onlinePlayerIndex
      ) {
        setOnlineMessage(
          "게임 종료 — 당신의 승리!",
          "success"
        );
      } else {
        setOnlineMessage(
          "게임 종료 — 상대방의 승리!",
          "error"
        );
      }

      if (
        data?.history
      ) {
        renderHistory(
          onlineHistory,
          data.history
        );
      }

      if (onlineInput) {
        onlineInput.disabled =
          true;
      }

      if (onlineSend) {
        onlineSend.disabled =
          true;
      }
    }
  );


  /* =====================================================
     방 메시지
  ===================================================== */

  socket.on(
    "roomMessage",
    message => {

      setOnlineMessage(
        message
      );
    }
  );


  /* =====================================================
     에러
  ===================================================== */

  socket.on(
    "errorMessage",
    message => {

      setOnlineMessage(
        message ||
        "오류가 발생했습니다.",
        "error"
      );
    }
  );
}


/* =========================================================
   온라인 방 UI
========================================================= */

function renderOnlineRoom(
  room
) {
  if (!roomInfo) {
    return;
  }

  if (!room) {
    roomInfo.textContent =
      "";

    return;
  }


  const players =
    room.players || [];


  /*
   * 내 플레이어 번호
   */
  onlinePlayerIndex =
    players.findIndex(
      player =>
        player.id ===
        mySocketId
    );


  let html =
    `<strong>방 코드: ${escapeHTML(room.code)}</strong>`;

  html +=
    `<div>`;

  players.forEach(
    (player, index) => {

      const me =
        index ===
        onlinePlayerIndex
          ? " (나)"
          : "";

      const turn =
        room.game &&
        room.game.turnPlayer ===
        index
          ? " · 현재 차례"
          : "";

      html +=
        `<div>${index + 1}. ${escapeHTML(player.name)}${me}${turn}</div>`;
    }
  );

  html +=
    `</div>`;


  if (
    players.length < 2
  ) {
    html +=
      `<div>상대방을 기다리는 중...</div>`;
  }


  if (
    room.game &&
    room.game.currentWord
  ) {
    html +=
      `<div>현재 단어: <strong>${escapeHTML(room.game.currentWord)}</strong></div>`;
  }


  roomInfo.innerHTML =
    html;


  /*
   * 방장 시작 버튼
   */
  if (startOnlineButton) {

    const isHost =
      onlinePlayerIndex === 0;

    const canStart =
      players.length === 2 &&
      !room.started &&
      isHost;

    startOnlineButton.classList.toggle(
      "hidden",
      !canStart
    );
  }


  if (
    room.game &&
    room.game.history
  ) {
    renderHistory(
      onlineHistory,
      room.game.history
    );
  }


  if (
    room.game
  ) {
    onlineTurn =
      room.game.turnPlayer;
  }


  updateOnlineInputState();
}


/* =========================================================
   온라인 입력 상태
========================================================= */

function updateOnlineInputState() {
  if (!onlineInput) {
    return;
  }

  const enabled =
    onlineStarted &&
    onlineTurn ===
    onlinePlayerIndex;

  onlineInput.disabled =
    !enabled;

  if (onlineSend) {
    onlineSend.disabled =
      !enabled;
  }
}


function focusOnlineInput() {
  updateOnlineInputState();

  if (
    onlineInput &&
    !onlineInput.disabled
  ) {
    onlineInput.focus();
  }
}


/* =========================================================
   HTML escape
========================================================= */

function escapeHTML(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


/* =========================================================
   닉네임
========================================================= */

function getPlayerName() {
  const value =
    nameInput?.value
      ?.trim();

  return value || "Player";
}


/* =========================================================
   방 만들기
========================================================= */

if (createButton) {
  createButton.addEventListener(
    "click",
    () => {

      connectSocket();

      if (!socket) {
        return;
      }

      socket.emit(
        "createRoom",
        {
          name:
            getPlayerName()
        }
      );
    }
  );
}


/* =========================================================
   방 참가
========================================================= */

if (joinButton) {
  joinButton.addEventListener(
    "click",
    () => {

      connectSocket();

      if (!socket) {
        return;
      }

      const code =
        roomCodeInput?.value
          ?.trim()
          .toUpperCase();

      if (!code) {
        setOnlineMessage(
          "방 코드를 입력해주세요.",
          "error"
        );

        return;
      }

      socket.emit(
        "joinRoom",
        {
          code,

          name:
            getPlayerName()
        }
      );
    }
  );
}


/* =========================================================
   온라인 시작
========================================================= */

if (startOnlineButton) {
  startOnlineButton.addEventListener(
    "click",
    () => {

      if (
        !socket
      ) {
        connectSocket();
      }

      if (!socket) {
        return;
      }

      socket.emit(
        "startOnline"
      );
    }
  );
}


/* =========================================================
   온라인 단어
========================================================= */

function sendOnlineWord() {
  if (
    !socket ||
    !onlineStarted ||
    onlineTurn !==
      onlinePlayerIndex
  ) {
    return;
  }

  const raw =
    onlineInput?.value || "";

  const word =
    raw
      .trim()
      .replace(/\s+/g, "")
      .normalize("NFC");

  if (!word) {
    setOnlineMessage(
      "단어를 입력해주세요.",
      "error"
    );

    return;
  }


  socket.emit(
    "playWord",
    {
      word
    }
  );


  if (onlineInput) {
    onlineInput.value =
      "";
  }
}


if (onlineSend) {
  onlineSend.addEventListener(
    "click",
    sendOnlineWord
  );
}


if (onlineInput) {
  onlineInput.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Enter"
      ) {
        event.preventDefault();

        sendOnlineWord();
      }
    }
  );
}


/* =========================================================
   온라인 시작 상태 처리
========================================================= */

function resetOnlineGameUI() {
  onlineStarted =
    false;

  onlineTurn =
    -1;

  if (onlineInput) {
    onlineInput.value =
      "";

    onlineInput.disabled =
      true;
  }

  if (onlineSend) {
    onlineSend.disabled =
      true;
  }

  resetHistory(
    onlineHistory
  );
}


/* =========================================================
   초기화
========================================================= */

async function init() {

  updateStatsUI();

  resetOnlineGameUI();

  /*
   * Socket.IO는 페이지가 로드되었다고 바로 연결하지 않고
   * 온라인 기능을 사용할 때 연결한다.
   */
  await loadData();

  /*
   * 첫 화면에서 자동으로 게임 준비.
   */
  await newSingleGame();
}


init();
