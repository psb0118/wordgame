"use strict";

/* =========================================================
   끝말잇기 AI - 최종 통합 script.js
   ---------------------------------------------------------
   - 싱글플레이
   - 끝말잇기 AI
   - 두음법칙
   - attack.txt 공격 깊이
   - 온라인 2인 Socket.IO
   - Enter 입력
   - 버튼 입력
   - 데이터 1회 로드
   - 후보 캐시
   - 서버 상태 동기화
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


  /*
   * 정방향
   *
   * 예:
   * 녀 -> 여
   * 년 -> 연
   */

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
   * 역방향
   *
   * 예:
   * 여 -> 녀
   * 연 -> 년
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


/* =========================================================
   연결 가능 여부
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


    DATA =
      data || {};


    byFirst =
      DATA.byFirst ||
      Object.create(null);


    attackDepth =
      DATA.attackDepth ||
      Object.create(null);


    dueum =
      DATA.dueum ||
      Object.create(null);


    candidateCache.clear();


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

        const normalized =
          normalizeWord(word);

        if (normalized) {
          allWords.add(normalized);
        }
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
   기본 후보
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

      if (
        typeof word !== "string"
      ) {
        continue;
      }

      const normalized =
        normalizeWord(word);

      if (normalized) {
        result.push(normalized);
      }
    }
  }


  candidateCache.set(
    firstChar,
    result
  );


  return result;
}


/* =========================================================
   후보 검색
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

  const seen =
    new Set();


  for (const char of chars) {

    const list =
      getBaseCandidates(char);


    for (const word of list) {

      if (used.has(word)) {
        continue;
      }

      if (seen.has(word)) {
        continue;
      }

      seen.add(word);

      result.push(word);
    }
  }


  return result;
}


/* =========================================================
   시작 글자 후보
========================================================= */

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

  const seen =
    new Set();


  for (const first of chars) {

    const list =
      getBaseCandidates(first);


    for (const word of list) {

      if (used.has(word)) {
        continue;
      }

      if (seen.has(word)) {
        continue;
      }

      seen.add(word);

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


  const depth =
    Number(value);


  return Number.isFinite(depth)
    ? depth
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
   난이도
========================================================= */

function getDifficultyLevel() {

  const level =
    Number(
      difficulty?.value || 3
    );


  if (
    level < 1 ||
    level > 5 ||
    !Number.isFinite(level)
  ) {
    return 3;
  }


  return level;
}


function getDifficultyStrength() {

  switch (
    getDifficultyLevel()
  ) {

    case 1:
      return 0.25;

    case 2:
      return 0.38;

    case 3:
      return 0.50;

    case 4:
      return 0.68;

    case 5:
      return 0.82;

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


/* =========================================================
   AI 조절 강도
========================================================= */

function getAdjustedStrength() {

  const base =
    getDifficultyStrength();


  const winRate =
    getCurrentWinRate();


  let strength =
    base;


  /*
   * AI가 너무 많이 이기면
   * 공격성을 낮춘다.
   */

  if (winRate > 0.70) {

    strength -= 0.16;

  } else if (winRate > 0.60) {

    strength -= 0.08;

  }


  /*
   * AI가 너무 적게 이기면
   * 공격성을 높인다.
   */

  else if (winRate < 0.30) {

    strength += 0.16;

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


  const level =
    getDifficultyLevel();


  /* =======================================================
     즉시 승리
  ======================================================= */

  if (info.oneShot) {

    /*
     * Lv1~2에서는 한방을 상당히 피한다.
     *
     * Lv5에서는 확실한 승리 수를 사용한다.
     */

    if (level <= 2) {

      score +=
        250;

    } else if (level === 3) {

      score +=
        3000;

    } else {

      score +=
        12000;
    }
  }


  /* =======================================================
     상대 선택지 수
  ======================================================= */

  if (nextCount === 1) {

    score +=
      level >= 4
        ? 4200
        : 1500;

  } else if (nextCount <= 3) {

    score +=
      level >= 4
        ? 1800
        : 700;

  } else if (nextCount <= 8) {

    score += 450;

  } else if (nextCount <= 15) {

    score += 180;

  } else {

    score += 50;
  }


  /* =======================================================
     공격 단어
  ======================================================= */

  if (info.winningAttack) {

    /*
     * Lv1
     * 공격 단어를 거의 사용하지 않는다.
     */

    if (level === 1) {

      score +=
        50 +
        Math.min(depth, 5) * 5;

    }

    /*
     * Lv2
     */

    else if (level === 2) {

      score +=
        250 +
        Math.min(depth, 10) * 15;

    }

    /*
     * Lv3
     */

    else if (level === 3) {

      score +=
        650 +
        Math.min(depth, 20) * 30;

    }

    /*
     * Lv4
     */

    else if (level === 4) {

      score +=
        1200 +
        Math.min(depth, 30) * 45;

    }

    /*
     * Lv5
     *
     * 깊이가 높은 공격 단어를
     * 확실하게 선호.
     */

    else {

      score +=
        1800 +
        Math.min(depth, 50) * 70;
    }


    /*
     * 깊이가 높을수록 추가 보너스
     */

    score +=
      strength *
      depth *
      35;
  }


  /* =======================================================
     짝수 공격 깊이
  ======================================================= */

  if (info.losingAttack) {

    /*
     * 공격 단어 데이터에 짝수 깊이가 존재한다면
     * 일반적으로 좋은 공격 수로 취급하지 않는다.
     */

    score -=
      500 +
      depth * 20;
  }


  /* =======================================================
     일반 단어
  ======================================================= */

  if (
    !info.winningAttack &&
    !info.losingAttack &&
    !info.oneShot
  ) {

    /*
     * 선택지가 어느 정도 유지되는 단어를 선호.
     */

    score +=
      Math.min(
        nextCount,
        30
      ) * 14;
  }


  /* =======================================================
     너무 위험한 수
  ======================================================= */

  if (nextCount === 0) {

    /*
     * Lv1~2에서는 상대에게 바로 넘겨주는
     * 한방 수를 최대한 피한다.
     */

    if (level <= 2) {

      score -=
        5000;
    }

    else if (level === 3) {

      score -=
        800;
    }
  }


  /* =======================================================
     첫 수
  ======================================================= */

  if (!currentWord) {

    /*
     * 시작할 때 공격 단어 금지 수준으로 낮춘다.
     */

    if (info.winningAttack) {

      score -=
        10000;
    }


    /*
     * 한방 시작 단어도 금지 수준으로 낮춘다.
     */

    if (info.oneShot) {

      score -=
        15000;
    }


    /*
     * 짝수 공격도 시작에서는 피한다.
     */

    if (info.losingAttack) {

      score -=
        5000;
    }
  }


  return score;
}


/* =========================================================
   AI 후보 선택
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


  const analyzed =
    candidates.map(
      word =>
        analyzeCandidate(
          word,
          used
        )
    );


  const strength =
    getAdjustedStrength();


  const level =
    getDifficultyLevel();


  /*
   * 첫 수는 안전한 후보만 남긴다.
   */

  let poolCandidates =
    analyzed;


  if (!singleGame.currentWord) {

    const safe =
      analyzed.filter(
        info =>
          !info.oneShot &&
          !info.winningAttack &&
          !info.losingAttack
      );


    if (safe.length) {
      poolCandidates = safe;
    }
  }


  /*
   * 점수 계산
   */

  const scored =
    poolCandidates.map(
      info => ({

        ...info,

        score:
          scoreCandidate(
            info,
            strength,
            singleGame.currentWord
          )
      })
    );


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  if (!scored.length) {
    return null;
  }


  /*
   * 난이도별 선택 폭
   */

  let poolSize;


  switch (level) {

    case 1:
      poolSize = 20;
      break;

    case 2:
      poolSize = 14;
      break;

    case 3:
      poolSize = 8;
      break;

    case 4:
      poolSize = 4;
      break;

    case 5:
      poolSize = 2;
      break;

    default:
      poolSize = 8;
  }


  /*
   * AI 승률이 너무 높으면
   * 더 넓은 후보에서 선택한다.
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


  /*
   * 최고 점수와 너무 차이 나는 후보 제외
   */

  const bestScore =
    pool[0].score;


  let reasonable =
    pool.filter(
      item =>
        item.score >=
        bestScore - 1000
    );


  if (!reasonable.length) {
    reasonable = [pool[0]];
  }


  /*
   * Lv5는 최상위 수에 더욱 집중.
   */

  if (level === 5) {

    const top =
      reasonable.slice(
        0,
        Math.min(
          2,
          reasonable.length
        )
      );

    reasonable = top;
  }


  /*
   * Lv1은 완전히 최고점만 고르지 않고
   * 안전한 후보 중 랜덤하게 선택.
   */

  const selected =
    reasonable[
      Math.floor(
        Math.random() *
        reasonable.length
      )
    ];


  return selected
    ? selected.word
    : null;
}


/* =========================================================
   안전한 시작 단어
========================================================= */

function shuffleArray(array) {

  const result =
    [...array];


  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );


    [
      result[i],
      result[j]
    ] =
    [
      result[j],
      result[i]
    ];
  }


  return result;
}


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
   * 시작 글자 섞기
   */

  const shuffled =
    shuffleArray(
      startFirst
    );


  /*
   * 먼저 안전한 후보만 찾는다.
   *
   * 공격 단어 X
   * 한방 단어 X
   */

  for (
    const first
    of shuffled
  ) {

    const list =
      getBaseCandidates(first);


    if (!list.length) {
      continue;
    }


    const candidates =
      shuffleArray(list);


    /*
     * 모든 후보를 검사하면
     * 대용량 데이터에서 느려질 수 있으므로
     * 우선 앞쪽 후보들을 검사한다.
     */

    const limit =
      Math.min(
        candidates.length,
        200
      );


    for (
      let i = 0;
      i < limit;
      i++
    ) {

      const word =
        candidates[i];


      /*
       * attack.txt 단어 제외
       */

      if (
        getAttackDepth(word) != null
      ) {
        continue;
      }


      /*
       * 한방 단어 제외
       */

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
   * 만약 위 검사에서 못 찾았다면
   * 전체 후보에서 다시 안전한 단어 검색.
   */

  for (
    const first
    of shuffled
  ) {

    const list =
      getBaseCandidates(first);


    if (!list.length) {
      continue;
    }


    for (
      const word
      of list
    ) {

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


      if (next.length > 0) {
        return word;
      }
    }
  }


  return null;
}


/* =========================================================
   싱글 게임 생성
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
      null,

    _statsSaved:
      false
  };
}


function createSingleGame() {

  const start =
    getRandomStartWord();


  if (!start) {

    showMessage(
      "안전한 시작 단어를 찾지 못했습니다.",
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

  updateSingleUI();

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


  /*
   * 전체 단어 목록 검사
   */

  if (
    !allWords.has(word)
  ) {

    showMessage(
      "단어 목록에 없는 단어입니다.",
      true
    );

    return false;
  }


  /*
   * 중복
   */

  if (
    singleGame.usedWords.has(word)
  ) {

    showMessage(
      "이미 사용한 단어입니다.",
      true
    );

    return false;
  }


  /*
   * 첫 단어 이후 연결 검사
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


    showMessage(
      `"${last}" 다음에 연결할 수 없는 단어입니다.`,
      true
    );

    return false;
  }


  /*
   * 등록
   */

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


  /*
   * 턴 변경
   */

  singleGame.turnPlayer =
    player === 0
      ? 1
      : 0;


  updateSingleUI();

  return true;
}


/* =========================================================
   싱글 입력 상태
========================================================= */

function updateInputState() {

  /*
   * 싱글
   */

  if (singleInput) {

    singleInput.disabled =
      !singleGame ||
      singleGame.finished ||
      singleThinking ||
      singleGame.turnPlayer !== 0;
  }


  if (singleSend) {

    singleSend.disabled =
      !singleGame ||
      singleGame.finished ||
      singleThinking ||
      singleGame.turnPlayer !== 0;
  }


  /*
   * 온라인
   */

  const onlineCanPlay =
    onlineStarted &&
    !!socket &&
    socket.connected &&
    onlineMyIndex >= 0 &&
    !!onlineRoom &&
    onlineRoom.turnPlayer ===
      onlineMyIndex;


  if (onlineInput) {
    onlineInput.disabled =
      !onlineCanPlay;
  }


  if (onlineSend) {
    onlineSend.disabled =
      !onlineCanPlay;
  }
}


/* =========================================================
   싱글 플레이어 입력
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
    singleGame.finished ||
    singleThinking ||
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
   싱글 종료 검사
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
    candidates.length > 0
  ) {
    return;
  }


  const lastPlayer =
    singleGame
      .history
      .at(-1)
      ?.player;


  singleGame.finished =
    true;


  singleGame.winner =
    lastPlayer;


  singleGame.loser =
    lastPlayer === 0
      ? 1
      : 0;


  finishSingleGame();
}


/* =========================================================
   싱글 종료 처리
========================================================= */

function finishSingleGame() {

  if (!singleGame) {
    return;
  }


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
   * wins = AI 승리
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


    historyEl.appendChild(
      div
    );
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
   통계 저장
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
   새 싱글 게임
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


  singleInput?.focus();
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
      "안전한 시작 단어를 찾지 못했습니다.",
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


  singleInput?.focus();
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
      io({
        transports: [
          "websocket",
          "polling"
        ],

        reconnection:
          true,

        reconnectionAttempts:
          10
      });

  } catch (error) {

    console.error(
      "Socket.IO 연결 실패:",
      error
    );

    socket = null;

    return null;
  }


  /* =======================================================
     연결
  ======================================================= */

  socket.on(
    "connect",
    () => {

      if (onlineMessage) {

        onlineMessage.textContent =
          "서버에 연결되었습니다.";
      }


      /*
       * 연결 후 기존 방 정보가 있다면
       * 서버에서 다시 roomState를 받을 수 있다.
       */

      updateInputState();
    }
  );


  /* =======================================================
     연결 오류
  ======================================================= */

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


  /* =======================================================
     연결 종료
  ======================================================= */

  socket.on(
    "disconnect",
    () => {

      onlineStarted = false;

      onlineRoom = null;

      onlineMyIndex = -1;


      updateOnlineRoom(
        null
      );


      updateInputState();


      if (onlineMessage) {

        onlineMessage.textContent =
          "서버 연결이 끊어졌습니다.";
      }
    }
  );


  /* =======================================================
     방 생성
  ======================================================= */

  socket.on(
    "roomCreated",
    data => {

      if (!data) {
        return;
      }


      if (roomCodeInput) {

        roomCodeInput.value =
          data.code || "";
      }


      if (onlineMessage) {

        onlineMessage.textContent =
          `방 생성 완료: ${
            data.code || ""
          }`;
      }
    }
  );


  /* =======================================================
     방 참가
  ======================================================= */

  socket.on(
    "joinedRoom",
    data => {

      if (!data) {
        return;
      }


      if (roomCodeInput) {

        roomCodeInput.value =
          data.code || "";
      }


      if (onlineMessage) {

        onlineMessage.textContent =
          `방 참가 완료: ${
            data.code || ""
          }`;
      }
    }
  );


  /* =======================================================
     방 상태
  ======================================================= */

  socket.on(
    "roomState",
    state => {

      if (!state) {
        return;
      }


      onlineRoom =
        state;


      onlineStarted =
        !!state.started;


      updateOnlineRoom(
        state
      );


      if (
        onlineStarted &&
        onlineRoom.turnPlayer ===
          onlineMyIndex
      ) {

        if (onlineMessage) {

          onlineMessage.textContent =
            "내 차례입니다. 단어를 입력하세요.";
        }

        onlineInput?.focus();

      } else if (
        onlineStarted
      ) {

        if (onlineMessage) {

          onlineMessage.textContent =
            "상대방 차례입니다.";
        }
      }


      updateInputState();
    }
  );


  /* =======================================================
     온라인 게임 시작
  ======================================================= */

  socket.on(
    "onlineStarted",
    data => {

      onlineStarted = true;


      /*
       * 서버가 state를 보내는 경우
       */

      const state =
        data?.state ||
        data?.room ||
        null;


      if (state) {

        onlineRoom =
          state;


        updateOnlineRoom(
          state
        );
      }


      if (onlineMessage) {

        onlineMessage.textContent =
          "게임이 시작되었습니다.";
      }


      updateInputState();


      if (
        onlineRoom &&
        onlineRoom.turnPlayer ===
          onlineMyIndex
      ) {

        onlineMessage.textContent =
          "내 차례입니다. 단어를 입력하세요.";

        onlineInput?.focus();

      } else {

        onlineMessage.textContent =
          "상대방 차례입니다.";
      }
    }
  );


  /* =======================================================
     온라인 단어 플레이
  ======================================================= */

  socket.on(
    "wordPlayed",
    data => {

      if (!data) {
        return;
      }


      /*
       * 서버가 state를 같이 보낸다면
       * 서버 state를 최우선으로 사용.
       */

      if (data.state) {

        onlineRoom =
          data.state;


        onlineStarted =
          !!data.state.started;


        updateOnlineRoom(
          data.state
        );
      }


      /*
       * 서버가 state를 안 보내는 경우
       * 기존 room 상태에서 turn만 갱신.
       */

      if (
        !data.state &&
        onlineRoom
      ) {

        if (
          typeof data.nextTurn ===
            "number"
        ) {

          onlineRoom.turnPlayer =
            data.nextTurn;
        }
      }


      /*
       * 기록 추가
       */

      addOnlineHistory(
        data.word,
        data.player,
        data.nextTurn,
        data.depth
      );


      /*
       * 게임 종료
       */

      if (
        data.finished ||
        data.state?.finished
      ) {

        onlineStarted =
          false;


        updateInputState();


        if (onlineMessage) {

          if (
            data.winner ===
              onlineMyIndex ||
            data.state?.winner ===
              onlineMyIndex
          ) {

            onlineMessage.textContent =
              "게임 종료 — 내가 승리했습니다.";

          } else {

            onlineMessage.textContent =
              "게임 종료 — 상대방이 승리했습니다.";
          }
        }


        return;
      }


      updateInputState();


      if (
        onlineRoom &&
        onlineRoom.turnPlayer ===
          onlineMyIndex
      ) {

        onlineInput?.focus();
      }
    }
  );


  /* =======================================================
     단어 거절
  ======================================================= */

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


  /* =======================================================
     방 메시지
  ======================================================= */

  socket.on(
    "roomMessage",
    message => {

      if (onlineMessage) {

        onlineMessage.textContent =
          String(
            message || ""
          );
      }
    }
  );


  /* =======================================================
     오류 메시지
  ======================================================= */

  socket.on(
    "errorMessage",
    message => {

      if (onlineMessage) {

        onlineMessage.textContent =
          String(
            message || ""
          );
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


    if (startOnlineButton) {

      startOnlineButton.classList
        .add("hidden");
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
   * 방장이고 2명이며
   * 아직 시작하지 않았을 때만 시작 버튼 표시.
   */

  if (startOnlineButton) {

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


  onlineStarted =
    !!state.started;


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


  /*
   * 서버에서 동일 이벤트가 중복 전달되는 것을
   * 막기 위한 간단한 체크.
   */

  const last =
    onlineHistory.lastElementChild;


  const text =
    `${
      Number(player) === 0
        ? "플레이어 1"
        : "플레이어 2"
    } : ${word}`;


  if (
    last &&
    last.dataset.word ===
      String(word) &&
    last.dataset.player ===
      String(player)
  ) {

    return;
  }


  const div =
    document.createElement(
      "div"
    );


  div.dataset.word =
    String(word || "");


  div.dataset.player =
    String(player ?? "");


  div.textContent =
    text;


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
   * nextTurn이 명확하게 전달된 경우
   */

  if (
    typeof nextTurn ===
      "number"
  ) {

    if (onlineMessage) {

      onlineMessage.textContent =
        nextTurn ===
          onlineMyIndex
          ? "내 차례입니다."
          : "상대방 차례입니다.";
    }
  }


  updateInputState();


  if (
    typeof nextTurn ===
      "number" &&
    nextTurn ===
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
      roomCodeInput?.value ||
      ""
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
   온라인 게임 시작
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

  if (!socket) {

    onlineMessage.textContent =
      "서버에 연결되지 않았습니다.";

    return;
  }


  if (!socket.connected) {

    onlineMessage.textContent =
      "서버에 연결되지 않았습니다.";

    return;
  }


  if (!onlineStarted) {

    onlineMessage.textContent =
      "아직 게임이 시작되지 않았습니다.";

    return;
  }


  if (
    onlineMyIndex < 0 ||
    !onlineRoom
  ) {

    onlineMessage.textContent =
      "방 정보를 불러오는 중입니다.";

    return;
  }


  if (
    typeof onlineRoom.turnPlayer ===
      "number" &&
    onlineRoom.turnPlayer !==
      onlineMyIndex
  ) {

    onlineMessage.textContent =
      "지금은 상대방 차례입니다.";

    return;
  }


  const word =
    normalizeWord(
      onlineInput?.value
    );


  if (!word) {
    return;
  }


  onlineInput.value = "";


  /*
   * 실제 검증은 서버가 담당.
   */

  socket.emit(
    "playWord",
    {
      word
    }
  );
}


/* =========================================================
   Enter
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
   * 싱글 전송
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
   * 새 게임
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
   * 온라인 전송
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
   * 방 코드 자동 대문자
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
   * 닉네임 Enter
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
   * 방 코드 Enter
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
   * 페이지 로드 때는
   * 대용량 단어 데이터를 바로 읽지 않는다.
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
