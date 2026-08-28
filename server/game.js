"use strict";

/*

=========================================================

끝말잇기 공통 게임 엔진

=========================================================



사용 데이터



word.txt

실제 사용 가능한 전체 단어



attack.txt

공격 단어 + 공격 깊이



예:



가녘 1

가마깥 3

가겍 5



=========================================================
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

result.add(lastChar);

/*

정방향



예:

녀 -> 여

년 -> 연
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

역방향



예:

여 -> 녀

연 -> 년



기존 프로젝트의 양방향 두음 처리와 호환.
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

/*

byFirst 형태의 객체도 지원.



서버에서 데이터 구조가

{

가: [...],

나: [...],

...

}

형태일 경우 사용할 수 있음.
*/
if (typeof words === "object") {
const list = words[word.at(0)];

if (Array.isArray(list)) {

  return list.includes(word);
}

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

/*

words가 Set/Array이면 전체 순회.



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

if (used.has(word)) {
continue;
}

result.push(word);
}
}

return result;

}

for (const word of words) {
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
usedWords,
words,
dueum = {}
) {
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

/*

byFirst 구조
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

if (used.has(word)) {
continue;
}

result.push(word);
}
}

return result;

}

/*

Array / Set 구조
*/
for (const word of words) {
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
attackDepth = {}
) {
word = normalizeWord(word);

if (!word) {
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

return (
depth != null &&
depth % 2 === 1
);
}

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

nextCount: next.length,

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
words,
usedWords,
dueum,
sampleLimit = 60
) {
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

모든 후보를 탐색하면

대규모 단어 데이터에서 느려질 수 있으므로

일부만 확인.
*/
const limit = Math.min(
opponentCandidates.length,
sampleLimit
);

let dangerous = 0;

for (let i = 0; i < limit; i++) {
const opponentWord =
opponentCandidates[i];

const nextUsed =
  new Set(usedAfterWord);

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
  limit - dangerous,

opponentCount:
  opponentCandidates.length

};
}

/* =========================================================
AI 난이도 정책
========================================================= */

/*

level 1

거의 랜덤

공격 단어 최대한 회피



level 2

약한 공격



level 3

균형형



level 4

공격 적극 사용



level 5

공격 우선

깊은 공격 단어 우선

공격 중에는 불필요하게 양보 단어로 전환하지 않음
*/
function getDifficultyPolicy(level) {
level = Number(level);

switch (level) {
case 1:
return {
strength: 0.20,
attackWeight: 0.20,
depthWeight: 0.15,
randomPool: 18,
futureAnalysis: 25
};

case 2:
  return {
    strength: 0.38,
    attackWeight: 0.55,
    depthWeight: 0.35,
    randomPool: 12,
    futureAnalysis: 40
  };

case 3:
  return {
    strength: 0.55,
    attackWeight: 0.90,
    depthWeight: 0.65,
    randomPool: 8,
    futureAnalysis: 50
  };

case 4:
  return {
    strength: 0.76,
    attackWeight: 1.30,
    depthWeight: 1.00,
    randomPool: 5,
    futureAnalysis: 60
  };

case 5:
  return {
    strength: 0.95,
    attackWeight: 2.00,
    depthWeight: 1.70,
    randomPool: 3,
    futureAnalysis: 80
  };

default:
  return getDifficultyPolicy(3);

}
}

/* =========================================================
후보 점수
========================================================= */

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

let score = 0;

const nextCount =
info.nextCount;

const depth =
info.depth ?? 0;

const risk =
futureRisk?.risk ?? 0;

/* =======================================================
즉시 승리
======================================================= */

if (info.oneShot) {

score += 15000;

/*
 * 낮은 난이도에서는 즉시 끝내는 수를
 * 일부러 덜 선택한다.
 */
score *=
  0.65 +
  strength * 0.35;

}

/* =======================================================
상대 선택지 수
======================================================= */

if (nextCount === 1) {
score += 4500;
}

else if (nextCount <= 3) {
score += 2100;
}

else if (nextCount <= 7) {
score += 800;
}

else if (nextCount <= 15) {
score += 300;
}

else {
score += 60;
}

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

}

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

/* =======================================================
일반 단어
======================================================= */

if (
!info.winningAttack &&
!info.losingAttack
) {
score +=
Math.min(nextCount, 30) *
(level <= 2 ? 18 : 10);
}

/* =======================================================
미래 위험
======================================================= */

if (risk >= 0.80) {
score -= 5000;
}

else if (risk >= 0.60) {
score -= 2800;
}

else if (risk >= 0.35) {
score -= 1100;
}

else if (risk >= 0.15) {
score -= 300;
}

/* =======================================================
승률 보정
======================================================= */

/*

winBias는 AI의 현재 승률.



너무 강하면 공격을 조금 완화.

너무 약하면 공격을 강화.
*/

if (winBias > 0.70) {

if (info.winningAttack) {
  score -=
    (winBias - 0.70) *
    8500;
}

if (info.oneShot) {
  score -=
    (winBias - 0.70) *
    6500;
}

}

else if (winBias < 0.30) {

if (info.winningAttack) {
  score +=
    (0.30 - winBias) *
    7000;
}

if (nextCount <= 3) {
  score +=
    (0.30 - winBias) *
    3000;
}

}

/* =======================================================
첫 수
======================================================= */

if (!currentWord) {

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

  if (level <= 4) {
    score -= 6000;
  }

  /*
   * Lv5도 첫 수부터 무조건 공격하지 않음.
   */
  else {
    score -= 2500;
  }
}

