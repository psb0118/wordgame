"use strict";

/*
 * =========================================================
 * 끝말잇기 전체 클라이언트 게임 엔진
 * =========================================================
 *
 * 지원
 *
 * [싱글 AI]
 *  - Lv1 ~ Lv5
 *  - 사람 선공
 *  - 첫 단어 한방 금지
 *  - 첫 단어 공격 단어 금지
 *  - 실제 word.txt 단어만 사용
 *  - attack.txt 깊이 사용
 *  - 두음법칙
 *  - 중복 단어 방지
 *
 * [온라인]
 *  - Socket.IO
 *  - 2명 이상 다인전
 *  - 서버 턴 우선
 *  - 서버 검증 우선
 *  - 참가자 목록
 *  - 게임 상태 동기화
 *
 * =========================================================
 */


/* =========================================================
   전역 상태
========================================================= */

let WORDS = new Set();
let ATTACK_DEPTH = {};
let DUEUM = {};

let game = null;

let aiThinking = false;
let gameMode = "ai";

let playerIndex = 0;
let aiIndex = 1;

let gameStarted = false;

let socket = null;
let socketConnected = false;

let onlineRoomId = null;
let onlinePlayerId = null;
let onlinePlayers = [];

let onlineHost = false;
let onlineReady = false;

let onlineEventBound = false;

let aiTimer = null;


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


/*
 * 프로젝트 외부에서 DUEUM을 지정해도 사용할 수 있도록 함.
 */
function getDueumMap() {
  if (
    DUEUM &&
    typeof DUEUM === "object" &&
    Object.keys(DUEUM).length > 0
  ) {
    return DUEUM;
  }

  return DEFAULT_DUEUM;
}


/* =========================================================
   허용 첫 글자
========================================================= */

