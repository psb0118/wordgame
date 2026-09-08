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
  "롤": ["롤", "놀"], "롬": ["롬", "놈"], "롭": ["롭", "놑"],
  "롯": ["롯", "놃"], "롱": ["롱", "농"], "뢰": ["뢰", "뇌"],
  "루": ["루", "누"], "륙": ["륙", "육"], "률": ["률", "율"],
  "륜": ["륜", "윤"], "륭": ["륭", "융"],
  "렁": ["렁", "엉"], "렴": ["렴", "염"]
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
    showMessage(`방이 생성되었습니다. 방 코드: ${data.roomId}`, "success");
  });

  socket.on("room:joined", (data) => {
    if (!data.ok) return;
    roomId = data.roomId;
    playerIndex = data.playerIndex;
    gameSessionId++;
    gameState = data.state;
    renderGameState(gameState);
    if (data.waiting) {
      showMessage("게임이 진행 중입니다. 다음 게임부터 참여합니다.", "info");
    } else {
      showMessage(data.reconnect ? "방에 재접속했습니다." : "방에 입장했습니다.", "success");
    }
  });

  socket.on("room:error", (data) => {
    showMessage(data.reason || "방 오류", "error");
  });

  socket.on("room:playerJoined", (data) => {
    gameState = data.state;
    renderGameState(gameState);
    if (data.waiting) {
      showMessage(`${data.nickname}님이 입장했습니다 (대기 중).`, "info");
    } else {
      showMessage(`${data.nickname}님이 입장했습니다.`, "info");
    }
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
    updateRuleNotice(gameState);
    const hostControls = $("#hostControls");
    if (hostControls) hostControls.classList.add("hidden");
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
    if (data.heartLost) {
      showMessage(data.reason || "하트를 잃었습니다!", "error");
    } else if (data.allowed) {
      showMessage(data.reason + " (다시 시도해주세요)", "warning");
    } else {
      showMessage(data.reason || "오류", "error");
    }
    if (data.hearts != null) {
      renderHearts(data.hearts);
    }
    if (data.mistakes != null && data.mistakesPerLife != null) {
      const remaining = data.mistakesPerLife - data.mistakes;
      renderMistakes(data.mistakes, data.mistakesPerLife);
      if (remaining > 0 && remaining <= 2) {
        showMessage(`실수 ${data.mistakes}/${data.mistakesPerLife} (하트까지 ${remaining}번)`, "warning");
      }
    }
    submitting = false;
    updateInputState();
  });

  socket.on("game:timeout", (data) => {
    const timeoutName = data.nickname || `플레이어 ${data.player + 1}`;
    if (data.player === playerIndex) {
      if (data.eliminated) {
        showMessage(`시간 초과! 탈락!`, "error");
      } else if (data.heartLost) {
        showMessage(`시간 초과! 하트 차감! (남은 하트: ${data.hearts})`, "error");
      } else {
        const remaining = (data.mistakesPerLife || 5) - (data.mistakes || 0);
        showMessage(`시간 초과! 실수 ${data.mistakes}/${data.mistakesPerLife} (하트까지 ${remaining}번)`, "warning");
      }
    } else {
      showMessage(`${timeoutName} 시간 초과!`, "info");
    }
    if (data.hearts != null) renderHearts(data.hearts);
    if (data.mistakes != null && data.mistakesPerLife != null) renderMistakes(data.mistakes, data.mistakesPerLife);
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

  setText(["#last"], state.currentWord ? state.currentWord.at(-1) : "-");
  setText(["#turn"], state.turnNumber);

  if (state.history && state.history.length > 0) {
    const lastEntry = state.history[state.history.length - 1];
    if (lastEntry.depth != null) {
      setText(["#depth"], lastEntry.depth);
    } else {
      setText(["#depth"], "-");
    }
  } else {
    setText(["#depth"], "-");
  }

  renderPlayers(state);
  renderHistory(state);
  renderRoomInfo(state);
  renderCountdown(state);
  updateRuleNotice(state);
  updateInputState();
}

function updateRuleNotice(state) {
  if (!state) return;
  const freeTurns = state.oneShotFreeTurns || 3;
  const turn = state.turnNumber || 0;
  const selector = currentMode === "single" ? "#ruleNotice" : "#onlineRuleNotice";
  const el = $(selector);
  if (!el) return;

  if (turn < freeTurns) {
    el.textContent = `첫 ${freeTurns}턴은 공격 단어 사용 금지 (${turn}/${freeTurns})`;
    el.dataset.active = "true";
  } else {
    el.textContent = "이제 공격 단어 사용 가능";
    el.dataset.active = "false";
  }
}

function renderPlayers(state) {
  if (!state || !state.players) return;

  const container = currentMode === "single"
    ? null
    : ($("#onlinePlayers"));

  if (container) {
    container.innerHTML = "";
    for (const p of state.players) {
      const row = document.createElement("div");
      row.className = "player-item";
      if (p.playerIndex === state.turnPlayer) row.dataset.turn = "true";
      if (p.eliminated) row.dataset.eliminated = "true";

      const hearts = "♥".repeat(Math.max(0, p.hearts)) + "♡".repeat(Math.max(0, 2 - p.hearts));
      const mistakesText = p.mistakes != null && !p.waiting ? ` 실수:${p.mistakes}/5` : "";
      const status = p.waiting ? "대기 중" : p.eliminated ? "탈락" : p.connected ? (p.isBot ? "AI" : "접속 중") : "연결 끊김";
      row.textContent = `${p.nickname} — ${p.waiting ? "-" : hearts}${mistakesText} — ${status}`;
      container.appendChild(row);
    }
  }

  const me = state.players?.find(p => p.playerIndex === playerIndex);
  if (me) renderHearts(me.hearts);
}

function renderHearts(hearts) {
  const v = Math.max(0, Number(hearts) || 0);
  const text = "♥".repeat(v) + "♡".repeat(Math.max(0, 2 - v));
  setText(["#hearts", "#heartDisplay", "#heartsOnline"], text);
}

function renderMistakes(mistakes, maxMistakes) {
  const remaining = maxMistakes - mistakes;
  const text = `${mistakes}/${maxMistakes}`;
  setText(["#mistakesDisplay", "#mistakesDisplayOnline"], text);
  const els = document.querySelectorAll("#mistakesDisplay, #mistakesDisplayOnline");
  els.forEach(el => { el.dataset.danger = remaining <= 1 ? "true" : "false"; });
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

  const isHost = state.hostSocketId === socket?.id;
  const statusText = state.finished ? "게임 종료" : state.started ? "게임 진행 중" : "대기 중";

  el.innerHTML = `
    <div class="room-header">
      <div>방 코드: <strong class="room-code" title="클릭하면 복사됩니다">${state.roomId}</strong></div>
      <div class="room-status">${statusText}</div>
    </div>
    <div>인원: ${state.playerCount}/${state.maxPlayers}${isHost ? " (방장)" : ""}</div>
  `;

  el.querySelector(".room-code")?.addEventListener("click", () => {
    navigator.clipboard.writeText(state.roomId).then(() => {
      showMessage("방 코드가 복사되었습니다!", "success");
    }).catch(() => {});
  });

  const hostControls = $("#hostControls");
  if (hostControls) {
    if (isHost && (!state.started || state.finished)) {
      hostControls.classList.remove("hidden");
      const startBtn = $("#startOnline");
      if (startBtn) {
        startBtn.textContent = state.finished ? "다시 시작" : "게임 시작";
      }
    } else {
      hostControls.classList.add("hidden");
    }
  }
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
    && gameState.turnPlayer === playerIndex;

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

  socket.emit("room:create", {
    nickname: "플레이어",
    mode: "ai"
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
      const newMode = btn.dataset.mode;

      if (newMode !== currentMode && roomId) {
        leaveRoom();
      }

      currentMode = newMode;
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
  $("#startOnline")?.addEventListener("click", () => {
    if (!socket || !socketConnected) return;
    socket.emit("game:start");
  });
  $("#onlineLeave")?.addEventListener("click", () => {
    leaveRoom();
    $("#hostControls")?.classList.add("hidden");
    renderRoomInfo(null);
  });
  $("#onlineSend")?.addEventListener("click", submitOnlineWord);
  $("#onlineInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitOnlineWord();
    }
  });

});
