"use strict";

/* =========================================================
   끝말잇기 AI - 최종 클라이언트
   ---------------------------------------------------------
   - 데이터 1회 로드
   - byFirst 캐시 사용
   - 새 게임마다 전체 단어 재검색 X
   - AI 1개: 끝말잇기 AI
   - 두음법칙
   - attack.txt 공격 깊이
   - 상황별 AI 공격 강도
   - 온라인 Socket.IO
========================================================= */


/* =========================================================
   DOM
========================================================= */

const $ = id => document.getElementById(id);

const difficulty = $("difficulty");
const startWordInput = $("startWord");
const newStartButton = $("newStart");

const lastEl = $("last");
const turnEl = $("turn");
const depthEl = $("depth");
const winrateEl = $("winrate");

const messageEl = $("message");
const historyEl = $("history");

const singleInput = $("singleInput");
const singleSend = $("singleSend");
const restartButton = $("restart");

const winsEl = $("wins");
const lossesEl = $("losses");
const gamesEl = $("games");
const avgEl = $("avg");

const onlineInput = $("onlineInput");
const onlineSend = $("onlineSend");
const onlineMessage = $("onlineMessage");
const onlineHistory = $("onlineHistory");

const createButton = $("create");
const joinButton = $("join");
const startOnlineButton = $("startOnline");

const nameInput = $("name");
const roomCodeInput = $("roomCode");
const roomInfo = $("roomInfo");

const tabs =
  document.querySelectorAll(".tabs button");

const singlePanel = $("single");
const onlinePanel = $("online");


/* =========================================================
   전역 상태
========================================================= */

let DATA = null;

let byFirst = Object.create(null);
let attackDepth = Object.create(null);
let dueum = Object.create(null);

let allWords = new Set();

let dataReady = false;


/* ---------------------------------------------------------
   싱글 게임
--------------------------------------------------------- */

let singleGame = null;

let singleThinking = false;

let singleStats = {
  wins: 0,
  losses: 0,
  games: 0,
  totalTurns: 0
};


/* ---------------------------------------------------------
   온라인
--------------------------------------------------------- */

let socket = null;
let onlineRoom = null;
let onlineStarted = false;
let onlineMyIndex = -1;


/* =========================================================
   데이터 로드
========================================================= */

async function loadData() {
  if (dataReady) {
    return true;
  }

  try {
    const response =
      await fetch("/api/data", {
        cache: "force-cache"
      });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    DATA = data;

    byFirst =
      data.byFirst ||
      Object.create(null);

    attackDepth =
      data.attackDepth ||
      Object.create(null);

    dueum =
      data.dueum ||
      Object.create(null);


    /*
     * 전체 Set은 실제 단어 존재 여부가
     * 필요할 때만 사용한다.
     *
     * 새 게임마다 만들지 않는다.
     */
    allWords = new Set();

    for (const list of Object.values(byFirst)) {
      if (!Array.isArray(list)) {
        continue;
      }

      for (const word of list) {
        allWords.add(word);
      }
    }

    dataReady = true;

    return true;

  } catch (error) {

    console.error(
      "데이터 로드 실패:",
      error
    );

    showMessage(
      "단어 데이터를 불러오지 못했습니다.",
      true
    );

    return false;
  }
}


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

  const direct =
    dueum[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      if (char) {
        result.add(char);
      }
    }
  }

  /*
   * 역방향 두음
   */
  for (const [from, values] of Object.entries(dueum)) {

    if (!Array.isArray(values)) {
      continue;
    }

    if (values.includes(lastChar)) {
      result.add(from);
    }
  }

  return [...result];
}


