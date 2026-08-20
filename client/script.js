const $ = id => document.getElementById(id);

let data = null;

let used = new Set();
let current = '';
let turn = 0;
let over = false;

let wins = 0;
let losses = 0;
let totalTurns = 0;

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

/*
 * 두음법칙
 */
const DUEUM = {
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
  '닐': ['닐', '일'],
  '닉': ['닉', '익'],
  '뉵': ['뉵', '육'],

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

  '릿': ['릿', '잇'],
  '랸': ['랸', '얀'],
  '룔': ['룔', '욜'],

  '륨': ['륨', '윰'],
  '늄': ['늄', '윰'],

  '녘': ['녘', '옄']
};

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

function allowedFirstChars(lastChar) {
  const result = [lastChar];

  if (DUEUM[lastChar]) {
    for (const c of DUEUM[lastChar]) {
      if (!result.includes(c)) {
        result.push(c);
      }
    }
  }

  return result;
}

function canStartWith(word, lastChar) {
  return allowedFirstChars(lastChar).includes(word[0]);
}

function attack() {
  return data?.attackDepth || {};
}

function candidates(ch) {
  if (!data) return [];

  const result = [];

  for (const first of allowedFirstChars(ch)) {
    const list = data.byFirst[first] || [];

    for (const word of list) {
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

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
    } = JSON.parse(localStorage.kkeulStats || '{}'));
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

/*
 * 시작 단어는 서버에서 받은 startPool을 사용.
 */
function getStartWord() {
  const pool = data.startPool || [];

  if (!pool.length) {
    throw new Error('시작 단어가 없습니다.');
  }

  return pool[
    Math.floor(Math.random() * pool.length)
  ];
}

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
  $('last').textContent = current.at(-1);
  $('turn').textContent = 0;
  $('depth').textContent =
    attack()[current] ?? '-';

  $('message').textContent =
    `시작 단어는 '${current}'. '${current.at(-1)}'로 시작하는 단어를 입력해!`;

  addHistory('시작', current);

  /*
   * 선공 랜덤.
   *
   * true = 사람
   * false = AI
   */
  const playerFirst = Math.random() < 0.5;

  if (playerFirst) {
    $('message').textContent =
      `시작 단어는 '${current}'. 네 차례야!`;
    $('singleInput').focus();
  } else {
    $('message').textContent =
      `시작 단어는 '${current}'. AI가 먼저 생각 중...`;

    $('singleInput').disabled = true;
    $('singleSend').disabled = true;

    setTimeout(aiTurn, 350);
  }
}

