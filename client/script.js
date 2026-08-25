"use strict";

/* =========================================================
   끝말잇기 AI - 최종 안정화 script.js
   ---------------------------------------------------------
   - 싱글플레이
   - AI 1~5단계"use strict";

/* =========================================================
   끝말잇기 AI - 최종 통합 script.js
   ---------------------------------------------------------
   - 싱글플레이
   - AI 난이도
   - 두음법칙
   - attack.txt 깊이 표시
   - 온라인 2인 Socket.IO
   - Enter 입력
   - 버튼 입력
   - 데이터 1회 로드
   - 후보 캐시
   - 입력창 잠김 버그 방지
   - 중복 Socket 이벤트 제거
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

let dataLoadingPromise = null;


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

let onlineLastHistoryLength = 0;


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
   메시지
========================================================= */

function showMessage(text, error = false) {

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


function showOnlineMessage(text) {

  if (!onlineMessage) {
    return;
  }

  onlineMessage.textContent =
    String(text || "");
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
   * 녀도 허용
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

  if (dataLoadingPromise) {
    return dataLoadingPromise;
  }

  dataLoadingPromise =
    (async () => {

      try {

        showMessage(
          "단어 데이터를 준비하는 중..."
        );

        const response =
          await fetch(
            "/api/data",
            {
              method: "GET",
              cache: "no-store",
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
            text.slice(0, 500)
          );

          throw new Error(
            "서버에서 단어 데이터를 JSON으로 받지 못했습니다."
          );
        }

        const data =
          await response.json();

        if (
          !data ||
          typeof data !== "object"
        ) {

          throw new Error(
            "단어 데이터 형식이 올바르지 않습니다."
          );
        }

        DATA = data;

        byFirst =
          data.byFirst &&
          typeof data.byFirst === "object"
            ? data.byFirst
            : Object.create(null);

        attackDepth =
          data.attackDepth &&
          typeof data.attackDepth === "object"
            ? data.attackDepth
            : Object.create(null);

        dueum =
          data.dueum &&
          typeof data.dueum === "object"
            ? data.dueum
            : Object.create(null);

        /*
         * 캐시 초기화
         */

        candidateCache.clear();

        allWords =
          new Set();

        /*
         * 서버가 words 배열도 제공하는 경우
         */

        if (Array.isArray(data.words)) {

          for (const word of data.words) {

            const normalized =
              normalizeWord(word);

            if (normalized) {
              allWords.add(normalized);
            }
          }
        }

        /*
         * byFirst에서도 전체 단어 구성
         */

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

        if (!allWords.size) {

          throw new Error(
            "전체 단어 목록이 비어 있습니다."
          );
        }

        dataReady = true;

        console.log(
          `[끝말잇기] 전체 단어 ${allWords.size}개 로드`
        );

        console.log(
          `[끝말잇기] 공격 단어 ${Object.keys(attackDepth).length}개 로드`
        );

        showMessage(
          "단어 데이터를 준비했습니다."
        );

        return true;

      } catch (error) {

        console.error(
          "단어 데이터 로드 실패:",
          error
        );

        dataReady = false;

        showMessage(
          `단어 데이터를 불러오지 못했습니다: ${
            error?.message || "알 수 없는 오류"
          }`,
          true
        );

        return false;

      } finally {

        dataLoadingPromise = null;
      }

    })();

  return dataLoadingPromise;
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

  const list =
    byFirst[firstChar];

  const result = [];

  if (Array.isArray(list)) {

    for (const word of list) {

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
      return 0.85;

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

  /*
   * AI 승률이 너무 높으면 약화
   */

  if (winRate > 0.70) {

    strength -= 0.18;

  } else if (winRate > 0.60) {

    strength -= 0.08;
  }

  /*
   * AI 승률이 너무 낮으면 강화
   */

  else if (winRate < 0.30) {

    strength += 0.18;

  } else if (winRate < 0.40) {

    strength += 0.08;
  }

  return Math.max(
    0.15,
    Math.min(
      0.95,
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
   * 즉시 승리
   */

  if (info.oneShot) {

    score +=
      12000 +
      strength * 2000;

  } else if (
    nextCount === 1
  ) {

    score += 4200;

  } else if (
    nextCount <= 4
  ) {

    score += 1700;

  } else if (
    nextCount <= 10
  ) {

    score += 500;

  } else {

    score += 80;
  }

  /*
   * 공격 단어
   */

  if (info.winningAttack) {

    score +=
      900 +
      depth * 55;

    score +=
      strength * 1800;

    /*
     * 깊은 공격 단어일수록
     * 높은 점수
     */

    score +=
      Math.min(
        depth,
        30
      ) * 25;
  }

  /*
   * 짝수 공격 깊이
   */

  if (info.losingAttack) {

    score -=
      500 +
      depth * 20;
  }

  /*
   * 일반 단어
   */

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

  /*
   * 첫 수에서는
   * 공격 단어/한방을 피함.
   *
   * 단, Lv5는 가능한 경우
   * 조금 더 공격적으로 움직일 수 있음.
   */

  if (!currentWord) {

    if (info.oneShot) {
      score -= 10000;
    }

    if (info.winningAttack) {
      score -=
        strength >= 0.82
          ? 2200
          : 7000;
    }

    if (info.losingAttack) {
      score -= 1500;
    }
  }

  /*
   * 낮은 난이도에서는
   * 공격 단어보다 일반 단어 선호.
   */

  if (strength <= 0.30) {

    if (info.winningAttack) {
      score -= 2200;
    }

    if (!info.winningAttack) {
      score += 400;
    }
  }

  /*
   * 승률 보정
   */

  const winRate =
    getCurrentWinRate();

  if (winRate > 0.65) {

    if (info.winningAttack) {
      score -=
        (winRate - 0.65) *
        6000;
    }

    if (info.oneShot) {
      score -=
        (winRate - 0.65) *
        7000;
    }
  }

  if (winRate < 0.35) {

    if (info.winningAttack) {
      score +=
        (0.35 - winRate) *
        5000;
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

  const strength =
    getAdjustedStrength();

  const analyzed = [];

  for (const word of candidates) {

    analyzed.push(
      analyzeCandidate(
        word,
        used
      )
    );
  }

  /*
   * Lv1
   *
   * 가능한 한 평범한 단어를 사용.
   * 공격 단어/한방을 적극적으로 피한다.
   */

  const level =
    Number(
      difficulty?.value || 3
    );

  if (level === 1) {

    const normal =
      analyzed.filter(
        info =>
          !info.winningAttack &&
          !info.losingAttack &&
          !info.oneShot &&
          info.nextCount >= 2
      );

    if (normal.length) {

      const shuffled =
        [...normal];

      shuffleArray(shuffled);

      return shuffled[0].word;
    }
  }

  /*
   * Lv2도 공격 단어를 상당히 억제.
   */

  if (level === 2) {

    const normal =
      analyzed.filter(
        info =>
          !info.winningAttack &&
          !info.oneShot &&
          info.nextCount >= 1
      );

    if (normal.length) {

      const scoredNormal =
        normal.map(info => ({
          info,
          score:
            scoreCandidate(
              info,
              strength,
              singleGame.currentWord
            )
        }));

      scoredNormal.sort(
        (a, b) =>
          b.score - a.score
      );

      const pool =
        scoredNormal.slice(
          0,
          Math.min(
            8,
            scoredNormal.length
          )
        );

      return pool[
        Math.floor(
          Math.random() *
          pool.length
        )
      ].info.word;
    }
  }

  /*
   * 일반 난이도
   */

  const scored =
    analyzed.map(info => ({

      info,

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

  if (level >= 5) {

    /*
     * Lv5는 공격 우선.
     * 다만 모든 경우 한방만 선택하지 않음.
     */

    poolSize = 3;

  } else if (level === 4) {

    poolSize = 4;

  } else if (level === 3) {

    poolSize = 7;

  } else {

    poolSize = 10;
  }

  /*
   * AI 승률이 너무 높으면
   * 선택 폭을 넓힌다.
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
   * 상위권 중에서 랜덤 선택.
   * 단순 최고점 고정으로 인해
   * 항상 같은 패턴이 나오는 것을 방지.
   */

  const bestScore =
    pool[0].score;

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

  return selected?.info?.word || null;
}


/* =========================================================
   배열 섞기
========================================================= */

function shuffleArray(array) {

  for (
    let i = array.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );

    [
      array[i],
      array[j]
    ] =
    [
      array[j],
      array[i]
    ];
  }

  return array;
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

  const firsts =
    shuffleArray(
      [...startFirst]
    );

  /*
   * 충분히 검사
   */

  for (const first of firsts) {

    const list =
      getBaseCandidates(first);

    if (!list.length) {
      continue;
    }

    const candidates =
      shuffleArray(
        [...list]
      );

    /*
     * 전체를 검사하되
     * 너무 큰 경우 일부만 우선 검사
     */

    const limit =
      Math.min(
        candidates.length,
        300
      );

    for (
      let i = 0;
      i < limit;
      i++
    ) {

      const word =
        candidates[i];

      /*
       * 공격 단어 시작 금지
       */

      if (
        getAttackDepth(word) != null
      ) {
        continue;
      }

      /*
       * 바로 끝나는 시작 단어 금지
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
   * 최후 fallback.
   * 공격 단어가 아니고
   * 목록에 존재하는 단어.
   */

  for (const first of firsts) {

    const list =
      getBaseCandidates(first);

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

    history:
      [],

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
   싱글 게임 생성
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

  /*
   * 현재 플레이어 확인
   */

  if (
    singleGame.turnPlayer !== player
  ) {

    console.warn(
      "잘못된 턴에서 단어가 입력됨"
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

  /*
   * 싱글
   */

  const singleDisabled =
    !singleGame ||
    singleGame.finished ||
    singleThinking ||
    singleGame.turnPlayer !== 0;

  if (singleInput) {

    singleInput.disabled =
      singleDisabled;
  }

  if (singleSend) {

    singleSend.disabled =
      singleDisabled;
  }

  /*
   * 온라인
   *
   * 반드시 실제 서버 상태 기준.
   */

  const onlineDisabled =
    !onlineStarted ||
    !socket ||
    !socket.connected ||
    !onlineRoom ||
    onlineMyIndex < 0 ||
    onlineRoom.turnPlayer !==
      onlineMyIndex;

  if (onlineInput) {

    onlineInput.disabled =
      onlineDisabled;
  }

  if (onlineSend) {

    onlineSend.disabled =
      onlineDisabled;
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

  if (singleGame.finished) {
    return;
  }

  if (singleThinking) {
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
   * 먼저 입력창 비우기
   */

  if (singleInput) {
    singleInput.value = "";
  }

  const success =
    playSingleWord(
      word,
      0
    );

  if (!success) {

    if (singleInput) {

      singleInput.value =
        word;

      singleInput.focus();
    }

    return;
  }

  checkSingleFinished();

  if (
    !singleGame ||
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
   * 브라우저가 화면을 먼저 갱신하도록
   * 약간의 지연.
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

    singleGame.finished =
      true;

    singleGame.winner =
      0;

    singleGame.loser =
      1;

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

    singleGame.finished =
      true;

    singleGame.winner =
      0;

    singleGame.loser =
      1;

    finishSingleGame();

    singleThinking = false;

    updateInputState();

    return;
  }

  singleThinking = false;

  checkSingleFinished();

  if (
    singleGame &&
    !singleGame.finished
  ) {

    showMessage(
      "당신의 차례입니다."
    );
  }

  updateInputState();

  if (
    singleGame &&
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

  if (!candidates.length) {

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
}


/* =========================================================
   싱글 종료
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

  if (!dataReady) {

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

  if (singleInput) {

    singleInput.disabled =
      false;

    singleInput.focus();
  }
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

  if (singleInput) {

    singleInput.disabled =
      false;

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

    updateInputState();

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

    showOnlineMessage(
      "Socket.IO를 불러오지 못했습니다."
    );

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

          reconnectionAttempts:
            Infinity
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


  /* =======================================================
     연결
  ======================================================= */

  socket.on(
    "connect",
    () => {

      console.log(
        "[온라인] 연결:",
        socket.id
      );

      showOnlineMessage(
        "서버에 연결되었습니다."
      );

      updateInputState();
    }
  );


  /* =======================================================
     연결 해제
  ======================================================= */

  socket.on(
    "disconnect",
    reason => {

      console.log(
        "[온라인] 연결 해제:",
        reason
      );

      onlineStarted = false;

      updateInputState();

      showOnlineMessage(
        "온라인 서버 연결이 끊어졌습니다."
      );
    }
  );


  /* =======================================================
     연결 오류
  ======================================================= */

  socket.on(
    "connect_error",
    error => {

      console.error(
        "[온라인] Socket 오류:",
        error
      );

      showOnlineMessage(
        "온라인 서버에 연결할 수 없습니다."
      );

      updateInputState();
    }
  );


  /* =======================================================
     방 생성
  ======================================================= */

  socket.on(
    "roomCreated",
    data => {

      console.log(
        "[온라인] roomCreated:",
        data
      );

      if (!data) {
        return;
      }

      const code =
        data.code ||
        data.roomCode ||
        "";

      if (roomCodeInput) {

        roomCodeInput.value =
          code;
      }

      showOnlineMessage(
        `방 생성 완료: ${code}`
      );

      /*
       * 서버가 room/state도 같이 주는 경우
       */

      if (data.state) {

        onlineRoom =
          data.state;

        updateOnlineRoom(
          data.state
        );
      }

      if (data.room) {

        onlineRoom =
          data.room;

        updateOnlineRoom(
          data.room
        );
      }
    }
  );


  /* =======================================================
     방 참가
  ======================================================= */

  socket.on(
    "joinedRoom",
    data => {

      console.log(
        "[온라인] joinedRoom:",
        data
      );

      if (!data) {
        return;
      }

      const code =
        data.code ||
        data.roomCode ||
        "";

      if (roomCodeInput) {

        roomCodeInput.value =
          code;
      }

      showOnlineMessage(
        `방 참가 완료: ${code}`
      );

      if (data.state) {

        onlineRoom =
          data.state;

        updateOnlineRoom(
          data.state
        );
      }

      if (data.room) {

        onlineRoom =
          data.room;

        updateOnlineRoom(
          data.room
        );
      }
    }
  );


  /* =======================================================
     방 상태
  ======================================================= */

  socket.on(
    "roomState",
    state => {

      console.log(
        "[온라인] roomState:",
        state
      );

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

      /*
       * 서버가 history를 보내면
       * 화면에도 동기화
       */

      syncOnlineHistory(
        state.history
      );

      if (!onlineStarted) {

        showOnlineMessage(
          state.players?.length === 2
            ? "방장이 게임을 시작할 수 있습니다."
            : "상대방을 기다리는 중입니다."
        );

        updateInputState();

        return;
      }

      if (
        state.turnPlayer ===
        onlineMyIndex
      ) {

        showOnlineMessage(
          "내 차례입니다. 단어를 입력하세요."
        );

        if (onlineInput) {

          onlineInput.disabled =
            false;

          onlineInput.focus();
        }

      } else {

        showOnlineMessage(
          "상대방 차례입니다."
        );

        if (onlineInput) {

          onlineInput.disabled =
            true;
        }
      }

      updateInputState();
    }
  );


  /* =======================================================
     게임 시작
  ======================================================= */

  socket.on(
    "onlineStarted",
    data => {

      console.log(
        "[온라인] onlineStarted:",
        data
      );

      onlineStarted =
        true;

      /*
       * 가능한 여러 서버 형식 호환
       */

      const state =
        data?.state ||
        data?.room ||
        data;

      if (
        state &&
        typeof state === "object"
      ) {

        if (
          state.players ||
          state.turnPlayer != null ||
          state.code
        ) {

          onlineRoom =
            state;

          updateOnlineRoom(
            state
          );

          syncOnlineHistory(
            state.history
          );
        }
      }

      showOnlineMessage(
        "게임이 시작되었습니다."
      );

      updateInputState();

      if (
        onlineRoom &&
        onlineRoom.turnPlayer ===
        onlineMyIndex
      ) {

        if (onlineInput) {

          onlineInput.disabled =
            false;

          onlineInput.focus();
        }

        showOnlineMessage(
          "내 차례입니다. 단어를 입력하세요."
        );

      } else if (onlineRoom) {

        if (onlineInput) {

          onlineInput.disabled =
            true;
        }

        showOnlineMessage(
          "상대방 차례입니다."
        );
      }
    }
  );


  /* =======================================================
     단어 플레이
  ======================================================= */

  socket.on(
    "wordPlayed",
    data => {

      console.log(
        "[온라인] wordPlayed:",
        data
      );

      if (!data) {
        return;
      }

      /*
       * 서버 state 우선
       */

      if (data.state) {

        onlineRoom =
          data.state;

        onlineStarted =
          !!data.state.started;

        updateOnlineRoom(
          data.state
        );

        syncOnlineHistory(
          data.state.history
        );

      } else {

        /*
         * state가 없는 서버와도 호환
         */

        const player =
          Number(
            data.player
          );

        const word =
          normalizeWord(
            data.word
          );

        if (word) {

          addOnlineHistory(
            word,
            player,
            data.nextTurn,
            data.depth
          );
        }

        if (
          onlineRoom &&
          typeof data.nextTurn ===
            "number"
        ) {

          onlineRoom.turnPlayer =
            data.nextTurn;
        }
      }

      /*
       * 게임 종료
       */

      if (
        data.finished ||
        data.state?.finished
      ) {

        onlineStarted = true;

        const winner =
          data.winner ??
          data.state?.winner;

        if (
          winner != null
        ) {

          showOnlineMessage(
            Number(winner) ===
              onlineMyIndex
              ? "내가 승리했습니다."
              : "상대방이 승리했습니다."
          );
        }

        updateInputState();

        return;
      }

      /*
       * 다음 턴
       */

      const nextTurn =
        data.nextTurn ??
        data.state?.turnPlayer ??
        onlineRoom?.turnPlayer;

      if (
        nextTurn != null
      ) {

        if (
          Number(nextTurn) ===
          onlineMyIndex
        ) {

          showOnlineMessage(
            "내 차례입니다. 단어를 입력하세요."
          );

          if (onlineInput) {

            onlineInput.disabled =
              false;

            onlineInput.focus();
          }

        } else {

          showOnlineMessage(
            "상대방 차례입니다."
          );

          if (onlineInput) {

            onlineInput.disabled =
              true;
          }
        }
      }

      updateInputState();
    }
  );


  /* =======================================================
     잘못된 단어
  ======================================================= */

  socket.on(
    "wordRejected",
    data => {

      console.log(
        "[온라인] wordRejected:",
        data
      );

      showOnlineMessage(
        data?.reason ||
        "단어를 사용할 수 없습니다."
      );

      /*
       * 서버가 상태를 같이 보내는 경우
       */

      if (data?.state) {

        onlineRoom =
          data.state;

        onlineStarted =
          !!data.state.started;

        updateOnlineRoom(
          data.state
        );
      }

      updateInputState();

      if (
        onlineInput &&
        !onlineInput.disabled
      ) {

        onlineInput.focus();
      }
    }
  );


  /* =======================================================
     방 메시지
  ======================================================= */

  socket.on(
    "roomMessage",
    message => {

      showOnlineMessage(
        message
      );
    }
  );


  /* =======================================================
     오류
  ======================================================= */

  socket.on(
    "errorMessage",
    message => {

      showOnlineMessage(
        message
      );
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

    onlineRoom = null;

    onlineStarted = false;

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
        state.code ||
        state.roomCode ||
        ""
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

        /*
         * 가장 정확한 판별
         */

        if (
          socket &&
          player &&
          (
            player.id === socket.id ||
            player.socketId === socket.id
          )
        ) {

          onlineMyIndex =
            index;
        }
      }
    );
  }


  /*
   * players가 배열이 아니더라도
   * 서버가 playerIndex를 직접 보내는 경우
   */

  if (
    onlineMyIndex < 0 &&
    typeof state.myIndex === "number"
  ) {

    onlineMyIndex =
      state.myIndex;
  }

  if (
    onlineMyIndex < 0 &&
    typeof state.playerIndex === "number"
  ) {

    onlineMyIndex =
      state.playerIndex;
  }


  /*
   * 서버가 내 socket id 대신
   * index를 직접 제공하는 경우
   */

  if (
    onlineMyIndex < 0 &&
    typeof state.selfIndex === "number"
  ) {

    onlineMyIndex =
      state.selfIndex;
  }


  /*
   * 방장 시작 버튼
   */

  if (startOnlineButton) {

    const isHost =
      onlineMyIndex === 0;

    const enoughPlayers =
      Array.isArray(
        state.players
      ) &&
      state.players.length === 2;

    const started =
      !!state.started;

    if (
      isHost &&
      enoughPlayers &&
      !started
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
   온라인 기록 동기화
========================================================= */

function syncOnlineHistory(history) {

  if (!onlineHistory) {
    return;
  }

  if (!Array.isArray(history)) {
    return;
  }

  /*
   * 같은 history를 계속 추가하지 않도록
   * 길이를 확인.
   */

  if (
    history.length ===
    onlineLastHistoryLength
  ) {
    return;
  }

  onlineHistory.innerHTML = "";

  for (const item of history) {

    addOnlineHistory(
      item?.word,
      item?.player,
      null,
      item?.depth
    );
  }

  onlineLastHistoryLength =
    history.length;
}


/* =========================================================
   온라인 기록 추가
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

  word =
    normalizeWord(word);

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
    nextTurn != null
  ) {

    const next =
      Number(nextTurn);

    if (
      next === onlineMyIndex
    ) {

      showOnlineMessage(
        "내 차례입니다."
      );

    } else {

      showOnlineMessage(
        "상대방 차례입니다."
      );
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

  if (!s.connected) {

    showOnlineMessage(
      "서버에 연결하는 중입니다."
    );

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

  showOnlineMessage(
    "방을 생성하는 중..."
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

  if (!s.connected) {

    showOnlineMessage(
      "서버에 연결하는 중입니다."
    );

    return;
  }

  const code =
    String(
      roomCodeInput?.value || ""
    )
      .trim()
      .toUpperCase();

  if (!code) {

    showOnlineMessage(
      "방 코드를 입력해주세요."
    );

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

  showOnlineMessage(
    "방에 참가하는 중..."
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

    showOnlineMessage(
      "서버에 연결하는 중입니다."
    );

    return;
  }

  s.emit(
    "startOnline"
  );

  showOnlineMessage(
    "게임을 시작하는 중..."
  );
}


/* =========================================================
   온라인 단어 전송
========================================================= */

function sendOnlineWord() {

  if (!socket) {

    showOnlineMessage(
      "서버에 연결되지 않았습니다."
    );

    return;
  }

  if (!socket.connected) {

    showOnlineMessage(
      "서버에 연결되어 있지 않습니다."
    );

    return;
  }

  if (!onlineStarted) {

    showOnlineMessage(
      "아직 게임이 시작되지 않았습니다."
    );

    return;
  }

  if (
    onlineMyIndex < 0
  ) {

    showOnlineMessage(
      "내 플레이어 정보를 확인하는 중입니다."
    );

    return;
  }

  if (!onlineRoom) {

    showOnlineMessage(
      "방 정보를 불러오는 중입니다."
    );

    return;
  }

  if (
    typeof onlineRoom.turnPlayer ===
      "number" &&
    onlineRoom.turnPlayer !==
      onlineMyIndex
  ) {

    showOnlineMessage(
      "지금은 상대방 차례입니다."
    );

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

  if (onlineInput) {
    onlineInput.value = "";
  }

  /*
   * 서버에는 word만 보내는 것이 가장 안전.
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
   * 온라인 시작
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

  console.log(
    "[끝말잇기] script.js 초기화"
  );

  loadStats();

  updateStats();

  bindEvents();

  /*
   * 처음부터 대용량 데이터를 로드하지 않음.
   */

  showMessage(
    "새 게임을 눌러 시작하세요."
  );

  /*
   * 초기에는 입력창을 확실히 잠금.
   * 게임이 시작되면 updateInputState에서 해제.
   */

  if (singleInput) {
    singleInput.disabled = true;
  }

  if (singleSend) {
    singleSend.disabled = true;
  }

  if (onlineInput) {
    onlineInput.disabled = true;
  }

  if (onlineSend) {
    onlineSend.disabled = true;
  }

  /*
   * 기본 탭
   */

  const activeTab =
    document.querySelector(
      ".tabs button.active"
    );

  if (
    activeTab?.dataset?.mode ===
    "online"
  ) {

    connectSocket();
  }

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
   - 두음법칙
   - attack.txt 깊이
   - 온라인 2인 Socket.IO
   - Enter 입력
   - 버튼 입력
   - 데이터 1회 로드
   - 후보 캐시
   - 중복 Socket 이벤트 제거
   - 대용량 데이터 로딩 안정화
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

let dataLoadingPromise = null;


/* =========================================================
   후보 캐시
========================================================= */

const candidateCache =
  new Map();


/*
 * 캐시 최대 크기
 *
 * 너무 많은 상태를 오래 유지하지 않도록
 * 제한한다.
 */
const MAX_CANDIDATE_CACHE = 3000;


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
   온라인 메시지
========================================================= */

function showOnlineMessage(
  text,
  error = false
) {

  if (!onlineMessage) {
    return;
  }

  onlineMessage.textContent =
    text || "";

  onlineMessage.classList.toggle(
    "error",
    !!error
  );
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
   * 늄 -> 윰
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
   연결 검사
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

  /*
   * 이미 완료
   */

  if (dataReady) {
    return true;
  }


  /*
   * 이미 다른 곳에서 로딩 중이면
   * 같은 요청을 또 보내지 않는다.
   */

  if (dataLoadingPromise) {
    return dataLoadingPromise;
  }


  dataLoadingPromise =
    (async () => {

      try {

        showMessage(
          "단어 데이터를 불러오는 중..."
        );


        const controller =
          new AbortController();


        /*
         * 지나치게 오래 걸리는 요청 방지.
         *
         * 서버가 실제로 데이터를 생성하는 시간이
         * 긴 경우를 고려해 5분으로 설정.
         */

        const timeout =
          setTimeout(
            () => controller.abort(),
            300000
          );


        let response;

        try {

          response =
            await fetch(
              "/api/data",
              {
                method: "GET",

                cache:
                  "force-cache",

                headers: {
                  "Accept":
                    "application/json"
                },

                signal:
                  controller.signal
              }
            );

        } finally {

          clearTimeout(timeout);
        }


        if (!response.ok) {

          throw new Error(
            `HTTP ${response.status}`
          );
        }


        const contentType =
          response.headers
            .get("content-type") || "";


        /*
         * JSON이 아닌 응답 방지
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
            "서버가 JSON 데이터를 반환하지 않았습니다."
          );
        }


        /*
         * JSON 파싱
         */

        const data =
          await response.json();


        if (
          !data ||
          typeof data !== "object"
        ) {

          throw new Error(
            "잘못된 데이터 형식입니다."
          );
        }


        DATA = data;


        byFirst =
          DATA.byFirst &&
          typeof DATA.byFirst === "object"
            ? DATA.byFirst
            : Object.create(null);


        attackDepth =
          DATA.attackDepth &&
          typeof DATA.attackDepth === "object"
            ? DATA.attackDepth
            : Object.create(null);


        dueum =
          DATA.dueum &&
          typeof DATA.dueum === "object"
            ? DATA.dueum
            : Object.create(null);


        /*
         * 후보 캐시 초기화
         */

        candidateCache.clear();


        /*
         * 전체 단어 Set 생성
         *
         * 서버가 allWords를 제공하면 그것을 우선 사용.
         */

        allWords =
          new Set();


        if (
          Array.isArray(DATA.allWords)
        ) {

          for (
            const word
            of DATA.allWords
          ) {

            if (
              typeof word === "string" &&
              word
            ) {

              allWords.add(word);
            }
          }

        } else {

          /*
           * 기존 서버 형식 호환
           */

          for (
            const list
            of Object.values(byFirst)
          ) {

            if (!Array.isArray(list)) {
              continue;
            }

            for (
              const word
              of list
            ) {

              if (
                typeof word === "string" &&
                word
              ) {

                allWords.add(word);
              }
            }
          }
        }


        /*
         * 데이터가 비어 있으면 실패 처리
         */

        if (
          allWords.size === 0
        ) {

          throw new Error(
            "단어 데이터가 비어 있습니다."
          );
        }


        dataReady = true;


        console.log(
          `단어 데이터 로드 완료: ${allWords.size.toLocaleString()}개`
        );


        showMessage(
          "단어 데이터 준비 완료."
        );


        return true;

      } catch (error) {

        console.error(
          "데이터 로드 실패:",
          error
        );


        dataReady = false;


        if (
          error?.name === "AbortError"
        ) {

          showMessage(
            "단어 데이터 로딩 시간이 너무 오래 걸렸습니다.",
            true
          );

        } else {

          showMessage(
            "단어 데이터를 불러오지 못했습니다.",
            true
          );
        }


        return false;

      } finally {

        dataLoadingPromise = null;
      }

    })();


  return dataLoadingPromise;
}


/* =========================================================
   기본 후보
========================================================= */

function getBaseCandidates(
  firstChar
) {

  if (!firstChar) {
    return [];
  }


  if (
    candidateCache.has(
      `base:${firstChar}`
    )
  ) {

    return candidateCache.get(
      `base:${firstChar}`
    );
  }


  const result = [];

  const list =
    byFirst[firstChar];


  if (Array.isArray(list)) {

    for (
      const word
      of list
    ) {

      if (
        typeof word !== "string"
      ) {
        continue;
      }

      result.push(word);
    }
  }


  /*
   * 캐시
   */

  if (
    candidateCache.size <
    MAX_CANDIDATE_CACHE
  ) {

    candidateCache.set(
      `base:${firstChar}`,
      result
    );
  }


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


  for (
    const char
    of chars
  ) {

    const list =
      getBaseCandidates(char);


    for (
      const word
      of list
    ) {

      if (
        used.has(word)
      ) {
        continue;
      }


      /*
       * 두음법칙으로 같은 단어가
       * 여러 경로에서 들어오는 것 방지
       */

      if (
        seen.has(word)
      ) {
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


  for (
    const first
    of chars
  ) {

    const list =
      getBaseCandidates(first);


    for (
      const word
      of list
    ) {

      if (
        used.has(word)
      ) {
        continue;
      }


      if (
        seen.has(word)
      ) {
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


  const number =
    Number(value);


  return Number.isFinite(number)
    ? number
    : null;
}


/* =========================================================
   공격 종류
========================================================= */

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
      return 0.86;

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


  return (
    singleStats.wins /
    singleStats.games
  );
}


/* =========================================================
   AI 강도 자동 보정
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
   * 조금 약화.
   */

  if (
    winRate > 0.70
  ) {

    strength -= 0.15;

  } else if (
    winRate > 0.60
  ) {

    strength -= 0.07;

  } else if (
    winRate < 0.30
  ) {

    strength += 0.15;

  } else if (
    winRate < 0.40
  ) {

    strength += 0.07;
  }


  return Math.max(
    0.15,
    Math.min(
      0.95,
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


  /* =======================================================
     선택지
  ======================================================= */

  if (
    info.oneShot
  ) {

    score +=
      12000;

  } else if (
    nextCount === 1
  ) {

    score +=
      4200;

  } else if (
    nextCount <= 3
  ) {

    score +=
      1900;

  } else if (
    nextCount <= 8
  ) {

    score +=
      650;

  } else if (
    nextCount <= 15
  ) {

    score +=
      300;

  } else {

    score +=
      100;
  }


  /* =======================================================
     공격 단어
  ======================================================= */

  if (
    info.winningAttack
  ) {

    /*
     * 높은 난이도일수록
     * 깊은 공격 단어를 적극적으로 사용.
     */

    score +=
      900 +
      Math.min(depth, 31) * 55;


    score +=
      strength * 1600;


    /*
     * 상대 선택지가 적은 공격 단어는
     * 더욱 강하게 평가.
     */

    if (
      nextCount <= 3
    ) {

      score +=
        650;
    }
  }


  /* =======================================================
     짝수 공격
  ======================================================= */

  if (
    info.losingAttack
  ) {

    /*
     * 일반적으로 피한다.
     */

    score -=
      900 +
      depth * 25;


    /*
     * 저난이도에서는
     * 가끔 섞일 수 있도록 한다.
     */

    if (
      strength < 0.35
    ) {

      score +=
        500;
    }
  }


  /* =======================================================
     일반 단어
  ======================================================= */

  if (
    !info.winningAttack &&
    !info.losingAttack &&
    !info.oneShot
  ) {

    score +=
      Math.min(
        nextCount,
        30
      ) * 14;
  }


  /* =======================================================
     첫 수
  ======================================================= */

  if (!currentWord) {

    /*
     * 첫 수에서 바로 승부를 끝내는 단어 금지.
     */

    if (
      info.oneShot
    ) {

      score -=
        15000;
    }


    /*
     * 공격 단어도 첫 수에는
     * 기본적으로 크게 감점.
     */

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
        1500;
    }
  }


  /* =======================================================
     난이도별 공격 성향
  ======================================================= */

  if (
    info.winningAttack
  ) {

    score +=
      strength * 2000;

  } else {

    score +=
      (1 - strength) * 250;
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


  /*
   * 너무 많은 후보를 매번 전부
   * 깊게 분석하지 않는다.
   */

  let analysisCandidates =
    candidates;


  /*
   * 후보가 매우 많을 경우
   * 랜덤 샘플을 만들어 계산량 감소.
   */

  if (
    candidates.length > 600
  ) {

    const sample =
      [];

    const seen =
      new Set();


    /*
     * 공격 단어는 샘플에서
     * 우선적으로 확보한다.
     */

    for (
      const word
      of candidates
    ) {

      if (
        getAttackDepth(word) != null
      ) {

        sample.push(word);
        seen.add(word);

        if (
          sample.length >= 250
        ) {
          break;
        }
      }
    }


    /*
     * 일반 후보 추가
     */

    const target =
      Math.min(
        600,
        candidates.length
      );


    while (
      sample.length < target
    ) {

      const word =
        candidates[
          Math.floor(
            Math.random() *
            candidates.length
          )
        ];


      if (
        seen.has(word)
      ) {
        continue;
      }


      seen.add(word);
      sample.push(word);
    }


    analysisCandidates =
      sample;
  }


  const analyzed =
    [];


  for (
    const word
    of analysisCandidates
  ) {

    analyzed.push(
      analyzeCandidate(
        word,
        used
      )
    );
  }


  const strength =
    getAdjustedStrength();


  /*
   * 첫 수에서는
   * 일반 + 안전 단어를 우선.
   */

  if (
    !singleGame.currentWord
  ) {

    const safe =
      analyzed.filter(
        info =>
          !info.oneShot &&
          !info.winningAttack
      );


    if (
      safe.length
    ) {

      return chooseFromScored(
        safe,
        strength,
        true
      );
    }
  }


  return chooseFromScored(
    analyzed,
    strength,
    false
  );
}


/* =========================================================
   AI 최종选择
========================================================= */

function chooseFromScored(
  analyzed,
  strength,
  firstMove
) {

  if (
    !analyzed.length
  ) {

    return null;
  }


  const scored =
    analyzed.map(
      info => ({

        info,

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


  /*
   * 난이도별 선택 범위
   */

  let poolSize;


  if (
    strength >= 0.82
  ) {

    poolSize = 3;

  } else if (
    strength >= 0.65
  ) {

    poolSize = 5;

  } else if (
    strength >= 0.45
  ) {

    poolSize = 8;

  } else {

    poolSize = 14;
  }


  /*
   * 승률이 너무 높은 경우
   * 조금 더 넓은 후보에서 선택.
   */

  if (
    getCurrentWinRate() > 0.65
  ) {

    poolSize += 6;
  }


  /*
   * 첫 수에서는
   * 너무 강한 수를 선택하지 않는다.
   */

  if (
    firstMove
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


  if (
    !pool.length
  ) {

    return null;
  }


  /*
   * 너무 낮은 점수는 제거.
   */

  const bestScore =
    pool[0].score;


  const reasonable =
    pool.filter(
      item =>
        item.score >=
        bestScore - 1100
    );


  const finalPool =
    reasonable.length
      ? reasonable
      : [pool[0]];


  /*
   * 저난이도에서는
   * 선택지를 조금 더 넓게.
   */

  if (
    strength < 0.35 &&
    finalPool.length > 1
  ) {

    const wider =
      pool.slice(
        0,
        Math.min(
          18,
          pool.length
        )
      );


    const selected =
      wider[
        Math.floor(
          Math.random() *
          wider.length
        )
      ];


    return selected?.info?.word ||
      null;
  }


  const selected =
    finalPool[
      Math.floor(
        Math.random() *
        finalPool.length
      )
    ];


  return selected?.info?.word ||
    null;
}


/* =========================================================
   안전한 시작 단어
========================================================= */

function getRandomStartWord() {

  if (
    !dataReady
  ) {

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
   * 시작 글자 섞기
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
   * 여러 글자 검사
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


    if (
      !list.length
    ) {
      continue;
    }


    /*
     * 후보 일부만 검사
     */

    const maxChecks =
      Math.min(
        list.length,
        250
      );


    const indices =
      [];


    /*
     * 같은 후보 반복 방지
     */

    const usedIndices =
      new Set();


    while (
      indices.length <
      maxChecks
    ) {

      const index =
        Math.floor(
          Math.random() *
          list.length
        );


      if (
        usedIndices.has(index)
      ) {

        if (
          usedIndices.size >=
          list.length
        ) {
          break;
        }

        continue;
      }


      usedIndices.add(index);
      indices.push(index);
    }


    for (
      const index
      of indices
    ) {

      const word =
        list[index];


      /*
       * 공격 단어는 시작 단어 금지
       */

      if (
        getAttackDepth(word) != null
      ) {

        continue;
      }


      /*
       * 시작부터 막히는 단어 금지
       */

      const next =
        getCandidates(
          word,
          new Set([word])
        );


      if (
        !next.length
      ) {

        continue;
      }


      return word;
    }
  }


  /*
   * 최후 fallback
   *
   * 그래도 공격 단어/한방은 제외.
   */

  for (
    const first
    of shuffled
  ) {

    const list =
      getBaseCandidates(first);


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
   싱글 게임 객체
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

    history:
      [],

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
   싱글 게임 생성
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


  if (
    startWordInput
  ) {

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


  singleThinking =
    false;


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

  if (
    !singleGame
  ) {

    return false;
  }


  word =
    normalizeWord(word);


  if (!word) {
    return false;
  }


  /*
   * 단어 목록
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


  /*
   * 다음 턴
   */

  singleGame.turnPlayer =
    player === 0
      ? 1
      : 0;


  updateSingleUI();


  return true;
}


/* =========================================================
   입력 상태
========================================================= */

function updateInputState() {

  /*
   * 싱글
   */

  const singleDisabled =
    !singleGame ||
    singleGame.finished ||
    singleThinking ||
    singleGame.turnPlayer !== 0;


  if (
    singleInput
  ) {

    singleInput.disabled =
      singleDisabled;
  }


  if (
    singleSend
  ) {

    singleSend.disabled =
      singleDisabled;
  }


  /*
   * 온라인
   */

  const onlineDisabled =
    !onlineStarted ||
    !socket ||
    !socket.connected ||
    onlineMyIndex < 0 ||
    !onlineRoom ||
    onlineRoom.turnPlayer !==
      onlineMyIndex;


  if (
    onlineInput
  ) {

    onlineInput.disabled =
      onlineDisabled;
  }


  if (
    onlineSend
  ) {

    onlineSend.disabled =
      onlineDisabled;
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


  if (
    singleInput
  ) {

    singleInput.value =
      "";
  }


  const success =
    playSingleWord(
      word,
      0
    );


  if (!success) {

    if (
      singleInput
    ) {

      singleInput.value =
        word;

      singleInput.focus();
    }

    return;
  }


  checkSingleFinished();


  if (
    singleGame.finished
  ) {

    updateInputState();

    return;
  }


  singleThinking =
    true;


  updateInputState();


  showMessage(
    "끝말잇기 AI가 생각 중..."
  );


  /*
   * 브라우저 UI가 먼저 갱신되도록
   * 약간 늦게 실행.
   */

  setTimeout(
    botTurn,
    20
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

    singleThinking =
      false;

    updateInputState();

    return;
  }


  if (
    singleGame.turnPlayer !== 1
  ) {

    singleThinking =
      false;

    updateInputState();

    return;
  }


  const word =
    chooseBotWord();


  /*
   * AI가 낼 단어가 없다.
   */

  if (!word) {

    singleGame.finished =
      true;

    singleGame.winner =
      0;

    singleGame.loser =
      1;


    finishSingleGame();


    singleThinking =
      false;

    updateInputState();

    return;
  }


  const success =
    playSingleWord(
      word,
      1
    );


  /*
   * 방어 코드
   */

  if (!success) {

    console.error(
      "AI 단어 처리 실패:",
      word
    );


    /*
     * 후보를 다시 검색해서
     * 정상 단어가 있는지 확인.
     */

    const fallback =
      getCandidates(
        singleGame.currentWord,
        singleGame.usedWords
      );


    if (
      fallback.length
    ) {

      const safe =
        fallback.find(
          candidate =>
            allWords.has(candidate)
        );


      if (
        safe &&
        playSingleWord(
          safe,
          1
        )
      ) {

        singleThinking =
          false;

        checkSingleFinished();

        updateInputState();

        return;
      }
    }


    singleGame.finished =
      true;

    singleGame.winner =
      0;

    singleGame.loser =
      1;


    finishSingleGame();


    singleThinking =
      false;

    updateInputState();

    return;
  }


  singleThinking =
    false;


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
    !singleGame.finished
  ) {

    singleInput?.focus();
  }
}


/* =========================================================
   게임 종료 검사
========================================================= */

function checkSingleFinished() {

  if (
    !singleGame ||
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
    candidates.length === 0
  ) {

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
}


/* =========================================================
   싱글 종료
========================================================= */

function finishSingleGame() {

  if (
    !singleGame
  ) {

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


  updateInputState();
}


/* =========================================================
   싱글 UI
========================================================= */

function updateSingleUI() {

  if (
    !singleGame
  ) {

    return;
  }


  const current =
    singleGame.currentWord;


  if (
    lastEl
  ) {

    lastEl.textContent =
      current
        ? current.at(-1)
        : "-";
  }


  if (
    turnEl
  ) {

    turnEl.textContent =
      singleGame.history.length;
  }


  const depth =
    current
      ? getAttackDepth(current)
      : null;


  if (
    depthEl
  ) {

    depthEl.textContent =
      depth != null
        ? depth
        : "-";
  }


  if (
    !historyEl
  ) {

    return;
  }


  historyEl.innerHTML =
    "";


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


    if (
      !raw
    ) {

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

  if (
    winsEl
  ) {

    winsEl.textContent =
      singleStats.wins;
  }


  if (
    lossesEl
  ) {

    lossesEl.textContent =
      singleStats.losses;
  }


  if (
    gamesEl
  ) {

    gamesEl.textContent =
      singleStats.games;
  }


  if (
    avgEl
  ) {

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


  if (
    winrateEl
  ) {

    winrateEl.textContent =
      `${rate.toFixed(0)}%`;
  }
}


/* =========================================================
   새 게임
========================================================= */

async function startNewGame() {

  if (
    !dataReady
  ) {

    showMessage(
      "단어 데이터를 준비하는 중..."
    );


    const ok =
      await loadData();


    if (
      !ok
    ) {

      return;
    }
  }


  singleGame =
    null;

  singleThinking =
    false;


  const success =
    createSingleGame();


  if (
    !success
  ) {

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

  if (
    !dataReady
  ) {

    showMessage(
      "단어 데이터를 준비하는 중..."
    );


    const ok =
      await loadData();


    if (
      !ok
    ) {

      return;
    }
  }


  const start =
    getRandomStartWord();


  if (
    !start
  ) {

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


  if (
    startWordInput
  ) {

    startWordInput.value =
      start;
  }


  const success =
    playSingleWord(
      start,
      0
    );


  if (
    !success
  ) {

    singleGame =
      null;

    return;
  }


  singleThinking =
    false;


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

  tabs.forEach(
    button => {

      button.classList.toggle(
        "active",
        button.dataset.mode ===
          mode
      );
    }
  );


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

  if (
    socket
  ) {

    return socket;
  }


  if (
    typeof io !== "function"
  ) {

    showOnlineMessage(
      "Socket.IO를 불러오지 못했습니다.",
      true
    );

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
          10,

        timeout:
          10000
      });

  } catch (error) {

    console.error(
      "Socket.IO 연결 실패:",
      error
    );

    socket =
      null;

    return null;
  }


  /* =======================================================
     연결
  ======================================================= */

  socket.on(
    "connect",
    () => {

      showOnlineMessage(
        "서버에 연결되었습니다."
      );

      updateInputState();
    }
  );


  /* =======================================================
     연결 해제
  ======================================================= */

  socket.on(
    "disconnect",
    reason => {

      onlineStarted =
        false;


      updateInputState();


      showOnlineMessage(
        "온라인 서버 연결이 끊어졌습니다.",
        true
      );


      console.warn(
        "Socket.IO disconnect:",
        reason
      );
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


      showOnlineMessage(
        "온라인 서버에 연결할 수 없습니다.",
        true
      );
    }
  );


  /* =======================================================
     방 생성
  ======================================================= */

  socket.on(
    "roomCreated",
    data => {

      if (
        !data
      ) {

        return;
      }


      if (
        roomCodeInput
      ) {

        roomCodeInput.value =
          data.code || "";
      }


      showOnlineMessage(
        `방 생성 완료: ${
          data.code || ""
        }`
      );
    }
  );


  /* =======================================================
     방 참가
  ======================================================= */

  socket.on(
    "joinedRoom",
    data => {

      if (
        !data
      ) {

        return;
      }


      if (
        roomCodeInput
      ) {

        roomCodeInput.value =
          data.code || "";
      }


      showOnlineMessage(
        `방 참가 완료: ${
          data.code || ""
        }`
      );
    }
  );


  /* =======================================================
     방 상태
  ======================================================= */

  socket.on(
    "roomState",
    state => {

      if (
        !state
      ) {

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
        onlineStarted
      ) {

        updateOnlineTurnMessage();
      }


      updateInputState();
    }
  );


  /* =======================================================
     온라인 시작
  ======================================================= */

  socket.on(
    "onlineStarted",
    data => {

      onlineStarted =
        true;


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


      showOnlineMessage(
        "게임이 시작되었습니다."
      );


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

      if (
        !data
      ) {

        return;
      }


      /*
       * state가 있으면 서버 상태를
       * 최우선으로 사용.
       */

      if (
        data.state
      ) {

        onlineRoom =
          data.state;

        onlineStarted =
          !!data.state.started ||
          !data.state.finished;

        updateOnlineRoom(
          data.state
        );
      }


      /*
       * 서버에서 history 전체를 주는 경우
       * 중복 추가를 막기 위해 UI를 다시 그린다.
       */

      if (
        data.state?.history
      ) {

        renderOnlineHistory(
          data.state.history
        );

      } else {

        addOnlineHistory(
          data.word,
          data.player,
          data.nextTurn,
          data.depth
        );
      }


      if (
        data.finished
      ) {

        onlineStarted =
          false;


        updateInputState();

        return;
      }


      updateOnlineTurnMessage();

      updateInputState();
    }
  );


  /* =======================================================
     단어 거절
  ======================================================= */

  socket.on(
    "wordRejected",
    data => {

      showOnlineMessage(
        data?.reason ||
        "단어를 사용할 수 없습니다.",
        true
      );


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

      showOnlineMessage(
        String(
          message || ""
        )
      );
    }
  );


  /* =======================================================
     에러 메시지
  ======================================================= */

  socket.on(
    "errorMessage",
    message => {

      showOnlineMessage(
        String(
          message || ""
        ),
        true
      );
    }
  );


  return socket;
}


/* =========================================================
   온라인 턴 메시지
========================================================= */

function updateOnlineTurnMessage() {

  if (
    !onlineStarted ||
    !onlineRoom
  ) {

    return;
  }


  if (
    onlineRoom.finished
  ) {

    onlineStarted =
      false;

    updateInputState();

    return;
  }


  if (
    onlineRoom.turnPlayer ===
    onlineMyIndex
  ) {

    showOnlineMessage(
      "내 차례입니다. 단어를 입력하세요."
    );

    onlineInput?.focus();

  } else {

    showOnlineMessage(
      "상대방 차례입니다."
    );
  }
}


/* =========================================================
   온라인 방 UI
========================================================= */

function updateOnlineRoom(
  state
) {

  if (
    !state
  ) {

    onlineMyIndex =
      -1;


    onlineRoom =
      null;


    if (
      roomInfo
    ) {

      roomInfo.textContent =
        "";
    }


    updateInputState();

    return;
  }


  if (
    roomInfo
  ) {

    roomInfo.innerHTML =
      "";


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


    onlineMyIndex =
      -1;


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
   * 방장 + 2명 + 아직 시작 전
   */

  if (
    startOnlineButton
  ) {

    const canStart =
      state.players?.length === 2 &&
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
   온라인 기록 전체 렌더
========================================================= */

function renderOnlineHistory(
  history
) {

  if (
    !onlineHistory
  ) {

    return;
  }


  onlineHistory.innerHTML =
    "";


  if (
    !Array.isArray(history)
  ) {

    return;
  }


  for (
    const item
    of history
  ) {

    addOnlineHistory(
      item.word,
      item.player,
      null,
      item.depth,
      true
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
  silent = false
) {

  if (
    !onlineHistory
  ) {

    return;
  }


  if (
    !word
  ) {

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
    silent
  ) {

    return;
  }


  if (
    nextTurn != null
  ) {

    if (
      Number(nextTurn) ===
      onlineMyIndex
    ) {

      showOnlineMessage(
        "내 차례입니다."
      );

    } else {

      showOnlineMessage(
        "상대방 차례입니다."
      );
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


  if (
    !s
  ) {

    return;
  }


  const name =
    normalizeWord(
      nameInput?.value
    ) ||
    "Player";


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


  if (
    !s
  ) {

    return;
  }


  const code =
    String(
      roomCodeInput?.value ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    !code
  ) {

    showOnlineMessage(
      "방 코드를 입력해주세요.",
      true
    );

    roomCodeInput?.focus();

    return;
  }


  const name =
    normalizeWord(
      nameInput?.value
    ) ||
    "Player";


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


  if (
    !s
  ) {

    return;
  }


  if (
    !s.connected
  ) {

    showOnlineMessage(
      "서버에 연결하는 중입니다."
    );

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

  if (
    !socket
  ) {

    showOnlineMessage(
      "서버에 연결되지 않았습니다.",
      true
    );

    return;
  }


  if (
    !socket.connected
  ) {

    showOnlineMessage(
      "서버에 연결되지 않았습니다.",
      true
    );

    return;
  }


  if (
    !onlineStarted
  ) {

    showOnlineMessage(
      "아직 게임이 시작되지 않았습니다.",
      true
    );

    return;
  }


  if (
    onlineMyIndex < 0 ||
    !onlineRoom
  ) {

    showOnlineMessage(
      "방 정보를 불러오는 중입니다.",
      true
    );

    return;
  }


  if (
    onlineRoom.turnPlayer !==
    onlineMyIndex
  ) {

    showOnlineMessage(
      "지금은 상대방 차례입니다.",
      true
    );

    return;
  }


  const word =
    normalizeWord(
      onlineInput?.value
    );


  if (
    !word
  ) {

    return;
  }


  if (
    onlineInput
  ) {

    onlineInput.value =
      "";
  }


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

  /*
   * 탭
   */

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
   * 온라인 시작
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

      if (
        !roomCodeInput
      ) {

        return;
      }


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
   * 페이지 로드시에는
   * 대용량 데이터를 불러오지 않는다.
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
