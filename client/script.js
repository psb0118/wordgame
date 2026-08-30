const socket = io();

let roomCode = null;
let nickname = "";
let myId = null;
let players = [];
let currentTurnPlayerId = null;

const $ = (selector) => document.querySelector(selector);

function showMessage(message) {
    const element = $("#message");

    if (element) {
        element.textContent = message;
    }
}

function renderPlayers() {
    const list = $("#playerList");

    if (!list) return;

    list.innerHTML = "";

    players.forEach((player) => {
        const li = document.createElement("li");

        li.textContent =
            player.nickname +
            (player.id === currentTurnPlayerId
                ? " ← 현재 턴"
                : "");

        list.appendChild(li);
    });
}

function updateTurn() {
    const player = players.find(
        p => p.id === currentTurnPlayerId
    );

    if (!player) return;

    const turnElement = $("#currentTurn");

    if (turnElement) {
        turnElement.textContent =
            `${player.nickname}의 턴`;
    }
}

function addLog(message) {
    const log = $("#gameLog");

    if (!log) return;

    const item = document.createElement("div");
    item.textContent = message;

    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
}

socket.on("connect", () => {
    myId = socket.id;

    console.log("Socket 연결:", myId);
});

socket.on("roomCreated", (data) => {
    roomCode = data.roomCode;
    players = data.players;

    const roomElement = $("#roomCode");

    if (roomElement) {
        roomElement.textContent = roomCode;
    }

    renderPlayers();

    showMessage("방이 생성되었습니다.");
});

socket.on("playersUpdated", (data) => {
    players = data.players;

    renderPlayers();
    updateTurn();
});

socket.on("roomError", (message) => {
    showMessage(message);
});

socket.on("gameStarted", (data) => {
    players = data.players;
    currentTurnPlayerId = data.turnPlayerId;

    renderPlayers();
    updateTurn();

    addLog("게임이 시작되었습니다.");

    showMessage(
        currentTurnPlayerId === myId
            ? "내 턴입니다."
            : "상대방의 턴입니다."
    );
});

function createRoom() {
    const nameInput = $("#nickname");
    const maxInput = $("#maxPlayers");

    nickname =
        nameInput?.value.trim() ||
        "플레이어";

    const maxPlayers =
        Number(maxInput?.value) || 2;

    socket.emit("createRoom", {
        nickname,
        maxPlayers
    });
}

function joinRoom() {
    const nameInput = $("#nickname");
    const roomInput = $("#roomInput");

    nickname =
        nameInput?.value.trim() ||
        "플레이어";

    roomCode =
        roomInput?.value.trim().toUpperCase();

    if (!roomCode) {
        showMessage("방 코드를 입력해주세요.");
        return;
    }

    socket.emit("joinRoom", {
        roomCode,
        nickname
    });
}

function startGame() {
    if (!roomCode) {
        showMessage("먼저 방을 만들어주세요.");
        return;
    }

    socket.emit("startGame");
}

function submitWord() {
    const input = $("#wordInput");

    if (!input) return;

    const word = input.value.trim();

    if (!word) return;

    if (currentTurnPlayerId !== myId) {
        showMessage("현재 내 턴이 아닙니다.");
        return;
    }

    /*
     * 실제 완성 버전에서는 여기서 서버의
     * submitWord 이벤트로 전송하고,
     * 서버에서 최종 검증한다.
     */

    socket.emit("submitWord", {
        roomCode,
        word
    });

    input.value = "";
}

document.addEventListener("DOMContentLoaded", () => {
    const createButton = $("#createRoomButton");
    const joinButton = $("#joinRoomButton");
    const startButton = $("#startGameButton");
    const submitButton = $("#submitWordButton");

    /*
     * 이벤트 리스너는 DOMContentLoaded에서 한 번만 등록한다.
     * 게임 재시작마다 다시 등록하지 않는다.
     */

    createButton?.addEventListener(
        "click",
        createRoom
    );

    joinButton?.addEventListener(
        "click",
        joinRoom
    );

    startButton?.addEventListener(
        "click",
        startGame
    );

    submitButton?.addEventListener(
        "click",
        submitWord
    );

    $("#wordInput")?.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submitWord();
            }
        }
    );
});
