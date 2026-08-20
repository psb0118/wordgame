const $ = id => document.getElementById(id);

let data = null;
let used = new Set();
let current = '';
let turn = 0;
let over = false;

let wins = 0;
let losses = 0;
let totalTurns = 0;

const attack = () => data?.attackDepth || {};

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
  const g = wins + losses;

  $('wins').textContent = wins;
  $('losses').textContent = losses;
  $('games').textContent = g;

  $('winrate').textContent =
    g ? Math.round(wins / g * 100) + '%' : '0%';

  $('avg').textContent =
    g ? (totalTurns / g).toFixed(1) + '턴' : '-';
}

/*
 * 두음법칙 연결 가능 여부
 *
 * 예:
 * 력 → 역
 * 려 → 여
 * 류 → 유
 * 녀 → 여
 * 뇨 → 요
 * 니 → 이
 */
function canConnect(currentWord, nextWord) {
  if (!currentWord || !nextWord) return true;

  const last = currentWord.at(-1);
  const first = nextWord[0];

  if (last === first) return true;

  const rules = {
    '력': ['역'],
    '렬': ['열'],
    '례': ['예'],
    '료': ['요'],
    '류': ['유'],
    '리': ['이'],
    '라': ['나'],
    '래': ['내'],
    '로': ['노'],
    '뢰': ['뇌'],
    '루': ['누'],
    '르': ['느'],

    '녀': ['여'],
    '뇨': ['요'],
    '뉴': ['유'],
    '니': ['이'],
    '냐': ['야']
  };

  return (rules[last] || []).includes(first);
}

function candidates(ch) {
  const result = new Set();

  for (const w of data.byFirst[ch] || []) {
    if (!used.has(w)) {
      result.add(w);
    }
  }

  const rules = {
    '력': ['역'],
    '렬': ['열'],
    '례': ['예'],
    '료': ['요'],
    '류': ['유'],
    '리': ['이'],
    '라': ['나'],
    '래': ['내'],
    '로': ['노'],
    '뢰': ['뇌'],
    '루': ['누'],
    '르': ['느'],
    '녀': ['여'],
    '뇨': ['요'],
    '뉴': ['유'],
    '니': ['이'],
    '냐': ['야']
  };

  for (const first of rules[ch] || []) {
    for (const w of data.byFirst[first] || []) {
      if (!used.has(w)) {
        result.add(w);
      }
    }
  }

  return [...result];
}

function addHistory(who, w) {
  $('history').insertAdjacentHTML(
    'beforeend',
    `<div class="line"><b>${esc(who)}</b> · ${esc(w)}${
      attack()[w] != null
        ? ` <span class="attack">(공격 깊이 ${attack()[w]})</span>`
        : ''
    }</div>`
  );

  $('history').scrollTop = $('history').scrollHeight;
}

function start() {
  used.clear();
  over = false;
  turn = 0;

  $('history').innerHTML = '';

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  const pool = data.startPool;

  current =
    pool[Math.floor(Math.random() * pool.length)];

  used.add(current);

  $('startWord').value = current;
  $('last').textContent = current.at(-1);
  $('turn').textContent = 0;
  $('depth').textContent = attack()[current] ?? '-';

  $('message').textContent =
    `시작 단어는 '${current}'. '${current.at(-1)}'로 시작하는 단어를 입력해!`;

  addHistory('시작', current);

  $('singleInput').focus();
}

function finish(ai) {
  over = true;

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  if (ai) {
    wins++;
  } else {
    losses++;
  }

  totalTurns += turn;

  saveStats();
  updateStats();

  $('message').textContent =
    ai ? 'AI 승리!' : '플레이어 승리!';
}

function score(w, lv) {
  const d = attack()[w] ?? 99;
  const n = candidates(w.at(-1)).length;

  let s =
    (100 - d) * 5 +
    Math.max(0, 40 - n) +
    Math.min(20, w.length * 2);

  if (lv >= 4) {
    s += Math.random() * 3;
  }

  return s;
}

