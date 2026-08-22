const $ = id =>
document.getElementById(id);

/* =========================================================
기본 상태
========================================================= */

let data = null;

let used = new Set();

let current = '';

let startChar = '';

let turn = 0;

let over = false;

let playerTurn = true;

let wins = 0;
let losses = 0;
let totalTurns = 0;

/* =========================================================
두음법칙
========================================================= */

let DUEUM = {};

function allowedFirstChars(lastChar) {
if (!lastChar) {
return [];
}

const result = [lastChar];

const alternatives =
DUEUM[lastChar];

if (alternatives) {
for (const char of alternatives) {
if (!result.includes(char)) {
result.push(char);
}
}
}

return result;
}

function canStartWith(word, lastChar) {
if (!word || !lastChar) {
return false;
}

return allowedFirstChars(lastChar)
.includes(word[0]);
}

/* =========================================================
공격 데이터
========================================================= */

function attack() {
return data?.attackDepth || {};
}

/*

공격 깊이 판정



홀수 = 이기는 공격

짝수 = 지는 양보
*/
function isWinningAttack(word) {
const depth =
attack()[word];

if (depth == null) {
return false;
}

return Number(depth) % 2 === 1;
}

function isLosingAttack(word) {
const depth =
attack()[word];

if (depth == null) {
return false;
}

return Number(depth) % 2 === 0;
}

/* =========================================================
단어 존재 확인
========================================================= */

function hasWord(word) {
if (!data || !data.wordSet) {
return false;
}

return data.wordSet.has(word);
}

/* =========================================================
후보
========================================================= */

function candidates(
ch,
usedSet = used
) {
if (!data || !ch) {
return [];
}

const result = [];

const firstChars =
allowedFirstChars(ch);

for (const first of firstChars) {
const list =
data.byFirst[first] || [];

for (const word of list) {
  if (!usedSet.has(word)) {
    result.push(word);
  }
}

}

return result;
}

/* =========================================================
후보 개수
========================================================= */

function countCandidates(
ch,
usedSet = used
) {
if (!data || !ch) {
return 0;
}

let count = 0;

const firstChars =
allowedFirstChars(ch);

for (const first of firstChars) {
const list =
data.byFirst[first] || [];

for (const word of list) {
  if (!usedSet.has(word)) {
    count++;
  }
}

}

return count;
}

/* =========================================================
한방단어
========================================================= */

function isOneShot(
word,
usedSet = used
) {
if (!word) {
return true;
}

const nextUsed =
new Set(usedSet);

nextUsed.add(word);

return (
countCandidates(
word.at(-1),
nextUsed
) === 0
);
}

/* =========================================================
후보 정보
========================================================= */

