const $ = id => document.getElementById(id);

let data = null;

let used = new Set();
let current = '';
let turn = 0;
let over = false;

let wins = 0;
let losses = 0;
let totalTurns = 0;

/*
 * =========================================================
 * 두음법칙
 * =========================================================
 */

const DUEUM = {
  '녀': ['녀', '여'],
  '뇨': ['뇨', '요'],
  '뉴': ['뉴', '유'],
  '니': ['니', '이'],

  '려': ['려', '여'],
  '료': ['료', '요'],
  '류': ['류', '유'],
  '리': ['리', '이'],

  '라': ['라', '나'],
  '래': ['래', '내'],
  '로': ['로', '노'],
  '뢰': ['뢰', '뇌'],
  '루': ['루', '누'],
  '르': ['르', '느']
};

function allowedFirstChars(lastChar) {
  const result = new Set([lastChar]);

  const group = DUEUM[lastChar];

  if (group) {
    for (const c of group) {
      result.add(c);
    }
  }

  for (const chars of Object.values(DUEUM)) {
    if (chars.includes(lastChar)) {
      for (const c of chars) {
        result.add(c);
      }
    }
  }

  return [...result];
}

/*
 * =========================================================
 * 기본 유틸
 * =========================================================
 */

function attack() {
  return data?.attackDepth || {};
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[c])
  );
}

/*
 * 현재 글자에서 실제로 연결 가능한 단어
 *
 * 서버와 같은 두음법칙을 브라우저에서도 적용한다.
 */

