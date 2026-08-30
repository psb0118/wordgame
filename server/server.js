const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Rules = require('./game.js');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');

const FILES = {
  words: '끄글_단어 목록_20260823005529.txt',
  attack: '끄글_공격 단어_20260823005527.txt',
  required: '끄글_필수 공격 단어_20260823005527.txt',
  defense: '끄글_방어 단어_20260823005525.txt',
  roots: '끄글_주요 루트 단어_20260823005524.txt',
  rareRoots: '끄글_희귀 루트 단어_20260823005524.txt',
  cycle: '끄글_돌림 단어_20260823005523.txt',
  syllables: '끄글_음절 목록_20260823005528.txt'
};

function read(name) {
  const filePath = path.join(DATA, FILES[name]);

  if (!fs.existsSync(filePath)) {
    throw new Error(`공식 데이터 파일이 없습니다: ${FILES[name]}`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function parseDepthFile(text) {
  const result = new Map();
  let syllable = '';

  for (const raw of text.split(/\r?\n/)) {
    const section = raw.match(/^\[([^\]]+)]\s*$/);

    if (section) {
      syllable = section[1];
      continue;
    }

    const depth = raw.match(/^깊이\s+(\d+)\s*:\s*(.*)$/);

    if (!depth || !syllable) continue;

    for (const word of depth[2].split(',').map(Rules.normalize).filter(Boolean)) {
      result.set(word, Number(depth[1]));
    }
  }

  return result;
}

function parseLooseWords(text) {
  return new Set((text.match(/[가-힣]{2,}/g) || []).map(Rules.normalize));
}

function loadDictionary() {
  const words = new Set(
    read('words')
      .split(/\r?\n/)
      .map(Rules.normalize)
      .filter(Boolean)
  );

  if (!words.size) {
    throw new Error('단어 목록이 비어 있습니다.');
  }

  const byFirst = new Map();

  for (const word of words) {
    const first = word[0];
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first).push(word);
  }

  return {
    words,
    byFirst,
    attackDepth: parseDepthFile(read('attack')),
    required: parseLooseWords(read('required')),
    defense: parseLooseWords(read('defense')),
    roots: parseLooseWords(read('roots')),
    rareRoots: parseLooseWords(read('rareRoots')),
    cycle: parseLooseWords(read('cycle'))
  };
}

const dict = loadDictionary();

console.log(
  `공식 단어 ${dict.words.size.toLocaleString()}개, 공격 단어 ${dict.attackDepth.size.toLocaleString()}개를 로드했습니다.`
);

function choicesFor(syllable, used) {
  return Rules.charsFor(syllable)
    .flatMap(char => dict.byFirst.get(char) || [])
    .filter(word => !used.has(word));
}

function initialSyllable() {
  const viable = Rules.START_SYLLABLES.filter(
    syllable => choicesFor(syllable, new Set()).length > 1
  );

  return viable[Math.floor(Math.random() * viable.length)];
}

function score(word, used) {
  const depth = dict.attackDepth.get(word);
  const replies = choicesFor(word.at(-1), used).length;

  const depthScore = depth
    ? (depth % 2 ? 110 - depth * 4 : -65 + depth * 3)
    : 0;

  return depthScore - Math.min(replies, 50) + Math.random() * 42;
}

function chooseAi(game) {
  const options = choicesFor(game.required, game.used);

  if (!options.length) return null;

  const sampled = options.length > 450
    ? Array.from({ length: 450 }, () => options[Math.floor(Math.random() * options.length)])
    : options;

  return sampled.sort((a, b) => score(b, game.used) - score(a, game.used))[0];
}

function publicGame(game) {
  return {
    id: game.id,
    mode: game.mode,
    started: game.mode === 'single' || game.players.length >= 2,
    required: game.required,
    currentWord: game.currentWord,
    turn: game.turn,
    players: game.players,
    usedCount: game.used.size,
    log: game.log.slice(-16),
    gameOver: game.gameOver,
    winner: game.winner
  };
}

function newGame(mode, players) {
  return {
    id: Math.random().toString(36).slice(2),
    mode,
    players,
    required: initialSyllable(),
    currentWord: '',
    turn: 0,
    used: new Set(),
    log: [],
    gameOver: false,
    winner: null,
    aiTimer: null
  };
}

function play(game, word, playerIndex) {
  word = Rules.normalize(word);

  if (game.gameOver) return { error: '이미 끝난 게임입니다.' };

  if (game.mode === 'online' && game.players.length < 2) {
    return { error: '온라인 게임은 2명 이상 입장해야 시작할 수 있습니다.' };
  }

  if (game.turn !== playerIndex) return { error: '현재 당신의 차례가 아닙니다.' };
  if (!Rules.HANGUL.test(word)) return { error: '한글 단어만 입력할 수 있습니다.' };
  if (!dict.words.has(word)) return { error: '공식 단어 목록에 없는 단어입니다.' };
  if (game.used.has(word)) return { error: '이미 사용한 단어입니다.' };

  if (!Rules.canConnect(game.required, word)) {
    return { error: `첫 음절은 ‘${game.required}’와 연결되어야 합니다.` };
  }

  game.used.add(word);
  game.currentWord = word;
  game.required = word.at(-1);

  game.log.push({
    player: game.players[playerIndex].name,
    word,
    depth: dict.attackDepth.get(word) || null
  });

  const next = (playerIndex + 1) % game.players.length;

  if (!choicesFor(game.required, game.used).length) {
    game.gameOver = true;
    game.winner = game.players[playerIndex].name;
    game.log.push({ system: `${game.winner} 승리! 다음 단어가 없습니다.` });
  } else {
    game.turn = next;
  }

  return { ok: true };
}

const app = express();

app.use(express.static(__dirname));

app.get('/health', (_request, response) => {
  response.json({ ok: true, words: dict.words.size });
});

const server = http.createServer(app);
const io = new Server(server);
const games = new Map();
const rooms = new Map();

function emitGame(game, room) {
  io.to(room).emit('game:state', publicGame(game));
}

function scheduleAi(game, room) {
  clearTimeout(game.aiTimer);

  if (game.gameOver || game.mode !== 'single' || game.turn !== 1) return;

  const gameId = game.id;

  game.aiTimer = setTimeout(() => {
    if (game.id !== gameId || game.gameOver || game.turn !== 1) return;

    const word = chooseAi(game);

    if (!word) {
      game.gameOver = true;
      game.winner = game.players[0].name;
    } else {
      play(game, word, 1);
    }

    emitGame(game, room);
  }, 700 + Math.random() * 700);
}

io.on('connection', socket => {
  socket.on('single:start', ({ name } = {}) => {
    const game = newGame('single', [
      { name: Rules.normalize(name).slice(0, 12) || '플레이어' },
      { name: 'AI' }
    ]);

    games.set(socket.id, game);
    emitGame(game, socket.id);
  });

  socket.on('single:play', ({ word } = {}) => {
    const game = games.get(socket.id);

    if (!game) {
      socket.emit('game:error', '새 게임을 시작하세요.');
      return;
    }

    const result = play(game, word, 0);

    if (result.error) {
      socket.emit('game:error', result.error);
      return;
    }

    emitGame(game, socket.id);
    scheduleAi(game, socket.id);
  });

  socket.on('room:create', ({ name } = {}) => {
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();

    const game = newGame('online', [
      {
        id: socket.id,
        name: Rules.normalize(name).slice(0, 12) || '방장'
      }
    ]);

    rooms.set(code, game);
    socket.join(`room:${code}`);
    socket.emit('room:joined', { code });

    emitGame(game, `room:${code}`);
  });

  socket.on('room:join', ({ code, name } = {}) => {
    code = String(code || '').trim().toUpperCase();

    const game = rooms.get(code);

    if (!game) {
      socket.emit('game:error', '방을 찾을 수 없습니다.');
      return;
    }

    if (game.gameOver || game.players.length >= 8) {
      socket.emit('game:error', '참가할 수 없는 방입니다.');
      return;
    }

    game.players.push({
      id: socket.id,
      name: Rules.normalize(name).slice(0, 12) || '참가자'
    });

    socket.join(`room:${code}`);
    socket.emit('room:joined', { code });

    emitGame(game, `room:${code}`);
  });

  socket.on('room:play', ({ code, word } = {}) => {
    const roomCode = String(code || '').toUpperCase();
    const game = rooms.get(roomCode);

    if (!game) {
      socket.emit('game:error', '방을 찾을 수 없습니다.');
      return;
    }

    const playerIndex = game.players.findIndex(player => player.id === socket.id);
    const result = play(game, word, playerIndex);

    if (result.error) {
      socket.emit('game:error', result.error);
      return;
    }

    emitGame(game, `room:${roomCode}`);
  });

  socket.on('disconnect', () => {
    games.delete(socket.id);

    for (const [code, game] of rooms) {
      const playerIndex = game.players.findIndex(player => player.id === socket.id);

      if (playerIndex < 0) continue;

      game.players.splice(playerIndex, 1);

      if (!game.players.length) {
        rooms.delete(code);
        continue;
      }

      if (game.turn >= game.players.length) {
        game.turn = 0;
      }

      emitGame(game, `room:${code}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
