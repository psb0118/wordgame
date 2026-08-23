const $ = id => document.getElementById(id);

/* =========================================================
   기본 상태
========================================================= */

let data = null;

let used = new Set();

let current = '';

let startChar = '';

let turn = 0;

let over = false;

/*
 * 싱글플레이
 *
 * 0 = P1
 * 1 = P2
 */
let currentPlayer = 0;

let p1Wins = 0;
let p2Wins = 0;
let totalTurns = 0;

/* =========================================================
   두음법칙
========================================================= */

let DUEUM = {};

/*
 * 마지막 글자에서 사용할 수 있는 시작 글자
 *
 * 예:
 * 녀 → 녀, 여
 * 력 → 력, 역
 */
function allowedFirstChars(lastChar) {
  if (!lastChar) {
    return [];
  }

  const result = [lastChar];

  const alternatives = DUEUM[lastChar];

  if (Array.isArray(alternatives)) {
    for (const char of alternatives) {
      if (!result.includes(char)) {
        result.push(char);
      }
    }
  }

  return result;
}

/*
 * 이전 단어 뒤에 다음 단어가 연결 가능한지
 */
function canStartWith(word, lastChar) {
  if (!word || !lastChar) {
    return false;
  }

  return allowedFirstChars(lastChar).includes(word[0]);
}

/* =========================================================
   공격 데이터
========================================================= */

function attack() {
  return data?.attackDepth || {};
}

/*
 * attack.txt에 등록된 단어인지
 */
function isAttackWord(word) {
  return attack()[word] != null;
}

/*
 * 공격 깊이
 */
function getAttackDepth(word) {
  const value = attack()[word];

  if (value == null) {
    return null;
  }

  const depth = Number(value);

  return Number.isFinite(depth)
    ? depth
    : null;
}

/*
 * 홀수 깊이 = 공격
 * 짝수 깊이 = 양보
 */
function isWinningAttack(word) {
  const depth = getAttackDepth(word);

  return depth != null && depth % 2 === 1;
}

function isLosingAttack(word) {
  const depth = getAttackDepth(word);

  return depth != null && depth % 2 === 0;
}

/* =========================================================
   단어 존재 확인
========================================================= */

function hasWord(word) {
  if (!data?.wordSet) {
    return false;
  }

  return data.wordSet.has(word);
}

/* =========================================================
   후보 단어
========================================================= */

