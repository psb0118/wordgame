const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

console.log('서버 시작');

/* =========================================================
   기본 서버
========================================================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

/*
 * game.js가 아직 로딩되지 않았을 때 요청을 처리하기 위한 상태
 */
let game = null;
let gameLoading = true;

/* =========================================================
   정적 파일
========================================================= */

app.use(
  express.static(
    path.join(__dirname, '..', 'client')
  )
);

/* =========================================================
   기본 페이지
========================================================= */

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

/* =========================================================
   데이터 API
========================================================= */

app.get('/api/info', (_req, res) => {
  if (gameLoading || !game) {
    return res.status(503).json({
      ready: false,
      message: '게임 데이터를 준비하는 중입니다.'
    });
  }

  res.json({
    ready: true,
    wordCount: game.DATA.words.length,
    attackCount: game.DATA.attackDepth.size,
    startCount: game.DATA.startPool.length
  });
});

app.get('/api/data', (_req, res) => {
  if (gameLoading || !game) {
    return res.status(503).json({
      ready: false,
      message: '게임 데이터를 준비하는 중입니다.'
    });
  }

  /*
   * game.js에서 이미 만들어 놓은 byFirst를
   * JSON 객체로 변환한다.
   *
   * 매 요청마다 54만 단어를 다시 순회하지 않음.
   */
  const byFirst = {};

  for (const [first, list] of game.DATA.byFirst.entries()) {
    byFirst[first] = list;
  }

  res.json({
    ready: true,
    words: game.DATA.words,
    attackDepth: Object.fromEntries(
      game.DATA.attackDepth
    ),
    startPool: game.DATA.startPool,
    byFirst
  });
});

/* =========================================================
   방 관리
========================================================= */

const rooms = new Map();

function generateRoomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function getRoomState(room) {
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

    firstPlayer: room.firstPlayer,

    lastDepth:
      room.current && game
        ? game.getAttackDepth(room.current)
        : null
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit(
    'room_state',
    getRoomState(room)
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

  /*
   * 한 명만 남으면 게임 초기화
   */
  room.started = false;
  room.current = null;
  room.used = new Set();
  room.turn = 0;
  room.turnPlayer = null;
  room.firstPlayer = null;

  broadcastRoom(room);

  io.to(room.code).emit(
    'notice',
    '상대방이 방을 나갔습니다.'
  );
}

/* =========================================================
   게임 시작
========================================================= */

function startRoomGame(room) {
  if (!game) {
    return {
      error: '게임 데이터를 아직 준비하는 중입니다.'
    };
  }

  if (room.players.length !== 2) {
    return {
      error:
        '두 명이 모두 들어와야 시작할 수 있습니다.'
    };
  }

  const startWord =
    game.randomStart();

  room.started = true;
  room.current = startWord;
  room.used = new Set([startWord]);
  room.turn = 0;

  /*
   * 선공 랜덤
   */
  const firstIndex =
    Math.floor(
      Math.random() *
      room.players.length
    );

  room.firstPlayer =
    room.players[firstIndex].id;

  room.turnPlayer =
    room.players[firstIndex].id;

  return {
    startWord,
    firstPlayer: room.firstPlayer
  };
}

/* =========================================================
   Socket.IO
========================================================= */

io.on('connection', socket => {

  console.log(
    `클라이언트 접속: ${socket.id}`
  );

  /*
   * 방 생성
   */
  socket.on('create_room', ({ name }) => {

    leaveRoom(socket);

    const roomCode =
      generateRoomCode();

    const playerName =
      String(name || 'Player 1')
        .trim()
        .slice(0, 20) ||
      'Player 1';

    const room = {
      code: roomCode,

      players: [
        {
          id: socket.id,
          name: playerName,
          slot: 1
        }
      ],

      started: false,

      current: null,

      used: new Set(),

      turn: 0,

      turnPlayer: null,

      firstPlayer: null
    };

    rooms.set(
      roomCode,
      room
    );

    socket.data.room =
      roomCode;

    socket.join(roomCode);

    socket.emit(
      'room_created',
      {
        code: roomCode
      }
    );

    broadcastRoom(room);

    console.log(
      `${playerName}님이 방 생성: ${roomCode}`
    );
  });

  /*
   * 방 참가
   */
  socket.on(
    'join_room',
    ({ code, name }) => {

      const roomCode =
        String(code || '')
          .trim()
          .toUpperCase();

      const room =
        rooms.get(roomCode);

      if (!room) {
        socket.emit(
          'error_msg',
          '방을 찾을 수 없습니다.'
        );
        return;
      }

      if (room.players.length >= 2) {
        socket.emit(
          'error_msg',
          '방이 가득 찼습니다.'
        );
        return;
      }

      leaveRoom(socket);

      const playerName =
        String(name || 'Player 2')
          .trim()
          .slice(0, 20) ||
        'Player 2';

      room.players.push({
        id: socket.id,
        name: playerName,
        slot: 2
      });

      socket.data.room =
        roomCode;

      socket.join(roomCode);

      broadcastRoom(room);

      io.to(roomCode).emit(
        'notice',
        `${playerName}님이 입장했습니다.`
      );

      console.log(
        `${playerName}님이 방 참가: ${roomCode}`
      );
    }
  );

  /*
   * 온라인 게임 시작
   */
  socket.on(
    'start_online',
    () => {

      const room =
        rooms.get(
          socket.data.room
        );

      if (!room) {
        socket.emit(
          'error_msg',
          '방에 먼저 참가하세요.'
        );
        return;
      }

      if (!game) {
        socket.emit(
          'error_msg',
          '게임 데이터를 준비하는 중입니다.'
        );
        return;
      }

      if (room.players.length !== 2) {
        socket.emit(
          'error_msg',
          '두 명이 모두 들어와야 시작할 수 있습니다.'
        );
        return;
      }

      /*
       * 방장만 시작
       */
      if (
        room.players[0].id !==
        socket.id
      ) {
        socket.emit(
          'error_msg',
          '방장만 게임을 시작할 수 있습니다.'
        );
        return;
      }

      if (room.started) {
        socket.emit(
          'error_msg',
          '이미 게임이 진행 중입니다.'
        );
        return;
      }

      const result =
        startRoomGame(room);

      if (result.error) {
        socket.emit(
          'error_msg',
          result.error
        );
        return;
      }

      io.to(room.code).emit(
        'game_started',
        {
          state:
            getRoomState(room),

          startWord:
            result.startWord,

          firstPlayer:
            result.firstPlayer
        }
      );

      console.log(
        `게임 시작: ${room.code}, 시작 단어=${result.startWord}`
      );
    }
  );

  /*
   * 온라인 단어 입력
   */
  socket.on(
    'play_word',
    ({ word }) => {

      const room =
        rooms.get(
          socket.data.room
        );

      if (!room) {
        socket.emit(
          'error_msg',
          '방에 참가하지 않았습니다.'
        );
        return;
      }

      if (!game) {
        socket.emit(
          'error_msg',
          '게임 데이터를 준비하는 중입니다.'
        );
        return;
      }

      if (!room.started) {
        socket.emit(
          'error_msg',
          '진행 중인 게임이 없습니다.'
        );
        return;
      }

      /*
       * 자신의 차례인지 확인
       */
      if (
        room.turnPlayer !==
        socket.id
      ) {
        socket.emit(
          'error_msg',
          '상대방의 차례입니다.'
        );
        return;
      }

      const w =
        String(word || '')
          .trim();

      /*
       * 서버에서 최종 검증
       *
       * 여기서 두음법칙까지 적용됨.
       */
      const error =
        game.validateWord(
          w,
          room.current,
          room.used
        );

      if (error) {
        socket.emit(
          'error_msg',
          error
        );
        return;
      }

      room.used.add(w);

      room.current = w;

      room.turn++;

      /*
       * 상대가 이어갈 수 있는 단어 검사
       */
      const next =
        game.candidates(
          w.at(-1),
          room.used
        );

      /*
       * 더 이상 갈 단어가 없으면
       * 현재 단어를 낸 사람이 승리
       */
      if (next.length === 0) {

        room.started = false;

        io.to(room.code).emit(
          'game_over',
          {
            winner: socket.id,

            word: w,

            turn: room.turn,

            state:
              getRoomState(room)
          }
        );

        broadcastRoom(room);

        return;
      }

      /*
       * 상대방으로 턴 변경
       */
      const opponent =
        room.players.find(
          player =>
            player.id !==
            socket.id
        );

      room.turnPlayer =
        opponent
          ? opponent.id
          : null;

      /*
       * 정상 입력
       */
      io.to(room.code).emit(
        'word_played',
        {
          playerId:
            socket.id,

          word: w,

          depth:
            game.getAttackDepth(w),

          state:
            getRoomState(room)
        }
      );
    }
  );

  /*
   * 연결 종료
   */
  socket.on(
    'disconnect',
    () => {

      console.log(
        `클라이언트 종료: ${socket.id}`
      );

      leaveRoom(socket);
    }
  );
});

/* =========================================================
   먼저 포트를 연다
========================================================= */

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `끝말잇기 서버가 포트 ${PORT}에서 실행 중입니다.`
    );

    /*
     * 포트가 열린 뒤 무거운 game.js 로딩
     */
    console.log(
      '게임 데이터 로딩 시작...'
    );

    try {

      const loaded =
        require('./game');

      game = {
        DATA:
          loaded.DATA,

        candidates:
          loaded.candidates,

        randomStart:
          loaded.randomStart,

        validateWord:
          loaded.validateWord,

        canStartWith:
          loaded.canStartWith,

        allowedFirstChars:
          loaded.allowedFirstChars,

        isOneShot:
          loaded.isOneShot,

        getAttackDepth:
          loaded.getAttackDepth
      };

      gameLoading = false;

      console.log(
        '게임 데이터 로딩 완료'
      );

    } catch (error) {

      console.error(
        'game.js 로딩 실패:',
        error
      );

      /*
       * 서버 자체는 살아 있도록 유지.
       * Render의 포트는 이미 열려 있음.
       */
    }
  }
);
