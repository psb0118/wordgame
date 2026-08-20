```javascript
const $ = id => document.getElementById(id);

let data = null;

let used = new Set();
let current = '';
let turn = 0;
let over = false;

let wins = 0;
let losses = 0;
let totalTurns = 0;

/* =========================================================
   시작 음절
========================================================= */

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

/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
  /* ㄴ → ㅇ */
  '녀': ['녀', '여'],
  '년': ['년', '연'],
  '념': ['념', '염'],
  '녕': ['녕', '영'],
  '뇨': ['뇨', '요'],
  '뉴': ['뉴', '유'],
  '니': ['니', '이'],
  '녑': ['녑', '엽'],
  '녁': ['녁', '역'],
  '뇰': ['뇰', '욜'],

  /* ㄹ → ㄴ */
  '라': ['라', '나'],
  '락': ['락', '낙'],
  '란': ['란', '난'],
  '랄': ['랄', '날'],
  '람': ['람', '남'],
  '랑': ['랑', '낭'],
  '래': ['래', '내'],
  '로': ['로', '노'],
  '록': ['록', '녹'],
  '론': ['론', '논'],
  '루': ['루', '누'],
  '뢰': ['뢰', '뇌'],

  /* ㄹ → ㅇ */
  '랴': ['랴', '야'],
  '려': ['려', '여'],
  '례': ['례', '예'],
  '료': ['료', '요'],
  '류': ['류', '유'],
  '리': ['리', '이'],
  '력': ['력', '역'],
  '략': ['략', '약'],
  '량': ['량', '양'],
  '련': ['련', '연'],
  '렴': ['렴', '염'],
  '령': ['령', '영'],
  '렬': ['렬', '열'],
  '률': ['률', '율'],
  '린': ['린', '인'],
  '림': ['림', '임'],
  '립': ['립', '입'],
  '륙': ['륙', '육'],
  '륭': ['륭', '융'],
  '렵': ['렵', '엽'],

  /* 추가 게임용 */
  '레': ['레', '에'],
  '름': ['름', '음'],
  '님': ['님', '임'],
  '륨': ['륨', '윰'],
  '늄': ['늄', '윰'],
  '릉': ['릉', '능'],
  '릅': ['릅', '늡'],
  '른': ['른', '는'],
  '릎': ['릎', '늪'],
  '릇': ['릇', '늣'],
  '륜': ['륜', '윤'],
  '릿': ['릿', '잇'],
  '랸': ['랸', '얀'],
  '룔': ['룔', '욜']
};

function allowedFirstChars(lastChar) {
  if (!lastChar) {
    return [];
  }

  return DUEUM[lastChar] || [lastChar];
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

/* =========================================================
   후보 단어
========================================================= */

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

/* =========================================================
   후보 수
========================================================= */

function countCandidates(ch) {
  if (!data || !ch) {
    return 0;
  }

  const firstChars =
    allowedFirstChars(ch);

  let count = 0;

  for (const first of firstChars) {
    const list =
      data.byFirst[first] || [];

    count += list.length;
  }

  /*
   * 사용된 단어 수만 빼면 되므로
   * 전체 54만 단어를 다시 순회하지 않는다.
   */
  for (const word of used) {
    if (firstChars.includes(word[0])) {
      count--;
    }
  }

  return Math.max(0, count);
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

/* =========================================================
   기록
========================================================= */

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

/* =========================================================
   첫 단어 검사
========================================================= */

function validateFirstWordClient(
  word,
  startChar
) {
  if (!word) {
    return '단어를 입력해주세요.';
  }

  if (!data.wordSet.has(word)) {
    return '목록에 없는 단어야.';
  }

  if (!word.startsWith(startChar)) {
    return `'${startChar}'으로 시작하는 단어를 써야 해.`;
  }

  /*
   * 첫 단어 공격 금지
   */
  if (
    Object.prototype.hasOwnProperty.call(
      attack(),
      word
    )
  ) {
    return '첫 단어에서는 공격 단어를 사용할 수 없어.';
  }

  /*
   * 첫 단어 한방 금지
   */
  const nextCount =
    countCandidatesWithExtraUsed(
      word.at(-1),
      word
    );

  if (nextCount === 0) {
    return '첫 단어로 한방 단어는 사용할 수 없어.';
  }

  if (nextCount < 5) {
    return '첫 단어로는 선택지가 너무 적은 단어를 사용할 수 없어.';
  }

  return null;
}

function countCandidatesWithExtraUsed(
  ch,
  extraWord
) {
  if (!data || !ch) {
    return 0;
  }

  const firstChars =
    allowedFirstChars(ch);

  let count = 0;

  for (const first of firstChars) {
    count +=
      (data.byFirst[first] || []).length;
  }

  for (const word of used) {
    if (firstChars.includes(word[0])) {
      count--;
    }
  }

  if (
    extraWord &&
    !used.has(extraWord) &&
    firstChars.includes(extraWord[0])
  ) {
    count--;
  }

  return Math.max(0, count);
}

/* =========================================================
   게임 시작
========================================================= */

function start() {
  if (!data) {
    return;
  }

  used.clear();

  over = false;

  turn = 0;

  $('history').innerHTML = '';

  $('singleInput').disabled =
    false;

  $('singleSend').disabled =
    false;

  /*
   * 시작 단어가 아니라 시작 음절
   */
  const startChar =
    START_FIRST[
      Math.floor(
        Math.random() *
        START_FIRST.length
      )
    ];

  current = '';

  /*
   * 기존 UI가 startWord를 사용하고 있으므로
   * 그 칸에는 시작 음절을 표시한다.
   */
  $('startWord').value =
    startChar;

  $('last').textContent =
    startChar;

  $('turn').textContent =
    0;

  $('depth').textContent =
    '-';

  $('message').textContent =
    `시작 음절은 '${startChar}'. '${startChar}'로 시작하는 단어를 입력해!`;

  /*
   * 선공 랜덤
   */
  const playerFirst =
    Math.random() < 0.5;

  if (playerFirst) {

    $('message').textContent =
      `시작 음절은 '${startChar}'. 네 차례야!`;

    $('singleInput').focus();

  } else {

    /*
     * 싱글에서는 AI가 첫 단어를 내는 것이 아니라
     * 플레이어에게 먼저 시작 음절을 주고
     * 항상 플레이어가 첫 단어를 고른다.
     *
     * 이렇게 해야 "시작 음절 → 첫 단어" 구조가
     * 명확하게 유지된다.
     */
    $('message').textContent =
      `시작 음절은 '${startChar}'. 첫 단어를 입력해!`;

    $('singleInput').focus();
  }
}

/* =========================================================
   게임 종료
========================================================= */

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

/* =========================================================
   후보 정보
========================================================= */

function candidateInfo(word) {
  const next =
    countCandidates(
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
    nextCount: next,
    oneShot:
      next === 0
  };
}

/* =========================================================
   AI 점수
========================================================= */

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

    if (level === 1) {
      return -10000 - depth;
    }

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

    if (level === 4) {
      return (
        5000 -
        depth * 100
      );
    }

    if (level === 5) {
      return (
        100000 -
        depth * 1000
      );
    }
  }

  /*
   * 일반 단어
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

  return (
    -500 +
    Math.min(
      nextCount,
      10
    )
  );
}

/* =========================================================
   AI 선택
========================================================= */

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

  /*
   * 후보가 너무 많아도
   * 모든 후보마다 candidates()를 다시 만들지 않는다.
   */
  const infos =
    list.map(candidateInfo);

  /* =======================================================
     Lv.5
  ======================================================= */

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

  /* =======================================================
     Lv.4
  ======================================================= */

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

  /* =======================================================
     Lv.3
  ======================================================= */

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

  /* =======================================================
     Lv.2
  ======================================================= */

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

  /* =======================================================
     Lv.1
  ======================================================= */

  if (level === 1) {

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

/* =========================================================
   AI 턴
========================================================= */

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

  if (
    countCandidates(
      word.at(-1)
    ) === 0
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

/* =========================================================
   플레이어 입력
========================================================= */

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

  /*
   * 첫 단어
   */
  if (!current) {

    const startChar =
      $('startWord')
        .value;

    const error =
      validateFirstWordClient(
        word,
        startChar
      );

    if (error) {
      $('message').textContent =
        error;
      return;
    }

  } else {

    /*
     * 일반 단어
     */
    if (!data.wordSet.has(word)) {
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
        allowedFirstChars(last);

      $('message').textContent =
        accepted.length > 1
          ? `'${last}' 다음에는 ${accepted.join(', ')}으로 시작하는 단어를 써야 해.`
          : `'${last}'로 시작해야 해.`;

      return;
    }
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
   * 다음 단어가 없는지 확인
   */
  if (
    countCandidates(
      word.at(-1)
    ) === 0
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

/* =========================================================
   싱글 게임 이벤트
========================================================= */

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

/* =========================================================
   온라인 2인
========================================================= */

const socket = io();

let room = null;
let myId = null;

let onlineLast = '';
let onlineTurn = null;
let onlineStarted = false;
let onlineStartChar = '';

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
      ${
        state.startChar
          ? `시작 음절: <b>${esc(state.startChar)}</b><br>`
          : ''
      }
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

  if (onlineStarted) {

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

    onlineLast = '';

    onlineStartChar =
      info.startChar;

    onlineTurn =
      info.state.turnPlayer;

    onlineStarted =
      true;

    addOnline(
      '시작',
      `시작 음절: ${info.startChar}`,
      null
    );

    $('onlineMessage').textContent =
      info.state.turnPlayer ===
      myId
        ? `게임 시작! '${info.startChar}'로 시작하는 첫 단어를 입력해.`
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

    if (info.state) {
      roomRender(
        info.state
      );
    }
  }
);

/* =========================================================
   온라인 버튼
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

  /*
   * 첫 단어
   */
  if (!onlineLast) {

    if (
      !data.wordSet.has(word)
    ) {
      $('onlineMessage').textContent =
        '목록에 없는 단어야.';
      return;
    }

    if (
      !word.startsWith(
        onlineStartChar
      )
    ) {
      $('onlineMessage').textContent =
        `'${onlineStartChar}'으로 시작하는 단어를 써야 해.`;
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        attack(),
        word
      )
    ) {
      $('onlineMessage').textContent =
        '첫 단어에서는 공격 단어를 사용할 수 없어.';
      return;
    }

  } else {

    if (
      !data.wordSet.has(word)
    ) {
      $('onlineMessage').textContent =
        '목록에 없는 단어야.';
      return;
    }

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

  try {

    /*
     * game.js가 아직 로딩 중이면
     * 잠시 기다렸다가 다시 요청한다.
     */
    let response;

    for (
      let attempt = 0;
      attempt < 30;
      attempt++
    ) {

      response =
        await fetch(
          '/api/data',
          {
            cache: 'no-store'
          }
        );

      if (response.ok) {
        break;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1000
          )
      );
    }

    if (!response || !response.ok) {
      throw new Error(
        `HTTP ${response?.status || 'unknown'}`
      );
    }

    data =
      await response.json();

    /*
     * 서버가 이미 byFirst를 만들어서 보내므로
     * 클라이언트에서 다시 54만 단어를 순회하지 않는다.
     */

    data.wordSet =
      new Set(
        data.words
      );

    /*
     * 서버 규칙과 클라이언트 규칙을 동일하게 유지
     */
    data.dueum =
      DUEUM;

    /*
     * 시작 음절
     */
    if (
      Array.isArray(
        data.startFirst
      ) &&
      data.startFirst.length
    ) {
      START_FIRST.length = 0;

      START_FIRST.push(
        ...data.startFirst
      );
    }

    loadStats();

    start();

    console.log(
      `데이터 로딩 완료: ${data.words.length}개`
    );

  } catch (error) {

    console.error(
      '데이터 로딩 실패:',
      error
    );

    $('message').textContent =
      '게임 데이터를 불러오지 못했어. 잠시 후 새로고침해줘.';
  }
}

/* =========================================================
   HTML escape
========================================================= */

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
```
