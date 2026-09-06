"use strict";

/* =========================================================
   client/script.js — 끝말잇기 클라이언트
========================================================= */

/* ---------------------------------------------------------
   상태
--------------------------------------------------------- */
let socket = null;
let socketConnected = false;
let currentMode = "single";
let roomId = null;
let playerIndex = null;
let gameState = null;
let submitting = false;
let countdownTimer = null;
let gameSessionId = 0;

const localStats = JSON.parse(localStorage.getItem("kkStats") || '{"wins":0,"losses":0,"games":0,"totalLength":0}');
let localUsedWords = new Set();

/* ---------------------------------------------------------
   DOM 헬퍼
--------------------------------------------------------- */
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return [...document.querySelectorAll(sel)]; }

function setText(selectors, value) {
  for (const sel of selectors) {
    const el = $(sel);
    if (el) el.textContent = String(value ?? "");
  }
}

function setDisabled(selectors, disabled) {
  for (const sel of selectors) {
    const el = $(sel);
    if (el) el.disabled = disabled;
  }
}

function showMessage(text, type) {
  const selectors = currentMode === "single"
    ? ["#message"]
    : ["#onlineMessage"];
  for (const sel of selectors) {
    const el = $(sel);
    if (el) {
      el.textContent = text;
      el.dataset.type = type || "";
      return;
    }
  }
}

/* ---------------------------------------------------------
   정규화 & 두음
--------------------------------------------------------- */
const DUEUM = {
  "녀": ["녀", "여"], "년": ["년", "연"], "녕": ["녕", "영"],
  "녜": ["녜", "예"], "뇨": ["뇨", "요"], "뉴": ["뉴", "유"], "니": ["니", "이"],
  "랴": ["랴", "야"], "려": ["려", "여"], "례": ["례", "예"],
  "료": ["료", "요"], "류": ["류", "유"], "리": ["리", "이"],
  "라": ["라", "나"], "락": ["락", "낙"], "란": ["란", "난"],
  "랄": ["랄", "날"], "람": ["람", "남"], "랍": ["랍", "납"],
  "랏": ["랏", "낫"], "랑": ["랑", "낭"], "래": ["래", "내"], "랭": ["랭", "냉"],
  "략": ["략", "약"], "량": ["량", "양"], "련": ["련", "연"],
  "렬": ["렬", "열"], "령": ["령", "영"],
  "로": ["로", "노"], "록": ["록", "녹"], "론": ["론", "논"],
  "롤": ["롤", "놀"], "롬": ["롬", "놈"], "롭": ["롭", "놉"],
  "롯": ["롯", "놃"], "롱": ["롱", "농"], "뢰": ["뢰", "뇌"],
  "루": ["루", "누"], "륙": ["륙", "육"], "률": ["률", "율"],
  "륜": ["륜", "윤"], "륭": ["륭", "융"]
};

function normalizeWord(word) {
  if (typeof word !== "string") return "";
  return word.trim().replace(/\s+/g, "").normalize("NFC");
}

function allowedFirstChars(lastChar) {
  lastChar = normalizeWord(lastChar);
  if (!lastChar) return [];
  const result = new Set();
  result.add(lastChar);
  const direct = DUEUM[lastChar];
  if (Array.isArray(direct)) for (const ch of direct) if (ch) result.add(ch);
  for (const [from, values] of Object.entries(DUEUM)) {
    if (Array.isArray(values) && values.includes(lastChar)) result.add(from);
  }
  return [...result];
}

/* ---------------------------------------------------------
   랭크 계산 (클라이언트)
--------------------------------------------------------- */
function calculateRank(rating) {
  if (rating >= 2200) return { tier: "Challenger", sub: "" };
  if (rating >= 2000) return { tier: "Grandmaster", sub: "" };
  if (rating >= 1800) return { tier: "Master", sub: "" };
  if (rating >= 1600) return { tier: "Diamond", sub: rating >= 1734 ? "I" : rating >= 1667 ? "II" : "III" };
  if (rating >= 1400) return { tier: "Platinum", sub: rating >= 1534 ? "I" : rating >= 1467 ? "II" : "III" };
  if (rating >= 1200) return { tier: "Gold", sub: rating >= 1334 ? "I" : rating >= 1267 ? "II" : "III" };
  if (rating >= 1000) return { tier: "Silver", sub: rating >= 1134 ? "I" : rating >= 1067 ? "II" : "III" };
  return { tier: "Bronze", sub: rating >= 934 ? "I" : rating >= 867 ? "II" : "III" };
}

