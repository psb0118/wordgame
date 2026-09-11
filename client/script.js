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
let startingGame = false;
let myNickname = localStorage.getItem("kkNickname") || "";
let myPassword = localStorage.getItem("kkPassword") || "";
let friends = [];
let friendsPanelOpen = false;
let pendingInvite = null;

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
   닉네임
--------------------------------------------------------- */
function makeNickname(raw) {
  const n = normalizeWord(raw != null ? raw : myNickname);
  return n || "플레이어";
}

function initNicknameBar() {
  const input = $("#nickInput");
  if (input) input.value = myNickname;
  const pw = $("#pwInput");
  if (pw) pw.value = myPassword;
  updateNicknameUI();
}

function updateNicknameUI() {
  const hasName = !!myNickname;
  const input = $("#nickInput");
  if (input) {
    input.classList.toggle("missing", !hasName);
    input.dataset.hasName = hasName ? "true" : "false";
  }
const bar = $(".name-bar");
  if (bar) bar.classList.toggle("attention", !hasName);
  const msg = $("#nickMsg");
  if (msg) {
    if (hasName) {
      msg.textContent = `현재 이름: ${myNickname}`;
      msg.dataset.type = "ok";
    } else {
      msg.textContent = "이름을 설정해 주세요. (리더보드에 표시됩니다)";
      msg.dataset.type = "warn";
    }
  }
  updateAdminVisibility();
}

/* 관리자 패널은 'blossomIng_0' 이름을 가진 사람에게만 보임 (대소문자 무시) */
function isAdminNick(nick) {
  return String(nick || "").replace(/\s+/g, "").toLowerCase() === ADMIN_NICKNAME.replace(/\s+/g, "").toLowerCase();
}

function updateAdminVisibility() {
  const isAdmin = myAdminRole !== "none";
  $all(".admin-btn").forEach(b => b.classList.toggle("hidden", !isAdmin));
  if (!isAdmin && adminModalOpen) closeAdminPanel();
}

function openAdminPanel() {
  const modal = $("#adminModal");
  if (!modal) return;
  if (myAdminRole === "none") { showMessage("관리자 권한이 없습니다.", "error"); return; }
  adminModalOpen = true;
  modal.classList.remove("hidden");
  const body = $("#adminBody");
  if (body) body.innerHTML = `<div class="admin-loading">불러오는 중...</div>`;
  if (socket && socketConnected) socket.emit("admin:getPanel");
  else if (body) body.innerHTML = `<div class="admin-msg error">서버에 연결되어 있지 않습니다.</div>`;
}

function saveNickname() {
  const raw = normalizeWord($("#nickInput")?.value || "");
  const password = $("#pwInput")?.value ?? "";
  const msg = $("#nickMsg");
  if (!raw) {
    if (msg) { msg.textContent = "이름을 입력해주세요."; msg.dataset.type = "error"; }
    return;
  }
  if (raw.length > 12) {
    if (msg) { msg.textContent = "이름은 12자 이내로 입력해주세요."; msg.dataset.type = "error"; }
    return;
  }
  if (socket && socketConnected && socket.id) {
    socket.emit("player:setName", { nickname: raw, password });
  } else {
    myNickname = raw;
    myPassword = password;
    localStorage.setItem("kkNickname", myNickname);
    localStorage.setItem("kkPassword", myPassword);
    updateNicknameUI();
  }
}

function requireNickname() {
  if (myNickname) return true;
  showMessage("먼저 닉네임을 설정해 주세요.", "error");
  const bar = $(".name-bar");
  if (bar) {
    bar.classList.add("attention");
    setTimeout(() => bar.classList.remove("attention"), 2000);
  }
  return false;
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
  "랏": ["랏", "낫"], "랑": ["랑", "낭"], "래": ["래", "내"], "랭": ["랭", "냉"], "럿": ["럿", "엇", "넛"],
  "략": ["략", "약"], "량": ["량", "양"], "련": ["련", "연"],
  "렬": ["렬", "열"], "령": ["령", "영"],
  "러": ["러", "너"], "럭": ["럭", "넉"], "런": ["런", "넌"],
  "럴": ["럴", "널"], "럼": ["럼", "넘"], "럽": ["럽", "넙"],
  "로": ["로", "노"], "록": ["록", "녹"], "론": ["론", "논"],
  "롤": ["롤", "놀"], "롬": ["롬", "놈"], "롭": ["롭", "놑"],
  "롯": ["롯", "놃"], "롱": ["롱", "농"], "뢰": ["뢰", "뇌"],
  "루": ["루", "누"], "륙": ["륙", "육"], "률": ["률", "율"],
  "룬": ["룬", "운"],
  "륜": ["륜", "윤"], "륭": ["륭", "융"],
  "르": ["르", "느"], "른": ["른", "는"],
  "릇": ["릇", "늣"], "룩": ["룩", "눅"], "룅": ["룅", "뇡"],
  "럼": ["럼", "엄", "넘"], "름": ["름", "늠"],
  "륨": ["륨", "늄", "윰"], "늉": ["늉", "융"],
  "렁": ["렁", "엉"], "렴": ["렴", "염"]
};

function getJongsung(char) {
  if (!char || char.length !== 1) return null;
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;
  const jong = (code - 0xAC00) % 28;
  if (jong === 0) return null;
  const JONGSUNG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  return JONGSUNG[jong] || null;
}

function getInitialConsonant(char) {
  if (!char || char.length !== 1) return null;
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;
  const initial = Math.floor((code - 0xAC00) / 588);
  const INITIALS = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  return INITIALS[initial] || null;
}

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
   헬퍼
--------------------------------------------------------- */
function isMyTurn() {
  return gameState && gameState.started && !gameState.finished
    && gameState.turnPlayer === playerIndex;
}

/* ---------------------------------------------------------
   입력 포커스
--------------------------------------------------------- */
function focusInput() {
  setTimeout(() => {
    const input = currentMode === "single" ? $("#singleInput") : $("#onlineInput");
    if (input && !input.disabled) input.focus();
  }, 100);
}