function aiPick() {
  const lv = +$('difficulty').value;
  const c = candidates(current.at(-1));

  if (!c.length) {
    finish(false);
    return null;
  }

  if (lv === 5) {
    const immediate = c.filter(
      w => candidates(w.at(-1)).length === 0
    );

    if (immediate.length) {
      return immediate.sort(
        (a, b) =>
          (attack()[a] ?? 999) -
          (attack()[b] ?? 999)
      )[0];
    }

    const a = c.filter(w => attack()[w] != null);

    if (a.length) {
      return a.sort(
        (x, y) =>
          (attack()[x] ?? 999) -
          (attack()[y] ?? 999)
      )[0];
    }
  }

  let a =
    lv < 5
      ? c.filter(w => attack()[w] == null)
      : c;

  if (!a.length) a = c;

  if (lv === 1) {
    return a[Math.floor(Math.random() * a.length)];
  }

  a.sort(
    (x, y) =>
      score(y, lv) - score(x, lv)
  );

  if (lv === 2) {
    return a[
      Math.floor(
        Math.random() * Math.min(10, a.length)
      )
    ];
  }

  if (lv === 3) {
    return a[
      Math.floor(
        Math.random() * Math.min(4, a.length)
      )
    ];
  }

  return a[0];
}

function aiTurn() {
  if (over) return;

  const w = aiPick();

  if (!w) return;

  used.add(w);
  current = w;
  turn++;

  $('last').textContent = w.at(-1);
  $('turn').textContent = turn;
  $('depth').textContent = attack()[w] ?? '-';

  addHistory('AI', w);

  if (!candidates(w.at(-1)).length) {
    finish(true);
    return;
  }

  $('message').textContent =
    `AI: ${w} → '${w.at(-1)}'`;

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  $('singleInput').focus();
}

function submit() {
  if (over) return;

  const w = $('singleInput').value.trim();
  $('singleInput').value = '';

  if (!w) return;

  if (!data.wordSet[w]) {
    $('message').textContent =
      '목록에 없는 단어야.';
    return;
  }

  if (used.has(w)) {
    $('message').textContent =
      '이미 나온 단어야.';
    return;
  }

  if (!canConnect(current, w)) {
    $('message').textContent =
      `'${current.at(-1)}'에서 이어지는 단어가 아니야.`;
    return;
  }

  used.add(w);
  current = w;
  turn++;

  $('last').textContent = w.at(-1);
  $('turn').textContent = turn;
  $('depth').textContent = attack()[w] ?? '-';

  addHistory('나', w);

  if (!candidates(w.at(-1)).length) {
    return finish(false);
  }

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  $('message').textContent =
    'AI가 생각 중...';

  setTimeout(aiTurn, 250);
}

$('singleSend').onclick = submit;

$('singleInput').onkeydown = e => {
  if (e.key === 'Enter') {
    submit();
  }
};

$('restart').onclick = start;
$('newStart').onclick = start;

$('difficulty').onchange = () => {};

async function loadData() {
  const r = await fetch('/api/data');

  if (!r.ok) {
    throw new Error('단어 데이터를 불러오지 못했습니다.');
  }

  data = await r.json();

  data.wordSet =
    Object.fromEntries(
      data.words.map(w => [w, true])
    );

  data.byFirst = {};

  for (const w of data.words) {
    (data.byFirst[w[0]] ??= []).push(w);
  }

  loadStats();
  start();
}

/* 온라인 */
const socket = io();

let room = null;
let myId = null;
let onlineLast = '';
let onlineTurn = null;
let onlineStarted = false;

function updateOnlineInput() {
  const myTurn =
    onlineStarted &&
    onlineTurn === myId;

  $('onlineInput').disabled = !myTurn;
  $('onlineSend').disabled = !myTurn;

  if (myTurn) {
    $('onlineInput').focus();
  }
}

function roomRender(s) {
  room = s;

  const currentPlayer =
    s.turnPlayer
      ? (
          s.players.find(
            p => p.id === s.turnPlayer
          )?.name || '-'
        )
      : '대기 중';

  $('roomInfo').innerHTML =
    `<b>방 코드: ${esc(s.roomCode)}</b><br>` +
    `플레이어: ${
      s.players
        .map(
          p =>
            esc(p.name) +
            ` (P${p.slot})`
        )
        .join(' · ') || '-'
    }<br>` +
    `현재 차례: ${esc(currentPlayer)}`;

  $('startOnline').classList.toggle(
    'hidden',
    !(
      s.players[0]?.id === myId &&
      !s.started &&
      s.players.length === 2
    )
  );

  updateOnlineInput();
}

