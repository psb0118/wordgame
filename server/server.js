const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

console.log('서버 시작: game.js 로딩 전');

const game = require('./game');

const {
  DATA,
  candidates,
  randomStart,
  validateWord,
  canStartWith,
  isOneShot
} = game;

console.log('서버 시작: game.js 로딩 완료');

const app = express();
const server = http.createServer(app);

/*
 * ---------------------------------------------------------
 * Render 포트
 * ---------------------------------------------------------
 *
 * Render가 지정하는 PORT를 최우선으로 사용한다.
 * 로컬에서는 PORT가 없으면 10000을 사용한다.
 */
const PORT = Number(process.env.PORT) || 10000;

/*
 * ---------------------------------------------------------
 * Socket.IO
 * ---------------------------------------------------------
 */

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

/*
 * ---------------------------------------------------------
 * 정적 파일
 * ---------------------------------------------------------
 */

const CLIENT_DIR = path.join(
  __dirname,
  '..',
  'client'
);

app.use(
  express.static(CLIENT_DIR)
);

/*
 * ---------------------------------------------------------
 * 기본 페이지
 * ---------------------------------------------------------
 */

app.get('/', (_req, res) => {
  res.sendFile(
    path.join(
      CLIENT_DIR,
      'index.html'
    )
  );
});

/*
 * ---------------------------------------------------------
 * 기본 상태 확인
 * ---------------------------------------------------------
 */

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    message: '끝말잇기 서버 정상 작동 중',
    port: PORT
  });
});

/*
 * ---------------------------------------------------------
 * API
 * ---------------------------------------------------------
 */

app.get('/api/info', (_req, res) => {
  res.json({
    wordCount: DATA.words.length,
    attackCount: DATA.attackDepth.size,
    startCount: DATA.startPool.length
  });
});

/*
 * 데이터 API
 *
 * script.js에서 사용하는 데이터:
 *
 * words
 * attackDepth
 * startPool
 * byFirst
 */

app.get('/api/data', (_req, res) => {
  const byFirst = {};

  for (const word of DATA.words) {
    const first = word[0];

    if (!byFirst[first]) {
      byFirst[first] = [];
    }

    byFirst[first].push(word);
  }

  res.json({
    words: DATA.words,

    attackDepth:
      Object.fromEntries(
        DATA.attackDepth
      ),

    startPool:
      DATA.startPool,

    byFirst
  });
});

/*
 * ---------------------------------------------------------
 * 공격 깊이
 * ---------------------------------------------------------
 */

function getAttackDepth(word) {
  if (!word) {
    return null;
  }

  const depth =
    DATA.attackDepth.get(word);

  return depth == null
    ? null
    : depth;
}

/*
 * ---------------------------------------------------------
 * 방 관리
 * ---------------------------------------------------------
 */

const rooms = new Map();

/*
 * 방 코드 생성
 */

function generateRoomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
  } while (
    rooms.has(code)
  );

  return code;
}

/*
 * ---------------------------------------------------------
 * 방 상태
 * ---------------------------------------------------------
 */

function getRoomState(room) {
  return {
    roomCode: room.code,

    players:
      room.players.map(
        player => ({
          id: player.id,
          name: player.name,
          slot: player.slot
        })
      ),

    started:
      room.started,

    current:
      room.current,

    turn:
      room.turn,

    turnPlayer:
      room.turnPlayer,

    firstPlayer:
      room.firstPlayer,

    lastDepth:
      room.current
        ? getAttackDepth(room.current)
        : null
  };
}

/*
 * ---------------------------------------------------------
 * 방 상태 전체 전송
 * ---------------------------------------------------------
 */

function broadcastRoom(room) {
  io.to(room.code).emit(
    'room_state',
    getRoomState(room)
  );
}

/*
 * ---------------------------------------------------------
 * 방 나가기
 * ---------------------------------------------------------
 */

