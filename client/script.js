"use strict";

/*
 * 끝말잇기 클라이언트
 *
 * 담당:
 *  - UI 이벤트
 *  - 싱글플레이
 *  - AI 1개
 *  - 온라인 2인 Socket.IO
 *  - /api/data 로 단어/공격 데이터 로드
 *
 * 게임 판정의 핵심 규칙은 server/game.js와 동일하게 유지한다.
 */


/* =========================================================
   전역 상태
========================================================= */

let DATA = {
  words: [],
  wordSet: new Set(),
  byFirst: {},
  attackDepth: {},
  dueum: {},
  startFirst: [],
  wordCount: 0
};

let socket = null;

let singleGame = null;
let singleStats = {
  wins: 0,
  losses: 0,
  games: 0,
  totalTurns: 0
};

let onlineState = {
  roomCode: null,
  playerIndex: -1,
  started: false,
  game: null
};


/* =========================================================
   DOM
========================================================= */

const $ = id =>
  document.getElementById(id);

const difficulty =
  $("difficulty");

const startWordInput =
  $("startWord");

const newStartButton =
  $("newStart");

const singleInput =
  $("singleInput");

const singleSend =
  $("singleSend");

const restartButton =
  $("restart");

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

const winsElement =
  $("wins");

const lossesElement =
  $("losses");

const gamesElement =
  $("games");

const avgElement =
  $("avg");

const onlineInput =
  $("onlineInput");

const onlineSend =
  $("onlineSend");

const nameInput =
  $("name");

const roomCodeInput =
  $("roomCode");

const createButton =
  $("create");

const joinButton =
  $("join");

const startOnlineButton =
  $("startOnline");

const roomInfo =
  $("roomInfo");

const onlineMessage =
  $("onlineMessage");

const onlineHistory =
  $("onlineHistory");


