const socket = io();

let mode = null;
let roomCode = null;
let busy = false;

const $ = id => document.getElementById(id);

const notice = text => {
  $('notice').textContent = text || '';
};

function playerName() {
  return $('name').value.trim() || '플레이어';
}

function showGame() {
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');
}

function setBusy(value) {
  busy = value;
  $('submit').disabled = value;
}

function renderLog(entries) {
  const log = $('log');

  const rows = (Array.isArray(entries) ? entries : []).map(item => {
    const li = document.createElement('li');

    li.className = item.system ? 'system-log' : 'word-log';

    li.textContent = item.system ||
      `${item.player}: ${item.word}${item.depth ? ` (깊이 ${item.depth})` : ''}`;

    return li;
  });

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty-log';
    li.textContent = '아직 제출된 단어가 없습니다.';
    rows.push(li);
  }

  log.replaceChildren(...rows);
}

function render(game) {
  showGame();

  $('roomLabel').textContent = roomCode ? `방 코드: ${roomCode}` : 'AI 대전';
  $('required').textContent = game.required;

  $('turn').textContent = !game.started
    ? '참가자를 기다리는 중입니다. (2명부터 시작)'
    : game.gameOver
      ? `${game.winner} 승리!`
      : `${game.players[game.turn]?.name}의 차례`;

  $('word').disabled =
    !game.started ||
    game.gameOver ||
    (mode === 'single' && game.turn !== 0);

  $('submit').disabled = $('word').disabled || busy;

  $('players').replaceChildren(
    ...(game.players || []).map((player, index) => {
      const li = document.createElement('li');

      li.textContent =
        `${index === game.turn && !game.gameOver ? '▶ ' : ''}${player.name}`;

      return li;
    })
  );

  renderLog(game.log);

  if (!game.gameOver && !busy && !$('word').disabled) {
    $('word').focus();
  }
}

function sendWord() {
  if (busy) return;

  const word = $('word').value.trim();

  if (!word) {
    notice('단어를 입력하세요.');
    return;
  }

  setBusy(true);

  if (mode === 'single') {
    socket.emit('single:play', { word });
  } else {
    socket.emit('room:play', { code: roomCode, word });
  }
}

$('single').addEventListener('click', () => {
  mode = 'single';
  roomCode = null;
  notice('');

  socket.emit('single:start', { name: playerName() });
});

$('create').addEventListener('click', () => {
  mode = 'online';
  notice('');

  socket.emit('room:create', { name: playerName() });
});

$('join').addEventListener('click', () => {
  const code = $('roomCode').value.trim();

  if (!code) {
    notice('방 코드를 입력하세요.');
    return;
  }

  mode = 'online';
  notice('');

  socket.emit('room:join', { code, name: playerName() });
});

$('submit').addEventListener('click', sendWord);

$('word').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    sendWord();
  }
});

$('back').addEventListener('click', () => {
  $('game').classList.add('hidden');
  $('lobby').classList.remove('hidden');

  mode = null;
  roomCode = null;
  setBusy(false);
});

socket.on('room:joined', ({ code }) => {
  roomCode = code;
  notice(`방 ${code}에 참가했습니다.`);
});

socket.on('game:state', game => {
  setBusy(false);
  $('word').value = '';
  render(game);
});

socket.on('game:error', message => {
  setBusy(false);
  notice(message);
});

socket.on('connect_error', () => {
  notice('서버 연결이 끊겼습니다.');
});
