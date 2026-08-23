"use strict";

/*
  끝말잇기 공통 게임 로직

  word.txt
  └─ 실제 사용 가능한 전체 단어 목록

  attack.txt
  └─ AI 제거 이후 게임 판정에는 사용하지 않음
*/


/* =========================
   단어 정규화
========================= */

function normalizeWord(word) {
  if (typeof word !== "string") {
    return "";
  }

  return word
    .trim()
    .replace(/\s+/g, "")
    .normalize("NFC");
}


/* =========================
   두음법칙
========================= */

const DUEUM = {
  "녀": ["녀", "여"],
  "년": ["년", "연"],
  "녈": ["녈", "열"],
  "녹": ["녹", "록"],
  "논": ["논", "론"],
  "뇌": ["뇌", "뇌"],
  "뇨": ["뇨", "요"],
  "뉴": ["뉴", "유"],
  "니": ["니", "이"],

  "랴": ["랴", "야"],
  "려": ["려", "여"],
  "례": ["례", "예"],
  "료": ["료", "요"],
  "류": ["류", "유"],
  "리": ["리", "이"],

  "라": ["라", "나"],
  "래": ["래", "내"],
  "로": ["로", "노"],
  "뢰": ["뢰", "뇌"],
  "루": ["루", "누"],
  "르": ["르", "느"],

  "랴": ["랴", "야"],
  "려": ["려", "여"],
  "례": ["례", "예"],
  "료": ["료", "요"],
  "류": ["류", "유"],

  "마": ["마"],
  "바": ["바"],
  "사": ["사"],
  "아": ["아"],
  "자": ["자"],
  "차": ["차"],
  "카": ["카"],
  "타": ["타"],
  "파": ["파"],
  "하": ["하"]
};


/*
  끝 글자에서 실제로 허용되는 시작 글자 목록.

  기본적으로는 동일 음절.
  두음법칙이 적용되는 경우 변환된 음절도 허용.
*/

function getConnectableInitials(lastChar) {
  const result = new Set();

  if (!lastChar) {
    return result;
  }

  result.add(lastChar);

  const mapped = DUEUM[lastChar];

  if (mapped) {
    for (const value of mapped) {
      result.add(value);
    }
  }

  /*
    역방향도 허용.
    예:
      녀 -> 여
      여 -> 녀
  */

  for (const [from, values] of Object.entries(DUEUM)) {
    if (values.includes(lastChar)) {
      result.add(from);
    }
  }

  return result;
}


/* =========================
   연결 가능 여부
========================= */

function canConnect(previousWord, nextWord) {
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
    return false;
  }

  const lastChar = previousWord.at(-1);
  const firstChar = nextWord.at(0);

  const allowed = getConnectableInitials(lastChar);

  return allowed.has(firstChar);
}


/* =========================
   단어 존재 여부
========================= */

function isValidWord(word, words) {
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


/* =========================
   게임 생성
========================= */

function createGame() {
  return {
    currentWord: null,

    /*
      0 = 첫 번째 플레이어
      1 = 두 번째 플레이어
    */

    turn: 0,

    history: [],

    usedWords: new Set(),

    finished: false,

    winner: null,

    loser: null
  };
}


/* =========================
   단어 입력
========================= */

function playWord(game, word, words) {
  if (!game || game.finished) {
    return {
      ok: false,
      reason: "게임이 끝났습니다."
    };
  }

  word = normalizeWord(word);

  if (!word) {
    return {
      ok: false,
      reason: "단어를 입력해주세요."
    };
  }


  /* -------------------------
     단어 목록 검사
  ------------------------- */

  if (!isValidWord(word, words)) {
    return {
      ok: false,
      reason: "단어 목록에 없는 단어입니다."
    };
  }


  /* -------------------------
     중복 검사
  ------------------------- */

  if (game.usedWords.has(word)) {
    return {
      ok: false,
      reason: "이미 사용한 단어입니다."
    };
  }


  /* -------------------------
     연결 검사
  ------------------------- */

  if (
    game.currentWord &&
    !canConnect(game.currentWord, word)
  ) {
    return {
      ok: false,
      reason:
        `"${game.currentWord.at(-1)}"으로 시작할 수 없는 단어입니다.`
    };
  }


  /* -------------------------
     단어 등록
  ------------------------- */

  const playerIndex = game.turn;

  game.currentWord = word;

  game.usedWords.add(word);

  game.history.push({
    word,
    player: playerIndex,
    turn: game.history.length + 1
  });


  /* -------------------------
     다음 턴
  ------------------------- */

  game.turn = game.turn === 0 ? 1 : 0;


  /* -------------------------
     막힌 단어인지 검사

     현재 플레이어가 단어를 낸 뒤
     다음 플레이어가 연결할 단어가
     하나도 없다면 다음 플레이어가 패배.
  ------------------------- */

  const nextWords = getCandidates(
    game.currentWord,
    game.usedWords,
    words
  );

  if (nextWords.length === 0) {
    game.finished = true;

    game.winner = playerIndex;
    game.loser = game.turn;

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


/* =========================
   후보 단어 검색
========================= */

function getCandidates(previousWord, usedWords, words) {
  const result = [];

  if (!previousWord || !words) {
    return result;
  }

  const source =
    words instanceof Set
      ? words
      : new Set(words);

  for (const word of source) {
    if (usedWords && usedWords.has(word)) {
      continue;
    }

    if (!canConnect(previousWord, word)) {
      continue;
    }

    result.push(word);
  }

  return result;
}


/* =========================
   게임 상태 복사
========================= */

function getPublicGameState(game) {
  if (!game) {
    return null;
  }

  return {
    currentWord: game.currentWord,
    turn: game.turn,
    history: game.history.map(item => ({
      word: item.word,
      player: item.player,
      turn: item.turn
    })),
    finished: game.finished,
    winner: game.winner,
    loser: game.loser
  };
}


/* =========================
   브라우저 / Node 공통 사용
========================= */

if (typeof module !== "undefined") {
  module.exports = {
    normalizeWord,
    canConnect,
    isValidWord,
    createGame,
    playWord,
    getCandidates,
    getPublicGameState,
    getConnectableInitials
  };
}
