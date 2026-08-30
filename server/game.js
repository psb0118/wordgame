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
/*

=========================================================

/* =========================================================
   데이터
========================================================= */
끝말잇기 공통 게임 엔진

let WORD_SET = new Set();
=========================================================

let ATTACK_DEPTH = Object.create(null);

let WORD_INDEX = new Map();

let DATA_LOADED = false;
사용 데이터


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
word.txt

실제 사용 가능한 전체 단어

/* =========================================================
   기본 설정
========================================================= */

const DEFAULT_OPTIONS = {
  aiLevel: 3,

  playerCount: 2,
attack.txt

  lives: 2,
공격 단어 + 공격 깊이

  timeLimit: 10,

  autoStartWord: true,

  preventFirstTurnOneShot: true,
예:

  preventImmediateAiWin: true,

  maxCandidatePool: 500,

  aiRandomness: 0.15
};
가녘 1

가마깥 3

가겍 5

/* =========================================================
   로컬 게임 상태
========================================================= */

let localGame = null;

=========================================================
*/

/* =========================================================
   정규화
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
두음법칙
========================================================= */

function allowedFirstChars(lastChar) {
  lastChar = normalizeWord(lastChar);
function allowedFirstChars(lastChar, dueum = {}) {
if (!lastChar) {
return [];
}

  if (!lastChar) {
    return [];
  }
const result = new Set();

  const result = new Set();
result.add(lastChar);

  result.add(lastChar);
/*

  const direct = DUEUM[lastChar];
정방향

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
예:

  return [...result];
}
녀 -> 여

년 -> 연
*/
const direct = dueum[lastChar];

/* =========================================================
   연결 판정
========================================================= */
if (Array.isArray(direct)) {
for (const char of direct) {
if (char) {
result.add(char);
}
}
}

function canConnect(previousWord, nextWord) {
  previousWord =
    normalizeWord(previousWord);
/*

  nextWord =
    normalizeWord(nextWord);
역방향

  if (!previousWord || !nextWord) {
    return false;
  }

  const last =
    previousWord.at(-1);

  const first =
    nextWord.at(0);
예:

  return allowedFirstChars(last)
    .includes(first);
}
여 -> 녀

연 -> 년

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
기존 프로젝트의 양방향 두음 처리와 호환.
*/
for (const [from, values] of Object.entries(dueum)) {
if (!Array.isArray(values)) {
continue;
}

  DATA_LOADED = true;
if (values.includes(lastChar)) {

  return {
    words:
      WORD_SET.size,
  result.add(from);
}

    attackWords:
      Object.keys(ATTACK_DEPTH).length
  };
}

return [...result];
}

/* =========================================================
   첫 글자 인덱스
연결 가능 여부
========================================================= */

function buildWordIndex() {
  WORD_INDEX.clear();

  for (const word of WORD_SET) {
    const first =
      word.at(0);
function canConnect(previousWord, nextWord, dueum = {}) {
previousWord = normalizeWord(previousWord);
nextWord = normalizeWord(nextWord);

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
if (!previousWord || !nextWord) {
return false;
}

const last = previousWord.at(-1);
const first = nextWord.at(0);

/* =========================================================
   단어 존재 여부
========================================================= */

function hasWord(word) {
  return WORD_SET.has(
    normalizeWord(word)
  );
return allowedFirstChars(
last,
dueum
).includes(first);
}


/* =========================================================
   공격 깊이
단어 목록 검사
========================================================= */

function getAttackDepth(word) {
  word =
    normalizeWord(word);
function hasWord(word, words) {
word = normalizeWord(word);

  if (!word) {
    return null;
  }
if (!word || !words) {
return false;
}

  const depth =
    ATTACK_DEPTH[word];
if (words instanceof Set) {
return words.has(word);
}

  return Number.isFinite(depth)
    ? depth
    : null;
if (Array.isArray(words)) {
return words.includes(word);
}

/*

/* =========================================================
   공격 단어 여부
========================================================= */
byFirst 형태의 객체도 지원.

function isAttackWord(word) {
  return getAttackDepth(word) !== null;
}


/* =========================================================
   후보 검색
========================================================= */
서버에서 데이터 구조가

function getCandidates(
  previousWord,
  usedWords = new Set()
) {
  previousWord =
    normalizeWord(previousWord);
{

  if (!previousWord) {
    return [];
  }
가: [...],

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(
          usedWords || []
        );
나: [...],

  const allowed =
    allowedFirstChars(
      previousWord.at(-1)
    );
...

  const result = [];

  for (const first of allowed) {
    const bucket =
      WORD_INDEX.get(first);
}

    if (!bucket) {
      continue;
    }
형태일 경우 사용할 수 있음.
*/
if (typeof words === "object") {
const list = words[word.at(0)];

    for (const word of bucket) {
      if (used.has(word)) {
        continue;
      }
if (Array.isArray(list)) {

      result.push(word);
    }
  }
  return list.includes(word);
}

  return result;
}

return false;
}

/* =========================================================
   첫 단어 후보
후보 검색
========================================================= */

function getStartCandidates(
  startChar = "",
  usedWords = new Set()
function getCandidates(
previousWord,
usedWords,
words,
dueum = {}
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
previousWord = normalizeWord(previousWord);

  const first =
    normalized.at(0);
if (!previousWord || !words) {
return [];
}

  const allowed =
    allowedFirstChars(first);
const used =
usedWords instanceof Set
? usedWords
: new Set(usedWords || []);

  const result = [];
const allowed = new Set(
allowedFirstChars(
previousWord.at(-1),
dueum
)
);

  for (const char of allowed) {
    const bucket =
      WORD_INDEX.get(char);
const result = [];

    if (!bucket) {
      continue;
    }
/*

    for (const word of bucket) {
      if (used.has(word)) {
        continue;
      }
words가 Set/Array이면 전체 순회.

      result.push(word);
    }
  }

  return result;

byFirst 객체라면 필요한 첫 글자만 검색.
*/
if (
!Array.isArray(words) &&
!(words instanceof Set) &&
typeof words === "object"
) {
for (const first of allowed) {
const list = words[first];

if (!Array.isArray(list)) {
continue;
}

for (const word of list) {
if (!word) {
continue;
}

/* =========================================================
   후보 정보
========================================================= */
if (used.has(word)) {
continue;
}

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
result.push(word);
}
}

  const next =
    getCandidates(
      word,
      usedWords
    );
return result;

  const depth =
    getAttackDepth(word);
}

  return {
    word,
for (const word of words) {
if (!word) {
continue;
}

    depth,
if (used.has(word)) {
  continue;
}

    nextCount:
      next.length,
if (!allowed.has(word.at(0))) {
  continue;
}

    oneShot:
      next.length === 0,
result.push(word);

    attack:
      depth !== null
  };
}

return result;
}

/* =========================================================
   승리 공격 판정
시작 글자 후보
========================================================= */

function isWinningAttack(
  word,
  usedWords = new Set()
function getCandidatesFromChar(
char,
usedWords,
words,
dueum = {}
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
if (!char || !words) {
return [];
}

const used =
usedWords instanceof Set
? usedWords
: new Set(usedWords || []);

/* =========================================================
   위험도
========================================================= */
const allowed = new Set(
allowedFirstChars(
char,
dueum
)
);

function analyzeFutureRisk(
  word,
  usedWords = new Set()
) {
  const next =
    getCandidates(
      word,
      usedWords
    );
const result = [];

  if (next.length === 0) {
    return {
      count: 0,
      risk: 1,
      bestDepth: null
    };
  }
/*

  let bestDepth =
    null;
byFirst 구조
*/
if (
!Array.isArray(words) &&
!(words instanceof Set) &&
typeof words === "object"
) {
for (const first of allowed) {
const list = words[first];

  for (const candidate of next) {
    const depth =
      getAttackDepth(candidate);
if (!Array.isArray(list)) {
continue;
}

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
for (const word of list) {
if (!word) {
continue;
}

  /*
   * 선택지가 적을수록 위험.
   */
  let risk =
    1 / Math.max(
      1,
      next.length
    );
if (used.has(word)) {
continue;
}

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
result.push(word);
}
}

  return {
    count:
      next.length,
return result;

    risk:
      Math.min(1, risk),
}

    bestDepth
  };
/*

Array / Set 구조
*/
for (const word of words) {
if (!word) {
continue;
}

if (used.has(word)) {

/* =========================================================
   단어 점수
========================================================= */
  continue;
}

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
if (!allowed.has(word.at(0))) {
  continue;
}

  const risk =
    analyzeFutureRisk(
      word,
      usedWords
    );
result.push(word);

  let score = 0;
}

  const depth =
    info.depth;
return result;
}

/* =========================================================
공격 데이터
========================================================= */

/* ---------------------------------------------------------
   기본 선택지 수
--------------------------------------------------------- */
function getAttackDepth(
word,
attackDepth = {}
) {
word = normalizeWord(word);

  /*
   * 상대에게 선택지를 많이 주는 단어는
   * 일반적으로 안전하지만 공격력은 낮다.
   */
  score +=
    Math.min(
      30,
      info.nextCount * 0.35
    );
if (!word) {
return null;
}

const value = attackDepth[word];

/* ---------------------------------------------------------
   공격 단어
--------------------------------------------------------- */
if (value == null) {
return null;
}

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
const depth = Number(value);

if (!Number.isFinite(depth)) {
return null;
}

/* ---------------------------------------------------------
   원샷
--------------------------------------------------------- */
return depth;
}

  if (info.oneShot) {
    /*
     * 즉시 승리 가능 단어.
     */
    score +=
      100 +
      level * 20;
  }
/* =========================================================
공격 단어 판정
========================================================= */

function isWinningAttack(
word,
attackDepth = {}
) {
const depth = getAttackDepth(
word,
attackDepth
);

/* ---------------------------------------------------------
   위험도
--------------------------------------------------------- */
return (
depth != null &&
depth % 2 === 1
);
}

  score -=
    risk.risk *
    (
      8 +
      level * 2
    );
function isLosingAttack(
word,
attackDepth = {}
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
/* =========================================================
후보 분석
========================================================= */

function analyzeWord(
word,
usedWords,
words,
attackDepth = {},
dueum = {}
) {
const used =
usedWords instanceof Set
? usedWords
: new Set(usedWords || []);

/* ---------------------------------------------------------
   난이도별 성향
--------------------------------------------------------- */
const nextUsed = new Set(used);

  if (level <= 1) {
    /*
     * Lv1
     * 거의 랜덤.
     */
    score *= 0.35;
  }
nextUsed.add(word);

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
const next = getCandidates(
word,
nextUsed,
words,
dueum
);

  else if (level === 3) {
    /*
     * Lv3
     * 공격과 방어 균형.
     */
    score +=
      risk.count *
      0.2;
  }
const depth = getAttackDepth(
word,
attackDepth
);

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
return {
word,

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
depth,

  return score;
}
nextCount: next.length,

oneShot:
  next.length === 0,

/* =========================================================
   후보 점수화
========================================================= */
winningAttack:
  depth != null &&
  depth % 2 === 1,

function scoreCandidates(
  candidates,
  context = {}
) {
  return candidates
    .map(word => ({
      word,
losingAttack:
  depth != null &&
  depth % 2 === 0

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
};
}


/* =========================================================
   AI 후보 선택
미래 위험 분석
========================================================= */

function chooseBotWord(
  options = {}
function analyzeFutureRisk(
info,
words,
usedWords,
dueum,
sampleLimit = 60
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
const usedAfterWord =
usedWords instanceof Set
? new Set(usedWords)
: new Set(usedWords || []);

usedAfterWord.add(info.word);

const opponentCandidates =
getCandidates(
info.word,
usedAfterWord,
words,
dueum
);

/*

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
상대가 아예 답할 수 없다면

이미 즉시 승리.
*/
if (!opponentCandidates.length) {
return {
risk: 0,
botNextCount: 0,
opponentCount: 0
};
}

  /*
   * Lv1은 랜덤에 가깝게.
   */
  if (level <= 1) {
    return randomChoice(
      candidates
    );
  }
/*

모든 후보를 탐색하면

  const scored =
    scoreCandidates(
      candidates,
      {
        usedWords,
        level,
        firstTurn
      }
    );
대규모 단어 데이터에서 느려질 수 있으므로

일부만 확인.
*/
const limit = Math.min(
opponentCandidates.length,
sampleLimit
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
let dangerous = 0;

for (let i = 0; i < limit; i++) {
const opponentWord =
opponentCandidates[i];

  /*
   * Lv5는 최상위 후보 우선.
   */
  if (level >= 5) {
    return pool[0]?.word ||
      scored[0]?.word ||
      candidates[0];
  }
const nextUsed =
  new Set(usedAfterWord);

nextUsed.add(opponentWord);

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
const botCandidates =
  getCandidates(
    opponentWord,
    nextUsed,
    words,
    dueum
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
if (!botCandidates.length) {
  dangerous++;
}

  return pool[0]?.word ||
    scored[0]?.word ||
    candidates[0];
}

return {
risk:
dangerous / limit,

/* =========================================================
   랜덤 선택
========================================================= */
botNextCount:
  limit - dangerous,

function randomChoice(array) {
  if (!array?.length) {
    return null;
  }
opponentCount:
  opponentCandidates.length

  return array[
    Math.floor(
      Math.random() *
      array.length
    )
  ];
};
}


/* =========================================================
   자동 시작 단어
AI 난이도 정책
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
/*

  if (!candidates.length) {
    return null;
  }
level 1

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
거의 랜덤

  if (safe.length) {
    candidates =
      safe;
  }
공격 단어 최대한 회피

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
level 2

  const pool =
    scored.slice(
      0,
      Math.min(
        20,
        scored.length
      )
    );
약한 공격

  return randomChoice(
    pool
  )?.word ||
    candidates[0];
}


/* =========================================================
   단어 판정
========================================================= */
level 3

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
균형형

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
level 4

    if (
      !allowed.includes(
        word.at(0)
      )
    ) {
      return {
        ok: false,
공격 적극 사용

        reason:
          `"${startChar}"으로 시작할 수 없는 단어입니다.`,

        allowed
      };
    }
  }

  return {
    ok: true,
level 5

    word,
공격 우선

    depth:
      getAttackDepth(word)
  };
}
깊은 공격 단어 우선

공격 중에는 불필요하게 양보 단어로 전환하지 않음
*/
function getDifficultyPolicy(level) {
level = Number(level);

/* =========================================================
   게임 상태 생성
========================================================= */
switch (level) {
case 1:
return {
strength: 0.20,
attackWeight: 0.20,
depthWeight: 0.15,
randomPool: 18,
futureAnalysis: 25
};

function createGameState(
  options = {}
) {
  const settings = {
    ...DEFAULT_OPTIONS,
    ...options
case 2:
  return {
    strength: 0.38,
    attackWeight: 0.55,
    depthWeight: 0.35,
    randomPool: 12,
    futureAnalysis: 40
};

  const playerCount =
    Math.max(
      1,
      Number(settings.playerCount) || 2
    );
case 3:
  return {
    strength: 0.55,
    attackWeight: 0.90,
    depthWeight: 0.65,
    randomPool: 8,
    futureAnalysis: 50
  };

  const lives =
    Math.max(
      1,
      Number(settings.lives) || 2
    );
case 4:
  return {
    strength: 0.76,
    attackWeight: 1.30,
    depthWeight: 1.00,
    randomPool: 5,
    futureAnalysis: 60
  };

  const timeLimit =
    Math.max(
      1,
      Number(settings.timeLimit) || 10
    );
case 5:
  return {
    strength: 0.95,
    attackWeight: 2.00,
    depthWeight: 1.70,
    randomPool: 3,
    futureAnalysis: 80
  };

  const aiLevel =
    Math.min(
      5,
      Math.max(
        1,
        Number(settings.aiLevel) || 3
      )
    );
default:
  return getDifficultyPolicy(3);

  return {
    started: false,
}
}

    finished: false,
/* =========================================================
후보 점수
========================================================= */

    winner: null,
function scoreBotCandidate({
info,
futureRisk,
strength = 0.50,
winBias = 0.50,
level = 3,
currentWord = null
}) {
const policy =
getDifficultyPolicy(level);

    loser: null,
let score = 0;

    currentWord: null,
const nextCount =
info.nextCount;

    startChar:
      normalizeWord(
        settings.startChar
      ).at(0) || "",
const depth =
info.depth ?? 0;

    turnPlayer: 0,
const risk =
futureRisk?.risk ?? 0;

    turnNumber: 0,
/* =======================================================
즉시 승리
======================================================= */

    players:
      Array.from(
        {
          length:
            playerCount
        },
        (_, index) => ({
          playerIndex:
            index,
if (info.oneShot) {

          nickname:
            index === 0
              ? "플레이어"
              : `플레이어 ${index + 1}`,
score += 15000;

          isAI:
            index !== 0,
/*
 * 낮은 난이도에서는 즉시 끝내는 수를
 * 일부러 덜 선택한다.
 */
score *=
  0.65 +
  strength * 0.35;

          lives
        })
      ),
}

    usedWords:
      new Set(),
/* =======================================================
상대 선택지 수
======================================================= */

    history: [],
if (nextCount === 1) {
score += 4500;
}

    settings: {
      ...settings,
else if (nextCount <= 3) {
score += 2100;
}

      playerCount,
else if (nextCount <= 7) {
score += 800;
}

      lives,
else if (nextCount <= 15) {
score += 300;
}

      timeLimit,
else {
score += 60;
}

      aiLevel
    },
/* =======================================================
공격 단어
======================================================= */

if (info.winningAttack) {

/*
 * 공격 단어 자체의 기본 가치
 */
score +=
  1000 *
  policy.attackWeight;

/*
 * 깊이가 높을수록 추가 가점
 */
score +=
  Math.min(depth, 50) *
  45 *
  policy.depthWeight;

/*
 * 높은 난이도일수록
 * 공격 단어를 훨씬 선호.
 */
score +=
  strength *
  depth *
  80;

    timeRemaining:
      timeLimit,
}

    turnStartedAt:
      null
  };
/* =======================================================
짝수 깊이
======================================================= */

if (info.losingAttack) {

/*
 * 기본적으로 좋은 공격 수로 보지 않는다.
 */
score -=
  500 +
  depth * 20;

/*
 * 낮은 난이도에서는
 * 가끔 사용할 수 있도록 너무 강하게 배제하지 않는다.
 */
if (level <= 2) {
  score += 300;
}

}

/* =========================================================
   게임 시작
========================================================= */
/* =======================================================
일반 단어
======================================================= */

function startGame(
  options = {}
if (
!info.winningAttack &&
!info.losingAttack
) {
  const state =
    createGameState(
      options
    );
score +=
Math.min(nextCount, 30) *
(level <= 2 ? 18 : 10);
}

  localGame =
    state;
/* =======================================================
미래 위험
======================================================= */

  state.started =
    true;
if (risk >= 0.80) {
score -= 5000;
}

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
else if (risk >= 0.60) {
score -= 2800;
}

  return getPublicGameState(
    state
  );
else if (risk >= 0.35) {
score -= 1100;
}

else if (risk >= 0.15) {
score -= 300;
}

/* =======================================================
승률 보정
======================================================= */

/* =========================================================
   게임 상태에 단어 추가
========================================================= */
/*

function addWordToState(
  state,
  word,
  playerIndex
) {
  word =
    normalizeWord(word);
winBias는 AI의 현재 승률.

  const depth =
    getAttackDepth(word);

  state.currentWord =
    word;

  state.usedWords.add(
    word
  );
너무 강하면 공격을 조금 완화.

  state.turnNumber +=
    1;
너무 약하면 공격을 강화.
*/

  state.history.push({
    word,
if (winBias > 0.70) {

    player:
      playerIndex,
if (info.winningAttack) {
  score -=
    (winBias - 0.70) *
    8500;
}

    turn:
      state.turnNumber,
if (info.oneShot) {
  score -=
    (winBias - 0.70) *
    6500;
}

    depth
  });
}

else if (winBias < 0.30) {

/* =========================================================
   다음 턴
========================================================= */
if (info.winningAttack) {
  score +=
    (0.30 - winBias) *
    7000;
}

function nextTurn(state) {
  if (!state) {
    return null;
  }
if (nextCount <= 3) {
  score +=
    (0.30 - winBias) *
    3000;
}

  state.turnPlayer =
    (
      state.turnPlayer + 1
    ) %
    state.players.length;
}

  state.timeRemaining =
    state.settings.timeLimit;
/* =======================================================
첫 수
======================================================= */

  state.turnStartedAt =
    Date.now();
if (!currentWord) {

  return state.turnPlayer;
/*
 * 첫 수에서 한방 공격은
 * 난이도와 관계없이 최대한 피한다.
 */
if (info.oneShot) {
  score -= 12000;
}

/*
 * attack.txt 공격 단어도
 * 첫 수에서는 기본적으로 피한다.
 */
if (info.winningAttack) {

/* =========================================================
   현재 플레이어
========================================================= */

function getCurrentPlayer(state) {
  if (!state) {
    return null;
  if (level <= 4) {
    score -= 6000;
}

  return state.players[
    state.turnPlayer
  ] || null;
  /*
   * Lv5도 첫 수부터 무조건 공격하지 않음.
   */
  else {
    score -= 2500;
  }
}


/* =========================================================
   게임 종료 판정
========================================================= */

function checkGameOver(
  state,
  playerIndex
/*
 * 일반 단어 중에서도
 * 상대에게 너무 적은 선택지만 주는 단어를
 * 첫 수에서는 조금 피한다.
 */
if (
  !info.winningAttack &&
  nextCount <= 2
) {
  if (!state) {
    return false;
  }

  const next =
    getCandidates(
      state.currentWord,
      state.usedWords
    );
  score -= 1000;
}

  if (next.length > 0) {
    return false;
  }
}

  state.finished =
    true;
/* =======================================================
Lv5 특수 정책
======================================================= */

  state.winner =
    playerIndex;
if (level === 5) {

  state.loser =
    findNextPlayer(
      state,
      playerIndex
    );
/*
 * 공격 단어가 존재하면
 * 일반 양보 단어보다 공격 단어를 강하게 우선.
 */
if (info.winningAttack) {

  return true;
  score +=
    2500 +
    depth * 120;
}


/* =========================================================
   다음 플레이어 찾기
========================================================= */

function findNextPlayer(
  state,
  playerIndex
/*
 * 공격 중 깊은 수를 계속 이어갈 수 있는 상황에서
 * 선택지가 많은 일반 단어로 갑자기 빠지는 것을 방지.
 */
if (
  currentWord &&
  info.winningAttack
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
  score +=
    depth * 100;
}

}

return score;
}

/* =========================================================
   단어 제출
봇 후보 선택
========================================================= */

function submitLocalWord(
  word,
  playerIndex = 0
) {
  if (!localGame) {
    return {
      ok: false,
function chooseBotWord({
currentWord = null,
startChar = "",
usedWords = new Set(),
words,
dueum = {},
attackDepth = {},
strength = 0.50,
winBias = 0.50,
level = 3
}) {
if (!words) {
return null;
}

      reason:
        "게임이 시작되지 않았습니다."
    };
  }
const used =
usedWords instanceof Set
? usedWords
: new Set(usedWords || []);

/* =======================================================
후보 생성
======================================================= */

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

  const state =
    localGame;
if (!candidates.length) {
return null;
}

  if (state.finished) {
    return {
      ok: false,
/* =======================================================
후보 분석
======================================================= */

const analyzed =
candidates.map(word =>
analyzeWord(
word,
used,
words,
attackDepth,
dueum
)
);

      reason:
        "이미 종료된 게임입니다."
    };
  }
/* =======================================================
첫 수 안전 처리
======================================================= */

  if (!state.started) {
    return {
      ok: false,
let usable =
analyzed;

      reason:
        "게임이 시작되지 않았습니다."
    };
  }
if (!currentWord) {

  if (
    state.turnPlayer !==
    playerIndex
  ) {
    return {
      ok: false,
const safe =
  analyzed.filter(info =>
    !info.oneShot &&
    !info.winningAttack
  );

      reason:
        "지금은 당신의 차례가 아닙니다."
    };
  }
if (safe.length) {
  usable = safe;
}

  const result =
    validateWord(
      word,
}

      state.currentWord,
/* =======================================================
1차 점수
======================================================= */

      state.usedWords,
const preliminary =
usable.map(info => {

      state.currentWord
        ? ""
        : state.startChar
    );
  let score = 0;

  if (!result.ok) {
    return result;
  /*
   * 즉시 승리
   */
  if (info.oneShot) {
    score += 15000;
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
  /*
   * 공격
   */
  if (info.winningAttack) {
    score +=
      1000 +
      (info.depth ?? 0) * 70;
}

  return {
    ok: true,
  /*
   * 상대 선택지
   */
  if (info.nextCount === 1) {
    score += 4000;
  }

    word:
      result.word,
  else if (info.nextCount <= 3) {
    score += 1800;
  }

    depth:
      result.depth,
  else {
    score +=
      Math.min(
        info.nextCount,
        30
      ) * 15;
  }

    finished:
      state.finished,
  return {
    info,
    base: score
  };
});

    winner:
      state.winner,
preliminary.sort(
(a, b) =>
b.base - a.base
);

    loser:
      state.loser,
/* =======================================================
미래 분석
======================================================= */

    nextTurn:
      state.turnPlayer,
const policy =
getDifficultyPolicy(level);

    nextCount:
      state.finished
        ? 0
        : getCandidates(
            result.word,
            state.usedWords
          ).length,
const analysisLimit =
Math.min(
preliminary.length,
policy.futureAnalysis
);

    state:
      getPublicGameState(
        state
      )
  };
}
const scored = [];

for (
let i = 0;
i < analysisLimit;
i++
) {

/* =========================================================
   실패 처리
========================================================= */
const info =
  preliminary[i].info;

function failTurn(
  playerIndex = 0,
  reason = "입력 시간 초과"
) {
  if (!localGame) {
    return {
      ok: false,
const futureRisk =
  analyzeFutureRisk(
    info,
    words,
    used,
    dueum,
    policy.futureAnalysis
  );

      reason:
        "게임이 시작되지 않았습니다."
    };
  }
const score =
  scoreBotCandidate({
    info,
    futureRisk,
    strength,
    winBias,
    level,
    currentWord
  });

  const state =
    localGame;
scored.push({
  info,
  score
});

  const player =
    state.players.find(
      p =>
        p.playerIndex ===
        playerIndex
    );
}

  if (!player) {
    return {
      ok: false,
/*

      reason:
        "플레이어를 찾을 수 없습니다."
    };
  }
나머지 후보는

  if (state.finished) {
    return {
      ok: false,
미래 분석 없이 기본 점수 사용.
*/
for (
let i = analysisLimit;
i < preliminary.length;
i++
) {

      reason:
        "이미 종료된 게임입니다."
    };
  }
const info =

  if (
    state.turnPlayer !==
    playerIndex
  ) {
    return {
      ok: false,
  preliminary[i].info;

      reason:
        "현재 턴의 플레이어가 아닙니다."
    };
  }
const score =
  scoreBotCandidate({
    info,

  player.lives =
    Math.max(
      0,
      player.lives - 1
    );
    futureRisk: {
      risk: 0.20,
      botNextCount:
        info.nextCount
    },

  /*
   * 목숨이 모두 없어지면
   * 해당 플레이어 패배.
   */
  if (player.lives <= 0) {
    state.finished =
      true;
    strength,
    winBias,
    level,
    currentWord
  });

    state.loser =
      playerIndex;
scored.push({
  info,
  score
});

    state.winner =
      findNextPlayer(
        state,
        playerIndex
      );
}

    return {
      ok: true,
if (!scored.length) {
return null;
}

      failed: true,
/* =======================================================
정렬
======================================================= */

      reason,
scored.sort(
(a, b) =>
b.score - a.score
);

      lives:
        player.lives,
/* =======================================================
선택 풀
======================================================= */

      finished:
        true,
let poolSize =
policy.randomPool;

      winner:
        state.winner,
/*

      loser:
        state.loser,
승률이 너무 높으면

      state:
        getPublicGameState(
          state
        )
    };
  }
선택 폭을 넓힌다.
*/
if (winBias > 0.65) {
poolSize += 6;
}

  /*
   * 목숨이 남아 있으면
   * 다음 턴으로 넘어간다.
   */
  nextTurn(state);
/*

  return {
    ok: true,
승률이 낮으면

    failed: true,
좋은 후보에 더 집중.
*/
if (winBias < 0.35) {
poolSize =
Math.max(
2,
poolSize - 3
);
}

    reason,
const pool =
scored.slice(
0,
Math.min(
poolSize,
scored.length
)
);

    lives:
      player.lives,
if (!pool.length) {
return null;
}

    finished:
      false,
/* =======================================================
최고 점수와 너무 차이 나는 후보 제거
======================================================= */

const bestScore =
pool[0].score;

const margin =
level === 5
? 350
: level === 4
? 550
: level === 3
? 750
: 1000;

const reasonable =
pool.filter(item =>
item.score >=
bestScore - margin
);

    nextTurn:
      state.turnPlayer,
const finalPool =
reasonable.length
? reasonable
: [pool[0]];

    state:
      getPublicGameState(
        state
      )
  };
}
/*

Lv5는 공격 후보가 있으면

/* =========================================================
   시간 업데이트
========================================================= */
공격 후보를 우선 유지.
*/
if (level === 5) {

function updateTimer(
  now = Date.now()
) {
  if (!localGame) {
    return null;
  }
const attacks =

  const state =
    localGame;
  finalPool.filter(
    item =>
      item.info.winningAttack
  );

  if (
    !state.started ||
    state.finished ||
    !state.turnStartedAt
  ) {
    return state.timeRemaining;
  }
if (attacks.length) {

  const elapsed =
    Math.floor(
      (
        now -
        state.turnStartedAt
      ) / 1000
    );
  /*
   * 깊은 공격 단어 중심.
   */
  attacks.sort(
    (a, b) =>
      (b.info.depth ?? 0) -
      (a.info.depth ?? 0)
  );

  const remaining =
    Math.max(
  /*
   * 최상위 공격 후보 몇 개 중 선택.
   */
  const attackPool =
    attacks.slice(
0,
      state.settings.timeLimit -
      elapsed
      Math.min(
        3,
        attacks.length
      )
);

  state.timeRemaining =
    remaining;
  const selected =
    attackPool[
      Math.floor(
        Math.random() *
        attackPool.length
      )
    ];

  if (remaining <= 0) {
    failTurn(
      state.turnPlayer,
      "시간이 초과되었습니다."
    );
  }
  return selected.info.word;
}

  return state.timeRemaining;
}

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
   AI 턴
게임 생성
========================================================= */

function playAITurn() {
  if (!localGame) {
    return {
      ok: false,
function createGame({
startChar = "",
startPlayer = 0
} = {}) {
return {

      reason:
        "게임이 시작되지 않았습니다."
    };
  }
startChar:
  normalizeWord(startChar).at(0) || "",

  const state =
    localGame;
currentWord:
  null,

  if (state.finished) {
    return {
      ok: false,
turnPlayer:
  startPlayer === 1
    ? 1
    : 0,

      reason:
        "게임이 이미 종료되었습니다."
    };
  }
history: [],

  const player =
    getCurrentPlayer(state);
usedWords:
  new Set(),

  if (!player?.isAI) {
    return {
      ok: false,
finished:
  false,

      reason:
        "현재 턴은 AI가 아닙니다."
    };
  }
winner:
  null,

loser:
  null

  const firstTurn =
    !state.currentWord;
};
}

  const word =
    chooseBotWord({
      previousWord:
        state.currentWord,
/* =========================================================
단어 플레이
========================================================= */

      startChar:
        state.startChar,
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

      usedWords:
        state.usedWords,
if (game.finished) {
return {
ok: false,
reason:
"이미 끝난 게임입니다."
};
}

      level:
        state.settings.aiLevel,
word =
normalizeWord(word);

      firstTurn
    });
if (!word) {
return {
ok: false,
reason:
"단어를 입력해주세요."
};
}

  if (!word) {
    state.finished =
      true;
/* =======================================================
단어 목록
======================================================= */

    state.loser =
      player.playerIndex;
if (!hasWord(word, words)) {
return {
ok: false,
reason:
"단어 목록에 없는 단어입니다."
};
}

    state.winner =
      findNextPlayer(
        state,
        player.playerIndex
      );
/* =======================================================
중복
======================================================= */

    return {
      ok: true,
if (game.usedWords.has(word)) {
return {
ok: false,
reason:
"이미 사용한 단어입니다."
};
}

      finished: true,
/* =======================================================
첫 단어
======================================================= */

      winner:
        state.winner,
if (!game.currentWord) {

      loser:
        state.loser,
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

      state:
        getPublicGameState(
          state
        )
    };
  }
    reason:
      `"${game.startChar}"으로 시작하는 단어가 아닙니다.`,

  return submitLocalWord(
    word,
    player.playerIndex
  );
    allowed:
      allowedFirstChars(
        game.startChar,
        dueum
      )
  };
}

}

/* =========================================================
   새 게임
========================================================= */

function restartGame(
  options = {}
/* =======================================================
연결
======================================================= */

if (
game.currentWord &&
!canConnect(
game.currentWord,
word,
dueum
)
) {
  return startGame({
    ...(localGame?.settings || {}),
    ...options
  });
}

const last =
  game.currentWord.at(-1);

/* =========================================================
   현재 상태
========================================================= */
return {
  ok: false,

function getPublicGameState(
  state = localGame
) {
  if (!state) {
    return null;
  }
  reason:
    `"${last}" 다음에 연결할 수 없는 단어입니다.`,

  return {
    started:
      state.started,
  allowed:
    allowedFirstChars(
      last,
      dueum
    )
};

    finished:
      state.finished,
}

    winner:
      state.winner,
/* =======================================================
현재 플레이어
======================================================= */

    loser:
      state.loser,
const player =
game.turnPlayer;

    currentWord:
      state.currentWord,
/* =======================================================
등록
======================================================= */

    startChar:
      state.startChar,
game.currentWord =
word;

    turnPlayer:
      state.turnPlayer,
game.usedWords.add(
word
);

    turnNumber:
      state.turnNumber,
game.history.push({

    timeRemaining:
      state.timeRemaining,
word,

    players:
      state.players.map(
        player => ({
          playerIndex:
            player.playerIndex,
player,

          nickname:
            player.nickname,
turn:
  game.history.length + 1,

          isAI:
            player.isAI,
depth:
  getAttackDepth(
    word,
    attackDepth
  )

});

/* =======================================================
다음 플레이어
======================================================= */

game.turnPlayer =
player === 0
? 1
: 0;

/* =======================================================
다음 후보
======================================================= */

const next =
getCandidates(
word,
game.usedWords,
words,
dueum
);

          lives:
            player.lives
        })
      ),
/* =======================================================
게임 종료
======================================================= */

    history:
      state.history.map(
        item => ({
          word:
            item.word,
if (!next.length) {

          player:
            item.player,
game.finished =
  true;

          turn:
            item.turn,
game.winner =
  player;

          depth:
            item.depth
        })
      ),
game.loser =
  game.turnPlayer;

    playerCount:
      state.players.length,

    usedCount:
      state.usedWords.size,
return {

    settings: {
      ...state.settings
    }
  };
}
  ok: true,

  finished: true,

/* =========================================================
   AI 설정 변경
========================================================= */
  winner:
    game.winner,

function setAILevel(level) {
  const numeric =
    Math.min(
      5,
      Math.max(
        1,
        Number(level) || 1
      )
    );
  loser:
    game.loser,

  if (localGame) {
    localGame.settings.aiLevel =
      numeric;
  }
  word,

  return numeric;
}
  player,

  depth:
    getAttackDepth(
      word,
      attackDepth
    ),

/* =========================================================
   플레이어 수 설정
========================================================= */
  nextCount: 0
};

function setPlayerCount(count) {
  const numeric =
    Math.max(
      1,
      Number(count) || 2
    );
}

  if (localGame) {
    localGame.settings.playerCount =
      numeric;
  }
return {

  return numeric;
}
ok: true,

finished: false,

/* =========================================================
   플레이어 목숨 조회
========================================================= */
word,

function getPlayerLives(
  playerIndex = 0
) {
  if (!localGame) {
    return 0;
  }
player,

  return (
    localGame.players.find(
      player =>
        player.playerIndex ===
        playerIndex
    )?.lives ??
    0
  );
}
depth:
  getAttackDepth(
    word,
    attackDepth
  ),

nextTurn:
  game.turnPlayer,

/* =========================================================
   데이터 상태
========================================================= */
nextCount:
  next.length

function isDataLoaded() {
  return DATA_LOADED;
};
}


/* =========================================================
   통계
공개 게임 상태
========================================================= */

const AI_STATS = {
  games: 0,
function getPublicGameState(game) {
if (!game) {
return null;
}

  wins: 0,
return {

  losses: 0,
startChar:
  game.startChar,

  draws: 0
};
currentWord:
  game.currentWord,

turnPlayer:
  game.turnPlayer,

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
history:
  game.history.map(item => ({

  return getAIStats();
}
    word:
      item.word,

    player:
      item.player,

function getAIStats() {
  const games =
    AI_STATS.games;
    turn:
      item.turn,

  return {
    games,
    depth:
      item.depth
  })),

    wins:
      AI_STATS.wins,
finished:
  game.finished,

    losses:
      AI_STATS.losses,
winner:
  game.winner,

    draws:
      AI_STATS.draws,
loser:
  game.loser

    winRate:
      games
        ? (
            AI_STATS.wins /
            games *
            100
          )
        : 0
  };
};
}


/* =========================================================
   디버그 정보
모듈 exports
========================================================= */

function getDebugInfo() {
  return {
    dataLoaded:
      DATA_LOADED,

    wordCount:
      WORD_SET.size,
module.exports = {

    attackCount:
      Object.keys(
        ATTACK_DEPTH
      ).length,
normalizeWord,

    indexSize:
      WORD_INDEX.size,
allowedFirstChars,

    game:
      getPublicGameState(),
canConnect,

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
hasWord,

getCandidates,

/* =========================================================
   기존 코드 호환용 전역 함수
========================================================= */
getCandidatesFromChar,

window.normalizeWord =
  normalizeWord;
getAttackDepth,

window.allowedFirstChars =
  allowedFirstChars;
isWinningAttack,

window.canConnect =
  canConnect;
isLosingAttack,

window.getCandidates =
  getCandidates;
analyzeWord,

window.getAttackDepth =
  getAttackDepth;
analyzeFutureRisk,

window.isWinningAttack =
  isWinningAttack;
getDifficultyPolicy,

window.chooseBotWord =
  chooseBotWord;
scoreBotCandidate,

window.chooseStartWord =
  chooseStartWord;
chooseBotWord,

createGame,

/* =========================================================
   초기 로그
========================================================= */

console.log(
  "client/game.js 로드 완료"
);
playWord,

console.log(
  "GameEngine 준비 완료"
);
getPublicGameState
};
