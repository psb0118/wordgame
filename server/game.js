"use strict";

/*
 * 끝말잇기 공통 게임 엔진
 *
 * word.txt
 *   실제 사용 가능한 전체 단어
 *
 * attack.txt
 *   공격 단어 + 공격 깊이
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

  const values = dueum[lastChar];

  if (Array.isArray(values)) {
    for (const ch of values) {
      if (ch) result.add(ch);
    }
  }

  /*
   * 역방향
   *
   * 녀 -> 여
   * 여 -> 녀도 허용
   */
  for (const [from, list] of Object.entries(dueum)) {
    if (
      Array.isArray(list) &&
      list.includes(lastChar)
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

  return allowedFirstChars(
    last,
    dueum
  ).includes(first);
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

function getAttackDepth(
  word,
  attackDepth = {}
) {
  const value =
    attackDepth?.[word];

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

  return (
    depth != null &&
    depth % 2 === 1
  );
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

  return (
    depth != null &&
    depth % 2 === 0
  );
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
    new Set(
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

  if (!hasWord(word, words)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }

  if (game.usedWords.has(word)) {
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

  game.turnPlayer =
    player === 0
      ? 1
      : 0;

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
        ),

      nextCount: 0
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
   봇
========================================================= */

function scoreBotCandidate(
  info,
  strength = 0.5
) {
  let score = 0;

  const depth =
    info.depth ?? 0;

  const nextCount =
    info.nextCount;


  /*
   * 상대 선택지가 0개
   * → 매우 강한 공격
   */
  if (info.oneShot) {
    score +=
      9000 * strength;
  }


  /*
   * 공격 단어
   */
  if (info.winningAttack) {
    score +=
      1000 +
      depth * 50;

    /*
     * 상대 선택지가 적을수록
     * 공격 가치 증가
     */
    if (nextCount === 1) {
      score += 800;
    }

    if (nextCount === 2) {
      score += 400;
    }
  }


  /*
   * 패배 방향 공격 데이터는
   * 위험한 수로 취급
   */
  if (info.losingAttack) {
    score -= 500;
    score -= depth * 15;
  }


  /*
   * 선택지가 지나치게 많은 단어는
   * 공격력이 낮은 것으로 간주
   */
  score +=
    Math.max(
      0,
      20 - Math.min(nextCount, 20)
    ) * 8;


  /*
   * 강도가 높으면 공격 선호
   */
  score +=
    strength *
    (
      info.winningAttack
        ? 1000
        : 50
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
  strength = 0.5
}) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  let candidates =
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

  let analyzed =
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
   * 첫 수는 너무 강한 공격을 피한다.
   */
  if (!currentWord) {
    const safe =
      analyzed.filter(
        info =>
          !info.oneShot &&
          !info.winningAttack
      );

    if (safe.length) {
      analyzed = safe;
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
   * 난이도가 낮을수록
   * 상위 후보를 많이 섞는다.
   */
  const poolSize =
    strength >= 0.8
      ? 2
      : strength >= 0.65
        ? 4
        : strength >= 0.5
          ? 6
          : 10;

  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );

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

  chooseBotWord,

  getPublicGameState
};
