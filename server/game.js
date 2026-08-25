"use strict";

/*
 * =========================================================
 * 끝말잇기 게임 엔진
 * =========================================================
 *
 * word.txt
 *   실제 사용 가능한 전체 단어
 *
 * attack.txt
 *   공격 단어 + 공격 깊이
 *
 * 주요 기능
 *   - 단어 정규화
 *   - 두음법칙
 *   - 연결 판정
 *   - 중복 판정
 *   - 빠른 후보 검색
 *   - 공격 깊이 분석
 *   - 상황형 AI
 *   - AI 승률 조절
 *
 * 중요:
 *   후보 검색은 매번 전체 word Set을 순회하지 않는다.
 *   처음 한 번 글자별 인덱스를 만들고 재사용한다.
 */


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

function allowedFirstChars(lastChar, dueum = {}) {
  if (!lastChar) {
    return [];
  }

  const result = new Set();

  result.add(lastChar);


  /*
   * 정방향
   *
   * 예:
   * 녀 -> 여
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
   * 녀 -> 여
   *
   * 마지막 글자가 여일 때
   * 녀도 후보로 허용
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


/* =========================================================
   연결 판정
========================================================= */

function canConnect(
  previousWord,
  nextWord,
  dueum = {}
) {
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

  return allowedFirstChars(
    last,
    dueum
  ).includes(first);
}


/* =========================================================
   단어 검사
========================================================= */

function hasWord(word, words) {
  word =
    normalizeWord(word);

  if (!word || !words) {
    return false;
  }

  if (words instanceof Set) {
    return words.has(word);
  }

  if (Array.isArray(words)) {
    return words.includes(word);
  }

  return false;
}


/* =========================================================
   빠른 단어 인덱스
========================================================= */

/*
 * 같은 Set에 대해서는 인덱스를 한 번만 만든다.
 *
 * WeakMap을 사용하므로 word Set이 사라지면
 * 인덱스도 자연스럽게 정리된다.
 */

const wordIndexCache =
  new WeakMap();


function getWordIndex(words) {

  if (!words) {
    return new Map();
  }


  /*
   * 이미 만들어진 인덱스가 있으면 재사용
   */

  if (
    words instanceof Set &&
    wordIndexCache.has(words)
  ) {
    return wordIndexCache.get(words);
  }


  const index =
    new Map();


  const source =
    words instanceof Set
      ? words
      : new Set(words);


  for (const rawWord of source) {

    const word =
      normalizeWord(rawWord);

    if (!word) {
      continue;
    }

    const first =
      word.at(0);

    if (!index.has(first)) {
      index.set(first, []);
    }

    index
      .get(first)
      .push(word);
  }


  /*
   * Set일 경우 캐시
   */

  if (words instanceof Set) {
    wordIndexCache.set(
      words,
      index
    );
  }


  return index;
}


/* =========================================================
   후보 검색
========================================================= */

function getCandidates(
  previousWord,
  usedWords,
  words,
  dueum = {}
) {
  previousWord =
    normalizeWord(previousWord);

  if (!previousWord || !words) {
    return [];
  }


  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );


  const index =
    getWordIndex(words);


  const allowed =
    allowedFirstChars(
      previousWord.at(-1),
      dueum
    );


  const result = [];


  /*
   * 필요한 첫 글자 배열만 검색
   */

  for (const first of allowed) {

    const list =
      index.get(first);

    if (!list) {
      continue;
    }


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
   특정 글자 후보
========================================================= */

function getCandidatesFromChar(
  char,
  usedWords,
  words,
  dueum = {}
) {
  if (!char || !words) {
    return [];
  }


  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );


  const index =
    getWordIndex(words);


  const allowed =
    allowedFirstChars(
      char,
      dueum
    );


  const result = [];


  for (const first of allowed) {

    const list =
      index.get(first);

    if (!list) {
      continue;
    }


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

function getAttackDepth(
  word,
  attackDepth = {}
) {
  if (!word || !attackDepth) {
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


/*
 * attack.txt의 깊이는
 *
 * 1, 3, 5, 7, ...
 *
 * 홀수 = 공격 단어
 *
 * attack.txt에는 공격 단어만 있으므로
 * 깊이가 존재하는 것 자체가 공격 단어라는 뜻이다.
 */

function isWinningAttack(
  word,
  attackDepth = {}
) {
  return (
    getAttackDepth(
      word,
      attackDepth
    ) != null
  );
}


/*
 * 기존 코드와의 호환성을 위해 유지.
 *
 * attack.txt 자체에는 양보 단어가 없으므로
 * 이 함수는 항상 false다.
 */

function isLosingAttack(
  word,
  attackDepth = {}
) {
  return false;
}


/* =========================================================
   단어 분석
========================================================= */

function analyzeWord(
  word,
  usedWords,
  words,
  attackDepth,
  dueum
) {
  const nextUsed =
    usedWords instanceof Set
      ? new Set(usedWords)
      : new Set(
          usedWords || []
        );


  nextUsed.add(word);


  const next =
    getCandidates(
      word,
      nextUsed,
      words,
      dueum
    );


  const depth =
    getAttackDepth(
      word,
      attackDepth
    );


  return {
    word,

    depth,

    nextCount:
      next.length,

    oneShot:
      next.length === 0,

    winningAttack:
      depth != null,

    losingAttack:
      false
  };
}


/* =========================================================
   게임 생성
========================================================= */

function createGame({
  startChar = "",
  startPlayer = 0
} = {}) {

  return {

    startChar,

    currentWord: null,

    turnPlayer:
      startPlayer,

    history: [],

    usedWords:
      new Set(),

    finished: false,

    winner: null,

    loser: null
  };
}


/* =========================================================
   단어 플레이
========================================================= */

function playWord(
  game,
  word,
  words,
  dueum = {},
  attackDepth = {}
) {

  if (!game) {
    return {
      ok: false,
      reason:
        "게임 정보를 찾을 수 없습니다."
    };
  }


  if (game.finished) {
    return {
      ok: false,
      reason:
        "이미 끝난 게임입니다."
    };
  }


  word =
    normalizeWord(word);


  if (!word) {
    return {
      ok: false,
      reason:
        "단어를 입력해주세요."
    };
  }


  /*
   * 전체 단어 목록
   */

  if (!hasWord(word, words)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }


  /*
   * 중복
   */

  if (
    game.usedWords.has(word)
  ) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /*
   * 첫 단어
   */

  if (!game.currentWord) {

    if (
      game.startChar &&
      !allowedFirstChars(
        game.startChar,
        dueum
      ).includes(
        word.at(0)
      )
    ) {
      return {
        ok: false,

        reason:
          `"${game.startChar}"으로 시작하는 단어가 아닙니다.`
      };
    }
  }


  /*
   * 연결
   */

  if (
    game.currentWord &&
    !canConnect(
      game.currentWord,
      word,
      dueum
    )
  ) {

    const last =
      game.currentWord.at(-1);


    return {
      ok: false,

      reason:
        `"${last}" 다음에 연결할 수 없는 단어입니다.`,

      allowed:
        allowedFirstChars(
          last,
          dueum
        )
    };
  }


  const player =
    game.turnPlayer;


  /*
   * 등록
   */

  game.currentWord =
    word;

  game.usedWords.add(word);


  const depth =
    getAttackDepth(
      word,
      attackDepth
    );


  game.history.push({

    word,

    player,

    turn:
      game.history.length + 1,

    depth
  });


  /*
   * 다음 플레이어
   */

  game.turnPlayer =
    player === 0
      ? 1
      : 0;


  /*
   * 다음 후보
   */

  const next =
    getCandidates(
      word,
      game.usedWords,
      words,
      dueum
    );


  /*
   * 끝
   */

  if (!next.length) {

    game.finished =
      true;

    game.winner =
      player;

    game.loser =
      game.turnPlayer;


    return {

      ok: true,

      finished: true,

      winner:
        player,

      loser:
        game.turnPlayer,

      word,

      depth
    };
  }


  return {

    ok: true,

    finished: false,

    word,

    depth,

    nextTurn:
      game.turnPlayer,

    nextCount:
      next.length
  };
}


/* =========================================================
   AI 상황 분석
========================================================= */

/*
 * AI는 난이도 선택을 사용하지 않는다.
 *
 * 현재 게임 상황으로 자동 판단한다.
 *
 * 상대 선택지
 *   0개 -> 매우 강한 공격
 *   1개 -> 강한 공격
 *   많음 -> 중간 공격
 *
 * 내가 위험
 *   -> 안전한 수 우선
 *
 * AI 승률이 높음
 *   -> 공격 강도 감소
 *
 * AI 승률이 낮음
 *   -> 공격 강도 증가
 */


/* ---------------------------------------------------------
   현재 AI 승률에 따른 기본 강도
--------------------------------------------------------- */

function calculateBotStrength(
  stats = {}
) {
  const games =
    Number(stats.games) || 0;

  const wins =
    Number(stats.wins) || 0;


  /*
   * 게임이 충분하지 않으면
   * 정확한 승률 판단을 하지 않는다.
   */

  if (games < 3) {
    return 0.50;
  }


  const winrate =
    wins / games;


  /*
   * AI가 너무 강함
   */

  if (winrate >= 0.70) {
    return 0.30;
  }


  if (winrate >= 0.60) {
    return 0.40;
  }


  /*
   * 목표 구간
   */

  if (
    winrate >= 0.45 &&
    winrate <= 0.55
  ) {
    return 0.50;
  }


  /*
   * AI가 약함
   */

  if (winrate <= 0.30) {
    return 0.75;
  }


  if (winrate <= 0.40) {
    return 0.65;
  }


  return 0.55;
}


/* =========================================================
   후보 점수
========================================================= */

function scoreBotCandidate(
  info,
  strength = 0.50,
  danger = false
) {

  let score = 0;


  const depth =
    info.depth ?? 0;

  const nextCount =
    info.nextCount;


  /*
   * =====================================================
   * 1. 즉시 승리
   * =====================================================
   */

  if (info.oneShot) {

    /*
     * 무조건 매우 높은 점수.
     *
     * 단, AI 승률이 이미 지나치게 높으면
     * 다른 후보도 고려할 수 있도록 차이를 줄인다.
     */

    score +=
      strength >= 0.65
        ? 10000
        : 5000;
  }


  /*
   * =====================================================
   * 2. 공격 단어
   * =====================================================
   */

  if (info.winningAttack) {

    score +=
      900 +
      depth * 65;


    /*
     * 상대 선택지가 적을수록 강한 공격
     */

    if (nextCount === 0) {
      score +=
        7000 * strength;
    }

    else if (nextCount === 1) {
      score +=
        2500 * strength;
    }

    else if (nextCount <= 3) {
      score +=
        1000 * strength;
    }

    else {
      score +=
        250 * strength;
    }
  }


  /*
   * =====================================================
   * 3. 일반 단어
   * =====================================================
   */

  /*
   * 내가 다음 턴에 선택지가 많아지는 단어를
   * 기본적으로 안전한 수로 평가한다.
   */

  score +=
    Math.min(
      nextCount,
      100
    ) * 8;


  /*
   * =====================================================
   * 4. 위험한 상황
   * =====================================================
   */

  if (danger) {

    /*
     * 공격보다 내가 살 수 있는 수를 우선
     */

    score +=
      Math.min(
        nextCount,
        100
      ) * 20;


    /*
     * 깊은 공격은 위험할 때 약간 억제
     */

    if (info.winningAttack) {
      score -=
        400 * (1 - strength);
    }
  }


  /*
   * =====================================================
   * 5. AI 강도
   * =====================================================
   */

  if (info.winningAttack) {

    score +=
      strength * 1800;
  }

  else {

    score +=
      (1 - strength) * 250;
  }


  /*
   * =====================================================
   * 6. 깊이
   * =====================================================
   */

  if (info.winningAttack) {

    score +=
      depth * strength * 50;
  }


  return score;
}


/* =========================================================
   AI 후보 선택
========================================================= */

function chooseBotWord({
  currentWord,
  startChar,
  usedWords,
  words,
  dueum = {},
  attackDepth = {},

  /*
   * 기존 코드 호환용
   */

  strength = null,

  /*
   * 승률 정보
   */

  stats = {},

  /*
   * 현재 상황에서
   * AI가 다음 턴에 위험한지
   */

  danger = false
}) {

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );


  /*
   * 강도를 자동 결정
   */

  const actualStrength =
    strength == null
      ? calculateBotStrength(stats)
      : Number(strength);


  /*
   * 후보
   */

  const candidates =
    currentWord

      ? getCandidates(
          currentWord,
          used,
          words,
          dueum
        )

      : getCandidatesFromChar(
          startChar,
          used,
          words,
          dueum
        );


  if (!candidates.length) {
    return null;
  }


  /*
   * =====================================================
   * 첫 수 최적화
   * =====================================================
   *
   * 첫 단어부터 공격 단어를 사용하면
   * 게임 밸런스가 이상해질 수 있다.
   *
   * 따라서 첫 수에서는
   * 일반 단어를 우선한다.
   */

  if (!currentWord) {

    const normal =
      candidates.filter(
        word =>
          !isWinningAttack(
            word,
            attackDepth
          )
      );


    if (normal.length) {

      /*
       * 첫 수에서는 전체 후보를
       * 전부 분석하지 않는다.
       *
       * 랜덤으로 적당한 후보를 선택해서
       * 시작 속도를 빠르게 한다.
       */

      const limit =
        Math.min(
          normal.length,
          30
        );


      return normal[
        Math.floor(
          Math.random() * limit
        )
      ];
    }
  }


  /*
   * =====================================================
   * 후보 분석
   * =====================================================
   */

  const analyzed = [];


  /*
   * 모든 단어를 깊게 분석하지 않고
   * 공격 단어 + 일부 일반 단어만 우선 분석한다.
   *
   * 성능 개선 핵심.
   */

  const attackCandidates = [];

  const normalCandidates = [];


  for (const word of candidates) {

    if (
      isWinningAttack(
        word,
        attackDepth
      )
    ) {
      attackCandidates.push(word);
    }

    else {
      normalCandidates.push(word);
    }
  }


  /*
   * 공격 후보는 깊은 순으로 제한
   */

  attackCandidates.sort(
    (a, b) =>
      (
        getAttackDepth(
          b,
          attackDepth
        ) ?? 0
      ) -
      (
        getAttackDepth(
          a,
          attackDepth
        ) ?? 0
      )
  );


  /*
   * 일반 후보는 일부만 분석.
   */

  const normalSample =
    normalCandidates.length > 40
      ? normalCandidates
          .slice()
          .sort(
            () =>
              Math.random() - 0.5
          )
          .slice(0, 40)
      : normalCandidates;


  /*
   * 공격 후보 최대 40개
   */

  const selected =
    [
      ...attackCandidates.slice(
        0,
        40
      ),

      ...normalSample
    ];


  /*
   * 중복 제거
   */

  const unique =
    [
      ...new Set(selected)
    ];


  for (const word of unique) {

    analyzed.push(
      analyzeWord(
        word,
        used,
        words,
        attackDepth,
        dueum
      )
    );
  }


  if (!analyzed.length) {
    return candidates[0];
  }


  /*
   * =====================================================
   * 점수
   * =====================================================
   */

  const scored =
    analyzed.map(
      info => ({

        ...info,

        score:
          scoreBotCandidate(
            info,
            actualStrength,
            danger
          )
      })
    );


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /*
   * =====================================================
   * 상황별 선택
   * =====================================================
   */

  const best =
    scored[0];


  /*
   * 상대 선택지가 0개인 공격
   *
   * 명백한 승리 수.
   *
   * AI 승률이 너무 높을 때가 아니라면
   * 적극적으로 사용한다.
   */

  if (
    best &&
    best.oneShot &&
    actualStrength >= 0.45
  ) {
    return best.word;
  }


  /*
   * 상위 후보 중 선택
   *
   * 강도가 높으면 상위 후보를 좁게,
   * 낮으면 넓게 잡는다.
   */

  let poolSize;


  if (actualStrength >= 0.70) {
    poolSize = 2;
  }

  else if (actualStrength >= 0.55) {
    poolSize = 4;
  }

  else if (actualStrength >= 0.40) {
    poolSize = 7;
  }

  else {
    poolSize = 12;
  }


  /*
   * 실제 후보 수에 맞춤
   */

  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );


  if (!pool.length) {
    return candidates[0];
  }


  /*
   * 상위 후보 중 랜덤 선택.
   *
   * 완전 최선 수만 고르면 AI 승률이
   * 지나치게 높아질 수 있다.
   */

  return pool[
    Math.floor(
      Math.random() *
      pool.length
    )
  ].word;
}


/* =========================================================
   공개 상태
========================================================= */

function getPublicGameState(game) {

  if (!game) {
    return null;
  }


  return {

    startChar:
      game.startChar,

    currentWord:
      game.currentWord,

    turnPlayer:
      game.turnPlayer,

    history:
      game.history.map(
        item => ({

          word:
            item.word,

          player:
            item.player,

          turn:
            item.turn,

          depth:
            item.depth
        })
      ),

    finished:
      game.finished,

    winner:
      game.winner,

    loser:
      game.loser
  };
}


/* =========================================================
   exports
========================================================= */

module.exports = {

  normalizeWord,

  allowedFirstChars,
  canConnect,

  hasWord,

  getCandidates,
  getCandidatesFromChar,

  getAttackDepth,
  isWinningAttack,
  isLosingAttack,

  analyzeWord,

  createGame,
  playWord,

  calculateBotStrength,
  scoreBotCandidate,
  chooseBotWord,

  getPublicGameState
};