function leaveRoom(socket) {
  const roomCode =
    socket.data.room;

  if (!roomCode) {
    return;
  }

  const room =
    rooms.get(roomCode);

  if (!room) {
    socket.data.room = null;
    return;
  }

  room.players =
    room.players.filter(
      player =>
        player.id !== socket.id
    );

  socket.leave(room.code);

  socket.data.room = null;

  /*
   * 아무도 없으면 방 삭제
   */

  if (
    room.players.length === 0
  ) {
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

/*
 * ---------------------------------------------------------
 * 온라인 게임 시작
 * ---------------------------------------------------------
 */

function startRoomGame(room) {
  if (
    room.players.length !== 2
  ) {
    return {
      error:
        '두 명이 모두 들어와야 시작할 수 있습니다.'
    };
  }

  /*
   * game.js에서 안전한 시작 단어 선택
   */

  let startWord;

  try {
    startWord =
      randomStart();
  } catch (error) {
    console.error(
      '시작 단어 생성 실패:',
      error
    );

    return {
      error:
        '시작 단어를 생성할 수 없습니다.'
    };
  }

  room.started = true;

  room.current =
    startWord;

  room.used =
    new Set([
      startWord
    ]);

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
    room.players[
      firstIndex
    ].id;

  room.turnPlayer =
    room.players[
      firstIndex
    ].id;

  return {
    startWord,

    firstPlayer:
      room.firstPlayer
  };
}

/*
 * ---------------------------------------------------------
 * Socket.IO
 * ---------------------------------------------------------
 */

io.on(
  'connection',
  socket => {

    console.log(
      `클라이언트 접속: ${socket.id}`
    );

    /*
     * -----------------------------------------------------
     * 방 만들기
     * -----------------------------------------------------
     */

    socket.on(
      'create_room',
      ({ name } = {}) => {

        leaveRoom(socket);

        const roomCode =
          generateRoomCode();

        const playerName =
          String(
            name || 'Player 1'
          )
            .trim()
            .slice(0, 20) ||
          'Player 1';

        const room = {
          code:
            roomCode,

          players: [
            {
              id:
                socket.id,

              name:
                playerName,

              slot:
                1
            }
          ],

          started:
            false,

          current:
            null,

          used:
            new Set(),

          turn:
            0,

          turnPlayer:
            null,

          firstPlayer:
            null
        };

        rooms.set(
          roomCode,
          room
        );

        socket.data.room =
          roomCode;

        socket.join(
          roomCode
        );

        socket.emit(
          'room_created',
          {
            code:
              roomCode
          }
        );

        broadcastRoom(
          room
        );

        console.log(
          `${playerName}님이 방 생성: ${roomCode}`
        );
      }
    );

    /*
     * -----------------------------------------------------
     * 방 참가
     * -----------------------------------------------------
     */

    socket.on(
      'join_room',
      ({ code, name } = {}) => {

        const roomCode =
          String(
            code || ''
          )
            .trim()
            .toUpperCase();

        const room =
          rooms.get(
            roomCode
          );

        if (!room) {
          socket.emit(
            'error_msg',
            '방을 찾을 수 없습니다.'
          );

          return;
        }

        if (
          room.players.length >= 2
        ) {
          socket.emit(
            'error_msg',
            '방이 가득 찼습니다.'
          );

          return;
        }

        leaveRoom(socket);

        const playerName =
          String(
            name || 'Player 2'
          )
            .trim()
            .slice(0, 20) ||
          'Player 2';

        room.players.push({
          id:
            socket.id,

          name:
            playerName,

          slot:
            2
        });

        socket.data.room =
          roomCode;

        socket.join(
          roomCode
        );

        broadcastRoom(
          room
        );

        io.to(
          roomCode
        ).emit(
          'notice',
          `${playerName}님이 입장했습니다.`
        );

        console.log(
          `${playerName}님이 방 참가: ${roomCode}`
        );
      }
    );

    /*
     * -----------------------------------------------------
     * 온라인 게임 시작
     * -----------------------------------------------------
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

        if (
          room.players.length !== 2
        ) {
          socket.emit(
            'error_msg',
            '두 명이 모두 들어와야 시작할 수 있습니다.'
          );

          return;
        }

        /*
         * 방장만 시작 가능
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
          startRoomGame(
            room
          );

        if (result.error) {
          socket.emit(
            'error_msg',
            result.error
          );

          return;
        }

        io.to(
          room.code
        ).emit(
          'game_started',
          {
            state:
              getRoomState(
                room
              ),

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
     * -----------------------------------------------------
     * 온라인 단어 입력
     * -----------------------------------------------------
     */

    socket.on(
      'play_word',
      ({ word } = {}) => {

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

        if (!room.started) {
          socket.emit(
            'error_msg',
            '진행 중인 게임이 없습니다.'
          );

          return;
        }

        /*
         * 현재 플레이어인지 확인
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
          String(
            word || ''
          )
            .trim();

        /*
         * 서버에서 최종 검증
         *
         * game.js에서
         * 두음법칙까지 처리한다.
         */

        const error =
          validateWord(
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

        /*
         * 단어 등록
         */

        room.used.add(w);

        room.current =
          w;

        room.turn++;

        /*
         * 상대방이 이어갈 수 있는지 확인
         */

        const next =
          candidates(
            w.at(-1),
            room.used
          );

        /*
         * 더 이상 갈 곳이 없다면
         * 현재 단어를 낸 플레이어 승리
         */

        if (
          next.length === 0
        ) {

          room.started =
            false;

          io.to(
            room.code
          ).emit(
            'game_over',
            {
              winner:
                socket.id,

              word:
                w,

              turn:
                room.turn,

              state:
                getRoomState(
                  room
                )
            }
          );

          broadcastRoom(
            room
          );

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
         * 단어 입력 전달
         */

        io.to(
          room.code
        ).emit(
          'word_played',
          {
            playerId:
              socket.id,

            word:
              w,

            depth:
              getAttackDepth(w),

            state:
              getRoomState(
                room
              )
          }
        );
      }
    );

    /*
     * -----------------------------------------------------
     * 연결 종료
     * -----------------------------------------------------
     */

    socket.on(
      'disconnect',
      () => {

        console.log(
          `클라이언트 종료: ${socket.id}`
        );

        leaveRoom(
          socket
        );
      }
    );
  }
);

/*
 * ---------------------------------------------------------
 * 서버 시작
 * ---------------------------------------------------------
 */

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `끝말잇기 서버가 포트 ${PORT}에서 실행 중입니다.`
    );

    console.log(
      `서버 주소 바인딩: 0.0.0.0:${PORT}`
    );
  }
);

/*
 * ---------------------------------------------------------
 * 서버 오류
 * ---------------------------------------------------------
 */

server.on(
  'error',
  error => {

    console.error(
      '서버 오류:',
      error
    );
  }
);
