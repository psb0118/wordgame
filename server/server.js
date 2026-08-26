"use strict";

/*
 * =========================================================
 * 끝말잇기 전체 클라이언트 게임 엔진
 * =========================================================
 *
 * MODE
 * ---------------------------------------------------------
 * 1. AI
 *    - 클라이언트에서 AI 처리
 *
 * 2. ONLINE
 *    - Socket.IO 서버가 실제 판정
 *    - 서버 이벤트와 1:1 대응
 *
 * =========================================================
 *
 * SERVER SOCKET EVENTS
 *
 * client -> server
 *
 * room:create
 * room:join
 * room:state
 * game:word
 * game:submit
 * game:restart
 * room:leave
 *
 * server -> client
 *
 * server:ready
 * room:created
 * room:joined
 * room:error
 * room:ready
 * game:state
 * game:word
 * game:error
 * game:finished
 * game:started
 * game:submit:redirect
 * room:playerLeft
 *
 * =========================================================
 */


/* =========================================================
   전역 데이터
========================================================= */

let WORDS = new Set();

let ATTACK_DEPTH = {};

let DUEUM = {};

let game = null;

let gameMode = "ai";

let aiThinking = false;

let gameStarted = false;

let playerIndex = 0;

let aiIndex = 1;


/* =========================================================
   Socket.IO 상태
========================================================= */

let socket = null;

let socketConnected = false;

let onlineRoomId = null;

let onlinePlayerIndex = null;

let onlineNickname = "";

let onlineWaiting = false;


/*
 * 서버에서 받은 최신 상태.
 *
 * 온라인 모드에서는 이것이
 * 가장 신뢰할 수 있는 게임 상태다.
 */
let onlineState = null;


/*
 * 서버 이벤트가 중복으로 처리되는 것을 방지하기 위한
 * 마지막 상태/단어 정보.
 */
let lastServerWordTurn = -1;

let lastServerStateKey = "";


/* =========================================================
   정규화
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

const DEFAULT_DUEUM = {

  "녀": ["녀", "여"],
  "년": ["년", "연"],
  "녕": ["녕", "영"],
  "녜": ["녜", "예"],
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
  "락": ["락", "낙"],
  "란": ["란", "난"],
  "랄": ["랄", "날"],
  "람": ["람", "남"],
  "랍": ["랍", "납"],
  "랏": ["랏", "낫"],
  "랑": ["랑", "낭"],
  "래": ["래", "내"],
  "랭": ["랭", "냉"],

  "략": ["략", "약"],
  "량": ["량", "양"],
  "련": ["련", "연"],
  "렬": ["렬", "열"],
  "령": ["령", "영"],

  "로": ["로", "노"],
  "록": ["록", "녹"],
  "론": ["론", "논"],
  "롤": ["롤", "놀"],
  "롬": ["롬", "놈"],
  "롭": ["롭", "놉"],
  "롯": ["롯", "놋"],
  "롱": ["롱", "농"],
  "뢰": ["뢰", "뇌"],

  "루": ["루", "누"],
  "륙": ["륙", "육"],
  "률": ["률", "율"],
  "륜": ["륜", "윤"],
  "륭": ["륭", "융"]
};


/* =========================================================
   두음 맵
========================================================= */

function getDueumMap() {

  if (
    typeof DUEUM !== "undefined" &&
    DUEUM &&
    Object.keys(DUEUM).length
  ) {
    return DUEUM;
  }

  return DEFAULT_DUEUM;
}


/* =========================================================
   허용 첫 글자
========================================================= */

