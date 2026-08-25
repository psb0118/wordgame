"use strict";

/* =========================================================
   끝말잇기 AI - 최종 안정화 script.js
   ---------------------------------------------------------
   - 싱글플레이
   - AI 1~5단계
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
