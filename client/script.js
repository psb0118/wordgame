"use strict";

/* =========================================================
   끝말잇기 AI - 통합 최종 script.js
   ---------------------------------------------------------
   - 싱글플레이
   - 끝말잇기 AI
   - 두음법칙
   - attack.txt 공격 깊이
   - 온라인 2인 Socket.IO
   - Enter 입력 지원
   - 버튼 입력 지원
   - 데이터 1회 로드
   - 후보 캐시
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
   데이터
========================================================= */

let DATA = null;

let byFirst =
  Object.create(null);

let attackDepth =
  Object.create(null);

let dueum =
  Object.create(null);

let allWords =
  new Set();

let dataReady = false;


/* =========================================================
   후보 캐시
========================================================= */

const candidateCache =
  new Map();


/* =========================================================
   싱글 상태
========================================================= */

let singleGame = null;

let singleThinking = false;

let singleStats = {
  wins: 0,
  losses: 0,
  games: 0,
  totalTurns: 0
};


/* =========================================================
   온라인 상태
========================================================= */

let socket = null;

let onlineRoom = null;

let onlineStarted = false;

let onlineMyIndex = -1;


/* =========================================================
   기본
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
   * 역방향 두음법칙
   *
   * 예:
   * 녀 -> 여
   *
   * 마지막 글자가 여라면
   * 녀도 연결 가능
   */

  for (
    const [from, values]
    of Object.entries(dueum)
  ) {

    if (!Array.isArray(values)) {
      continue;
    }

    if (values.includes(lastChar)) {
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


  const last =
    previousWord.at(-1);

  const first =
    nextWord.at(0);


  return allowedFirstChars(last)
    .includes(first);
}


/* =========================================================
   데이터 로드
========================================================= */

async function loadData() {

  if (dataReady) {
    return true;
  }


  try {

    const response =
      await fetch(
        "/api/data",
        {
          method: "GET",
          cache: "force-cache",
          headers: {
            "Accept":
              "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const contentType =
      response.headers
        .get("content-type") || "";


    /*
     * 서버가 HTML을 반환하면
     * JSON.parse 오류 대신 명확하게 표시
     */

    if (
      !contentType
        .toLowerCase()
        .includes("application/json")
    ) {

      const text =
        await response.text();

      console.error(
        "API 응답이 JSON이 아닙니다:",
        text.slice(0, 300)
      );

      throw new Error(
        "서버가 JSON 데이터 대신 다른 응답을 반환했습니다."
      );
    }


    const data =
      await response.json();


    DATA = data || {};


    byFirst =
      DATA.byFirst ||
      Object.create(null);


    attackDepth =
      DATA.attackDepth ||
      Object.create(null);


    dueum =
      DATA.dueum ||
      Object.create(null);


    /*
     * 후보 캐시는 데이터가 새로 로드될 경우
     * 반드시 초기화
     */

    candidateCache.clear();


    /*
     * 전체 단어 Set
     *
     * 새 게임마다 만들지 않는다.
     */

    allWords =
      new Set();


    for (
      const list
      of Object.values(byFirst)
    ) {

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
   후보 캐시
========================================================= */

function getBaseCandidates(firstChar) {

  if (!firstChar) {
    return [];
  }


  if (
    candidateCache.has(firstChar)
  ) {

    return candidateCache
      .get(firstChar);
  }


  const result = [];

  const list =
    byFirst[firstChar];


  if (Array.isArray(list)) {

    for (const word of list) {

      if (typeof word !== "string") {
        continue;
      }

      result.push(word);
    }
  }


  candidateCache.set(
    firstChar,
    result
  );


  return result;
}


/* =========================================================
   후보
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
      : new Set(
          usedWords || []
        );


  const chars =
    allowedFirstChars(
      previousWord.at(-1)
    );


  const result = [];


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

  if (!char) {
    return [];
  }


  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );


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
   공격 깊이
========================================================= */

function getAttackDepth(word) {

  if (!word) {
    return null;
  }


  const value =
    attackDepth[word];


  if (value == null) {
    return null;
  }


  const number =
    Number(value);


  return Number.isFinite(number)
    ? number
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

  /*
   * difficulty가 HTML에 없더라도
   * 기본 난이도 3으로 동작
   */

  const level =
    Number(
      difficulty?.value || 3
    );


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
   승률
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


function getAdjustedStrength() {

  const base =
    getDifficultyStrength();


  const winRate =
    getCurrentWinRate();


  let strength =
    base;


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
   AI 점수
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


  /*
   * 한방
   */

  if (info.oneShot) {

    score += 9000;

    score +=
      strength * 1000;

  } else if (
    nextCount === 1
  ) {

    score += 1800;

  } else if (
    nextCount <= 3
  ) {

    score += 900;

  } else if (
    nextCount >= 15
  ) {

    score += 120;

  } else {

    score += 350;
  }


  /*
   * 공격 단어
   *
   * attack.txt에 존재하는 단어만
   * winningAttack이 true가 된다.
   */

  if (info.winningAttack) {

    score +=
      700 +
      depth * 65;


    if (nextCount <= 3) {

      score += 500;
    }


    score +=
      strength * 1200;
  }


  /*
   * 짝수 깊이 공격 단어
   */

  if (info.losingAttack) {

    score -=
      450 +
      depth * 18;


    if (strength < 0.45) {

      score += 250;
    }
  }


  /*
   * 선택지가 거의 없는 경우
   */

  if (nextCount <= 1) {

    score -=
      (1 - strength) * 900;
  }


  /*
   * 일반 단어
   */

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
   * 첫 수
   *
   * 첫 수에서 공격 단어/한방을
   * 최대한 피한다.
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
   AI 단어 선택
========================================================= */

function chooseBotWord() {

  if (!singleGame) {
    return null;
  }


  const used =
    singleGame.usedWords;


  let candidates;


  if (
    singleGame.currentWord
  ) {

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
   * 선택 폭 증가
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


  if (!pool.length) {
    return null;
  }


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
   안전한 시작 단어
========================================================= */

function getRandomStartWord() {

  if (!dataReady) {
    return null;
  }


  const startFirst =
    Array.isArray(
      DATA?.startFirst
    ) &&
    DATA.startFirst.length
      ? DATA.startFirst
      : Object.keys(byFirst);


  if (!startFirst.length) {
    return null;
  }


  /*
   * 여러 글자를 랜덤하게 골라
   * 안전한 시작 단어를 찾는다.
   */

  const shuffled =
    [...startFirst];


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
    ] =
    [
      shuffled[j],
      shuffled[i]
    ];
  }


  /*
   * 시작 후보는 일부 글자만 검사.
   * 따라서 새 게임마다 전체 word.txt를
   * 전부 검색하지 않는다.
   */

  const maxFirstChecks =
    Math.min(
      shuffled.length,
      20
    );


  for (
    let i = 0;
    i < maxFirstChecks;
    i++
  ) {

    const first =
      shuffled[i];


    const list =
      getBaseCandidates(first);


    if (!list.length) {
      continue;
    }


    /*
     * 후보를 섞는다.
     */

    const candidates =
      [...list];


    /*
     * 전체를 검사하지 않고
     * 최대 일정 개수만 확인.
     */

    const maxChecks =
      Math.min(
        candidates.length,
        120
      );


    for (
      let j = 0;
      j < maxChecks;
      j++
    ) {

      const index =
        Math.floor(
          Math.random() *
          candidates.length
        );


      const word =
        candidates[index];


      /*
       * attack.txt 공격 단어는
       * 시작 단어에서 제외
       */

      if (
        getAttackDepth(word) != null
      ) {

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


      return word;
    }
  }


  /*
   * 최후의 fallback
   */

  for (const first of shuffled) {

    const list =
      getBaseCandidates(first);


    if (!list.length) {
      continue;
    }


    for (const word of list) {

      if (
        getAttackDepth(word) != null
      ) {
        continue;
      }


      return word;
    }
  }


  return null;
}


/* =========================================================
   싱글 게임 객체
========================================================= */

function createEmptySingleGame(start) {

  return {

    startChar:
      start.at(0),

    currentWord:
      null,

    turnPlayer:
      0,

    history: [],

    usedWords:
      new Set(),

    finished:
      false,

    winner:
      null,

    loser:
      null
  };
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


  singleGame =
    createEmptySingleGame(
      start
    );


  startWordInput.value =
    start;


  const success =
    playSingleWord(
      start,
      0
    );


  if (!success) {

    singleGame = null;

    return false;
  }


  singleThinking = false;

  updateInputState();

  return true;
}


/* =========================================================
   싱글 단어 처리
========================================================= */

function playSingleWord(
  word,
  player
) {

  if (!singleGame) {
    return false;
  }


  word =
    normalizeWord(word);


  if (!word) {
    return false;
  }


  if (
    !allWords.has(word)
  ) {

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


  singleGame.turnPlayer =
    player === 0
      ? 1
      : 0;


  updateSingleUI();

  updateInputState();

  return true;
}


/* =========================================================
   싱글 입력 상태
========================================================= */

function updateInputState() {

  if (singleInput) {

    const disabled =
      !singleGame ||
      singleGame.finished ||
      singleThinking ||
      singleGame.turnPlayer !== 0;


    singleInput.disabled =
      disabled;
  }


  if (singleSend) {

    const disabled =
      !singleGame ||
      singleGame.finished ||
      singleThinking ||
      singleGame.turnPlayer !== 0;


    singleSend.disabled =
      disabled;
  }


  if (onlineInput) {

    const disabled =
      !onlineStarted ||
      !socket ||
      onlineMyIndex < 0 ||
      !onlineRoom ||
      onlineRoom.turnPlayer !==
        onlineMyIndex;


    onlineInput.disabled =
      disabled;
  }


  if (onlineSend) {

    const disabled =
      !onlineStarted ||
      !socket ||
      onlineMyIndex < 0 ||
      !onlineRoom ||
      onlineRoom.turnPlayer !==
        onlineMyIndex;


    onlineSend.disabled =
      disabled;
  }
}


/* =========================================================
   플레이어 싱글 입력
========================================================= */

function sendSingleWord() {

  if (!singleGame) {

    showMessage(
      "먼저 새 게임을 시작해주세요.",
      true
    );

    return;
  }


  if (
    singleGame.finished
  ) {
    return;
  }


  if (
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
      singleInput?.value
    );


  if (!word) {

    singleInput?.focus();

    return;
  }


  /*
   * 입력창을 먼저 비운다.
   */

  singleInput.value = "";


  const success =
    playSingleWord(
      word,
      0
    );


  if (!success) {

    singleInput.value =
      word;

    singleInput.focus();

    return;
  }


  checkSingleFinished();


  if (
    singleGame.finished
  ) {

    updateInputState();

    return;
  }


  singleThinking = true;

  updateInputState();


  showMessage(
    "끝말잇기 AI가 생각 중..."
  );


  /*
   * UI 갱신 후 AI 실행
   */

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

    updateInputState();

    return;
  }


  if (
    singleGame.turnPlayer !== 1
  ) {

    singleThinking = false;

    updateInputState();

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

    updateInputState();

    return;
  }


  const success =
    playSingleWord(
      word,
      1
    );


  if (!success) {

    /*
     * 이론상 발생하면 안 되지만
     * AI가 잘못된 후보를 골랐을 경우
     * 게임이 멈추지 않게 처리.
     */

    console.error(
      "AI 단어 처리 실패:",
      word
    );


    singleGame.finished = true;

    singleGame.winner = 0;

    singleGame.loser = 1;


    finishSingleGame();


    singleThinking = false;

    updateInputState();

    return;
  }


  singleThinking = false;


  checkSingleFinished();


  if (
    !singleGame.finished
  ) {

    showMessage(
      "당신의 차례입니다."
    );
  }


  updateInputState();


  if (
    !singleGame.finished &&
    singleInput
  ) {

    singleInput.focus();
  }
}


/* =========================================================
   게임 종료 검사
========================================================= */

function checkSingleFinished() {

  if (!singleGame) {
    return;
  }


  if (!singleGame.currentWord) {
    return;
  }


  const candidates =
    getCandidates(
      singleGame.currentWord,
      singleGame.usedWords
    );


  if (
    !candidates.length
  ) {

    const lastPlayer =
      singleGame
        .history
        .at(-1)
        ?.player;


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
   싱글 종료
========================================================= */

function finishSingleGame() {

  if (!singleGame) {
    return;
  }


  /*
   * 이미 종료 처리된 게임 방지
   */

  if (
    singleGame._statsSaved
  ) {
    return;
  }


  singleGame._statsSaved =
    true;


  const winner =
    singleGame.winner;


  singleStats.games++;


  singleStats.totalTurns +=
    singleGame.history.length;


  /*
   * 여기서 wins는 AI 승리
   */

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


  updateInputState();
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


  if (lastEl) {

    lastEl.textContent =
      current
        ? current.at(-1)
        : "-";
  }


  if (turnEl) {

    turnEl.textContent =
      singleGame.history.length;
  }


  const depth =
    current
      ? getAttackDepth(current)
      : null;


  if (depthEl) {

    depthEl.textContent =
      depth != null
        ? depth
        : "-";
  }


  if (!historyEl) {
    return;
  }


  historyEl.innerHTML = "";


  for (
    const item
    of singleGame.history
  ) {

    const div =
      document.createElement(
        "div"
      );


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


    if (
      item.depth != null
    ) {

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

  try {

    localStorage.setItem(
      "kkeul-ai-stats",
      JSON.stringify(
        singleStats
      )
    );

  } catch (error) {

    console.warn(
      "통계 저장 실패:",
      error
    );
  }
}


function loadStats() {

  try {

    const raw =
      localStorage.getItem(
        "kkeul-ai-stats"
      );


    if (!raw) {
      return;
    }


    const saved =
      JSON.parse(raw);


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

  } catch (error) {

    console.warn(
      "통계 불러오기 실패:",
      error
    );
  }
}


function updateStats() {

  if (winsEl) {
    winsEl.textContent =
      singleStats.wins;
  }


  if (lossesEl) {
    lossesEl.textContent =
      singleStats.losses;
  }


  if (gamesEl) {
    gamesEl.textContent =
      singleStats.games;
  }


  if (avgEl) {

    avgEl.textContent =
      singleStats.games
        ? (
            singleStats.totalTurns /
            singleStats.games
          ).toFixed(1)
        : "-";
  }


  const rate =
    singleStats.games
      ? (
          singleStats.wins /
          singleStats.games
        ) * 100
      : 0;


  if (winrateEl) {

    winrateEl.textContent =
      `${rate.toFixed(0)}%`;
  }
}


/* =========================================================
   새 게임
========================================================= */

async function startNewGame() {

  /*
   * 데이터가 아직 없을 때만 로드.
   */

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
   * 기존 게임 제거
   */

  singleGame = null;

  singleThinking = false;


  const success =
    createSingleGame();


  if (!success) {
    return;
  }


  showMessage(
    "당신의 차례입니다."
  );


  updateSingleUI();

  updateInputState();


  /*
   * 자동 포커스
   */

  if (singleInput) {

    singleInput.focus();
  }
}


/* =========================================================
   랜덤 시작
========================================================= */

async function randomStart() {

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


  const start =
    getRandomStartWord();


  if (!start) {

    showMessage(
      "시작 단어를 찾지 못했습니다.",
      true
    );

    return;
  }


  singleGame =
    createEmptySingleGame(
      start
    );


  startWordInput.value =
    start;


  const success =
    playSingleWord(
      start,
      0
    );


  if (!success) {

    singleGame = null;

    return;
  }


  singleThinking = false;


  showMessage(
    "당신의 차례입니다."
  );


  updateSingleUI();

  updateInputState();


  if (singleInput) {
    singleInput.focus();
  }
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


  if (
    mode === "single"
  ) {

    singlePanel?.classList
      .remove("hidden");

    onlinePanel?.classList
      .add("hidden");


    if (
      singleGame &&
      !singleGame.finished &&
      !singleThinking &&
      singleGame.turnPlayer === 0
    ) {

      singleInput?.focus();
    }


  } else {

    singlePanel?.classList
      .add("hidden");

    onlinePanel?.classList
      .remove("hidden");


    connectSocket();

    updateInputState();
  }
}


/* =========================================================
   Socket.IO 연결
========================================================= */

function connectSocket() {

  if (socket) {
    return socket;
  }


  if (
    typeof io !== "function"
  ) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "Socket.IO를 불러오지 못했습니다.";
    }

    return null;
  }


  try {

    socket =
      io(
        {
          transports: [
            "websocket",
            "polling"
          ],
          reconnection: true,
          reconnectionAttempts: 10
        }
      );

  } catch (error) {

    console.error(
      "Socket.IO 연결 실패:",
      error
    );

    socket = null;

    return null;
  }


  socket.on(
    "connect",
    () => {

      if (onlineMessage) {

        onlineMessage.textContent =
          "서버에 연결되었습니다.";
      }


      updateInputState();
    }
  );


  socket.on(
    "disconnect",
    () => {

      onlineStarted = false;

      updateInputState();


      if (onlineMessage) {

        onlineMessage.textContent =
          "서버 연결이 끊어졌습니다.";
      }
    }
  );


  socket.on(
    "connect_error",
    error => {

      console.error(
        "Socket.IO 오류:",
        error
      );


      if (onlineMessage) {

        onlineMessage.textContent =
          "온라인 서버에 연결할 수 없습니다.";
      }
    }
  );


  socket.on(
    "roomCreated",
    data => {

      if (!data) {
        return;
      }


      roomCodeInput.value =
        data.code || "";


      onlineMessage.textContent =
        `방 생성 완료: ${
          data.code || ""
        }`;
    }
  );


  socket.on(
    "joinedRoom",
    data => {

      if (!data) {
        return;
      }


      roomCodeInput.value =
        data.code || "";


      onlineMessage.textContent =
        `방 참가 완료: ${
          data.code || ""
        }`;
    }
  );


  socket.on(
    "roomState",
    state => {

      onlineRoom =
        state || null;


      updateOnlineRoom(
        state
      );
    }
  );


  socket.on(
    "onlineStarted",
    data => {

      onlineStarted = true;


      /*
       * 서버가 시작 상태를 같이 보내면
       * 바로 반영
       */

      if (
        data &&
        data.state
      ) {

        onlineRoom =
          data.state;

        updateOnlineRoom(
          data.state
        );

      } else if (
        data &&
        data.room
      ) {

        onlineRoom =
          data.room;

        updateOnlineRoom(
          data.room
        );
      }


      if (onlineMessage) {

        onlineMessage.textContent =
          "게임이 시작되었습니다.";
      }


      onlineInput?.focus();

      updateInputState();
    }
  );


  socket.on(
    "wordPlayed",
    data => {

      if (!data) {
        return;
      }


      /*
       * 서버가 state를 함께 보내는 경우
       * 상태를 우선 반영
       */

      if (data.state) {

        onlineRoom =
          data.state;

        updateOnlineRoom(
          data.state
        );
      }


      addOnlineHistory(
        data.word,
        data.player,
        data.nextTurn,
        data.depth
      );


      /*
       * 서버에서 nextTurn을 보내지 않는 경우
       * state의 turnPlayer 사용
       */

      updateInputState();
    }
  );


  socket.on(
    "wordRejected",
    data => {

      if (onlineMessage) {

        onlineMessage.textContent =
          data?.reason ||
          "단어를 사용할 수 없습니다.";
      }


      onlineInput?.focus();

      updateInputState();
    }
  );


  socket.on(
    "gameFinished",
    data => {

      onlineStarted = false;


      if (onlineMessage) {

        if (
          data &&
          data.winner ===
            onlineMyIndex
        ) {

          onlineMessage.textContent =
            "승리했습니다.";

        } else if (
          data &&
          data.winner != null
        ) {

          onlineMessage.textContent =
            "패배했습니다.";

        } else {

          onlineMessage.textContent =
            "게임이 끝났습니다.";
        }
      }


      updateInputState();
    }
  );


  socket.on(
    "roomMessage",
    message => {

      if (onlineMessage) {

        onlineMessage.textContent =
          String(message || "");
      }
    }
  );


  socket.on(
    "errorMessage",
    message => {

      if (onlineMessage) {

        onlineMessage.textContent =
          String(message || "");
      }
    }
  );


  return socket;
}


/* =========================================================
   온라인 방 UI
========================================================= */

function updateOnlineRoom(state) {

  if (!state) {

    onlineMyIndex = -1;

    if (roomInfo) {
      roomInfo.textContent = "";
    }

    updateInputState();

    return;
  }


  if (roomInfo) {

    roomInfo.innerHTML = "";


    const title =
      document.createElement(
        "div"
      );


    title.textContent =
      `방 코드: ${
        state.code || ""
      }`;


    roomInfo.appendChild(
      title
    );


    const players =
      Array.isArray(
        state.players
      )
        ? state.players
        : [];


    onlineMyIndex = -1;


    players.forEach(
      (player, index) => {

        const row =
          document.createElement(
            "div"
          );


        row.textContent =
          `${
            index === 0
              ? "방장"
              : "플레이어"
          }: ${
            player?.name ||
            "Player"
          }`;


        roomInfo.appendChild(
          row
        );


        if (
          socket &&
          player &&
          player.id === socket.id
        ) {

          onlineMyIndex =
            index;
        }
      }
    );
  }


  /*
   * 방장이면서 두 명이면
   * 시작 버튼 표시
   */

  if (
    startOnlineButton
  ) {

    if (
      state.players?.length === 2 &&
      onlineMyIndex === 0 &&
      !state.started
    ) {

      startOnlineButton.classList
        .remove("hidden");

    } else {

      startOnlineButton.classList
        .add("hidden");
    }
  }


  if (
    state.started
  ) {

    onlineStarted = true;
  }


  updateInputState();
}


/* =========================================================
   온라인 기록
========================================================= */

function addOnlineHistory(
  word,
  player,
  nextTurn,
  depth
) {

  if (!onlineHistory) {
    return;
  }


  const div =
    document.createElement(
      "div"
    );


  div.textContent =
    `${
      Number(player) === 0
        ? "플레이어 1"
        : "플레이어 2"
    } : ${word}`;


  if (
    depth != null
  ) {

    div.textContent +=
      ` [깊이 ${depth}]`;
  }


  onlineHistory.appendChild(
    div
  );


  /*
   * 서버에서 nextTurn을 받은 경우
   */

  if (
    nextTurn != null
  ) {

    if (onlineMessage) {

      onlineMessage.textContent =
        Number(nextTurn) ===
          onlineMyIndex
          ? "내 차례입니다."
          : "상대방 차례입니다.";
    }
  }


  updateInputState();


  if (
    Number(nextTurn) ===
      onlineMyIndex
  ) {

    onlineInput?.focus();
  }
}


/* =========================================================
   온라인 방 생성
========================================================= */

function createOnlineRoom() {

  const s =
    connectSocket();


  if (!s) {
    return;
  }


  const name =
    normalizeWord(
      nameInput?.value
    ) || "Player";


  s.emit(
    "createRoom",
    {
      name
    }
  );
}


/* =========================================================
   온라인 방 참가
========================================================= */

function joinOnlineRoom() {

  const s =
    connectSocket();


  if (!s) {
    return;
  }


  const code =
    String(
      roomCodeInput?.value || ""
    )
      .trim()
      .toUpperCase();


  if (!code) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "방 코드를 입력해주세요.";
    }

    roomCodeInput?.focus();

    return;
  }


  const name =
    normalizeWord(
      nameInput?.value
    ) || "Player";


  s.emit(
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

  const s =
    connectSocket();


  if (!s) {
    return;
  }


  if (!s.connected) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "서버에 연결하는 중입니다.";
    }

    return;
  }


  s.emit(
    "startOnline"
  );
}


/* =========================================================
   온라인 단어 전송
========================================================= */

function sendOnlineWord() {

  const s =
    connectSocket();


  if (!s) {
    return;
  }


  if (!onlineStarted) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "아직 게임이 시작되지 않았습니다.";
    }

    return;
  }


  if (
    onlineMyIndex < 0
  ) {
    return;
  }


  /*
   * 서버 상태가 있으면
   * 내 차례인지 클라이언트에서도 검사
   */

  if (
    onlineRoom &&
    onlineRoom.turnPlayer != null &&
    Number(
      onlineRoom.turnPlayer
    ) !==
      Number(onlineMyIndex)
  ) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "상대방 차례입니다.";
    }

    return;
  }


  const word =
    normalizeWord(
      onlineInput?.value
    );


  if (!word) {

    onlineInput?.focus();

    return;
  }


  /*
   * 먼저 비운다.
   */

  onlineInput.value = "";


  s.emit(
    "playWord",
    {
      word
    }
  );


  /*
   * 서버가 처리하는 동안
   * 중복 전송을 막기 위해 잠시 비활성.
   *
   * 서버 wordPlayed / wordRejected에서
   * 다시 활성화된다.
   */

  if (onlineInput) {
    onlineInput.disabled = true;
  }

  if (onlineSend) {
    onlineSend.disabled = true;
  }
}


/* =========================================================
   Enter 처리
========================================================= */

function handleSingleKeydown(event) {

  if (
    event.key !== "Enter"
  ) {
    return;
  }


  event.preventDefault();

  event.stopPropagation();


  sendSingleWord();
}


function handleOnlineKeydown(event) {

  if (
    event.key !== "Enter"
  ) {
    return;
  }


  event.preventDefault();

  event.stopPropagation();


  sendOnlineWord();
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
   * 싱글 입력 버튼
   */

  singleSend?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      sendSingleWord();
    }
  );


  /*
   * 싱글 Enter
   */

  singleInput?.addEventListener(
    "keydown",
    handleSingleKeydown
  );


  /*
   * 싱글 새 게임
   */

  restartButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      startNewGame();
    }
  );


  /*
   * 랜덤 시작
   */

  newStartButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      randomStart();
    }
  );


  /*
   * 온라인 방 생성
   */

  createButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      createOnlineRoom();
    }
  );


  /*
   * 온라인 방 참가
   */

  joinButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      joinOnlineRoom();
    }
  );


  /*
   * 온라인 게임 시작
   */

  startOnlineButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      startOnlineGame();
    }
  );


  /*
   * 온라인 입력 버튼
   */

  onlineSend?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      sendOnlineWord();
    }
  );


  /*
   * 온라인 Enter
   */

  onlineInput?.addEventListener(
    "keydown",
    handleOnlineKeydown
  );


  /*
   * 방 코드 입력 시 자동 대문자
   */

  roomCodeInput?.addEventListener(
    "input",
    () => {

      roomCodeInput.value =
        roomCodeInput.value
          .replace(/\s+/g, "")
          .toUpperCase();
    }
  );


  /*
   * 닉네임 Enter는 방 생성
   */

  nameInput?.addEventListener(
    "keydown",
    event => {

      if (
        event.key !== "Enter"
      ) {
        return;
      }


      event.preventDefault();

      createOnlineRoom();
    }
  );


  /*
   * 방 코드 Enter는 참가
   */

  roomCodeInput?.addEventListener(
    "keydown",
    event => {

      if (
        event.key !== "Enter"
      ) {
        return;
      }


      event.preventDefault();

      joinOnlineRoom();
    }
  );
}


/* =========================================================
   초기화
========================================================= */

async function init() {

  loadStats();

  updateStats();

  bindEvents();


  /*
   * 페이지 로드 시에는
   * 대용량 word.txt를 읽지 않는다.
   *
   * 실제 새 게임을 눌렀을 때만 로드한다.
   */

  showMessage(
    "새 게임을 눌러 시작하세요."
  );


  updateInputState();
}


/* =========================================================
   시작
========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    init,
    {
      once: true
    }
  );

} else {

  init();
}