function formatRank(rank) {
  if (!rank) return "-";
  return rank.sub ? `${rank.tier} ${rank.sub}` : rank.tier;
}

/* ---------------------------------------------------------
   통계 저장
--------------------------------------------------------- */
function saveStats() {
  localStorage.setItem("kkStats", JSON.stringify(localStats));
}

function updateStatsUI() {
  setText(["#wins"], localStats.wins);
  setText(["#losses"], localStats.losses);
  setText(["#games"], localStats.games);
  setText(["#avg"], localStats.games > 0
    ? (localStats.totalLength / localStats.games).toFixed(1)
    : "-");
  const total = localStats.wins + localStats.losses;
  setText(["#winrate"], total > 0
    ? Math.round(localStats.wins / total * 100) + "%"
    : "0%");
}

/* ---------------------------------------------------------
   Socket.IO 연결 (한 번만)
--------------------------------------------------------- */
function initSocket() {
  if (socket) return;

  socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on("connect", () => {
    socketConnected = true;
    console.log("[SOCKET] 연결됨:", socket.id);
  });

  socket.on("disconnect", () => {
    socketConnected = false;
    showMessage("서버와 연결이 끊어졌습니다.", "error");
  });

  socket.on("server:ready", (data) => {
    socketConnected = true;
    console.log("[SOCKET] 서버 준비 완료:", data);
  });

  /* -- 방 이벤트 --------------------------------------- */
  socket.on("room:created", (data) => {
    if (!data.ok) return;
    roomId = data.roomId;
    playerIndex = data.playerIndex;
    gameSessionId++;
    gameState = data.state;
    renderGameState(gameState);
    showMessage("방이 생성되었습니다. 게임을 시작합니다.", "success");
  });

  socket.on("room:joined", (data) => {
    if (!data.ok) return;
    roomId = data.roomId;
    playerIndex = data.playerIndex;
    gameSessionId++;
    gameState = data.state;
    renderGameState(gameState);
    showMessage(data.reconnect ? "방에 재접속했습니다." : "방에 입장했습니다.", "success");
  });

  socket.on("room:error", (data) => {
    showMessage(data.reason || "방 오류", "error");
  });

  socket.on("room:playerJoined", (data) => {
    gameState = data.state;
    renderGameState(gameState);
    showMessage(`${data.nickname}님이 입장했습니다.`, "info");
  });

  socket.on("room:playerLeft", (data) => {
    showMessage(`${data.nickname}님이 나갔습니다.`, "info");
  });

  socket.on("room:playerDisconnected", (data) => {
    showMessage(`${data.nickname}님의 연결이 끊어졌습니다.`, "warning");
  });

  socket.on("room:left", () => {
    roomId = null;
    playerIndex = null;
    gameState = null;
    showMessage("방을 나갔습니다.", "info");
    hideRoomInfo();
  });

  /* -- 게임 이벤트 ------------------------------------- */
  socket.on("game:state", (data) => {
    gameState = data;
    renderGameState(gameState);
  });

  socket.on("game:started", (data) => {
    gameState = data.state;
    gameSessionId++;
    localUsedWords.clear();
    renderGameState(gameState);
    showMessage("게임이 시작되었습니다!", "success");
  });

  socket.on("game:word", (data) => {
    if (data.ok) {
      if (currentMode === "single") {
        localUsedWords.add(data.word);
      }
      showMessage(`${data.nickname}: ${data.word}${data.depth != null ? " [깊이 " + data.depth + "]" : ""}`, "success");
    }
  });

  socket.on("game:error", (data) => {
    showMessage(data.reason || "오류", "error");
    if (data.hearts != null) {
      renderHearts(data.hearts);
    }
    submitting = false;
    updateInputState();
  });

  socket.on("game:timeout", (data) => {
    const myName = gameState?.players?.find(p => p.playerIndex === playerIndex)?.nickname || "";
    const timeoutName = data.nickname || `플레이어 ${data.player + 1}`;
    if (data.player === playerIndex) {
      showMessage(`시간 초과! 하트 ${data.hearts}개 남음`, "error");
    } else {
      showMessage(`${timeoutName} 시간 초과!`, "info");
    }
  });

  socket.on("game:finished", (data) => {
    const isWinner = data.winner === playerIndex;
    if (data.winner !== null && data.winner === playerIndex) {
      showMessage("게임에서 승리했습니다!", "win");
      if (currentMode === "single") {
        localStats.wins++;
        localStats.games++;
        saveStats();
        updateStatsUI();
      }
    } else if (data.loser !== null && data.loser === playerIndex) {
      showMessage("게임에서 패배했습니다.", "lose");
      if (currentMode === "single") {
        localStats.losses++;
        localStats.games++;
        saveStats();
        updateStatsUI();
      }
    } else {
      showMessage("게임이 종료되었습니다.", "info");
    }
    submitting = false;
    stopCountdown();
    updateInputState();
  });
}

