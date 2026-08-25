"use strict";

/*
 * =========================================================
 * 끝말잇기 - 최종 안정화 script.js
 * =========================================================
 *
 * 기능
 * ---------------------------------------------------------
 * 1. 싱글플레이
 * 2. AI Lv1 ~ Lv5
 * 3. 두음법칙
 * 4. 공격 단어 깊이 표시
 * 5. 안전한 시작 단어
 * 6. 새 게임 / 랜덤 시작
 * 7. 버튼 + Enter 입력
 * 8. 온라인 2인 Socket.IO
 * 9. 통계 localStorage
 *
 * 중요
 * ---------------------------------------------------------
 * 이벤트는 이 파일에서 딱 한 번만 등록한다.
 * =========================================================
 */


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

const restartButton =
  $("restart");

const singleInput =
  $("singleInput");

const singleSend =
  $("singleSend");

const lastEl =
  $("last");

const turnEl =
  $("turn");

const depthEl =
  $("depth");

const winrateEl =
  $("winrate");

const historyEl =
  $("history");

const messageEl =
  $("message");

const winsEl =
  $("wins");

const lossesEl =
  $("losses");

const gamesEl =
  $("games");

const avgEl =
  $("avg");


/* =========================================================
   온라인 DOM
========================================================= */

const onlineInput =
  $("onlineInput");

const onlineSend =
  $("onlineSend");

const onlineMessage =
  $("onlineMessage");

const onlineHistory =
  $("onlineHistory");

const createButton =
  $("create");

const joinButton =
  $("join");

const startOnlineButton =
  $("startOnline");

const nameInput =
  $("name");

const roomCodeInput =
  $("roomCode");

const roomInfo =
  $("roomInfo");

const singlePanel =
  $("single");

const onlinePanel =
  $("online");

const tabs =
  document.querySelectorAll(
    ".tabs button"
  );


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

let dataReady =
  false;

let dataLoadingPromise =
  null;


/* =========================================================
   후보 캐시
========================================================= */

const candidateCache =
  new Map();


/* =========================================================
   싱글 상태
========================================================= */

let singleGame =
  null;

let singleThinking =
  false;


/* =========================================================
   통계
========================================================= */

let singleStats = {
  wins: 0,
  losses: 0,
  games: 0,
  totalTurns: 0
};


/* =========================================================
   온라인 상태
========================================================= */

let socket =
  null;

let onlineRoom =
  null;

let onlineStarted =
  false;

let onlineMyIndex =
  -1;


/* =========================================================
   기본 처리
========================================================= */