function clearInput() {
  const input = currentMode === "single" ? $("#singleInput") : $("#onlineInput");
  if (input) input.value = "";
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
    /* 브라우저 새로고침(새 소켓) 후에도 서버가 닉네임을 알도록 재적용 */
    if (myNickname) socket.emit("player:setName", { nickname: myNickname, password: myPassword });
    socket.emit("admin:getRole");
    socket.emit("friends:list");
  });

  socket.on("disconnect", () => {
    socketConnected = false;
    submitting = false;
    startingGame = false;
    stopCountdown();
    updateInputState();
    showMessage("서버와 연결이 끊어졌습니다.", "error");
  });

  socket.on("server:ready", (data) => {
    socketConnected = true;
    console.log("[SOCKET] 서버 준비 완료:", data);
    socket.emit("player:getRanking");
  });

  /* -- 랭킹 ------------------------------------------- */
  socket.on("player:ranking", (data) => {
    if (!data) return;
    const sng = data.single || { rank: null, rating: null, wins: 0, losses: 0 };
    const mul = data.multi || { rank: null, rating: null, wins: 0, losses: 0 };
    setText(["#singleRank"], formatRank(sng.rank || calculateRank(sng.rating)));
    setText(["#singleRating", "#singleWins", "#singleLosses"], [sng.rating, sng.wins, sng.losses]);
    setText(["#onlineRank"], formatRank(mul.rank || calculateRank(mul.rating)));
    setText(["#onlineRating", "#onlineWins", "#onlineLosses"], [mul.rating, mul.wins, mul.losses]);
  });

  /* -- 닉네임 ----------------------------------------- */
  socket.on("player:nameUpdated", (data) => {
    if (!data) return;
    if (data.ok && data.nickname) {
      myNickname = data.nickname;
      const currentPw = $("#pwInput")?.value;
      if (currentPw) myPassword = currentPw;
      localStorage.setItem("kkNickname", myNickname);
      localStorage.setItem("kkPassword", myPassword);
      updateNicknameUI();
      showMessage("닉네임이 저장되었습니다.", "success");
      socket.emit("admin:getRole");
      socket.emit("friends:list");
    } else if (data.adminRequired) {
      const msg = $("#nickMsg");
      if (msg) { msg.textContent = data.reason || "관리자 계정 비밀번호를 입력해주세요."; msg.dataset.type = "error"; }
      else showMessage(data.reason || "관리자 계정 비밀번호를 입력해주세요.", "error");
      const pw = $("#pwInput");
      if (pw) pw.focus();
    } else if (data.reason) {
      const msg = $("#nickMsg");
      if (msg) { msg.textContent = data.reason; msg.dataset.type = "error"; }
      else showMessage(data.reason, "error");
    }
  });

  /* -- 관리자 패널 ------------------------------------- */
  socket.on("admin:role", (data) => {
    if (!data) return;
    myAdminRole = data.role === "super" || data.role === "sub" ? data.role : "none";
    updateAdminVisibility();
  });

  socket.on("admin:panel", (data) => {
    if (!data) return;
    renderAdminBody(data);
  });

  socket.on("admin:configUpdated", (cfg) => {
    if (cfg) {
      showMessage("서버 설정이 관리자에 의해 변경되었습니다.", "info");
      if (!adminModalOpen) return;
      socket.emit("admin:getPanel");
    }
  });

  socket.on("admin:findResult", (data) => {
    if (!data) return;
    renderAdminFound(data);
  });

  socket.on("admin:statsUpdated", (data) => {
    if (!data) return;
    if (data.ok && data.player) {
      renderAdminFound({ ok: true, player: data.player });
      setAdminStatus(`'${data.player.nickname}' 통계가 수정되었습니다.`, "ok");
    } else {
      setAdminStatus(data.reason || "통계 수정에 실패했습니다.", "error");
    }
  });

  /* -- 방 이벤트 --------------------------------------- */
  socket.on("room:created", (data) => {
    if (!data.ok) { startingGame = false; return; }
    roomId = data.roomId;
    playerIndex = data.playerIndex;
    gameSessionId++;
    gameState = data.state;
    startingGame = false;
    renderGameState(gameState);
    if (currentMode === "online") {
      showMessage(`방이 생성되었습니다. 방 코드: ${data.roomId}`, "success");
    }
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
    showMessage(data.reason === "kick"
      ? `${data.nickname}님이 추방되었습니다.`
      : `${data.nickname}님이 나갔습니다.`, "info");
  });

  socket.on("room:playerDisconnected", (data) => {
    showMessage(`${data.nickname}님의 연결이 끊어졌습니다.`, "warning");
  });

  /* -- 친구 / 초대 ------------------------------------ */
  socket.on("friends:updated", (data) => {
    if (!data) return;
    if (Array.isArray(data.friends)) friends = data.friends;
    renderFriends();
    if (data.reason) showMessage(data.reason, data.ok ? "success" : "error");
  });

  socket.on("room:inviteSent", (data) => {
    if (!data) return;
    if (data.ok) showMessage(`'${data.nickname}' 님에게 초대를 보냈습니다.`, "success");
    else showMessage(data.reason || "초대에 실패했습니다.", "error");
  });

  socket.on("room:inviteReceived", (data) => {
    if (!data || !data.from || !data.roomId) return;
    pendingInvite = { from: data.from, roomId: data.roomId };
    const toast = $("#inviteToast");
    if (!toast) return;
    $("#inviteText").textContent = `${data.from} 님이 게임에 초대했습니다.`;
    toast.classList.remove("hidden");
  });

  socket.on("room:kicked", (data) => {
    showMessage(data.reason || "방에서 추방되었습니다.", "error");
    leaveRoom();
    resetOnlineBoard();
    renderRoomInfo(null);
    $(".tabs button[data-mode='single']")?.click();
  });

  socket.on("room:left", () => {
    roomId = null;
    playerIndex = null;
    gameState = null;
    showMessage("방을 나갔습니다.", "info");
    hideRoomInfo();
    resetOnlineBoard();
    updateInputState();
  });

  socket.on("room:playerIndex", (data) => {
    if (data && typeof data.playerIndex === "number") {
      playerIndex = data.playerIndex;
      renderGameState(gameState);
    }
  });

  socket.on("game:hint", (data) => {
    if (!data) return;
    if (data.ok && data.word) {
      const input = currentMode === "single" ? $("#singleInput") : null;
      if (input) {
        input.value = data.word;
        focusInput();
      }
    } else if (data.reason) {
      showMessage(data.reason, "info");
    }
  });

  /* -- 게임 이벤트 ------------------------------------- */
  socket.on("game:state", (data) => {
    const wasMyTurn = gameState && gameState.turnPlayer === playerIndex;
    gameState = data;
    renderGameState(gameState);
    const isMyTurn = data.turnPlayer === playerIndex;
    if (isMyTurn && !wasMyTurn) {
      focusInput();
    }
  });

  socket.on("game:started", (data) => {
    gameState = data.state;
    gameSessionId++;
    localUsedWords.clear();
    clearInput();
    renderGameState(gameState);
    showMessage("게임이 시작되었습니다!", "success");
    socket.emit("player:getRanking");
    updateRuleNotice(gameState);
    const hostControls = $("#hostControls");
    if (hostControls) hostControls.classList.add("hidden");
    const wrap = $("#onlineRestartWrap");
    if (wrap) wrap.classList.add("hidden");
    const specNotice = $("#spectatorNotice");
    if (specNotice) specNotice.classList.add("hidden");
    submitting = false;
    updateInputState();
    focusInput();
  });

  socket.on("game:word", (data) => {
    if (data.ok) {
      if (currentMode === "single") {
        localUsedWords.add(data.word);
      }
      applyFx($(".last-char-box"), "fx-flash-ok");
      showMessage(`${data.nickname}: ${data.word}${data.depth != null ? " [깊이 " + data.depth + "]" : ""}`, "success");
      const isMyWord = data.player === playerIndex;
      if (isMyWord) {
        submitting = false;
        clearInput();
        updateInputState();
      }
      if (!isMyTurn()) {
        focusInput();
      }
    }
  });

  socket.on("game:roundReset", (data) => {
    showMessage(data.reason || "새 라운드가 시작됩니다!", "info");
  });

  socket.on("game:oneshot", (data) => {
    if (!data) return;
    const target = data.targetNickname || "상대";
    const isMe = data.target === playerIndex;
    let msg = `한방 단어! ${data.killerNickname || "상대"}님이 ${target}님의 하트를 1개 깎았습니다.`;
    if (isMe && data.hearts != null) msg += ` (남은 하트: ${data.hearts})`;
    showMessage(msg, isMe ? "error" : "info");
    if (isMe && data.hearts != null) renderHearts(data.hearts);
    applyFx($(".game-status"), "fx-heartlost");
    applyFx($(".last-char-box"), "fx-flash-ok");
  });

  socket.on("game:error", (data) => {
    const inputArea = currentMode === "single" ? $(".single-input-area") : $(".online-input-area");
    applyFx(inputArea, "fx-shake");
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
    focusInput();
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
      if (data.hearts != null) renderHearts(data.hearts);
      if (data.mistakes != null && data.mistakesPerLife != null) renderMistakes(data.mistakes, data.mistakesPerLife);
    } else {
      showMessage(`${timeoutName} 시간 초과!`, "info");
    }
    submitting = false;
    updateInputState();
    focusInput();
  });

  socket.on("game:finished", (data) => {
    submitting = false;
    stopCountdown();
    clearInput();
    updateInputState();

    if (data.winner !== null && data.winner === playerIndex) {
      showMessage("게임에서 승리했습니다!", "win");
      if (currentMode === "single") {
        localStats.wins++;
        localStats.games++;
        localStats.totalLength += (gameState?.history?.length || 0);
        saveStats();
        updateStatsUI();
      }
    } else if (data.loser !== null && data.loser === playerIndex) {
      showMessage("게임에서 패배했습니다.", "lose");
      if (currentMode === "single") {
        localStats.losses++;
        localStats.games++;
        localStats.totalLength += (gameState?.history?.length || 0);
        saveStats();
        updateStatsUI();
      }
    } else {
      showMessage("게임이 종료되었습니다.", "info");
    }

    gameState = data.state || gameState;
    renderGameState(gameState);
    socket.emit("player:getRanking");

    if (currentMode === "single") {
      showRestartButton(true);
    } else {
      const wrap = $("#onlineRestartWrap");
      if (wrap) wrap.classList.remove("hidden");
    }
  });

}

