"use strict";

/*
 * =========================================================
 * 끝말잇기 전체 클라이언트 게임 엔진
 * =========================================================
 *
 * 핵심 수정
 *
 * 1. AI 게임 시작 시 AI가 혼자 진행하는 문제 방지
 * 2. 첫 턴 한방단어 금지
 * 3. 첫 턴 공격 단어 금지
 * 4. 두음법칙 연결 판정 강화
 * 5. 늄 → 윰 등 두음 대응 지원
 * 6. 실제 word.txt에 존재하는 단어만 사용
 * 7. 이미 사용한 단어 재사용 방지
 * 8. 입력/클릭 이벤트 중복 등록 방지
 * 9. 새 게임 초기화 안정화
 * 10. AI가 없는 단어를 만들어내지 않도록 후보 목록에서만 선택
 *
 * 서버에서 game.js를 사용하는 경우
 * 실제 판정은 서버 판정을 우선한다.
 * 이 파일은 클라이언트 UI와 AI/검증 보조용이다.
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

/*
 * 끝말잇기에서 사용하는 두음 대응표.
 *
 * 중요한 점:
 *
 * 마지막 글자 자체가 다음 단어 첫 글자로 사용되는 경우
 * 기본적으로 그대로 허용한다.
 *
 * 여기에 두음으로 바뀔 수 있는 글자를 추가한다.
 *
 * 예:
 *
 * 녀 → 여
 * 년 → 연
 * 뇨 → 요
 * 뉴 → 유
 * 니 → 이
 *
 * 려 → 여
 * 력 → 역
 * 련 → 연
 * 렬 → 열
 * 령 → 영
 * 례 → 예
 * 로 → 노
 * 론 → 논
 * 료 → 요
 * 루 → 누
 * 류 → 유
 * 륙 → 육
 * 률 → 율
 * 리 → 이
 *
 * 랴 → 야
 * 략 → 약
 * 량 → 양
 * 령 → 영
 * 래 → 내
 * 랭 → 냉
 *
 * 라 → 나
 * 락 → 낙
 * 란 → 난
 * 람 → 남
 * 랑 → 낭
 * 래 → 내
 * 랭 → 냉
 * 략 → 약
 * 량 → 양
 *
 * 실제 게임에서는 word.txt에 존재하는 단어만 허용하므로
 * 대응 자체가 있다고 해서 없는 단어가 생성되지는 않는다.
 */

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
  "례": ["례", "예"],
  "로": ["로", "노"],
  "록": ["록", "녹"],
  "론": ["론", "논"],
  "롤": ["롤", "놀"],
  "롬": ["롬", "놈"],
  "롭": ["롭", "놉"],
  "롯": ["롯", "놋"],
  "롱": ["롱", "농"],
  "뢰": ["뢰", "뇌"],
  "료": ["료", "요"],
  "루": ["루", "누"],
  "류": ["류", "유"],
  "륙": ["륙", "육"],
  "률": ["률", "율"],
  "륜": ["륜", "윤"],
  "륭": ["륭", "융"],
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
  "랭": ["랭", "냉"]
};


/*
 * 사용자 프로젝트에서 DUEUM을 별도로 제공하는 경우
 * 그 값을 우선 사용한다.
 */
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