function allowedFirstChars(lastChar, dueum = getDueumMap()) {
  lastChar = normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result = new Set();

  /*
   * 원래 글자는 항상 가능
   */
  result.add(lastChar);

  /*
   * 정방향 두음
   *
   * 녀 -> 여
   * 늄 -> 윰
   *
   * 외부 DUEUM에 들어 있으면 그대로 적용
   */
  const direct = dueum[lastChar];

  if (Array.isArray(direct)) {
    for (const value of direct) {
      const normalized = normalizeWord(value);

      if (normalized) {
        result.add(normalized);
      }
    }
  }

  /*
   * 역방향도 허용
   *
   * 여 -> 녀
   * 연 -> 년
   * 윰 -> 늄
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
  dueum = getDueumMap()
) {
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
   단어 존재 검사
========================================================= */

function hasWord(word, words = WORDS) {
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
  usedWords = new Set(),
  words = WORDS,
  dueum = getDueumMap()
) {
  previousWord = normalizeWord(previousWord);

  if (!previousWord || !words) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const allowed = new Set(
    allowedFirstChars(
      previousWord.at(-1),
      dueum
    )
  );

  const result = [];

  for (const rawWord of words) {
    const word = normalizeWord(rawWord);

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
   시작 글자 후보
========================================================= */

function getCandidatesFromChar(
  char,
  usedWords = new Set(),
  words = WORDS,
  dueum = getDueumMap()
) {
  char = normalizeWord(char);

  if (!char || !words) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const allowed = new Set(
    allowedFirstChars(
      char,
      dueum
    )
  );

  const result = [];

  for (const rawWord of words) {
    const word = normalizeWord(rawWord);

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
   공격 데이터
========================================================= */

function getAttackDepth(
  word,
  attackDepth = ATTACK_DEPTH
) {
  word = normalizeWord(word);

  if (!word || !attackDepth) {
    return null;
  }

  const value = attackDepth[word];

  if (value == null) {
    return null;
  }

  const depth = Number(value);

  if (!Number.isFinite(depth)) {
    return null;
  }

  return depth;
}


function isWinningAttack(
  word,
  attackDepth = ATTACK_DEPTH
) {
  const depth = getAttackDepth(
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
  const depth = getAttackDepth(
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
  word = normalizeWord(word);

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const nextUsed = new Set(used);

  nextUsed.add(word);

  const next = getCandidates(
    word,
    nextUsed,
    words,
    dueum
  );

  const depth = getAttackDepth(
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
   미래 위험 분석
========================================================= */

function analyzeFutureRisk(
  info,
  words = WORDS,
  usedWords = new Set(),
  dueum = getDueumMap()
) {
  if (!info || !info.word) {
    return {
      risk: 1,
      botNextCount: 0
    };
  }

  const usedAfter =
    usedWords instanceof Set
      ? new Set(usedWords)
      : new Set(usedWords || []);

  usedAfter.add(info.word);

  const opponentCandidates = getCandidates(
    info.word,
    usedAfter,
    words,
    dueum
  );

  if (!opponentCandidates.length) {
    return {
      risk: 0,
      botNextCount: 0
    };
  }

  const limit = Math.min(
    opponentCandidates.length,
    60
  );

  let dangerous = 0;

  for (let i = 0; i < limit; i++) {
    const opponentWord =
      opponentCandidates[i];

    const nextUsed =
      new Set(usedAfter);

    nextUsed.add(opponentWord);

    const botCandidates =
      getCandidates(
        opponentWord,
        nextUsed,
        words,
        dueum
      );

    if (!botCandidates.length) {
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
  if (!info) {
    return -Infinity;
  }

  let score = 0;

  const nextCount = info.nextCount;
  const depth = info.depth ?? 0;
  const risk = futureRisk?.risk ?? 0;

  /*
   * 첫 수는 특별 처리
   */
  if (firstTurn) {
    if (info.oneShot) {
      score -= 100000000;
    }

    if (info.winningAttack) {
      score -= 30000000;
    }

    score +=
      Math.min(nextCount, 30) * 80;

    score -=
      Math.max(0, depth) * 100;
  }


  /*
   * 상대 선택지
   */
  if (nextCount === 0) {
    score += 12000;
  } else if (nextCount === 1) {
    score += 4200;
  } else if (nextCount <= 4) {
    score += 1700;
  } else if (nextCount <= 10) {
    score += 500;
  } else {
    score += 80;
  }


  /*
   * 공격 단어
   */
  if (info.winningAttack) {
    score +=
      900 +
      depth * 45;

    score +=
      Math.min(depth, 30) * 25;
  }


  /*
   * 일반 단어
   */
  if (!info.winningAttack) {
    score +=
      Math.min(nextCount, 30) * 12;
  }


  /*
   * 미래 위험
   */
  if (risk >= 0.75) {
    score -= 4500;
  } else if (risk >= 0.50) {
    score -= 2200;
  } else if (risk >= 0.25) {
    score -= 700;
  }


  /*
   * 승률 성향
   */
  if (winBias > 0.60) {
    if (info.winningAttack) {
      score -=
        (winBias - 0.60) * 9000;
    }

    if (info.oneShot) {
      score -=
        (winBias - 0.60) * 7000;
    }
  } else if (winBias < 0.40) {
    if (info.winningAttack) {
      score +=
        (0.40 - winBias) * 7000;
    }

    if (info.nextCount <= 1) {
      score +=
        (0.40 - winBias) * 4000;
    }
  }


  /*
   * 난이도
   */
  if (info.winningAttack) {
    score += strength * 1800;
  } else {
    score += (1 - strength) * 250;
  }


  /*
   * 첫 턴 정책 재확인
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
      : new Set(usedWords || []);

  let candidates;

  if (currentWord) {
    candidates = getCandidates(
      currentWord,
      used,
      words,
      dueum
    );
  } else {
    candidates = getCandidatesFromChar(
      startChar,
      used,
      words,
      dueum
    );
  }

  if (!candidates.length) {
    return null;
  }

  const firstTurn = !currentWord;

  let analyzed =
    candidates.map(word =>
      analyzeWord(
        word,
        used,
        words,
        attackDepth,
        dueum
      )
    );


  /*
   * 첫 턴 안전 후보 필터
   */
  if (firstTurn) {
    let safe =
      analyzed.filter(
        info => !info.oneShot
      );

    const nonAttack =
      safe.filter(
        info => !info.winningAttack
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
   점수 후 선택
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
    analyzed.map(info => {
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
    });

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


  /*
   * 첫 턴은 반드시 안전 후보
   */
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


  /*
   * 난이도별 후보 폭
   */
  let poolSize;

  if (strength >= 0.85) {
    poolSize = 3;
  } else if (strength >= 0.70) {
    poolSize = 5;
  } else if (strength >= 0.55) {
    poolSize = 8;
  } else {
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
   게임 생성
========================================================= */

function createGame({
  startChar = "",
  startPlayer = 0,
  playerCount = 2
} = {}) {
  return {
    startChar:
      normalizeWord(startChar),

    currentWord: null,

    turnPlayer:
      Number.isInteger(startPlayer)
        ? startPlayer
        : 0,

    playerCount:
      Math.max(
        2,
        Number(playerCount) || 2
      ),

    history: [],

    usedWords:
      new Set(),

    finished: false,

    winner: null,

    loser: null
  };
}


/* =========================================================
   다음 플레이어
========================================================= */

function getNextPlayer(
  gameState,
  currentPlayer
) {
  if (!gameState) {
    return 0;
  }

  const count =
    Math.max(
      2,
      Number(gameState.playerCount) || 2
    );

  return (
    (currentPlayer + 1) %
    count
  );
}


/* =========================================================
   단어 플레이
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

  word = normalizeWord(word);

  if (!word) {
    return {
      ok: false,
      reason:
        "단어를 입력해주세요."
    };
  }


  /*
   * 실제 단어 목록
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
  if (gameState.usedWords.has(word)) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /*
   * 첫 단어
   */
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


  /*
   * 연결
   */
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


  /*
   * 등록
   */
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


  /*
   * 다음 플레이어
   */
  gameState.turnPlayer =
    getNextPlayer(
      gameState,
      player
    );


  /*
   * 다음 후보
   */
  const next =
    getCandidates(
      word,
      gameState.usedWords,
      words,
      dueum
    );


  /*
   * 종료
   */
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

    playerCount:
      gameState.playerCount,

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
   단어 데이터 로딩
========================================================= */

async function fetchTextFromPaths(paths) {
  for (const path of paths) {
    try {
      const response =
        await fetch(path, {
          cache: "no-store"
        });

      if (!response.ok) {
        continue;
      }

      const text =
        await response.text();

      if (text) {
        return text;
      }
    } catch (_) {
      /* 다음 경로 */
    }
  }

  return null;
}


async function loadWordData() {
  if (
    WORDS.size > 0 &&
    Object.keys(ATTACK_DEPTH).length > 0
  ) {
    return {
      words: WORDS,
      attackDepth: ATTACK_DEPTH
    };
  }


  /*
   * word.txt
   */
  const wordText =
    await fetchTextFromPaths([
      "/word.txt",
      "./word.txt",
      "/data/word.txt",
      "/data/words.txt"
    ]);


  if (wordText) {
    for (
      const line of
      wordText.split(/\r?\n/)
    ) {
      const trimmed =
        line.trim();

      if (!trimmed) {
        continue;
      }

      /*
       * 일반적인 txt 한 줄 단어 형식
       */
      const parts =
        trimmed.split(/\s+/);

      const word =
        normalizeWord(parts[0]);

      if (word) {
        WORDS.add(word);
      }
    }
  }


  /*
   * attack.txt
   */
  const attackText =
    await fetchTextFromPaths([
      "/attack.txt",
      "./attack.txt",
      "/data/attack.txt"
    ]);


  if (attackText) {
    for (
      const line of
      attackText.split(/\r?\n/)
    ) {
      const trimmed =
        line.trim();

      if (!trimmed) {
        continue;
      }

      const parts =
        trimmed.split(/\s+/);

      if (!parts.length) {
        continue;
      }

      const word =
        normalizeWord(parts[0]);

      const depth =
        Number(parts[1]);

      if (
        word &&
        Number.isFinite(depth)
      ) {
        /*
         * 공격 목록에 없는 단어는
         * 절대로 만들어내지 않음.
         */
        if (WORDS.has(word)) {
          ATTACK_DEPTH[word] =
            depth;
        }
      }
    }
  }


  /*
   * 전역 공개
   */
  if (
    typeof window !== "undefined"
  ) {
    window.WORDS =
      WORDS;

    window.ATTACK_DEPTH =
      ATTACK_DEPTH;
  }


  return {
    words: WORDS,
    attackDepth: ATTACK_DEPTH
  };
}


/* =========================================================
   UI 요소
========================================================= */

function findElement(...selectors) {
  for (const selector of selectors) {
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
    } catch (_) {
      /* 무시 */
    }
  }

  return null;
}


function findElements(...selectors) {
  const result = [];

  for (const selector of selectors) {
    if (!selector) {
      continue;
    }

    try {
      const elements =
        document.querySelectorAll(
          selector
        );

      for (const element of elements) {
        if (!result.includes(element)) {
          result.push(element);
        }
      }
    } catch (_) {
      /* 무시 */
    }
  }

  return result;
}


/* =========================================================
   메시지
========================================================= */

function showMessage(message) {
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
   현재 단어
========================================================= */

function updateCurrentWordUI() {
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
}


/* =========================================================
   턴 표시
========================================================= */

function getPlayerName(index) {
  if (
    onlinePlayers &&
    onlinePlayers[index]
  ) {
    return (
      onlinePlayers[index].name ||
      onlinePlayers[index].username ||
      `플레이어 ${index + 1}`
    );
  }

  if (
    gameMode === "ai" &&
    index === aiIndex
  ) {
    return "AI";
  }

  if (index === playerIndex) {
    return "나";
  }

  return `플레이어 ${index + 1}`;
}


function updateTurnUI() {
  const turn =
    findElement(
      "#turn",
      "#turnText",
      ".turn",
      "[data-turn]"
    );

  if (!turn || !game) {
    return;
  }


  if (game.finished) {
    if (
      game.winner === playerIndex
    ) {
      turn.textContent =
        "승리!";
    } else {
      turn.textContent =
        `${getPlayerName(game.winner)} 승리`;
    }

    return;
  }


  if (
    gameMode === "ai"
  ) {
    turn.textContent =
      game.turnPlayer === playerIndex
        ? "내 차례"
        : "AI 차례";

    return;
  }


  turn.textContent =
    game.turnPlayer === playerIndex
      ? "내 차례"
      : `${getPlayerName(game.turnPlayer)} 차례`;
}


/* =========================================================
   입력 UI
========================================================= */

function updateInputUI() {
  const input =
    findElement(
      "#wordInput",
      "#inputWord",
      "input[name='word']",
      "input[type='text']"
    );

  if (!input) {
    return;
  }

  let disabled =
    !gameStarted ||
    !game ||
    game.finished;


  if (
    gameMode === "ai"
  ) {
    disabled =
      disabled ||
      aiThinking ||
      game.turnPlayer !== playerIndex;
  }


  if (
    gameMode === "online"
  ) {
    disabled =
      disabled ||
      !socketConnected ||
      !onlineReady ||
      game.turnPlayer !== playerIndex;
  }


  input.disabled =
    disabled;
}


/* =========================================================
   전체 UI
========================================================= */

function updateGameUI() {
  updateCurrentWordUI();
  updateTurnUI();
  updateInputUI();
  renderPlayers();
}


/* =========================================================
   기록
========================================================= */

function renderHistory() {
  const list =
    findElement(
      "#history",
      ".history",
      "[data-history]"
    );

  if (!list || !game) {
    return;
  }

  list.innerHTML = "";

  for (const item of game.history) {
    const row =
      document.createElement(
        "div"
      );

    row.className =
      "history-item";

    const depth =
      item.depth != null
        ? ` [깊이 ${item.depth}]`
        : "";

    row.textContent =
      `${getPlayerName(item.player)}: ${item.word}${depth}`;

    list.appendChild(row);
  }
}


/* =========================================================
   참가자 목록
========================================================= */

function renderPlayers() {
  const list =
    findElement(
      "#players",
      "#playerList",
      ".players",
      ".player-list",
      "[data-players]"
    );

  if (!list) {
    return;
  }

  list.innerHTML = "";


  /*
   * 온라인
   */
  if (
    gameMode === "online"
  ) {
    for (
      let i = 0;
      i < onlinePlayers.length;
      i++
    ) {
      const player =
        onlinePlayers[i];

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "player-item";

      if (
        i === playerIndex
      ) {
        row.classList.add(
          "self"
        );
      }

      if (
        game &&
        i === game.turnPlayer &&
        !game.finished
      ) {
        row.classList.add(
          "current-turn"
        );
      }

      const name =
        player?.name ||
        player?.username ||
        `플레이어 ${i + 1}`;

      row.textContent =
        `${i + 1}. ${name}`;

      list.appendChild(row);
    }

    return;
  }


  /*
   * AI
   */
  const me =
    document.createElement(
      "div"
    );

  me.className =
    "player-item self";

  me.textContent =
    "1. 나";

  list.appendChild(me);


  const ai =
    document.createElement(
      "div"
    );

  ai.className =
    "player-item";

  ai.textContent =
    "2. AI";

  list.appendChild(ai);
}


/* =========================================================
   시작 글자
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

  return (
    normalizeWord(
      element.value ||
      element.textContent ||
      ""
    ).at(0) || ""
  );
}


/* =========================================================
   랜덤 시작 글자
========================================================= */

function chooseRandomStartChar() {
  /*
   * 실제 word.txt에 존재하는 단어에서
   * 시작 글자를 가져온다.
   *
   * 단, 시작 후보가 없는 글자는 제외.
   */

  const chars =
    new Set();

  for (const word of WORDS) {
    if (!word) {
      continue;
    }

    const first =
      word.at(0);

    if (first) {
      chars.add(first);
    }
  }

  const list =
    [...chars];

  if (!list.length) {
    return "";
  }

  return list[
    Math.floor(
      Math.random() *
      list.length
    )
  ];
}


/* =========================================================
   안전한 시작 글자
========================================================= */

function chooseSafeStartChar() {
  const chars =
    new Set();

  for (const word of WORDS) {
    if (!word) {
      continue;
    }

    const first =
      word.at(0);

    if (!first) {
      continue;
    }

    chars.add(first);
  }


  const candidates = [];

  for (const char of chars) {
    const list =
      getCandidatesFromChar(
        char,
        new Set(),
        WORDS,
        getDueumMap()
      );

    /*
     * 시작할 수 있는 단어가 최소 2개 이상인
     * 글자를 우선.
     */
    const safe =
      list.filter(word => {
        const info =
          analyzeWord(
            word,
            new Set(),
            WORDS,
            ATTACK_DEPTH,
            getDueumMap()
          );

        return (
          !info.oneShot &&
          !info.winningAttack
        );
      });

    if (safe.length) {
      candidates.push({
        char,
        count:
          safe.length
      });
    }
  }


  if (!candidates.length) {
    return chooseRandomStartChar();
  }


  candidates.sort(
    (a, b) =>
      b.count - a.count
  );


  /*
   * 너무 특정 글자만 고정되지 않도록
   * 상위 후보 중 랜덤.
   */
  const pool =
    candidates.slice(
      0,
      Math.min(
        10,
        candidates.length
      )
    );

  return pool[
    Math.floor(
      Math.random() *
      pool.length
    )
  ].char;
}


/* =========================================================
   게임 모드
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


  /*
   * select 방식도 지원
   */
  const select =
    findElement(
      "#gameMode",
      "select[name='gameMode']"
    );

  if (select) {
    const value =
      String(
        select.value
      ).toLowerCase();

    if (
      value === "online"
    ) {
      return "online";
    }
  }


  return "ai";
}


/* =========================================================
   게임 시작
========================================================= */

function startNewGame({
  mode = "ai",
  startChar = "",
  startPlayer = 0,
  playerCount = 2
} = {}) {
  /*
   * 기존 AI 타이머 제거
   */
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }

  aiThinking = false;

  gameMode =
    mode === "online"
      ? "online"
      : "ai";


  /*
   * AI 모드는 무조건 사람 선공
   */
  if (
    gameMode === "ai"
  ) {
    startPlayer =
      playerIndex;
  }


  /*
   * 시작 글자가 없으면 안전한 글자 자동 생성
   */
  let actualStartChar =
    normalizeWord(startChar).at(0) ||
    "";


  if (!actualStartChar) {
    actualStartChar =
      chooseSafeStartChar();
  }


  game =
    createGame({
      startChar:
        actualStartChar,

      startPlayer,

      playerCount:
        gameMode === "online"
          ? Math.max(
              2,
              playerCount
            )
          : 2
    });


  gameStarted =
    true;

  onlineReady =
    gameMode !== "online";


  updateGameUI();
  renderHistory();


  if (
    gameMode === "online"
  ) {
    showMessage(
      socketConnected
        ? "온라인 게임을 준비하는 중입니다."
        : "서버에 연결하는 중입니다."
    );

    return game;
  }


  showMessage(
    "내 차례입니다."
  );


  /*
   * 절대로 AI가 자동으로 첫 턴을 가져가지 않는다.
   */
  return game;
}


/* =========================================================
   플레이어 단어 입력
========================================================= */

async function submitPlayerWord(
  inputWord = null
) {
  if (!gameStarted || !game) {
    return false;
  }

  if (game.finished) {
    return false;
  }


  /*
   * 온라인
   */
  if (
    gameMode === "online"
  ) {
    return submitOnlineWord(
      inputWord
    );
  }


  /*
   * AI
   */
  if (
    game.turnPlayer !== playerIndex
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


  if (result.finished) {
    showMessage(
      result.winner === playerIndex
        ? "승리했습니다!"
        : "패배했습니다!"
    );

    return true;
  }


  showMessage(
    "AI가 생각 중입니다."
  );


  if (
    game.turnPlayer === aiIndex
  ) {
    await runAITurn();
  }


  return true;
}


/* =========================================================
   AI 난이도
========================================================= */

function getDifficulty() {
  const difficulty =
    findElement(
      "#difficulty",
      "#aiDifficulty",
      "select[name='difficulty']"
    );

  if (!difficulty) {
    return 3;
  }

  const value =
    Number(
      difficulty.value
    );

  if (
    !Number.isFinite(value)
  ) {
    return 3;
  }

  return Math.max(
    1,
    Math.min(
      5,
      Math.floor(value)
    )
  );
}


/*
 * Lv1 = 0.2
 * Lv2 = 0.4
 * Lv3 = 0.6
 * Lv4 = 0.8
 * Lv5 = 1.0
 */
function getDifficultyStrength() {
  return getDifficulty() / 5;
}


/* =========================================================
   AI 차례
========================================================= */

async function runAITurn() {
  if (aiThinking) {
    return;
  }

  if (!gameStarted || !game) {
    return;
  }

  if (game.finished) {
    return;
  }

  if (gameMode !== "ai") {
    return;
  }

  if (
    game.turnPlayer !== aiIndex
  ) {
    return;
  }


  aiThinking = true;

  updateGameUI();

  showMessage(
    "AI가 생각 중입니다..."
  );


  /*
   * UI 렌더링 후 계산
   */
  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        120
      )
  );


  try {
    const strength =
      getDifficultyStrength();

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
          strength >= 0.8
            ? 0.65
            : 0.50
      });


    /*
     * 첫 수 안전성 최종 확인
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
        word = null;
      }
    }


    /*
     * 첫 수에서 혹시라도 잘못된 후보가
     * 선택되었으면 안전 후보에서 다시 선택
     */
    if (
      firstTurn &&
      !word
    ) {
      const safe =
        getCandidatesFromChar(
          game.startChar,
          game.usedWords,
          WORDS,
          getDueumMap()
        )
          .map(candidate =>
            analyzeWord(
              candidate,
              game.usedWords,
              WORDS,
              ATTACK_DEPTH,
              getDueumMap()
            )
          )
          .filter(
            info =>
              !info.oneShot &&
              !info.winningAttack
          );


      if (safe.length) {
        safe.sort(
          (a, b) =>
            b.nextCount -
            a.nextCount
        );

        /*
         * 난이도가 높아도 첫 턴에는
         * 공격 단어를 사용하지 않음.
         */
        const top =
          safe.slice(
            0,
            Math.min(
              10,
              safe.length
            )
          );

        word =
          top[
            Math.floor(
              Math.random() *
              top.length
            )
          ].word;
      }
    }


    /*
     * AI가 낼 수 있는 단어 없음
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
     * 실제 엔진으로 최종 검증
     */
    const result =
      playWord(
        game,
        word,
        WORDS,
        getDueumMap(),
        ATTACK_DEPTH
      );


    /*
     * 혹시 실패하면 후보를 다시 검색
     */
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
        const candidate of
        retryCandidates
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


      if (!retryWord) {
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


      const retryResult =
        playWord(
          game,
          retryWord,
          WORDS,
          getDueumMap(),
          ATTACK_DEPTH
        );


      if (!retryResult.ok) {
        showMessage(
          "AI가 단어를 선택하지 못했습니다."
        );

        return;
      }
    }


    updateGameUI();
    renderHistory();


    if (game.finished) {
      showMessage(
        game.winner === playerIndex
          ? "승리했습니다!"
          : "AI가 승리했습니다!"
      );

      return;
    }


    showMessage(
      "내 차례입니다."
    );

  } finally {
    aiThinking =
      false;

    updateGameUI();
  }
}


/* =========================================================
   Socket.IO
========================================================= */

function getSocketURL() {
  /*
   * 기본값은 현재 페이지 서버.
   *
   * 별도의 서버 주소가 필요하면 HTML에서
   * window.WORDGAME_SERVER_URL을 지정하면 된다.
   */
  if (
    typeof window !== "undefined" &&
    window.WORDGAME_SERVER_URL
  ) {
    return window.WORDGAME_SERVER_URL;
  }

  return undefined;
}


function initializeSocket() {
  /*
   * Socket.IO가 HTML에 로드되지 않았으면
   * 온라인 기능만 비활성 상태로 둔다.
   */
  if (
    typeof io !== "function"
  ) {
    socketConnected = false;

    return null;
  }


  if (socket) {
    return socket;
  }


  const url =
    getSocketURL();


  socket =
    url
      ? io(url, {
          transports: [
            "websocket",
            "polling"
          ]
        })
      : io({
          transports: [
            "websocket",
            "polling"
          ]
        });


  bindSocketEvents();

  return socket;
}


/* =========================================================
   Socket 이벤트
========================================================= */

function bindSocketEvents() {
  if (
    !socket ||
    onlineEventBound
  ) {
    return;
  }

  onlineEventBound = true;


  socket.on(
    "connect",
    () => {
      socketConnected = true;

      onlinePlayerId =
        socket.id;

      showMessage(
        "서버에 연결되었습니다."
      );

      updateGameUI();

      /*
       * 방 ID가 이미 있으면 재접속 시도
       */
      if (onlineRoomId) {
        socket.emit(
          "room:rejoin",
          {
            roomId:
              onlineRoomId,

            playerId:
              onlinePlayerId
          }
        );
      }
    }
  );


  socket.on(
    "disconnect",
    () => {
      socketConnected = false;
      onlineReady = false;

      updateGameUI();

      if (
        gameMode === "online"
      ) {
        showMessage(
          "서버와 연결이 끊어졌습니다."
        );
      }
    }
  );


  socket.on(
    "connect_error",
    error => {
      console.error(
        "Socket.IO 연결 오류:",
        error
      );

      socketConnected = false;

      if (
        gameMode === "online"
      ) {
        showMessage(
          "온라인 서버에 연결할 수 없습니다."
        );
      }
    }
  );


  /*
   * 방 생성
   */
  socket.on(
    "room:created",
    data => {
      handleOnlineRoomData(
        data
      );

      onlineHost = true;

      showMessage(
        "방이 생성되었습니다. 다른 플레이어를 기다리는 중입니다."
      );
    }
  );


  /*
   * 방 참가
   */
  socket.on(
    "room:joined",
    data => {
      handleOnlineRoomData(
        data
      );

      showMessage(
        "방에 참가했습니다."
      );
    }
  );


  /*
   * 방 상태
   */
  socket.on(
    "room:update",
    data => {
      handleOnlineRoomData(
        data
      );
    }
  );


  socket.on(
    "room:state",
    data => {
      handleOnlineRoomData(
        data
      );
    }
  );


  /*
   * 게임 시작
   */
  socket.on(
    "game:start",
    data => {
      handleOnlineGameState(
        data
      );
    }
  );


  /*
   * 게임 상태
   */
  socket.on(
    "game:state",
    data => {
      handleOnlineGameState(
        data
      );
    }
  );


  socket.on(
    "game:update",
    data => {
      handleOnlineGameState(
        data
      );
    }
  );


  /*
   * 단어 등록 결과
   */
  socket.on(
    "word:played",
    data => {
      handleOnlineGameState(
        data
      );
    }
  );


  socket.on(
    "word:accepted",
    data => {
      if (
        data?.state
      ) {
        handleOnlineGameState(
          data.state
        );
      } else {
        handleOnlineGameState(
          data
        );
      }
    }
  );


  /*
   * 오류
   */
  socket.on(
    "game:error",
    data => {
      const message =
        data?.message ||
        data?.reason ||
        "온라인 게임 오류가 발생했습니다.";

      showMessage(
        message
      );
    }
  );


  socket.on(
    "word:error",
    data => {
      showMessage(
        data?.message ||
        data?.reason ||
        "단어를 사용할 수 없습니다."
      );
    }
  );


  socket.on(
    "room:error",
    data => {
      showMessage(
        data?.message ||
        data?.reason ||
        "방 오류가 발생했습니다."
      );
    }
  );


  /*
   * 플레이어 퇴장
   */
  socket.on(
    "player:left",
    data => {
      handleOnlineRoomData(
        data
      );

      showMessage(
        data?.message ||
        "플레이어가 나갔습니다."
      );
    }
  );


  socket.on(
    "room:left",
    data => {
      handleOnlineRoomData(
        data
      );

      showMessage(
        "방에서 나왔습니다."
      );
    }
  );
}


/* =========================================================
   온라인 방 데이터
========================================================= */

function handleOnlineRoomData(data) {
  if (!data) {
    return;
  }


  if (
    data.roomId ||
    data.roomID ||
    data.id
  ) {
    onlineRoomId =
      data.roomId ||
      data.roomID ||
      data.id;
  }


  if (
    Array.isArray(
      data.players
    )
  ) {
    onlinePlayers =
      data.players.map(
        (player, index) => ({
          ...player,
          index:
            Number.isInteger(
              player?.index
            )
              ? player.index
              : index
        })
      );
  }


  /*
   * 서버가 playerIndex를 주는 경우
   */
  if (
    Number.isInteger(
      data.playerIndex
    )
  ) {
    playerIndex =
      data.playerIndex;
  }


  if (
    Number.isInteger(
      data.index
    ) &&
    data.playerIndex == null
  ) {
    playerIndex =
      data.index;
  }


  if (
    typeof data.host ===
    "boolean"
  ) {
    onlineHost =
      data.host;
  }


  if (
    data.state
  ) {
    handleOnlineGameState(
      data.state
    );
  } else if (
    data.game
  ) {
    handleOnlineGameState(
      data.game
    );
  }


  onlineReady =
    onlinePlayers.length >= 2;


  updateGameUI();
}


/* =========================================================
   온라인 게임 상태
========================================================= */

function handleOnlineGameState(data) {
  if (!data) {
    return;
  }


  /*
   * state 내부에 실제 상태가 있는 경우
   */
  if (
    data.state &&
    typeof data.state === "object"
  ) {
    data =
      data.state;
  }


  if (
    data.game &&
    typeof data.game === "object"
  ) {
    /*
     * players 정보는 바깥에서도 가져옴
     */
    if (
      Array.isArray(
        data.players
      )
    ) {
      onlinePlayers =
        data.players;
    }

    data =
      data.game;
  }


  if (
    Array.isArray(
      data.players
    )
  ) {
    onlinePlayers =
      data.players;
  }


  if (
    Number.isInteger(
      data.playerIndex
    )
  ) {
    playerIndex =
      data.playerIndex;
  }


  if (
    data.roomId
  ) {
    onlineRoomId =
      data.roomId;
  }


  const playerCount =
    Math.max(
      2,
      Number(
        data.playerCount ||
        onlinePlayers.length ||
        2
      )
    );


  /*
   * 새 게임 객체 생성
   */
  if (!game) {
    game =
      createGame({
        startChar:
          normalizeWord(
            data.startChar ||
            ""
          ),

        startPlayer:
          Number.isInteger(
            data.turnPlayer
          )
            ? data.turnPlayer
            : 0,

        playerCount
      });
  }


  /*
   * 서버 상태를 그대로 적용
   */
  game.startChar =
    normalizeWord(
      data.startChar ||
      game.startChar ||
      ""
    );


  game.currentWord =
    data.currentWord ??
    null;


  if (
    Number.isInteger(
      data.turnPlayer
    )
  ) {
    game.turnPlayer =
      data.turnPlayer;
  }


  game.playerCount =
    playerCount;


  game.finished =
    Boolean(
      data.finished
    );


  game.winner =
    data.winner ??
    null;


  game.loser =
    data.loser ??
    null;


  /*
   * history
   */
  if (
    Array.isArray(
      data.history
    )
  ) {
    game.history =
      data.history.map(
        (item, index) => ({
          word:
            normalizeWord(
              item.word ||
              ""
            ),

          player:
            Number.isInteger(
              item.player
            )
              ? item.player
              : 0,

          turn:
            Number.isInteger(
              item.turn
            )
              ? item.turn
              : index + 1,

          depth:
            item.depth != null
              ? Number(
                  item.depth
                )
              : getAttackDepth(
                  item.word
                )
        })
      );
  }


  /*
   * usedWords는 history에서 재구축.
   */
  game.usedWords =
    new Set(
      game.history
        .map(
          item =>
            normalizeWord(
              item.word
            )
        )
        .filter(Boolean)
    );


  gameStarted =
    true;

  onlineReady =
    onlinePlayers.length >= 2;


  updateGameUI();
  renderHistory();


  if (
    game.finished
  ) {
    if (
      game.winner ===
      playerIndex
    ) {
      showMessage(
        "승리했습니다!"
      );
    } else {
      showMessage(
        `${getPlayerName(game.winner)} 승리`
      );
    }

    return;
  }


  if (
    onlinePlayers.length < 2
  ) {
    showMessage(
      "플레이어가 2명 이상 모이면 게임을 시작합니다."
    );

    return;
  }


  if (
    game.turnPlayer ===
    playerIndex
  ) {
    showMessage(
      "내 차례입니다."
    );
  } else {
    showMessage(
      `${getPlayerName(game.turnPlayer)} 차례입니다.`
    );
  }
}


/* =========================================================
   온라인 방 생성
========================================================= */

function createOnlineRoom() {
  if (!socket) {
    initializeSocket();
  }

  if (
    !socket ||
    !socketConnected
  ) {
    showMessage(
      "온라인 서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  const roomInput =
    findElement(
      "#roomId",
      "#roomCode",
      "#roomInput",
      "input[name='room']"
    );


  const roomId =
    normalizeWord(
      roomInput?.value ||
      ""
    );


  const playerName =
    getPlayerNameFromUI();


  onlineRoomId =
    roomId ||
    null;


  socket.emit(
    "room:create",
    {
      roomId:
        roomId || undefined,

      name:
        playerName
    }
  );


  showMessage(
    "방을 생성하는 중입니다..."
  );

  return true;
}


/* =========================================================
   온라인 방 참가
========================================================= */

function joinOnlineRoom(
  roomId = null
) {
  if (!socket) {
    initializeSocket();
  }

  if (
    !socket ||
    !socketConnected
  ) {
    showMessage(
      "온라인 서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  const roomInput =
    findElement(
      "#roomId",
      "#roomCode",
      "#roomInput",
      "input[name='room']"
    );


  const id =
    normalizeWord(
      roomId ||
      roomInput?.value ||
      ""
    );


  if (!id) {
    showMessage(
      "방 코드를 입력해주세요."
    );

    return false;
  }


  onlineRoomId =
    id;


  socket.emit(
    "room:join",
    {
      roomId:
        id,

      name:
        getPlayerNameFromUI()
    }
  );


  showMessage(
    "방에 참가하는 중입니다..."
  );

  return true;
}


/* =========================================================
   플레이어 이름
========================================================= */

function getPlayerNameFromUI() {
  const element =
    findElement(
      "#playerName",
      "#username",
      "#nickname",
      "input[name='playerName']",
      "input[name='nickname']"
    );

  if (!element) {
    return "플레이어";
  }

  const name =
    normalizeWord(
      element.value ||
      element.textContent ||
      ""
    );

  return (
    name ||
    "플레이어"
  );
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
      "온라인 서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  if (
    !onlineRoomId
  ) {
    showMessage(
      "먼저 방에 참가해주세요."
    );

    return false;
  }


  if (
    !onlineReady
  ) {
    showMessage(
      "플레이어가 2명 이상 모여야 시작할 수 있습니다."
    );

    return false;
  }


  if (
    game.turnPlayer !==
    playerIndex
  ) {
    showMessage(
      "지금은 다른 플레이어의 차례입니다."
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
   * 클라이언트에서 먼저 검사.
   * 최종 판정은 서버가 한다.
   */
  if (
    !hasWord(
      word,
      WORDS
    )
  ) {
    showMessage(
      "단어 목록에 없는 단어입니다."
    );

    return false;
  }


  if (
    game.usedWords.has(
      word
    )
  ) {
    showMessage(
      "이미 사용한 단어입니다."
    );

    return false;
  }


  if (
    game.currentWord &&
    !canConnect(
      game.currentWord,
      word,
      getDueumMap()
    )
  ) {
    showMessage(
      `"${game.currentWord.at(-1)}" 다음에 연결할 수 없는 단어입니다.`
    );

    return false;
  }


  /*
   * 서버에 전송
   *
   * 여러 서버 구현을 고려해
   * roomId + word + playerId를 같이 보냄.
   */
  socket.emit(
    "word:play",
    {
      roomId:
        onlineRoomId,

      word,

      playerId:
        onlinePlayerId,

      playerIndex
    }
  );


  if (input) {
    input.value = "";
  }


  showMessage(
    "단어를 서버에 전송했습니다..."
  );

  return true;
}


/* =========================================================
   온라인 게임 시작 요청
========================================================= */

function startOnlineGame() {
  if (
    !socket ||
    !socketConnected
  ) {
    showMessage(
      "온라인 서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  if (
    !onlineRoomId
  ) {
    showMessage(
      "먼저 방을 생성하거나 참가해주세요."
    );

    return false;
  }


  if (
    onlinePlayers.length < 2
  ) {
    showMessage(
      "최소 2명이 필요합니다."
    );

    return false;
  }


  socket.emit(
    "game:start",
    {
      roomId:
        onlineRoomId,

      playerCount:
        onlinePlayers.length
    }
  );


  showMessage(
    "게임 시작을 요청했습니다."
  );

  return true;
}


/* =========================================================
   온라인 새 게임
========================================================= */

function requestOnlineNewGame() {
  if (
    !socket ||
    !socketConnected
  ) {
    showMessage(
      "온라인 서버에 연결되어 있지 않습니다."
    );

    return false;
  }


  if (
    !onlineRoomId
  ) {
    showMessage(
      "방이 없습니다."
    );

    return false;
  }


  socket.emit(
    "game:restart",
    {
      roomId:
        onlineRoomId
    }
  );


  showMessage(
    "새 게임을 준비하는 중입니다..."
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
      "room:leave",
      {
        roomId:
          onlineRoomId
      }
    );
  }


  onlineRoomId =
    null;

  onlinePlayers =
    [];

  onlineReady =
    false;

  onlineHost =
    false;

  updateGameUI();

  showMessage(
    "방에서 나왔습니다."
  );
}


/* =========================================================
   이벤트 중복 등록 방지
========================================================= */

function bindOnce(
  element,
  event,
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


  const key =
    `${event}:${handler.name || "anonymous"}`;


  if (
    element.__kkeulBoundEvents.has(
      key
    )
  ) {
    return;
  }


  element.__kkeulBoundEvents.add(
    key
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
   * 입력
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
      function onWordInputKeydown(
        event
      ) {
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
   * 제출
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
      function onSubmitWordClick(
        event
      ) {
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
      function onNewGameClick(
        event
      ) {
        event.preventDefault();


        if (
          gameMode === "online"
        ) {
          requestOnlineNewGame();

          return;
        }


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
   * AI 모드
   */
  const aiMode =
    findElement(
      "#aiMode",
      "[data-mode='ai']"
    );


  if (aiMode) {
    bindOnce(
      aiMode,
      "click",
      function onAIModeClick() {
        gameMode =
          "ai";

        onlineReady =
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
      function onOnlineModeClick() {
        gameMode =
          "online";

        initializeSocket();

        startNewGame({
          mode:
            "online",

          startChar:
            getStartCharFromUI(),

          startPlayer:
            0,

          playerCount:
            Math.max(
              2,
              onlinePlayers.length
            )
        });
      }
    );
  }


  /*
   * 방 생성
   */
  const createRoomButton =
    findElement(
      "#createRoom",
      "#createRoomButton",
      "[data-create-room]"
    );


  if (createRoomButton) {
    bindOnce(
      createRoomButton,
      "click",
      function onCreateRoomClick(
        event
      ) {
        event.preventDefault();

        gameMode =
          "online";

        initializeSocket();

        createOnlineRoom();
      }
    );
  }


  /*
   * 방 참가
   */
  const joinRoomButton =
    findElement(
      "#joinRoom",
      "#joinRoomButton",
      "[data-join-room]"
    );


  if (joinRoomButton) {
    bindOnce(
      joinRoomButton,
      "click",
      function onJoinRoomClick(
        event
      ) {
        event.preventDefault();

        gameMode =
          "online";

        initializeSocket();

        joinOnlineRoom();
      }
    );
  }


  /*
   * 온라인 게임 시작
   */
  const startOnlineButton =
    findElement(
      "#startOnlineGame",
      "#onlineStartGame",
      "[data-start-online]"
    );


  if (startOnlineButton) {
    bindOnce(
      startOnlineButton,
      "click",
      function onStartOnlineClick(
        event
      ) {
        event.preventDefault();

        startOnlineGame();
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
      "[data-leave-room]"
    );


  if (leaveRoomButton) {
    bindOnce(
      leaveRoomButton,
      "click",
      function onLeaveRoomClick(
        event
      ) {
        event.preventDefault();

        leaveOnlineRoom();
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


    /*
     * 단어 목록이 없는 상태에서는
     * 절대로 AI가 임의의 단어를 생성하지 않음.
     */
    if (!WORDS.size) {
      showMessage(
        "단어 목록을 불러오지 못했습니다."
      );

      return;
    }


    setupGameEvents();


    /*
     * 온라인 Socket.IO 준비
     */
    const mode =
      getGameModeFromUI();


    if (
      mode === "online"
    ) {
      gameMode =
        "online";

      initializeSocket();
    }


    /*
     * 최초 게임 생성
     */
    if (!gameStarted) {
      startNewGame({
        mode,

        startChar:
          getStartCharFromUI(),

        /*
         * AI는 무조건 사람 선공
         */
        startPlayer:
          playerIndex
      });
    }


    updateGameUI();

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
  typeof window !== "undefined"
) {
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

  window.getAttackDepth =
    getAttackDepth;

  window.isWinningAttack =
    isWinningAttack;

  window.isLosingAttack =
    isLosingAttack;

  window.analyzeWord =
    analyzeWord;

  window.analyzeFutureRisk =
    analyzeFutureRisk;

  window.createGame =
    createGame;

  window.playWord =
    playWord;

  window.chooseBotWord =
    chooseBotWord;

  window.getPublicGameState =
    getPublicGameState;

  window.loadWordData =
    loadWordData;

  window.startNewGame =
    startNewGame;

  window.submitPlayerWord =
    submitPlayerWord;

  window.runAITurn =
    runAITurn;

  window.updateGameUI =
    updateGameUI;

  window.renderHistory =
    renderHistory;

  window.createOnlineRoom =
    createOnlineRoom;

  window.joinOnlineRoom =
    joinOnlineRoom;

  window.startOnlineGame =
    startOnlineGame;

  window.requestOnlineNewGame =
    requestOnlineNewGame;

  window.leaveOnlineRoom =
    leaveOnlineRoom;

  window.submitOnlineWord =
    submitOnlineWord;

  window.initializeSocket =
    initializeSocket;

  window.gameState =
    () => game;

  window.onlineState =
    () => ({
      socketConnected,
      onlineRoomId,
      onlinePlayerId,
      onlinePlayers,
      onlineHost,
      onlineReady,
      playerIndex
    });
}