function allowedFirstChars(
  lastChar,
  dueum = getDueumMap()
) {

  lastChar =
    normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result =
    new Set();

  /*
   * 원래 글자
   */
  result.add(lastChar);

  /*
   * 정방향
   *
   * 녀 -> 여
   * 늄 -> 윰 같은 경우도
   * 외부 DUEUM에 들어 있다면 적용 가능.
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
   연결 가능 여부
========================================================= */

function canConnect(
  previousWord,
  nextWord,
  dueum = getDueumMap()
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

  return allowedFirstChars(
    last,
    dueum
  ).includes(first);
}


/* =========================================================
   단어 존재
========================================================= */

function hasWord(
  word,
  words = WORDS
) {

  word =
    normalizeWord(word);

  if (
    !word ||
    !words
  ) {
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
  usedWords = new Set(),
  words = WORDS,
  dueum = getDueumMap()
) {

  previousWord =
    normalizeWord(previousWord);

  if (
    !previousWord ||
    !words
  ) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  const allowed =
    new Set(
      allowedFirstChars(
        previousWord.at(-1),
        dueum
      )
    );

  const result = [];

  for (const rawWord of words) {

    const word =
      normalizeWord(rawWord);

    if (!word) {
      continue;
    }

    if (used.has(word)) {
      continue;
    }

    if (
      !allowed.has(
        word.at(0)
      )
    ) {
      continue;
    }

    result.push(word);
  }

  return result;
}


/* =========================================================
   시작 글자 후보
========================================================= */

function getCandidatesFromChar(
  char,
  usedWords = new Set(),
  words = WORDS,
  dueum = getDueumMap()
) {

  char =
    normalizeWord(char);

  if (
    !char ||
    !words
  ) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  const allowed =
    new Set(
      allowedFirstChars(
        char,
        dueum
      )
    );

  const result = [];

  for (const rawWord of words) {

    const word =
      normalizeWord(rawWord);

    if (!word) {
      continue;
    }

    if (used.has(word)) {
      continue;
    }

    if (
      !allowed.has(
        word.at(0)
      )
    ) {
      continue;
    }

    result.push(word);
  }

  return result;
}


/* =========================================================
   공격 깊이
========================================================= */

function getAttackDepth(
  word,
  attackDepth = ATTACK_DEPTH
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

  if (!Number.isFinite(depth)) {
    return null;
  }

  return depth;
}


/* =========================================================
   공격 판정
========================================================= */

function isWinningAttack(
  word,
  attackDepth = ATTACK_DEPTH
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
  attackDepth = ATTACK_DEPTH
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
  usedWords = new Set(),
  words = WORDS,
  attackDepth = ATTACK_DEPTH,
  dueum = getDueumMap()
) {

  word =
    normalizeWord(word);

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  const nextUsed =
    new Set(used);

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
   미래 위험
========================================================= */

function analyzeFutureRisk(
  info,
  words = WORDS,
  usedWords = new Set(),
  dueum = getDueumMap()
) {

  if (
    !info ||
    !info.word
  ) {
    return {
      risk: 1,
      botNextCount: 0
    };
  }

  const usedAfter =
    usedWords instanceof Set
      ? new Set(usedWords)
      : new Set(
          usedWords || []
        );

  usedAfter.add(
    info.word
  );

  const opponentCandidates =
    getCandidates(
      info.word,
      usedAfter,
      words,
      dueum
    );

  if (
    !opponentCandidates.length
  ) {
    return {
      risk: 0,
      botNextCount: 0
    };
  }

  const limit =
    Math.min(
      opponentCandidates.length,
      60
    );

  let dangerous = 0;

  for (
    let i = 0;
    i < limit;
    i++
  ) {

    const opponentWord =
      opponentCandidates[i];

    const nextUsed =
      new Set(usedAfter);

    nextUsed.add(
      opponentWord
    );

    const botCandidates =
      getCandidates(
        opponentWord,
        nextUsed,
        words,
        dueum
      );

    if (
      !botCandidates.length
    ) {
      dangerous++;
    }
  }

  return {

    risk:
      dangerous / limit,

    botNextCount:
      Math.max(
        0,
        limit - dangerous
      )
  };
}


/* =========================================================
   AI 점수
========================================================= */

function scoreBotCandidate({
  info,
  futureRisk,
  strength = 0.5,
  winBias = 0.5,
  firstTurn = false
}) {

  let score = 0;

  if (!info) {
    return -Infinity;
  }

  const nextCount =
    info.nextCount;

  const depth =
    info.depth ?? 0;

  const risk =
    futureRisk?.risk ?? 0;


  /* =======================================================
     첫 턴
  ======================================================= */

  if (firstTurn) {

    if (info.oneShot) {
      score -= 100000000;
    }

    if (info.winningAttack) {
      score -= 30000000;
    }

    score +=
      Math.min(
        nextCount,
        30
      ) * 80;

    score -=
      Math.max(
        0,
        depth
      ) * 100;
  }


  /* =======================================================
     상대 선택지
  ======================================================= */

  if (nextCount === 0) {
    score += 12000;
  }

  else if (nextCount === 1) {
    score += 4200;
  }

  else if (nextCount <= 4) {
    score += 1700;
  }

  else if (nextCount <= 10) {
    score += 500;
  }

  else {
    score += 80;
  }


  /* =======================================================
     공격 단어
  ======================================================= */

  if (info.winningAttack) {

    score +=
      900 +
      depth * 45;

    score +=
      Math.min(
        depth,
        30
      ) * 25;
  }


  /* =======================================================
     일반 단어
  ======================================================= */

  if (!info.winningAttack) {

    score +=
      Math.min(
        nextCount,
        30
      ) * 12;
  }


  /* =======================================================
     미래 위험
  ======================================================= */

  if (risk >= 0.75) {
    score -= 4500;
  }

  else if (risk >= 0.50) {
    score -= 2200;
  }

  else if (risk >= 0.25) {
    score -= 700;
  }


  /* =======================================================
     승률
  ======================================================= */

  if (winBias > 0.60) {

    if (info.winningAttack) {

      score -=
        (winBias - 0.60) *
        9000;
    }

    if (info.oneShot) {

      score -=
        (winBias - 0.60) *
        7000;
    }

  }

  else if (winBias < 0.40) {

    if (info.winningAttack) {

      score +=
        (0.40 - winBias) *
        7000;
    }

    if (info.nextCount <= 1) {

      score +=
        (0.40 - winBias) *
        4000;
    }
  }


  /* =======================================================
     난이도
  ======================================================= */

  if (info.winningAttack) {

    score +=
      strength *
      1800;

  } else {

    score +=
      (1 - strength) *
      250;
  }


  /*
   * 첫 턴 정책 재적용
   */

  if (firstTurn) {

    if (info.oneShot) {
      score -= 100000000;
    }

    if (info.winningAttack) {
      score -= 30000000;
    }
  }

  return score;
}


/* =========================================================
   AI 후보 선택
========================================================= */

function chooseBotWord({
  currentWord = null,
  startChar = "",
  usedWords = new Set(),
  words = WORDS,
  dueum = getDueumMap(),
  attackDepth = ATTACK_DEPTH,
  strength = 0.50,
  winBias = 0.50
} = {}) {

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  let candidates;

  if (currentWord) {

    candidates =
      getCandidates(
        currentWord,
        used,
        words,
        dueum
      );

  } else {

    candidates =
      getCandidatesFromChar(
        startChar,
        used,
        words,
        dueum
      );
  }

  if (!candidates.length) {
    return null;
  }

  const firstTurn =
    !currentWord;

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


  /* =======================================================
     첫 수 필터
  ======================================================= */

  if (firstTurn) {

    let safe =
      analyzed.filter(
        info =>
          !info.oneShot
      );

    const nonAttack =
      safe.filter(
        info =>
          !info.winningAttack
      );

    if (nonAttack.length) {
      safe = nonAttack;
    }

    if (safe.length) {
      analyzed = safe;
    }
  }


  return chooseFromScored(
    analyzed,
    used,
    words,
    dueum,
    strength,
    winBias,
    firstTurn
  );
}


/* =========================================================
   점수 선택
========================================================= */

function chooseFromScored(
  analyzed,
  used,
  words,
  dueum,
  strength,
  winBias,
  firstTurn = false
) {

  if (!analyzed.length) {
    return null;
  }

  const preliminary =
    analyzed.map(
      info => {

        let base = 0;

        if (info.oneShot) {
          base += 12000;
        }

        if (info.winningAttack) {

          base +=
            900 +
            (info.depth ?? 0) * 45;
        }

        base +=
          Math.min(
            info.nextCount,
            30
          ) * 12;


        if (firstTurn) {

          if (info.oneShot) {
            base -= 100000000;
          }

          if (info.winningAttack) {
            base -= 30000000;
          }

          base +=
            Math.min(
              info.nextCount,
              20
            ) * 40;
        }

        return {
          info,
          base
        };
      }
    );


  preliminary.sort(
    (a, b) =>
      b.base - a.base
  );


  const analysisLimit =
    Math.min(
      preliminary.length,
      80
    );

  const scored = [];


  for (
    let i = 0;
    i < analysisLimit;
    i++
  ) {

    const info =
      preliminary[i].info;

    const futureRisk =
      analyzeFutureRisk(
        info,
        words,
        used,
        dueum
      );

    const score =
      scoreBotCandidate({
        info,
        futureRisk,
        strength,
        winBias,
        firstTurn
      });

    scored.push({
      info,
      score
    });
  }


  for (
    let i = analysisLimit;
    i < preliminary.length;
    i++
  ) {

    const info =
      preliminary[i].info;

    const score =
      scoreBotCandidate({
        info,

        futureRisk: {
          risk: 0.2,
          botNextCount:
            info.nextCount
        },

        strength,
        winBias,
        firstTurn
      });

    scored.push({
      info,
      score
    });
  }


  if (!scored.length) {
    return null;
  }


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /* =======================================================
     첫 턴
  ======================================================= */

  if (firstTurn) {

    const safe =
      scored.filter(
        item =>
          !item.info.oneShot &&
          !item.info.winningAttack
      );

    if (safe.length) {

      const pool =
        safe.slice(
          0,
          Math.min(
            10,
            safe.length
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


  /* =======================================================
     난이도별 랜덤
  ======================================================= */

  let poolSize;

  if (strength >= 0.85) {
    poolSize = 3;
  }

  else if (strength >= 0.70) {
    poolSize = 5;
  }

  else if (strength >= 0.55) {
    poolSize = 8;
  }

  else {
    poolSize = 12;
  }


  if (winBias > 0.60) {
    poolSize += 8;
  }

  if (winBias < 0.40) {

    poolSize =
      Math.max(
        2,
        poolSize - 3
      );
  }


  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );

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

  return selected.info.word;
}


/* =========================================================
   로컬 게임 생성
========================================================= */

function createGame({
  startChar = "",
  startPlayer = 0
} = {}) {

  return {

    startChar:
      normalizeWord(
        startChar
      ),

    currentWord:
      null,

    turnPlayer:
      startPlayer,

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
   로컬 단어 플레이
========================================================= */

function playWord(
  gameState,
  word,
  words = WORDS,
  dueum = getDueumMap(),
  attackDepth = ATTACK_DEPTH
) {

  if (!gameState) {

    return {
      ok: false,
      reason:
        "게임 정보를 찾을 수 없습니다."
    };
  }

  if (gameState.finished) {

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

  if (
    gameState.usedWords.has(word)
  ) {

    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /* 첫 단어 */

  if (!gameState.currentWord) {

    if (
      gameState.startChar &&
      !allowedFirstChars(
        gameState.startChar,
        dueum
      ).includes(
        word.at(0)
      )
    ) {

      return {
        ok: false,

        reason:
          `"${gameState.startChar}"으로 시작하는 단어가 아닙니다.`,

        allowed:
          allowedFirstChars(
            gameState.startChar,
            dueum
          )
      };
    }
  }


  /* 연결 */

  if (
    gameState.currentWord &&
    !canConnect(
      gameState.currentWord,
      word,
      dueum
    )
  ) {

    const last =
      gameState.currentWord.at(-1);

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
    gameState.turnPlayer;


  gameState.currentWord =
    word;

  gameState.usedWords.add(
    word
  );

  gameState.history.push({

    word,

    player,

    turn:
      gameState.history.length + 1,

    depth:
      getAttackDepth(
        word,
        attackDepth
      )
  });


  gameState.turnPlayer =
    player === 0
      ? 1
      : 0;


  const next =
    getCandidates(
      word,
      gameState.usedWords,
      words,
      dueum
    );


  if (!next.length) {

    gameState.finished =
      true;

    gameState.winner =
      player;

    gameState.loser =
      gameState.turnPlayer;

    return {

      ok: true,

      finished: true,

      winner:
        player,

      loser:
        gameState.turnPlayer,

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
      gameState.turnPlayer,

    nextCount:
      next.length
  };
}


/* =========================================================
   공개 게임 상태
========================================================= */

function getPublicGameState(
  gameState
) {

  if (!gameState) {
    return null;
  }

  return {

    startChar:
      gameState.startChar,

    currentWord:
      gameState.currentWord,

    turnPlayer:
      gameState.turnPlayer,

    history:
      gameState.history.map(
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
      gameState.finished,

    winner:
      gameState.winner,

    loser:
      gameState.loser
  };
}


/* =========================================================
   데이터 로딩
========================================================= */

async function loadWordData() {

  if (WORDS.size > 0) {

    return {
      words: WORDS,
      attackDepth:
        ATTACK_DEPTH
    };
  }


  const wordPaths = [

    "/word.txt",

    "./word.txt",

    "/data/word.txt",

    "/data/words.txt"
  ];

  let wordText = null;


  for (
    const path
    of wordPaths
  ) {

    try {

      const response =
        await fetch(path);

      if (!response.ok) {
        continue;
      }

      wordText =
        await response.text();

      if (wordText) {
        break;
      }

    } catch (_) {}
  }


  if (wordText) {

    for (
      const line
      of wordText.split(
        /\r?\n/
      )
    ) {

      const word =
        normalizeWord(
          line
            .split(/\s+/)[0]
        );

      if (word) {
        WORDS.add(word);
      }
    }
  }


  const attackPaths = [

    "/attack.txt",

    "./attack.txt",

    "/data/attack.txt"
  ];


  for (
    const path
    of attackPaths
  ) {

    try {

      const response =
        await fetch(path);

      if (!response.ok) {
        continue;
      }

      const text =
        await response.text();


      for (
        const line
        of text.split(
          /\r?\n/
        )
      ) {

        const parts =
          line
            .trim()
            .split(/\s+/);

        if (!parts.length) {
          continue;
        }

        const word =
          normalizeWord(
            parts[0]
          );

        const depth =
          Number(parts[1]);

        if (
          word &&
          Number.isFinite(depth)
        ) {

          ATTACK_DEPTH[word] =
            depth;
        }
      }

      break;

    } catch (_) {}
  }


  if (
    typeof window !==
    "undefined"
  ) {

    window.WORDS =
      WORDS;

    window.ATTACK_DEPTH =
      ATTACK_DEPTH;
  }


  return {

    words: WORDS,

    attackDepth:
      ATTACK_DEPTH
  };
}


/* =========================================================
   UI 요소 찾기
========================================================= */

function findElement(
  ...selectors
) {

  for (
    const selector
    of selectors
  ) {

    if (!selector) {
      continue;
    }

    try {

      const element =
        document.querySelector(
          selector
        );

      if (element) {
        return element;
      }

    } catch (_) {}
  }

  return null;
}


/* =========================================================
   메시지
========================================================= */

function showMessage(
  message
) {

  const element =
    findElement(

      "#message",

      "#status",

      ".message",

      ".status",

      "[data-message]"
    );

  if (element) {
    element.textContent =
      message || "";
  }
}


/* =========================================================
   현재 단어 표시
========================================================= */

function updateCurrentWordUI(
  word
) {

  const current =
    findElement(

      "#currentWord",

      ".current-word",

      "[data-current-word]"
    );

  if (current) {

    current.textContent =
      word || "";
  }
}


/* =========================================================
   기록 렌더링
========================================================= */

function renderHistory() {

  const list =
    findElement(

      "#history",

      ".history",

      "[data-history]"
    );

  if (
    !list ||
    !game
  ) {
    return;
  }

  list.innerHTML = "";


  for (
    const item
    of game.history
  ) {

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "history-item";


    const depth =
      item.depth != null
        ? ` [${item.depth}]`
        : "";


    let name;

    if (
      gameMode === "online"
    ) {

      name =
        item.player ===
        onlinePlayerIndex
          ? "나"
          : "상대";

    } else {

      name =
        item.player ===
        playerIndex
          ? "나"
          : "AI";
    }


    row.textContent =
      `${name}: ${item.word}${depth}`;

    list.appendChild(row);
  }
}


/* =========================================================
   온라인 상태 -> 로컬 UI 상태 변환
========================================================= */

function applyOnlineState(
  state
) {

  if (!state) {
    return;
  }

  onlineState =
    state;

  onlineRoomId =
    state.roomId ??
    onlineRoomId;


  /*
   * 서버가 보내는 history를 그대로 사용.
   */

  const history =
    Array.isArray(
      state.history
    )
      ? state.history
      : [];


  const used =
    new Set(
      history
        .map(
          item =>
            normalizeWord(
              item.word
            )
        )
        .filter(Boolean)
    );


  game = {

    startChar:
      normalizeWord(
        state.startChar
      ),

    currentWord:
      state.currentWord ||
      null,

    turnPlayer:
      Number.isFinite(
        Number(
          state.turnPlayer
        )
      )
        ? Number(
            state.turnPlayer
          )
        : 0,

    history:
      history.map(
        item => ({

          word:
            normalizeWord(
              item.word
            ),

          player:
            Number(
              item.player
            ),

          turn:
            Number(
              item.turn
            ),

          depth:
            item.depth == null
              ? null
              : Number(
                  item.depth
                )
        })
      ),

    usedWords:
      used,

    finished:
      Boolean(
        state.finished
      ),

    winner:
      state.winner ??
      null,

    loser:
      state.loser ??
      null
  };


  gameStarted =
    true;


  updateGameUI();

  updateCurrentWordUI(
    game.currentWord
  );

  renderHistory();
}


/* =========================================================
   UI 업데이트
========================================================= */

function updateGameUI() {

  const current =
    findElement(

      "#currentWord",

      ".current-word",

      "[data-current-word]"
    );


  if (current) {

    current.textContent =
      game?.currentWord || "";
  }


  const input =
    findElement(

      "#wordInput",

      "#inputWord",

      "input[name='word']",

      "input[type='text']"
    );


  if (input) {

    let disabled =
      !gameStarted ||
      aiThinking ||
      game?.finished;


    if (
      gameMode === "ai"
    ) {

      disabled =
        disabled ||
        game?.turnPlayer !==
          playerIndex;

    }


    if (
      gameMode === "online"
    ) {

      disabled =
        disabled ||
        !socketConnected ||
        !onlineRoomId ||
        onlineWaiting ||
        onlinePlayerIndex == null ||
        game?.turnPlayer !==
          onlinePlayerIndex;
    }


    input.disabled =
      disabled;
  }


  const turn =
    findElement(

      "#turn",

      "#turnText",

      ".turn",

      "[data-turn]"
    );


  if (
    turn &&
    game
  ) {

    if (game.finished) {

      if (
        game.winner ===
        (
          gameMode === "online"
            ? onlinePlayerIndex
            : playerIndex
        )
      ) {

        turn.textContent =
          "승리!";

      } else {

        turn.textContent =
          "패배!";
      }

    }

    else if (
      gameMode === "online"
    ) {

      if (
        game.turnPlayer ===
        onlinePlayerIndex
      ) {

        turn.textContent =
          "내 차례";

      } else {

        turn.textContent =
          "상대 차례";
      }

    }

    else {

      turn.textContent =
        game.turnPlayer ===
        playerIndex
          ? "내 차례"
          : "AI 차례";
    }
  }


  /*
   * 방 코드 표시.
   */

  const roomElement =
    findElement(

      "#roomId",

      "#roomCode",

      ".room-id",

      ".room-code",

      "[data-room-id]"
    );


  if (roomElement) {

    roomElement.textContent =
      onlineRoomId || "";
  }


  /*
   * 온라인 플레이어 수
   */

  const playerCount =
    findElement(

      "#playerCount",

      ".player-count",

      "[data-player-count]"
    );


  if (
    playerCount &&
    onlineState
  ) {

    playerCount.textContent =
      String(
        onlineState.playerCount ??
        onlineState.players?.length ??
        0
      );
  }
}


/* =========================================================
   Socket.IO 로드
========================================================= */

function loadSocketIO() {

  if (
    typeof io ===
    "function"
  ) {
    return Promise.resolve();
  }


  return new Promise(
    (resolve, reject) => {

      const existing =
        document.querySelector(
          "script[data-socket-io]"
        );

      if (existing) {

        existing.addEventListener(
          "load",
          resolve,
          {
            once: true
          }
        );

        existing.addEventListener(
          "error",
          reject,
          {
            once: true
          }
        );

        return;
      }


      const script =
        document.createElement(
          "script"
        );

      script.src =
        "/socket.io/socket.io.js";

      script.dataset.socketIo =
        "true";

      script.onload =
        () => resolve();

      script.onerror =
        () =>
          reject(
            new Error(
              "Socket.IO를 불러오지 못했습니다."
            )
          );

      document.head.appendChild(
        script
      );
    }
  );
}


/* =========================================================
   Socket 연결
========================================================= */

async function connectSocket() {

  if (
    socket &&
    socketConnected
  ) {
    return socket;
  }


  await loadSocketIO();


  if (
    typeof io !==
    "function"
  ) {

    throw new Error(
      "Socket.IO가 없습니다."
    );
  }


  /*
   * 이미 socket 객체가 있지만
   * 연결이 끊긴 경우 재사용.
   */

  if (!socket) {

    socket =
      io({
        transports: [
          "websocket",
          "polling"
        ],

        autoConnect:
          true
      });


    setupSocketEvents();
  }


  if (
    socket.connected
  ) {

    socketConnected =
      true;

    return socket;
  }


  return new Promise(
    (resolve, reject) => {

      const timeout =
        setTimeout(
          () => {

            reject(
              new Error(
                "서버 연결 시간이 초과되었습니다."
              )
            );

          },
          10000
        );


      const onConnect =
        () => {

          clearTimeout(
            timeout
          );

          socketConnected =
            true;

          resolve(socket);
        };


      const onError =
        error => {

          clearTimeout(
            timeout
          );

          reject(
            error ||
            new Error(
              "서버 연결 실패"
            )
          );
        };


      socket.once(
        "connect",
        onConnect
      );

      socket.once(
        "connect_error",
        onError
      );
    }
  );
}


/* =========================================================
   Socket 이벤트
========================================================= */

function setupSocketEvents() {

  if (!socket) {
    return;
  }


  /* =======================================================
     server:ready
  ======================================================= */

  socket.on(
    "server:ready",
    data => {

      console.log(
        "[SERVER READY]",
        data
      );

      if (
        gameMode === "online"
      ) {

        showMessage(
          "서버에 연결되었습니다."
        );
      }
    }
  );


  /* =======================================================
     연결
  ======================================================= */

  socket.on(
    "connect",
    () => {

      socketConnected =
        true;

      console.log(
        "[SOCKET CONNECT]",
        socket.id
      );


      /*
       * 기존 방 정보가 있으면
       * 서버 상태를 다시 요청.
       */

      if (
        onlineRoomId
      ) {

        socket.emit(
          "room:state"
        );
      }


      updateGameUI();
    }
  );


  /* =======================================================
     연결 실패
  ======================================================= */

  socket.on(
    "connect_error",
    error => {

      socketConnected =
        false;

      console.error(
        "[SOCKET ERROR]",
        error
      );


      if (
        gameMode === "online"
      ) {

        showMessage(
          "서버에 연결하지 못했습니다."
        );
      }


      updateGameUI();
    }
  );


  /* =======================================================
     연결 종료
  ======================================================= */

  socket.on(
    "disconnect",
    reason => {

      socketConnected =
        false;

      console.log(
        "[SOCKET DISCONNECT]",
        reason
      );


      if (
        gameMode === "online"
      ) {

        onlineWaiting =
          true;

        showMessage(
          "서버와 연결이 끊어졌습니다."
        );
      }


      updateGameUI();
    }
  );


  /* =======================================================
     room:created
  ======================================================= */

  socket.on(
    "room:created",
    data => {

      if (!data?.ok) {
        return;
      }


      onlineRoomId =
        String(
          data.roomId || ""
        )
          .trim()
          .toUpperCase();


      onlinePlayerIndex =
        Number(
          data.playerIndex
        );


      playerIndex =
        onlinePlayerIndex;


      onlineWaiting =
        true;


      if (
        data.state
      ) {

        applyOnlineState(
          data.state
        );
      }


      showMessage(
        `방이 생성되었습니다. 방 코드: ${onlineRoomId} / 상대방을 기다리는 중입니다.`
      );


      updateGameUI();
    }
  );


  /* =======================================================
     room:joined
  ======================================================= */

  socket.on(
    "room:joined",
    data => {

      if (!data?.ok) {
        return;
      }


      onlineRoomId =
        String(
          data.roomId || ""
        )
          .trim()
          .toUpperCase();


      onlinePlayerIndex =
        Number(
          data.playerIndex
        );


      playerIndex =
        onlinePlayerIndex;


      onlineWaiting =
        false;


      if (
        data.state
      ) {

        applyOnlineState(
          data.state
        );
      }


      showMessage(
        "방에 입장했습니다."
      );


      updateGameUI();
    }
  );


  /* =======================================================
     room:error
  ======================================================= */

  socket.on(
    "room:error",
    data => {

      console.warn(
        "[ROOM ERROR]",
        data
      );


      showMessage(
        data?.reason ||
        "방 처리 중 오류가 발생했습니다."
      );
    }
  );


  /* =======================================================
     room:ready
  ======================================================= */

  socket.on(
    "room:ready",
    data => {

      if (
        data?.state
      ) {

        applyOnlineState(
          data.state
        );
      }


      onlineWaiting =
        false;


      showMessage(
        "상대방이 입장했습니다. 게임을 시작할 수 있습니다."
      );


      updateGameUI();
    }
  );


  /* =======================================================
     game:state
  ======================================================= */

  socket.on(
    "game:state",
    state => {

      if (!state) {
        return;
      }


      /*
       * 동일 상태 중복 처리 방지.
       */
      const stateKey =
        JSON.stringify({
          roomId:
            state.roomId,

          currentWord:
            state.currentWord,

          turnPlayer:
            state.turnPlayer,

          historyLength:
            state.history?.length,

          finished:
            state.finished
        });


      if (
        stateKey ===
        lastServerStateKey
      ) {

        updateGameUI();

        return;
      }


      lastServerStateKey =
        stateKey;


      if (
        state.playerCount >= 2
      ) {

        onlineWaiting =
          false;
      }


      applyOnlineState(
        state
      );


      if (
        state.finished
      ) {

        handleOnlineFinished(
          state
        );
      }


      else if (
        state.playerCount <
        2
      ) {

        onlineWaiting =
          true;

        showMessage(
          "상대방을 기다리는 중입니다."
        );
      }


      else if (
        state.turnPlayer ===
        onlinePlayerIndex
      ) {

        showMessage(
          "내 차례입니다."
        );

      } else {

        showMessage(
          "상대방 차례입니다."
        );
      }


      updateGameUI();
    }
  );


  /* =======================================================
     game:word
  ======================================================= */

  socket.on(
    "game:word",
    data => {

      if (!data?.ok) {
        return;
      }


      const word =
        normalizeWord(
          data.word
        );


      if (!word) {
        return;
      }


      /*
       * 서버가 보내는 game:word는
       * 실제로 성공한 단어다.
       *
       * 이후 game:state가 다시 오지만,
       * UI 반응을 빠르게 하기 위해 여기에서도 처리.
       */

      const turn =
        onlineState?.history?.length
          ? onlineState.history.length
          : 0;


      /*
       * 이미 game:state에서 해당 단어가 반영된 경우
       * 중복 추가하지 않는다.
       */

      const alreadyExists =
        game?.history?.some(
          item =>
            item.word === word &&
            Number(item.player) ===
              Number(data.player)
        );


      if (
        !alreadyExists &&
        game
      ) {

        game.currentWord =
          word;

        game.usedWords.add(
          word
        );

        game.history.push({

          word,

          player:
            Number(data.player),

          turn:
            game.history.length + 1,

          depth:
            data.depth == null
              ? null
              : Number(
                  data.depth
                )
        });


        /*
         * 종료가 아니라면 서버가
         * 다음 턴을 결정한다.
         */

        if (
          !data.finished
        ) {

          game.turnPlayer =
            Number(
              data.player
            ) === 0
              ? 1
              : 0;
        }
      }


      lastServerWordTurn =
        Math.max(
          lastServerWordTurn,
          turn
        );


      updateCurrentWordUI(
        word
      );

      renderHistory();

      updateGameUI();


      if (
        data.finished
      ) {

        /*
         * game:finished가 뒤에 올 수 있으므로
         * 여기서는 상태만 반영.
         */

        if (game) {

          game.finished =
            true;

          game.winner =
            data.winner ??
            null;

          game.loser =
            data.loser ??
            null;
        }


        handleOnlineFinished(
          game
        );
      }

      else {

        if (
          Number(data.player) ===
          onlinePlayerIndex
        ) {

          showMessage(
            "상대방 차례입니다."
          );

        } else {

          showMessage(
            "내 차례입니다."
          );
        }
      }
    }
  );


  /* =======================================================
     game:error
  ======================================================= */

  socket.on(
    "game:error",
    data => {

      console.warn(
        "[GAME ERROR]",
        data
      );


      showMessage(
        data?.reason ||
        "게임 처리 중 오류가 발생했습니다."
      );


      updateGameUI();
    }
  );


  /* =======================================================
     game:finished
  ======================================================= */

  socket.on(
    "game:finished",
    data => {

      if (
        data?.state
      ) {

        applyOnlineState(
          data.state
        );
      }


      if (
        game
      ) {

        game.finished =
          true;

        game.winner =
          data?.winner ??
          game.winner ??
          null;

        game.loser =
          data?.loser ??
          game.loser ??
          null;
      }


      handleOnlineFinished(
        game
      );
    }
  );


  /* =======================================================
     game:started
  ======================================================= */

  socket.on(
    "game:started",
    data => {

      if (
        data?.state
      ) {

        applyOnlineState(
          data.state
        );
      }


      onlineWaiting =
        false;

      lastServerStateKey =
        "";


      showMessage(
        game?.turnPlayer ===
        onlinePlayerIndex
          ? "게임이 시작되었습니다. 내 차례입니다."
          : "게임이 시작되었습니다. 상대방 차례입니다."
      );


      updateGameUI();

      renderHistory();
    }
  );


  /* =======================================================
     game:submit:redirect
  ======================================================= */

  socket.on(
    "game:submit:redirect",
    () => {

      /*
       * 서버의 game:submit 이벤트는
       * 실제 처리 후 이 이벤트를 먼저 보낸다.
       *
       * 별도 게임 처리를 하지 않는다.
       *
       * 실제 결과는
       * game:word / game:error에서 받는다.
       */
    }
  );


  /* =======================================================
     room:playerLeft
  ======================================================= */

  socket.on(
    "room:playerLeft",
    data => {

      if (
        data?.state
      ) {

        applyOnlineState(
          data.state
        );
      }


      onlineWaiting =
        true;


      showMessage(
        data?.reason ||
        "상대방이 방을 나갔습니다."
      );


      updateGameUI();
    }
  );
}


/* =========================================================
   온라인 게임 종료 처리
========================================================= */

function handleOnlineFinished(
  state
) {

  const winner =
    state?.winner ??
    game?.winner ??
    null;


  const loser =
    state?.loser ??
    game?.loser ??
    null;


  if (
    winner ===
    onlinePlayerIndex
  ) {

    showMessage(
      "승리했습니다!"
    );

  }

  else if (
    loser ===
    onlinePlayerIndex
  ) {

    showMessage(
      "패배했습니다!"
    );

  }

  else {

    showMessage(
      "게임이 종료되었습니다."
    );
  }


  updateGameUI();
}


/* =========================================================
   온라인 방 생성
========================================================= */

async function createOnlineRoom({
  nickname = "",
  startChar = ""
} = {}) {

  try {

    await connectSocket();

  } catch (error) {

    console.error(
      error
    );

    showMessage(
      "서버에 연결하지 못했습니다."
    );

    return false;
  }


  nickname =
    normalizeWord(
      nickname ||
      getNicknameFromUI()
    ) ||
    "플레이어";


  startChar =
    normalizeWord(
      startChar ||
      getStartCharFromUI()
    ).at(0) || "";


  onlineNickname =
    nickname;


  gameMode =
    "online";


  onlineWaiting =
    true;


  socket.emit(
    "room:create",
    {
      nickname,
      startChar
    }
  );


  showMessage(
    "방을 생성하는 중입니다..."
  );


  return true;
}


/* =========================================================
   온라인 방 입장
========================================================= */

async function joinOnlineRoom({
  roomId = "",
  nickname = ""
} = {}) {

  try {

    await connectSocket();

  } catch (error) {

    console.error(
      error
    );

    showMessage(
      "서버에 연결하지 못했습니다."
    );

    return false;
  }


  roomId =
    String(
      roomId ||
      getRoomIdFromUI() ||
      ""
    )
      .trim()
      .toUpperCase();


  nickname =
    normalizeWord(
      nickname ||
      getNicknameFromUI()
    ) ||
    "플레이어";


  if (!roomId) {

    showMessage(
      "방 코드를 입력해주세요."
    );

    return false;
  }


  onlineNickname =
    nickname;


  gameMode =
    "online";


  onlineWaiting =
    true;


  socket.emit(
    "room:join",
    {
      roomId,
      nickname
    }
  );


  showMessage(
    "방에 입장하는 중입니다..."
  );


  return true;
}


/* =========================================================
   온라인 상태 요청
========================================================= */

function requestOnlineRoomState() {

  if (
    !socket ||
    !socketConnected
  ) {
    return false;
  }

  socket.emit(
    "room:state"
  );

  return true;
}


/* =========================================================
   온라인 단어 제출
========================================================= */

function submitOnlineWord(
  inputWord = null
) {

  if (
    !socket ||
    !socketConnected
  ) {

    showMessage(
      "서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  if (!onlineRoomId) {

    showMessage(
      "먼저 방에 입장해주세요."
    );

    return false;
  }


  if (!game) {
    return false;
  }


  if (game.finished) {
    return false;
  }


  if (
    game.turnPlayer !==
    onlinePlayerIndex
  ) {

    showMessage(
      "지금은 상대방 차례입니다."
    );

    return false;
  }


  const input =
    findElement(

      "#wordInput",

      "#inputWord",

      "input[name='word']",

      "input[type='text']"
    );


  let word =
    inputWord != null
      ? inputWord
      : input?.value;


  word =
    normalizeWord(word);


  if (!word) {

    showMessage(
      "단어를 입력해주세요."
    );

    return false;
  }


  /*
   * 중요:
   *
   * 온라인 모드에서는 여기서 playWord()를
   * 호출하여 게임 상태를 확정하지 않는다.
   *
   * 서버가:
   * - 단어 존재
   * - 중복
   * - 두음법칙
   * - 연결
   * - 턴
   * - 게임 종료
   *
   * 를 전부 판정한다.
   */


  socket.emit(
    "game:word",
    {
      word
    }
  );


  if (input) {
    input.value = "";
  }


  showMessage(
    "단어를 확인하는 중..."
  );


  updateGameUI();


  return true;
}


/* =========================================================
   game:submit 방식
========================================================= */

function submitOnlineWordLegacy(
  inputWord = null
) {

  if (
    !socket ||
    !socketConnected
  ) {

    showMessage(
      "서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  const input =
    findElement(

      "#wordInput",

      "#inputWord",

      "input[name='word']",

      "input[type='text']"
    );


  let word =
    inputWord != null
      ? inputWord
      : input?.value;


  word =
    normalizeWord(word);


  if (!word) {

    showMessage(
      "단어를 입력해주세요."
    );

    return false;
  }


  socket.emit(
    "game:submit",
    {
      word
    }
  );


  if (input) {
    input.value = "";
  }


  showMessage(
    "단어를 확인하는 중..."
  );


  return true;
}


/* =========================================================
   온라인 재시작
========================================================= */

function restartOnlineGame(
  startChar = ""
) {

  if (
    !socket ||
    !socketConnected
  ) {

    showMessage(
      "서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  if (!onlineRoomId) {

    showMessage(
      "먼저 온라인 방에 입장해주세요."
    );

    return false;
  }


  startChar =
    normalizeWord(
      startChar ||
      getStartCharFromUI()
    ).at(0) || "";


  socket.emit(
    "game:restart",
    {
      startChar
    }
  );


  showMessage(
    "게임을 다시 시작하는 중입니다..."
  );


  return true;
}


/* =========================================================
   온라인 방 나가기
========================================================= */

function leaveOnlineRoom() {

  if (
    socket &&
    socketConnected &&
    onlineRoomId
  ) {

    socket.emit(
      "room:leave"
    );
  }


  onlineRoomId =
    null;

  onlinePlayerIndex =
    null;

  onlineWaiting =
    false;

  onlineState =
    null;

  lastServerStateKey =
    "";

  lastServerWordTurn =
    -1;


  gameStarted =
    false;


  game =
    null;


  updateGameUI();

  updateCurrentWordUI("");

  renderHistory();


  showMessage(
    "방에서 나왔습니다."
  );


  return true;
}


/* =========================================================
   통합 단어 제출
========================================================= */

async function submitPlayerWord(
  inputWord = null
) {

  if (!gameStarted) {

    showMessage(
      "게임이 시작되지 않았습니다."
    );

    return false;
  }


  /*
   * 온라인
   */

  if (
    gameMode ===
    "online"
  ) {

    return submitOnlineWord(
      inputWord
    );
  }


  /*
   * AI
   */

  if (!game) {
    return false;
  }


  if (game.finished) {
    return false;
  }


  if (
    game.turnPlayer !==
    playerIndex
  ) {

    showMessage(
      "지금은 AI 차례입니다."
    );

    return false;
  }


  const input =
    findElement(

      "#wordInput",

      "#inputWord",

      "input[name='word']",

      "input[type='text']"
    );


  let word =
    inputWord != null
      ? inputWord
      : input?.value;


  word =
    normalizeWord(word);


  if (!word) {

    showMessage(
      "단어를 입력해주세요."
    );

    return false;
  }


  const result =
    playWord(
      game,
      word,
      WORDS,
      getDueumMap(),
      ATTACK_DEPTH
    );


  if (!result.ok) {

    showMessage(
      result.reason
    );

    return false;
  }


  if (input) {
    input.value = "";
  }


  updateGameUI();

  renderHistory();


  if (
    result.finished
  ) {

    showMessage(
      result.winner ===
      playerIndex
        ? "승리했습니다!"
        : "패배했습니다!"
    );

    return true;
  }


  showMessage(
    "AI가 생각 중입니다."
  );


  if (
    gameMode === "ai" &&
    game.turnPlayer ===
      aiIndex
  ) {

    await runAITurn();
  }


  return true;
}


/* =========================================================
   AI 차례
========================================================= */

async function runAITurn() {

  if (aiThinking) {
    return;
  }

  if (!gameStarted) {
    return;
  }

  if (!game) {
    return;
  }

  if (game.finished) {
    return;
  }

  if (
    gameMode !==
    "ai"
  ) {
    return;
  }

  if (
    game.turnPlayer !==
    aiIndex
  ) {
    return;
  }


  aiThinking =
    true;


  updateGameUI();

  showMessage(
    "AI가 생각 중입니다..."
  );


  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        50
      )
  );


  try {

    let strength =
      0.70;


    const difficulty =
      findElement(

        "#difficulty",

        "#aiDifficulty",

        "select[name='difficulty']"
      );


    if (difficulty) {

      const value =
        Number(
          difficulty.value
        );

      if (
        Number.isFinite(
          value
        )
      ) {

        strength =
          Math.max(
            0.2,
            Math.min(
              1,
              value / 5
            )
          );
      }
    }


    const firstTurn =
      !game.currentWord;


    let word =
      chooseBotWord({

        currentWord:
          game.currentWord,

        startChar:
          game.startChar,

        usedWords:
          game.usedWords,

        words:
          WORDS,

        dueum:
          getDueumMap(),

        attackDepth:
          ATTACK_DEPTH,

        strength,

        winBias:
          0.50
      });


    /*
     * 첫 턴 안전성 재검사
     */

    if (
      firstTurn &&
      word
    ) {

      const info =
        analyzeWord(
          word,
          game.usedWords,
          WORDS,
          ATTACK_DEPTH,
          getDueumMap()
        );


      if (
        info.oneShot ||
        info.winningAttack
      ) {

        const safe =
          getCandidatesFromChar(
            game.startChar,
            game.usedWords,
            WORDS,
            getDueumMap()
          )
            .map(
              candidate =>
                analyzeWord(
                  candidate,
                  game.usedWords,
                  WORDS,
                  ATTACK_DEPTH,
                  getDueumMap()
                )
            )
            .filter(
              candidate =>
                !candidate.oneShot &&
                !candidate.winningAttack
            );


        if (safe.length) {

          safe.sort(
            (a, b) =>
              b.nextCount -
              a.nextCount
          );

          word =
            safe[0].word;
        }
      }
    }


    /*
     * AI가 낼 단어가 없음
     */

    if (!word) {

      game.finished =
        true;

      game.winner =
        playerIndex;

      game.loser =
        aiIndex;


      showMessage(
        "AI가 낼 수 있는 단어가 없습니다. 승리!"
      );

      return;
    }


    /*
     * 실제 로컬 엔진 검증
     */

    const result =
      playWord(
        game,
        word,
        WORDS,
        getDueumMap(),
        ATTACK_DEPTH
      );


    if (!result.ok) {

      const retryCandidates =
        getCandidates(
          game.currentWord,
          game.usedWords,
          WORDS,
          getDueumMap()
        );


      let retryWord =
        null;


      for (
        const candidate
        of retryCandidates
      ) {

        const info =
          analyzeWord(
            candidate,
            game.usedWords,
            WORDS,
            ATTACK_DEPTH,
            getDueumMap()
          );


        if (
          firstTurn &&
          (
            info.oneShot ||
            info.winningAttack
          )
        ) {
          continue;
        }


        retryWord =
          candidate;

        break;
      }


      if (retryWord) {

        const retryResult =
          playWord(
            game,
            retryWord,
            WORDS,
            getDueumMap(),
            ATTACK_DEPTH
          );


        if (
          !retryResult.ok
        ) {

          showMessage(
            "AI가 단어를 선택하지 못했습니다."
          );

          return;
        }

      } else {

        showMessage(
          "AI가 단어를 선택하지 못했습니다."
        );

        return;
      }
    }


    updateGameUI();

    renderHistory();


    if (
      game.finished
    ) {

      showMessage(
        game.winner ===
          playerIndex
          ? "승리했습니다!"
          : "AI가 승리했습니다!"
      );

      return;
    }


    showMessage(
      "내 차례입니다."
    );

  }

  finally {

    aiThinking =
      false;

    updateGameUI();
  }
}


/* =========================================================
   시작 새 게임
========================================================= */

function startNewGame({
  mode = "ai",
  startChar = "",
  startPlayer = 0
} = {}) {

  gameMode =
    mode;


  /*
   * 온라인 모드
   *
   * 서버가 게임 상태를 만든다.
   */

  if (
    gameMode ===
    "online"
  ) {

    gameStarted =
      Boolean(
        onlineRoomId
      );

    onlineWaiting =
      !(
        onlineState &&
        onlineState.playerCount >= 2
      );


    if (
      onlineState
    ) {

      applyOnlineState(
        onlineState
      );

    } else {

      game =
        createGame({
          startChar,
          startPlayer:
            onlinePlayerIndex ??
            0
        });
    }


    updateGameUI();

    renderHistory();

    return game;
  }


  /*
   * AI 모드
   *
   * 사람부터 시작.
   */

  if (
    gameMode ===
    "ai"
  ) {

    startPlayer =
      playerIndex;
  }


  game =
    createGame({

      startChar,

      startPlayer
    });


  gameStarted =
    true;


  aiThinking =
    false;


  updateGameUI();

  renderHistory();


  showMessage(
    game.turnPlayer ===
    playerIndex
      ? "내 차례입니다."
      : "AI가 생각 중입니다."
  );


  /*
   * AI가 시작하는 상황을 외부에서
   * 강제로 지정했을 경우.
   */

  if (
    gameMode === "ai" &&
    game.turnPlayer !==
      playerIndex
  ) {

    runAITurn();
  }


  return game;
}


/* =========================================================
   방 ID UI
========================================================= */

function getRoomIdFromUI() {

  const element =
    findElement(

      "#roomIdInput",

      "#roomInput",

      "#roomCodeInput",

      "#roomCode",

      "input[name='roomId']",

      "input[name='roomCode']"
    );


  if (!element) {
    return "";
  }


  return String(
    element.value ??
    element.textContent ??
    ""
  )
    .trim()
    .toUpperCase();
}


/* =========================================================
   닉네임 UI
========================================================= */

function getNicknameFromUI() {

  const element =
    findElement(

      "#nickname",

      "#nicknameInput",

      "input[name='nickname']"
    );


  if (!element) {
    return "플레이어";
  }


  return normalizeWord(
    element.value ??
    element.textContent ??
    ""
  ) || "플레이어";
}


/* =========================================================
   시작 글자 UI
========================================================= */

function getStartCharFromUI() {

  const element =
    findElement(

      "#startChar",

      "#startWord",

      "#gameStartChar",

      "input[name='startChar']"
    );


  if (!element) {
    return "";
  }


  return normalizeWord(
    element.value ??
    element.textContent ??
    ""
  ).at(0) || "";
}


/* =========================================================
   게임 모드 UI
========================================================= */

function getGameModeFromUI() {

  const aiButton =
    findElement(
      "#aiMode",
      "[data-mode='ai']"
    );


  const onlineButton =
    findElement(
      "#onlineMode",
      "[data-mode='online']"
    );


  if (
    aiButton &&
    aiButton.classList.contains(
      "active"
    )
  ) {

    return "ai";
  }


  if (
    onlineButton &&
    onlineButton.classList.contains(
      "active"
    )
  ) {

    return "online";
  }


  return "ai";
}


/* =========================================================
   이벤트 중복 방지
========================================================= */

function bindOnce(
  element,
  event,
  key,
  handler
) {

  if (!element) {
    return;
  }


  if (
    !element.__kkeulBoundEvents
  ) {

    element.__kkeulBoundEvents =
      new Set();
  }


  const eventKey =
    `${event}:${key}`;


  if (
    element.__kkeulBoundEvents.has(
      eventKey
    )
  ) {
    return;
  }


  element.__kkeulBoundEvents.add(
    eventKey
  );


  element.addEventListener(
    event,
    handler
  );
}


/* =========================================================
   DOM 이벤트
========================================================= */

function setupGameEvents() {

  /*
   * 입력창
   */

  const input =
    findElement(

      "#wordInput",

      "#inputWord",

      "input[name='word']"
    );


  if (input) {

    bindOnce(
      input,
      "keydown",
      "word-input",
      function(event) {

        if (
          event.key ===
          "Enter"
        ) {

          event.preventDefault();

          submitPlayerWord();
        }
      }
    );
  }


  /*
   * 단어 제출 버튼
   */

  const submitButton =
    findElement(

      "#submitWord",

      "#submitButton",

      "#wordSubmit",

      "[data-submit-word]"
    );


  if (submitButton) {

    bindOnce(
      submitButton,
      "click",
      "submit-word",
      function(event) {

        event.preventDefault();

        submitPlayerWord();
      }
    );
  }


  /*
   * 새 게임
   */

  const newGameButton =
    findElement(

      "#newGame",

      "#newGameButton",

      "#restartGame",

      "#restartButton",

      "[data-new-game]"
    );


  if (newGameButton) {

    bindOnce(
      newGameButton,
      "click",
      "new-game",
      function(event) {

        event.preventDefault();


        if (
          gameMode ===
          "online"
        ) {

          restartOnlineGame(
            getStartCharFromUI()
          );

          return;
        }


        startNewGame({

          mode:
            gameMode || "ai",

          startChar:
            getStartCharFromUI(),

          startPlayer:
            playerIndex
        });
      }
    );
  }


  /*
   * 온라인 방 생성
   */

  const createRoomButton =
    findElement(

      "#createRoom",

      "#createRoomButton",

      "#roomCreate",

      "[data-create-room]"
    );


  if (createRoomButton) {

    bindOnce(
      createRoomButton,
      "click",
      "create-room",
      function(event) {

        event.preventDefault();

        createOnlineRoom();
      }
    );
  }


  /*
   * 온라인 방 입장
   */

  const joinRoomButton =
    findElement(

      "#joinRoom",

      "#joinRoomButton",

      "#roomJoin",

      "[data-join-room]"
    );


  if (joinRoomButton) {

    bindOnce(
      joinRoomButton,
      "click",
      "join-room",
      function(event) {

        event.preventDefault();

        joinOnlineRoom();
      }
    );
  }


  /*
   * 방 나가기
   */

  const leaveRoomButton =
    findElement(

      "#leaveRoom",

      "#leaveRoomButton",

      "#roomLeave",

      "[data-leave-room]"
    );


  if (leaveRoomButton) {

    bindOnce(
      leaveRoomButton,
      "click",
      "leave-room",
      function(event) {

        event.preventDefault();

        leaveOnlineRoom();
      }
    );
  }


  /*
   * AI 모드
   */

  const aiModeButton =
    findElement(
      "#aiMode",
      "[data-mode='ai']"
    );


  if (aiModeButton) {

    bindOnce(
      aiModeButton,
      "click",
      "ai-mode",
      function(event) {

        event.preventDefault();

        gameMode =
          "ai";

        onlineWaiting =
          false;

        startNewGame({

          mode:
            "ai",

          startChar:
            getStartCharFromUI(),

          startPlayer:
            playerIndex
        });
      }
    );
  }


  /*
   * 온라인 모드
   */

  const onlineModeButton =
    findElement(
      "#onlineMode",
      "[data-mode='online']"
    );


  if (onlineModeButton) {

    bindOnce(
      onlineModeButton,
      "click",
      "online-mode",
      async function(event) {

        event.preventDefault();

        gameMode =
          "online";

        gameStarted =
          false;

        updateGameUI();

        showMessage(
          "온라인 모드입니다. 방을 생성하거나 참가해주세요."
        );


        try {

          await connectSocket();

        } catch (error) {

          console.error(
            error
          );

          showMessage(
            "온라인 서버에 연결하지 못했습니다."
          );
        }
      }
    );
  }
}


/* =========================================================
   초기화
========================================================= */

async function initializeGame() {

  try {

    await loadWordData();


    if (
      !WORDS.size
    ) {

      /*
       * 온라인 모드에서는
       * 서버 데이터가 실제 판정하므로
       * 클라이언트 word.txt가 없어도
       * Socket.IO 연결 자체는 가능하게 한다.
       */

      console.warn(
        "클라이언트 word.txt가 없습니다."
      );
    }


    setupGameEvents();


    /*
     * 온라인 버튼이 있으면
     * Socket.IO 연결을 준비한다.
     */

    const onlineButton =
      findElement(

        "#onlineMode",

        "[data-mode='online']"
      );


    if (
      onlineButton &&
      onlineButton.classList.contains(
        "active"
      )
    ) {

      gameMode =
        "online";

      await connectSocket();

    }


    /*
     * 기존 게임이 없을 때만
     * AI 게임 생성.
     */

    if (
      !gameStarted &&
      gameMode === "ai"
    ) {

      startNewGame({

        mode:
          "ai",

        startChar:
          getStartCharFromUI(),

        startPlayer:
          playerIndex
      });
    }


  } catch (error) {

    console.error(
      "게임 초기화 오류:",
      error
    );


    showMessage(
      "게임을 초기화하지 못했습니다."
    );
  }
}


/* =========================================================
   DOM 준비
========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initializeGame,
    {
      once: true
    }
  );

} else {

  initializeGame();
}


/* =========================================================
   전역 공개
========================================================= */

if (
  typeof window !==
  "undefined"
) {

  /* 기본 */

  window.normalizeWord =
    normalizeWord;

  window.allowedFirstChars =
    allowedFirstChars;

  window.canConnect =
    canConnect;

  window.hasWord =
    hasWord;

  window.getCandidates =
    getCandidates;

  window.getCandidatesFromChar =
    getCandidatesFromChar;


  /* 공격 */

  window.getAttackDepth =
    getAttackDepth;

  window.isWinningAttack =
    isWinningAttack;

  window.isLosingAttack =
    isLosingAttack;


  /* 분석 */

  window.analyzeWord =
    analyzeWord;

  window.analyzeFutureRisk =
    analyzeFutureRisk;


  /* 게임 */

  window.createGame =
    createGame;

  window.playWord =
    playWord;

  window.chooseBotWord =
    chooseBotWord;

  window.getPublicGameState =
    getPublicGameState;


  /* 데이터 */

  window.loadWordData =
    loadWordData;


  /* AI */

  window.startNewGame =
    startNewGame;

  window.submitPlayerWord =
    submitPlayerWord;

  window.runAITurn =
    runAITurn;


  /* UI */

  window.updateGameUI =
    updateGameUI;

  window.renderHistory =
    renderHistory;


  /* Socket.IO */

  window.connectSocket =
    connectSocket;

  window.createOnlineRoom =
    createOnlineRoom;

  window.joinOnlineRoom =
    joinOnlineRoom;

  window.requestOnlineRoomState =
    requestOnlineRoomState;

  window.submitOnlineWord =
    submitOnlineWord;

  window.restartOnlineGame =
    restartOnlineGame;

  window.leaveOnlineRoom =
    leaveOnlineRoom;


  /*
   * game:submit을 직접 쓰고 싶은 경우.
   */

  window.submitOnlineWordLegacy =
    submitOnlineWordLegacy;


  /*
   * 상태 확인
   */

  window.gameState =
    () => game;

  window.onlineState =
    () => onlineState;

  window.onlineSocket =
    () => socket;

  window.onlineRoom =
    () => onlineRoomId;

  window.onlinePlayer =
    () => onlinePlayerIndex;
}