/* ---------------------------------------------------------
   렌더링
--------------------------------------------------------- */
function renderGameState(state) {
  if (!state) return;

  setText(["#startWord"], state.history?.[0]?.word || "-");

  const current = state.players?.find(p => p.playerIndex === state.turnPlayer);
  setText(["#last"], state.currentWord ? state.currentWord.at(-1) : "-");
  setText(["#turn"], state.turnNumber);

  if (state.currentWord && state.finished === false) {
    const lastChar = state.currentWord.at(-1);
    const allowed = allowedFirstChars(lastChar);
    setText(["#depth"], allowed.join(", "));
  } else {
    setText(["#depth"], "-");
  }

  renderPlayers(state);
  renderHistory(state);
  renderRoomInfo(state);
  renderCountdown(state);
  updateInputState();
}

function renderPlayers(state) {
  if (!state || !state.players) return;

  const container = currentMode === "single"
    ? null
    : ($("#onlinePlayers"));

  setText(["#myNickname"], state.players.find(p => p.playerIndex === playerIndex)?.nickname || "-");
  setText(["#opponentNickname"], state.players.find(p => p.playerIndex !== playerIndex)?.nickname || "대기 중");

  if (container) {
    container.innerHTML = "";
    for (const p of state.players) {
      const row = document.createElement("div");
      row.className = "player-item";
      if (p.playerIndex === state.turnPlayer) row.dataset.turn = "true";
      if (p.eliminated) row.dataset.eliminated = "true";

      const hearts = "♥".repeat(Math.max(0, p.hearts)) + "♡".repeat(Math.max(0, 2 - p.hearts));
      const status = p.eliminated ? "탈락" : p.connected ? (p.isBot ? "AI" : "접속 중") : "연결 끊김";
      row.textContent = `${p.nickname} — ${hearts} — ${status}`;
      container.appendChild(row);
    }
  }

  const me = state.players?.find(p => p.playerIndex === playerIndex);
  if (me) renderHearts(me.hearts);
}

function renderHearts(hearts) {
  const v = Math.max(0, Number(hearts) || 0);
  const text = "♥".repeat(v) + "♡".repeat(Math.max(0, 2 - v));
  setText(["#hearts", "#heartDisplay"], text);
}