function canConnect(previousWord, nextWord) {
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
   후보 캐시
========================================================= */

const candidateCache =
  new Map();


function getBaseCandidates(firstChar) {

  if (!firstChar) {
    return [];
  }

  if (candidateCache.has(firstChar)) {
    return candidateCache.get(firstChar);
  }

  const result = [];

  const list =
    byFirst[firstChar];

  if (Array.isArray(list)) {
    for (const word of list) {
      result.push(word);
    }
  }

  /*
   * 캐시
   */
  candidateCache.set(
    firstChar,
    result
  );

  return result;
}


/* =========================================================
   실제 후보
========================================================= */

function getCandidates(
  previousWord,
  usedWords
) {
  previousWord =
    normalizeWord(previousWord);

  if (!previousWord) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const chars =
    allowedFirstChars(
      previousWord.at(-1)
    );

  const result = [];

  /*
   * 전체 단어가 아니라
   * 허용된 첫 글자 후보만 검사
   */
  for (const char of chars) {

    const list =
      getBaseCandidates(char);

    for (const word of list) {

      if (used.has(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}


function getCandidatesFromChar(
  char,
  usedWords
) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const chars =
    allowedFirstChars(char);

  const result = [];

  for (const first of chars) {

    const list =
      getBaseCandidates(first);

    for (const word of list) {

      if (used.has(word)) {
        continue;
      }

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
    attackDepth[word];

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
   후보 분석
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
   AI 강도
========================================================= */

function getDifficultyStrength() {

  const level =
    Number(
      difficulty?.value || 3
    );

  /*
   * 너무 강하지 않도록
   * 기본적으로 50% 근처를 목표로 한다.
   */

  switch (level) {

    case 1:
      return 0.25;

    case 2:
      return 0.38;

    case 3:
      return 0.50;

    case 4:
      return 0.65;

    case 5:
      return 0.78;

    default:
      return 0.50;
  }
}


/* =========================================================
   AI 승률 조절
========================================================= */

function getCurrentWinRate() {

  if (!singleStats.games) {
    return 0.50;
  }

  return (
    singleStats.wins /
    singleStats.games
  );
}


/*
 * 현재 승률이 너무 높으면
 * AI를 약간 약하게 한다.
 *
 * 현재 승률이 낮으면
 * 공격을 조금 더 적극적으로 한다.
 */
function getAdjustedStrength() {

  const base =
    getDifficultyStrength();

  const winRate =
    getCurrentWinRate();

  let strength = base;

  if (winRate > 0.70) {
    strength -= 0.18;
  } else if (winRate > 0.60) {
    strength -= 0.08;
  } else if (winRate < 0.30) {
    strength += 0.18;
  } else if (winRate < 0.40) {
    strength += 0.08;
  }

  return Math.max(
    0.15,
    Math.min(
      0.90,
      strength
    )
  );
}


/* =========================================================
   AI 후보 점수
========================================================= */

function scoreCandidate(
  info,
  strength,
  currentWord
) {
  let score = 0;

  const nextCount =
    info.nextCount;

  const depth =
    info.depth ?? 0;


  /* -------------------------------------------------------
     상대 선택지 0개
     -> 매우 강한 공격
  ------------------------------------------------------- */

  if (info.oneShot) {
    score += 9000;

    /*
     * 단, 너무 강한 AI를 방지한다.
     * 낮은 난이도에서는 즉시 승리를 일부러
     * 항상 고르지 않는다.
     */
    score +=
      strength * 1000;
  }


  /* -------------------------------------------------------
     상대 선택지 1개
     -> 강한 공격
  ------------------------------------------------------- */

  else if (nextCount === 1) {
    score += 1800;
  }


  /* -------------------------------------------------------
     선택지가 적음
  ------------------------------------------------------- */

  else if (nextCount <= 3) {
    score += 900;
  }


  /* -------------------------------------------------------
     선택지가 많음
     -> 중간 정도
  ------------------------------------------------------- */

  else if (nextCount >= 15) {
    score += 120;
  }

  else {
    score += 350;
  }


  /* -------------------------------------------------------
     공격 단어
  ------------------------------------------------------- */

  if (info.winningAttack) {

    score +=
      700 +
      depth * 65;

    /*
     * 상대 선택지가 적을수록
     * 공격 단어의 가치 상승
     */
    if (nextCount <= 3) {
      score += 500;
    }

    /*
     * 강한 난이도일수록 공격 선호
     */
    score +=
      strength * 1200;
  }


  /* -------------------------------------------------------
     양보/불리한 공격
  ------------------------------------------------------- */

  if (info.losingAttack) {

    score -=
      450 +
      depth * 18;

    /*
     * 너무 강한 상황이면
     * 일부러 약한 수를 고르는 데 활용
     */
    if (strength < 0.45) {
      score += 250;
    }
  }


  /* -------------------------------------------------------
     내가 다음 턴에 막힐 가능성
  ------------------------------------------------------- */

  if (nextCount <= 1) {
    score -=
      (1 - strength) * 900;
  }


  /* -------------------------------------------------------
     안전한 일반 단어
  ------------------------------------------------------- */

  if (
    !info.winningAttack &&
    !info.losingAttack &&
    !info.oneShot
  ) {
    score +=
      Math.min(
        nextCount,
        30
      ) * 12;
  }


  /*
   * 첫 수는 너무 강한 공격을 피한다.
   */
  if (!currentWord) {

    if (info.oneShot) {
      score -= 7000;
    }

    if (info.winningAttack) {
      score -= 1000;
    }

    if (info.losingAttack) {
      score -= 300;
    }
  }


  return score;
}


/* =========================================================
   봇 선택
========================================================= */

function chooseBotWord() {

  if (!singleGame) {
    return null;
  }

  const used =
    singleGame.usedWords;


  let candidates;

  if (singleGame.currentWord) {

    candidates =
      getCandidates(
        singleGame.currentWord,
        used
      );

  } else {

    candidates =
      getCandidatesFromChar(
        singleGame.startChar,
        used
      );
  }


  if (!candidates.length) {
    return null;
  }


  /*
   * 모든 후보를 분석한다.
   *
   * 여기서도 전체 word.txt가 아니라
   * 현재 글자 후보만 분석한다.
   */
  const analyzed = [];

  for (const word of candidates) {

    analyzed.push(
      analyzeCandidate(
        word,
        used
      )
    );
  }


  const strength =
    getAdjustedStrength();


  const scored =
    analyzed.map(info => ({
      ...info,

      score:
        scoreCandidate(
          info,
          strength,
          singleGame.currentWord
        )
    }));


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /*
   * 난이도별 선택 폭
   */
  let poolSize;

  if (strength >= 0.75) {
    poolSize = 2;
  } else if (strength >= 0.60) {
    poolSize = 4;
  } else if (strength >= 0.40) {
    poolSize = 7;
  } else {
    poolSize = 12;
  }


  /*
   * 승률이 너무 높으면
   * 후보 폭을 넓혀 자연스럽게 약한 수가
   * 나올 가능성을 높인다.
   */
  if (
    getCurrentWinRate() > 0.65
  ) {
    poolSize += 5;
  }


  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );


  const selected =
    pool[
      Math.floor(
        Math.random() *
        pool.length
      )
    ];


  return selected
    ? selected.word
    : null;
}


/* =========================================================
   시작 단어
========================================================= */

function getRandomStartWord() {

  if (!dataReady) {
    return null;
  }

  /*
   * 전체 word.txt를 순회하지 않는다.
   *
   * startFirst가 있으면 그것을 사용한다.
   */
  const startFirst =
    Array.isArray(DATA.startFirst) &&
    DATA.startFirst.length
      ? DATA.startFirst
      : Object.keys(byFirst);


  /*
   * 몇 개의 시작 글자 중에서
   * 랜덤으로 하나를 선택
   */
  const first =
    startFirst[
      Math.floor(
        Math.random() *
        startFirst.length
      )
    ];


  const list =
    getBaseCandidates(first);


  if (!list.length) {
    return null;
  }


  /*
   * 공격/즉시 종료 단어는
   * 시작 단어에서 피한다.
   */
  const safe = [];

  for (const word of list) {

    if (getAttackDepth(word) != null) {
      continue;
    }

    const next =
      getCandidates(
        word,
        new Set([word])
      );

    if (!next.length) {
      continue;
    }

    safe.push(word);

    /*
     * 충분히 찾으면 종료.
     * 전체 목록을 끝까지 뒤지지 않는다.
     */
    if (safe.length >= 100) {
      break;
    }
  }


  if (safe.length) {
    return safe[
      Math.floor(
        Math.random() *
        safe.length
      )
    ];
  }


  /*
   * 안전한 단어가 없다면
   * 일반 후보 중 선택
   */
  return list[
    Math.floor(
      Math.random() *
      list.length
    )
  ];
}


/* =========================================================
   싱글 게임 생성
========================================================= */

function createSingleGame() {

  const start =
    getRandomStartWord();

  if (!start) {
    showMessage(
      "시작 단어를 찾지 못했습니다.",
      true
    );

    return false;
  }


  singleGame = {

    startChar:
      start.at(0),

    currentWord:
      null,

    turnPlayer:
      0,

    history: [],

    usedWords:
      new Set(),

    finished: false,

    winner: null,

    loser: null
  };


  startWordInput.value =
    start;


  /*
   * 시작 단어를 실제 게임에 넣는다.
   */
  playSingleWord(start, 0);

  return true;
}


/* =========================================================
   싱글 단어 처리
========================================================= */

function playSingleWord(
  word,
  player
) {

  word =
    normalizeWord(word);

  if (!word) {
    return false;
  }


  if (!allWords.has(word)) {
    showMessage(
      "단어 목록에 없는 단어입니다.",
      true
    );

    return false;
  }


  if (
    singleGame.usedWords.has(word)
  ) {
    showMessage(
      "이미 사용한 단어입니다.",
      true
    );

    return false;
  }


  if (
    singleGame.currentWord &&
    !canConnect(
      singleGame.currentWord,
      word
    )
  ) {

    const last =
      singleGame.currentWord.at(-1);

    showMessage(
      `"${last}" 다음에 연결할 수 없는 단어입니다.`,
      true
    );

    return false;
  }


  singleGame.currentWord =
    word;

  singleGame.usedWords.add(word);

  singleGame.history.push({
    word,
    player,
    turn:
      singleGame.history.length + 1,
    depth:
      getAttackDepth(word)
  });


  singleGame.turnPlayer =
    player === 0
      ? 1
      : 0;


  updateSingleUI();

  return true;
}


/* =========================================================
   플레이어 입력
========================================================= */

function sendSingleWord() {

  if (!singleGame) {
    return;
  }

  if (
    singleGame.finished ||
    singleThinking
  ) {
    return;
  }


  if (
    singleGame.turnPlayer !== 0
  ) {
    return;
  }


  const word =
    normalizeWord(
      singleInput.value
    );


  if (!word) {
    return;
  }


  singleInput.value = "";


  const success =
    playSingleWord(
      word,
      0
    );


  if (!success) {
    return;
  }


  checkSingleFinished();


  if (singleGame.finished) {
    return;
  }


  /*
   * AI는 다음 이벤트 루프에서 실행.
   * UI가 먼저 갱신되도록 한다.
   */
  singleThinking = true;

  showMessage(
    "끝말잇기 AI가 생각 중..."
  );


  setTimeout(
    botTurn,
    30
  );
}


/* =========================================================
   AI 턴
========================================================= */

function botTurn() {

  if (
    !singleGame ||
    singleGame.finished
  ) {
    singleThinking = false;
    return;
  }


  if (
    singleGame.turnPlayer !== 1
  ) {
    singleThinking = false;
    return;
  }


  const word =
    chooseBotWord();


  if (!word) {

    singleGame.finished = true;

    singleGame.winner = 0;
    singleGame.loser = 1;

    finishSingleGame();

    singleThinking = false;

    return;
  }


  playSingleWord(
    word,
    1
  );


  singleThinking = false;


  checkSingleFinished();


  if (!singleGame.finished) {
    showMessage(
      "당신의 차례입니다."
    );
  }
}


/* =========================================================
   게임 종료 검사
========================================================= */

function checkSingleFinished() {

  if (!singleGame) {
    return;
  }


  const candidates =
    getCandidates(
      singleGame.currentWord,
      singleGame.usedWords
    );


  if (!candidates.length) {

    const lastPlayer =
      singleGame.history.at(-1)?.player;


    singleGame.finished = true;

    singleGame.winner =
      lastPlayer;

    singleGame.loser =
      lastPlayer === 0
        ? 1
        : 0;


    finishSingleGame();
  }
}


/* =========================================================
   싱글 종료 처리
========================================================= */

function finishSingleGame() {

  if (!singleGame) {
    return;
  }


  const winner =
    singleGame.winner;


  singleStats.games++;


  singleStats.totalTurns +=
    singleGame.history.length;


  if (winner === 1) {
    singleStats.wins++;
  } else {
    singleStats.losses++;
  }


  saveStats();
  updateStats();


  if (winner === 1) {
    showMessage(
      "끝말잇기 AI 승리"
    );
  } else {
    showMessage(
      "플레이어 승리"
    );
  }
}


/* =========================================================
   싱글 UI
========================================================= */

function updateSingleUI() {

  if (!singleGame) {
    return;
  }


  const current =
    singleGame.currentWord;


  lastEl.textContent =
    current
      ? current.at(-1)
      : "-";


  turnEl.textContent =
    singleGame.history.length;


  const depth =
    current
      ? getAttackDepth(current)
      : null;


  depthEl.textContent =
    depth != null
      ? depth
      : "-";


  historyEl.innerHTML = "";


  for (
    const item of singleGame.history
  ) {

    const div =
      document.createElement("div");

    div.className =
      item.player === 0
        ? "playerWord"
        : "aiWord";


    div.textContent =
      `${item.turn}. ${
        item.player === 0
          ? "나"
          : "끝말잇기 AI"
      } : ${item.word}`;


    if (item.depth != null) {
      div.textContent +=
        ` [깊이 ${item.depth}]`;
    }


    historyEl.appendChild(div);
  }
}


/* =========================================================
   메시지
========================================================= */

function showMessage(
  text,
  error = false
) {

  if (!messageEl) {
    return;
  }

  messageEl.textContent =
    text || "";

  messageEl.classList.toggle(
    "error",
    !!error
  );
}


/* =========================================================
   통계
========================================================= */

function saveStats() {

  localStorage.setItem(
    "kkeul-ai-stats",
    JSON.stringify(
      singleStats
    )
  );
}


function loadStats() {

  try {

    const saved =
      JSON.parse(
        localStorage.getItem(
          "kkeul-ai-stats"
        )
      );


    if (
      saved &&
      typeof saved === "object"
    ) {

      singleStats = {
        wins:
          Number(saved.wins) || 0,

        losses:
          Number(saved.losses) || 0,

        games:
          Number(saved.games) || 0,

        totalTurns:
          Number(saved.totalTurns) || 0
      };
    }

  } catch {
    /*
     * 저장 데이터가 깨졌으면
     * 기본값으로 시작
     */
  }
}


function updateStats() {

  winsEl.textContent =
    singleStats.wins;

  lossesEl.textContent =
    singleStats.losses;

  gamesEl.textContent =
    singleStats.games;


  if (singleStats.games) {

    avgEl.textContent =
      (
        singleStats.totalTurns /
        singleStats.games
      ).toFixed(1);

  } else {

    avgEl.textContent =
      "-";
  }


  const rate =
    singleStats.games
      ? (
          singleStats.wins /
          singleStats.games
        ) * 100
      : 0;


  winrateEl.textContent =
    `${rate.toFixed(0)}%`;
}


/* =========================================================
   새 게임
========================================================= */

async function startNewGame() {

  if (!dataReady) {

    showMessage(
      "단어 데이터를 준비하는 중..."
    );

    const ok =
      await loadData();

    if (!ok) {
      return;
    }
  }


  /*
   * 준비 완료 후 즉시 생성.
   */
  createSingleGame();


  singleInput.focus();
}


/* =========================================================
   랜덤 시작
========================================================= */

async function randomStart() {

  if (!dataReady) {

    const ok =
      await loadData();

    if (!ok) {
      return;
    }
  }


  const start =
    getRandomStartWord();


  if (!start) {
    return;
  }


  startWordInput.value =
    start;


  /*
   * 새 게임을 만들고
   * 랜덤 시작 단어를 지정한다.
   */
  singleGame = {

    startChar:
      start.at(0),

    currentWord:
      null,

    turnPlayer:
      0,

    history: [],

    usedWords:
      new Set(),

    finished: false,

    winner: null,

    loser: null
  };


  playSingleWord(
    start,
    0
  );


  singleInput.focus();
}


/* =========================================================
   탭
========================================================= */

function switchTab(mode) {

  tabs.forEach(button => {

    button.classList.toggle(
      "active",
      button.dataset.mode === mode
    );
  });


  if (mode === "single") {

    singlePanel.classList.remove(
      "hidden"
    );

    onlinePanel.classList.add(
      "hidden"
    );

  } else {

    singlePanel.classList.add(
      "hidden"
    );

    onlinePanel.classList.remove(
      "hidden"
    );

    connectSocket();
  }
}


/* =========================================================
   Socket.IO
========================================================= */

function connectSocket() {

  if (socket) {
    return;
  }


  if (
    typeof io !== "function"
  ) {

    onlineMessage.textContent =
      "Socket.IO를 불러오지 못했습니다.";

    return;
  }


  socket =
    io();


  socket.on(
    "connect",
    () => {

      onlineMessage.textContent =
        "서버에 연결되었습니다.";
    }
  );


  socket.on(
    "disconnect",
    () => {

      onlineMessage.textContent =
        "서버 연결이 끊어졌습니다.";
    }
  );


  socket.on(
    "roomCreated",
    data => {

      roomCodeInput.value =
        data.code;

      onlineMessage.textContent =
        `방 생성 완료: ${data.code}`;
    }
  );


  socket.on(
    "joinedRoom",
    data => {

      roomCodeInput.value =
        data.code;

      onlineMessage.textContent =
        `방 참가 완료: ${data.code}`;
    }
  );


  socket.on(
    "roomState",
    state => {

      onlineRoom = state;

      updateOnlineRoom(state);
    }
  );


  socket.on(
    "onlineStarted",
    () => {

      onlineStarted = true;

      onlineMessage.textContent =
        "게임이 시작되었습니다.";
    }
  );


  socket.on(
    "wordPlayed",
    data => {

      addOnlineHistory(
        data.word,
        data.player,
        data.nextTurn
      );
    }
  );


  socket.on(
    "wordRejected",
    data => {

      onlineMessage.textContent =
        data.reason ||
        "단어를 사용할 수 없습니다.";
    }
  );


  socket.on(
    "gameFinished",
    data => {

      onlineStarted = false;

      onlineMessage.textContent =
        data.winner === onlineMyIndex
          ? "승리했습니다."
          : "게임이 끝났습니다.";
    }
  );


  socket.on(
    "roomMessage",
    message => {

      onlineMessage.textContent =
        message;
    }
  );


  socket.on(
    "errorMessage",
    message => {

      onlineMessage.textContent =
        message;
    }
  );
}


/* =========================================================
   온라인 방 UI
========================================================= */

function updateOnlineRoom(state) {

  if (!state) {
    roomInfo.textContent = "";
    return;
  }


  roomInfo.innerHTML = "";


  const title =
    document.createElement("div");

  title.textContent =
    `방 코드: ${state.code}`;

  roomInfo.appendChild(title);


  state.players.forEach(
    (player, index) => {

      const row =
        document.createElement("div");

      row.textContent =
        `${index === 0 ? "방장" : "플레이어"}: ${
          player.name
        }`;

      roomInfo.appendChild(row);


      if (
        socket &&
        player.id === socket.id
      ) {
        onlineMyIndex =
          index;
      }
    }
  );


  if (
    state.players.length === 2 &&
    onlineMyIndex === 0 &&
    !state.started
  ) {

    startOnlineButton.classList.remove(
      "hidden"
    );

  } else {

    startOnlineButton.classList.add(
      "hidden"
    );
  }
}


/* =========================================================
   온라인 기록
========================================================= */

function addOnlineHistory(
  word,
  player,
  nextTurn
) {

  const div =
    document.createElement("div");

  div.textContent =
    `${player === 0 ? "플레이어 1" : "플레이어 2"} : ${word}`;

  onlineHistory.appendChild(div);


  onlineMessage.textContent =
    nextTurn === onlineMyIndex
      ? "내 차례입니다."
      : "상대방 차례입니다.";
}


/* =========================================================
   온라인 방 생성
========================================================= */

function createOnlineRoom() {

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
    { name }
  );
}


/* =========================================================
   온라인 방 참가
========================================================= */

function joinOnlineRoom() {

  connectSocket();

  if (!socket) {
    return;
  }


  const code =
    roomCodeInput.value
      .trim()
      .toUpperCase();


  if (!code) {

    onlineMessage.textContent =
      "방 코드를 입력해주세요.";

    return;
  }


  const name =
    normalizeWord(
      nameInput.value
    ) || "Player";


  socket.emit(
    "joinRoom",
    {
      code,
      name
    }
  );
}


/* =========================================================
   온라인 시작
========================================================= */

function startOnlineGame() {

  if (!socket) {
    connectSocket();
  }

  if (!socket) {
    return;
  }


  socket.emit(
    "startOnline"
  );
}


/* =========================================================
   온라인 단어 입력
========================================================= */

function sendOnlineWord() {

  if (
    !socket ||
    !onlineStarted
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
   이벤트 연결
========================================================= */

function bindEvents() {

  /*
   * 탭
   */
  tabs.forEach(button => {

    button.addEventListener(
      "click",
      () => {

        switchTab(
          button.dataset.mode
        );
      }
    );
  });


  /*
   * 싱글
   */
  if (singleSend) {

    singleSend.addEventListener(
      "click",
      sendSingleWord
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

          sendSingleWord();
        }
      }
    );
  }


  if (restartButton) {

    restartButton.addEventListener(
      "click",
      startNewGame
    );
  }


  if (newStartButton) {

    newStartButton.addEventListener(
      "click",
      randomStart
    );
  }


  /*
   * 온라인
   */
  if (createButton) {

    createButton.addEventListener(
      "click",
      createOnlineRoom
    );
  }


  if (joinButton) {

    joinButton.addEventListener(
      "click",
      joinOnlineRoom
    );
  }


  if (startOnlineButton) {

    startOnlineButton.addEventListener(
      "click",
      startOnlineGame
    );
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
          event.key === "Enter"
        ) {

          event.preventDefault();

          sendOnlineWord();
        }
      }
    );
  }
}


/* =========================================================
   초기화
========================================================= */

async function init() {

  loadStats();
  updateStats();

  bindEvents();


  /*
   * 페이지를 열자마자
   * 데이터 전체를 로드하지 않는다.
   *
   * 싱글 탭을 실제로 사용할 때 로드한다.
   *
   * 따라서 처음 페이지 표시가 빠르다.
   */
  showMessage(
    "새 게임을 눌러 시작하세요."
  );
}


/* =========================================================
   시작
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  init
);
