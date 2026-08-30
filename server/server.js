const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

console.log("=================================");
console.log("끝말잇기 서버 시작");
console.log("=================================");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "../client")));

const rooms = new Map();

function createRoomCode() {
    let code;

    do {
        code = Math.random()
            .toString(36)
            .substring(2, 7)
            .toUpperCase();
    } while (rooms.has(code));

    return code;
}

io.on("connection", (socket) => {
    console.log("사용자 접속:", socket.id);

    socket.on("createRoom", ({ nickname, maxPlayers = 2 }) => {
        const roomCode = createRoomCode();

        const room = {
            code: roomCode,
            players: [],
            maxPlayers: Math.max(2, Number(maxPlayers) || 2),
            started: false,
            currentWord: null,
            turnIndex: 0,
            usedWords: new Set()
        };

        room.players.push({
            id: socket.id,
            nickname: nickname || "플레이어",
        });

        rooms.set(roomCode, room);
        socket.join(roomCode);

        socket.roomCode = roomCode;

        socket.emit("roomCreated", {
            roomCode,
            players: room.players
        });

        console.log("방 생성:", roomCode);
    });

    socket.on("joinRoom", ({ roomCode, nickname }) => {
        roomCode = String(roomCode || "").trim().toUpperCase();

        const room = rooms.get(roomCode);

        if (!room) {
            socket.emit("roomError", "존재하지 않는 방입니다.");
            return;
        }

        if (room.players.length >= room.maxPlayers) {
            socket.emit("roomError", "방이 가득 찼습니다.");
            return;
        }

        if (room.started) {
            socket.emit("roomError", "이미 게임이 시작되었습니다.");
            return;
        }

        room.players.push({
            id: socket.id,
            nickname: nickname || "플레이어"
        });

        socket.join(roomCode);
        socket.roomCode = roomCode;

        io.to(roomCode).emit("playersUpdated", {
            players: room.players
        });

        console.log(
            `${nickname || "플레이어"} 님이 ${roomCode} 방에 참가`
        );
    });

    socket.on("startGame", () => {
        const roomCode = socket.roomCode;
        const room = rooms.get(roomCode);

        if (!room) return;

        if (room.players.length < 2) {
            socket.emit("roomError", "최소 2명이 필요합니다.");
            return;
        }

        room.started = true;
        room.turnIndex = 0;
        room.currentWord = null;
        room.usedWords.clear();

        io.to(roomCode).emit("gameStarted", {
            players: room.players,
            turnPlayerId: room.players[0].id
        });

        console.log("게임 시작:", roomCode);
    });

    socket.on("disconnect", () => {
        console.log("사용자 퇴장:", socket.id);

        const roomCode = socket.roomCode;

        if (!roomCode) return;

        const room = rooms.get(roomCode);

        if (!room) return;

        room.players = room.players.filter(
            player => player.id !== socket.id
        );

        if (room.players.length === 0) {
            rooms.delete(roomCode);
            console.log("빈 방 삭제:", roomCode);
            return;
        }

        if (room.turnIndex >= room.players.length) {
            room.turnIndex = 0;
        }

        io.to(roomCode).emit("playersUpdated", {
            players: room.players
        });
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("=================================");
    console.log(`서버 실행 완료`);
    console.log(`PORT: ${PORT}`);
    console.log("=================================");
});
