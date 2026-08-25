"use strict";

/* =========================================================
   끝말잇기 AI - 최종 script.js
   =========================================================
   - 싱글플레이
   - 끝말잇기 AI
   - 두음법칙
   - attack.txt 공격 깊이
   - 온라인 2인 Socket.IO
   - Enter 입력
   - 버튼 입력
   - 데이터 1회 로드
   - 후보 캐시
   - localStorage 통계
   - 서버 game.js와 상태 동기화
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
    new Set();

  result.add(lastChar);

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


    /*
     * 전체 단어 Set
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
   후보 캐시
========================================================= */

function getBaseCandidates(firstChar) {

  if (!firstChar) {
    return [];
  }


  if (
    candidateCache.has(firstChar)
  ) {

    return candidateCache.get(
      firstChar
    );
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

      result.push(
        normalizeWord(word)
      );
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

  const resultSet =
    new Set();


  for (const char of chars) {

    const list =
      getBaseCandidates(char);


    for (const word of list) {

      if (!word) {
        continue;
      }

      if (used.has(word)) {
        continue;
      }

      /*
       * 두음법칙 허용 글자로 가져왔더라도
       * 실제 연결을 한 번 더 확인
       */

      if (
        !canConnect(
          previousWord,
          word
        )
      ) {
        continue;
      }

      if (
        resultSet.has(word)
      ) {
        continue;
      }

      resultSet.add(word);

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

  const resultSet =
    new Set();


  for (const first of chars) {

    const list =
      getBaseCandidates(first);


    for (const word of list) {

      if (!word) {
        continue;
      }

      if (used.has(word)) {
        continue;
      }

      if (
        resultSet.has(word)
      ) {
        continue;
      }

      resultSet.add(word);

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
   미래 위험 분석
========================================================= */

function analyzeFutureRisk(
  info,
  usedWords
) {

  const usedAfter =
    new Set(usedWords);

  usedAfter.add(info.word);


  const opponentCandidates =
    getCandidates(
      info.word,
      usedAfter
    );


  if (
    opponentCandidates.length === 0
  ) {

    return {
      risk: 0,
      botNextCount: 0
    };
  }


  /*
   * 지나치게 큰 탐색 방지
   */

  const limit =
    Math.min(
      opponentCandidates.length,
      60
    );


  let dangerous = 0;


  for (
    let i = 0;
    i < limit;
    i++
  ) {

    const opponentWord =
      opponentCandidates[i];


    const nextUsed =
      new Set(usedAfter);

    nextUsed.add(
      opponentWord
    );


    const botCandidates =
      getCandidates(
        opponentWord,
        nextUsed
      );


    if (
      botCandidates.length === 0
    ) {
      dangerous++;
    }
  }


  return {

    risk:
      dangerous / limit,

    botNextCount:
      Math.max(
        0,
        limit - dangerous
      )
  };
}


/* =========================================================
   난이도
========================================================= */

function getDifficultyStrength() {

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

  if (
    !singleStats.games
  ) {
    return 0.50;
  }


  /*
   * wins = AI 승리
   */

  return (
    singleStats.wins /
    singleStats.games
  );
}


/*
 * AI 승률이 너무 높아지면 약화.
 * 너무 낮으면 강화.
 */

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
   AI 후보 점수
========================================================= */

function scoreCandidate(
  info,
  futureRisk,
  strength,
  winRate,
  isFirstMove
) {

  let score = 0;


  const nextCount =
    info.nextCount;


  const depth =
    info.depth ?? 0;


  const risk =
    futureRisk?.risk ?? 0;


  /* =======================================================
     1. 상대 선택지
  ======================================================= */

  if (nextCount === 0) {

    score +=
      12000;

  } else if (nextCount === 1) {

    score +=
      4200;

  } else if (nextCount <= 4) {

    score +=
      1700;

  } else if (nextCount <= 10) {

    score +=
      500;

  } else {

    score +=
      80;
  }


  /* =======================================================
     2. 공격 단어
  ======================================================= */

  if (
    info.winningAttack
  ) {

    score +=
      900 +
      depth * 45;


    score +=
      Math.min(
        depth,
        30
      ) * 25;


    score +=
      strength * 1800;
  }


  /* =======================================================
     3. 짝수 깊이
  ======================================================= */

  if (
    info.losingAttack
  ) {

    /*
     * 공격 데이터에 들어 있더라도
     * 짝수 깊이는 기본적으로 좋지 않은 수.
     */

    score -=
      350 +
      depth * 15;


    /*
     * 낮은 난이도에서는
     * 가끔 선택할 수 있게 함.
     */

    if (
      strength < 0.40
    ) {
      score += 300;
    }
  }


  /* =======================================================
     4. 일반 단어
  ======================================================= */

  if (
    !info.winningAttack &&
    !info.losingAttack
  ) {

    score +=
      Math.min(
        nextCount,
        30
      ) * 12;
  }


  /* =======================================================
     5. 미래 위험
  ======================================================= */

  if (risk >= 0.75) {

    score -=
      4500;

  } else if (risk >= 0.50) {

    score -=
      2200;

  } else if (risk >= 0.25) {

    score -=
      700;
  }


  /* =======================================================
     6. 승률 조절
  ======================================================= */

  if (
    winRate > 0.60
  ) {

    if (
      info.winningAttack
    ) {

      score -=
        (winRate - 0.60) *
        9000;
    }


    if (
      info.oneShot
    ) {

      score -=
        (winRate - 0.60) *
        7000;
    }

  } else if (
    winRate < 0.40
  ) {

    if (
      info.winningAttack
    ) {

      score +=
        (0.40 - winRate) *
        7000;
    }


    if (
      info.nextCount <= 1
    ) {

      score +=
        (0.40 - winRate) *
        4000;
    }
  }


  /* =======================================================
     7. 첫 수
  ======================================================= */

  if (isFirstMove) {

    /*
     * 첫 수는 무조건 최대한 안전하게.
     *
     * 특히
     * - 한방
     * - 공격 단어
     *
     * 를 피한다.
     */

    if (
      info.oneShot
    ) {

      score -=
        15000;
    }


    if (
      info.winningAttack
    ) {

      score -=
        5000;
    }


    if (
      info.losingAttack
    ) {

      score -=
        1000;
    }


    /*
     * 첫 수에서는 선택지가 너무 적은 것도 피함.
     */

    if (
      nextCount <= 1
    ) {

      score -=
        3000;
    }

  }


  return score;
}


/* =========================================================
   AI 선택
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


  if (
    !candidates.length
  ) {
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


  const winRate =
    getCurrentWinRate();


  const isFirstMove =
    !singleGame.currentWord;


  /*
   * 첫 수는 공격 단어/한방을
   * 아예 후보에서 제거.
   *
   * 단, 안전한 일반 단어가 존재할 때만.
   */

  let working =
    analyzed;


  if (isFirstMove) {

    const safe =
      analyzed.filter(
        info =>
          !info.oneShot &&
          !info.winningAttack &&
          !info.losingAttack
      );


    if (safe.length) {
      working = safe;
    }
  }


  /*
   * 후보가 너무 많으면
   * 기본 점수 상위 100개만
   * 미래 탐색.
   */

  const preliminary =
    working.map(
      info => {

        let base = 0;


        if (
          info.oneShot
        ) {
          base += 12000;
        }


        if (
          info.winningAttack
        ) {

          base +=
            900 +
            (info.depth ?? 0) * 45;
        }


        base +=
          Math.min(
            info.nextCount,
            30
          ) * 12;


        return {
          info,
          base
        };
      }
    );


  preliminary.sort(
    (a, b) =>
      b.base - a.base
  );


  const analysisLimit =
    Math.min(
      preliminary.length,
      80
    );


  const scored = [];


  for (
    let i = 0;
    i < preliminary.length;
    i++
  ) {

    const info =
      preliminary[i].info;


    let futureRisk;


    if (
      i < analysisLimit
    ) {

      futureRisk =
        analyzeFutureRisk(
          info,
          used
        );

    } else {

      futureRisk = {
        risk: 0.20,
        botNextCount:
          info.nextCount
      };
    }


    const score =
      scoreCandidate(
        info,
        futureRisk,
        strength,
        winRate,
        isFirstMove
      );


    scored.push({
      info,
      score
    });
  }


  if (!scored.length) {
    return null;
  }


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /* =======================================================
     난이도별 선택 범위
  ======================================================= */

  let poolSize;


  if (strength >= 0.80) {

    poolSize = 3;

  } else if (strength >= 0.65) {

    poolSize = 5;

  } else if (strength >= 0.50) {

    poolSize = 8;

  } else {

    poolSize = 12;
  }


  /*
   * AI 승률이 너무 높으면
   * 선택 폭을 넓힌다.
   */

  if (
    winRate > 0.60
  ) {

    poolSize += 8;
  }


  /*
   * AI 승률이 낮으면
   * 상위 수를 더 집중해서 사용.
   */

  if (
    winRate < 0.40
  ) {

    poolSize =
      Math.max(
        2,
        poolSize - 3
      );
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


  const bestScore =
    pool[0].score;


  /*
   * 최고 점수와 너무 차이 나는 단어는 제외.
   */

  const reasonable =
    pool.filter(
      item =>
        item.score >=
        bestScore - 900
    );


  const finalPool =
    reasonable.length
      ? reasonable
      : [pool[0]];


  const selected =
    finalPool[
      Math.floor(
        Math.random() *
        finalPool.length
      )
    ];


  return selected
    ? selected.info.word
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


  if (
    !startFirst.length
  ) {
    return null;
  }


  /*
   * 시작 글자 랜덤 섞기
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
   * 1차 검사
   */

  const maxFirstChecks =
    Math.min(
      shuffled.length,
      30
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
     * 후보 일부만 랜덤 검사
     */

    const candidates =
      [...list];


    for (
      let j = 0;
      j < Math.min(
        candidates.length,
        150
      );
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
       * 공격 단어는 시작 단어 금지
       */

      if (
        getAttackDepth(word) != null
      ) {
        continue;
      }


      /*
       * 이미 한방인 시작 단어 금지
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
   * 2차 전체 fallback
   *
   * 공격 단어 제외 + 한방 제외
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


      const next =
        getCandidates(
          word,
          new Set([word])
        );


      if (
        next.length > 0
      ) {

        return word;
      }
    }
  }


  return null;
}


/* =========================================================
   싱글 게임 생성
========================================================= */

function createEmptySingleGame(
  start
) {

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


  /*
   * 첫 단어
   */

  if (
    !singleGame.currentWord
  ) {

    if (
      !allowedFirstChars(
        singleGame.startChar
      ).includes(
        word.at(0)
      )
    ) {

      showMessage(
        `"${singleGame.startChar}"으로 시작하는 단어가 아닙니다.`,
        true
      );

      return false;
    }
  }


  /*
   * 연결
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


  if (onlineInput) {

    onlineInput.disabled =
      !onlineStarted ||
      !socket ||
      !onlineRoom ||
      onlineMyIndex < 0 ||
      onlineRoom.turnPlayer !==
        onlineMyIndex;
  }


  if (onlineSend) {

    onlineSend.disabled =
      !onlineStarted ||
      !socket ||
      !onlineRoom ||
      onlineMyIndex < 0 ||
      onlineRoom.turnPlayer !==
        onlineMyIndex;
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
    40
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


  /*
   * AI가 더 이상 낼 단어가 없음
   */

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


  updateSingleUI();

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


  if (
    !singleGame.currentWord
  ) {
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
    singleGame.history
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
   싱글 게임 종료
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

  if (
    winner === 1
  ) {

    singleStats.wins++;

  } else {

    singleStats.losses++;
  }


  saveStats();

  updateStats();


  if (
    winner === 1
  ) {

    showMessage(
      "끝말잇기 AI 승리"
    );

  } else {

    showMessage(
      "플레이어 승리"
    );
  }


  updateSingleUI();

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


/* =========================================================
   통계 로드
========================================================= */

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


/* =========================================================
   통계 UI
========================================================= */

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
   실제 싱글 게임 생성
========================================================= */

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


  if (startWordInput) {

    startWordInput.value =
      start;
  }


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

  return true;
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


  if (startWordInput) {

    startWordInput.value =
      start;
  }


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

        reconnection: true,

        reconnectionAttempts: 10
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


      updateInputState();
    }
  );


  /* =======================================================
     연결 해제
  ======================================================= */

  socket.on(
    "disconnect",
    () => {

      onlineStarted = false;

      onlineRoom = null;

      onlineMyIndex = -1;


      updateInputState();


      if (onlineMessage) {

        onlineMessage.textContent =
          "온라인 서버 연결이 끊어졌습니다.";
      }
    }
  );


  /* =======================================================
     연결 오류
  ======================================================= */

  socket.on(
    "connect_error",
    error => {

      console.error(
        "Socket.IO 연결 오류:",
        error
      );


      if (onlineMessage) {

        onlineMessage.textContent =
          "온라인 서버에 연결할 수 없습니다.";
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


      updateOnlineTurnMessage();
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
       * 서버가 state를 같이 보내는 경우
       */

      if (
        data?.state
      ) {

        onlineRoom =
          data.state;

        updateOnlineRoom(
          data.state
        );

      } else if (
        data?.room
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


      updateOnlineTurnMessage();

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
     단어 성공
  ======================================================= */

  socket.on(
    "wordPlayed",
    data => {

      if (!data) {
        return;
      }


      /*
       * 서버 state가 있으면
       * 그것을 가장 우선해서 사용.
       */

      if (
        data.state
      ) {

        onlineRoom =
          data.state;

        onlineStarted =
          !!data.state.started;

        updateOnlineRoom(
          data.state
        );
      }


      /*
       * 기록 추가
       *
       * state.history를 사용하는 서버와
       * wordPlayed만 보내는 서버 모두 대응.
       */

      if (
        !data.state
      ) {

        addOnlineHistory(
          data.word,
          data.player,
          data.nextTurn,
          data.depth
        );
      } else {

        renderOnlineHistoryFromState(
          data.state
        );
      }


      /*
       * 서버 nextTurn 우선,
       * 없으면 state.turnPlayer.
       */

      const nextTurn =
        typeof data.nextTurn === "number"
          ? data.nextTurn
          : data.state &&
            typeof data.state.turnPlayer === "number"
              ? data.state.turnPlayer
              : null;


      if (
        nextTurn != null
      ) {

        if (onlineRoom) {

          onlineRoom.turnPlayer =
            nextTurn;
        }
      }


      updateOnlineTurnMessage();

      updateInputState();


      if (
        nextTurn ===
        onlineMyIndex
      ) {

        onlineInput?.focus();
      }
    }
  );


  /* =======================================================
     단어 거부
  ======================================================= */

  socket.on(
    "wordRejected",
    data => {

      if (onlineMessage) {

        onlineMessage.textContent =
          data?.reason ||
          "단어를 사용할 수 없습니다.";
      }


      updateInputState();

      onlineInput?.focus();
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
     서버 오류
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
   온라인 턴 메시지
========================================================= */

function updateOnlineTurnMessage() {

  if (
    !onlineRoom ||
    !onlineStarted
  ) {

    updateInputState();

    return;
  }


  const turn =
    Number(
      onlineRoom.turnPlayer
    );


  if (
    turn === onlineMyIndex
  ) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "내 차례입니다. 단어를 입력하세요.";
    }

  } else {

    if (onlineMessage) {

      onlineMessage.textContent =
        "상대방 차례입니다.";
    }
  }


  updateInputState();
}


/* =========================================================
   온라인 방 UI
========================================================= */

function updateOnlineRoom(
  state
) {

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
   * 방장 + 2명 + 게임 미시작
   */

  if (
    startOnlineButton
  ) {

    const canStart =
      playersLength(state) === 2 &&
      onlineMyIndex === 0 &&
      !state.started;


    startOnlineButton.classList.toggle(
      "hidden",
      !canStart
    );
  }


  onlineStarted =
    !!state.started;


  updateInputState();
}


/* =========================================================
   플레이어 수 안전 처리
========================================================= */

function playersLength(state) {

  return Array.isArray(
    state?.players
  )
    ? state.players.length
    : 0;
}


/* =========================================================
   온라인 기록 렌더링
========================================================= */

function renderOnlineHistoryFromState(
  state
) {

  if (!onlineHistory) {
    return;
  }


  onlineHistory.innerHTML = "";


  const history =
    Array.isArray(
      state?.history
    )
      ? state.history
      : [];


  for (
    const item
    of history
  ) {

    addOnlineHistory(
      item.word,
      item.player,
      null,
      item.depth,
      false
    );
  }
}


/* =========================================================
   온라인 기록 추가
========================================================= */

function addOnlineHistory(
  word,
  player,
  nextTurn,
  depth,
  updateState = true
) {

  if (!onlineHistory) {
    return;
  }


  if (!word) {
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


  if (
    nextTurn != null &&
    onlineMessage
  ) {

    onlineMessage.textContent =
      Number(nextTurn) ===
        onlineMyIndex
        ? "내 차례입니다."
        : "상대방 차례입니다.";
  }


  if (updateState) {
    updateInputState();
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

    if (onlineMessage) {

      onlineMessage.textContent =
        "서버에 연결되지 않았습니다.";
    }

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
    onlineMyIndex < 0 ||
    !onlineRoom
  ) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "방 정보를 불러오는 중입니다.";
    }

    return;
  }


  if (
    typeof onlineRoom.turnPlayer ===
      "number" &&
    onlineRoom.turnPlayer !==
      onlineMyIndex
  ) {

    if (onlineMessage) {

      onlineMessage.textContent =
        "지금은 상대방 차례입니다.";
    }

    return;
  }


  const word =
    normalizeWord(
      onlineInput?.value
    );


  if (!word) {
    return;
  }


  if (onlineInput) {
    onlineInput.value = "";
  }


  socket.emit(
    "playWord",
    {
      word
    }
  );
}


/* =========================================================
   Enter - 싱글
========================================================= */

function handleSingleKeydown(
  event
) {

  if (
    event.key !== "Enter"
  ) {
    return;
  }


  event.preventDefault();

  event.stopPropagation();


  sendSingleWord();
}


/* =========================================================
   Enter - 온라인
========================================================= */

function handleOnlineKeydown(
  event
) {

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

  /* -------------------------------------------------------
     탭
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     싱글 입력 버튼
  ------------------------------------------------------- */

  singleSend?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      sendSingleWord();
    }
  );


  /* -------------------------------------------------------
     싱글 Enter
  ------------------------------------------------------- */

  singleInput?.addEventListener(
    "keydown",
    handleSingleKeydown
  );


  /* -------------------------------------------------------
     새 게임
  ------------------------------------------------------- */

  restartButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      startNewGame();
    }
  );


  /* -------------------------------------------------------
     랜덤 시작
  ------------------------------------------------------- */

  newStartButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      randomStart();
    }
  );


  /* -------------------------------------------------------
     온라인 방 생성
  ------------------------------------------------------- */

  createButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      createOnlineRoom();
    }
  );


  /* -------------------------------------------------------
     온라인 방 참가
  ------------------------------------------------------- */

  joinButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      joinOnlineRoom();
    }
  );


  /* -------------------------------------------------------
     온라인 시작
  ------------------------------------------------------- */

  startOnlineButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      startOnlineGame();
    }
  );


  /* -------------------------------------------------------
     온라인 전송
  ------------------------------------------------------- */

  onlineSend?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      sendOnlineWord();
    }
  );


  /* -------------------------------------------------------
     온라인 Enter
  ------------------------------------------------------- */

  onlineInput?.addEventListener(
    "keydown",
    handleOnlineKeydown
  );


  /* -------------------------------------------------------
     방 코드 자동 대문자
  ------------------------------------------------------- */

  roomCodeInput?.addEventListener(
    "input",
    () => {

      if (!roomCodeInput) {
        return;
      }


      roomCodeInput.value =
        roomCodeInput.value
          .replace(/\s+/g, "")
          .toUpperCase();
    }
  );


  /* -------------------------------------------------------
     닉네임 Enter
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     방 코드 Enter
  ------------------------------------------------------- */

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
   * 페이지 처음 열었을 때는
   * 대용량 단어 데이터를 로드하지 않음.
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