/* ---------------------------------------------------------
   렌더링
--------------------------------------------------------- */
function renderGameState(state) {
  if (!state) return;
  const isSingle = currentMode === "single";
  const prefix = isSingle ? "" : "online";

  const syllable = state.startSyllable || state.history?.[0]?.word;
  setText([isSingle ? "#startWord" : "#onlineStartWord"], syllable ? syllable.at(0) : "-");

  const lastChar = state.currentWord ? state.currentWord.at(-1) : null;
  setText([isSingle ? "#last" : "#onlineLast"], lastChar || "-");

  const allowed = lastChar ? allowedFirstChars(lastChar) : [];
  const hintEl = $(isSingle ? "#lastHint" : "#onlineLastHint");
  if (hintEl) {
    if (state.started && !state.finished) {
      if (state.turnNumber === 0) {
        const syllable = state.startSyllable || "";
        hintEl.innerHTML = `"${syllable}"(으)로 시작하는 단어`;
        hintEl.classList.remove("hidden");
      } else {
        const tags = allowed.map(c => `<span class="dueum-tag">${c}</span>`).join(" ");
        hintEl.innerHTML = `다음 글자: ${tags}`;
        hintEl.classList.remove("hidden");
      }
    } else {
      hintEl.classList.add("hidden");
    }
  }

  setText([isSingle ? "#turn" : "#onlineTurn"], state.turnNumber);

  if (state.history && state.history.length > 0) {
    const lastEntry = state.history[state.history.length - 1];
    setText([isSingle ? "#depth" : "#onlineDepth"], lastEntry.depth != null ? lastEntry.depth : "-");
  } else {
    setText([isSingle ? "#depth" : "#onlineDepth"], "-");
  }

  const myTurn = state.started && !state.finished && state.turnPlayer === playerIndex;
  const turnIndicator = $(isSingle ? "#turnIndicator" : "#onlineTurnIndicator");
  if (turnIndicator) {
    if (state.started && !state.finished) {
      if (myTurn) {
        turnIndicator.textContent = "YOUR TURN";
        turnIndicator.dataset.turn = "mine";
      } else {
        const currentName = state.players?.find(p => p.playerIndex === state.turnPlayer)?.nickname || "상대";
        turnIndicator.textContent = `${currentName}의 턴`;
        turnIndicator.dataset.turn = "other";
      }
      turnIndicator.classList.remove("hidden");
    } else {
      turnIndicator.classList.add("hidden");
    }
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
  const freeTurns = state.oneShotFreeTurns || 1;
  const turn = state.turnNumber || 0;
  const selector = currentMode === "single" ? "#ruleNotice" : "#onlineRuleNotice";
  const el = $(selector);
  if (!el) return;

  if (turn < freeTurns) {
    el.textContent = `첫 ${freeTurns}턴은 공격 단어 사용 금지 (${turn}/${freeTurns}) · 실수는 내 차례마다 초기화`;
    el.dataset.active = "true";
  } else {
    el.textContent = "이제 공격 단어 사용 가능 · 실수는 내 차례마다 초기화";
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
    const canKick = (state.hostSocketId === socket?.id) || myAdminRole !== "none";
    for (const p of state.players) {
      const row = document.createElement("div");
      row.className = "player-item";
      if (p.playerIndex === state.turnPlayer) row.dataset.turn = "true";
      if (p.eliminated) row.dataset.eliminated = "true";

      const hearts = "♥".repeat(Math.max(0, p.hearts)) + "♡".repeat(Math.max(0, 2 - p.hearts));
      const mistakesMax = state.mistakesPerLife || 5;
      const mistakesText = p.mistakes != null && !p.waiting ? ` 실수:${p.mistakes}/${mistakesMax}` : "";
      const status = p.waiting ? "대기 중" : p.eliminated ? "탈락" : p.connected ? (p.isBot ? "AI" : "접속 중") : "연결 끊김";
      row.textContent = `${p.nickname} — ${p.waiting ? "-" : hearts}${mistakesText} — ${status}`;

      if (canKick && !p.isBot && p.playerIndex !== playerIndex) {
        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "kick-btn";
        kick.textContent = "추방";
        kick.title = "방장/관리자 추방";
        kick.addEventListener("click", () => {
          if (socket && socketConnected) socket.emit("room:kick", { playerIndex: p.playerIndex });
        });
        row.appendChild(kick);
      }
      container.appendChild(row);
    }
  }

  const me = state.players?.find(p => p.playerIndex === playerIndex);
  if (me) renderHearts(me.hearts);
}

let lastHearts = null;

function renderHearts(hearts) {
  const v = Math.max(0, Number(hearts) || 0);
  const lost = lastHearts !== null && v < lastHearts;
  lastHearts = v;
  const text = "♥".repeat(v) + "♡".repeat(Math.max(0, 2 - v));
  setText(["#hearts", "#heartDisplay", "#heartsOnline"], text);
  if (lost) {
    for (const sel of ["#hearts", "#heartDisplay", "#heartsOnline"]) {
      const node = $(sel);
      if (!node) continue;
      node.classList.remove("shake");
      void node.offsetWidth;
      node.classList.add("shake");
    }
  }
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
    if (item.turn === history.length - 1 && item.turn > 0) {
      row.classList.add("latest");
    }
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
    if (isHost && !state.started && !state.finished) {
      hostControls.classList.remove("hidden");
      const startBtn = $("#startOnline");
      if (startBtn) {
        startBtn.textContent = "게임 시작";
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
  const timerSelector = currentMode === "single" ? "#timer" : "#onlineTimer";
  if (!state || !state.turnEndsAt || state.finished || !state.started) {
    setText([timerSelector], "-");
    const timerBox = $(currentMode === "single" ? ".single-panel .timer-box" : ".online-panel .timer-box") || $(".timer-box");
    if (timerBox) timerBox.dataset.urgent = "false";
    return;
  }
  const update = () => {
    if (!gameState?.turnEndsAt) { stopCountdown(); return; }
    const remaining = Math.max(0, gameState.turnEndsAt - Date.now());
    const secs = Math.ceil(remaining / 1000);
    setText([timerSelector], secs + "s");
    const timerBox = $(currentMode === "single" ? ".single-panel .timer-box" : ".online-panel .timer-box") || $(".timer-box");
    if (timerBox) timerBox.dataset.urgent = secs <= 5 ? "true" : "false";
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
  const hintBtn = $("#hintBtn");

  const myTurn = gameState && gameState.started && !gameState.finished
    && gameState.turnPlayer === playerIndex;

  const amEliminated = gameState && gameState.players
    && gameState.players[playerIndex] && gameState.players[playerIndex].eliminated;

  const disabled = !socketConnected || !roomId || !myTurn || submitting || amEliminated;

  if (input) input.disabled = disabled;
  if (btn) btn.disabled = disabled;
  if (hintBtn) hintBtn.disabled = disabled || currentMode !== "single";

  const inputArea = currentMode === "single" ? $(".single-input-area") : $(".online-input-area");
  if (inputArea) {
    inputArea.dataset.myTurn = myTurn ? "true" : "false";
  }

  const specNotice = $("#spectatorNotice");
  if (specNotice) {
    specNotice.classList.toggle("hidden", !amEliminated || !gameState?.started || gameState?.finished);
  }
}

/* ---------------------------------------------------------
   재시작 버튼 (싱글플레이)
--------------------------------------------------------- */
function showRestartButton(show) {
  const btn = $("#restart");
  if (btn) {
    btn.classList.toggle("hidden", !show);
  }
}

/* ---------------------------------------------------------
   싱글플레이
--------------------------------------------------------- */
function startSingleGame() {
  if (!socket || !socketConnected) {
    showMessage("서버에 연결 중입니다...", "waiting");
    return;
  }

  if (submitting || startingGame) return;
  startingGame = true;

  localUsedWords.clear();
  showRestartButton(false);
  gameState = null;

  socket.emit("room:create", {
    nickname: makeNickname(),
    mode: "ai"
  });
}

function submitSingleWord() {
  if (submitting) return;
  if (!socket || !socketConnected) {
    showMessage("서버에 연결 중입니다...", "waiting");
    return;
  }
  if (!roomId || !gameState) {
    showMessage("게임 준비 중입니다...", "waiting");
    return;
  }
  if (!gameState.started || gameState.finished) {
    showMessage("게임이 아직 시작되지 않았습니다.", "info");
    return;
  }
  if (gameState.turnPlayer !== playerIndex) {
    showMessage("아직 내 차례가 아닙니다.", "info");
    return;
  }

  const input = $("#singleInput");
  if (!input) return;

  const word = normalizeWord(input.value);
  if (!word) return;

  submitting = true;
  socket.emit("game:word", { word });
  updateInputState();
}

/* ---------------------------------------------------------
   온라인
--------------------------------------------------------- */
function createOnlineRoom() {
  if (!socket || !socketConnected) {
    showMessage("서버에 연결 중입니다...", "waiting");
    return;
  }
  if (!requireNickname()) return;

  const nickname = makeNickname();

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
  if (!requireNickname()) return;

  const code = normalizeWord($("#roomCode")?.value);
  if (!code) {
    showMessage("방 코드를 입력해주세요.", "error");
    return;
  }

  const nickname = makeNickname();

  socket.emit("room:join", {
    roomId: code,
    nickname
  });

  showMessage("방에 입장하는 중...", "waiting");
}

function submitOnlineWord() {
  if (submitting) return;
  if (!socket || !socketConnected) {
    showMessage("서버에 연결 중입니다...", "waiting");
    return;
  }
  if (!roomId || !gameState) {
    showMessage("게임 준비 중입니다...", "waiting");
    return;
  }
  if (!gameState.started || gameState.finished) {
    showMessage("게임이 아직 시작되지 않았습니다.", "info");
    return;
  }
  if (gameState.turnPlayer !== playerIndex) {
    showMessage("아직 내 차례가 아닙니다.", "info");
    return;
  }

  const input = $("#onlineInput");
  if (!input) return;

  const word = normalizeWord(input.value);
  if (!word) return;

  submitting = true;
  socket.emit("game:word", { word });
  updateInputState();
}

function leaveRoom() {
  if (!socket || !socketConnected) return;
  socket.emit("room:leave");
  roomId = null;
  playerIndex = null;
  gameState = null;
  localUsedWords.clear();
  startingGame = false;
  stopCountdown();
  resetOnlineBoard();
  updateInputState();
}

/* 온라인 보드/UI를 초기 상태로 정리 — 방 나가기가 바로 반영되도록 */
function resetOnlineBoard() {
  const els = [
    "#onlineHistory", "#onlinePlayers", "#onlineLastHint", "#onlineTurnIndicator",
    "#onlineRestartWrap", "#onlineRuleNotice"
  ];
  for (const sel of els) {
    const el = $(sel);
    if (!el) return;
    if (sel === "#onlineRestartWrap" || sel === "#onlineRuleNotice" || sel === "#onlineTurnIndicator") {
      el.classList.add("hidden");
    } else {
      el.innerHTML = "";
    }
  }
  setText(["#onlineLast"], "-");
  setText(["#onlineStartWord"], "-");
  setText(["#onlineTurn", "#onlineDepth", "#onlineTimer"], "-");
  renderHearts(2);
  renderMistakes(0, 5);
  clearInput();
  const timerBox = $(".online-panel .timer-box");
  if (timerBox) timerBox.dataset.urgent = "false";
}

/* 짧은 애니메이션 클래스 토글 (VFX) */
function applyFx(el, cls, ms = 700) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  clearTimeout(el._fxTimer);
  el._fxTimer = setTimeout(() => el.classList.remove(cls), ms);
}

/* ---------------------------------------------------------
   관리자 패널 (닉네임이 blossomIng_0인 사람에게만 보이는 버튼)
--------------------------------------------------------- */
const ADMIN_NICKNAME = "blossomIng_0";
let myAdminRole = "none";
let adminModalOpen = false;
let adminFoundNick = null;

const ADMIN_CONFIG_LABELS = {
  turnTime: "턴 시간 (초)",
  maxHearts: "최대 하트",
  maxPlayers: "방 최대 인원",
  oneShotFreeTurns: "공격 단어 금지 턴",
  mistakesPerLife: "목숨당 실수 횟수"
};

function closeAdminPanel() {
  const modal = $("#adminModal");
  if (modal) modal.classList.add("hidden");
  adminModalOpen = false;
}

function renderAdminBody(data) {
  const body = $("#adminBody");
  if (!body) return;
  if (!data.ok) {
    body.innerHTML = `<div class="admin-msg error">${escapeHtml(data.reason || "접근할 수 없습니다.")}</div>`;
    if (/닉네임/.test(data.reason || "")) {
      body.innerHTML += `<button class="wide secondary" data-admin-goto-nick="1">닉네임 설정하러 가기</button>`;
    }
    bindAdminBody();
    return;
  }

  const isSuper = data.isSuper === true;
  const role = data.role === "super" ? "super" : "sub";
  const cfg = data.config || {};

  /* 수치 조정 — 최고 관리자 전용 */
  const rows = isSuper ? Object.keys(ADMIN_CONFIG_LABELS).map(key => `
    <label class="admin-row">
      <span>${ADMIN_CONFIG_LABELS[key]}</span>
      <input type="number" class="admin-num" data-admin-key="${key}" value="${Number(cfg[key]) ?? ""}" min="1">
      <button type="button" class="admin-apply" data-admin-apply="${key}">적용</button>
    </label>
  `).join("") : "";

  const configCard = isSuper ? `
    <div class="admin-card">
      <h4>수치 조정 (게임 전체 설정 — 최고 관리자 전용)</h4>
      <input type="password" id="adminPw" placeholder="관리자 비밀번호 (변경 시 필요)" autocomplete="off" data-pw-toggle>
      ${rows}
    </div>
  ` : "";

  /* 서브 관리자 목록/추가/제거/비밀번호 재설정 — 최고 관리자 전용 */
  const subList = (data.subAdmins || []).map(n => `
    <li class="admin-sub-row">
      <span>${escapeHtml(n)}</span>
      <button type="button" class="admin-apply" data-admin-resetsub="${escapeHtml(n)}">비밀번호 변경</button>
      <button type="button" class="admin-apply" data-admin-remove="${escapeHtml(n)}">제거</button>
    </li>
  `).join("");
  const subCard = isSuper ? `
    <div class="admin-card">
      <h4>서브 관리자 관리 (권한: 개인 통계만) — 최고 관리자 전용</h4>
      <div class="admin-row">
        <input type="text" id="adminSubNick" class="admin-text" placeholder="새 관리자 닉네임" autocomplete="off">
        <input type="password" id="adminSubPw" class="admin-text" placeholder="새 관리자 계정 비밀번호 (4자 이상)" autocomplete="off" data-pw-toggle>
        <button type="button" class="admin-apply" data-admin-addsub="1">추가</button>
      </div>
      <ul class="admin-sub-list">${subList || '<li class="admin-info">등록된 서브 관리자가 없습니다.</li>'}</ul>
      <div class="admin-info">※ 관리자 계정은 '닉네임 + 계정 비밀번호'로 로그인합니다. 비밀번호를 모르는 사람은
        같은 닉네임을 써도 관리자 권한을 받을 수 없습니다.</div>
    </div>
  ` : "";

  /* 계정 비밀번호 초기화 — 이름 검색으로, 최고 관리자 전용 */
  const resetCard = isSuper ? `
    <div class="admin-card">
      <h4>계정 비밀번호 초기화 (이름 검색)</h4>
      <div class="admin-row">
        <input type="text" id="adminResetNick" class="admin-text" placeholder="초기화할 관리자 닉네임" autocomplete="off" data-admin-enter="[data-admin-resetsub-search]">
        <input type="password" id="adminResetNewPw" class="admin-text" placeholder="새 비밀번호 (4자 이상)" autocomplete="off" data-pw-toggle>
        <button type="button" class="admin-apply" data-admin-resetsub-search="1">초기화</button>
      </div>
      <div class="admin-info">※ 서브 관리자가 계정 비밀번호를 잊어버린 경우, 이름을 검색해 새 비밀번호로 초기화할 수 있습니다.</div>
    </div>
  ` : "";

  /* 플레이어 통계 관리 — 최고/서브 모두 가능 (자기 비밀번호 필요) */
  const statsCard = `
    <div class="admin-card">
      <h4>플레이어 통계 관리</h4>
      ${isSuper ? "" : `<input type="password" id="adminPw" placeholder="내 관리자 비밀번호 (검색/수정 시 필요)" autocomplete="off" data-pw-toggle>`}
      <div class="admin-row">
        <input type="text" id="adminFindNick" class="admin-text" placeholder="닉네임 검색" autocomplete="off" data-admin-enter="[data-admin-find]">
        <button type="button" class="admin-apply" data-admin-find="1">검색</button>
      </div>
      <div id="adminFound"><div class="admin-info">닉네임을 검색하면 그 유저의 AI 승·플레이어 승 등 개인 통계를 관리할 수 있습니다.</div></div>
    </div>
  `;

  const pwCard = `
    <div class="admin-card">
      <h4>${role === "super" ? "비밀번호 변경 (현재 비밀번호를 알아야 합니다)" : "내 관리자 비밀번호 변경 (현재 비밀번호를 알아야 합니다)"}</h4>
      <input type="password" id="adminPwCurrent" placeholder="현재 비밀번호" autocomplete="off" data-pw-toggle>
      <input type="password" id="adminPwNext" placeholder="새 비밀번호 (4자 이상)" autocomplete="off" data-pw-toggle>
      <button class="admin-pw-change" data-admin-pw="${role === "super" ? "change" : "subchange"}">비밀번호 변경</button>
    </div>
  `;

  const statusLine = isSuper
    ? (data.hasPassword
        ? `<div class="admin-msg ok">관리자 계정 비밀번호가 설정되어 있습니다. 로그인 시 닉네임과 함께 입력하세요.</div>`
        : `<div class="admin-msg warn">첫 실행입니다. 닉네임 저장 시 계정 비밀번호(4자 이상)를 입력하면 관리자 계정이 만들어집니다.</div>`)
    : `<div class="admin-info">서브 관리자 — 개인 통계 관리만 가능하며 게임 전체 설정은 변경할 수 없습니다.</div>`;

  body.innerHTML = `
    ${statusLine}
    <div class="admin-info">시작 음절: <b>${(data.startSyllables || []).join(" ")}</b> &nbsp;·&nbsp; 현재 연결: <b>${escapeHtml(myNickname || "-")}</b></div>
    ${pwCard}
    ${subCard}
    ${resetCard}
    ${configCard}
    ${statsCard}
    <div class="admin-status" id="adminStatus"></div>
  `;
  bindAdminBody();
}

function renderAdminFound(data) {
  const wrap = $("#adminFound");
  if (!wrap) return;
  if (!data.ok) {
    wrap.innerHTML = `<div class="admin-msg error">${escapeHtml(data.reason || "검색할 수 없습니다.")}</div>`;
    return;
  }
  const p = data.player;
  adminFoundNick = p.nickname;
  const statsRow = (mode, label) => {
    const s = p[mode] || {};
    return `
      <div class="admin-stats-mode">
        <div class="admin-stats-title">${label}</div>
        <label class="admin-row"><span>점수</span><input type="number" class="admin-num" data-admin-m="${mode}" data-admin-f="rating" value="${s.rating ?? 0}" min="0" max="9999"></label>
        <label class="admin-row"><span>승 (플레이어 승)</span><input type="number" class="admin-num" data-admin-m="${mode}" data-admin-f="wins" value="${s.wins ?? 0}" min="0"></label>
        <label class="admin-row"><span>패 (AI 승)</span><input type="number" class="admin-num" data-admin-m="${mode}" data-admin-f="losses" value="${s.losses ?? 0}" min="0"></label>
        <div class="admin-row"><span></span><button type="button" class="admin-apply" data-admin-stats="${mode}">${label} 통계 적용</button></div>
      </div>`;
  };
  wrap.innerHTML = `
    <div class="admin-found-head">대상: <b>${escapeHtml(p.nickname)}</b></div>
    ${statsRow("single", "싱글 (AI 대전)")}
    ${statsRow("multi", "멀티 (온라인)")}
    <div class="admin-info">※ 승·패·점수를 직접 조정합니다. 저장 후 새 게임 결과부터 반영됩니다.</div>
  `;
  wrap.querySelectorAll("[data-admin-stats]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.adminStats;
      const pw = $("#adminPw")?.value ?? "";
      if (!pw) { setAdminStatus("통계 수정에는 관리자 비밀번호가 필요합니다.", "error"); return; }
      const get = (f) => {
        const i = wrap.querySelector(`[data-admin-m="${mode}"][data-admin-f="${f}"]`);
        return Number(i?.value ?? 0);
      };
      socket.emit("admin:setPlayerStats", {
        nickname: adminFoundNick, mode, password: pw,
        rating: get("rating"), wins: get("wins"), losses: get("losses")
      });
    });
  });
}

