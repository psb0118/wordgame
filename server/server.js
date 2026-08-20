const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

console.log('서버 시작: game.js 로딩 전');

const {
  DATA,
  candidatesWithDueum,
  randomStart,
  validateWord
} = require('./game');

console.log('서버 시작: game.js 로딩 완료');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true
  }
});

const PORT = process.env.PORT || 3000;

// ==============================
// 정적 파일
// ==============================

app.use(
  express.static(
    path.join(__dirname, '..', 'client')
  )
);

app.get('/', (_req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      '..',
      'client',
      'index.html'
    )
  );
});

// ==============================
// API
// ==============================

app.get('/api/info', (_req, res) => {
  res.json({
    wordCount: DATA.words.length,
    attackCount: DATA.attackDepth.size
  });
});

app.get('/api/data', (_req, res) => {
  const byFirst = {};

  for (const word of DATA.words) {
    if (!byFirst[word[0]]) {
      byFirst[word[0]] = [];
    }

    byFirst[word[0]].push(word);
  }

  res.json({
    words: DATA.words,
    attackDepth: Object.fromEntries(
      DATA.attackDepth
    ),
    startPool: DATA.startPool,
    byFirst,
    wordSet: Object.fromEntries(
      DATA.words.map(word => [word, true])
    )
  });
});

// ==============================
// 방 관리
// ==============================

const rooms = new Map();

function createRoomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function roomState(room) {
  return {
    roomCode: room.code,

    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      slot: player.slot
    })),

    started: room.started,
    current: room.current,
    turn: room.turn,
    turnPlayer: room.turnPlayer,

    lastDepth: room.current
      ? (
          DATA.attackDepth.get(
            room.current
          ) ?? null
        )
      : null
  };
}

function broadcast(room) {
  io.to(room.code).emit(
    'room_state',
    roomState(room)
  );
}

function leaveRoom(socket) {
  const roomCode = socket.data.room;

  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);

  if (!room) {
    socket.data.room = null;
    return;
  }

  room.players = room.players.filter(
    player => player.id !== socket.id
  );

  socket.leave(room.code);
  socket.data.room = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  room.started = false;
  room.current = null;
  room.used = new Set();
  room.turn = 0;
  room.turnPlayer = null;

  broadcast(room);

  io.to(room.code).emit(
    'notice',
    '상대방이 방을 나갔습니다.'
  );
}

// ==============================
// Socket.IO
// ==============================

io.on('connection', socket => {

  // ============================
  // 방 만들기
  // ============================

  socket.on(
    'create_room',
    ({ name }) => {
      leaveRoom(socket);

      const room = {
        code: createRoomCode(),

        players: [
          {
            id: socket.id,
            name: String(
              name || 'Player 1'
            ).slice(0, 20),
            slot: 1
          }
        ],

        started: false,
        current: null,
        used: new Set(),
        turn: 0,
        turnPlayer: null
      };

      rooms.set(
        room.code,
        room
      );

      socket.data.room = room.code;

      socket.join(
        room.code
      );

      socket.emit(
        'room_created',
        {
          code: room.code
        }
      );

      broadcast(room);
    }
  );

  // ============================
  // 방 참가
  // ============================

  socket.on(
    'join_room',
    ({ code, name }) => {

      const room = rooms.get(
        String(code || '')
          .trim()
          .toUpperCase()
      );

      if (!room) {
        return socket.emit(
          'error_msg',
          '방을 찾을 수 없습니다.'
        );
      }

      if (room.players.length >= 2) {
        return socket.emit(
          'error_msg',
          '방이 가득 찼습니다.'
        );
      }

      leaveRoom(socket);

      room.players.push({
        id: socket.id,

        name: String(
          name || 'Player 2'
        ).slice(0, 20),

        slot: 2
      });

      socket.data.room =
        room.code;

      socket.join(
        room.code
      );

      broadcast(room);
    }
  );

  // ============================
  // 온라인 게임 시작
  // ============================

  socket.on(
    'start_online',
    () => {

      const room = rooms.get(
        socket.data.room
      );

      if (!room) {
        return socket.emit(
          'error_msg',
          '방에 먼저 참가하세요.'
        );
      }

      if (room.players.length !== 2) {
        return socket.emit(
          'error_msg',
          '두 명이 모두 들어와야 시작할 수 있습니다.'
        );
      }

      if (
        room.players[0].id !==
        socket.id
      ) {
        return socket.emit(
          'error_msg',
          '방장만 시작할 수 있습니다.'
        );
      }

      room.started = true;

      room.current =
        randomStart();

      room.used = new Set([
        room.current
      ]);

      room.turn = 0;

      room.turnPlayer =
        room.players[
          Math.floor(
            Math.random() *
            room.players.length
          )
        ].id;

      io.to(
        room.code
      ).emit(
        'game_started',
        {
          state:
            roomState(room),

          startWord:
            room.current
        }
      );
    }
  );

  // ============================
  // 단어 입력
  // ============================

  socket.on(
    'play_word',
    ({ word }) => {

      const room = rooms.get(
        socket.data.room
      );

      // 게임 상태 확인
      if (
        !room ||
        !room.started
      ) {
        return socket.emit(
          'error_msg',
          '진행 중인 게임이 없습니다.'
        );
      }

      // 차례 확인
      if (
        room.turnPlayer !==
        socket.id
      ) {
        return socket.emit(
          'error_msg',
          '상대방의 차례입니다.'
        );
      }

      const w = String(
        word || ''
      ).trim();

      if (!w) {
        return;
      }

      // 기본 단어 검증
      const error =
        validateWord(
          w,
          room.current,
          room.used
        );

      if (error) {
        return socket.emit(
          'error_msg',
          error
        );
      }

      // ========================================
      // 첫 번째 입력 한방단어 방지
      // ========================================

      if (room.turn === 0) {

        const next =
          candidatesWithDueum(
            w.at(-1),
            room.used
          );

        if (next.length === 0) {
          return socket.emit(
            'error_msg',
            '첫 번째 단어로 한방단어는 사용할 수 없습니다.'
          );
        }
      }

      // 단어 사용
      room.used.add(w);

      room.current = w;

      room.turn++;

      // ========================================
      // 상대가 이어갈 수 있는 단어 확인
      // 두음법칙 적용
      // ========================================

      const next =
        candidatesWithDueum(
          w.at(-1),
          room.used
        );

      // 상대가 이어갈 단어가 없음
      if (next.length === 0) {

        room.started = false;

        io.to(
          room.code
        ).emit(
          'game_over',
          {
            winner:
              socket.id,

            word: w,

            turn:
              room.turn
          }
        );

        broadcast(room);

        return;
      }

      // 상대방 차례
      const nextPlayer =
        room.players.find(
          player =>
            player.id !==
            socket.id
        );

      room.turnPlayer =
        nextPlayer
          ? nextPlayer.id
          : null;

      // 단어 전송
      io.to(
        room.code
      ).emit(
        'word_played',
        {
          playerId:
            socket.id,

          word: w,

          depth:
            DATA.attackDepth.get(w) ??
            null,

          state:
            roomState(room)
        }
      );
    }
  );

  // ============================
  // 연결 종료
  // ============================

  socket.on(
    'disconnect',
    () => {
      leaveRoom(socket);
    }
  );
});

// ==============================
// 서버 시작
// ==============================

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `끝말잇기 서버가 포트 ${PORT}에서 실행 중입니다.`
    );
  }
);
