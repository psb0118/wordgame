const $ = id => document.getElementById(id);

let data = null;

let used = new Set();
let current = '';
let turn = 0;
let over = false;

let wins = 0;
let losses = 0;
let totalTurns = 0;

/* =========================
   시작 글자
========================= */

const START_FIRST = [
  '가',
  '나',
  '다',
  '마',
  '사',
  '자',
  '기',
  '시'
];

/* =========================
   두음법칙
=========================

   실제 끝말잇기에서 사용할 수 있는
   주요 두음법칙을 폭넓게 처리한다.

   예:
   리 → 이
   림 → 임
   름 → 음
   량 → 양
   력 → 역
   련 → 연
   렬 → 열
   령 → 영
   례 → 예
   료 → 요
   류 → 유
   륙 → 육
   률 → 율
   린 → 인
   립 → 입

   녀 → 여
   년 → 연
   념 → 염
   녕 → 영
   뇨 → 요
   뉴 → 유
   니 → 이

   라 → 나
   래 → 내
   로 → 노
   루 → 누
   류 → 유
   륙 → 육
   릉 → 능

   님 → 임
   늄 → 윰
*/

const DUEUM = {};

/*
 * ㄴ → ㅇ
 */
const NIEUN_TO_IEUNG = [
  '녀',
  '년',
  '념',
  '녕',
  '뇨',
  '뉴',
  '니',
  '녜',
  '녑',
  '녘',
  '녠',
  '뉘',
  '늬',
  '뇌',
  '뇰'
];

/*
 * ㄹ → ㄴ
 */
const RIEUL_TO_NIEUN = [
  '라',
  '래',
  '로',
  '뢰',
  '루',
  '르',
  '리',
  '랴',
  '려',
  '례',
  '료',
  '류',
  '랴',
  '려',
  '롸',
  '뤄',
  '뤼',
  '래',
  '뢰',
  '롸',
  '롼',
  '롹',
  '롱',
  '룡',
  '륜',
  '륭',
  '릉',
  '릅',
  '릎',
  '릇',
  '름',
  '릉',
  '륵',
  '른'
];

/*
 * ㄹ → ㅇ
 *
 * 려, 력, 련, 렬, 령, 례, 료,
 * 류, 륙, 률, 리, 린, 립 등
 */
const RIEUL_TO_IEUNG = [
  '려',
  '례',
  '료',
  '류',
  '리',
  '력',
  '략',
  '량',
  '련',
  '렬',
  '령',
  '률',
  '린',
  '립',
  '륙',
  '렵',
  '렷',
  '렴',
  '렴',
  '룔',
  '륨',
  '늄'
];

/*
 * 직접 지정해야 하는 변환
 *
 * 두음법칙의 실제 활용에서 자주 문제가 되는 것들
 */
const DIRECT_DUEUM = {
  '녀': '여',
  '년': '연',
  '념': '염',
  '녕': '영',
  '뇨': '요',
  '뉴': '유',
  '니': '이',

  '라': '나',
  '래': '내',
  '로': '노',
  '뢰': '뇌',
  '루': '누',

  '려': '여',
  '례': '예',
  '료': '요',
  '류': '유',
  '리': '이',
  '력': '역',
  '략': '약',
  '량': '양',
  '련': '연',
  '렴': '염',
  '령': '영',
  '렬': '열',
  '률': '율',
  '린': '인',
  '립': '입',
  '륙': '육',
  '렵': '엽',

  /*
   * 끝말잇기에서 많이 사용하는 변환
   */
  '륨': '윰',
  '늄': '윰',

  /*
   * 님 → 임
   */
  '님': '임',

  /*
   * 림 → 임
   */
  '림': '임',

  /*
   * 름 → 음
   */
  '름': '음',

  /*
   * 륨 → 윰
   */
  '륨': '윰'
};

/*
 * 기본 변환표 생성
 */
for (const char of NIEUN_TO_IEUNG) {
  if (!DUEUM[char]) {
    DUEUM[char] = [char];
  }

  if (DIRECT_DUEUM[char]) {
    DUEUM[char].push(DIRECT_DUEUM[char]);
  }
}