function bindAdminBody() {
  const modal = $("#adminModal");
  if (!modal) return;

  const gotoNick = modal.querySelector("[data-admin-goto-nick]");
  if (gotoNick) gotoNick.addEventListener("click", () => { closeAdminPanel(); $("#nickInput")?.focus(); });

  const pwBtn = modal.querySelector("[data-admin-pw]");
  if (pwBtn) pwBtn.addEventListener("click", () => {
    const current = modal.querySelector("#adminPwCurrent")?.value ?? "";
    const next = modal.querySelector("#adminPwNext")?.value ?? "";
    if (!next || next.length < 4) { setAdminStatus("비밀번호는 4자 이상이어야 합니다.", "error"); return; }
    if (pwBtn.dataset.adminPw === "subchange") {
      socket.emit("admin:setSubPassword", { current, next });
    } else {
      socket.emit("admin:setPassword", { current, next });
    }
  });

  const addSub = modal.querySelector("[data-admin-addsub]");
  if (addSub) addSub.addEventListener("click", () => {
    const nickname = modal.querySelector("#adminSubNick")?.value.trim() ?? "";
    const adminPassword = modal.querySelector("#adminSubPw")?.value.trim() ?? "";
    const password = modal.querySelector("#adminPw")?.value ?? "";
    if (!nickname || nickname.length < 2) { setAdminStatus("관리자 닉네임을 입력해주세요.", "error"); return; }
    if (adminPassword.length < 4) { setAdminStatus("관리자 비밀번호는 4자 이상이어야 합니다.", "error"); return; }
    if (!password) { setAdminStatus("진행하려면 관리자 비밀번호가 필요합니다.", "error"); return; }
    socket.emit("admin:addSubAdmin", { nickname, adminPassword, password });
  });

  const removeSub = modal.querySelectorAll("[data-admin-remove]");
  removeSub.forEach(btn => btn.addEventListener("click", () => {
    const password = modal.querySelector("#adminPw")?.value ?? "";
    if (!password) { setAdminStatus("진행하려면 관리자 비밀번호가 필요합니다.", "error"); return; }
    socket.emit("admin:removeSubAdmin", { nickname: btn.dataset.adminRemove, password });
  }));

  const resetSub = modal.querySelectorAll("[data-admin-resetsub]");
  resetSub.forEach(btn => btn.addEventListener("click", () => {
    const password = modal.querySelector("#adminPw")?.value ?? "";
    if (!password) { setAdminStatus("재설정하려면 관리자 비밀번호가 필요합니다.", "error"); return; }
    const nickname = btn.dataset.adminResetsub;
    const newPassword = prompt(`'${nickname}' 관리자 계정의 새 비밀번호를 입력하세요 (4자 이상)`);
    if (!newPassword) return;
    if (newPassword.length < 4) { setAdminStatus("비밀번호는 4자 이상이어야 합니다.", "error"); return; }
    socket.emit("admin:resetSubPassword", { nickname, password, newPassword });
  }));

  const foundBtn = modal.querySelector("[data-admin-find]");
  if (foundBtn) foundBtn.addEventListener("click", () => {
    const nick = modal.querySelector("#adminFindNick")?.value.trim() ?? "";
    const pw = modal.querySelector("#adminPw")?.value ?? "";
    if (!nick) { setAdminStatus("검색할 닉네임을 입력해주세요.", "error"); return; }
    if (!pw) { setAdminStatus("검색에는 관리자 비밀번호가 필요합니다.", "error"); return; }
    socket.emit("admin:findPlayer", { nickname: nick, password: pw });
  });

  const resetSubSearch = modal.querySelector("[data-admin-resetsub-search]");
  if (resetSubSearch) resetSubSearch.addEventListener("click", () => {
    const nickname = modal.querySelector("#adminResetNick")?.value.trim() ?? "";
    const newPassword = modal.querySelector("#adminResetNewPw")?.value ?? "";
    const password = modal.querySelector("#adminPw")?.value ?? "";
    if (!nickname) { setAdminStatus("초기화할 관리자 닉네임을 입력해주세요.", "error"); return; }
    if (newPassword.length < 4) { setAdminStatus("새 비밀번호는 4자 이상이어야 합니다.", "error"); return; }
    if (!password) { setAdminStatus("진행하려면 상단 관리자 비밀번호가 필요합니다.", "error"); return; }
    socket.emit("admin:resetSubPassword", { nickname, password, newPassword });
  });

  /* 엔터 키로 버튼 실행 (데이터 어트리뷰트로 지정된 버튼) */
  modal.querySelectorAll("[data-admin-enter]").forEach(inp => {
    inp.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const btn = modal.querySelector(inp.dataset.adminEnter);
      if (btn) btn.click();
    });
  });

  /* 비밀번호 보기/숨기기 편의 토글 */
  modal.querySelectorAll("[data-pw-toggle]").forEach(setupPwToggleInput);

  modal.querySelectorAll("[data-admin-apply]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.adminApply;
      if (btn.hasAttribute("data-admin-find")) return;
      const input = modal.querySelector(`[data-admin-key="${key}"]`);
      const pw = modal.querySelector("#adminPw")?.value ?? "";
      if (!pw) { setAdminStatus("수치 변경에는 관리자 비밀번호가 필요합니다.", "error"); return; }
      socket.emit("admin:updateConfig", { key, value: Number(input?.value), password: pw });
    });
  });
}

