```js
"use strict";

/*
 * 끝말잇기 공통 게임 엔진
 *
 * word.txt
 *   실제 사용 가능한 전체 단어 목록
 *
 * attack.txt
 *   공격 단어 + 공격 깊이
 *
 * 봇은 이 엔진을 사용하고,
 * 온라인 2인도 같은 엔진으로 판정한다.
 */


/* =========================================================
   기본
========================================================= */

function normalizeWord(word) {
  if (typeof word !== "string") return "";

  return word
    .trim()
    .replace(/\s+/g, "")
    .normalize("NFC");
}


/* =========================================================
   두음법칙
========================================================= */

function allowedFirstChars(lastChar, dueum = {}) {
  if (!lastChar) return [];

  const result = new Set([lastChar]);

  const add = value => {
    if (Array.isArray(value)) {
      for (const ch of value) {
        if (ch) result.add(ch);
      }
    }
  };

  add(dueum[lastChar]);

  /*
   * 역방향도 허용.
   *
   * 예:
   * 녀 -> 여
   *
   * 여가 마지막 글자인 경우
   * 녀도 연결 후보로 인정할 수 있도록 한다.
   */
  for (const [from, values] of Object.entries(dueum)) {
    if (
      Array.isArray(values) &&
      values.includes(lastChar)
    ) {
      result.add(from);
    }
  }

  return [...result];
}


function canConnect(previousWord, nextWord, dueum = {}) {
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
    return false;
  }

  const last = previousWord.at(-1);
  const first = nextWord.at(0);

  return allowedFirstChars(last, dueum)
    .includes(first);
}


/* =========================================================
   단어
========================================================= */

function hasWord(word, words) {
  word = normalizeWord(word);

  if (!word || !words) return false;

  if (words instanceof Set) {
    return words.has(word);
  }

  if (Array.isArray(words)) {
    return words.includes(word);
  }

  return false;
}


function getCandidates(
  previousWord,
  usedWords,
  words,
  dueum = {}
) {
  const result = [];

  previousWord =
    normalizeWord(previousWord);

  if (!previousWord || !words) {
    return result;
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const source =
    words instanceof Set
      ? words
      : new Set(words);

  const allowed =
    new Set(
      allowedFirstChars(
        previousWord.at(-1),
        dueum
      )
    );

  for (const word of source) {
    if (!word || used.has(word)) {
      continue;
    }

    if (!allowed.has(word.at(0))) {
      continue;
    }

    result.push(word);
  }

  return result;
}


function getCandidatesFromChar(
  char,
  usedWords,
  words,
  dueum = {}
) {
  const result = [];

  if (!char || !words) {
    return result;
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const source =
    words instanceof Set
      ? words
      : new Set(words);

  const allowed =
    new Set(
      allowedFirstChars(
        char,
        dueum
      )
    );

  for (const word of source) {
    if (used.has(word)) continue;

    if (allowed.has(word.at(0))) {
      result.push(word);
    }
  }

  return result;
}


/* =========================================================
   공격 데이터
========================================================= */

function getAttackDepth(word, attackDepth = {}) {
  const value = attackDepth?.[word];

  if (value == null) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function isWinningAttack(
  word,
  attackDepth = {}
) {
  const depth =
    getAttackDepth(
      word,
      attackDepth
    );

  return depth != null &&
    depth % 2 === 1;
}


function isLosingAttack(
  word,
  attackDepth = {}
) {
  const depth =
    getAttackDepth(
      word,
      attackDepth
    );

  return depth != null &&
    depth % 2 === 0;
}


/* =========================================================
   상태 분석
========================================================= */

function analyzeWord(
  word,
  usedWords,
  words,
  attackDepth,
  dueum
) {
  const nextUsed =
    new Set(usedWords || []);

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
      depth != null &&
      depth % 2 === 1,

    losingAttack:
      depth != null &&
      depth % 2 === 0
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

    usedWords: new Set(),

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
      reason: "게임 정보를 찾을 수 없습니다."
    };
  }

  if (game.finished) {
    return {
      ok: false,
      reason: "이미 끝난 게임입니다."
    };
  }

  word =
    normalizeWord(word);

  if (!word) {
    return {
      ok: false,
      reason: "단어를 입력해주세요."
    };
  }


  /* 단어 목록 */

  if (!hasWord(word, words)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }


  /* 중복 */

  if (game.usedWords.has(word)) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /* 첫 단어 */

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


  /* 연결 */

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


  /* 등록 */

  game.currentWord =
    word;

  game.usedWords.add(word);

  game.history.push({
    word,
    player,
    turn:
      game.history.length + 1,

    depth:
      getAttackDepth(
        word,
        attackDepth
      )
  });


  /* 다음 플레이어 */

  game.turnPlayer =
    player === 0
      ? 1
      : 0;


  /* 다음 수 검사 */

  const next =
    getCandidates(
      word,
      game.usedWords,
      words,
      dueum
    );


  if (!next.length) {
    game.finished = true;

    game.winner =
      player;

    game.loser =
      game.turnPlayer;

    return {
      ok: true,
      finished: true,
      winner: player,
      loser: game.turnPlayer,
      word,

      depth:
        getAttackDepth(
          word,
          attackDepth
        )
    };
  }


  return {
    ok: true,
    finished: false,

    word,

    depth:
      getAttackDepth(
        word,
        attackDepth
      ),

    nextTurn:
      game.turnPlayer,

    nextCount:
      next.length
  };
}


/* =========================================================
   봇 후보 평가
========================================================= */

/*
 * 봇의 목표는 "항상 최강"이 아니다.
 *
 * 기본 목표:
 *   장기적으로 사람과 봇의 승률이
 *   최대한 1:1에 가까워지도록 한다.
 *
 * 단,
 *   명백한 한방을 일부러 계속 놓치는 방식이 아니라
 *   후보 중 적절한 수를 선택한다.
 */


function scoreBotCandidate(
  info,
  targetStrength = 0.50
) {
  let score = 0;

  const depth =
    info.depth ?? 0;

  const nextCount =
    info.nextCount;


  /* 즉시 승리 */

  if (info.oneShot) {
    score += 9000;
  }


  /* 공격 */

  if (info.winningAttack) {
    score +=
      1200 +
      depth * 55;

    /*
     * 공격 단어인데 상대 선택지가 너무 적으면
     * 지나치게 강한 수로 본다.
     */
    if (nextCount <= 2) {
      score += 350;
    }
  }


  /* 양보 */

  if (info.losingAttack) {
    score -= 700;
    score -= depth * 20;
  }


  /* 일반 단어 */

  score +=
    Math.min(
      nextCount,
      100
    ) * 7;


  /*
   * 목표 강도에 따른 조절
   *
   * 0.50 근처:
   *   강한 공격과 안전한 일반 수를 적당히 섞는다.
   *
   * 강도가 높아질수록:
   *   공격을 선호.
   */

  score +=
    (targetStrength - 0.5) *
    (
      info.winningAttack
        ? 1800
        : 300
    );


  return score;
}


function chooseBotWord({
  currentWord,
  startChar,
  usedWords,
  words,
  dueum,
  attackDepth,
  strength = 0.50
}) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);


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


  const analyzed =
    candidates.map(
      word =>
        analyzeWord(
          word,
          used,
          words,
          attackDepth,
          dueum
        )
    );


  /*
   * 첫 단어는 공격/한방을 피한다.
   *
   * 첫 수부터 끝내버리면 선공 쪽이 지나치게
   * 유리해지는 문제를 방지한다.
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
      analyzed.splice(
        0,
        analyzed.length,
        ...safe
      );
    }
  }


  const scored =
    analyzed.map(
      info => ({
        ...info,

        score:
          scoreBotCandidate(
            info,
            strength
          )
      })
    );


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /*
   * 상위 후보 여러 개를 남긴다.
   *
   * 완전한 최선 수만 고르면 봇이 지나치게 강해질 수 있다.
   */

  const poolSize =
    strength >= 0.75
      ? 2
      : strength >= 0.60
        ? 4
        : 7;


  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );


  /*
   * 상위 후보 중 랜덤 선택.
   *
   * 이 부분이 사람과 봇의 승률을
   * 지나치게 벌어지지 않게 하는 핵심이다.
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
  if (!game) return null;

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
          word: item.word,
          player: item.player,
          turn: item.turn,
          depth: item.depth
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

  chooseBotWord,

  getPublicGameState
};
```
