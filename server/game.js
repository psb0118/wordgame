"use strict";

/* =========================================================
   client/game.js
   끝말잇기 로컬 게임 엔진 + AI

   역할
   ---------------------------------------------------------
   - 단어 정규화
   - 두음법칙
   - 연결 가능 여부
   - 단어 후보 검색
   - 공격 단어 분석
   - AI 난이도
   - AI 단어 선택
   - 로컬 게임 상태
   - 새 게임 초기화
   - 턴 처리
   - 시간 제한
   - 목숨 2개

   주의
   ---------------------------------------------------------
   - Socket.IO 처리는 하지 않는다.
   - 온라인 방 처리는 script.js / server.js가 담당한다.
   - DOM 이벤트를 직접 등록하지 않는다.
   - HTML onclick / script.js에서 호출할 수 있도록
     window.GameEngine으로 공개한다.
========================================================= */


/* =========================================================
   데이터
========================================================= */

let WORD_SET = new Set();

let ATTACK_DEPTH = Object.create(null);

let WORD_INDEX = new Map();

let DATA_LOADED = false;


/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
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
   기본 설정
========================================================= */

const DEFAULT_OPTIONS = {
  aiLevel: 3,

  playerCount: 2,

  lives: 2,

  timeLimit: 10,

  autoStartWord: true,

  preventFirstTurnOneShot: true,

  preventImmediateAiWin: true,

  maxCandidatePool: 500,

  aiRandomness: 0.15
};


/* =========================================================
   로컬 게임 상태
========================================================= */

let localGame = null;


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

