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
   시작 단어
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
========================= */

const DUEUM = {
  // ㄴ 계열
  '녀': ['녀', '여'],
  '년': ['년', '연'],
  '념': ['념', '염'],
  '녕': ['녕', '영'],
  '뇨': ['뇨', '요'],
  '뉴': ['뉴', '유'],
  '니': ['니', '이'],

  // ㄹ → ㄴ
  '라': ['라', '나'],
  '락': ['락', '낙'],
  '란': ['란', '난'],
  '랄': ['랄', '날'],
  '람': ['람', '남'],
  '랑': ['랑', '낭'],
  '래': ['래', '내'],
  '뢰': ['뢰', '뇌'],
  '로': ['로', '노'],
  '록': ['록', '녹'],
  '론': ['론', '논'],
  '루': ['루', '누'],
  '륵': ['륵', '늑'],
  '릉': ['릉', '능'],
  '름': ['름', '늠'],
  '릅': ['릅', '늡'],
  '른': ['른', '는'],
  '릎': ['릎', '늪'],
  '릇': ['릇', '늣'],
  '랏': ['랏', '낫'],
  '롯': ['롯', '놋'],
  '롱': ['롱', '농'],
  '룡': ['룡', '용'],
  '륜': ['륜', '윤'],
  '륭': ['륭', '융'],

  // ㄹ → ㅇ
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
  '립': ['립', '입'],
  '륙': ['륙', '육'],
  '렵': ['렵', '엽'],

  // 기타
  '릿': ['릿', '잇'],
  '랸': ['랸', '얀'],
  '룔': ['룔', '욜'],

  // 륨 / 늄 → 윰
  '륨': ['륨', '윰'],
  '늄': ['늄', '윰']
};

/* =========================
   두음법칙 함수
========================= */