for (const char of RIEUL_TO_NIEUN) {
  if (!DUEUM[char]) {
    DUEUM[char] = [char];
  }

  /*
   * ㄹ → ㄴ
   *
   * 라 → 나
   * 래 → 내
   * 로 → 노
   * 루 → 누
   */
  if (DIRECT_DUEUM[char]) {
    DUEUM[char].push(DIRECT_DUEUM[char]);
  }
}

for (const char of RIEUL_TO_IEUNG) {
  if (!DUEUM[char]) {
    DUEUM[char] = [char];
  }

  if (DIRECT_DUEUM[char]) {
    DUEUM[char].push(DIRECT_DUEUM[char]);
  }
}

/*
 * 직접 지정된 변환을 모두 추가
 */
for (const [from, to] of Object.entries(DIRECT_DUEUM)) {
  if (!DUEUM[from]) {
    DUEUM[from] = [from];
  }

  if (!DUEUM[from].includes(to)) {
    DUEUM[from].push(to);
  }
}

/*
 * 일부 끝말잇기에서 허용되는 특수 변환
 */
const EXTRA_DUEUM = {
  '랏': '낫',
  '롯': '놋',
  '롱': '농',
  '룡': '용',
  '륜': '윤',
  '륭': '융',
  '릉': '능',
  '릎': '늪',
  '릇': '늣',
  '륵': '늑',
  '릅': '늡',
  '른': '는'
};

for (const [from, to] of Object.entries(EXTRA_DUEUM)) {
  if (!DUEUM[from]) {
    DUEUM[from] = [from];
  }

  if (!DUEUM[from].includes(to)) {
    DUEUM[from].push(to);
  }
}

/*
 * 허용되는 첫 글자 목록
 *
 * 예:
 * 마지막 글자 = 리
 *
 * 가능:
 * 리...
 * 이...
 */
function allowedFirstChars(lastChar) {
  if (!lastChar) {
    return [];
  }

  const result = [lastChar];

  const alternatives = DUEUM[lastChar];

  if (alternatives) {
    for (const char of alternatives) {
      if (!result.includes(char)) {
        result.push(char);
      }
    }
  }

  return result;
}

/*
 * 실제 단어가 해당 글자로 시작하는지 확인
 */
function canStartWith(word, lastChar) {
  if (!word || !lastChar) {
    return false;
  }

  const allowed =
    allowedFirstChars(lastChar);

  return allowed.includes(word[0]);
}

/* =========================
   공격 데이터
========================= */

function attack() {
  return data?.attackDepth || {};
}

/* =========================
   후보 단어
========================= */

function candidates(ch) {
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
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

/* =========================
   통계
========================= */

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
    ({
      wins = 0,
      losses = 0,
      totalTurns = 0
    } = JSON.parse(
      localStorage.kkeulStats || '{}'
    ));
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
          wins / games * 100
        ) + '%'
      : '0%';

  $('avg').textContent =
    games
      ? (
          totalTurns / games
        ).toFixed(1) + '턴'
      : '-';
}

/* =========================
   기록
========================= */

function addHistory(who, word) {
  const depth =
    attack()[word];

  $('history').insertAdjacentHTML(
    'beforeend',
    `
      <div class="line">
        <b>${esc(who)}</b> · ${esc(word)}
        ${
          depth != null
            ? `<span class="attack">(공격 깊이 ${depth})</span>`
            : ''
        }
      </div>
    `
  );

  $('history').scrollTop =
    $('history').scrollHeight;
}

/* =========================
   시작 단어
========================= */

function getStartWord() {
  const pool =
    data.startPool || [];

  if (!pool.length) {
    throw new Error(
      '시작 단어가 없습니다.'
    );
  }

  return pool[
    Math.floor(
      Math.random() * pool.length
    )
  ];
}

/* =========================
   게임 시작
========================= */