function finish(aiWon) {
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

/*
 * 후보의 상태를 평가한다.
 */
function candidateInfo(word) {
  const next = candidates(word.at(-1));

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

/*
 * AI 점수.
 *
 * depth가 낮을수록 공격력이 강하다고 판단.
 * 다음 선택지가 많으면 안전한 단어.
 */
function score(word, level) {
  const info = candidateInfo(word);

  const depth =
    info.depth == null
      ? 999
      : info.depth;

  const nextCount = info.nextCount;

  /*
   * 한방
   */
  if (info.oneShot) {
    if (level >= 5) return 100000;
    if (level >= 4) return 50000;
    if (level >= 3) return 1000;
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
      /*
       * 일반인 느낌.
       * 아주 얕은 공격만 가끔 발견.
       */
      return
        (depth >= 4 ? 80 : -30)
        + Math.min(nextCount, 30);
    }

    if (level === 3) {
      /*
       * 깊이가 너무 깊은 공격은 잘 못 찾는다.
       */
      if (depth <= 3) {
        return 1000 - depth * 100;
      }

      if (depth <= 5) {
        return 300 - depth * 30;
      }

      return 50;
    }

    if (level === 4) {
      /*
       * 공격이 있으면 적극적으로 사용.
       */
      return 5000 - depth * 100;
    }

    if (level === 5) {
      /*
       * 최강.
       * depth 1이 가장 강함.
       */
      return 100000 - depth * 1000;
    }
  }

  /*
   * 양보 단어.
   *
   * 다음 선택지가 많을수록 상대에게 선택지를 많이 주므로
   * 공격적으로는 약한 단어.
   */
  if (level === 1) {
    return 100 + Math.min(nextCount, 100);
  }

  if (level === 2) {
    return 150 + Math.min(nextCount, 100);
  }

  if (level === 3) {
    return 100 + Math.min(nextCount, 60);
  }

  if (level === 4) {
    return 50 + Math.min(nextCount, 30);
  }

  /*
   * Lv.5에서는 양보 단어를 최대한 피함.
   */
  return -500 + Math.min(nextCount, 10);
}

/*
 * AI 후보 선택
 */
function aiPick() {
  const level = Number(
    $('difficulty').value
  );

  const list = candidates(current.at(-1));

  if (!list.length) {
    finish(false);
    return null;
  }

  const infos =
    list.map(candidateInfo);

  /*
   * Lv.5
   *
   * 1. 한방단어
   * 2. 가장 깊이가 낮은 공격
   * 3. 공격 단어가 없을 때만 안전 단어
   */
  if (level === 5) {
    const oneShots =
      infos.filter(x => x.oneShot);

    if (oneShots.length) {
      oneShots.sort(
        (a, b) =>
          (a.depth ?? 999) -
          (b.depth ?? 999)
      );

      return oneShots[0].word;
    }

    const attacks =
      infos.filter(x => x.depth != null);

    if (attacks.length) {
      attacks.sort(
        (a, b) =>
          a.depth - b.depth
      );

      return attacks[0].word;
    }

    /*
     * 공격이 하나도 없다면
     * 상대가 최대한 불리해지는 방향을 선택.
     */
    infos.sort(
      (a, b) =>
        a.nextCount - b.nextCount
    );

    return infos[0].word;
  }

  /*
   * Lv.4
   *
   * 공격이 있으면 공격 우선.
   */
  if (level === 4) {
    const attacks =
      infos.filter(x => x.depth != null);

    if (attacks.length) {
      attacks.sort(
        (a, b) =>
          a.depth - b.depth
      );

      return attacks[0].word;
    }
  }

  /*
   * Lv.3
   *
   * 깊이 1~3 정도의 얕은 공격을 사용.
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
          a.depth - b.depth
      );

      /*
       * 항상 최선만 고르지는 않음.
       */
      const count =
        Math.min(3, shallow.length);

      return shallow[
        Math.floor(Math.random() * count)
      ].word;
    }
  }

  /*
   * Lv.2
   *
   * 일반적인 사람처럼:
   * 너무 완벽한 공격보다는 안전한 단어와
   * 눈에 띄는 공격을 섞어서 사용.
   */
  if (level === 2) {
    const sorted =
      [...infos].sort(
        (a, b) =>
          score(b.word, level) -
          score(a.word, level)
      );

    const count =
      Math.min(8, sorted.length);

    return sorted[
      Math.floor(Math.random() * count)
    ].word;
  }

  /*
   * Lv.1
   *
   * 공격 단어를 거의 사용하지 않는다.
   * 다음 선택지가 많은 양보 단어를 선호.
   */
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
          b.nextCount - a.nextCount
      );

      const count =
        Math.min(15, safe.length);

      return safe[
        Math.floor(Math.random() * count)
      ].word;
    }

    /*
     * 안전한 단어가 없다면 어쩔 수 없이 후보 중 선택.
     */
    return list[
      Math.floor(Math.random() * list.length)
    ];
  }

  return list[
    Math.floor(Math.random() * list.length)
  ];
}

function aiTurn() {
  if (over) return;

  const word = aiPick();

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

  addHistory('AI', word);

  /*
   * AI가 한방단어를 사용했다면 AI 승리.
   */
  if (!candidates(word.at(-1)).length) {
    finish(true);
    return;
  }

  $('message').textContent =
    `AI: ${word} → '${word.at(-1)}'`;

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  $('singleInput').focus();
}