/*
 * 일반 단어 중에서도
 * 상대에게 너무 적은 선택지만 주는 단어를
 * 첫 수에서는 조금 피한다.
 */
if (
  !info.winningAttack &&
  nextCount <= 2
) {
  score -= 1000;
}

}

/* =======================================================
Lv5 특수 정책
======================================================= */

if (level === 5) {

/*
 * 공격 단어가 존재하면
 * 일반 양보 단어보다 공격 단어를 강하게 우선.
 */
if (info.winningAttack) {

  score +=
    2500 +
    depth * 120;
}

/*
 * 공격 중 깊은 수를 계속 이어갈 수 있는 상황에서
 * 선택지가 많은 일반 단어로 갑자기 빠지는 것을 방지.
 */
if (
  currentWord &&
  info.winningAttack
) {

  score +=
    depth * 100;
}

}

return score;
}

/* =========================================================
봇 후보 선택
========================================================= */

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

if (!candidates.length) {
return null;
}

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

/* =======================================================
첫 수 안전 처리
======================================================= */

let usable =
analyzed;

if (!currentWord) {

const safe =
  analyzed.filter(info =>
    !info.oneShot &&
    !info.winningAttack
  );

if (safe.length) {
  usable = safe;
}

}

/* =======================================================
1차 점수
======================================================= */

const preliminary =
usable.map(info => {

  let score = 0;

  /*
   * 즉시 승리
   */
  if (info.oneShot) {
    score += 15000;
  }

  /*
   * 공격
   */
  if (info.winningAttack) {
    score +=
      1000 +
      (info.depth ?? 0) * 70;
  }

  /*
   * 상대 선택지
   */
  if (info.nextCount === 1) {
    score += 4000;
  }

  else if (info.nextCount <= 3) {
    score += 1800;
  }

  else {
    score +=
      Math.min(
        info.nextCount,
        30
      ) * 15;
  }

  return {
    info,
    base: score
  };
});

preliminary.sort(
(a, b) =>
b.base - a.base
);

/* =======================================================
미래 분석
======================================================= */

const policy =
getDifficultyPolicy(level);

const analysisLimit =
Math.min(
preliminary.length,
policy.futureAnalysis
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
    dueum,
    policy.futureAnalysis
  );

const score =
  scoreBotCandidate({
    info,
    futureRisk,
    strength,
    winBias,
    level,
    currentWord
  });

scored.push({
  info,
  score
});

}

/*

나머지 후보는

미래 분석 없이 기본 점수 사용.
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
      risk: 0.20,
      botNextCount:
        info.nextCount
    },

    strength,
    winBias,
    level,
    currentWord
  });

scored.push({
  info,
  score
});

}

if (!scored.length) {
return null;
}

/* =======================================================
정렬
======================================================= */

scored.sort(
(a, b) =>
b.score - a.score
);

/* =======================================================
선택 풀
======================================================= */

let poolSize =
policy.randomPool;

/*

승률이 너무 높으면

선택 폭을 넓힌다.
*/
if (winBias > 0.65) {
poolSize += 6;
}

/*

승률이 낮으면

좋은 후보에 더 집중.
*/
if (winBias < 0.35) {
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

if (!pool.length) {
return null;
}

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

const finalPool =
reasonable.length
? reasonable
: [pool[0]];

/*

Lv5는 공격 후보가 있으면

공격 후보를 우선 유지.
*/
if (level === 5) {

const attacks =

  finalPool.filter(
    item =>
      item.info.winningAttack
  );

if (attacks.length) {

  /*
   * 깊은 공격 단어 중심.
   */
  attacks.sort(
    (a, b) =>
      (b.info.depth ?? 0) -
      (a.info.depth ?? 0)
  );

  /*
   * 최상위 공격 후보 몇 개 중 선택.
   */
  const attackPool =
    attacks.slice(
      0,
      Math.min(
        3,
        attacks.length
      )
    );

  const selected =
    attackPool[
      Math.floor(
        Math.random() *
        attackPool.length
      )
    ];

  return selected.info.word;
}

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
게임 생성
========================================================= */

function createGame({
startChar = "",
startPlayer = 0
} = {}) {
return {

startChar:
  normalizeWord(startChar).at(0) || "",

currentWord:
  null,

turnPlayer:
  startPlayer === 1
    ? 1
    : 0,

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

/* =======================================================
단어 목록
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

if (game.usedWords.has(word)) {
return {
ok: false,
reason:
"이미 사용한 단어입니다."
};
}

/* =======================================================
첫 단어
======================================================= */

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
      `"${game.startChar}"으로 시작하는 단어가 아닙니다.`,

    allowed:
      allowedFirstChars(
        game.startChar,
        dueum
      )
  };
}

}

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

/* =======================================================
현재 플레이어
======================================================= */

const player =
game.turnPlayer;

/* =======================================================
등록
======================================================= */

game.currentWord =
word;

game.usedWords.add(
word
);

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

/* =======================================================
게임 종료
======================================================= */

if (!next.length) {

game.finished =
  true;

game.winner =
  player;

game.loser =
  game.turnPlayer;


return {

  ok: true,

  finished: true,

  winner:
    game.winner,

  loser:
    game.loser,

  word,

  player,

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

player,

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
공개 게임 상태
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
  game.history.map(item => ({

    word:
      item.word,

    player:
      item.player,

    turn:
      item.turn,

    depth:
      item.depth
  })),

finished:
  game.finished,

winner:
  game.winner,

loser:
  game.loser

};
}

/* =========================================================
모듈 exports
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

analyzeFutureRisk,

getDifficultyPolicy,

scoreBotCandidate,

chooseBotWord,

createGame,

playWord,

getPublicGameState
};