function start() {
  used.clear();

  over = false;

  turn = 0;

  $('history').innerHTML = '';

  $('singleInput').disabled =
    false;

  $('singleSend').disabled =
    false;

  current =
    getStartWord();

  used.add(current);

  $('startWord').value =
    current;

  $('last').textContent =
    current.at(-1);

  $('turn').textContent =
    0;

  $('depth').textContent =
    attack()[current] ?? '-';

  $('message').textContent =
    `시작 단어는 '${current}'. '${current.at(-1)}'로 시작하는 단어를 입력해!`;

  addHistory(
    '시작',
    current
  );

  /*
   * 선공 랜덤
   */
  const playerFirst =
    Math.random() < 0.5;

  if (playerFirst) {
    $('message').textContent =
      `시작 단어는 '${current}'. 네 차례야!`;

    $('singleInput').focus();
  } else {
    $('message').textContent =
      `시작 단어는 '${current}'. AI가 먼저 생각 중...`;

    $('singleInput').disabled =
      true;

    $('singleSend').disabled =
      true;

    setTimeout(
      aiTurn,
      350
    );
  }
}

/* =========================
   게임 종료
========================= */

function finish(aiWon) {
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

  totalTurns += turn;

  saveStats();
  updateStats();

  $('message').textContent =
    aiWon
      ? 'AI 승리!'
      : '플레이어 승리!';
}

/* =========================
   후보 정보
========================= */

function candidateInfo(word) {
  const next =
    candidates(
      word.at(-1)
    );

  const depth =
    attack()[word] != null
      ? Number(
          attack()[word]
        )
      : null;

  return {
    word,
    depth,
    nextCount:
      next.length,
    oneShot:
      next.length === 0
  };
}

/* =========================
   AI 점수
========================= */

function score(word, level) {
  const info =
    candidateInfo(word);

  const depth =
    info.depth == null
      ? 999
      : info.depth;

  const nextCount =
    info.nextCount;

  /*
   * 한방단어
   */
  if (info.oneShot) {
    if (level >= 5) {
      return 100000;
    }

    if (level >= 4) {
      return 50000;
    }

    if (level >= 3) {
      return 1000;
    }

    return -10000;
  }

  /*
   * 공격 단어
   */
  if (info.depth != null) {

    /*
     * Lv.1
     *
     * 공격 단어를 거의 사용하지 않는다.
     */
    if (level === 1) {
      return -10000 - depth;
    }

    /*
     * Lv.2
     *
     * 일반인 정도.
     */
    if (level === 2) {
      return (
        (depth >= 4
          ? 80
          : -30)
        +
        Math.min(
          nextCount,
          30
        )
      );
    }

    /*
     * Lv.3
     */
    if (level === 3) {
      if (depth <= 3) {
        return (
          1000 -
          depth * 100
        );
      }

      if (depth <= 5) {
        return (
          300 -
          depth * 30
        );
      }

      return 50;
    }

    /*
     * Lv.4
     */
    if (level === 4) {
      return (
        5000 -
        depth * 100
      );
    }

    /*
     * Lv.5
     */
    if (level === 5) {
      return (
        100000 -
        depth * 1000
      );
    }
  }

  /*
   * 양보 단어
   */
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
      100 +
      Math.min(
        nextCount,
        60
      )
    );
  }

  if (level === 4) {
    return (
      50 +
      Math.min(
        nextCount,
        30
      )
    );
  }

  /*
   * Lv.5는 양보 단어를 최대한 피한다.
   */
  return (
    -500 +
    Math.min(
      nextCount,
      10
    )
  );
}

/* =========================
   AI 선택
========================= */