/* =========================================================
   기본 처리
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
  if (!lastChar) {
    return [];
  }

  const result =
    new Set([lastChar]);

  const values =
    DATA.dueum?.[lastChar];

  if (Array.isArray(values)) {
    for (const ch of values) {
      if (ch) {
        result.add(ch);
      }
    }
  }

  /*
   * 역방향도 허용
   *
   * 녀 -> 여
   * 여 -> 녀도 후보로 인정
   */
  for (
    const [from, values] of
    Object.entries(DATA.dueum || {})
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
   후보 검색
========================================================= */

function getCandidates(
  previousWord,
  usedWords = new Set()
) {
  if (!previousWord) {
    return [];
  }

  const allowed =
    new Set(
      allowedFirstChars(
        previousWord.at(-1)
      )
    );

  const result = [];

  for (
    const word of DATA.words
  ) {
    if (
      usedWords.has(word)
    ) {
      continue;
    }

    if (
      allowed.has(
        word.at(0)
      )
    ) {
      result.push(word);
    }
  }

  return result;
}


function getCandidatesFromChar(
  char,
  usedWords = new Set()
) {
  if (!char) {
    return [];
  }

  const allowed =
    new Set(
      allowedFirstChars(char)
    );

  const result = [];

  for (
    const word of DATA.words
  ) {
    if (
      usedWords.has(word)
    ) {
      continue;
    }

    if (
      allowed.has(
        word.at(0)
      )
    ) {
      result.push(word);
    }
  }

  return result;
}


/* =========================================================
   공격 데이터
========================================================= */

function getAttackDepth(word) {
  const value =
    DATA.attackDepth?.[word];

  if (value == null) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function isWinningAttack(word) {
  const depth =
    getAttackDepth(word);

  return (
    depth != null &&
    depth % 2 === 1
  );
}


function isLosingAttack(word) {
  const depth =
    getAttackDepth(word);

  return (
    depth != null &&
    depth % 2 === 0
  );
}


/* =========================================================
   단어 분석
========================================================= */

function analyzeCandidate(
  word,
  usedWords
) {
  const nextUsed =
    new Set(usedWords);

  nextUsed.add(word);

  const next =
    getCandidates(
      word,
      nextUsed
    );

  const depth =
    getAttackDepth(word);

  return {
    word,

    depth,

    nextCount:
      next.length,

    oneShot:
      next.length === 0,

    winningAttack:
      depth != null &&
      depth % 2 === 1,

    losingAttack:
      depth != null &&
      depth % 2 === 0
  };
}


/* =========================================================
   봇 강도
========================================================= */

function getDifficultyStrength() {
  const level =
    Number(
      difficulty?.value || 3
    );

  /*
   * Lv1:
   * 상당히 약하게
   *
   * Lv5:
   * 강하게
   */
  const values = {
    1: 0.25,
    2: 0.38,
    3: 0.50,
    4: 0.66,
    5: 0.82
  };

  return (
    values[level] ??
    0.50
  );
}


/* =========================================================
   봇 승률 추정
========================================================= */

/*
 * 실제 장기 승률을 매번 완벽하게 계산하는 대신,
 * 현재 위치의 유불리를 빠르게 추정한다.
 *
 * score가 높을수록 봇에게 유리하다.
 */

function estimatePositionStrength(
  candidates
) {
  if (!candidates.length) {
    return 0;
  }

  let score = 0;

  for (
    const info of candidates
  ) {
    if (info.oneShot) {
      score += 8;
    }

    if (info.winningAttack) {
      score += 3;
    }

    if (info.losingAttack) {
      score -= 2;
    }

    if (
      info.nextCount <= 1
    ) {
      score += 2;
    }

    if (
      info.nextCount >= 20
    ) {
      score += 0.2;
    }
  }

  score /=
    candidates.length;

  /*
   * -10 ~ +10 정도를
   * 0 ~ 1 승률로 변환
   */
  return Math.max(
    0,
    Math.min(
      1,
      0.5 + score * 0.06
    )
  );
}


/* =========================================================
   봇 후보 점수
========================================================= */

function scoreBotCandidate(
  info,
  strength,
  positionStrength
) {
  let score = 0;

  const depth =
    info.depth ?? 0;

  const nextCount =
    info.nextCount;


  /*
   * 상대 선택지 0개
   * = 매우 강한 공격
   */
  if (info.oneShot) {
    score += 9000;
  }


  /*
   * 상대 선택지 1개
   * = 강한 공격
   */
  else if (
    nextCount === 1
  ) {
    score += 2800;
  }


  /*
   * 선택지가 적음
   */
  else if (
    nextCount <= 3
  ) {
    score += 1300;
  }


  /*
   * 선택지가 많음
   * = 중간 정도
   */
  else {
    score +=
      Math.min(
        nextCount,
        100
      ) * 5;
  }


  /*
   * attack.txt 공격 정보
   */
  if (
    info.winningAttack
  ) {
    score +=
      900 +
      depth * 70;
  }


  /*
   * losing attack은 피한다.
   */
  if (
    info.losingAttack
  ) {
    score -=
      600 +
      depth * 20;
  }


  /*
   * 현재 봇 승률이 너무 높으면
   * 공격 강도를 낮춘다.
   */
  if (
    positionStrength >= 0.80
  ) {
    if (
      info.winningAttack
    ) {
      score -= 1800;
    }

    if (
      nextCount <= 1
    ) {
      score -= 1400;
    }
  }


  /*
   * 플레이어가 유리하면
   * 공격을 적극적으로 사용한다.
   */
  if (
    positionStrength <= 0.35
  ) {
    if (
      info.winningAttack
    ) {
      score +=
        2200 +
        depth * 50;
    }

    if (
      nextCount <= 1
    ) {
      score += 1000;
    }
  }


  /*
   * 난이도에 따른 공격 보정
   */
  score +=
    (
      strength - 0.5
    ) *
    (
      info.winningAttack
        ? 2200
        : 250
    );


  /*
   * 깊이가 높을수록 조금 선호
   */
  if (
    info.winningAttack
  ) {
    score +=
      depth * 25;
  }


  return score;
}


/* =========================================================
   봇 단어 선택
========================================================= */

function chooseBotWord(
  currentWord,
  usedWords
) {
  const candidates =
    currentWord
      ? getCandidates(
          currentWord,
          usedWords
        )
      : getCandidatesFromChar(
          startWordInput.value.at(0),
          usedWords
        );

  if (!candidates.length) {
    return null;
  }


  let analyzed =
    candidates.map(
      word =>
        analyzeCandidate(
          word,
          usedWords
        )
    );


  /*
   * 첫 시작 수에서 봇이
   * 바로 끝내버리는 것을 방지.
   */
  if (!currentWord) {
    const safe =
      analyzed.filter(
        info =>
          !info.oneShot &&
          !info.winningAttack &&
          !info.losingAttack
      );

    if (safe.length) {
      analyzed = safe;
    }
  }


  const positionStrength =
    estimatePositionStrength(
      analyzed
    );

  const strength =
    getDifficultyStrength();


  const scored =
    analyzed.map(
      info => ({
        ...info,

        score:
          scoreBotCandidate(
            info,
            strength,
            positionStrength
          )
      })
    );


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /*
   * 난이도가 높을수록
   * 상위 후보를 좁힌다.
   */
  let poolSize;

  switch (
    Number(
      difficulty?.value || 3
    )
  ) {
    case 1:
      poolSize = 12;
      break;

    case 2:
      poolSize = 8;
      break;

    case 3:
      poolSize = 5;
      break;

    case 4:
      poolSize = 3;
      break;

    case 5:
      poolSize = 2;
      break;

    default:
      poolSize = 5;
  }


  /*
   * 지나치게 강한 상태에서는
   * 최상위 공격을 일부러 피할 수 있게 한다.
   */
  let pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );


  if (
    positionStrength >= 0.90 &&
    pool.length > 2
  ) {
    pool =
      scored.slice(
        Math.floor(
          scored.length * 0.20
        ),
        Math.min(
          scored.length,
          Math.floor(
            scored.length * 0.20
          ) + poolSize
        )
      );
  }


  if (!pool.length) {
    pool = scored;
  }


  return pool[
    Math.floor(
      Math.random() *
      pool.length
    )
  ];
}


/* =========================================================
   싱글 게임 생성
========================================================= */

function makeSingleStartWord() {
  const all =
    DATA.words.filter(
      word => {
        const depth =
          getAttackDepth(word);

        const used =
          new Set();

        const next =
          getCandidates(
            word,
            new Set([word])
          );

        /*
         * 시작 단어는:
         * - 실제 단어
         * - 즉시 끝나는 단어 X
         * - 공격 깊이가 있는 강한 단어 X
         */
        return (
          next.length > 0 &&
          depth == null
        );
      }
    );

  if (!all.length) {
    return (
      DATA.words[
        Math.floor(
          Math.random() *
          DATA.words.length
        )
      ] || ""
    );
  }

  return all[
    Math.floor(
      Math.random() *
      all.length
    )
  ];
}


function createSingleGame() {
  const start =
    makeSingleStartWord();

  singleGame = {
    currentWord: start,

    usedWords:
      new Set([start]),

    history: [
      {
        word: start,
        player: 0,
        turn: 1,
        depth:
          getAttackDepth(start)
      }
    ],

    turn: 0,

    finished: false,

    winner: null,

    loser: null
  };

  startWordInput.value =
    start;

  renderSingle();

  setSingleMessage(
    `시작 단어: ${start} — 당신의 차례입니다.`
  );
}


/* =========================================================
   싱글 단어 판정
========================================================= */

function playSinglePlayerWord(
  input
) {
  if (
    !singleGame ||
    singleGame.finished
  ) {
    return;
  }

  if (
    singleGame.turn !== 0
  ) {
    setSingleMessage(
      "잠시만요. AI의 차례입니다."
    );
    return;
  }

  const word =
    normalizeWord(input);

  if (!word) {
    setSingleMessage(
      "단어를 입력해주세요."
    );
    return;
  }

  if (
    !DATA.wordSet.has(word)
  ) {
    setSingleMessage(
      "단어 목록에 없는 단어입니다."
    );
    return;
  }

  if (
    singleGame.usedWords.has(word)
  ) {
    setSingleMessage(
      "이미 사용한 단어입니다."
    );
    return;
  }

  if (
    !canConnect(
      singleGame.currentWord,
      word
    )
  ) {
    const allowed =
      allowedFirstChars(
        singleGame.currentWord.at(-1)
      );

    setSingleMessage(
      `"${singleGame.currentWord.at(-1)}" 다음에는 ${
        allowed.join(", ")
      }으로 시작해야 합니다.`
    );

    return;
  }


  addSingleWord(
    word,
    0
  );


  /*
   * 플레이어가 방금 끝냈는지
   */
  const next =
    getCandidates(
      word,
      singleGame.usedWords
    );

  if (!next.length) {
    finishSingleGame(0);
    return;
  }


  singleGame.turn = 1;

  renderSingle();

  setSingleMessage(
    "AI가 생각하고 있습니다..."
  );

  singleInput.disabled = true;
  singleSend.disabled = true;


  /*
   * AI가 너무 즉시 나오지 않게
   * 짧은 지연
   */
  setTimeout(
    botTurn,
    450
  );
}


/* =========================================================
   싱글 AI 턴
========================================================= */

function botTurn() {
  if (
    !singleGame ||
    singleGame.finished
  ) {
    return;
  }

  if (
    singleGame.turn !== 1
  ) {
    return;
  }


  const chosen =
    chooseBotWord(
      singleGame.currentWord,
      singleGame.usedWords
    );


  if (!chosen) {
    finishSingleGame(0);
    return;
  }


  const word =
    chosen.word;


  addSingleWord(
    word,
    1
  );


  const next =
    getCandidates(
      word,
      singleGame.usedWords
    );


  if (!next.length) {
    finishSingleGame(1);
    return;
  }


  singleGame.turn = 0;

  singleInput.disabled = false;
  singleSend.disabled = false;

  renderSingle();


  const depth =
    getAttackDepth(word);

  const depthText =
    depth == null
      ? "일반"
      : `공격 깊이 ${depth}`;


  setSingleMessage(
    `AI: ${word} (${depthText}) — 당신의 차례`
  );

  singleInput.focus();
}


/* =========================================================
   싱글 단어 등록
========================================================= */

function addSingleWord(
  word,
  player
) {
  singleGame.currentWord =
    word;

  singleGame.usedWords.add(
    word
  );

  singleGame.history.push({
    word,

    player,

    turn:
      singleGame.history.length + 1,

    depth:
      getAttackDepth(word)
  });
}


/* =========================================================
   싱글 게임 종료
========================================================= */

function finishSingleGame(
  winner
) {
  if (
    !singleGame ||
    singleGame.finished
  ) {
    return;
  }

  singleGame.finished =
    true;

  singleGame.winner =
    winner;

  singleGame.loser =
    winner === 0
      ? 1
      : 0;


  singleStats.games++;

  singleStats.totalTurns =
    singleGame.history.length;


  if (winner === 1) {
    singleStats.wins++;
  } else {
    singleStats.losses++;
  }


  saveStats();

  renderSingle();


  if (winner === 1) {
    setSingleMessage(
      "AI 승리 — 다음 게임을 시작할 수 있습니다."
    );
  } else {
    setSingleMessage(
      "플레이어 승리 — 축하합니다."
    );


    singleInput.disabled =
      true;

    singleSend.disabled =
      true;
  }
}


/* =========================================================
   싱글 렌더링
========================================================= */

function renderSingle() {
  if (!singleGame) {
    return;
  }


  lastElement.textContent =
    singleGame.currentWord || "-";

  turnElement.textContent =
    singleGame.history.length;


  const lastItem =
    singleGame.history[
      singleGame.history.length - 1
    ];

  depthElement.textContent =
    lastItem?.depth ??
    "-";


  historyElement.innerHTML =
    singleGame.history
      .map(
        item => `
          <div class="historyItem">
            <span>
              ${item.player === 0
                ? "플레이어"
                : "AI"}
            </span>
            <strong>
              ${escapeHTML(item.word)}
            </strong>
            ${
              item.depth != null
                ? `<small>깊이 ${item.depth}</small>`
                : ""
            }
          </div>
        `
      )
      .join("");


  const rate =
    singleStats.games === 0
      ? 0
      : Math.round(
          (
            singleStats.wins /
            singleStats.games
          ) * 100
        );

  winrateElement.textContent =
    `${rate}%`;


  winsElement.textContent =
    singleStats.wins;

  lossesElement.textContent =
    singleStats.losses;

  gamesElement.textContent =
    singleStats.games;


  avgElement.textContent =
    singleStats.games
      ? (
          singleStats.totalTurns /
          singleStats.games
        ).toFixed(1)
      : "-";
}


/* =========================================================
   통계 저장
========================================================= */

function saveStats() {
  localStorage.setItem(
    "kkeulSingleStats",
    JSON.stringify(
      singleStats
    )
  );
}


function loadStats() {
  try {
    const data =
      JSON.parse(
        localStorage.getItem(
          "kkeulSingleStats"
        ) || "null"
      );

    if (!data) {
      return;
    }

    singleStats = {
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
    /* 저장 데이터가 깨졌으면 기본값 */
  }
}


/* =========================================================
   메시지
========================================================= */

function setSingleMessage(
  text
) {
  if (
    messageElement
  ) {
    messageElement.textContent =
      text;
  }
}


function setOnlineMessage(
  text
) {
  if (
    onlineMessage
  ) {
    onlineMessage.textContent =
      text;
  }
}


/* =========================================================
   HTML escape
========================================================= */

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   데이터 로드
========================================================= */

async function loadData() {
  try {
    setSingleMessage(
      "단어 데이터를 불러오는 중..."
    );

    const response =
      await fetch(
        "/api/data",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();


    DATA.byFirst =
      data.byFirst || {};

    DATA.attackDepth =
      data.attackDepth || {};

    DATA.dueum =
      data.dueum || {};

    DATA.startFirst =
      data.startFirst || [];

    DATA.wordCount =
      Number(data.wordCount) || 0;


    DATA.words = [];

    for (
      const list of
      Object.values(
        DATA.byFirst
      )
    ) {
      if (
        Array.isArray(list)
      ) {
        DATA.words.push(
          ...list
        );
      }
    }


    DATA.words =
      [
        ...new Set(
          DATA.words.map(
            normalizeWord
          )
        )
      ].filter(Boolean);


    DATA.wordSet =
      new Set(
        DATA.words
      );


    if (
      !DATA.words.length
    ) {
      throw new Error(
        "단어 목록이 비어 있습니다."
      );
    }


    loadStats();

    renderSingle();

    createSingleGame();

    setSingleMessage(
      `단어 ${DATA.words.length.toLocaleString()}개 로드 완료`
    );

  } catch (error) {
    console.error(
      "데이터 로드 실패:",
      error
    );

    setSingleMessage(
      `데이터를 불러오지 못했습니다: ${error.message}`
    );
  }
}


/* =========================================================
   탭
========================================================= */

function setupTabs() {
  const tabs =
    document.querySelectorAll(
      ".tabs button"
    );

  tabs.forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          const mode =
            button.dataset.mode;

          tabs.forEach(
            b =>
              b.classList.remove(
                "active"
              )
          );

          button.classList.add(
            "active"
          );


          document
            .getElementById(
              "single"
            )
            .classList.toggle(
              "hidden",
              mode !== "single"
            );

          document
            .getElementById(
              "online"
            )
            .classList.toggle(
              "hidden",
              mode !== "online"
            );


          if (
            mode === "online"
          ) {
            connectSocket();
          }
        }
      );
    }
  );
}