function addOnline(who, w, d) {
  $('onlineHistory').insertAdjacentHTML(
    'beforeend',
    `<div class="line"><b>${esc(who)}</b> · ${esc(w)}${
      d != null
        ? ` <span class="attack">(공격 깊이 ${d})</span>`
        : ''
    }</div>`
  );

  $('onlineHistory').scrollTop =
    $('onlineHistory').scrollHeight;
}

socket.on('connect', () => {
  myId = socket.id;

  if (room) {
    roomRender(room);
  }
});

socket.on('room_created', x => {
  $('roomCode').value = x.code;

  $('onlineMessage').textContent =
    '방이 만들어졌어. 친구에게 코드를 알려줘.';
});

socket.on('room_state', roomRender);

socket.on('notice', m => {
  $('onlineMessage').textContent = m;
});

socket.on('error_msg', m => {
  $('onlineMessage').textContent = m;
  updateOnlineInput();
});

socket.on('game_started', x => {
  $('onlineHistory').innerHTML = '';

  $('onlineMessage').textContent =
    `게임 시작! 시작 단어: ${x.startWord}`;

  onlineLast = x.startWord;
  onlineTurn = x.state.turnPlayer;
  onlineStarted = true;

  addOnline(
    '시작',
    x.startWord,
    x.state.lastDepth
  );

  roomRender(x.state);
});

socket.on('word_played', x => {
  onlineLast = x.word;
  onlineTurn = x.state.turnPlayer;

  addOnline(
    x.playerId === myId
      ? '나'
      : (
          x.state.players.find(
            p => p.id === x.playerId
          )?.name || '상대'
        ),
    x.word,
    x.depth
  );

  roomRender(x.state);

  $('onlineMessage').textContent =
    x.state.turnPlayer === myId
      ? '내 차례야.'
      : '상대방 차례야.';

  updateOnlineInput();
});

socket.on('game_over', x => {
  $('onlineMessage').textContent =
    x.winner === myId
      ? '온라인 승리!'
      : '온라인 패배!';

  onlineStarted = false;
  onlineTurn = null;

  updateOnlineInput();
});

$('create').onclick = () => {
  socket.emit('create_room', {
    name:
      $('name').value.trim() ||
      'Player'
  });
};

$('join').onclick = () => {
  socket.emit('join_room', {
    code: $('roomCode').value,
    name:
      $('name').value.trim() ||
      'Player'
  });
};

$('startOnline').onclick = () => {
  socket.emit('start_online');
};

$('onlineSend').onclick = onlineSubmit;

$('onlineInput').onkeydown = e => {
  if (e.key === 'Enter') {
    onlineSubmit();
  }
};

function onlineSubmit() {
  if (!onlineStarted) {
    $('onlineMessage').textContent =
      '아직 게임이 시작되지 않았어.';
    return;
  }

  if (onlineTurn !== myId) {
    $('onlineMessage').textContent =
      '상대방 차례야.';
    return;
  }

  const word =
    $('onlineInput').value.trim();

  if (!word) return;

  $('onlineInput').value = '';

  socket.emit(
    'play_word',
    { word }
  );
}

document
  .querySelectorAll('.tabs button')
  .forEach(b => {
    b.onclick = () => {
      document
        .querySelectorAll('.tabs button')
        .forEach(x =>
          x.classList.remove('active')
        );

      b.classList.add('active');

      $('single').classList.toggle(
        'hidden',
        b.dataset.mode !== 'single'
      );

      $('online').classList.toggle(
        'hidden',
        b.dataset.mode !== 'online'
      );

      if (b.dataset.mode === 'online') {
        updateOnlineInput();
      }
    };
  });

loadData().catch(err => {
  console.error(err);

  $('message').textContent =
    '게임 데이터를 불러오지 못했습니다.';
});