function candidates(ch, usedSet = used) {
  if (!data || !ch) {
    return [];
  }

  const result = [];

  const firstChars = allowedFirstChars(ch);

  for (const first of firstChars) {
    const list = data.byFirst[first] || [];

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

function countCandidates(ch, usedSet = used) {
  if (!data || !ch) {
    return 0;
  }

  let count = 0;

  const firstChars = allowedFirstChars(ch);

  for (const first of firstChars) {
    const list = data.byFirst[first] || [];

    for (const word of list) {
      if (!usedSet.has(word)) {
        count++;
      }
    }
  }

  return count;
}

/* =========================================================
   한방 단어
========================================================= */

function isOneShot(word, usedSet = used) {
  if (!word) {
    return true;
  }

  const nextUsed = new Set(usedSet);

  nextUsed.add(word);

  return countCandidates(
    word.at(-1),
    nextUsed
  ) === 0;
}

/* =========================================================
   공격 후보
========================================================= */

function attackCandidates(ch, usedSet = used) {
  if (!data || !ch) {
    return [];
  }

  const result = [];

  const firstChars = allowedFirstChars(ch);

  for (const first of firstChars) {
    const list = data.byFirst[first] || [];

    for (const word of list) {
      if (usedSet.has(word)) {
        continue;
      }

      if (!isWinningAttack(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}

/* =========================================================
   모든 공격 후보
========================================================= */

function allAttackCandidates(ch, usedSet = used) {
  if (!data || !ch) {
    return [];
  }

  const result = [];

  const firstChars = allowedFirstChars(ch);

  for (const first of firstChars) {
    const list = data.byFirst[first] || [];

    for (const word of list) {
      if (usedSet.has(word)) {
        continue;
      }

      if (!isAttackWord(word)) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}

/* =========================================================
   공격 분석
========================================================= */

function analyzeWord(word) {
  if (!word) {
    return null;
  }

  const nextUsed = new Set(used);

  nextUsed.add(word);

  const next = candidates(
    word.at(-1),
    nextUsed
  );

  const attackList = attackCandidates(
    word.at(-1),
    nextUsed
  );

  const allAttackList = allAttackCandidates(
    word.at(-1),
    nextUsed
  );

  const depths = allAttackList
    .map(getAttackDepth)
    .filter(depth => depth != null);

  const maxDepth = depths.length
    ? Math.max(...depths)
    : null;

  return {
    word,
    depth: getAttackDepth(word),
    nextCount: next.length,
    attackCount: attackList.length,
    allAttackCount: allAttackList.length,
    maxNextAttackDepth: maxDepth,
    oneShot: next.length === 0,
    winningAttack: isWinningAttack(word),
    losingAttack: isLosingAttack(word)
  };
}

/* =========================================================
   현재 상황 분석
========================================================= */

function analyzeCurrentPosition() {
  if (!current) {
    return {
      nextCount: countCandidates(startChar),
      attackCount: 0,
      maxDepth: null,
      oneShot: false
    };
  }

  const info = analyzeWord(current);

  if (!info) {
    return {
      nextCount: 0,
      attackCount: 0,
      maxDepth: null,
      oneShot: true
    };
  }

  return {
    nextCount: info.nextCount,
    attackCount: info.attackCount,
    maxDepth: info.maxNextAttackDepth,
    oneShot: info.oneShot
  };
}

/* =========================================================
   화면 분석 정보
========================================================= */

function updatePositionInfo() {
  const info = analyzeCurrentPosition();

  /*
   * 기존 depth 영역을
   * "최고 공격 깊이" 용도로 사용
   */
  $('depth').textContent =
    info.maxDepth != null
      ? info.maxDepth
      : '-';

  /*
   * 메시지에 현재 선택지와 공격 정보를
   * 자연스럽게 추가할 수 있도록 저장
   */
  return info;
}

/* =========================================================
   기록
========================================================= */

function addHistory(who, word) {
  const depth = getAttackDepth(word);

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
   승리 처리
========================================================= */

function finish(winner) {
  if (over) {
    return;
  }

  over = true;

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  if (winner === 0) {
    p1Wins++;
  } else {
    p2Wins++;
  }

  totalTurns += turn;

  saveStats();
  updateStats();

  $('message').textContent =
    winner === 0
      ? 'P1 승리!'
      : 'P2 승리!';

  updatePositionInfo();
}

/* =========================================================
   첫 단어 검사
========================================================= */

function validateFirstWord(word) {
  if (!word.startsWith(startChar)) {
    return (
      `'${startChar}'으로 시작하는 단어를 입력해야 해.`
    );
  }

  /*
   * 첫 단어 공격 금지
   */
  if (isAttackWord(word)) {
    return (
      '첫 단어에서는 공격 단어를 사용할 수 없어.'
    );
  }

  /*
   * 첫 단어 한방 금지
   */
  if (isOneShot(word, new Set())) {
    return (
      '첫 단어로 한방 단어는 사용할 수 없어.'
    );
  }

  /*
   * 시작부터 선택지가 너무 적은 단어 방지
   */
  const next = countCandidates(
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
   플레이어 이름
========================================================= */

function playerName(player) {
  return player === 0
    ? 'P1'
    : 'P2';
}

/* =========================================================
   싱글 게임 시작
========================================================= */

function start() {
  if (!data) {
    return;
  }

  used.clear();

  current = '';

  const starts =
    Array.isArray(data.startFirst) &&
    data.startFirst.length
      ? data.startFirst
      : Object.keys(data.byFirst || {});

  if (!starts.length) {
    $('message').textContent =
      '시작 음절을 찾을 수 없어.';
    return;
  }

  startChar =
    starts[
      Math.floor(
        Math.random() *
        starts.length
      )
    ];

  turn = 0;

  over = false;

  currentPlayer =
    Math.random() < 0.5
      ? 0
      : 1;

  $('history').innerHTML = '';

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

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

  $('message').textContent =
    `시작 음절은 '${startChar}'. ${playerName(currentPlayer)}부터 시작해!`;

  updateSingleUI();

  $('singleInput').focus();
}

/* =========================================================
   싱글 UI
========================================================= */

function updateSingleUI() {
  if (over) {
    $('singleInput').disabled = true;
    $('singleSend').disabled = true;
    return;
  }

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  const info =
    analyzeCurrentPosition();

  const player =
    playerName(currentPlayer);

  let text =
    current
      ? `${player} 차례. '${current.at(-1)}'로 시작하는 단어를 입력해.`
      : `${player} 차례. '${startChar}'으로 시작하는 단어를 입력해.`;

  if (current) {
    text +=
      ` 선택지 ${info.nextCount}개`;

    if (info.attackCount > 0) {
      text +=
        ` · 공격 ${info.attackCount}개`;
    }

    if (info.maxDepth != null) {
      text +=
        ` · 최고 공격 깊이 ${info.maxDepth}`;
    }
  }

  $('message').textContent =
    text;

  updatePositionInfo();
}

/* =========================================================
   싱글 입력
========================================================= */

function submit() {
  if (over) {
    return;
  }

  const word =
    $('singleInput')
      .value
      .trim();

  $('singleInput').value = '';

  if (!word) {
    return;
  }

  if (!hasWord(word)) {
    $('message').textContent =
      'word.txt에 없는 단어야.';
    return;
  }

  if (used.has(word)) {
    $('message').textContent =
      '이미 나온 단어야.';
    return;
  }

  /*
   * 첫 단어
   */
  if (!current) {
    const error =
      validateFirstWord(word);

    if (error) {
      $('message').textContent =
        error;
      return;
    }
  }

  /*
   * 이후 단어 연결 검사
   */
  if (
    current &&
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

  /*
   * 단어 적용
   */
  used.add(word);

  current = word;

  turn++;

  addHistory(
    playerName(currentPlayer),
    word
  );

  $('last').textContent =
    word.at(-1);

  $('turn').textContent =
    turn;

  const depth =
    getAttackDepth(word);

  /*
   * 현재 입력한 단어 자체의 공격 깊이 표시
   */
  $('depth').textContent =
    depth != null
      ? depth
      : '-';

  /*
   * 상대방이 이어갈 수 있는지 확인
   */
  const nextCount =
    countCandidates(
      word.at(-1)
    );

  if (nextCount === 0) {
    finish(currentPlayer);
    return;
  }

  /*
   * 다음 플레이어
   */
  currentPlayer =
    currentPlayer === 0
      ? 1
      : 0;

  updateSingleUI();

  $('singleInput').focus();
}

/* =========================================================
   Enter 입력
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

/* =========================================================
   재시작
========================================================= */

$('restart').onclick =
  start;

$('newStart').onclick =
  start;

/* =========================================================
   온라인 상태
========================================================= */

const socket = io();

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

/* =========================================================
   방 생성
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
   방 생성 완료
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
   방 참가
========================================================= */

$('join').onclick =
  () => {
    const code =
      $('roomCode')
        .value
        .trim()
        .toUpperCase();

    if (!code) {
      $('onlineMessage').textContent =
        '방 코드를 입력해줘.';
      return;
    }

    socket.emit(
      'join_room',
      {
        code,
        name:
          $('name')
            .value
            .trim() ||
          'Player'
      }
    );
  };

/* =========================================================
   온라인 상태
========================================================= */

socket.on(
  'room_state',
  state => {
    roomRender(state);
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

$('startOnline').onclick =
  () => {
    socket.emit(
      'start_online'
    );
  };

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
   온라인 단어 적용
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
   온라인 종료
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
   온라인 입력
========================================================= */

$('onlineSend').onclick =
  onlineSubmit;

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
      'word.txt에 없는 단어야.';
    return;
  }

  /*
   * 현재 단어 연결 검사
   */
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
   * 첫 온라인 단어
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

    /*
     * 첫 단어 공격 금지
     */
    if (isAttackWord(word)) {
      $('onlineMessage').textContent =
        '첫 단어에서는 공격 단어를 사용할 수 없어.';
      return;
    }

    /*
     * 첫 단어 한방 금지
     */
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

    /*
     * 선택지가 너무 적은 시작 단어 방지
     */
    const next =
      countCandidates(
        word.at(-1),
        new Set([word])
      );

    if (next < 5) {
      $('onlineMessage').textContent =
        '첫 단어로는 선택지가 너무 적은 단어를 사용할 수 없어.';
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

    if (!result.ready) {
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
     * 전체 단어 Set
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

    /*
     * 서버에서 받은 두음법칙
     */
    DUEUM =
      result.dueum || {};

    loadStats();

    prepareSingleUI();

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
   기존 AI UI 제거/변경
========================================================= */

function prepareSingleUI() {
  /*
   * 기존 난이도 선택 제거
   */
  const difficulty =
    $('difficulty');

  if (difficulty) {
    const label =
      difficulty.closest('label');

    if (label) {
      label.remove();
    } else {
      difficulty.remove();
    }
  }

  /*
   * 시작 단어 표시 변경
   */
  const startInput =
    $('startWord');

  if (startInput) {
    const label =
      startInput.closest('label');

    if (label) {
      label.firstChild.textContent =
        '시작 음절 ';
    }
  }

  /*
   * AI 승률 → P1 승률
   */
  const winrate =
    $('winrate');

  if (winrate) {
    const parent =
      winrate.parentElement;

    if (parent) {
      parent.firstChild.textContent =
        'P1 승률 ';
    }
  }

  /*
   * 카드 이름 변경
   */
  const cards =
    document.querySelectorAll(
      '#single .cards > div'
    );

  if (cards.length >= 4) {
    cards[0].firstChild.textContent =
      'P1 승리';

    cards[1].firstChild.textContent =
      'P2 승리';

    cards[2].firstChild.textContent =
      '전체 게임';

    cards[3].firstChild.textContent =
      '평균 길이';
  }

  /*
   * 헤더 문구
   */
  const headerText =
    document.querySelector(
      'header p'
    );

  if (headerText) {
    headerText.textContent =
      '끄글 단어 목록 기반 · 2인 플레이 · 온라인 2인';
  }
}

/* =========================================================
   통계 저장
========================================================= */

function saveStats() {
  localStorage.kkeulStats =
    JSON.stringify({
      p1Wins,
      p2Wins,
      totalTurns
    });
}

/* =========================================================
   통계 불러오기
========================================================= */

function loadStats() {
  try {
    const saved =
      JSON.parse(
        localStorage.kkeulStats ||
        '{}'
      );

    /*
     * 이전 AI 버전 통계는
     * 그대로 사용하지 않는다.
     */
    p1Wins =
      Number(
        saved.p1Wins || 0
      );

    p2Wins =
      Number(
        saved.p2Wins || 0
      );

    totalTurns =
      Number(
        saved.totalTurns || 0
      );

  } catch {
    p1Wins = 0;
    p2Wins = 0;
    totalTurns = 0;
  }

  updateStats();
}

/* =========================================================
   통계 화면
========================================================= */

function updateStats() {
  const games =
    p1Wins +
    p2Wins;

  $('wins').textContent =
    p1Wins;

  $('losses').textContent =
    p2Wins;

  $('games').textContent =
    games;

  $('winrate').textContent =
    games
      ? Math.round(
          p1Wins /
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