/* =========================================================
   싱글 이벤트
========================================================= */

function setupSingleEvents() {
  newStartButton?.addEventListener(
    "click",
    () => {
      if (!DATA.words.length) {
        return;
      }

      createSingleGame();
      singleInput.disabled =
        false;
      singleSend.disabled =
        false;

      singleInput.value = "";
      singleInput.focus();
    }
  );


  restartButton?.addEventListener(
    "click",
    () => {
      createSingleGame();

      singleInput.disabled =
        false;

      singleSend.disabled =
        false;

      singleInput.value = "";

      singleInput.focus();
    }
  );


  singleSend?.addEventListener(
    "click",
    () => {
      const word =
        singleInput.value;

      singleInput.value = "";

      playSinglePlayerWord(
        word
      );
    }
  );


  singleInput?.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();

        singleSend.click();
      }
    }
  );
}


/* =========================================================
   Socket 연결
========================================================= */

function connectSocket() {
  if (socket) {
    return;
  }

  if (
    typeof io !== "function"
  ) {
    setOnlineMessage(
      "Socket.IO를 불러오지 못했습니다."
    );

    return;
  }


  socket = io();


  socket.on(
    "connect",
    () => {
      setOnlineMessage(
        "서버에 연결되었습니다."
      );
    }
  );


  socket.on(
    "disconnect",
    () => {
      setOnlineMessage(
        "서버와 연결이 끊어졌습니다."
      );
    }
  );


  socket.on(
    "connect_error",
    error => {
      console.error(
        "Socket.IO 오류:",
        error
      );

      setOnlineMessage(
        "서버 연결에 실패했습니다."
      );
    }
  );


  socket.on(
    "roomCreated",
    data => {
      onlineState.roomCode =
        data.code;

      roomCodeInput.value =
        data.code;

      setOnlineMessage(
        `방이 만들어졌습니다. 코드: ${data.code}`
      );
    }
  );


  socket.on(
    "joinedRoom",
    data => {
      onlineState.roomCode =
        data.code;

      setOnlineMessage(
        `방 ${data.code}에 참가했습니다.`
      );
    }
  );


  socket.on(
    "roomState",
    state => {
      renderRoomState(
        state
      );
    }
  );


  socket.on(
    "onlineStarted",
    () => {
      onlineState.started =
        true;

      setOnlineMessage(
        "게임이 시작되었습니다."
      );

      onlineInput.disabled =
        false;

      onlineSend.disabled =
        false;
    }
  );


  socket.on(
    "roomMessage",
    text => {
      setOnlineMessage(
        text
      );
    }
  );


  socket.on(
    "errorMessage",
    text => {
      setOnlineMessage(
        text
      );
    }
  );


  socket.on(
    "wordRejected",
    data => {
      setOnlineMessage(
        data?.reason ||
        "단어가 거절되었습니다."
      );
    }
  );


  socket.on(
    "wordPlayed",
    data => {
      renderOnlineHistory(
        data.history || []
      );

      onlineState.game = {
        currentWord:
          data.currentWord,

        turn:
          data.nextTurn,

        history:
          data.history || []
      };


      const myTurn =
        data.nextTurn ===
        onlineState.playerIndex;


      setOnlineMessage(
        myTurn
          ? "당신의 차례입니다."
          : "상대방의 차례입니다."
      );


      onlineInput.disabled =
        !myTurn;

      onlineSend.disabled =
        !myTurn;


      if (myTurn) {
        onlineInput.focus();
      }
    }
  );


  socket.on(
    "gameFinished",
    data => {
      onlineState.started =
        false;

      onlineState.game = null;

      renderOnlineHistory(
        data.history || []
      );


      let text;

      if (
        data.winner ===
        onlineState.playerIndex
      ) {
        text =
          "온라인 게임 승리!";
      } else {
        text =
          "온라인 게임 패배!";
      }

      setOnlineMessage(
        text
      );


      onlineInput.disabled =
        true;

      onlineSend.disabled =
        true;
    }
  );
}