function allowedFirstChars(lastChar) {
  lastChar = normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result = new Set();

  result.add(lastChar);

  const direct = DUEUM[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      if (char) {
        result.add(char);
      }
    }
  }

  for (const [from, values] of Object.entries(DUEUM)) {
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

function canConnect(previousWord, nextWord) {
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

  return allowedFirstChars(last)
    .includes(first);
}


/* =========================================================
   단어 데이터 설정
========================================================= */

function setWordData(words, attacks = {}) {
  WORD_SET = new Set();

  if (words instanceof Set) {
    for (const word of words) {
      const normalized =
        normalizeWord(word);

      if (normalized) {
        WORD_SET.add(normalized);
      }
    }
  } else if (Array.isArray(words)) {
    for (const word of words) {
      const normalized =
        normalizeWord(word);

      if (normalized) {
        WORD_SET.add(normalized);
      }
    }
  }

  ATTACK_DEPTH =
    Object.create(null);

  if (attacks instanceof Map) {
    for (const [word, depth] of attacks.entries()) {
      const normalized =
        normalizeWord(word);

      const numericDepth =
        Number(depth);

      if (
        normalized &&
        Number.isFinite(numericDepth)
      ) {
        ATTACK_DEPTH[normalized] =
          numericDepth;
      }
    }
  } else if (
    attacks &&
    typeof attacks === "object"
  ) {
    for (const [word, depth] of Object.entries(attacks)) {
      const normalized =
        normalizeWord(word);

      const numericDepth =
        Number(depth);

      if (
        normalized &&
        Number.isFinite(numericDepth)
      ) {
        ATTACK_DEPTH[normalized] =
          numericDepth;
      }
    }
  }

  buildWordIndex();

  DATA_LOADED = true;

  return {
    words:
      WORD_SET.size,

    attackWords:
      Object.keys(ATTACK_DEPTH).length
  };
}


/* =========================================================
   첫 글자 인덱스
========================================================= */

function buildWordIndex() {
  WORD_INDEX.clear();

  for (const word of WORD_SET) {
    const first =
      word.at(0);

    if (!first) {
      continue;
    }

    if (!WORD_INDEX.has(first)) {
      WORD_INDEX.set(
        first,
        []
      );
    }

    WORD_INDEX
      .get(first)
      .push(word);
  }

  for (const bucket of WORD_INDEX.values()) {
    bucket.sort();
  }
}


/* =========================================================
   단어 존재 여부
========================================================= */

function hasWord(word) {
  return WORD_SET.has(
    normalizeWord(word)
  );
}


/* =========================================================
   공격 깊이
========================================================= */

function getAttackDepth(word) {
  word =
    normalizeWord(word);

  if (!word) {
    return null;
  }

  const depth =
    ATTACK_DEPTH[word];

  return Number.isFinite(depth)
    ? depth
    : null;
}


/* =========================================================
   공격 단어 여부
========================================================= */

function isAttackWord(word) {
  return getAttackDepth(word) !== null;
}


/* =========================================================
   후보 검색
========================================================= */

function getCandidates(
  previousWord,
  usedWords = new Set()
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

  const allowed =
    allowedFirstChars(
      previousWord.at(-1)
    );

  const result = [];

  for (const first of allowed) {
    const bucket =
      WORD_INDEX.get(first);

    if (!bucket) {
      continue;
    }

    for (const word of bucket) {
      if (used.has(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}


/* =========================================================
   첫 단어 후보
========================================================= */

function getStartCandidates(
  startChar = "",
  usedWords = new Set()
) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );

  const normalized =
    normalizeWord(startChar);

  if (!normalized) {
    return [...WORD_SET]
      .filter(word => !used.has(word));
  }

  const first =
    normalized.at(0);

  const allowed =
    allowedFirstChars(first);

  const result = [];

  for (const char of allowed) {
    const bucket =
      WORD_INDEX.get(char);

    if (!bucket) {
      continue;
    }

    for (const word of bucket) {
      if (used.has(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}


/* =========================================================
   후보 정보
========================================================= */

function candidateInfo(
  word,
  usedWords = new Set()
) {
  word =
    normalizeWord(word);

  if (!word) {
    return {
      word: "",
      depth: null,
      nextCount: 0,
      oneShot: false,
      attack: false
    };
  }

  const next =
    getCandidates(
      word,
      usedWords
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

    attack:
      depth !== null
  };
}


/* =========================================================
   승리 공격 판정
========================================================= */

function isWinningAttack(
  word,
  usedWords = new Set()
) {
  const info =
    candidateInfo(
      word,
      usedWords
    );

  return (
    info.attack &&
    info.oneShot
  );
}


/* =========================================================
   위험도
========================================================= */

function analyzeFutureRisk(
  word,
  usedWords = new Set()
) {
  const next =
    getCandidates(
      word,
      usedWords
    );

  if (next.length === 0) {
    return {
      count: 0,
      risk: 1,
      bestDepth: null
    };
  }

  let bestDepth =
    null;

  for (const candidate of next) {
    const depth =
      getAttackDepth(candidate);

    if (
      depth !== null &&
      (
        bestDepth === null ||
        depth > bestDepth
      )
    ) {
      bestDepth =
        depth;
    }
  }

  /*
   * 선택지가 적을수록 위험.
   */
  let risk =
    1 / Math.max(
      1,
      next.length
    );

  /*
   * 상대가 깊은 공격 단어를
   * 가지고 있으면 위험도 상승.
   */
  if (bestDepth !== null) {
    risk +=
      Math.min(
        0.5,
        bestDepth / 20
      );
  }

  return {
    count:
      next.length,

    risk:
      Math.min(1, risk),

    bestDepth
  };
}


/* =========================================================
   단어 점수
========================================================= */

function scoreCandidate(
  word,
  context
) {
  const {
    usedWords = new Set(),
    level = 3,
    firstTurn = false
  } = context || {};

  const info =
    candidateInfo(
      word,
      usedWords
    );

  const risk =
    analyzeFutureRisk(
      word,
      usedWords
    );

  let score = 0;

  const depth =
    info.depth;


/* ---------------------------------------------------------
   기본 선택지 수
--------------------------------------------------------- */

  /*
   * 상대에게 선택지를 많이 주는 단어는
   * 일반적으로 안전하지만 공격력은 낮다.
   */
  score +=
    Math.min(
      30,
      info.nextCount * 0.35
    );


/* ---------------------------------------------------------
   공격 단어
--------------------------------------------------------- */

  if (depth !== null) {
    /*
     * 난이도가 높을수록 공격 단어 선호.
     */
    score +=
      depth *
      (
        1 +
        level * 0.18
      );
  }


/* ---------------------------------------------------------
   원샷
--------------------------------------------------------- */

  if (info.oneShot) {
    /*
     * 즉시 승리 가능 단어.
     */
    score +=
      100 +
      level * 20;
  }


/* ---------------------------------------------------------
   위험도
--------------------------------------------------------- */

  score -=
    risk.risk *
    (
      8 +
      level * 2
    );


/* ---------------------------------------------------------
   첫 턴
--------------------------------------------------------- */

  if (firstTurn) {
    /*
     * 시작부터 상대가 아무것도 못 하는
     * 단어를 사용하는 것을 방지.
     */
    if (info.oneShot) {
      score -= 1000;
    }

    /*
     * 첫 턴에는 지나치게 강한 공격도
     * 일부 제한.
     */
    if (
      depth !== null &&
      depth >= 9
    ) {
      score -=
        15 +
        level * 4;
    }
  }


/* ---------------------------------------------------------
   난이도별 성향
--------------------------------------------------------- */

  if (level <= 1) {
    /*
     * Lv1
     * 거의 랜덤.
     */
    score *= 0.35;
  }

  else if (level === 2) {
    /*
     * Lv2
     * 약한 공격 단어 선호.
     */
    if (
      depth !== null &&
      depth <= 3
    ) {
      score += 12;
    }

    if (
      depth !== null &&
      depth >= 9
    ) {
      score -= 15;
    }
  }

  else if (level === 3) {
    /*
     * Lv3
     * 공격과 방어 균형.
     */
    score +=
      risk.count *
      0.2;
  }

  else if (level === 4) {
    /*
     * Lv4
     * 깊은 공격 단어 선호.
     */
    if (depth !== null) {
      score +=
        depth * 0.8;
    }

    score -=
      risk.risk * 5;
  }

  else {
    /*
     * Lv5
     * 가장 강한 공격 성향.
     */
    if (depth !== null) {
      score +=
        depth * 2.2;
    }

    score -=
      risk.risk * 10;

    if (info.oneShot) {
      score += 300;
    }
  }

  return score;
}


/* =========================================================
   후보 점수화
========================================================= */

function scoreCandidates(
  candidates,
  context = {}
) {
  return candidates
    .map(word => ({
      word,

      score:
        scoreCandidate(
          word,
          context
        ),

      info:
        candidateInfo(
          word,
          context.usedWords
        )
    }))
    .sort(
      (a, b) =>
        b.score -
        a.score
    );
}


/* =========================================================
   AI 후보 선택
========================================================= */

function chooseBotWord(
  options = {}
) {
  const {
    previousWord = null,
    startChar = "",
    usedWords = new Set(),
    level = 3,
    firstTurn = false
  } = options;

  let candidates;

  if (previousWord) {
    candidates =
      getCandidates(
        previousWord,
        usedWords
      );
  } else {
    candidates =
      getStartCandidates(
        startChar,
        usedWords
      );
  }

  if (!candidates.length) {
    return null;
  }


  /*
   * 첫 턴 즉사 방지.
   */
  if (
    firstTurn &&
    DEFAULT_OPTIONS
      .preventFirstTurnOneShot
  ) {
    const safe =
      candidates.filter(
        word =>
          !isWinningAttack(
            word,
            usedWords
          )
      );

    if (safe.length) {
      candidates =
        safe;
    }
  }


  /*
   * Lv1은 랜덤에 가깝게.
   */
  if (level <= 1) {
    return randomChoice(
      candidates
    );
  }


  const scored =
    scoreCandidates(
      candidates,
      {
        usedWords,
        level,
        firstTurn
      }
    );


  /*
   * 후보를 전부 완벽하게
   * 계산하는 대신 상위 후보를 사용.
   */
  const poolSize =
    level >= 5
      ? 12
      : level === 4
        ? 20
        : level === 3
          ? 30
          : 45;

  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );


  /*
   * Lv5는 최상위 후보 우선.
   */
  if (level >= 5) {
    return pool[0]?.word ||
      scored[0]?.word ||
      candidates[0];
  }


  /*
   * Lv2~4는 상위 후보 중
   * 랜덤성을 약간 부여.
   */
  const randomness =
    Math.min(
      0.4,
      Math.max(
        0,
        DEFAULT_OPTIONS.aiRandomness
      ) +
      (5 - level) * 0.04
    );

  if (
    Math.random() <
    randomness
  ) {
    const randomIndex =
      Math.floor(
        Math.random() *
        Math.min(
          pool.length,
          Math.max(
            3,
            8 - level
          )
        )
      );

    return pool[
      randomIndex
    ]?.word ||
      pool[0]?.word;
  }

  return pool[0]?.word ||
    scored[0]?.word ||
    candidates[0];
}


/* =========================================================
   랜덤 선택
========================================================= */

function randomChoice(array) {
  if (!array?.length) {
    return null;
  }

  return array[
    Math.floor(
      Math.random() *
      array.length
    )
  ];
}


/* =========================================================
   자동 시작 단어
========================================================= */

function chooseStartWord(
  options = {}
) {
  const {
    startChar = "",
    usedWords = new Set(),
    level = 3
  } = options;

  let candidates =
    getStartCandidates(
      startChar,
      usedWords
    );

  if (!candidates.length) {
    return null;
  }

  /*
   * 첫 단어에서 즉시 끝나는 단어 제거.
   */
  const safe =
    candidates.filter(
      word =>
        !isWinningAttack(
          word,
          usedWords
        )
    );

  if (safe.length) {
    candidates =
      safe;
  }

  /*
   * 너무 강한 공격 단어도
   * 시작 단어에서는 제외.
   */
  const balanced =
    candidates.filter(
      word => {
        const depth =
          getAttackDepth(word);

        return (
          depth === null ||
          depth <= 7
        );
      }
    );

  if (balanced.length) {
    candidates =
      balanced;
  }

  /*
   * 시작 단어는 지나치게 편향되지 않도록
   * 선택지가 적당히 있는 단어를 선호.
   */
  const scored =
    candidates.map(word => {
      const info =
        candidateInfo(
          word,
          usedWords
        );

      let score = 0;

      score +=
        Math.min(
          30,
          info.nextCount
        );

      if (
        info.depth !== null
      ) {
        score +=
          info.depth *
          0.4;
      }

      return {
        word,
        score
      };
    });

  scored.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const pool =
    scored.slice(
      0,
      Math.min(
        20,
        scored.length
      )
    );

  return randomChoice(
    pool
  )?.word ||
    candidates[0];
}


/* =========================================================
   단어 판정
========================================================= */

function validateWord(
  word,
  previousWord,
  usedWords = new Set(),
  startChar = ""
) {
  word =
    normalizeWord(word);

  if (!word) {
    return {
      ok: false,
      reason:
        "단어를 입력해주세요."
    };
  }

  if (!hasWord(word)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }

  if (usedWords.has(word)) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }

  if (previousWord) {
    if (
      !canConnect(
        previousWord,
        word
      )
    ) {
      const last =
        normalizeWord(
          previousWord
        ).at(-1);

      return {
        ok: false,

        reason:
          `"${last}" 다음에 연결할 수 없는 단어입니다.`,

        allowed:
          allowedFirstChars(
            last
          )
      };
    }
  } else if (startChar) {
    const allowed =
      allowedFirstChars(
        startChar
      );

    if (
      !allowed.includes(
        word.at(0)
      )
    ) {
      return {
        ok: false,

        reason:
          `"${startChar}"으로 시작할 수 없는 단어입니다.`,

        allowed
      };
    }
  }

  return {
    ok: true,

    word,

    depth:
      getAttackDepth(word)
  };
}


/* =========================================================
   게임 상태 생성
========================================================= */

function createGameState(
  options = {}
) {
  const settings = {
    ...DEFAULT_OPTIONS,
    ...options
  };

  const playerCount =
    Math.max(
      1,
      Number(settings.playerCount) || 2
    );

  const lives =
    Math.max(
      1,
      Number(settings.lives) || 2
    );

  const timeLimit =
    Math.max(
      1,
      Number(settings.timeLimit) || 10
    );

  const aiLevel =
    Math.min(
      5,
      Math.max(
        1,
        Number(settings.aiLevel) || 3
      )
    );

  return {
    started: false,

    finished: false,

    winner: null,

    loser: null,

    currentWord: null,

    startChar:
      normalizeWord(
        settings.startChar
      ).at(0) || "",

    turnPlayer: 0,

    turnNumber: 0,

    players:
      Array.from(
        {
          length:
            playerCount
        },
        (_, index) => ({
          playerIndex:
            index,

          nickname:
            index === 0
              ? "플레이어"
              : `플레이어 ${index + 1}`,

          isAI:
            index !== 0,

          lives
        })
      ),

    usedWords:
      new Set(),

    history: [],

    settings: {
      ...settings,

      playerCount,

      lives,

      timeLimit,

      aiLevel
    },

    timeRemaining:
      timeLimit,

    turnStartedAt:
      null
  };
}


/* =========================================================
   게임 시작
========================================================= */

function startGame(
  options = {}
) {
  const state =
    createGameState(
      options
    );

  localGame =
    state;

  state.started =
    true;

  /*
   * 자동 시작 단어.
   */
  if (
    state.settings.autoStartWord !== false
  ) {
    const startWord =
      chooseStartWord({
        startChar:
          state.startChar,

        usedWords:
          state.usedWords,

        level:
          state.settings.aiLevel
      });

    if (startWord) {
      addWordToState(
        state,
        startWord,
        0
      );

      /*
       * 시작 단어를 플레이어 0이
       * 자동으로 낸 것으로 처리하지 않고
       * AI/게임 시작용 단어로만 기록.
       *
       * 실제 첫 턴은 플레이어 0.
       */
      state.turnPlayer =
        0;

      state.timeRemaining =
        state.settings.timeLimit;

      state.turnStartedAt =
        Date.now();
    }
  }

  return getPublicGameState(
    state
  );
}


/* =========================================================
   게임 상태에 단어 추가
========================================================= */

function addWordToState(
  state,
  word,
  playerIndex
) {
  word =
    normalizeWord(word);

  const depth =
    getAttackDepth(word);

  state.currentWord =
    word;

  state.usedWords.add(
    word
  );

  state.turnNumber +=
    1;

  state.history.push({
    word,

    player:
      playerIndex,

    turn:
      state.turnNumber,

    depth
  });
}


/* =========================================================
   다음 턴
========================================================= */

function nextTurn(state) {
  if (!state) {
    return null;
  }

  state.turnPlayer =
    (
      state.turnPlayer + 1
    ) %
    state.players.length;

  state.timeRemaining =
    state.settings.timeLimit;

  state.turnStartedAt =
    Date.now();

  return state.turnPlayer;
}


/* =========================================================
   현재 플레이어
========================================================= */

function getCurrentPlayer(state) {
  if (!state) {
    return null;
  }

  return state.players[
    state.turnPlayer
  ] || null;
}


/* =========================================================
   게임 종료 판정
========================================================= */

function checkGameOver(
  state,
  playerIndex
) {
  if (!state) {
    return false;
  }

  const next =
    getCandidates(
      state.currentWord,
      state.usedWords
    );

  if (next.length > 0) {
    return false;
  }

  state.finished =
    true;

  state.winner =
    playerIndex;

  state.loser =
    findNextPlayer(
      state,
      playerIndex
    );

  return true;
}


/* =========================================================
   다음 플레이어 찾기
========================================================= */

function findNextPlayer(
  state,
  playerIndex
) {
  if (
    !state ||
    !state.players.length
  ) {
    return null;
  }

  return (
    state.players.find(
      player =>
        player.playerIndex !==
        playerIndex
    )?.playerIndex ??
    null
  );
}


/* =========================================================
   단어 제출
========================================================= */

function submitLocalWord(
  word,
  playerIndex = 0
) {
  if (!localGame) {
    return {
      ok: false,

      reason:
        "게임이 시작되지 않았습니다."
    };
  }

  const state =
    localGame;

  if (state.finished) {
    return {
      ok: false,

      reason:
        "이미 종료된 게임입니다."
    };
  }

  if (!state.started) {
    return {
      ok: false,

      reason:
        "게임이 시작되지 않았습니다."
    };
  }

  if (
    state.turnPlayer !==
    playerIndex
  ) {
    return {
      ok: false,

      reason:
        "지금은 당신의 차례가 아닙니다."
    };
  }

  const result =
    validateWord(
      word,

      state.currentWord,

      state.usedWords,

      state.currentWord
        ? ""
        : state.startChar
    );

  if (!result.ok) {
    return result;
  }

  addWordToState(
    state,
    result.word,
    playerIndex
  );

  const ended =
    checkGameOver(
      state,
      playerIndex
    );

  if (!ended) {
    nextTurn(state);
  }

  return {
    ok: true,

    word:
      result.word,

    depth:
      result.depth,

    finished:
      state.finished,

    winner:
      state.winner,

    loser:
      state.loser,

    nextTurn:
      state.turnPlayer,

    nextCount:
      state.finished
        ? 0
        : getCandidates(
            result.word,
            state.usedWords
          ).length,

    state:
      getPublicGameState(
        state
      )
  };
}


/* =========================================================
   실패 처리
========================================================= */

function failTurn(
  playerIndex = 0,
  reason = "입력 시간 초과"
) {
  if (!localGame) {
    return {
      ok: false,

      reason:
        "게임이 시작되지 않았습니다."
    };
  }

  const state =
    localGame;

  const player =
    state.players.find(
      p =>
        p.playerIndex ===
        playerIndex
    );

  if (!player) {
    return {
      ok: false,

      reason:
        "플레이어를 찾을 수 없습니다."
    };
  }

  if (state.finished) {
    return {
      ok: false,

      reason:
        "이미 종료된 게임입니다."
    };
  }

  if (
    state.turnPlayer !==
    playerIndex
  ) {
    return {
      ok: false,

      reason:
        "현재 턴의 플레이어가 아닙니다."
    };
  }

  player.lives =
    Math.max(
      0,
      player.lives - 1
    );

  /*
   * 목숨이 모두 없어지면
   * 해당 플레이어 패배.
   */
  if (player.lives <= 0) {
    state.finished =
      true;

    state.loser =
      playerIndex;

    state.winner =
      findNextPlayer(
        state,
        playerIndex
      );

    return {
      ok: true,

      failed: true,

      reason,

      lives:
        player.lives,

      finished:
        true,

      winner:
        state.winner,

      loser:
        state.loser,

      state:
        getPublicGameState(
          state
        )
    };
  }

  /*
   * 목숨이 남아 있으면
   * 다음 턴으로 넘어간다.
   */
  nextTurn(state);

  return {
    ok: true,

    failed: true,

    reason,

    lives:
      player.lives,

    finished:
      false,

    nextTurn:
      state.turnPlayer,

    state:
      getPublicGameState(
        state
      )
  };
}


/* =========================================================
   시간 업데이트
========================================================= */

function updateTimer(
  now = Date.now()
) {
  if (!localGame) {
    return null;
  }

  const state =
    localGame;

  if (
    !state.started ||
    state.finished ||
    !state.turnStartedAt
  ) {
    return state.timeRemaining;
  }

  const elapsed =
    Math.floor(
      (
        now -
        state.turnStartedAt
      ) / 1000
    );

  const remaining =
    Math.max(
      0,
      state.settings.timeLimit -
      elapsed
    );

  state.timeRemaining =
    remaining;

  if (remaining <= 0) {
    failTurn(
      state.turnPlayer,
      "시간이 초과되었습니다."
    );
  }

  return state.timeRemaining;
}


/* =========================================================
   AI 턴
========================================================= */

function playAITurn() {
  if (!localGame) {
    return {
      ok: false,

      reason:
        "게임이 시작되지 않았습니다."
    };
  }

  const state =
    localGame;

  if (state.finished) {
    return {
      ok: false,

      reason:
        "게임이 이미 종료되었습니다."
    };
  }

  const player =
    getCurrentPlayer(state);

  if (!player?.isAI) {
    return {
      ok: false,

      reason:
        "현재 턴은 AI가 아닙니다."
    };
  }

  const firstTurn =
    !state.currentWord;

  const word =
    chooseBotWord({
      previousWord:
        state.currentWord,

      startChar:
        state.startChar,

      usedWords:
        state.usedWords,

      level:
        state.settings.aiLevel,

      firstTurn
    });

  if (!word) {
    state.finished =
      true;

    state.loser =
      player.playerIndex;

    state.winner =
      findNextPlayer(
        state,
        player.playerIndex
      );

    return {
      ok: true,

      finished: true,

      winner:
        state.winner,

      loser:
        state.loser,

      state:
        getPublicGameState(
          state
        )
    };
  }

  return submitLocalWord(
    word,
    player.playerIndex
  );
}


/* =========================================================
   새 게임
========================================================= */

function restartGame(
  options = {}
) {
  return startGame({
    ...(localGame?.settings || {}),
    ...options
  });
}


/* =========================================================
   현재 상태
========================================================= */

function getPublicGameState(
  state = localGame
) {
  if (!state) {
    return null;
  }

  return {
    started:
      state.started,

    finished:
      state.finished,

    winner:
      state.winner,

    loser:
      state.loser,

    currentWord:
      state.currentWord,

    startChar:
      state.startChar,

    turnPlayer:
      state.turnPlayer,

    turnNumber:
      state.turnNumber,

    timeRemaining:
      state.timeRemaining,

    players:
      state.players.map(
        player => ({
          playerIndex:
            player.playerIndex,

          nickname:
            player.nickname,

          isAI:
            player.isAI,

          lives:
            player.lives
        })
      ),

    history:
      state.history.map(
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

    playerCount:
      state.players.length,

    usedCount:
      state.usedWords.size,

    settings: {
      ...state.settings
    }
  };
}


/* =========================================================
   AI 설정 변경
========================================================= */

function setAILevel(level) {
  const numeric =
    Math.min(
      5,
      Math.max(
        1,
        Number(level) || 1
      )
    );

  if (localGame) {
    localGame.settings.aiLevel =
      numeric;
  }

  return numeric;
}


/* =========================================================
   플레이어 수 설정
========================================================= */

function setPlayerCount(count) {
  const numeric =
    Math.max(
      1,
      Number(count) || 2
    );

  if (localGame) {
    localGame.settings.playerCount =
      numeric;
  }

  return numeric;
}


/* =========================================================
   플레이어 목숨 조회
========================================================= */

function getPlayerLives(
  playerIndex = 0
) {
  if (!localGame) {
    return 0;
  }

  return (
    localGame.players.find(
      player =>
        player.playerIndex ===
        playerIndex
    )?.lives ??
    0
  );
}


/* =========================================================
   데이터 상태
========================================================= */

function isDataLoaded() {
  return DATA_LOADED;
}


/* =========================================================
   통계
========================================================= */

const AI_STATS = {
  games: 0,

  wins: 0,

  losses: 0,

  draws: 0
};


function recordAIGameResult(
  winner,
  humanIndex = 0
) {
  AI_STATS.games += 1;

  if (
    winner ===
    humanIndex
  ) {
    AI_STATS.losses += 1;
  } else if (
    winner === null ||
    winner === undefined
  ) {
    AI_STATS.draws += 1;
  } else {
    AI_STATS.wins += 1;
  }

  return getAIStats();
}


function getAIStats() {
  const games =
    AI_STATS.games;

  return {
    games,

    wins:
      AI_STATS.wins,

    losses:
      AI_STATS.losses,

    draws:
      AI_STATS.draws,

    winRate:
      games
        ? (
            AI_STATS.wins /
            games *
            100
          )
        : 0
  };
}


/* =========================================================
   디버그 정보
========================================================= */

function getDebugInfo() {
  return {
    dataLoaded:
      DATA_LOADED,

    wordCount:
      WORD_SET.size,

    attackCount:
      Object.keys(
        ATTACK_DEPTH
      ).length,

    indexSize:
      WORD_INDEX.size,

    game:
      getPublicGameState(),

    aiStats:
      getAIStats()
  };
}


/* =========================================================
   공개 API
========================================================= */

window.GameEngine = {
  /* 데이터 */
  setWordData,
  isDataLoaded,

  /* 기본 */
  normalizeWord,
  allowedFirstChars,
  canConnect,
  hasWord,

  /* 후보 */
  getCandidates,
  getStartCandidates,
  candidateInfo,
  getAttackDepth,
  isAttackWord,
  isWinningAttack,
  analyzeFutureRisk,

  /* AI */
  scoreCandidate,
  scoreCandidates,
  chooseBotWord,
  chooseStartWord,
  setAILevel,

  /* 게임 */
  createGameState,
  startGame,
  restartGame,
  submitLocalWord,
  failTurn,
  updateTimer,
  playAITurn,

  /* 상태 */
  getCurrentPlayer,
  getPlayerLives,
  getPublicGameState,

  /* 설정 */
  setPlayerCount,

  /* 통계 */
  recordAIGameResult,
  getAIStats,

  /* 디버그 */
  getDebugInfo
};


/* =========================================================
   기존 코드 호환용 전역 함수
========================================================= */

window.normalizeWord =
  normalizeWord;

window.allowedFirstChars =
  allowedFirstChars;

window.canConnect =
  canConnect;

window.getCandidates =
  getCandidates;

window.getAttackDepth =
  getAttackDepth;

window.isWinningAttack =
  isWinningAttack;

window.chooseBotWord =
  chooseBotWord;

window.chooseStartWord =
  chooseStartWord;


/* =========================================================
   초기 로그
========================================================= */

console.log(
  "client/game.js 로드 완료"
);

console.log(
  "GameEngine 준비 완료"
);