function renderHistory(state) {
  const history = state?.history || [];
  const selector = currentMode === "single" ? "#history" : "#onlineHistory";
  const container = $(selector);
  if (!container) return;

  container.innerHTML = "";
  for (const item of history) {
    const row = document.createElement("div");
    row.className = "history-item";
    const depth = item.depth != null ? ` [${item.depth}]` : "";
    if (item.turn === 0) {
      row.textContent = `시작: ${item.word}${depth}`;
    } else {
      row.textContent = `${item.turn}. ${item.nickname || "플레이어"}: ${item.word}${depth}`;
    }
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}

function renderRoomInfo(state) {
  if (currentMode !== "online") return;
  const el = $("#roomInfo");
  if (!el) return;
  if (!state) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div>방 코드: <strong>${state.roomId}</strong></div>
    <div>인원: ${state.playerCount}/${state.maxPlayers}</div>
    <div>모드: ${state.mode === "ai" ? "AI" : "온라인"}</div>
  `;
}

function hideRoomInfo() {
  const el = $("#roomInfo");
  if (el) el.innerHTML = "";
}

function renderCountdown(state) {
  stopCountdown();
  if (!state || !state.turnEndsAt || state.finished || !state.started) {
    setText(["#countdown", "#timer"], "-");
    return;
  }
  const update = () => {
    if (!gameState?.turnEndsAt) { stopCountdown(); return; }
    const remaining = Math.max(0, gameState.turnEndsAt - Date.now());
    const secs = Math.ceil(remaining / 1000);
    setText(["#countdown", "#timer"], secs + "s");
    if (remaining <= 0) stopCountdown();
  };
  update();
  countdownTimer = setInterval(update, 200);
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function updateInputState() {
  const input = currentMode === "single" ? $("#singleInput") : $("#onlineInput");
  const btn = currentMode === "single" ? $("#singleSend") : $("#onlineSend");

  const myTurn = gameState && gameState.started && !gameState.finished
    && gameState.turnPlayer === playerIndex
    && gameState.playerCount >= 2;

  const disabled = !socketConnected || !roomId || !myTurn || submitting;

  if (input) input.disabled = disabled;
  if (btn) btn.disabled = disabled;
}

/* ---------------------------------------------------------
   싱글플레이
--------------------------------------------------------- */
function startSingleGame() {
  if (!socket || !socketConnected) {
    showMessage("서버에 연결 중입니다...", "waiting");
    return;
  }

  const difficulty = Number($("#difficulty")?.value) || 3;

  socket.emit("room:create", {
    nickname: "플레이어",
    mode: "ai",
    aiLevel: difficulty
  });

  localUsedWords.clear();
  showMessage("게임을 시작합니다...", "waiting");
}

function submitSingleWord() {
  if (submitting) return;
  if (!socket || !socketConnected) return;
  if (!roomId || !gameState) return;
  if (!gameState.started || gameState.finished) return;
  if (gameState.turnPlayer !== playerIndex) return;

  const input = $("#singleInput");
  if (!input) return;

  const word = normalizeWord(input.value);
  if (!word) return;

  submitting = true;
  socket.emit("game:word", { word });
  input.value = "";
  updateInputState();

  setTimeout(() => {
    submitting = false;
    updateInputState();
  }, 300);
}

/* ---------------------------------------------------------
   온라인
--------------------------------------------------------- */
function createOnlineRoom() {
  if (!socket || !socketConnected) {
    showMessage("서버에 연결 중입니다...", "waiting");
    return;
  }

  const nickname = normalizeWord($("#name")?.value) || "플레이어";

  socket.emit("room:create", {
    nickname,
    mode: "online"
  });

  showMessage("방을 만드는 중...", "waiting");
}

function joinOnlineRoom() {
  if (!socket || !socketConnected) {
    showMessage("서버에 연결 중입니다...", "waiting");
    return;
  }

  const code = normalizeWord($("#roomCode")?.value);
  if (!code) {
    showMessage("방 코드를 입력해주세요.", "error");
    return;
  }

  const nickname = normalizeWord($("#name")?.value) || "플레이어";

  socket.emit("room:join", {
    roomId: code,
    nickname
  });

  showMessage("방에 입장하는 중...", "waiting");
}

function submitOnlineWord() {
  if (submitting) return;
  if (!socket || !socketConnected) return;
  if (!roomId || !gameState) return;
  if (!gameState.started || gameState.finished) return;
  if (gameState.turnPlayer !== playerIndex) return;

  const input = $("#onlineInput");
  if (!input) return;

  const word = normalizeWord(input.value);
  if (!word) return;

  submitting = true;
  socket.emit("game:word", { word });
  input.value = "";
  updateInputState();

  setTimeout(() => {
    submitting = false;
    updateInputState();
  }, 300);
}

function leaveRoom() {
  if (!socket || !socketConnected) return;
  socket.emit("room:leave");
  roomId = null;
  playerIndex = null;
  gameState = null;
  localUsedWords.clear();
}

/* ---------------------------------------------------------
   초기화
--------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initSocket();
  updateStatsUI();

  /* 탭 전환 */
  $all(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      $all(".tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentMode = btn.dataset.mode;
      $all(".panel").forEach(p => p.classList.add("hidden"));
      const target = $(`#${currentMode}`);
      if (target) target.classList.remove("hidden");

      if (currentMode === "single") {
        if (!gameState || !roomId) startSingleGame();
      }
    });
  });

  /* 싱글플레이 */
  $("#newStart")?.addEventListener("click", () => {
    leaveRoom();
    setTimeout(startSingleGame, 200);
  });

  $("#restart")?.addEventListener("click", () => {
    leaveRoom();
    setTimeout(startSingleGame, 200);
  });

  $("#singleSend")?.addEventListener("click", submitSingleWord);
  $("#singleInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitSingleWord();
    }
  });

  /* 온라인 */
  $("#create")?.addEventListener("click", createOnlineRoom);
  $("#join")?.addEventListener("click", joinOnlineRoom);
  $("#onlineSend")?.addEventListener("click", submitOnlineWord);
  $("#onlineInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitOnlineWord();
    }
  });

  /* 시작 시 자동으로 싱글게임 시작 */
  setTimeout(startSingleGame, 1000);
});