/* =========================================================
   방 상태 렌더링
========================================================= */

function renderRoomState(
  state
) {
  if (!state) {
    return;
  }


  const players =
    state.players || [];


  const playerText =
    players
      .map(
        (player, index) => {
          const me =
            player.id ===
            socket?.id
              ? " (나)"
              : "";

          return `
            <div>
              ${index + 1}P:
              ${escapeHTML(
                player.name
              )}
              ${me}
            </div>
          `;
        }
      )
      .join("");


  roomInfo.innerHTML = `
    <div>
      방 코드:
      <strong>
        ${escapeHTML(
          state.code
        )}
      </strong>
    </div>

    <div>
      ${playerText}
    </div>

    <div>
      ${
        state.started
          ? "게임 진행 중"
          : players.length === 2
            ? "게임 시작 가능"
            : "상대방을 기다리는 중"
      }
    </div>
  `;


  /*
   * 내 플레이어 번호 확인
   */
  onlineState.playerIndex =
    players.findIndex(
      player =>
        player.id ===
        socket?.id
    );


  onlineState.roomCode =
    state.code;

  onlineState.started =
    !!state.started;


  /*
   * 방장만 시작 버튼 표시
   */
  const isHost =
    players[0]?.id ===
    socket?.id;


  startOnlineButton.classList.toggle(
    "hidden",
    !(
      isHost &&
      players.length === 2 &&
      !state.started
    )
  );


  if (
    state.game
  ) {
    onlineState.game =
      state.game;

    const myTurn =
      state.game.turn ===
      onlineState.playerIndex;


    onlineInput.disabled =
      !myTurn;

    onlineSend.disabled =
      !myTurn;
  } else {
    onlineInput.disabled =
      true;

    onlineSend.disabled =
      true;
  }
}