function candidates(ch, localUsed = used) {
  if (!data) return [];

  const result = [];
  const firstChars = allowedFirstChars(ch);

  for (const first of firstChars) {
    const list = data.byFirst[first] || [];

    for (const word of list) {
      if (!localUsed.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

/*
 * 특정 단어를 냈을 때 상대가 갈 수 있는 단어 수
 */

function nextCount(word, localUsed = used) {
  const nextUsed = new Set(localUsed);
  nextUsed.add(word);

  return candidates(word.at(-1), nextUsed).length;
}

/*
 * 공격 깊이
 */

function depthOf(word) {
  return attack()[word] ?? null;
}

/*
 * 공격 단어인지
 */

function isAttack(word) {
  return depthOf(word) !== null;
}

/*
 * 한방단어인지
 */

function isOneHit(word, localUsed = used) {
  return nextCount(word, localUsed) === 0;
}

/*
 * 상대 선택지가 많은 단어
 *
 * 숫자가 클수록 상대가 유리하다.
 */

function yieldScore(word, localUsed = used) {
  return nextCount(word, localUsed);
}

/*
 * =========================================================
 * 통계
 * =========================================================
 */

function saveStats() {
  localStorage.kkeulStats = JSON.stringify({
    wins,
    losses,
    totalTurns
  });
}

function loadStats() {
  try {
    const obj = JSON.parse(
      localStorage.kkeulStats || '{}'
    );

    wins = obj.wins || 0;
    losses = obj.losses || 0;
    totalTurns = obj.totalTurns || 0;
  } catch {
    wins = 0;
    losses = 0;
    totalTurns = 0;
  }

  updateStats();
}

function updateStats() {
  const games = wins + losses;

  $('wins').textContent = wins;
  $('losses').textContent = losses;
  $('games').textContent = games;

  $('winrate').textContent =
    games
      ? Math.round(wins / games * 100) + '%'
      : '0%';

  $('avg').textContent =
    games
      ? (totalTurns / games).toFixed(1) + '턴'
      : '-';
}

/*
 * =========================================================
 * 싱글플레이 기록
 * =========================================================
 */

function addHistory(who, word) {
  const d = depthOf(word);

  $('history').insertAdjacentHTML(
    'beforeend',
    `
      <div class="line">
        <b>${esc(who)}</b> · ${esc(word)}
        ${
          d != null
            ? ` <span class="attack">(공격 깊이 ${d})</span>`
            : ''
        }
      </div>
    `
  );

  $('history').scrollTop =
    $('history').scrollHeight;
}

/*
 * =========================================================
 * 게임 시작
 * =========================================================
 */

function start() {
  if (!data || !data.startPool?.length) {
    return;
  }

  used.clear();

  over = false;
  turn = 0;

  $('history').innerHTML = '';

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  /*
   * game.js에서 이미
   *
   * 가 / 나 / 다 / 마 / 사 / 자 / 기 / 시
   *
   * + 비공격
   * + 한방 제외
   *
   * 조건으로 걸러진 단어다.
   */

  const pool = data.startPool;

  current =
    pool[
      Math.floor(
        Math.random() * pool.length
      )
    ];

  used.add(current);

  $('startWord').value = current;

  $('last').textContent =
    current.at(-1);

  $('turn').textContent = 0;

  $('depth').textContent =
    depthOf(current) ?? '-';

  addHistory('시작', current);

  /*
   * 첫 턴은 AI/플레이어 중 랜덤
   */

  const aiFirst =
    Math.random() < 0.5;

  if (aiFirst) {
    $('message').textContent =
      `시작 단어는 '${current}'. AI가 먼저 시작합니다.`;

    $('singleInput').disabled = true;
    $('singleSend').disabled = true;

    setTimeout(aiTurn, 400);
  } else {
    $('message').textContent =
      `시작 단어는 '${current}'. 당신이 먼저입니다. '${current.at(-1)}'로 시작하는 단어를 입력해!`;

    $('singleInput').disabled = false;
    $('singleSend').disabled = false;

    $('singleInput').focus();
  }
}

/*
 * =========================================================
 * 게임 종료
 * =========================================================
 */

function finish(playerWon) {
  over = true;

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  if (playerWon) {
    wins++;
    $('message').textContent =
      '플레이어 승리!';
  } else {
    losses++;
    $('message').textContent =
      'AI 승리!';
  }

  totalTurns += turn;

  saveStats();
  updateStats();
}

/*
 * =========================================================
 * AI 평가
 * =========================================================
 *
 * AI가 모든 단어를 똑같이 잘 사용하지 않도록
 * 단계별로 후보를 제한한다.
 */

function analyze(word, localUsed = used) {
  const depth = depthOf(word);

  const nextMoves =
    nextCount(word, localUsed);

  const oneHit =
    nextMoves === 0;

  const attackWord =
    depth !== null;

  return {
    word,
    depth,
    nextMoves,
    oneHit,
    attackWord,
    yieldWord: !attackWord
  };
}

/*
 * =========================================================
 * Lv.1
 * =========================================================
 *
 * 거의 일부러 지는 AI
 *
 * 공격 단어:
 *   거의 사용하지 않음
 *
 * 한방:
 *   사용하지 않음
 *
 * 상대 선택지가:
 *   많을수록 좋음
 */

function aiLevel1(list) {
  const safe = list.filter(
    word => {
      const info = analyze(word);

      return (
        !info.attackWord &&
        !info.oneHit
      );
    }
  );

  if (safe.length) {
    safe.sort(
      (a, b) =>
        yieldScore(b) -
        yieldScore(a)
    );

    /*
     * 너무 완벽하게 가장 약한 수만 고르지 않고
     * 위쪽 후보 중 랜덤 선택
     */
    const count =
      Math.min(12, safe.length);

    return safe[
      Math.floor(
        Math.random() * count
      )
    ];
  }

  /*
   * 정말 후보가 없으면 공격 단어 중에서도
   * 상대에게 선택지를 많이 주는 것을 선택
   */
  list.sort(
    (a, b) =>
      yieldScore(b) -
      yieldScore(a)
  );

  return list[
    Math.floor(
      Math.random() *
      Math.min(8, list.length)
    )
  ];
}

/*
 * =========================================================
 * Lv.2
 * =========================================================
 *
 * 일반적인 사람 느낌
 *
 * 너무 깊은 공격은 일부러 찾지 않는다.
 * 선택지가 너무 적은 것도 피한다.
 */

function aiLevel2(list) {
  const normal = list.filter(
    word => {
      const info = analyze(word);

      /*
       * 깊이가 있는 공격 단어라도
       * 너무 깊은 것은 거의 고려하지 않음
       */
      return (
        info.depth == null ||
        info.depth >= 4
      ) &&
      !info.oneHit;
    }
  );

  if (!normal.length) {
    return list[
      Math.floor(
        Math.random() * list.length
      )
    ];
  }

  /*
   * 적당한 선택지 + 너무 어려운 공격 회피
   */
  normal.sort(
    (a, b) => {

      const A = analyze(a);
      const B = analyze(b);

      const aScore =
        Math.min(A.nextMoves, 30) +
        (A.depth == null ? 8 : 0);

      const bScore =
        Math.min(B.nextMoves, 30) +
        (B.depth == null ? 8 : 0);

      return bScore - aScore;
    }
  );

  const count =
    Math.min(10, normal.length);

  return normal[
    Math.floor(
      Math.random() * count
    )
  ];
}

/*
 * =========================================================
 * Lv.3
 * =========================================================
 *
 * 공격 기회가 있으면 사용.
 * 하지만 깊은 공격은 잘 사용하지 않음.
 */

function aiLevel3(list) {
  const usableAttack =
    list.filter(word => {

      const info = analyze(word);

      return (
        info.attackWord &&
        info.depth <= 3 &&
        !info.oneHit
      );
    });

  /*
   * 공격 후보가 있으면 어느 정도 사용
   */
  if (usableAttack.length) {

    usableAttack.sort(
      (a, b) =>
        (depthOf(a) ?? 999) -
        (depthOf(b) ?? 999)
    );

    const count =
      Math.min(
        5,
        usableAttack.length
      );

    /*
     * 항상 최고의 공격만 쓰지는 않음
     */
    return usableAttack[
      Math.floor(
        Math.random() * count
      )
    ];
  }

  /*
   * 공격이 없으면 일반 단어
   */
  const normal =
    list.filter(
      word => !isOneHit(word)
    );

  if (normal.length) {
    return normal[
      Math.floor(
        Math.random() *
        normal.length
      )
    ];
  }

  return list[0];
}

/*
 * =========================================================
 * Lv.4
 * =========================================================
 *
 * 공격 단어를 적극적으로 사용.
 *
 * 가능한 경우:
 *   깊이가 낮을수록 좋음
 *
 * 양보 단어:
 *   가급적 사용하지 않음
 */

function aiLevel4(list) {

  /*
   * 한방단어가 있으면 매우 높은 우선순위
   */
  const oneHit =
    list.filter(
      word => isOneHit(word)
    );

  if (oneHit.length) {

    const attacks =
      oneHit.filter(
        word => isAttack(word)
      );

    if (attacks.length) {
      attacks.sort(
        (a, b) =>
          (depthOf(a) ?? 999) -
          (depthOf(b) ?? 999)
      );

      return attacks[0];
    }

    return oneHit[0];
  }

  /*
   * 공격 단어
   */
  const attacks =
    list.filter(
      word => isAttack(word)
    );

  if (attacks.length) {

    attacks.sort(
      (a, b) => {

        const A = analyze(a);
        const B = analyze(b);

        /*
         * 깊이 우선
         */
        if (A.depth !== B.depth) {
          return A.depth - B.depth;
        }

        /*
         * 상대 선택지 적은 것
         */
        return A.nextMoves - B.nextMoves;
      }
    );

    return attacks[0];
  }

  /*
   * 공격 단어가 없으면 양보 단어 중에서도
   * 상대 선택지를 적게 주는 쪽
   */
  list.sort(
    (a, b) =>
      yieldScore(a) -
      yieldScore(b)
  );

  return list[0];
}

/*
 * =========================================================
 * Lv.5
 * =========================================================
 *
 * 최강 AI
 *
 * 우선순위:
 *
 * 1. 한방
 * 2. 공격 깊이가 있는 단어
 * 3. 상대 선택지 최소화
 * 4. 양보 단어 최대한 회피
 */

function aiLevel5(list) {

  /*
   * 1순위: 즉시 한방
   */
  const oneHit =
    list.filter(
      word => isOneHit(word)
    );

  if (oneHit.length) {

    const attackOneHit =
      oneHit.filter(
        word => isAttack(word)
      );

    if (attackOneHit.length) {

      attackOneHit.sort(
        (a, b) =>
          (depthOf(a) ?? 999) -
          (depthOf(b) ?? 999)
      );

      return attackOneHit[0];
    }

    return oneHit[0];
  }

  /*
   * 2순위: 공격 단어
   */
  const attacks =
    list.filter(
      word => isAttack(word)
    );

  if (attacks.length) {

    attacks.sort(
      (a, b) => {

        const A = analyze(a);
        const B = analyze(b);

        /*
         * 깊이가 더 좋은 공격 우선
         */
        if (A.depth !== B.depth) {
          return A.depth - B.depth;
        }

        /*
         * 상대 선택지가 적은 공격 우선
         */
        if (A.nextMoves !== B.nextMoves) {
          return A.nextMoves - B.nextMoves;
        }

        /*
         * 긴 단어도 약간 선호
         */
        return b.length - a.length;
      }
    );

    return attacks[0];
  }

  /*
   * 3순위: 양보 단어밖에 없는 경우
   *
   * 그래도 상대에게 선택지를 최대한 적게 줌
   */
  list.sort(
    (a, b) => {

      const A = analyze(a);
      const B = analyze(b);

      if (A.nextMoves !== B.nextMoves) {
        return A.nextMoves - B.nextMoves;
      }

      return b.length - a.length;
    }
  );

  return list[0];
}

/*
 * =========================================================
 * AI 선택
 * =========================================================
 */

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
    finish(true);
    return null;
  }

  if (level === 1) {
    return aiLevel1(list);
  }

  if (level === 2) {
    return aiLevel2(list);
  }

  if (level === 3) {
    return aiLevel3(list);
  }

  if (level === 4) {
    return aiLevel4(list);
  }

  return aiLevel5(list);
}

/*
 * =========================================================
 * AI 턴
 * =========================================================
 */

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
    depthOf(word) ?? '-';

  addHistory('AI', word);

  /*
   * AI가 한방을 냈으면 AI 승리
   */
  if (isOneHit(word)) {
    finish(false);
    return;
  }

  $('message').textContent =
    `AI: ${word} → '${word.at(-1)}'`;

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  $('singleInput').focus();
}

/*
 * =========================================================
 * 플레이어 입력
 * =========================================================
 */

function submit() {

  if (over) {
    return;
  }

  const input =
    $('singleInput');

  const word =
    input.value.trim();

  input.value = '';

  if (!word) {
    return;
  }

  /*
   * 목록 검사
   */
  if (!data.wordSet[word]) {
    $('message').textContent =
      '목록에 없는 단어야.';
    return;
  }

  /*
   * 중복 검사
   */
  if (used.has(word)) {
    $('message').textContent =
      '이미 나온 단어야.';
    return;
  }

  /*
   * 두음법칙 포함 연결 검사
   */
  const allowed =
    allowedFirstChars(
      current.at(-1)
    );

  if (!allowed.includes(word[0])) {

    $('message').textContent =
      `'${current.at(-1)}'로 시작해야 해. 허용: ${allowed.join(', ')}`;

    return;
  }

  /*
   * 첫 단어 이후에는 정상적으로 진행
   */
  used.add(word);

  current = word;

  turn++;

  $('last').textContent =
    word.at(-1);

  $('turn').textContent =
    turn;

  $('depth').textContent =
    depthOf(word) ?? '-';

  addHistory('나', word);

  /*
   * 내가 한방단어를 냈다면 승리
   */
  if (isOneHit(word)) {
    finish(true);
    return;
  }

  /*
   * AI에게 턴 전달
   */
  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  $('message').textContent =
    'AI가 생각 중...';

  /*
   * 단계별로 생각하는 시간 차이를 줌
   */
  const level =
    Number(
      $('difficulty').value
    );

  const delay =
    level === 1
      ? 300
      : level === 2
        ? 500
        : level === 3
          ? 700
          : level === 4
            ? 900
            : 1100;

  setTimeout(
    aiTurn,
    delay
  );
}

/*
 * =========================================================
 * 버튼
 * =========================================================
 */

$('singleSend').onclick =
  submit;

$('singleInput').onkeydown =
  event => {
    if (event.key === 'Enter') {
      submit();
    }
  };

$('restart').onclick =
  start;

$('newStart').onclick =
  start;

/*
 * =========================================================
 * 온라인
 * =========================================================
 */

const socket = io();

let room = null;
let myId = null;

let onlineLast = '';
let onlineTurn = null;
let onlineStarted = false;

/*
 * 연결
 */

socket.on(
  'connect',
  () => {
    myId = socket.id;
  }
);

/*
 * 방 상태 표시
 */

function roomRender(state) {

  room = state;

  const players =
    state.players || [];

  const playerText =
    players.length
      ? players
          .map(
            player =>
              `${esc(player.name)} (P${player.slot})`
          )
          .join(' · ')
      : '-';

  let turnText =
    '대기 중';

  if (state.turnPlayer) {

    const player =
      players.find(
        p =>
          p.id === state.turnPlayer
      );

    if (player) {
      turnText =
        player.id === myId
          ? '내 차례'
          : `${player.name}의 차례`;
    }
  }

  $('roomInfo').innerHTML =
    `
      <b>방 코드: ${esc(state.roomCode)}</b>
      <br>
      플레이어: ${playerText}
      <br>
      현재 차례: ${turnText}
    `;

  /*
   * 방장 + 두 명 + 게임 시작 전
   */
  $('startOnline').classList.toggle(
    'hidden',
    !(
      players[0]?.id === myId &&
      !state.started &&
      players.length === 2
    )
  );

  /*
   * 내 차례면 입력 가능
   */
  if (
    state.started &&
    state.turnPlayer === myId
  ) {
    $('onlineInput').disabled = false;
    $('onlineSend').disabled = false;
  } else {
    $('onlineInput').disabled = true;
    $('onlineSend').disabled = true;
  }
}

/*
 * 방 생성
 */

socket.on(
  'room_created',
  result => {

    $('roomCode').value =
      result.code;

    $('onlineMessage').textContent =
      '방이 만들어졌어. 친구에게 코드를 알려줘.';
  }
);

/*
 * 메시지
 */

socket.on(
  'notice',
  message => {
    $('onlineMessage').textContent =
      message;
  }
);

/*
 * 서버 오류
 */

socket.on(
  'error_msg',
  message => {
    $('onlineMessage').textContent =
      message;
  }
);

/*
 * =========================================================
 * 온라인 게임 시작
 * =========================================================
 */

socket.on(
  'game_started',
  result => {

    $('onlineHistory').innerHTML = '';

    onlineLast =
      result.startWord;

    onlineTurn =
      result.firstPlayer;

    onlineStarted = true;

    addOnline(
      '시작',
      result.startWord,
      result.state.lastDepth
    );

    roomRender(
      result.state
    );

    if (
      result.firstPlayer === myId
    ) {
      $('onlineMessage').textContent =
        `게임 시작! '${result.startWord}' 다음은 내 차례야.`;
    } else {
      $('onlineMessage').textContent =
        `게임 시작! '${result.startWord}' 다음은 상대방 차례야.`;
    }
  }
);

/*
 * =========================================================
 * 온라인 기록
 * =========================================================
 */

function addOnline(
  who,
  word,
  depth
) {

  $('onlineHistory').insertAdjacentHTML(
    'beforeend',
    `
      <div class="line">
        <b>${esc(who)}</b> · ${esc(word)}
        ${
          depth != null
            ? ` <span class="attack">(공격 깊이 ${depth})</span>`
            : ''
        }
      </div>
    `
  );

  $('onlineHistory').scrollTop =
    $('onlineHistory').scrollHeight;
}

/*
 * =========================================================
 * 온라인 단어 수신
 * =========================================================
 */

socket.on(
  'word_played',
  result => {

    onlineLast =
      result.word;

    onlineTurn =
      result.state.turnPlayer;

    const player =
      result.state.players.find(
        p =>
          p.id === result.playerId
      );

    const who =
      result.playerId === myId
        ? '나'
        : (
            player?.name ||
            '상대'
          );

    addOnline(
      who,
      result.word,
      result.depth
    );

    roomRender(
      result.state
    );

    if (
      result.state.turnPlayer === myId
    ) {
      $('onlineMessage').textContent =
        '내 차례야.';
    } else {
      $('onlineMessage').textContent =
        '상대방 차례야.';
    }
  }
);

/*
 * =========================================================
 * 온라인 게임 종료
 * =========================================================
 */

socket.on(
  'game_over',
  result => {

    onlineStarted = false;

    $('onlineInput').disabled = true;
    $('onlineSend').disabled = true;

    if (
      result.winner === myId
    ) {
      $('onlineMessage').textContent =
        '온라인 승리!';
    } else {
      $('onlineMessage').textContent =
        '온라인 패배!';
    }

    if (result.state) {
      roomRender(
        result.state
      );
    }
  }
);

/*
 * =========================================================
 * 방 만들기
 * =========================================================
 */

$('create').onclick =
  () => {

    const name =
      $('name').value.trim() ||
      'Player';

    socket.emit(
      'create_room',
      {
        name
      }
    );
  };

/*
 * =========================================================
 * 방 참가
 * =========================================================
 */

$('join').onclick =
  () => {

    const code =
      $('roomCode').value
        .trim()
        .toUpperCase();

    const name =
      $('name').value.trim() ||
      'Player';

    socket.emit(
      'join_room',
      {
        code,
        name
      }
    );
  };

/*
 * =========================================================
 * 온라인 게임 시작
 * =========================================================
 */

$('startOnline').onclick =
  () => {
    socket.emit(
      'start_online'
    );
  };

/*
 * =========================================================
 * 온라인 단어 입력
 * =========================================================
 */

$('onlineSend').onclick =
  onlineSubmit;

$('onlineInput').onkeydown =
  event => {

    if (
      event.key === 'Enter'
    ) {
      onlineSubmit();
    }
  };

function onlineSubmit() {

  if (!onlineStarted) {
    return;
  }

  if (onlineTurn !== myId) {
    $('onlineMessage').textContent =
      '상대방의 차례야.';
    return;
  }

  const input =
    $('onlineInput');

  const word =
    input.value.trim();

  if (!word) {
    return;
  }

  /*
   * 클라이언트에서 빠른 연결 검사
   *
   * 최종 판정은 서버가 한다.
   */
  if (onlineLast) {

    const allowed =
      allowedFirstChars(
        onlineLast.at(-1)
      );

    if (!allowed.includes(word[0])) {

      $('onlineMessage').textContent =
        `'${onlineLast.at(-1)}'로 시작해야 해. 허용: ${allowed.join(', ')}`;

      return;
    }
  }

  socket.emit(
    'play_word',
    {
      word
    }
  );

  input.value = '';
}

/*
 * =========================================================
 * 탭
 * =========================================================
 */

document
  .querySelectorAll('.tabs button')
  .forEach(button => {

    button.onclick =
      () => {

        document
          .querySelectorAll(
            '.tabs button'
          )
          .forEach(
            other =>
              other.classList.remove(
                'active'
              )
          );

        button.classList.add(
          'active'
        );

        $('single')
          .classList.toggle(
            'hidden',
            button.dataset.mode !==
              'single'
          );

        $('online')
          .classList.toggle(
            'hidden',
            button.dataset.mode !==
              'online'
          );
      };
  });

/*
 * =========================================================
 * 데이터 로딩
 * =========================================================
 */

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
     * 빠른 검색용 Set
     */
    data.wordSet =
      Object.fromEntries(
        data.words.map(
          word => [word, true]
        )
      );

    /*
     * 서버에서 받은 byFirst 사용
     */
    if (!data.byFirst) {

      data.byFirst = {};

      for (
        const word of data.words
      ) {

        (
          data.byFirst[word[0]] ??=
            []
        ).push(word);
      }
    }

    loadStats();

    start();

  } catch (error) {

    console.error(
      '데이터 로딩 실패:',
      error
    );

    $('message').textContent =
      '게임 데이터를 불러오지 못했습니다.';
  }
}

/*
 * 시작
 */

loadData();
