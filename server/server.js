const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const {
  normalizeWord,
  canConnect,
  isValidWord,
  createGame,
  playWord
} = require("../game");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const ROOT = path.join(__dirname, "..");
const WORD_FILE = path.join(ROOT, "word.txt");

let words = new Set();

function loadWords() {
  if (!fs.existsSync(WORD_FILE)) {
    console.error("word.txt를 찾을 수 없습니다.");
    process.exit(1);
  }

  const text = fs.readFileSync(WORD_FILE, "utf8");

  words = new Set(
    text
      .split(/\r?\n/)
      .map(v => normalizeWord(v))
      .filter(Boolean)
  );

  console.log(`단어 ${words.size.toLocaleString()}개 로드 완료`);
}

loadWords();

app.use(express.static(ROOT));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    words: words.size
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = "";

    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));

  return code;
}

function getRoom(socket) {
  if (!socket.roomCode) return null;
  return rooms.get(socket.roomCode) || null;
}

function roomState(room) {
  return {
    code: room.code,
    started: room.started,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name
    })),
    turn: room.game ? room.game.turn : 0,
    currentWord: room.game ? room.game.currentWord : null,
    history: room.game ? room.game.history : []
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit("roomState", roomState(room));
}

function removePlayerFromRoom(socket) {
  const room = getRoom(socket);

  if (!room) return;

  room.players = room.players.filter(p => p.id !== socket.id);

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  room.started = false;
  room.game = null;

  for (const player of room.players) {
    const other = io.sockets.sockets.get(player.id);

    if (other) {
      other.roomCode = null;
      other.emit("roomClosed");
    }
  }

  rooms.delete(room.code);
}

io.on("connection", socket => {
  console.log("접속:", socket.id);

  socket.on("createRoom", data => {
    if (socket.roomCode) {
      socket.emit("errorMessage", "이미 방에 참가하고 있습니다.");
      return;
    }

    const name =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim().slice(0, 20)
        : "Player";

    const code = makeRoomCode();

    const room = {
      code,
      players: [
        {
          id: socket.id,
          name
        }
      ],
      started: false,
      game: null
    };

    rooms.set(code, room);

    socket.join(code);
    socket.roomCode = code;

    socket.emit("roomCreated", {
      code
    });

    broadcastRoom(room);
  });

  socket.on("joinRoom", data => {
    if (socket.roomCode) {
      socket.emit("errorMessage", "이미 방에 참가하고 있습니다.");
      return;
    }

    const code =
      typeof data?.code === "string"
        ? data.code.trim().toUpperCase()
        : "";

    const name =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim().slice(0, 20)
        : "Player";

    const room = rooms.get(code);

    if (!room) {
      socket.emit("errorMessage", "존재하지 않는 방입니다.");
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("errorMessage", "방이 가득 찼습니다.");
      return;
    }

    room.players.push({
      id: socket.id,
      name
    });

    socket.join(code);
    socket.roomCode = code;

    socket.emit("joinedRoom", {
      code
    });

    broadcastRoom(room);
  });

  socket.on("startOnline", () => {
    const room = getRoom(socket);

    if (!room) {
      socket.emit("errorMessage", "방에 참가하지 않았습니다.");
      return;
    }

    if (room.players.length !== 2) {
      socket.emit("errorMessage", "플레이어 2명이 모두 들어와야 합니다.");
      return;
    }

    if (room.players[0].id !== socket.id) {
      socket.emit("errorMessage", "방장만 게임을 시작할 수 있습니다.");
      return;
    }

    if (room.started) {
      return;
    }

    room.game = createGame();
    room.started = true;

    broadcastRoom(room);
  });

  socket.on("playWord", data => {
    const room = getRoom(socket);

    if (!room) {
      socket.emit("errorMessage", "방에 참가하지 않았습니다.");
      return;
    }

    if (!room.started || !room.game) {
      socket.emit("errorMessage", "게임이 시작되지 않았습니다.");
      return;
    }

    const word = normalizeWord(data?.word);

    if (!word) {
      socket.emit("errorMessage", "단어를 입력해주세요.");
      return;
    }

    const playerIndex = room.players.findIndex(
      player => player.id === socket.id
    );

    if (playerIndex === -1) {
      socket.emit("errorMessage", "플레이어 정보를 찾을 수 없습니다.");
      return;
    }

    if (room.game.turn !== playerIndex) {
      socket.emit("errorMessage", "지금은 당신의 차례가 아닙니다.");
      return;
    }

    const result = playWord(room.game, word, words);

    if (!result.ok) {
      socket.emit("wordRejected", {
        reason: result.reason
      });

      return;
    }

    io.to(room.code).emit("wordPlayed", {
      word,
      playerIndex,
      currentWord: room.game.currentWord,
      history: room.game.history,
      nextTurn: room.game.turn
    });

    if (result.finished) {
      room.started = false;

      io.to(room.code).emit("gameFinished", {
        winner: result.winner,
        loser: result.loser,
        history: room.game.history
      });

      room.game = null;
      broadcastRoom(room);

      return;
    }

    broadcastRoom(room);
  });

  socket.on("leaveRoom", () => {
    const room = getRoom(socket);

    if (!room) return;

    socket.leave(room.code);
    removePlayerFromRoom(socket);
  });

  socket.on("disconnect", () => {
    console.log("접속 종료:", socket.id);

    const room = getRoom(socket);

    if (!room) return;

    removePlayerFromRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
});
