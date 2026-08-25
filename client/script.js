"use strict";

/* =========================================================
   끝말잇기 AI - 통합 최종 script.js

   기능
   ---------------------------------------------------------
   싱글
   - 랜덤 시작
   - 빠른 시작
   - 끝말잇기 AI
   - 두음법칙
   - 공격 깊이 표시
   - 중복 단어 방지
   - 승/패/평균 통계
   - localStorage 저장

   온라인
   - Socket.IO
   - 방 생성
   - 방 참가
   - 방장 게임 시작
   - 실시간 단어 전송
   - 실시간 기록
   - 차례 표시

   데이터
   - /api/data 1회 로드
   - byFirst 캐시
   - attackDepth 캐시
   - 새 게임마다 전체 단어 검색 X
========================================================= */


/* =========================================================
   DOM
========================================================= */

const $ = id => document.getElementById(id);

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

let byFirst = Object.create(null);

let attackDepth =
  Object.create(null);

let dueum =
  Object.create(null);

let startFirst = [];

let dataReady = false;

let dataLoading = null;


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
   후보 캐시
========================================================= */

/*
 * firstChar -> 실제 단어 배열
 *
 * 서버에서 이미 byFirst를 만들어 보내므로
 * 여기서는 배열을 그대로 캐싱한다.
 */

const candidateCache =
  new Map();


/*
 * 글자 -> 두음 적용 가능한 시작 글자
 *
 * 한 번 계산한 결과는 다시 계산하지 않는다.
 */

const dueumCache =
  new Map();


/* =========================================================
   데이터 로드
========================================================= */

async function loadData() {

  /*
   * 이미 준비됨
   */
  if (dataReady) {
    return true;
  }


  /*
   * 동시에 여러 번 요청되는 것을 방지
   *
   * 새 게임 버튼을 연속으로 눌러도
   * /api/data를 여러 번 요청하지 않는다.
   */
  if (dataLoading) {
    return dataLoading;
  }


  dataLoading =
    (async () => {

      try {

        const response =
          await fetch(
            "/api/data",
            {
              method: "GET",
              cache: "force-cache"
            }
          );


        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }


        const data =
          await response.json();


        DATA = data || {};


        byFirst =
          data.byFirst ||
          Object.create(null);


        attackDepth =
          data.attackDepth ||
          Object.create(null);


        dueum =
          data.dueum ||
          Object.create(null);


        startFirst =
          Array.isArray(data.startFirst)
            ? data.startFirst
            : Object.keys(byFirst);


        /*
         * 후보 캐시는 새 데이터에 맞춰 초기화
         */
        candidateCache.clear();

        dueumCache.clear();


        dataReady = true;


        console.log(
          "끝말잇기 데이터 준비 완료"
        );


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

      } finally {

        dataLoading = null;
      }

    })();


  return dataLoading;
}


/* =========================================================
   기본 문자열 처리
========================================================= */