function setAdminStatus(text, type) {
  const el = $("#adminStatus");
  if (!el) return;
  el.textContent = text;
  el.dataset.type = type || "ok";
}

/* 비밀번호 보기/숨기기 토글 — input을 감싸고 버튼을 붙인다 */
function setupPwToggleInput(input) {
  if (!input || input.dataset.pwToggled) return;
  input.dataset.pwToggled = "1";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-toggle";
  btn.textContent = "보기";
  btn.setAttribute("aria-label", "비밀번호 보기/숨기기");
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "숨김" : "보기";
    input.focus();
  });
  const wrap = document.createElement("span");
  wrap.className = "pw-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  wrap.appendChild(btn);
}

/* ---------------------------------------------------------
   친구 패널 & 초대
--------------------------------------------------------- */
function toggleFriendsPanel(force) {
  const panel = $("#friendsPanel");
  if (!panel) return;
  friendsPanelOpen = typeof force === "boolean" ? force : !friendsPanelOpen;
  panel.classList.toggle("hidden", !friendsPanelOpen);
  if (friendsPanelOpen) {
    socket?.emit("friends:list");
    $("#friendsAddInput")?.focus();
  }
}

function renderFriends() {
  const list = $("#friendsList");
  if (!list) return;
  const count = $("#friendsCount");
  if (count) {
    count.classList.toggle("hidden", friends.length === 0);
    count.textContent = friends.length;
  }
  if (!myNickname) {
    list.innerHTML = `<div class="friends-empty">닉네임을 먼저 저장해주세요.</div>`;
    return;
  }
  if (friends.length === 0) {
    list.innerHTML = `<div class="friends-empty">아직 친구가 없습니다.<br>위 입력란에 친구 닉네임을 입력해 추가하세요.</div>`;
    return;
  }
  list.innerHTML = friends.map(f => `
    <div class="friend-row${f.online ? " online" : ""}">
      <span class="friend-dot"></span>
      <span class="friend-name">${escapeHtml(f.nickname)}</span>
      ${f.online ? `<button class="friend-invite" data-friend-invite="${escapeHtml(f.nickname)}">초대</button>` : `<span class="friend-offline">오프라인</span>`}
      <button class="friend-del" data-friend-del="${escapeHtml(f.nickname)}">삭제</button>
    </div>`).join("");
  list.querySelectorAll("[data-friend-invite]").forEach(btn => {
    btn.addEventListener("click", () => inviteByNickname(btn.dataset.friendInvite));
  });
  list.querySelectorAll("[data-friend-del]").forEach(btn => {
    btn.addEventListener("click", () => socket?.emit("friends:remove", { nickname: btn.dataset.friendDel }));
  });
}