function aiPick() {
  const level =
    Number(
      $('difficulty').value
    );

  const list =
    candidates(
      current.at(-1)
    );

  if (!list.length) {
    finish(false);
    return null;
  }

  const infos =
    list.map(candidateInfo);

  /*
   * Lv.5
   *
   * 최우선:
   * 1. 한방단어
   * 2. 공격단어
   * 3. 양보단어
   */
  if (level === 5) {

    const oneShots =
      infos.filter(
        x => x.oneShot
      );

    if (oneShots.length) {
      oneShots.sort(
        (a, b) =>
          (a.depth ?? 999) -
          (b.depth ?? 999)
      );

      return oneShots[0].word;
    }

    const attacks =
      infos.filter(
        x =>
          x.depth != null &&
          !x.oneShot
      );

    if (attacks.length) {
      attacks.sort(
        (a, b) =>
          a.depth -
          b.depth
      );

      return attacks[0].word;
    }

    infos.sort(
      (a, b) =>
        a.nextCount -
        b.nextCount
    );

    return infos[0].word;
  }

  /*
   * Lv.4
   */
  if (level === 4) {

    const attacks =
      infos.filter(
        x =>
          x.depth != null &&
          !x.oneShot
      );

    if (attacks.length) {
      attacks.sort(
        (a, b) =>
          a.depth -
          b.depth
      );

      return attacks[0].word;
    }
  }

  /*
   * Lv.3
   */
  if (level === 3) {

    const shallow =
      infos.filter(
        x =>
          x.depth != null &&
          x.depth <= 3 &&
          !x.oneShot
      );

    if (shallow.length) {

      shallow.sort(
        (a, b) =>
          a.depth -
          b.depth
      );

      const count =
        Math.min(
          3,
          shallow.length
        );

      return shallow[
        Math.floor(
          Math.random() *
          count
        )
      ].word;
    }
  }

  /*
   * Lv.2
   */
  if (level === 2) {

    const sorted =
      [...infos].sort(
        (a, b) =>
          score(
            b.word,
            level
          ) -
          score(
            a.word,
            level
          )
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

  /*
   * Lv.1
   *
   * 절대로 시작부터 한방단어를
   * 고르는 식으로 행동하지 않게 한다.
   */
  if (level === 1) {

    const safe =
      infos.filter(
        x =>
          x.depth == null &&
          !x.oneShot
      );

    if (safe.length) {

      /*
       * 다음 선택지가 많은
       * 양보 단어를 선호한다.
       */
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

    /*
     * 정말 안전한 단어가 없다면
     * 한방단어는 최대한 피한다.
     */
    const nonOneShot =
      infos.filter(
        x => !x.oneShot
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

  return list[
    Math.floor(
      Math.random() *
      list.length
    )
  ];
}

/* =========================
   AI 턴
========================= */

function aiTurn() {
  if (over) {
    return;
  }

  const word =
    aiPick();

  if (!word) {
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

  /*
   * 실제 다음 후보를
   * 두음법칙까지 포함하여 확인
   */
  if (
    candidates(
      word.at(-1)
    ).length === 0
  ) {
    finish(true);
    return;
  }

  $('message').textContent =
    `AI: ${word} → '${word.at(-1)}'`;

  $('singleInput').disabled =
    false;

  $('singleSend').disabled =
    false;

  $('singleInput').focus();
}

/* =========================
   플레이어 입력
========================= */

function submit() {
  if (over) {
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

  if (!data.wordSet[word]) {
    $('message').textContent =
      '목록에 없는 단어야.';
    return;
  }

  if (used.has(word)) {
    $('message').textContent =
      '이미 나온 단어야.';
    return;
  }

  if (
    !canStartWith(
      word,
      current.at(-1)
    )
  ) {
    const last =
      current.at(-1);

    const accepted =
      allowedFirstChars(
        last
      );

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

  /*
   * 두음법칙을 포함하여
   * 다음 단어가 있는지 검사
   */
  if (
    candidates(
      word.at(-1)
    ).length === 0
  ) {
    finish(false);
    return;
  }

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

/* =========================
   싱글 게임 이벤트
========================= */

$('singleSend').onclick =
  submit;

$('singleInput').onkeydown =
  e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

$('restart').onclick =
  start;

$('newStart').onclick =
  start;

/* =========================
   온라인 2인
========================= */

const socket = io();

let room = null;
let myId = null;

let onlineLast = '';
let onlineTurn = null;
let onlineStarted = false;

function roomRender(state) {
  room = state;

  $('roomInfo').innerHTML =
    `
      <b>방 코드: ${esc(
        state.roomCode
      )}</b><br>
      플레이어:
      ${
        state.players
          .map(
            p =>
              `${esc(
                p.name
              )} (P${p.slot})`
          )
          .join(' · ') ||
        '-'
      }<br>
      현재 차례:
      ${
        state.turnPlayer
          ? esc(
              state.players.find(
                p =>
                  p.id ===
                  state.turnPlayer
              )?.name || '-'
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

socket.on(
  'connect',
  () => {
    myId =
      socket.id;
  }
);

socket.on(
  'room_created',
  info => {
    $('roomCode').value =
      info.code;

    $('onlineMessage').textContent =
      '방이 만들어졌어. 친구에게 코드를 알려줘.';
  }
);

socket.on(
  'room_state',
  state => {
    roomRender(state);
  }
);

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

socket.on(
  'game_started',
  info => {

    $('onlineHistory').innerHTML =
      '';

    onlineLast =
      info.startWord;

    onlineTurn =
      info.state.turnPlayer;

    onlineStarted =
      true;

    addOnline(
      '시작',
      info.startWord,
      info.state.lastDepth
    );

    $('onlineMessage').textContent =
      info.state.turnPlayer ===
      myId
        ? `게임 시작! '${info.startWord}' 다음은 네 차례야.`
        : `게임 시작! '${info.startWord}' 다음은 상대방 차례야.`;

    roomRender(
      info.state
    );

    $('onlineInput').value =
      '';
  }
);

function addOnline(
  who,
  word,
  depth
) {
  $('onlineHistory')
    .insertAdjacentHTML(
      'beforeend',
      `
        <div class="line">
          <b>${esc(
            who
          )}</b> · ${esc(
            word
          )}
          ${
            depth != null
              ? `<span class="attack">(공격 깊이 ${depth})</span>`
              : ''
          }
        </div>
      `
    );

  $('onlineHistory').scrollTop =
    $('onlineHistory')
      .scrollHeight;
}

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
      info.winner === myId
        ? '온라인 승리!'
        : '온라인 패배!';
  }
);

/* =========================
   온라인 버튼
========================= */

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

$('startOnline').onclick =
  () => {
    socket.emit(
      'start_online'
    );
  };

$('onlineSend').onclick =
  () => {
    onlineSubmit();
  };

$('onlineInput').onkeydown =
  e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onlineSubmit();
    }
  };

function onlineSubmit() {
  if (!onlineStarted) {
    return;
  }

  if (
    onlineTurn !== myId
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

  if (!data.wordSet[word]) {
    $('onlineMessage').textContent =
      '목록에 없는 단어야.';
    return;
  }

  if (onlineLast) {

    if (
      !canStartWith(
        word,
        onlineLast.at(-1)
      )
    ) {
      const last =
        onlineLast.at(-1);

      const accepted =
        allowedFirstChars(
          last
        );

      $('onlineMessage').textContent =
        accepted.length > 1
          ? `'${last}' 다음에는 ${accepted.join(', ')}으로 시작해야 해.`
          : `'${last}'로 시작해야 해.`;

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

/* =========================
   탭
========================= */

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

/* =========================
   데이터 로딩
========================= */

async function loadData() {

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

    data =
      await response.json();

    /*
     * 단어 Set
     */
    data.wordSet =
      Object.fromEntries(
        data.words.map(
          word => [
            word,
            true
          ]
        )
      );

    /*
     * 첫 글자별 단어
     */
    data.byFirst = {};

    for (
      const word of data.words
    ) {

      const first =
        word[0];

      (
        data.byFirst[first] ||
        (
          data.byFirst[first] = []
        )
      ).push(word);
    }

    /*
     * 서버가 보내준 두음법칙보다
     * 현재 클라이언트 규칙을 사용한다.
     */
    data.dueum =
      DUEUM;

    loadStats();

    start();

  } catch (error) {

    console.error(
      '데이터 로딩 실패:',
      error
    );

    $('message').textContent =
      '게임 데이터를 불러오지 못했어. 잠시 후 새로고침해줘.';
  }
}

/* =========================
   HTML escape
========================= */

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[c])
  );
}

loadData();