function submit() {
  if (over) return;

  const word =
    $('singleInput').value.trim();

  $('singleInput').value = '';

  if (!word) return;

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

  if (!canStartWith(word, current.at(-1))) {
    const last = current.at(-1);
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

  addHistory('나', word);

  /*
   * 내가 한방단어를 사용해서 AI가 갈 곳이 없으면
   * 내가 승리.
   */
  if (!candidates(word.at(-1)).length) {
    finish(false);
    return;
  }

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  $('message').textContent =
    'AI가 생각 중...';

  setTimeout(aiTurn, 350);
}

$('singleSend').onclick = submit;

$('singleInput').onkeydown = e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submit();
  }
};

$('restart').onclick = start;
$('newStart').onclick = start;


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
                  p.id === state.turnPlayer
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

  /*
   * 내 차례가 아니면 입력을 잠금.
   */
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

socket.on('connect', () => {
  myId = socket.id;
});

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
    $('onlineHistory').innerHTML = '';

    onlineLast =
      info.startWord;

    onlineTurn =
      info.state.turnPlayer;

    onlineStarted = true;

    addOnline(
      '시작',
      info.startWord,
      info.state.lastDepth
    );

    $('onlineMessage').textContent =
      info.state.turnPlayer === myId
        ? `게임 시작! '${info.startWord}' 다음은 네 차례야.`
        : `게임 시작! '${info.startWord}' 다음은 상대방 차례야.`;

    roomRender(info.state);

    $('onlineInput').value = '';
  }
);

function addOnline(who, word, depth) {
  $('onlineHistory').insertAdjacentHTML(
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
          p.id === info.playerId
      );

    addOnline(
      info.playerId === myId
        ? '나'
        : player?.name || '상대',
      info.word,
      info.depth
    );

    roomRender(info.state);

    $('onlineMessage').textContent =
      info.state.turnPlayer === myId
        ? '내 차례야.'
        : '상대방 차례야.';

    $('onlineInput').value = '';
  }
);

socket.on(
  'game_over',
  info => {
    onlineStarted = false;

    $('onlineInput').disabled = true;
    $('onlineSend').disabled = true;

    $('onlineMessage').textContent =
      info.winner === myId
        ? '온라인 승리!'
        : '온라인 패배!';
  }
);

$('create').onclick = () => {
  socket.emit(
    'create_room',
    {
      name:
        $('name').value.trim() ||
        'Player'
    }
  );
};

$('join').onclick = () => {
  socket.emit(
    'join_room',
    {
      code:
        $('roomCode').value.trim(),
      name:
        $('name').value.trim() ||
        'Player'
    }
  );
};

$('startOnline').onclick = () => {
  socket.emit('start_online');
};

$('onlineSend').onclick = () => {
  onlineSubmit();
};

$('onlineInput').onkeydown = e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    onlineSubmit();
  }
};

function onlineSubmit() {
  if (!onlineStarted) return;

  if (onlineTurn !== myId) {
    $('onlineMessage').textContent =
      '아직 네 차례가 아니야.';
    return;
  }

  const word =
    $('onlineInput').value.trim();

  if (!word) return;

  /*
   * 클라이언트에서도 먼저 검사해서
   * 잘못된 입력을 바로 알려준다.
   */
  if (!data.wordSet[word]) {
    $('onlineMessage').textContent =
      '목록에 없는 단어야.';
    return;
  }

  if (onlineLast) {
    if (!canStartWith(
      word,
      onlineLast.at(-1)
    )) {
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

  $('onlineInput').value = '';
}


/* =========================
   탭
========================= */

document
  .querySelectorAll('.tabs button')
  .forEach(button => {
    button.onclick = () => {
      document
        .querySelectorAll('.tabs button')
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
          button.dataset.mode !== 'single'
        );

      $('online')
        .classList
        .toggle(
          'hidden',
          button.dataset.mode !== 'online'
        );
    };
  });


/* =========================
   데이터 로딩
========================= */

async function loadData() {
  try {
    const response =
      await fetch('/api/data');

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
          word => [word, true]
        )
      );

    /*
     * byFirst
     */
    data.byFirst = {};

    for (const word of data.words) {
      const first =
        word[0];

      (
        data.byFirst[first] ||
        (data.byFirst[first] = [])
      ).push(word);
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
