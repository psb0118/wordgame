/*
 * 끝말잇기 공통 게임 엔진
 *
 * word.txt
 *   실제 사용 가능한 전체 단어 목록
 *
 * attack.txt
 *   현재 AI를 제거했으므로 게임 판정에는 사용하지 않음
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

  // 원래 글자
  result.add(lastChar);

  // 정방향
  const alternatives = dueum[lastChar];

  if (Array.isArray(alternatives)) {
    for (const char of alternatives) {
      if (char) {
        result.add(char);
      }
    }
  }

  // 역방향
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

function canConnect(previousWord, nextWord, dueum = {}) {
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
    return false;
  }

  const lastChar = previousWord.at(-1);
  const firstChar = nextWord.at(0);

  return allowedFirstChars(
    lastChar,
    dueum
  ).includes(firstChar);
}


/* =========================================================
   단어 목록 검사
========================================================= */

function hasWord(word, words) {
  word = normalizeWord(word);

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

function getCandidates(
  previousWord,
  usedWords,
  words,
  dueum = {}
) {
  const result = [];

  previousWord = normalizeWord(previousWord);

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


/* =========================================================
   게임 생성
========================================================= */

function createGame() {
  return {
    currentWord: null,

    // 0 = 첫 번째 플레이어
    // 1 = 두 번째 플레이어
    turn: 0,

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
  dueum = {}
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

  word = normalizeWord(word);

  if (!word) {
    return {
      ok: false,
      reason: "단어를 입력해주세요."
    };
  }


  /* ---------------------------------------------------------
     단어 목록
  --------------------------------------------------------- */

  if (!hasWord(word, words)) {
    return {
      ok: false,
      reason: "단어 목록에 없는 단어입니다."
    };
  }


  /* ---------------------------------------------------------
     중복
  --------------------------------------------------------- */

  if (game.usedWords.has(word)) {
    return {
      ok: false,
      reason: "이미 사용한 단어입니다."
    };
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

    const allowed =
      allowedFirstChars(
        last,
        dueum
      );

    return {
      ok: false,

      reason:
        allowed.length > 1
          ? `"${last}" 다음에는 ${allowed.join(", ")}으로 시작해야 합니다.`
          : `"${last}"으로 시작해야 합니다.`,

      allowed
    };
  }


  /* ---------------------------------------------------------
     단어 등록
  --------------------------------------------------------- */

  const playerIndex =
    game.turn;

  game.currentWord =
    word;

  game.usedWords.add(
    word
  );

  game.history.push({
    word,
    player: playerIndex,
    turn: game.history.length + 1
  });


  /* ---------------------------------------------------------
     다음 플레이어
  --------------------------------------------------------- */

  game.turn =
    game.turn === 0
      ? 1
      : 0;


  /* ---------------------------------------------------------
     다음 플레이어 후보 검사
  --------------------------------------------------------- */

  const nextCandidates =
    getCandidates(
      word,
      game.usedWords,
      words,
      dueum
    );


  if (nextCandidates.length === 0) {
    game.finished = true;

    game.winner =
      playerIndex;

    game.loser =
      game.turn;

    return {
      ok: true,
      finished: true,
      winner: playerIndex,
      loser: game.turn,
      word
    };
  }


  return {
    ok: true,
    finished: false,
    word,
    nextTurn: game.turn
  };
}


/* =========================================================
   공개 게임 상태
========================================================= */

function getPublicGameState(game) {
  if (!game) {
    return null;
  }

  return {
    currentWord:
      game.currentWord,

    turn:
      game.turn,

    history:
      game.history.map(
        item => ({
          word: item.word,
          player: item.player,
          turn: item.turn
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
  createGame,
  playWord,
  getPublicGameState
};