/* 친구/닉네임으로 초대 — 온라인 방이 없으면 자동으로 만들어 초대 */
function inviteByNickname(nick) {
  const name = String(nick || "").trim();
  if (!name) { showMessage("초대할 닉네임을 입력해주세요.", "error"); return; }
  if (!myNickname) { toggleFriendsPanel(true); showMessage("초대하려면 먼저 닉네임을 저장해주세요.", "error"); return; }
  const inOnlineRoom = gameState && gameState.mode === "online";
  if (inOnlineRoom) {
    socket.emit("room:invite", { nickname: name });
    return;
  }
  showMessage("초대용 온라인 방을 만들고 있습니다...", "info");
  const t = setTimeout(() => { startingGame = false; }, 6000);
  const created = (d) => {
    socket.off("room:created", created);
    clearTimeout(t);
    if (d && d.ok) socket.emit("room:invite", { nickname: name });
    else showMessage("온라인 방을 만들지 못해 초대를 보내지 못했습니다.", "error");
  };
  socket.once("room:created", created);
  socket.emit("room:create", { nickname: myNickname, mode: "online" });
}

function acceptInvite() {
  const inv = pendingInvite;
  const toast = $("#inviteToast");
  if (toast) toast.classList.add("hidden");
  pendingInvite = null;
  if (!inv) return;
  if (!myNickname) { showMessage("초대를 수락하려면 닉네임을 먼저 저장해주세요.", "error"); return; }
  if (roomId) leaveRoom();
  socket.emit("room:join", { roomId: inv.roomId, nickname: myNickname });
  const tab = $(".tabs button[data-mode='online']");
  if (tab) tab.click();
}