function candidateInfo(word) {
const next =
candidates(
word.at(-1),
new Set([
...used,
word
])
);

const attackData =
attack();

const depth =
attackData[word] != null
? Number(attackData[word])
: null;

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
공격 후보
========================================================= */

function attackCandidates(
ch,
usedSet = used
) {
if (!data || !ch) {
return [];
}

const result = [];

const firstChars =
allowedFirstChars(ch);

const attackData =
attack();

for (const first of firstChars) {
const list =
data.byFirst[first] || [];

for (const word of list) {

  if (usedSet.has(word)) {
    continue;
  }

  if (attackData[word] == null) {
    continue;
  }

  /*
   * 짝수 깊이는 양보 단어이므로
   * 공격 후보에서 제외한다.
   */
  if (!isWinningAttack(word)) {
    continue;
  }

  result.push(word);
}

}

return result;
}

/* =========================================================
모든 공격 데이터 후보
========================================================= */

function allAttackCandidates(
ch,
usedSet = used
) {
if (!data || !ch) {
return [];
}

const result = [];

const firstChars =
allowedFirstChars(ch);

const attackData =
attack();

for (const first of firstChars) {

const list =
  data.byFirst[first] || [];

for (const word of list) {

  if (usedSet.has(word)) {
    continue;
  }

  if (attackData[word] == null) {
    continue;
  }

  result.push(word);
}

}

return result;
}

/* =========================================================
Lv.5 공격 루트 길이
========================================================= */

function attackChainLength(
word,
localUsed = new Set(),
memo = new Map()
) {
if (!word) {
return 0;
}

if (localUsed.has(word)) {
return 0;
}

/*

홀수 깊이 공격만 루트에 포함.
*/
if (!isWinningAttack(word)) {
return 0;
}

const nextUsed =
new Set(localUsed);

nextUsed.add(word);

const usedKey =
Array.from(nextUsed)
.sort()
.join('\u0001');

const key =
${word}|${usedKey};

if (memo.has(key)) {
return memo.get(key);
}

const next =
attackCandidates(
word.at(-1),
nextUsed
);

if (!next.length) {
memo.set(key, 0);
return 0;
}

/*

깊이가 긴 공격을 우선적으로 탐색해서

공격 루트를 최대한 유지한다.
*/
const attackData =
attack();

next.sort(
(a, b) =>
Number(
attackData[b] ?? 0
) -
Number(
attackData[a] ?? 0
)
);

let best = 0;

for (const nextWord of next) {

const length =
  1 +
  attackChainLength(
    nextWord,
    nextUsed,
    memo
  );

if (length > best) {
  best = length;
}

}

memo.set(
key,
best
);

return best;
}

/* =========================================================
Lv.5 공격 후보 평가
========================================================= */

function evaluateLv5Attack(word) {

if (!hasWord(word)) {
return null;
}

if (used.has(word)) {
return null;
}

if (!isWinningAttack(word)) {
return null;
}

const attackData =
attack();

const memo =
new Map();

const chain =
attackChainLength(
word,
new Set(used),
memo
);

const nextUsed =
new Set(used);

nextUsed.add(word);

const nextAttack =
attackCandidates(
word.at(-1),
nextUsed
);

return {
word,

chain,

depth:
  Number(
    attackData[word]
  ),

nextAttackCount:
  nextAttack.length

};
}

/* =========================================================
Lv.5 공격 단어 선택
========================================================= */

function pickLv5Attack(list) {

/*

홀수 깊이 공격만 허용.
*/
const attackList =
list.filter(
word =>
!used.has(word) &&
isWinningAttack(word)
);

/*

공격 후보가 없으면 null.



호출자가 일반 단어로 대체하지 않는다.
*/
if (!attackList.length) {
return null;
}

const evaluated =
attackList
.map(
evaluateLv5Attack
)
.filter(Boolean);

if (!evaluated.length) {
return null;
}

/*

Lv.5 우선순위





공격 루트 길이



공격 깊이



다음 공격 후보 수
*/
evaluated.sort(
(a, b) => {

if (
b.chain !==
a.chain
) {
return (
b.chain -
a.chain
);
}

if (
b.depth !==
a.depth
) {
return (
b.depth -
a.depth
);
}

if (
b.nextAttackCount !==
a.nextAttackCount
) {
return (
b.nextAttackCount -
a.nextAttackCount
);
}

return a.word.localeCompare(
b.word,
'ko'
);
}
);

return evaluated[0].word;
}

/* =========================================================
AI 점수
========================================================= */

function score(
info,
level
) {
const depth =
info.depth == null
? 999
: info.depth;

const nextCount =
info.nextCount;

/* -------------------------------------------------------
한방
------------------------------------------------------- */

if (info.oneShot) {

if (level >= 5) {
  return 100000000;
}

if (level >= 4) {
  return 500000;
}

if (level >= 3) {
  return 100000;
}

return -10000;

}

/* -------------------------------------------------------
홀수 공격 = 이기는 공격
------------------------------------------------------- */

if (
info.depth != null &&
info.winningAttack
) {

if (level === 1) {
  return -5000;
}

if (level === 2) {
  return (
    10000 -
    depth * 100 +
    Math.min(
      nextCount,
      30
    )
  );
}

/*
 * Lv.3은 별도 선택 로직을 사용.
 */
if (level === 3) {
  return (
    100000 -
    depth * 1000
  );
}

if (level === 4) {
  return (
    50000 +
    depth * 500 +
    Math.min(
      nextCount,
      50
    ) * 10
  );
}

if (level === 5) {
  return (
    100000000 +
    depth * 1000
  );
}

}

/* -------------------------------------------------------
짝수 공격 = 지는 양보
------------------------------------------------------- */

if (
info.depth != null &&
info.losingAttack
) {

/*
 * 짝수 깊이는 기본적으로
 * 일반 단어보다도 낮게 평가한다.
 */
return -1000000;

}

/* -------------------------------------------------------
일반 공룰 단어
------------------------------------------------------- */

if (level === 1) {
return (
100 +
Math.min(
nextCount,
100
)
);
}

if (level === 2) {
return (
150 +
Math.min(
nextCount,
100
)
);
}

if (level === 3) {
return (
500 +
Math.min(
nextCount,
100
) * 2
);
}

if (level === 4) {
return (
300 +
Math.min(
nextCount,
60
) * 3
);
}

/*

Lv.5에서는 공격 후보가 없을 경우

일반 단어를 선택하지 않는다.
*/
return -1000000000;
}

/* =========================================================
AI 선택
========================================================= */

function aiPick() {

const level =
Number(
$('difficulty').value
);

const lastChar =
current
? current.at(-1)
: startChar;

const list =
candidates(
lastChar
);

if (!list.length) {
finish(false);
return null;
}

const infos =
list.map(
candidateInfo
);

/* =======================================================
Lv.5
======================================================= */

if (level === 5) {

/*
 * 공격 단어가 존재한다면
 * 무조건 홀수 깊이 공격.
 */
const attackWord =
  pickLv5Attack(list);

if (attackWord) {
  return attackWord;
}

/*
 * 절대 일반 단어로 내려가지 않는다.
 *
 * 짝수 깊이 양보 단어도 사용하지 않는다.
 */
return null;

}

/* =======================================================
Lv.4
======================================================= */

if (level === 4) {

/*
 * 한방 단어 우선.
 */
const oneShots =
  infos.filter(
    x =>
      x.oneShot
  );

if (oneShots.length) {

  /*
   * 한방 중에서도
   * 이기는 공격이면 우선.
   */
  const winningOneShots =
    oneShots.filter(
      x =>
        x.winningAttack
    );

  const target =
    winningOneShots.length
      ? winningOneShots
      : oneShots;

  target.sort(
    (a, b) =>
      (b.depth ?? -1) -
      (a.depth ?? -1)
  );

  return target[0].word;
}

/*
 * 홀수 공격만 공격으로 취급.
 */
const attacks =
  infos.filter(
    x =>
      x.winningAttack
  );

if (attacks.length) {

  /*
   * Lv.4는 강한 공격을 선호.
   */
  attacks.sort(
    (a, b) => {

      if (
        b.depth !==
        a.depth
      ) {
        return (
          b.depth -
          a.depth
        );
      }

      return (
        a.nextCount -
        b.nextCount
      );
    }
  );

  return attacks[0].word;
}

/*
 * 짝수 깊이 양보 단어는
 * 공격 후보로 사용하지 않는다.
 *
 * 일반 단어 중 상대 선택지를 줄이는 쪽.
 */
const normal =
  infos.filter(
    x =>
      x.depth == null &&
      !x.oneShot
  );

if (normal.length) {

  normal.sort(
    (a, b) =>
      a.nextCount -
      b.nextCount
  );

  return normal[0].word;
}

/*
 * 일반 단어가 없다면
 * 짝수 공격은 최후의 수단.
 */
const fallback =
  infos.filter(
    x =>
      !x.oneShot
  );

if (fallback.length) {
  return fallback[0].word;
}

return list[0];

}

/* =======================================================
Lv.3
======================================================= */

if (level === 3) {

/*
 * 1순위:
 * 한방이면 바로 끝낸다.
 */
const oneShots =
  infos.filter(
    x =>
      x.oneShot
  );

if (oneShots.length) {

  /*
   * 홀수 깊이 한방을 우선.
   */
  const winningOneShots =
    oneShots.filter(
      x =>
        x.winningAttack
    );

  const target =
    winningOneShots.length
      ? winningOneShots
      : oneShots;

  /*
   * 깊이가 낮은 것부터.
   *
   * 낮은 깊이 =
   * 더 빨리 끝나는 공격.
   */
  target.sort(
    (a, b) =>
      (a.depth ?? 999) -
      (b.depth ?? 999)
  );

  return target[0].word;
}

/*
 * 2순위:
 *
 * 홀수 깊이 공격만 사용.
 *
 * 핵심:
 * "공격 깊이가 낮은 것을 먼저
 * 최대한 빨리 끝내기"
 */
const attacks =
  infos.filter(
    x =>
      x.winningAttack
  );

if (attacks.length) {

  attacks.sort(
    (a, b) => {

      /*
       * 가장 중요한 기준:
       * 낮은 공격 깊이
       */
      if (
        a.depth !==
        b.depth
      ) {
        return (
          a.depth -
          b.depth
        );
      }

      /*
       * 같은 깊이라면
       * 다음 선택지가 적은 쪽.
       *
       * 상대가 빨리 막히도록 한다.
       */
      if (
        a.nextCount !==
        b.nextCount
      ) {
        return (
          a.nextCount -
          b.nextCount
        );
      }

      return a.word.localeCompare(
        b.word,
        'ko'
      );
    }
  );

  /*
   * Lv.3은 랜덤으로 섞지 않는다.
   *
   * 항상 가장 낮은 깊이부터
   * 확실하게 공격한다.
   */
  return attacks[0].word;
}

/*
 * 3순위:
 * 일반 공룰 단어.
 *
 * 짝수 공격은 여기서도 우선하지 않는다.
 */
const normal =
  infos.filter(
    x =>
      x.depth == null &&
      !x.oneShot
  );

if (normal.length) {

  normal.sort(
    (a, b) => {

      if (
        a.nextCount !==
        b.nextCount
      ) {
        return (
          a.nextCount -
          b.nextCount
        );
      }

      return a.word.localeCompare(
        b.word,
        'ko'
      );
    }
  );

  return normal[0].word;
}

/*
 * 4순위:
 * 정말 다른 선택지가 없을 때만
 * 짝수 깊이 양보 단어를 사용.
 */
const losing =
  infos.filter(
    x =>
      x.losingAttack
  );

if (losing.length) {

  losing.sort(
    (a, b) =>
      a.depth -
      b.depth
  );

  return losing[0].word;
}

return list[0];

}

/* =======================================================
Lv.2
======================================================= */

if (level === 2) {

const sorted =
  [...infos].sort(
    (a, b) =>
      score(b, level) -
      score(a, level)
  );

const count =
  Math.min(
    8,
    sorted.length
  );

return sorted[
  Math.floor(
    Math.random() *
    count
  )
].word;

}

/* =======================================================
Lv.1
======================================================= */

const safe =
infos.filter(
x =>
x.depth == null &&
!x.oneShot
);

if (safe.length) {

safe.sort(
  (a, b) =>
    b.nextCount -
    a.nextCount
);

const count =
  Math.min(
    15,
    safe.length
  );

return safe[
  Math.floor(
    Math.random() *
    count
  )
].word;

}

const nonOneShot =
infos.filter(
x =>
!x.oneShot
);

if (nonOneShot.length) {

nonOneShot.sort(
  (a, b) =>
    b.nextCount -
    a.nextCount
);

return nonOneShot[0].word;

}

return list[
Math.floor(
Math.random() *
list.length
)
];
}

/* =========================================================
AI 단어 적용
========================================================= */

function playAiWord(word) {

if (!word) {
return;
}

/*

존재 여부
*/
if (!hasWord(word)) {

console.error(

  'AI가 존재하지 않는 단어를 선택함:',
  word
);

finish(false);
return;

}

/*

중복 방지
*/
if (used.has(word)) {

console.error(

  'AI가 이미 사용한 단어를 선택함:',
  word
);

finish(false);
return;

}

/*

연결 확인
*/
if (
current &&
!canStartWith(
word,
current.at(-1)
)
) {

console.error(

  'AI 단어 연결 오류:',
  current,
  word
);

finish(false);
return;

}

used.add(word);

current = word;

turn++;

$('last').textContent =
word.at(-1);

$('turn').textContent =
turn;

$('depth').textContent =
attack()[word] ?? '-';

addHistory(
'AI',
word
);

const next =
countCandidates(
word.at(-1)
);

if (next === 0) {

finish(true);
return;

}

$('message').textContent =
AI: ${word} → '${word.at(-1)}';

playerTurn = true;

$('singleInput').disabled =
false;

$('singleSend').disabled =
false;

$('singleInput').focus();
}

/* =========================================================
AI 턴
========================================================= */

function aiTurn() {

if (
over ||
playerTurn
) {
return;
}

const word =
aiPick();

/*

Lv.5에서 공격 후보가 없으면

일반 단어로 대체하지 않는다.
*/
if (!word) {

finish(false);

return;

}

playAiWord(word);
}

/* =========================================================
플레이어 입력
========================================================= */

function submit() {

if (
over ||
!playerTurn
) {
return;
}

const word =
$('singleInput')
.value
.trim();

$('singleInput').value =
'';

if (!word) {
return;
}

if (!hasWord(word)) {

$('message').textContent =
  '목록에 없는 단어야.';

return;

}

if (used.has(word)) {

$('message').textContent =
  '이미 나온 단어야.';

return;

}

/*

첫 단어
*/

if (!current) {

const error =
  validateFirstWordClient(
    word
  );

if (error) {

  $('message').textContent =
    error;

  return;
}

used.add(word);

current = word;

turn++;

$('last').textContent =
  word.at(-1);

$('turn').textContent =
  turn;

$('depth').textContent =
  attack()[word] ?? '-';

addHistory(
  '나',
  word
);

} else {

if (
  !canStartWith(
    word,
    current.at(-1)
  )
) {

  const last =
    current.at(-1);

  const accepted =
    allowedFirstChars(last);

  $('message').textContent =
    accepted.length > 1
      ? `'${last}' 다음에는 ${accepted.join(', ')}으로 시작하는 단어를 써야 해.`
      : `'${last}'로 시작해야 해.`;

  return;
}

used.add(word);

current = word;

turn++;

$('last').textContent =
  word.at(-1);

$('turn').textContent =
  turn;

$('depth').textContent =
  attack()[word] ?? '-';

addHistory(
  '나',
  word
);

}

/*

상대가 이어갈 수 있는지 확인
*/
if (
countCandidates(
current.at(-1)
) === 0
) {

finish(false);

return;

}

playerTurn = false;

$('singleInput').disabled =
true;

$('singleSend').disabled =
true;

$('message').textContent =
'AI가 생각 중...';

setTimeout(
aiTurn,
350
);
}

/* =========================================================
첫 단어 클라이언트 검사
========================================================= */

function validateFirstWordClient(word) {

if (
!word.startsWith(
startChar
)
) {

return (
  `'${startChar}'으로 시작하는 단어를 입력해야 해.`
);

}

/*

첫 단어 공격 금지.



홀수/짝수 관계없이

attack.txt 등록 단어는 금지.
*/
if (
attack()[word] != null
) {

return (

  '첫 단어에서는 공격 단어를 사용할 수 없어.'
);

}

/*

한방 금지
*/
if (
isOneShot(
word,
new Set()
)
) {

return (

  '첫 단어로 한방 단어는 사용할 수 없어.'
);

}

const next =
countCandidates(
word.at(-1),
new Set([word])
);

if (next < 5) {

return (
  '첫 단어로는 선택지가 너무 적은 단어를 사용할 수 없어.'
);

}

return null;
}

/* =========================================================
버튼
========================================================= */

$('singleSend').onclick =
submit;

$('singleInput').onkeydown =
e => {

if (
  e.key === 'Enter'
) {

  e.preventDefault();

  submit();
}

};

$('restart').onclick =
start;

$('newStart').onclick =
start;

/* =========================================================
온라인
========================================================= */

const socket =
io();

let room = null;

let myId = null;

let onlineLast = '';

let onlineStartChar = '';

let onlineTurn = null;

let onlineStarted = false;

/* =========================================================
방 렌더링
========================================================= */

function roomRender(state) {

room = state;

const players =
state.players
.map(
p =>
${esc(p.name)} (P${p.slot})
)
.join(' · ');

const turnPlayer =
state.turnPlayer
? state.players.find(
p =>
p.id ===
state.turnPlayer
)
: null;

$('roomInfo').innerHTML =
`
<b>방 코드: ${esc(
state.roomCode
)}</b><br>

  플레이어:
  ${
    players ||
    '-'
  }<br>

  ${
    state.started
      ? `시작 음절: <b>${esc(
          state.startChar ||
          '-'
        )}</b><br>`
      : ''
  }

  ${
    state.current
      ? `현재 단어: <b>${esc(
          state.current
        )}</b><br>`
      : ''
  }

  현재 차례:
  ${
    turnPlayer
      ? esc(
          turnPlayer.name
        )
      : '대기 중'
  }
`;

const isHost =
state.players[0]?.id ===
myId;

const canStart =
isHost &&
!state.started &&
state.players.length === 2;

$('startOnline')
.classList
.toggle(
'hidden',
!canStart
);

if (
onlineStarted &&
state.started
) {

const myTurn =
  state.turnPlayer ===
  myId;

$('onlineInput').disabled =
  !myTurn;

$('onlineSend').disabled =
  !myTurn;

}
}

/* =========================================================
Socket 연결
========================================================= */

socket.on(
'connect',
() => {

myId =
  socket.id;

console.log(
  'Socket 연결:',
  myId
);

}
);

/* =========================================================
온라인 방 생성
========================================================= */

socket.on(
'room_created',
info => {

$('roomCode').value =
  info.code;

$('onlineMessage').textContent =
  '방이 만들어졌어. 친구에게 코드를 알려줘.';

}
);

/* =========================================================
온라인 상태
========================================================= */

socket.on(
'room_state',
state => {

roomRender(
  state
);

}
);

/* =========================================================
온라인 알림
========================================================= */

socket.on(
'notice',
message => {

$('onlineMessage').textContent =
  message;

}
);

socket.on(
'error_msg',
message => {

$('onlineMessage').textContent =
  message;

}
);

/* =========================================================
온라인 게임 시작
========================================================= */

socket.on(
'game_started',
info => {

$('onlineHistory').innerHTML =
  '';

onlineLast = '';

onlineStartChar =
  info.startChar;

onlineTurn =
  info.state.turnPlayer;

onlineStarted =
  true;

addOnline(
  '시작 음절',
  info.startChar,
  null
);

$('onlineMessage').textContent =
  info.state.turnPlayer ===
  myId
    ? `게임 시작! '${info.startChar}'으로 시작하는 단어를 입력해.`
    : `게임 시작! 시작 음절은 '${info.startChar}'. 상대방 차례야.`;

roomRender(
  info.state
);

$('onlineInput').value =
  '';

if (
  info.state.turnPlayer ===
  myId
) {

  $('onlineInput').focus();
}

}
);

/* =========================================================
온라인 기록
========================================================= */

function addOnline(
who,
word,
depth
) {

$('onlineHistory')
.insertAdjacentHTML(
'beforeend',
        <div class="line">
          <b>${esc(who)}</b> · ${esc(word)}
          ${
            depth != null
              ?<span class="attack">(공격 깊이 ${depth})</span>              : ''
          }
        </div>
     
);

$('onlineHistory').scrollTop =
$('onlineHistory')
.scrollHeight;
}

/* =========================================================
온라인 단어
========================================================= */

socket.on(
'word_played',
info => {

onlineLast =
  info.word;

onlineTurn =
  info.state.turnPlayer;

const player =
  info.state.players.find(
    p =>
      p.id ===
      info.playerId
  );

addOnline(
  info.playerId === myId
    ? '나'
    : player?.name ||
      '상대',
  info.word,
  info.depth
);

roomRender(
  info.state
);

$('onlineMessage').textContent =
  info.state.turnPlayer ===
  myId
    ? '내 차례야.'
    : '상대방 차례야.';

$('onlineInput').value =
  '';

}
);

/* =========================================================
온라인 게임 종료
========================================================= */

socket.on(
'game_over',
info => {

onlineStarted =
  false;

$('onlineInput').disabled =
  true;

$('onlineSend').disabled =
  true;

$('onlineMessage').textContent =
  info.winner ===
  myId
    ? '온라인 승리!'
    : '온라인 패배!';

roomRender(
  info.state
);

}
);

/* =========================================================
온라인 방 생성
========================================================= */

$('create').onclick =
() => {

socket.emit(
  'create_room',
  {
    name:
      $('name')
        .value
        .trim() ||
      'Player'
  }
);

};

/* =========================================================
온라인 방 참가
========================================================= */

$('join').onclick =
() => {

socket.emit(
  'join_room',
  {
    code:
      $('roomCode')
        .value
        .trim(),

    name:
      $('name')
        .value
        .trim() ||
      'Player'
  }
);

};

/* =========================================================
온라인 시작
========================================================= */

$('startOnline').onclick =
() => {

socket.emit(
  'start_online'
);

};

/* =========================================================
온라인 입력
========================================================= */

$('onlineSend').onclick =
onlineSubmit;

$('onlineInput').onkeydown =
e => {

if (
  e.key === 'Enter'
) {

  e.preventDefault();

  onlineSubmit();
}

};

function onlineSubmit() {

if (!onlineStarted) {
return;
}

if (
onlineTurn !==
myId
) {

$('onlineMessage').textContent =
  '아직 네 차례가 아니야.';

return;

}

const word =
$('onlineInput')
.value
.trim();

if (!word) {
return;
}

if (!hasWord(word)) {

$('onlineMessage').textContent =
  '목록에 없는 단어야.';

return;

}

if (
onlineLast &&
!canStartWith(
word,
onlineLast.at(-1)
)
) {

const last =
  onlineLast.at(-1);

const accepted =
  allowedFirstChars(last);

$('onlineMessage').textContent =
  accepted.length > 1
    ? `'${last}' 다음에는 ${accepted.join(', ')}으로 시작해야 해.`
    : `'${last}'로 시작해야 해.`;

return;

}

/*

첫 온라인 단어
*/

if (!onlineLast) {

if (
  !word.startsWith(
    onlineStartChar
  )
) {

  $('onlineMessage').textContent =
    `'${onlineStartChar}'으로 시작하는 단어를 입력해야 해.`;

  return;
}

if (
  attack()[word] != null
) {

  $('onlineMessage').textContent =
    '첫 단어에서는 공격 단어를 사용할 수 없어.';

  return;
}

if (
  isOneShot(
    word,
    new Set()
  )
) {

  $('onlineMessage').textContent =
    '첫 단어로 한방 단어를 사용할 수 없어.';

  return;
}

}

socket.emit(
'play_word',
{
word
}
);

$('onlineInput').value =
'';
}

/* =========================================================
탭
========================================================= */

document
.querySelectorAll(
'.tabs button'
)
.forEach(
button => {

  button.onclick =
    () => {

      document
        .querySelectorAll(
          '.tabs button'
        )
        .forEach(
          x =>
            x.classList.remove(
              'active'
            )
        );

      button.classList.add(
        'active'
      );

      $('single')
        .classList
        .toggle(
          'hidden',
          button.dataset.mode !==
            'single'
        );

      $('online')
        .classList
        .toggle(
          'hidden',
          button.dataset.mode !==
            'online'
        );
    };
}

);

/* =========================================================
데이터 로딩
========================================================= */

async function loadData() {

$('message').textContent =
'게임 데이터를 불러오는 중...';

try {

const response =
  await fetch(
    '/api/data'
  );

if (!response.ok) {

  throw new Error(
    `HTTP ${response.status}`
  );
}

const result =
  await response.json();

if (
  !result.ready
) {

  throw new Error(
    '게임 데이터가 아직 준비되지 않았습니다.'
  );
}

data = {
  byFirst:
    result.byFirst || {},

  attackDepth:
    result.attackDepth || {},

  startFirst:
    result.startFirst ||
    [
      '가',
      '나',
      '다',
      '마',
      '사',
      '자',
      '기',
      '시'
    ]
};

/*
 * 클라이언트 단어 Set
 */
data.wordSet =
  new Set();

for (
  const first
  of Object.keys(
    data.byFirst
  )
) {

  const list =
    data.byFirst[first] || [];

  for (
    const word
    of list
  ) {

    data.wordSet.add(
      word
    );
  }
}

DUEUM =
  result.dueum || {};

loadStats();

start();

} catch (error) {

console.error(
  '데이터 로딩 실패:',
  error
);

$('message').textContent =
  '게임 데이터를 불러오지 못했어. 잠시 후 새로고침해줘.';

setTimeout(
  loadData,
  1500
);

}
}

/* =========================================================
통계
========================================================= */

function saveStats() {

localStorage.kkeulStats =
JSON.stringify({
wins,
losses,
totalTurns
});
}

function loadStats() {

try {

const saved =
  JSON.parse(
    localStorage.kkeulStats ||
    '{}'
  );

wins =
  Number(
    saved.wins || 0
  );

losses =
  Number(
    saved.losses || 0
  );

totalTurns =
  Number(
    saved.totalTurns || 0
  );

} catch {

wins = 0;
losses = 0;
totalTurns = 0;

}

updateStats();
}

function updateStats() {

const games =
wins + losses;

$('wins').textContent =
wins;

$('losses').textContent =
losses;

$('games').textContent =
games;

$('winrate').textContent =
games
? Math.round(
wins /
games *
100
) + '%'
: '0%';

$('avg').textContent =
games
? (
totalTurns /
games
).toFixed(1) +
'턴'
: '-';
}

/* =========================================================
기록
========================================================= */

function addHistory(
who,
word
) {

const depth =
attack()[word];

$('history')
.insertAdjacentHTML(
'beforeend',
        <div class="line">
          <b>${esc(who)}</b> · ${esc(word)}
          ${
            depth != null
              ?<span class="attack">(공격 깊이 ${depth})</span>              : ''
          }
        </div>
     
);

$('history').scrollTop =
$('history').scrollHeight;
}

/* =========================================================
게임 시작
========================================================= */

function start() {

if (!data) {
return;
}

used.clear();

current = '';

startChar =
data.startFirst[
Math.floor(
Math.random() *
data.startFirst.length
)
];

turn = 0;

over = false;

playerTurn =
Math.random() < 0.5;

$('history').innerHTML =
'';

$('singleInput').disabled =
!playerTurn;

$('singleSend').disabled =
!playerTurn;

$('startWord').value =
startChar;

$('last').textContent =
startChar;

$('turn').textContent =
'0';

$('depth').textContent =
'-';

addHistory(
'시작 음절',
startChar
);

if (playerTurn) {

$('message').textContent =
  `시작 음절은 '${startChar}'. ${startChar}으로 시작하는 단어를 입력해!`;

$('singleInput').focus();

} else {

$('message').textContent =
  `시작 음절은 '${startChar}'. AI가 먼저 생각 중...`;

setTimeout(
  aiFirstTurn,
  350
);

}
}

/* =========================================================
첫 단어 AI 후보
========================================================= */

function aiFirstCandidates() {

const list =
candidates(
startChar,
new Set()
);

return list.filter(
word => {

  /*
   * 첫 단어 공격 금지
   */
  if (
    attack()[word] != null
  ) {
    return false;
  }

  /*
   * 한방 금지
   */
  if (
    isOneShot(
      word,
      new Set()
    )
  ) {
    return false;
  }

  const nextUsed =
    new Set([word]);

  return (
    countCandidates(
      word.at(-1),
      nextUsed
    ) >= 5
  );
}

);
}

/* =========================================================
첫 단어 AI
========================================================= */

function aiFirstTurn() {

if (over) {
return;
}

const safe =
aiFirstCandidates();

let word = null;

if (safe.length) {

/*
 * 첫 단어에서는
 * 공격/한방을 피하고
 * 무난한 단어를 선택.
 */
word =
  safe[
    Math.floor(
      Math.random() *
      safe.length
    )
  ];

} else {

const list =
  candidates(
    startChar,
    new Set()
  );

if (!list.length) {

  finish(false);
  return;
}

const normal =
  list.filter(
    x =>
      attack()[x] == null &&
      !isOneShot(
        x,
        new Set()
      )
  );

word =
  (
    normal.length
      ? normal
      : list
  )[
    Math.floor(
      Math.random() *
      (
        normal.length
          ? normal.length
          : list.length
      )
    )
  ];

}

playAiWord(word);
}

/* =========================================================
AI 종료
========================================================= */

function finish(aiWon) {

if (over) {
return;
}

over = true;

$('singleInput').disabled =
true;

$('singleSend').disabled =
true;

if (aiWon) {
wins++;
} else {
losses++;
}

totalTurns +=
turn;

saveStats();

updateStats();

$('message').textContent =
aiWon
? 'AI 승리!'
: '플레이어 승리!';
}

/* =========================================================
HTML escape
========================================================= */

function esc(s) {

return String(s).replace(
/[&<>"']/g,
c =>
({
'&':
'&',
'<':
'<',
'>':
'>',
'"':
'"',
"'":
'''
}[c])
);
}

/* =========================================================
시작
========================================================= */

loadData();