function allowedFirstChars(lastChar, dueum = getDueumMap()) {
  if (!lastChar) {
    return [];
  }

  lastChar = normalizeWord(lastChar);

  if (!lastChar) {
    return [];
  }

  const result = new Set();

  /*
   * 원래 글자는 항상 허용
   */
  result.add(lastChar);

  /*
   * 정방향
   *
   * 녀 → 여
   * 년 → 연
   */
  const direct = dueum[lastChar];

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
   * 여 → 녀
   * 연 → 년
   *
   * 률 ↔ 율
   * 렬 ↔ 열
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
   단어 존재 검사
========================================================= */

function hasWord(word, words = WORDS) {
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

function getCandidates(
  previousWord,
  usedWords = new Set(),
  words = WORDS,
  dueum = getDueumMap()
) {
  previousWord =
    normalizeWord(previousWord);

  if (!previousWord || !words) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

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
  char =
    normalizeWord(char);

  if (!char || !words) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

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
      : new Set(usedWords || []);

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
    nextCount: next.length,
    oneShot: next.length === 0,
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

  const opponentCandidates =
    getCandidates(
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

  /*
   * 너무 많은 후보를 전부 탐색하지 않는다.
   */
  const limit =
    Math.min(
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

    /*
     * 첫 수에서는 한방단어를 매우 강하게 금지.
     */
    if (info.oneShot) {
      score -= 100000000;
    }

    /*
     * 첫 수 공격 단어도 금지.
     */
    if (info.winningAttack) {
      score -= 30000000;
    }

    /*
     * 첫 수에는 상대가 이어갈 수 있는
     * 일반적인 단어를 우선한다.
     */
    score +=
      Math.min(
        nextCount,
        30
      ) * 80;

    /*
     * 지나치게 강한 수를 피한다.
     */
    score -=
      Math.max(
        0,
        depth
      ) * 100;

    /*
     * 여기서는 아래 일반 점수보다
     * 첫 턴 정책이 우선하도록 한다.
     */
  }


  /* =======================================================
     1. 상대 선택지
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
     2. 공격 단어
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
     3. 일반 단어
  ======================================================= */

  if (!info.winningAttack) {
    score +=
      Math.min(
        nextCount,
        30
      ) * 12;
  }


  /* =======================================================
     4. 미래 위험
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
     5. 승률
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
     6. 난이도
  ======================================================= */

  if (info.winningAttack) {
    score +=
      strength *
      1800;
  }

  else {
    score +=
      (1 - strength) *
      250;
  }


  /*
   * 첫 턴에서는 정책을 마지막으로 다시 적용.
   * 위 점수 계산에서 공격/한방이 다시 올라가는 것을 방지.
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

    /*
     * 첫 턴에는 한방단어를 무조건 제외.
     */
    let safe =
      analyzed.filter(
        info =>
          !info.oneShot
      );

    /*
     * 첫 턴 공격 단어도 제외.
     */
    const nonAttack =
      safe.filter(
        info =>
          !info.winningAttack
      );

    if (nonAttack.length) {
      safe = nonAttack;
    }

    /*
     * 안전한 후보가 존재하면 그것만 사용.
     */
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


        /*
         * 첫 수에서는 안전한 단어를
         * preliminary 단계에서도 확실히 우선.
         */
        if (firstTurn) {

          if (info.oneShot) {
            base -= 100000000;
          }

          if (info.winningAttack) {
            base -= 30000000;
          }

          /*
           * 선택지가 너무 적은 단어보다
           * 적당히 이어지는 단어 선호.
           */
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


  /*
   * 나머지 후보
   */
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
   * 첫 턴에서는 최상위 안전 후보만 사용.
   *
   * 랜덤하게 공격/한방으로 튀는 문제 방지.
   */
  if (firstTurn) {

    const safe =
      scored.filter(
        item =>
          !item.info.oneShot &&
          !item.info.winningAttack
      );

    if (safe.length) {

      /*
       * 너무 넓게 랜덤 선택하지 않는다.
       */
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
     난이도별 랜덤 풀
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
   게임 생성
========================================================= */

function createGame({
  startChar = "",
  startPlayer = 0
} = {}) {

  return {

    startChar:
      normalizeWord(startChar),

    currentWord:
      null,

    turnPlayer:
      startPlayer,

    history: [],

    usedWords:
      new Set(),

    finished: false,

    winner:
      null,

    loser:
      null
  };
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


  word =
    normalizeWord(word);


  if (!word) {
    return {
      ok: false,
      reason:
        "단어를 입력해주세요."
    };
  }


  /* =======================================================
     실제 단어 목록 검사
  ======================================================= */

  if (!hasWord(word, words)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }


  /* =======================================================
     중복
  ======================================================= */

  if (
    gameState.usedWords.has(word)
  ) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /* =======================================================
     첫 단어
  ======================================================= */

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


  /* =======================================================
     연결
  ======================================================= */

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


  /* =======================================================
     등록
  ======================================================= */

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


  /* =======================================================
     다음 플레이어
  ======================================================= */

  gameState.turnPlayer =
    player === 0
      ? 1
      : 0;


  /* =======================================================
     다음 후보
  ======================================================= */

  const next =
    getCandidates(
      word,
      gameState.usedWords,
      words,
      dueum
    );


  /* =======================================================
     종료
  ======================================================= */

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
   공개 상태
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
   단어 데이터 로딩
========================================================= */

async function loadWordData() {

  /*
   * 이미 로딩된 경우 재로딩하지 않는다.
   */
  if (WORDS.size > 0) {
    return {
      words: WORDS,
      attackDepth: ATTACK_DEPTH
    };
  }


  const wordPaths = [
    "/word.txt",
    "./word.txt",
    "/data/word.txt",
    "/data/words.txt"
  ];


  let wordText = null;

  for (const path of wordPaths) {

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

    } catch (_) {
      /* 다음 경로 */
    }
  }


  if (wordText) {

    for (
      const line
      of wordText.split(/\r?\n/)
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


  for (const path of attackPaths) {

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
        of text.split(/\r?\n/)
      ) {

        const parts =
          line.trim().split(/\s+/);

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
          ATTACK_DEPTH[word] =
            depth;
        }
      }

      break;

    } catch (_) {
      /* 다음 경로 */
    }
  }


  /*
   * 전역 데이터에도 반영
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
   UI 요소 찾기
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
      /* 잘못된 selector 무시 */
    }
  }

  return null;
}


/* =========================================================
   화면 업데이트
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

    /*
     * AI 차례에는 입력을 잠시 막는다.
     * 게임이 끝났다면 다시 막는다.
     */
    const disabled =
      !gameStarted ||
      aiThinking ||
      game?.finished ||
      (
        gameMode === "ai" &&
        game?.turnPlayer !== playerIndex
      );

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

  if (turn && game) {

    if (game.finished) {

      turn.textContent =
        game.winner === playerIndex
          ? "승리!"
          : "패배!";

    } else {

      turn.textContent =
        game.turnPlayer === playerIndex
          ? "내 차례"
          : "AI 차례";
    }
  }
}


/* =========================================================
   메시지 출력
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
   기록 출력
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
        ? ` [${item.depth}]`
        : "";

    row.textContent =
      `${item.player === playerIndex ? "나" : "AI"}: ${item.word}${depth}`;

    list.appendChild(row);
  }
}


/* =========================================================
   게임 시작
========================================================= */

function startNewGame({
  mode = "ai",
  startChar = "",
  startPlayer = 0
} = {}) {

  gameMode =
    mode;

  /*
   * 가장 중요한 부분.
   *
   * AI 게임에서도 기본 시작 플레이어는
   * 반드시 사람으로 시작.
   */
  if (gameMode === "ai") {
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
    game.turnPlayer === playerIndex
      ? "내 차례입니다."
      : "AI가 생각 중입니다."
  );


  /*
   * 혹시 외부에서 startPlayer를 강제로 AI로 지정한 경우에도
   * 첫 수 한방단어 문제를 방지하면서 AI를 정상 실행.
   */
  if (
    gameMode === "ai" &&
    game.turnPlayer !== playerIndex
  ) {
    runAITurn();
  }

  return game;
}


/* =========================================================
   플레이어 단어 입력
========================================================= */

async function submitPlayerWord(
  inputWord = null
) {

  if (!gameStarted) {
    return false;
  }

  if (!game) {
    return false;
  }

  if (game.finished) {
    return false;
  }

  if (
    gameMode === "ai" &&
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
    gameMode === "ai"
      ? "AI가 생각 중입니다."
      : "다음 차례입니다."
  );


  if (
    gameMode === "ai" &&
    game.turnPlayer === aiIndex
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
    gameMode !== "ai"
  ) {
    return;
  }

  if (
    game.turnPlayer !== aiIndex
  ) {
    return;
  }


  aiThinking =
    true;

  updateGameUI();

  showMessage(
    "AI가 생각 중입니다..."
  );


  /*
   * 실제 브라우저가 화면을 먼저 갱신할 시간을 준다.
   * 바로 동기 계산을 시작하면
   * "새 게임 버튼을 눌렀는데 아무것도 안 됨"처럼
   * 보일 수 있다.
   */
  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        50
      )
  );


  try {

    /*
     * 난이도 읽기
     */
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
        Number.isFinite(value)
      ) {

        /*
         * 1~5 → 0.2~1
         */
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


    /*
     * 첫 수인지 여부
     */
    const firstTurn =
      !game.currentWord;


    /*
     * 첫 수에는 무조건 안전한 후보만 선택.
     */
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
     * 혹시라도 선택 결과가 이상하면
     * 안전 후보를 다시 찾는다.
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
     * AI가 낼 수 있는 단어가 없는 경우
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
     * 실제 게임 엔진을 통해 한 번 더 검증.
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

      /*
       * AI 후보 생성 자체가 실패한 경우.
       * 안전 후보를 다시 찾아 한 번만 재시도.
       */
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


        if (!retryResult.ok) {

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
   이벤트 중복 등록 방지
========================================================= */

const boundElements =
  new WeakSet();


function bindOnce(
  element,
  event,
  handler
) {

  if (!element) {
    return;
  }

  /*
   * 요소마다 이벤트 이름을 기록한다.
   */
  if (!element.__kkeulBoundEvents) {
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
   DOM 이벤트 연결
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
      function onWordInputKeydown(event) {

        if (
          event.key === "Enter"
        ) {

          event.preventDefault();

          submitPlayerWord();
        }
      }
    );
  }


  /*
   * 입력 버튼
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
      function onSubmitWordClick(event) {

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
      function onNewGameClick(event) {

        event.preventDefault();

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
}


/* =========================================================
   시작 글자 읽기
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
    element.value ||
    element.textContent ||
    ""
  ).at(0) || "";
}


/* =========================================================
   게임 모드 읽기
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
   초기화
========================================================= */

async function initializeGame() {

  try {

    await loadWordData();

    /*
     * 데이터가 하나도 없으면 게임을 시작하지 않는다.
     */
    if (!WORDS.size) {

      showMessage(
        "단어 목록을 불러오지 못했습니다."
      );

      return;
    }


    setupGameEvents();


    /*
     * 기존 게임 객체가 있으면
     * 이벤트만 연결하고 그대로 유지.
     */
    if (!gameStarted) {

      const mode =
        getGameModeFromUI();

      startNewGame({
        mode,

        startChar:
          getStartCharFromUI(),

        /*
         * AI 게임은 무조건 사람부터.
         */
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

  window.gameState =
    () => game;
}