function normalizeWord(word) {

  if (
    typeof word !==
    "string"
  ) {
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
    String(text || "");

  messageEl.classList.toggle(
    "error",
    !!error
  );
}


function showOnlineMessage(
  text
) {

  if (!onlineMessage) {
    return;
  }

  onlineMessage.textContent =
    String(text || "");
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
    new Set();

  result.add(lastChar);


  /*
   * 정방향
   *
   * 녀 -> 여
   * 년 -> 연
   * 늄 -> 윰
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
   * 여 -> 녀
   * 연 -> 년
   * 윰 -> 늄
   */

  for (
    const [from, values]
    of Object.entries(dueum)
  ) {

    if (
      !Array.isArray(values)
    ) {
      continue;
    }

    if (
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

  previousWord =
    normalizeWord(
      previousWord
    );

  nextWord =
    normalizeWord(
      nextWord
    );

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
  ).includes(first);
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
          "단어 데이터를 불러오는 중..."
        );


        const controller =
          new AbortController();

        const timeout =
          setTimeout(
            () => {
              controller.abort();
            },
            300000
          );


        let response;

        try {

          response =
            await fetch(
              "/api/data",
              {
                method: "GET",
                cache: "no-store",
                headers: {
                  Accept:
                    "application/json"
                },
                signal:
                  controller.signal
              }
            );

        } finally {

          clearTimeout(
            timeout
          );
        }


        if (!response.ok) {

          throw new Error(
            `HTTP ${response.status}`
          );
        }


        const contentType =
          response.headers.get(
            "content-type"
          ) || "";


        if (
          !contentType
            .toLowerCase()
            .includes(
              "application/json"
            )
        ) {

          const text =
            await response.text();

          console.error(
            "잘못된 API 응답:",
            text.slice(0, 500)
          );

          throw new Error(
            "서버가 JSON 데이터를 반환하지 않았습니다."
          );
        }


        const result =
          await response.json();


        if (
          !result ||
          typeof result !==
            "object"
        ) {

          throw new Error(
            "단어 데이터 형식이 올바르지 않습니다."
          );
        }


        DATA =
          result;


        /*
         * byFirst
         */

        byFirst =
          result.byFirst &&
          typeof result.byFirst ===
            "object"
            ? result.byFirst
            : Object.create(null);


        /*
         * attackDepth
         */

        attackDepth =
          result.attackDepth &&
          typeof result.attackDepth ===
            "object"
            ? result.attackDepth
            : Object.create(null);


        /*
         * dueum
         */

        dueum =
          result.dueum &&
          typeof result.dueum ===
            "object"
            ? result.dueum
            : Object.create(null);


        /*
         * 캐시 초기화
         */

        candidateCache.clear();


        /*
         * 전체 단어 구성
         */

        allWords =
          new Set();


        /*
         * 서버가 allWords를 주는 경우
         */

        if (
          Array.isArray(
            result.allWords
          )
        ) {

          for (
            const word
            of result.allWords
          ) {

            const normalized =
              normalizeWord(word);

            if (normalized) {
              allWords.add(
                normalized
              );
            }
          }
        }


        /*
         * 서버가 words를 주는 경우
         */

        if (
          Array.isArray(
            result.words
          )
        ) {

          for (
            const word
            of result.words
          ) {

            const normalized =
              normalizeWord(word);

            if (normalized) {
              allWords.add(
                normalized
              );
            }
          }
        }


        /*
         * byFirst에서 구성
         */

        for (
          const list
          of Object.values(
            byFirst
          )
        ) {

          if (
            !Array.isArray(list)
          ) {
            continue;
          }

          for (
            const word
            of list
          ) {

            const normalized =
              normalizeWord(word);

            if (normalized) {
              allWords.add(
                normalized
              );
            }
          }
        }


        if (
          allWords.size === 0
        ) {

          throw new Error(
            "전체 단어 목록이 비어 있습니다."
          );
        }


        dataReady =
          true;


        console.log(
          `[끝말잇기] 전체 단어 ${allWords.size.toLocaleString()}개 로드`
        );

        console.log(
          `[끝말잇기] 공격 단어 ${
            Object.keys(
              attackDepth
            ).length
          }개 로드`
        );


        showMessage(
          "단어 데이터 준비 완료."
        );


        return true;

      } catch (error) {

        console.error(
          "단어 데이터 로드 실패:",
          error
        );

        dataReady =
          false;


        if (
          error?.name ===
          "AbortError"
        ) {

          showMessage(
            "단어 데이터 로딩 시간이 너무 오래 걸렸습니다.",
            true
          );

        } else {

          showMessage(
            `단어 데이터를 불러오지 못했습니다: ${
              error?.message ||
              "알 수 없는 오류"
            }`,
            true
          );
        }


        return false;

      } finally {

        dataLoadingPromise =
          null;
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


  const cacheKey =
    `base:${firstChar}`;


  if (
    candidateCache.has(
      cacheKey
    )
  ) {

    return candidateCache.get(
      cacheKey
    );
  }


  const list =
    byFirst[firstChar];


  const result =
    [];


  if (
    Array.isArray(list)
  ) {

    for (
      const word of list
    ) {

      const normalized =
        normalizeWord(word);

      if (normalized) {
        result.push(
          normalized
        );
      }
    }
  }


  candidateCache.set(
    cacheKey,
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
    normalizeWord(
      previousWord
    );


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


  const result =
    [];

  const seen =
    new Set();


  for (
    const char of chars
  ) {

    const list =
      getBaseCandidates(
        char
      );


    for (
      const word of list
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
    allowedFirstChars(
      char
    );


  const result =
    [];

  const seen =
    new Set();


  for (
    const first of chars
  ) {

    const list =
      getBaseCandidates(
        first
      );


    for (
      const word of list
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
   단어 검사
========================================================= */

function hasWord(
  word
) {

  word =
    normalizeWord(word);


  if (!word) {
    return false;
  }


  if (
    allWords.has(word)
  ) {
    return true;
  }


  /*
   * allWords가 없는 구조에서도
   * byFirst를 이용해 검사 가능.
   */

  const first =
    word.at(0);


  const list =
    getBaseCandidates(
      first
    );


  return list.includes(
    word
  );
}


/* =========================================================
   공격 깊이
========================================================= */

function getAttackDepth(
  word
) {

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


  return Number.isFinite(
    depth
  )
    ? depth
    : null;
}


function isWinningAttack(
  word
) {

  const depth =
    getAttackDepth(word);


  return (
    depth != null &&
    depth % 2 === 1
  );
}


function isLosingAttack(
  word
) {

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
    new Set(
      usedWords
    );


  nextUsed.add(
    word
  );


  const next =
    getCandidates(
      word,
      nextUsed
    );


  const depth =
    getAttackDepth(
      word
    );


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
   배열 섞기
========================================================= */

function shuffleArray(
  array
) {

  for (
    let i =
      array.length - 1;
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
    ] = [
      array[j],
      array[i]
    ];
  }


  return array;
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
    level > 5
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
    singleStats.games <= 0
  ) {
    return 0.50;
  }


  return (
    singleStats.wins /
    singleStats.games
  );
}


/* =========================================================
   AI 강도 보정
========================================================= */

function getAdjustedStrength() {

  const base =
    getDifficultyStrength();

  const winRate =
    getCurrentWinRate();


  let strength =
    base;


  if (
    winRate > 0.70
  ) {

    strength -=
      0.15;

  } else if (
    winRate > 0.60
  ) {

    strength -=
      0.07;

  } else if (
    winRate < 0.30
  ) {

    strength +=
      0.15;

  } else if (
    winRate < 0.40
  ) {

    strength +=
      0.07;
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

  let score =
    0;


  const nextCount =
    info.nextCount;

  const depth =
    info.depth ?? 0;


  /*
   * 상대 선택지
   */

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


  /*
   * 공격 단어
   */

  if (
    info.winningAttack
  ) {

    score +=
      900 +
      Math.min(
        depth,
        31
      ) * 55;


    score +=
      strength *
      1600;


    if (
      nextCount <= 3
    ) {

      score +=
        650;
    }
  }


  /*
   * 짝수 깊이
   */

  if (
    info.losingAttack
  ) {

    score -=
      900 +
      depth * 25;


    if (
      strength < 0.35
    ) {

      score +=
        500;
    }
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
   * 공격 단어 / 한방 금지에 가깝게 처리.
   */

  if (!currentWord) {

    if (
      info.oneShot
    ) {

      score -=
        10000;
    }


    if (
      info.winningAttack
    ) {

      score -=
        strength >= 0.82
          ? 2200
          : 7000;
    }


    if (
      info.losingAttack
    ) {

      score -=
        1500;
    }
  }


  /*
   * Lv1
   *
   * 공격 단어를 거의 사용하지 않는다.
   */

  if (
    getDifficultyLevel() === 1
  ) {

    if (
      info.winningAttack
    ) {

      score -=
        5000;
    }


    if (
      info.oneShot
    ) {

      score -=
        12000;
    }


    if (
      !info.winningAttack &&
      !info.losingAttack
    ) {

      score +=
        1000;
    }
  }


  /*
   * Lv2
   */

  if (
    getDifficultyLevel() === 2 &&
    info.winningAttack
  ) {

    score -=
      2200;
  }


  /*
   * 승률 조정
   */

  const winRate =
    getCurrentWinRate();


  if (
    winRate > 0.65
  ) {

    if (
      info.winningAttack
    ) {

      score -=
        (winRate - 0.65) *
        6000;
    }


    if (
      info.oneShot
    ) {

      score -=
        (winRate - 0.65) *
        7000;
    }
  }


  if (
    winRate < 0.35
  ) {

    if (
      info.winningAttack
    ) {

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

  if (
    !singleGame
  ) {
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


  const level =
    getDifficultyLevel();


  const strength =
    getAdjustedStrength();


  const analyzed =
    candidates.map(
      word =>
        analyzeCandidate(
          word,
          used
        )
    );


  /*
   * =======================================================
   * Lv1
   * =======================================================
   *
   * 최대한 평범한 단어.
   * 공격 단어 / 한방을 피한다.
   */

  if (
    level === 1
  ) {

    const normal =
      analyzed.filter(
        info =>
          !info.winningAttack &&
          !info.losingAttack &&
          !info.oneShot &&
          info.nextCount >= 2
      );


    if (
      normal.length
    ) {

      shuffleArray(
        normal
      );

      return normal[0].word;
    }


    const safe =
      analyzed.filter(
        info =>
          !info.winningAttack &&
          !info.oneShot
      );


    if (
      safe.length
    ) {

      shuffleArray(
        safe
      );

      return safe[0].word;
    }
  }


  /*
   * =======================================================
   * Lv2
   * =======================================================
   */

  if (
    level === 2
  ) {

    const normal =
      analyzed.filter(
        info =>
          !info.winningAttack &&
          !info.oneShot &&
          info.nextCount >= 1
      );


    if (
      normal.length
    ) {

      const scored =
        normal.map(
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
          b.score -
          a.score
      );


      const pool =
        scored.slice(
          0,
          Math.min(
            8,
            scored.length
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
   * =======================================================
   * Lv3~5
   * =======================================================
   */

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
      b.score -
      a.score
  );


  let poolSize;


  if (
    level === 5
  ) {

    poolSize = 3;

  } else if (
    level === 4
  ) {

    poolSize = 4;

  } else {

    poolSize = 7;
  }


  /*
   * 승률이 높으면
   * 조금 더 넓게 선택.
   */

  if (
    getCurrentWinRate() >
    0.65
  ) {

    poolSize +=
      5;
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


  return (
    selected?.info?.word ||
    null
  );
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
      : Object.keys(
          byFirst
        );


  if (
    !startFirst.length
  ) {
    return null;
  }


  const firsts =
    shuffleArray(
      [...startFirst]
    );


  /*
   * 충분히 검사
   */

  for (
    const first of firsts
  ) {

    const list =
      getBaseCandidates(
        first
      );


    if (
      !list.length
    ) {
      continue;
    }


    const candidates =
      shuffleArray(
        [...list]
      );


    /*
     * 너무 많은 계산 방지
     */

    const limit =
      Math.min(
        candidates.length,
        500
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
        getAttackDepth(
          word
        ) != null
      ) {
        continue;
      }


      /*
       * 즉사 시작 단어 금지
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
   * fallback
   *
   * 공격 단어만 피한다.
   */

  for (
    const first of firsts
  ) {

    const list =
      getBaseCandidates(
        first
      );


    for (
      const word of list
    ) {

      if (
        getAttackDepth(
          word
        ) != null
      ) {
        continue;
      }


      return word;
    }
  }


  return null;
}


/* =========================================================
   빈 게임 생성
========================================================= */

function createEmptySingleGame(
  startWord
) {

  return {

    startChar:
      startWord.at(0),

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

    statsSaved:
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


  /*
   * 시작 단어는
   * 플레이어가 낸 것으로 처리.
   */

  if (
    !playSingleWord(
      start,
      0
    )
  ) {

    singleGame =
      null;

    return false;
  }


  if (
    startWordInput
  ) {

    startWordInput.value =
      start;
  }


  singleThinking =
    false;


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

  if (
    !singleGame
  ) {
    return false;
  }


  word =
    normalizeWord(
      word
    );


  if (!word) {
    return false;
  }


  /*
   * 턴 검사
   */

  if (
    singleGame.turnPlayer !==
    player
  ) {

    return false;
  }


  /*
   * 단어 목록
   */

  if (
    !hasWord(word)
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
    singleGame.usedWords.has(
      word
    )
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


    const allowed =
      allowedFirstChars(
        last
      );


    showMessage(
      allowed.length > 1
        ? `"${last}" 다음에는 ${allowed.join(", ")}으로 시작해야 합니다.`
        : `"${last}"으로 시작해야 합니다.`,
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
      getAttackDepth(
        word
      )
  });


  /*
   * 턴 변경
   */

  singleGame.turnPlayer =
    player === 0
      ? 1
      : 0;


  updateSingleUI();

  updateInputState();


  return true;
}


/* =========================================================
   게임 종료 검사
========================================================= */

function checkSingleFinished() {

  if (
    !singleGame ||
    singleGame.finished ||
    !singleGame.currentWord
  ) {
    return false;
  }


  const next =
    getCandidates(
      singleGame.currentWord,
      singleGame.usedWords
    );


  if (
    next.length > 0
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
    singleGame.turnPlayer !==
    1
  ) {

    singleThinking =
      false;

    updateInputState();

    return;
  }


  const word =
    chooseBotWord();


  /*
   * AI가 낼 단어가 없음
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


  if (!success) {

    console.error(
      "[AI] 단어 처리 실패:",
      word
    );


    /*
     * AI가 잘못된 단어를 고른 경우
     * 즉시 패배시키지 않고
     * 안전한 후보를 한 번 더 찾는다.
     */

    const safeCandidates =
      getCandidates(
        singleGame.currentWord,
        singleGame.usedWords
      );


    let fallback =
      null;


    for (
      const candidate
      of safeCandidates
    ) {

      if (
        hasWord(candidate)
      ) {

        fallback =
          candidate;

        break;
      }
    }


    if (
      fallback
    ) {

      const retry =
        playSingleWord(
          fallback,
          1
        );


      if (
        !retry
      ) {

        singleGame.finished =
          true;

        singleGame.winner =
          0;

        singleGame.loser =
          1;

        finishSingleGame();
      }

    } else {

      singleGame.finished =
        true;

      singleGame.winner =
        0;

      singleGame.loser =
        1;

      finishSingleGame();
    }


    singleThinking =
      false;

    updateInputState();

    return;
  }


  /*
   * AI가 방금 이긴 경우
   */

  checkSingleFinished();


  singleThinking =
    false;


  updateInputState();


  if (
    singleGame &&
    !singleGame.finished
  ) {

    showMessage(
      "당신의 차례입니다."
    );


    singleInput?.focus();
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


  if (
    singleGame.turnPlayer !==
    0
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
   * 실패했을 때 복구할 수 있도록
   * 원래 입력을 저장.
   */

  const originalWord =
    word;


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
        originalWord;

      singleInput.focus();
    }

    return;
  }


  /*
   * 플레이어가 즉시 승리했는지 검사
   */

  if (
    checkSingleFinished()
  ) {

    updateInputState();

    return;
  }


  /*
   * AI 생각 시작
   */

  singleThinking =
    true;


  updateInputState();


  showMessage(
    "끝말잇기 AI가 생각 중..."
  );


  /*
   * 브라우저 UI 갱신 후 AI 실행
   */

  setTimeout(
    () => {

      try {

        botTurn();

      } catch (error) {

        console.error(
          "[AI] 치명적 오류:",
          error
        );


        singleThinking =
          false;

        updateInputState();


        showMessage(
          "AI 처리 중 오류가 발생했습니다.",
          true
        );
      }

    },
    50
  );
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
    singleGame.statsSaved
  ) {
    return;
  }


  singleGame.statsSaved =
    true;


  const winner =
    singleGame.winner;


  singleStats.games++;


  singleStats.totalTurns +=
    singleGame.history.length;


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
      String(
        singleGame.history.length
      );
  }


  if (
    depthEl
  ) {

    const depth =
      current
        ? getAttackDepth(
            current
          )
        : null;


    depthEl.textContent =
      depth != null
        ? String(depth)
        : "-";
  }


  if (
    historyEl
  ) {

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


      let text =
        `플레이어 ${
          item.player + 1
        }: ${item.word}`;


      if (
        item.depth != null
      ) {

        text +=
          ` [깊이 ${item.depth}]`;
      }


      div.textContent =
        text;


      historyEl.appendChild(
        div
      );
    }
  }
}


/* =========================================================
   입력창 상태
========================================================= */

function updateInputState() {

  /*
   * 싱글
   */

  const singleDisabled =
    !singleGame ||
    singleGame.finished ||
    singleThinking ||
    singleGame.turnPlayer !==
      0;


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
    !onlineRoom ||
    onlineMyIndex < 0 ||
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
      !saved ||
      typeof saved !==
        "object"
    ) {
      return;
    }


    singleStats = {

      wins:
        Number(
          saved.wins
        ) || 0,

      losses:
        Number(
          saved.losses
        ) || 0,

      games:
        Number(
          saved.games
        ) || 0,

      totalTurns:
        Number(
          saved.totalTurns
        ) || 0
    };

  } catch (error) {

    console.warn(
      "통계 로드 실패:",
      error
    );
  }
}


function updateStats() {

  if (
    winsEl
  ) {

    winsEl.textContent =
      String(
        singleStats.wins
      );
  }


  if (
    lossesEl
  ) {

    lossesEl.textContent =
      String(
        singleStats.losses
      );
  }


  if (
    gamesEl
  ) {

    gamesEl.textContent =
      String(
        singleStats.games
      );
  }


  if (
    avgEl
  ) {

    avgEl.textContent =
      singleStats.games > 0
        ? (
            singleStats.totalTurns /
            singleStats.games
          ).toFixed(1)
        : "-";
  }


  if (
    winrateEl
  ) {

    const rate =
      singleStats.games > 0
        ? (
            singleStats.wins /
            singleStats.games
          ) * 100
        : 0;


    winrateEl.textContent =
      `${rate.toFixed(0)}%`;
  }
}


/* =========================================================
   새 게임
========================================================= */

async function startNewGame() {

  /*
   * 이전 AI 타이머가 실행 중이어도
   * 새 게임이 우선권을 갖도록 상태 초기화.
   */

  singleThinking =
    false;


  if (
    !dataReady
  ) {

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
   * 완전히 새 객체 생성
   */

  singleGame =
    null;


  const success =
    createSingleGame();


  if (!success) {
    return;
  }


  /*
   * 시작 단어를 플레이어가 냈으므로
   * 실제로는 AI 차례.
   *
   * 이것이 정상 상태.
   */

  showMessage(
    "AI의 차례입니다."
  );


  updateSingleUI();

  updateInputState();


  /*
   * 새 게임 버튼을 누르면
   * 바로 AI가 시작한다.
   */

  singleThinking =
    true;


  updateInputState();


  setTimeout(
    () => {

      try {

        botTurn();

      } catch (error) {

        console.error(
          "[새 게임 AI 시작 오류]",
          error
        );


        singleThinking =
          false;

        updateInputState();


        showMessage(
          "AI를 시작하지 못했습니다.",
          true
        );
      }

    },
    50
  );
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


    if (!ok) {
      return;
    }
  }


  singleThinking =
    false;


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

    singleGame =
      null;

    updateInputState();

    return;
  }


  showMessage(
    "AI의 차례입니다."
  );


  updateSingleUI();

  updateInputState();


  singleThinking =
    true;


  updateInputState();


  setTimeout(
    () => {

      try {

        botTurn();

      } catch (error) {

        console.error(
          "[랜덤 시작 AI 오류]",
          error
        );


        singleThinking =
          false;

        updateInputState();

        showMessage(
          "AI를 시작하지 못했습니다.",
          true
        );
      }

    },
    50
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
        button.dataset.mode ===
          mode
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


    if (
      singleGame &&
      !singleGame.finished &&
      !singleThinking &&
      singleGame.turnPlayer === 0
    ) {

      singleInput?.focus();
    }

  } else {

    singlePanel?.classList.add(
      "hidden"
    );

    onlinePanel?.classList.remove(
      "hidden"
    );


    connectSocket();

    updateInputState();
  }
}


/* =========================================================
   온라인 Socket.IO
========================================================= */

function connectSocket() {

  /*
   * 이미 연결된 socket이 있으면
   * 절대로 새 socket을 만들지 않는다.
   */

  if (
    socket
  ) {

    return socket;
  }


  if (
    typeof io !==
    "function"
  ) {

    showOnlineMessage(
      "Socket.IO를 불러오지 못했습니다."
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
      "Socket.IO 생성 실패:",
      error
    );

    socket =
      null;

    return null;
  }


  socket.on(
    "connect",
    () => {

      showOnlineMessage(
        "서버에 연결되었습니다."
      );

      updateInputState();
    }
  );


  socket.on(
    "disconnect",
    () => {

      onlineStarted =
        false;

      updateInputState();


      showOnlineMessage(
        "온라인 서버 연결이 끊어졌습니다."
      );
    }
  );


  socket.on(
    "connect_error",
    error => {

      console.error(
        "Socket.IO 연결 오류:",
        error
      );


      showOnlineMessage(
        "온라인 서버에 연결할 수 없습니다."
      );
    }
  );


  /*
   * 방 생성
   */

  socket.on(
    "roomCreated",
    data => {

      if (
        roomCodeInput
      ) {

        roomCodeInput.value =
          data?.code || "";
      }


      showOnlineMessage(
        `방 생성 완료: ${
          data?.code || ""
        }`
      );
    }
  );


  /*
   * 방 참가
   */

  socket.on(
    "joinedRoom",
    data => {

      if (
        roomCodeInput
      ) {

        roomCodeInput.value =
          data?.code || "";
      }


      showOnlineMessage(
        `방 참가 완료: ${
          data?.code || ""
        }`
      );
    }
  );


  /*
   * 방 상태
   */

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

      updateInputState();
    }
  );


  /*
   * 온라인 시작
   */

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

      } else if (
        data?.room
      ) {

        onlineRoom =
          data.room;
      }


      if (
        onlineRoom
      ) {

        updateOnlineRoom(
          onlineRoom
        );
      }


      showOnlineMessage(
        "게임이 시작되었습니다."
      );


      updateOnlineTurnMessage();

      updateInputState();
    }
  );


  /*
   * 단어 성공
   */

  socket.on(
    "wordPlayed",
    data => {

      if (!data) {
        return;
      }


      /*
       * 서버가 state를 보내는 경우
       */

      if (
        data.state
      ) {

        onlineRoom =
          data.state;


        onlineStarted =
          !data.state.finished;


        updateOnlineRoom(
          data.state
        );
      }


      /*
       * 서버가 history를 보내는 경우
       */

      if (
        Array.isArray(
          data.state?.history
        )
      ) {

        renderOnlineHistory(
          data.state.history
        );

      } else if (
        Array.isArray(
          data.history
        )
      ) {

        renderOnlineHistory(
          data.history
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


  /*
   * 단어 거절
   */

  socket.on(
    "wordRejected",
    data => {

      showOnlineMessage(
        data?.reason ||
        "단어를 사용할 수 없습니다."
      );


      updateInputState();

      onlineInput?.focus();
    }
  );


  /*
   * 게임 종료
   */

  socket.on(
    "gameFinished",
    data => {

      onlineStarted =
        false;


      if (
        data?.state
      ) {

        onlineRoom =
          data.state;

        updateOnlineRoom(
          data.state
        );
      }


      renderOnlineHistory(
        data?.history ||
        data?.state?.history ||
        []
      );


      if (
        data?.winner ===
        onlineMyIndex
      ) {

        showOnlineMessage(
          "승리했습니다!"
        );

      } else {

        showOnlineMessage(
          "패배했습니다."
        );
      }


      updateInputState();
    }
  );


  /*
   * 일반 메시지
   */

  socket.on(
    "roomMessage",
    message => {

      showOnlineMessage(
        message
      );
    }
  );


  /*
   * 에러
   */

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


  if (!s) {
    return;
  }


  const code =
    normalizeWord(
      roomCodeInput?.value
    ).toUpperCase();


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


  if (!s) {
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
    !socket ||
    !socket.connected
  ) {

    showOnlineMessage(
      "서버에 연결되지 않았습니다."
    );

    return;
  }


  if (
    !onlineStarted
  ) {

    showOnlineMessage(
      "아직 게임이 시작되지 않았습니다."
    );

    return;
  }


  if (
    !onlineRoom
  ) {

    showOnlineMessage(
      "방 정보를 불러오는 중입니다."
    );

    return;
  }


  if (
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


  if (
    onlineInput
  ) {

    onlineInput.value =
      "";
  }


  /*
   * 최종 판정은 서버.
   */

  socket.emit(
    "playWord",
    {
      word
    }
  );
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

  if (!state) {

    onlineRoom =
      null;

    onlineMyIndex =
      -1;


    if (
      roomInfo
    ) {

      roomInfo.textContent =
        "";
    }


    updateInputState();

    return;
  }


  onlineRoom =
    state;


  const players =
    Array.isArray(
      state.players
    )
      ? state.players
      : [];


  onlineMyIndex =
    -1;


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
          player?.id ===
            socket.id
        ) {

          onlineMyIndex =
            index;
        }
      }
    );
  }


  /*
   * 방장이고 2명일 때만 시작 버튼
   */

  if (
    startOnlineButton
  ) {

    const canStart =
      players.length === 2 &&
      onlineMyIndex === 0 &&
      !state.started;


    startOnlineButton.classList.toggle(
      "hidden",
      !canStart
    );
  }


  /*
   * history
   */

  const history =
    state.game?.history ||
    state.history ||
    [];


  renderOnlineHistory(
    history
  );


  updateInputState();
}


/* =========================================================
   온라인 기록
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


  for (
    const item of (
      Array.isArray(history)
        ? history
        : []
    )
  ) {

    const div =
      document.createElement(
        "div"
      );


    let text =
      `턴 ${item.turn ?? ""} · 플레이어 ${
        Number(item.player ?? 0) + 1
      } · ${item.word ?? ""}`;


    if (
      item.depth != null
    ) {

      text +=
        ` [깊이 ${item.depth}]`;
    }


    div.textContent =
      text;


    onlineHistory.appendChild(
      div
    );
  }
}


/* =========================================================
   온라인 기록 하나 추가
========================================================= */

function addOnlineHistory(
  word,
  player,
  turn,
  depth
) {

  if (
    !onlineHistory ||
    !word
  ) {
    return;
  }


  const div =
    document.createElement(
      "div"
    );


  let text =
    `턴 ${turn ?? ""} · 플레이어 ${
      Number(player ?? 0) + 1
    } · ${word}`;


  if (
    depth != null
  ) {

    text +=
      ` [깊이 ${depth}]`;
  }


  div.textContent =
    text;


  onlineHistory.appendChild(
    div
  );
}


/* =========================================================
   Enter 처리
========================================================= */

function handleSingleKeydown(
  event
) {

  if (
    event.key !==
    "Enter"
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
    event.key !==
    "Enter"
  ) {
    return;
  }


  event.preventDefault();

  event.stopPropagation();


  sendOnlineWord();
}


/* =========================================================
   이벤트 등록
   중요:
   이 함수는 딱 한 번만 호출.
========================================================= */

function bindEvents() {

  /*
   * 탭
   */

  tabs.forEach(
    button => {

      button.addEventListener(
        "click",
        event => {

          event.preventDefault();

          switchTab(
            button.dataset.mode
          );
        }
      );
    }
  );


  /*
   * 싱글 전송 버튼
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

  newStartButton?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      startNewGame();
    }
  );


  /*
   * 재시작
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

  $("randomStart")?.addEventListener(
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
        roomCodeInput
      ) {

        roomCodeInput.value =
          roomCodeInput.value
            .replace(
              /\s+/g,
              ""
            )
            .toUpperCase();
      }
    }
  );


  /*
   * 닉네임 Enter
   */

  nameInput?.addEventListener(
    "keydown",
    event => {

      if (
        event.key !==
        "Enter"
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
        event.key !==
        "Enter"
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

function init() {

  console.log(
    "[끝말잇기] script.js 초기화"
  );


  loadStats();

  updateStats();


  /*
   * 이벤트 딱 한 번 등록
   */

  bindEvents();


  /*
   * 페이지 처음에는
   * 대용량 단어 데이터를 로드하지 않는다.
   */

  showMessage(
    "새 게임을 눌러 시작하세요."
  );


  /*
   * 처음에는 입력 잠금
   */

  if (
    singleInput
  ) {

    singleInput.disabled =
      true;
  }


  if (
    singleSend
  ) {

    singleSend.disabled =
      true;
  }


  if (
    onlineInput
  ) {

    onlineInput.disabled =
      true;
  }


  if (
    onlineSend
  ) {

    onlineSend.disabled =
      true;
  }


  /*
   * 기본 탭
   */

  const activeTab =
    document.querySelector(
      ".tabs button.active"
    );


  if (
    activeTab
  ) {

    switchTab(
      activeTab.dataset.mode ||
      "single"
    );

  } else {

    switchTab(
      "single"
    );
  }


  updateInputState();
}


/* =========================================================
   DOM 준비 후 실행
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