function allowedFirstChars(lastChar) {
  if (!lastChar) return [];

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

function canStartWith(word, lastChar) {
  if (!word || !lastChar) return false;

  return allowedFirstChars(lastChar).includes(word[0]);
}

/* =========================
   유틸
========================= */

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

function attack() {
  return data?.attackDepth || {};
}

/* =========================
   후보 단어
========================= */

function candidates(lastChar) {
  if (!data || !lastChar) {
    return [];
  }

  const result = [];

  for (const first of allowedFirstChars(lastChar)) {
    const list = data.byFirst[first] || [];

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
  localStorage.kkeulStats = JSON.stringify({
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

/* =========================
   기록
========================= */

function addHistory(who, word) {
  const depth = attack()[word];

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
  if (!data) {
    throw new Error('게임 데이터가 없습니다.');
  }

  const pool =
    Array.isArray(data.startPool)
      ? data.startPool
      : [];

  /*
   * 서버에서 필터링된 startPool만 사용한다.
   *
   * 따라서:
   * - 가
   * - 나
   * - 다
   * - 마
   * - 사
   * - 자
   * - 기
   * - 시
   *
   * 로 시작하지 않는 단어는 시작 단어가 될 수 없다.
   */

  if (!pool.length) {
    throw new Error(
      '사용할 수 있는 시작 단어가 없습니다.'
    );
  }

  return pool[
    Math.floor(Math.random() * pool.length)
  ];
}

/* =========================
   싱글 게임 시작
========================= */

function start() {
  used.clear();

  over = false;
  turn = 0;

  $('history').innerHTML = '';

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  current = getStartWord();

  used.add(current);

  $('startWord').value = current;

  $('last').textContent =
    current.at(-1);

  $('turn').textContent = 0;

  $('depth').textContent =
    attack()[current] ?? '-';

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

    $('singleInput').disabled = true;
    $('singleSend').disabled = true;

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
  if (over) return;

  over = true;

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

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
    candidates(word.at(-1));

  const depth =
    attack()[word] != null
      ? Number(attack()[word])
      : null;

  return {
    word,
    depth,
    nextCount: next.length,
    oneShot: next.length === 0
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
   * 한방
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
     * 공격 단어를 거의 선택하지 않음.
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

      if (depth >= 4) {
        return (
          80 +
          Math.min(
            nextCount,
            30
          )
        );
      }

      return (
        -30 +
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
   * Lv.5에서는 양보 단어 최대한 피함
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
   * ========================
   * Lv.5
   * ========================
   *
   * 무조건 공격적으로 플레이.
   *
   * 1. 한방
   * 2. 가장 얕은 공격
   * 3. 그 외에는 선택지가 적은 단어
   */
  if (level === 5) {

    const oneShots =
      infos.filter(
        x => x.oneShot
      );

    if (oneShots.length) {

      /*
       * 한방 단어 중에서도
       * 공격 깊이가 있다면 깊이가 낮은 것 우선.
       */
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

    /*
     * 공격이 전혀 없다면
     * 상대 선택지를 최소화.
     */
    infos.sort(
      (a, b) =>
        a.nextCount -
        b.nextCount
    );

    return infos[0].word;
  }

  /*
   * ========================
   * Lv.4
   * ========================
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

      /*
       * 항상 완벽한 1등만 고르지 않고
       * 상위 몇 개 중 선택.
       */
      const count =
        Math.min(
          3,
          attacks.length
        );

      return attacks[
        Math.floor(
          Math.random() * count
        )
      ].word;
    }
  }

  /*
   * ========================
   * Lv.3
   * ========================
   *
   * 얕은 공격을 발견하면 사용.
   * 깊은 공격은 잘 못 찾는 느낌.
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
          4,
          shallow.length
        );

      return shallow[
        Math.floor(
          Math.random() * count
        )
      ].word;
    }
  }

  /*
   * ========================
   * Lv.2
   * ========================
   *
   * 일반인 정도.
   *
   * 모든 단어를 완벽하게 계산하지 않고
   * 상위 후보 일부 중 랜덤 선택.
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
        12,
        sorted.length
      );

    return sorted[
      Math.floor(
        Math.random() * count
      )
    ].word;
  }

  /*
   * ========================
   * Lv.1
   * ========================
   *
   * 거의 무조건 양보 단어.
   *
   * 공격 깊이가 있는 단어와
   * 한방단어를 최대한 피한다.
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
       * 다음 선택지가 많은 단어를
       * 우선적으로 선택.
       */
      safe.sort(
        (a, b) =>
          b.nextCount -
          a.nextCount
      );

      /*
       * 가장 안전한 후보 20개 중 랜덤.
       */
      const count =
        Math.min(
          20,
          safe.length
        );

      return safe[
        Math.floor(
          Math.random() * count
        )
      ].word;
    }

    /*
     * 안전 단어가 정말 하나도 없다면
     * 한방단어보다는 일반 단어 우선.
     */
    const normal =
      infos.filter(
        x =>
          x.depth == null
      );

    if (normal.length) {

      return normal[
        Math.floor(
          Math.random() *
          normal.length
        )
      ].word;
    }

    /*
     * 마지막 수단
     */
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
  if (over) return;

  const word =
    aiPick();

  if (!word) return;

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
   * AI가 한방단어를 사용했으면
   * AI 승리.
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
   사람 턴
========================= */

function submit() {
  if (over) return;

  const word =
    $('singleInput')
      .value
      .trim();

  $('singleInput').value = '';

  if (!word) return;

  /*
   * 단어 목록 검사
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
   * 두음법칙 포함 검사
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

  /*
   * AI가 갈 곳이 없으면
   * 플레이어 승리.
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
   싱글 버튼
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

/* =========================
   방 상태 렌더링
========================= */

function roomRender(state) {

  room = state;

  $('roomInfo').innerHTML =
    `
      <b>방 코드: ${esc(state.roomCode)}</b><br>
      플레이어:
      ${
        state.players
          .map(
            p =>
              `${esc(p.name)} (P${p.slot})`
          )
          .join(' · ') || '-'
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
    state.players[0]?.id === myId;

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
      state.turnPlayer === myId;

    $('onlineInput').disabled =
      !myTurn;

    $('onlineSend').disabled =
      !myTurn;
  }
}

/* =========================
   Socket
========================= */

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

/* =========================
   온라인 게임 시작
========================= */

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
      info.state.turnPlayer === myId
        ? `게임 시작! '${info.startWord}' 다음은 네 차례야.`
        : `게임 시작! '${info.startWord}' 다음은 상대방 차례야.`;

    roomRender(
      info.state
    );

    $('onlineInput').value =
      '';
  }
);

/* =========================
   온라인 기록
========================= */

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
    $('onlineHistory').scrollHeight;
}

/* =========================
   온라인 단어
========================= */

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
      info.state.turnPlayer === myId
        ? '내 차례야.'
        : '상대방 차례야.';

    $('onlineInput').value =
      '';
  }
);

/* =========================
   온라인 종료
========================= */

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
   방 만들기
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

/* =========================
   방 참가
========================= */

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

/* =========================
   온라인 시작
========================= */

$('startOnline').onclick =
  () => {

    socket.emit(
      'start_online'
    );
  };

/* =========================
   온라인 전송
========================= */

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

  if (onlineTurn !== myId) {

    $('onlineMessage').textContent =
      '아직 네 차례가 아니야.';

    return;
  }

  const word =
    $('onlineInput')
      .value
      .trim();

  if (!word) return;

  /*
   * 단어 목록 검사
   */
  if (!data.wordSet[word]) {

    $('onlineMessage').textContent =
      '목록에 없는 단어야.';

    return;
  }

  /*
   * 두음법칙 검사
   */
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
        allowedFirstChars(last);

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
     * wordSet
     */
    data.wordSet =
      Object.fromEntries(
        data.words.map(
          word =>
            [word, true]
        )
      );

    /*
     * byFirst
     *
     * 서버에서 내려준 값이 없더라도
     * 클라이언트에서 다시 생성한다.
     */
    data.byFirst = {};

    for (
      const word
      of data.words
    ) {

      const first =
        word[0];

      (
        data.byFirst[first] ||
        (
          data.byFirst[first] =
            []
        )
      ).push(word);
    }

    /*
     * startPool이 서버에서
     * 내려오지 않았을 경우를 대비한
     * 안전장치.
     *
     * 단, 서버의 startPool이 있으면
     * 서버 것을 그대로 사용한다.
     */
    if (
      !Array.isArray(
        data.startPool
      ) ||
      !data.startPool.length
    ) {

      data.startPool =
        data.words.filter(
          word =>
            START_FIRST.includes(
              word[0]
            ) &&
            !(word in attack()) &&
            word.length >= 2
        );
    }

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

loadData();