function normalizeWord(word) {

  if (
    typeof word !== "string"
  ) {
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


  if (
    dueumCache.has(lastChar)
  ) {
    return dueumCache.get(lastChar);
  }


  const result =
    new Set([lastChar]);


  /*
   * 정방향
   *
   * 예:
   * 녀 -> 여
   */
  const direct =
    dueum[lastChar];


  if (
    Array.isArray(direct)
  ) {

    for (
      const char of direct
    ) {

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
   */
  for (
    const [from, values]
    of Object.entries(dueum)
  ) {

    if (
      Array.isArray(values) &&
      values.includes(lastChar)
    ) {

      result.add(from);
    }
  }


  const resultArray =
    [...result];


  dueumCache.set(
    lastChar,
    resultArray
  );


  return resultArray;
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
   시작 글자 후보
========================================================= */

function getBaseCandidates(
  firstChar
) {

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


  const result =
    Array.isArray(list)
      ? list
      : [];


  candidateCache.set(
    firstChar,
    result
  );


  return result;
}


/* =========================================================
   후보 찾기
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


  /*
   * 두음으로 허용된 글자만 검사
   */
  for (
    const char of chars
  ) {

    const list =
      getBaseCandidates(char);


    for (
      const word of list
    ) {

      if (
        used.has(word)
      ) {
        continue;
      }


      result.push(word);
    }
  }


  return result;
}


/* =========================================================
   시작 글자에서 후보 찾기
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


  for (
    const first of chars
  ) {

    const list =
      getBaseCandidates(first);


    for (
      const word of list
    ) {

      if (
        used.has(word)
      ) {
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


  if (
    value == null
  ) {
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
    depth !== null &&
    depth % 2 === 1
  );
}


function isLosingAttack(word) {

  const depth =
    getAttackDepth(word);


  return (
    depth !== null &&
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
      depth !== null &&
      depth % 2 === 1,

    losingAttack:
      depth !== null &&
      depth % 2 === 0
  };
}


/* =========================================================
   AI 점수
========================================================= */

/*
 * AI는 무조건 공격 단어만 사용하지 않는다.
 *
 * 기본적으로:
 * 1. 실제로 이길 수 있는 수
 * 2. 상대 선택지가 적은 수
 * 3. 적당히 안전한 일반 단어
 * 순으로 고려한다.
 *
 * 단, 매번 1등만 고르지 않고
 * 상위 후보에서 랜덤 선택한다.
 */

function scoreCandidate(
  info,
  currentWord
) {

  let score = 0;


  const nextCount =
    info.nextCount;


  const depth =
    info.depth ?? 0;


  /* =======================================================
     한방
  ======================================================= */

  if (info.oneShot) {

    score += 10000;
  }


  /* =======================================================
     공격 단어
  ======================================================= */

  if (info.winningAttack) {

    /*
     * 깊이가 높을수록 강한 공격
     */
    score +=
      1200 +
      depth * 70;


    /*
     * 상대 선택지가 적으면
     * 더욱 강력한 공격
     */
    if (
      nextCount <= 2
    ) {

      score += 700;

    } else if (
      nextCount <= 5
    ) {

      score += 350;
    }
  }


  /* =======================================================
     양보 단어
  ======================================================= */

  if (info.losingAttack) {

    score -=
      650 +
      depth * 20;
  }


  /* =======================================================
     상대 선택지
  ======================================================= */

  if (
    nextCount === 1
  ) {

    score += 1800;

  } else if (
    nextCount <= 3
  ) {

    score += 900;

  } else if (
    nextCount <= 8
  ) {

    score += 450;

  } else {

    /*
     * 너무 선택지가 많은 단어는
     * 약간 낮게 평가
     */
    score +=
      Math.min(
        nextCount,
        30
      ) * 8;
  }


  /* =======================================================
     첫 수
  ======================================================= */

  if (!currentWord) {

    /*
     * 첫 단어에서 공격/한방 방지
     */
    if (
      info.oneShot
    ) {

      score -= 12000;
    }


    if (
      info.winningAttack
    ) {

      score -= 2500;
    }


    if (
      info.losingAttack
    ) {

      score -= 800;
    }


    /*
     * 일반 단어를 선호
     */
    if (
      !info.winningAttack &&
      !info.losingAttack &&
      !info.oneShot
    ) {

      score += 1500;
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


  /*
   * 후보 분석
   */
  const analyzed = [];


  for (
    const word of candidates
  ) {

    analyzed.push(
      analyzeCandidate(
        word,
        used
      )
    );
  }


  const scored =
    analyzed.map(
      info => ({

        ...info,

        score:
          scoreCandidate(
            info,
            singleGame.currentWord
          )

      })
    );


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /*
   * 상위 후보 중 랜덤 선택
   *
   * 항상 최선 수를 고르면
   * AI가 지나치게 강해진다.
   */
  let poolSize = 7;


  /*
   * 상황에 따른 강도
   */
  const games =
    singleStats.games;


  const aiWinRate =
    games > 0
      ? singleStats.wins / games
      : 0.5;


  /*
   * AI가 너무 많이 이기면
   * 선택 폭을 넓힌다.
   */
  if (
    aiWinRate > 0.65
  ) {

    poolSize = 14;

  } else if (
    aiWinRate > 0.55
  ) {

    poolSize = 10;
  }


  /*
   * AI가 너무 많이 지고 있으면
   * 조금 더 강하게 한다.
   */
  else if (
    aiWinRate < 0.35
  ) {

    poolSize = 4;

  } else if (
    aiWinRate < 0.45
  ) {

    poolSize = 6;
  }


  /*
   * 한방이 있으면 너무 쉽게 놓치지는 않는다.
   *
   * 단, 첫 단어에서는 제외.
   */
  if (
    singleGame.currentWord
  ) {

    const oneShot =
      scored.find(
        info =>
          info.oneShot
      );


    if (
      oneShot &&
      aiWinRate < 0.35
    ) {

      return oneShot.word;
    }
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


  return selected.word;
}


/* =========================================================
   안전한 시작 단어
========================================================= */

/*
 * 시작 단어를 고를 때
 * 공격 단어 전체를 검색하지 않는다.
 *
 * startFirst -> 해당 글자의 후보만 검사.
 */

function getRandomStartWord() {

  if (!dataReady) {
    return null;
  }


  if (
    !startFirst.length
  ) {

    startFirst =
      Object.keys(byFirst);
  }


  if (
    !startFirst.length
  ) {

    return null;
  }


  /*
   * 여러 시작 글자 중 랜덤 선택
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


  if (
    !list.length
  ) {

    return null;
  }


  /*
   * 무작위 위치에서 시작해서
   * 최대 일정 개수만 검사한다.
   *
   * 새 게임마다 전체 50만 단어를
   * 처음부터 훑지 않는다.
   */
  const maxCheck =
    Math.min(
      list.length,
      80
    );


  const safe = [];


  const startIndex =
    Math.floor(
      Math.random() *
      list.length
    );


  for (
    let i = 0;
    i < maxCheck;
    i++
  ) {

    const word =
      list[
        (startIndex + i) %
        list.length
      ];


    /*
     * attack.txt에 있는 단어는
     * 시작 단어에서 제외
     */
    if (
      getAttackDepth(word) !== null
    ) {

      continue;
    }


    /*
     * 한방 단어도 제외
     */
    const next =
      getCandidates(
        word,
        new Set([word])
      );


    if (
      next.length === 0
    ) {

      continue;
    }


    safe.push(word);


    /*
     * 8개 정도만 확보하면 충분
     */
    if (
      safe.length >= 8
    ) {

      break;
    }
  }


  if (
    safe.length
  ) {

    return safe[
      Math.floor(
        Math.random() *
        safe.length
      )
    ];
  }


  /*
   * 혹시 안전한 단어가 없으면
   * 일반 단어 중 랜덤 선택.
   */
  return list[
    Math.floor(
      Math.random() *
      list.length
    )
  ];
}


/* =========================================================
   싱글 게임 객체
========================================================= */

function makeSingleGame(
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
      null
  };
}


/* =========================================================
   싱글 단어 플레이
========================================================= */

function playSingleWord(
  word,
  player
) {

  if (
    !singleGame ||
    singleGame.finished
  ) {

    return false;
  }


  word =
    normalizeWord(word);


  if (!word) {

    return false;
  }


  /*
   * 실제 단어 목록 확인
   *
   * byFirst를 이용하므로
   * 50만 개 Set을 새로 만들 필요가 없다.
   */
  const first =
    word.at(0);


  const list =
    getBaseCandidates(first);


  if (
    !list.includes(word)
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
   * 첫 단어
   */
  if (
    singleGame.history.length === 0
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


  /*
   * 다음 플레이어
   */
  singleGame.turnPlayer =
    player === 0
      ? 1
      : 0;


  updateSingleUI();


  return true;
}


/* =========================================================
   싱글 게임 종료 검사
========================================================= */

function checkSingleFinished() {

  if (
    !singleGame ||
    !singleGame.currentWord
  ) {

    return false;
  }


  const candidates =
    getCandidates(
      singleGame.currentWord,
      singleGame.usedWords
    );


  if (
    candidates.length > 0
  ) {

    return false;
  }


  const last =
    singleGame.history.at(-1);


  if (!last) {
    return false;
  }


  singleGame.finished =
    true;


  singleGame.winner =
    last.player;


  singleGame.loser =
    last.player === 0
      ? 1
      : 0;


  finishSingleGame();


  return true;
}


/* =========================================================
   싱글 게임 종료
========================================================= */

function finishSingleGame() {

  if (
    !singleGame
  ) {

    return;
  }


  /*
   * 이미 종료 처리된 게임 방지
   */
  if (
    singleGame._counted
  ) {

    return;
  }


  singleGame._counted =
    true;


  singleStats.games++;


  singleStats.totalTurns +=
    singleGame.history.length;


  /*
   * winner 1 = AI
   */
  if (
    singleGame.winner === 1
  ) {

    singleStats.wins++;

  } else {

    singleStats.losses++;
  }


  saveStats();
  updateStats();


  if (
    singleGame.winner === 1
  ) {

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
   플레이어 입력
========================================================= */

function sendSingleWord() {

  if (
    !singleGame
  ) {

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


  /*
   * 0 = 플레이어
   */
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
    return;
  }


  /*
   * 입력창을 비우는 것은
   * 실제 판정 전에 해도 된다.
   */
  singleInput.value = "";


  const success =
    playSingleWord(
      word,
      0
    );


  if (!success) {

    /*
     * 잘못된 단어라면
     * 다시 입력할 수 있도록 포커스
     */
    singleInput?.focus();

    return;
  }


  /*
   * 내가 방금 게임을 끝냈는지 검사
   */
  if (
    checkSingleFinished()
  ) {

    return;
  }


  /*
   * AI 생각
   */
  singleThinking =
    true;


  showMessage(
    "끝말잇기 AI가 생각 중..."
  );


  /*
   * UI 갱신 후 AI 실행
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

    return;
  }


  if (
    singleGame.turnPlayer !== 1
  ) {

    singleThinking =
      false;

    return;
  }


  const word =
    chooseBotWord();


  /*
   * AI가 연결할 단어가 없음
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


    return;
  }


  /*
   * AI 단어 입력
   */
  const success =
    playSingleWord(
      word,
      1
    );


  if (!success) {

    /*
     * 이론상 발생하면
     * 게임을 망가뜨리지 않고 종료.
     */
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


    singleThinking =
      false;


    return;
  }


  singleThinking =
    false;


  /*
   * AI가 방금 끝냈는지 검사
   */
  if (
    checkSingleFinished()
  ) {

    return;
  }


  showMessage(
    "당신의 차례입니다."
  );


  /*
   * 입력창 포커스
   */
  singleInput?.focus();
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


  /*
   * 끝 글자
   */
  if (lastEl) {

    lastEl.textContent =
      current
        ? current.at(-1)
        : "-";
  }


  /*
   * 턴
   */
  if (turnEl) {

    turnEl.textContent =
      singleGame.history.length;
  }


  /*
   * 공격 깊이
   */
  if (depthEl) {

    const depth =
      current
        ? getAttackDepth(current)
        : null;


    depthEl.textContent =
      depth !== null
        ? depth
        : "-";
  }


  /*
   * 기록
   */
  if (!historyEl) {
    return;
  }


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


    const name =
      item.player === 0
        ? "나"
        : "끝말잇기 AI";


    div.textContent =
      `${item.turn}. ${name} : ${item.word}`;


    if (
      item.depth !== null &&
      item.depth !== undefined
    ) {

      div.textContent +=
        ` [깊이 ${item.depth}]`;
    }


    historyEl.appendChild(div);
  }


  /*
   * 기록창은 항상 최신 기록으로 이동
   */
  historyEl.scrollTop =
    historyEl.scrollHeight;
}


/* =========================================================
   새 게임
========================================================= */

async function startNewGame() {

  /*
   * 게임 도중에도 바로 새 게임 가능
   */
  singleThinking =
    false;


  showMessage(
    "새 게임 준비 중..."
  );


  /*
   * 데이터가 없다면 최초 1회만 로드
   */
  const ok =
    await loadData();


  if (!ok) {
    return;
  }


  /*
   * 여기부터는 매우 빠르게 실행
   */
  const start =
    getRandomStartWord();


  if (!start) {

    showMessage(
      "시작 단어를 찾지 못했습니다.",
      true
    );

    return;
  }


  /*
   * 이전 게임 완전 제거
   */
  singleGame =
    makeSingleGame(start);


  startWordInput.value =
    start;


  /*
   * 시작 단어 등록
   */
  const success =
    playSingleWord(
      start,
      0
    );


  if (!success) {

    showMessage(
      "시작 단어를 등록하지 못했습니다.",
      true
    );

    return;
  }


  /*
   * 시작 단어 때문에 바로 끝났다면
   * 다음 게임을 기다린다.
   */
  if (
    checkSingleFinished()
  ) {

    return;
  }


  showMessage(
    "당신의 차례입니다."
  );


  singleInput?.focus();
}


/* =========================================================
   랜덤 시작
========================================================= */

async function randomStart() {

  await startNewGame();
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
      singleStats.games > 0

        ? (
            singleStats.totalTurns /
            singleStats.games
          ).toFixed(1)

        : "-";
  }


  if (winrateEl) {

    const rate =
      singleStats.games > 0

        ? (
            singleStats.wins /
            singleStats.games
          ) * 100

        : 50;


    winrateEl.textContent =
      `${rate.toFixed(0)}%`;
  }
}


/* =========================================================
   탭
========================================================= */

function switchTab(mode) {

  tabs.forEach(
    button => {

      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    }
  );


  if (
    mode === "single"
  ) {

    singlePanel?.classList.remove(
      "hidden"
    );

    onlinePanel?.classList.add(
      "hidden"
    );


    singleInput?.focus();


  } else {

    singlePanel?.classList.add(
      "hidden"
    );

    onlinePanel?.classList.remove(
      "hidden"
    );


    connectSocket();
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


  socket =
    io({
      transports: [
        "websocket",
        "polling"
      ]
    });


  /* -------------------------------------------------------
     연결
  ------------------------------------------------------- */

  socket.on(
    "connect",
    () => {

      if (onlineMessage) {

        onlineMessage.textContent =
          "서버에 연결되었습니다.";
      }
    }
  );


  /* -------------------------------------------------------
     연결 종료
  ------------------------------------------------------- */

  socket.on(
    "disconnect",
    () => {

      onlineStarted =
        false;


      if (onlineMessage) {

        onlineMessage.textContent =
          "서버 연결이 끊어졌습니다.";
      }
    }
  );


  /* -------------------------------------------------------
     방 생성
  ------------------------------------------------------- */

  socket.on(
    "roomCreated",
    data => {

      if (!data) {
        return;
      }


      if (
        data.code &&
        roomCodeInput
      ) {

        roomCodeInput.value =
          data.code;
      }


      if (onlineMessage) {

        onlineMessage.textContent =
          `방 생성 완료: ${data.code}`;
      }
    }
  );


  /* -------------------------------------------------------
     방 참가
  ------------------------------------------------------- */

  socket.on(
    "joinedRoom",
    data => {

      if (!data) {
        return;
      }


      if (
        data.code &&
        roomCodeInput
      ) {

        roomCodeInput.value =
          data.code;
      }


      if (onlineMessage) {

        onlineMessage.textContent =
          `방 참가 완료: ${data.code}`;
      }
    }
  );


  /* -------------------------------------------------------
     방 상태
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     온라인 게임 시작
  ------------------------------------------------------- */

  socket.on(
    "onlineStarted",
    state => {

      onlineStarted =
        true;


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


      onlineInput?.focus();
    }
  );


  /* -------------------------------------------------------
     단어 입력 성공
  ------------------------------------------------------- */

  socket.on(
    "wordPlayed",
    data => {

      if (!data) {
        return;
      }


      addOnlineHistory(
        data.word,
        data.player,
        data.nextTurn,
        data.depth
      );
    }
  );


  /* -------------------------------------------------------
     단어 입력 실패
  ------------------------------------------------------- */

  socket.on(
    "wordRejected",
    data => {

      if (onlineMessage) {

        onlineMessage.textContent =
          data?.reason ||
          "단어를 사용할 수 없습니다.";
      }


      onlineInput?.focus();
    }
  );


  /* -------------------------------------------------------
     게임 종료
  ------------------------------------------------------- */

  socket.on(
    "gameFinished",
    data => {

      onlineStarted =
        false;


      const winner =
        data?.winner;


      if (
        winner === onlineMyIndex
      ) {

        onlineMessage.textContent =
          "승리했습니다.";

      } else {

        onlineMessage.textContent =
          "게임이 끝났습니다.";
      }
    }
  );


  /* -------------------------------------------------------
     방 메시지
  ------------------------------------------------------- */

  socket.on(
    "roomMessage",
    message => {

      if (onlineMessage) {

        onlineMessage.textContent =
          message || "";
      }
    }
  );


  /* -------------------------------------------------------
     에러
  ------------------------------------------------------- */

  socket.on(
    "errorMessage",
    message => {

      if (onlineMessage) {

        onlineMessage.textContent =
          message || "오류가 발생했습니다.";
      }
    }
  );


  /*
   * 서버가 error 이벤트를 직접 보내는 경우
   */
  socket.on(
    "error",
    error => {

      console.error(
        "Socket 오류:",
        error
      );
    }
  );


  return socket;
}


/* =========================================================
   온라인 방 UI
========================================================= */

function updateOnlineRoom(state) {

  if (!roomInfo) {
    return;
  }


  if (!state) {

    roomInfo.textContent =
      "";

    onlineMyIndex =
      -1;

    startOnlineButton?.classList.add(
      "hidden"
    );

    return;
  }


  roomInfo.innerHTML =
    "";


  if (
    state.code
  ) {

    const title =
      document.createElement("div");


    title.textContent =
      `방 코드: ${state.code}`;


    roomInfo.appendChild(
      title
    );
  }


  const players =
    Array.isArray(state.players)
      ? state.players
      : [];


  onlineMyIndex =
    -1;


  players.forEach(
    (player, index) => {

      const row =
        document.createElement("div");


      row.textContent =
        `${index === 0 ? "방장" : "플레이어"}: ${
          player.name || "Player"
        }`;


      roomInfo.appendChild(
        row
      );


      if (
        socket &&
        player.id === socket.id
      ) {

        onlineMyIndex =
          index;
      }
    }
  );


  /*
   * 방장이고 2명이 모였으며
   * 아직 시작하지 않았다면
   * 시작 버튼 표시
   */
  if (
    players.length === 2 &&
    onlineMyIndex === 0 &&
    !state.started
  ) {

    startOnlineButton?.classList.remove(
      "hidden"
    );

  } else {

    startOnlineButton?.classList.add(
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
  nextTurn,
  depth
) {

  if (!onlineHistory) {
    return;
  }


  const div =
    document.createElement("div");


  div.textContent =
    `${
      player === 0
        ? "플레이어 1"
        : "플레이어 2"
    } : ${word}`;


  if (
    depth !== null &&
    depth !== undefined
  ) {

    div.textContent +=
      ` [깊이 ${depth}]`;
  }


  onlineHistory.appendChild(
    div
  );


  onlineHistory.scrollTop =
    onlineHistory.scrollHeight;


  if (onlineMessage) {

    onlineMessage.textContent =
      nextTurn === onlineMyIndex

        ? "내 차례입니다."

        : "상대방 차례입니다.";
  }


  if (
    nextTurn === onlineMyIndex
  ) {

    onlineInput?.focus();
  }
}


/* =========================================================
   온라인 기록 초기화
========================================================= */

function clearOnlineHistory() {

  if (
    onlineHistory
  ) {

    onlineHistory.innerHTML =
      "";
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


  clearOnlineHistory();


  onlineStarted =
    false;


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


  clearOnlineHistory();


  onlineStarted =
    false;


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


  s.emit(
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
      onlineInput?.value
    );


  if (!word) {
    return;
  }


  onlineInput.value =
    "";


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

  /* -------------------------------------------------------
     탭
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     싱글 입력 버튼
  ------------------------------------------------------- */

  singleSend?.addEventListener(
    "click",
    sendSingleWord
  );


  /* -------------------------------------------------------
     싱글 Enter
  ------------------------------------------------------- */

  singleInput?.addEventListener(
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


  /* -------------------------------------------------------
     새 게임
  ------------------------------------------------------- */

  restartButton?.addEventListener(
    "click",
    startNewGame
  );


  /* -------------------------------------------------------
     랜덤 시작
  ------------------------------------------------------- */

  newStartButton?.addEventListener(
    "click",
    randomStart
  );


  /* -------------------------------------------------------
     온라인 방 생성
  ------------------------------------------------------- */

  createButton?.addEventListener(
    "click",
    createOnlineRoom
  );


  /* -------------------------------------------------------
     온라인 방 참가
  ------------------------------------------------------- */

  joinButton?.addEventListener(
    "click",
    joinOnlineRoom
  );


  /* -------------------------------------------------------
     온라인 게임 시작
  ------------------------------------------------------- */

  startOnlineButton?.addEventListener(
    "click",
    startOnlineGame
  );


  /* -------------------------------------------------------
     온라인 입력
  ------------------------------------------------------- */

  onlineSend?.addEventListener(
    "click",
    sendOnlineWord
  );


  /* -------------------------------------------------------
     온라인 Enter
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     방 코드 Enter
  ------------------------------------------------------- */

  roomCodeInput?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        event.preventDefault();

        joinOnlineRoom();
      }
    }
  );


  /* -------------------------------------------------------
     이름 Enter
  ------------------------------------------------------- */

  nameInput?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        event.preventDefault();

        createOnlineRoom();
      }
    }
  );
}


/* =========================================================
   초기화
========================================================= */

function init() {

  /*
   * 통계는 즉시 로드
   */
  loadStats();

  updateStats();


  /*
   * 버튼 이벤트 즉시 연결
   */
  bindEvents();


  /*
   * 처음부터 무거운 데이터 로드 X
   */
  showMessage(
    "새 게임을 눌러 시작하세요."
  );


  /*
   * 온라인은 실제 탭을 누를 때 연결
   */
}


/* =========================================================
   시작
========================================================= */

if (
  document.readyState === "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

} else {

  init();
}
