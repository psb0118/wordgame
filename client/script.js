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
    for (
      const char of alternatives
    ) {
      if (
        !result.includes(char)
      ) {
        result.push(char);
      }
    }
  }

  return result;
}

function canStartWith(
  word,
  lastChar
) {
  if (!word || !lastChar) {
    return false;
  }

  return allowedFirstChars(
    lastChar
  ).includes(
    word[0]
  );
}

/* =========================================================
   공격 데이터
========================================================= */

function attack() {
  return (
    data?.attackDepth || {}
  );
}

/* =========================================================
   단어 존재 확인
========================================================= */

function hasWord(word) {
  if (
    !data ||
    !data.wordSet
  ) {
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
  if (
    !data ||
    !ch
  ) {
    return [];
  }

  const result = [];

  const firstChars =
    allowedFirstChars(ch);

  for (
    const first
    of firstChars
  ) {

    const list =
      data.byFirst[first];

    if (!list) {
      continue;
    }

    for (
      const word
      of list
    ) {

      if (
        !usedSet.has(word)
      ) {
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
  if (
    !data ||
    !ch
  ) {
    return 0;
  }

  let count = 0;

  const firstChars =
    allowedFirstChars(ch);

  for (
    const first
    of firstChars
  ) {

    const list =
      data.byFirst[first];

    if (!list) {
      continue;
    }

    for (
      const word
      of list
    ) {

      if (
        !usedSet.has(word)
      ) {
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
   게임 시작
========================================================= */

function start() {
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
   첫 단어 AI
========================================================= */

function aiFirstCandidates() {
  const list =
    candidates(
      startChar,
      new Set()
    );

  return list.filter(
    word => {

      if (
        attack()[word] != null
      ) {
        return false;
      }

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

function aiFirstTurn() {
  if (over) {
    return;
  }

  const safe =
    aiFirstCandidates();

  let word = null;

  if (safe.length) {

    word =
      safe[
        Math.floor(
          Math.random() *
          safe.length
        )
      ];

  } else {

    /*
     * 안전한 첫 단어가 없을 경우
     * 가능한 일반 단어 중에서 선택.
     */
    const list =
      candidates(
        startChar,
        new Set()
      );

    if (!list.length) {
      finish(false);
      return;
    }

    word =
      list[
        Math.floor(
          Math.random() *
          list.length
        )
      ];
  }

  playAiWord(
    word
  );
}

/* =========================================================
   AI 종료
========================================================= */

function finish(
  aiWon
) {
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
   AI 후보 정보
========================================================= */

function candidateInfo(
  word
) {
  const nextCount =
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
    nextCount,

    oneShot:
      nextCount === 0
  };
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

  if (
    info.depth != null
  ) {

    if (level === 1) {
      return -10000 - depth;
    }

    if (level === 2) {
      return (
        (depth >= 4
          ? 80
          : -30) +
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

  const infos =
    list.map(
      candidateInfo
    );

  /* Lv.5 */

  if (level === 5) {

    const oneShots =
      infos.filter(
        x =>
          x.oneShot
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

  /* Lv.4 */

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

  /* Lv.3 */

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

  /* Lv.2 */

  if (level === 2) {

    const sorted =
      [...infos].sort(
        (a, b) =>
          score(
            b,
            level
          ) -
          score(
            a,
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

  /* Lv.1 */

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
        x =>
          !x.oneShot
      );

    if (
      nonOneShot.length
    ) {

      nonOneShot.sort(
        (a, b) =>
          b.nextCount -
          a.nextCount
      );

      return nonOneShot[0].word;
    }
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

function playAiWord(
  word
) {
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
    `AI: ${word} → '${word.at(-1)}'`;

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

  if (!word) {
    return;
  }

  playAiWord(
    word
  );
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

  if (
    used.has(word)
  ) {
    $('message').textContent =
      '이미 나온 단어야.';
    return;
  }

  /*
   * 첫 단어
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

    /*
     * 일반 단어
     */
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
  }

  /*
   * 상대가 이어갈 수 있는지
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

function validateFirstWordClient(
  word
) {
  if (
    !word.startsWith(
      startChar
    )
  ) {
    return (
      `'${startChar}'으로 시작하는 단어를 입력해야 해.`
    );
  }

  if (
    attack()[word] != null
  ) {
    return (
      '첫 단어에서는 공격 단어를 사용할 수 없어.'
    );
  }

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

function roomRender(
  state
) {
  room = state;

  const players =
    state.players
      .map(
        p =>
          `${esc(p.name)} (P${p.slot})`
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

    roomRender(
      state
    );
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
      allowedFirstChars(
        last
      );

    $('onlineMessage').textContent =
      accepted.length > 1
        ? `'${last}' 다음에는 ${accepted.join(', ')}으로 시작해야 해.`
        : `'${last}'로 시작해야 해.`;

    return;
  }

  /*
   * 첫 온라인 단어는
   * 서버가 최종적으로 다시 검증한다.
   */
  if (
    !onlineLast
  ) {

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
        '첫 단어로 한방 단어는 사용할 수 없어.';

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
     * 클라이언트 단어 Set 생성
     *
     * words 배열을 별도로 받지 않고
     * byFirst에서 바로 생성한다.
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
        data.byFirst[first];

      for (
        const word
        of list
      ) {

        data.wordSet.add(
          word
        );
      }
    }

    /*
     * 서버와 동일한 두음법칙 사용
     */
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

    /*
     * Render에서 game.js가 아직 로딩 중일 수 있다.
     *
     * 잠깐 기다렸다가 다시 시도한다.
     */
    setTimeout(
      loadData,
      1500
    );
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
        '&':
          '&amp;',
        '<':
          '&lt;',
        '>':
          '&gt;',
        '"':
          '&quot;',
        "'":
          '&#039;'
      }[c])
  );
}

/* =========================================================
   시작
========================================================= */

loadData();
