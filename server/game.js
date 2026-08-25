"use strict";

/*
 * 끝말잇기 게임 엔진
 *
 * 사용 데이터
 *   word.txt   : 실제 사용 가능한 전체 단어
 *   attack.txt : 공격 단어 + 공격 깊이
 *
 * 이 파일은 브라우저가 아니라 Node.js 서버에서 실행된다.
 */


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

function allowedFirstChars(lastChar, dueum = {}) {
  if (!lastChar) {
    return [];
  }

  const result = new Set();

  result.add(lastChar);

  const direct = dueum[lastChar];

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
   * 녀로 시작하는 단어도 후보에 포함한다.
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
   연결 검사
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
   후보 검색
========================================================= */

/*
 * wordIndex 구조:
 *
 * {
 *   가: [...],
 *   각: [...],
 *   간: [...],
 *   ...
 * }
 *
 * 서버에서 만들어 둔 인덱스를 사용할 수 있다.
 *
 * 인덱스가 없으면 words 전체를 검색한다.
 */

function getCandidates(
  previousWord,
  usedWords,
  words,
  dueum = {},
  wordIndex = null
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

  const last =
    previousWord.at(-1);

  const allowed =
    new Set(
      allowedFirstChars(
        last,
        dueum
      )
    );

  let source;

  /*
   * 인덱스 사용
   */

  if (wordIndex) {
    source = [];

    for (const first of allowed) {
      const list =
        wordIndex[first];

      if (Array.isArray(list)) {
        source.push(...list);
      }
    }
  } else {
    source =
      words instanceof Set
        ? words
        : new Set(words);
  }

  for (const word of source) {
    if (!word) {
      continue;
    }

    if (used.has(word)) {
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
  dueum = {},
  wordIndex = null
) {
  if (!char || !words) {
    return [];
  }

  const allowed =
    allowedFirstChars(
      char,
      dueum
    );

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const result = [];

  if (wordIndex) {
    for (const first of allowed) {
      const list =
        wordIndex[first];

      if (!Array.isArray(list)) {
        continue;
      }

      for (const word of list) {
        if (!used.has(word)) {
          result.push(word);
        }
      }
    }

    return result;
  }

  const source =
    words instanceof Set
      ? words
      : new Set(words);

  for (const word of source) {
    if (!used.has(word) &&
        allowed.includes(word.at(0))) {
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
  word =
    normalizeWord(word);

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


function isAttackWord(
  word,
  attackDepth = {}
) {
  return (
    getAttackDepth(
      word,
      attackDepth
    ) !== null
  );
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

  /*
   * attack.txt의 깊이는
   * 실제 공격 데이터에 존재하는 경우만 인정한다.
   */

  return (
    depth !== null &&
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
    depth !== null &&
    depth % 2 === 0
  );
}


/* =========================================================
   후보 분석
========================================================= */

function analyzeWord({
  word,
  usedWords,
  words,
  attackDepth,
  dueum,
  wordIndex
}) {
  const nextUsed =
    new Set(
      usedWords instanceof Set
        ? usedWords
        : usedWords || []
    );

  nextUsed.add(word);

  const next =
    getCandidates(
      word,
      nextUsed,
      words,
      dueum,
      wordIndex
    );

  const depth =
    getAttackDepth(
      word,
      attackDepth
    );

  return {
    word,

    depth,

    isAttack:
      depth !== null,

    winningAttack:
      depth !== null &&
      depth % 2 === 1,

    losingAttack:
      depth !== null &&
      depth % 2 === 0,

    nextCount:
      next.length,

    oneShot:
      next.length === 0
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

    loser: null,

    /*
     * 싱글 AI 승률 조절용
     */
    botWins: 0,

    playerWins: 0,

    games: 0
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
  attackDepth = {},
  wordIndex = null
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


  /* ---------------------------------------------------------
     단어 목록
  --------------------------------------------------------- */

  if (!hasWord(word, words)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }


  /* ---------------------------------------------------------
     중복
  --------------------------------------------------------- */

  if (game.usedWords.has(word)) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /* ---------------------------------------------------------
     첫 단어
  --------------------------------------------------------- */

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


  /* ---------------------------------------------------------
     연결
  --------------------------------------------------------- */

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


  /* ---------------------------------------------------------
     등록
  --------------------------------------------------------- */

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


  /* ---------------------------------------------------------
     다음 플레이어
  --------------------------------------------------------- */

  game.turnPlayer =
    player === 0
      ? 1
      : 0;


  /* ---------------------------------------------------------
     다음 후보
  --------------------------------------------------------- */

  const next =
    getCandidates(
      word,
      game.usedWords,
      words,
      dueum,
      wordIndex
    );


  /* ---------------------------------------------------------
     게임 종료
  --------------------------------------------------------- */

  if (next.length === 0) {
    game.finished = true;

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
   봇 후보 점수
========================================================= */

function scoreBotCandidate(
  info,
  context = {}
) {
  const {
    strength = 0.5,
    botWinRate = 0.5
  } = context;

  let score = 0;

  const depth =
    info.depth ?? 0;

  const nextCount =
    info.nextCount;


  /* ---------------------------------------------------------
     1. 상대 선택지 0개
     가장 강력한 공격
  --------------------------------------------------------- */

  if (info.oneShot) {
    score += 10000;
  }


  /* ---------------------------------------------------------
     2. 상대 선택지 1개
  --------------------------------------------------------- */

  else if (nextCount === 1) {
    score += 3000;
  }


  /* ---------------------------------------------------------
     3. 상대 선택지 적음
  --------------------------------------------------------- */

  else if (nextCount <= 3) {
    score += 1300;
  }


  /* ---------------------------------------------------------
     4. 선택지가 많으면 공격 강도 낮춤
  --------------------------------------------------------- */

  else {
    score +=
      Math.max(
        0,
        500 - nextCount * 3
      );
  }


  /* ---------------------------------------------------------
     공격 단어
  --------------------------------------------------------- */

  if (info.winningAttack) {
    score +=
      1000 +
      depth * 45;

    /*
     * 봇이 너무 강하면 공격 점수 감소
     */

    if (botWinRate > 0.65) {
      score -=
        (botWinRate - 0.65) *
        4000;
    }

    /*
     * 봇이 불리하면 공격 강화
     */

    if (botWinRate < 0.45) {
      score +=
        (0.45 - botWinRate) *
        4500;
    }
  }


  /* ---------------------------------------------------------
     양보 단어
  --------------------------------------------------------- */

  if (info.losingAttack) {
    score -= 500;

    score -=
      depth * 15;
  }


  /* ---------------------------------------------------------
     일반 단어
  --------------------------------------------------------- */

  if (!info.isAttack) {
    score +=
      Math.min(
        info.nextCount,
        100
      ) * 5;
  }


  /* ---------------------------------------------------------
     강도
  --------------------------------------------------------- */

  score +=
    (strength - 0.5) *
    (
      info.winningAttack
        ? 2200
        : 500
    );


  /*
   * 공격 깊이
   */

  if (
    info.winningAttack &&
    strength >= 0.75
  ) {
    score +=
      depth * 30;
  }


  return score;
}


/* =========================================================
   봇 단어 선택
========================================================= */

function chooseBotWord({
  currentWord,
  startChar,
  usedWords,
  words,
  dueum,
  attackDepth,
  wordIndex,

  strength = 0.5,

  botWinRate = 0.5
}) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);


  /* ---------------------------------------------------------
     후보
  --------------------------------------------------------- */

  const candidates =
    currentWord
      ? getCandidates(
          currentWord,
          used,
          words,
          dueum,
          wordIndex
        )
      : getCandidatesFromChar(
          startChar,
          used,
          words,
          dueum,
          wordIndex
        );


  if (!candidates.length) {
    return null;
  }


  /* ---------------------------------------------------------
     후보 분석
  --------------------------------------------------------- */

  let analyzed =
    candidates.map(
      word =>
        analyzeWord({
          word,
          usedWords: used,
          words,
          attackDepth,
          dueum,
          wordIndex
        })
    );


  /* ---------------------------------------------------------
     첫 수
     너무 강한 한방은 피한다.
  --------------------------------------------------------- */

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


  /* ---------------------------------------------------------
     점수 계산
  --------------------------------------------------------- */

  const scored =
    analyzed.map(
      info => ({
        ...info,

        score:
          scoreBotCandidate(
            info,
            {
              strength,
              botWinRate
            }
          )
      })
    );


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /* ---------------------------------------------------------
     난이도별 선택 풀
  --------------------------------------------------------- */

  let poolSize;

  if (strength < 0.3) {
    poolSize = 12;
  } else if (strength < 0.5) {
    poolSize = 8;
  } else if (strength < 0.7) {
    poolSize = 5;
  } else if (strength < 0.85) {
    poolSize = 3;
  } else {
    poolSize = 2;
  }


  /*
   * 승률이 너무 높으면 선택지를 넓혀
   * 일부러 최선 수만 고르지 않게 한다.
   */

  if (botWinRate > 0.7) {
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


  /* ---------------------------------------------------------
     랜덤 선택
  --------------------------------------------------------- */

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
  isAttackWord,
  isWinningAttack,
  isLosingAttack,

  analyzeWord,

  createGame,
  playWord,

  scoreBotCandidate,
  chooseBotWord,

  getPublicGameState
};