function declineInvite() {
  const toast = $("#inviteToast");
  if (toast) toast.classList.add("hidden");
  pendingInvite = null;
}

/* ---------------------------------------------------------
   리더보드
--------------------------------------------------------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

let lbMode = "single";

function lbMarkup(rows) {
  const modeLabel = lbMode === "single" ? "싱글플레이" : "온라인 멀티";
  const toggle = `<div class="lb-toggle">
        <button data-mode="single">싱글플레이</button>
        <button data-mode="multi">온라인 멀티</button>
      </div>`;
  let body;
  if (rows.length === 0) {
    body = `<div class="lb-empty">아직 기록이 없습니다.</div>`;
  } else {
    body = rows.map(r => {
      const tier = r.tier ? (r.tier.sub ? `${r.tier.tier} ${r.tier.sub}` : r.tier.tier) : "-";
      const cls = r.rank === 1 ? " top1" : r.rank <= 3 ? " top3" : "";
      const me = String(r.nickname || "플레이어").replace(/\s+/g, "").toLowerCase() === String(myNickname || "").replace(/\s+/g, "").toLowerCase() && myNickname ? " lb-me" : "";
      return `<div class="lb-row${cls}${me}">
            <span class="lb-rank">${r.rank}</span>
            <span class="lb-name">${escapeHtml(r.nickname || "플레이어")}</span>
            <span class="lb-tier">${escapeHtml(tier)}</span>
            <span class="lb-rating"><strong>${r.ranking}점</strong> · ${r.wins}승 ${r.losses}패</span>
          </div>`;
    }).join("");
  }
  return `<div class="lb-heading">리더보드 · ${modeLabel}</div>${toggle}${body}`;
}

function bindLbToggles(box, btn) {
  box.querySelectorAll(".lb-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === lbMode);
    b.addEventListener("click", () => {
      lbMode = b.dataset.mode === "multi" ? "multi" : "single";
      loadLeaderboardRows(box, btn);
    });
  });
}

async function toggleLeaderboard() {
  const box = $("#leaderboard");
  const btn = $("#loadLb");
  if (!box) return;
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    if (btn) btn.textContent = "리더보드 보기";
    return;
  }
  if (btn) btn.textContent = "불러오는 중...";
  try {
    const res = await fetch(`/api/leaderboard?limit=10&mode=${lbMode}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("bad payload");
    box.innerHTML = lbMarkup(rows);
    bindLbToggles(box, btn);
    box.classList.remove("hidden");
    if (btn) btn.textContent = "리더보드 접기";
  } catch (err) {
    box.innerHTML = `<div class="lb-empty" style="color:#f87171">리더보드를 불러오지 못했습니다.</div>`;
    box.classList.remove("hidden");
    if (btn) btn.textContent = "리더보드 보기";
  }
}

async function loadLeaderboardRows(box, btn) {
  if (!box) return;
  try {
    const res = await fetch(`/api/leaderboard?limit=10&mode=${lbMode}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("bad payload");
    box.innerHTML = lbMarkup(rows);
    bindLbToggles(box, btn);
  } catch (err) {
    box.innerHTML = `<div class="lb-empty" style="color:#f87171">리더보드를 불러오지 못했습니다.</div>`;
  }
}

/* ---------------------------------------------------------
   초기화
--------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initSocket();
  initNicknameBar();
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
        if (!gameState || !roomId) {
          setTimeout(startSingleGame, 100);
        }
      }
    });
  });

  /* 초기 로드 시 싱글플레이 자동 시작 */
  setTimeout(startSingleGame, 500);

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
  $("#hintBtn")?.addEventListener("click", () => {
    if (!socket || !socketConnected) return;
    socket.emit("game:hint");
  });
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
  $("#onlineRestart")?.addEventListener("click", () => {
    if (!socket || !socketConnected) return;
    const wrap = $("#onlineRestartWrap");
    if (wrap) wrap.classList.add("hidden");
    socket.emit("game:restart");
  });

  $("#loadLb")?.addEventListener("click", toggleLeaderboard);

  /* 친구 패널 & 초대 */
  $("#friendsBtn")?.addEventListener("click", () => toggleFriendsPanel());
  $("#friendsClose")?.addEventListener("click", () => toggleFriendsPanel(false));
  $("#friendsAddInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#friendsAddBtn")?.click(); }
  });
  $("#friendsAddBtn")?.addEventListener("click", () => {
    const nick = $("#friendsAddInput")?.value.trim() ?? "";
    if (!myNickname) { toggleFriendsPanel(true); showMessage("친구를 추가하려면 먼저 닉네임을 저장해주세요.", "error"); return; }
    if (!nick) { showMessage("친구 닉네임을 입력해주세요.", "error"); return; }
    socket?.emit("friends:add", { nickname: nick });
    if ($("#friendsAddInput")) $("#friendsAddInput").value = "";
  });
  $("#onlineInviteBtn")?.addEventListener("click", () => {
    inviteByNickname($("#onlineInviteInput")?.value ?? "");
  });
  $("#onlineInviteInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#onlineInviteBtn")?.click(); }
  });
  $("#inviteAccept")?.addEventListener("click", acceptInvite);
  $("#inviteDecline")?.addEventListener("click", declineInvite);

  /* 관리자 패널 — 닉네임이 blossomIng_0인 사용자에게만 보이는 버튼 */
  $all(".admin-btn").forEach(btn => btn.addEventListener("click", openAdminPanel));
  $("#nickInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveNickname(); }
  });
  const adminModal = $("#adminModal");
  if (adminModal) {
    adminModal.addEventListener("click", (e) => {
      if (e.target.closest("[data-admin-close]")) { closeAdminPanel(); return; }
      if (e.target === adminModal) closeAdminPanel();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAdminPanel();
  });

  /* 닉네임 */
  $("#nickSave")?.addEventListener("click", saveNickname);
  $("#nickInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveNickname();
    }
  });

  /* 계정 비밀번호 보기/숨기기 토글 (닉네임 바) */
  $("#pwToggle")?.addEventListener("click", () => {
    const input = $("#pwInput");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("#pwToggle").textContent = show ? "숨김" : "보기";
    input.focus();
  });
  $("#pwInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveNickname();
    }
  });

});