/* =========================================================
   온라인 히스토리
========================================================= */

function renderOnlineHistory(
  history
) {
  onlineHistory.innerHTML =
    history
      .map(
        item => `
          <div class="historyItem">
            <span>
              ${item.player === 0
                ? "1P"
                : "2P"}
            </span>

            <strong>
              ${escapeHTML(
                item.word
              )}
            </strong>

            ${
              item.depth != null
                ? `<small>깊이 ${item.depth}</small>`
                : ""
            }
          </div>
        `
      )
      .join("");
}


/* =========================================================
   온라인 이벤트
========================================================= */

function setupOnlineEvents() {
  createButton?.addEventListener(
    "click",
    () => {
      connectSocket();

      if (!socket) {
        return;
      }

      const name =
        normalizeWord(
          nameInput.value
        ) || "Player";

      socket.emit(
        "createRoom",
        {
          name
        }
      );
    }
  );


  joinButton?.addEventListener(
    "click",
    () => {
      connectSocket();

      if (!socket) {
        return;
      }

      const code =
        roomCodeInput.value
          .trim()
          .toUpperCase();

      const name =
        normalizeWord(
          nameInput.value
        ) || "Player";


      if (
        code.length !== 6
      ) {
        setOnlineMessage(
          "6자리 방 코드를 입력해주세요."
        );

        return;
      }


      socket.emit(
        "joinRoom",
        {
          code,
          name
        }
      );
    }
  );


  startOnlineButton?.addEventListener(
    "click",
    () => {
      if (!socket) {
        connectSocket();
        return;
      }

      socket.emit(
        "startOnline"
      );
    }
  );


  onlineSend?.addEventListener(
    "click",
    sendOnlineWord
  );


  onlineInput?.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();

        sendOnlineWord();
      }
    }
  );
}


function sendOnlineWord() {
  if (
    !socket ||
    !onlineState.started
  ) {
    return;
  }

  if (
    onlineState.playerIndex < 0
  ) {
    return;
  }

  const word =
    normalizeWord(
      onlineInput.value
    );

  if (!word) {
    return;
  }


  onlineInput.value = "";

  socket.emit(
    "playWord",
    {
      word
    }
  );
}


/* =========================================================
   시작
========================================================= */

async function init() {
  setupTabs();

  setupSingleEvents();

  setupOnlineEvents();

  loadStats();

  renderSingle();

  await loadData();
}


init();
