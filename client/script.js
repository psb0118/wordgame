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
let currentMaxHearts = 2;
let submitting = false;
let submitLockTimer = null;
let countdownTimer = null;
let gameSessionId = 0;
let startingGame = false;
let myNickname = localStorage.getItem("kkNickname") || "";
let myPassword = localStorage.getItem("kkPassword") || "";
let friends = [];
let friendsPanelOpen = false;
let pendingInvite = null;
/* 싱글 AI 난이도 (easy/normal/hard) */
let aiDifficulty = localStorage.getItem("kkAiDiff") || "normal";

const localStats = JSON.parse(localStorage.getItem("kkStats") || '{"wins":0,"losses":0,"games":0,"totalLength":0}');
let localUsedWords = new Set();

/* 금액/상점/버그/랭크 상태 */
let moneyBalance = 0;
let moneyMultiplier = 1;
let ratingBoostGames = 0;
let ownedTitles = [];
let currentTitle = "";
let shopInfo = null;
let rankedQueued = false;
let rankedMatchInfo = null;
let rankedAutoLeave = null;
let rankedRematchReq = false;
let rankedAutoContinue = localStorage.getItem("kkAutoRequeue") === "1";
let rankedStreak = 0;
let rankedBestStreak = 0;
let lastRankedStreak = 0;

/* 출석체크 상태 */
let attendanceCheckedToday = false;
let attendanceStreak = 0;
let attendanceNextReward = 0;
const attendanceReward = (streak) => Math.min(10000, 2000 + (streak - 1) * 1000);

/* 일일 미션 & 최근 전적 상태 */
let missionsState = [];
let recentGamesState = [];
let dailyCounters = null;

/* 실시간 랭킹 패널 상태 */
let sideRankMode = "multi";
const SIDE_RANK_LIMIT = 10;

/* ---------------------------------------------------------
   사운드 & 진동 — Web Audio. 브라우저 자동재생 정책 때문에
   첫 사용자 조작 시 AudioContext를 시작한다
--------------------------------------------------------- */
let soundEnabled = localStorage.getItem("kkSound") !== "0";
let audioCtx = null;
function ensureAudio() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
  return audioCtx;
}
function tone(freq, dur = 0.08, type = "sine", vol = 0.05, delay = 0) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch (e) { /* 오디오 실패는 조용히 무시 */ }
}
function vibrate(pattern) {
  if (!soundEnabled) return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
}
function playSound(name) {
  if (!soundEnabled) return;
  switch (name) {
    case "start": tone(392, 0.09, "triangle"); tone(523, 0.09, "triangle", 0.05, 0.09); tone(659, 0.12, "triangle", 0.05, 0.18); break;
    case "turn": tone(660, 0.07, "sine"); vibrate(20); break;
    case "word": tone(523, 0.09, "triangle"); tone(784, 0.1, "triangle", 0.05, 0.08); vibrate(25); break;
    case "oppWord": tone(330, 0.07, "sine", 0.04); break;
    case "oneshot": tone(523, 0.09, "square", 0.05); tone(659, 0.09, "square", 0.05, 0.08); tone(784, 0.15, "square", 0.05, 0.16); vibrate(50); break;
    case "heartLost": tone(330, 0.12, "sawtooth", 0.05); tone(220, 0.18, "sawtooth", 0.05, 0.1); vibrate([60, 40, 60]); break;
    case "win": tone(523, 0.1, "triangle", 0.06); tone(659, 0.1, "triangle", 0.06, 0.1); tone(784, 0.1, "triangle", 0.06, 0.2); tone(1046, 0.24, "triangle", 0.07, 0.3); vibrate([40, 40, 80]); break;
    case "lose": tone(392, 0.14, "sawtooth", 0.05); tone(311, 0.14, "sawtooth", 0.05, 0.14); tone(233, 0.24, "sawtooth", 0.05, 0.28); vibrate([80, 60, 120]); break;
    case "draw": tone(330, 0.1, "sine", 0.05); tone(294, 0.18, "sine", 0.05, 0.1); vibrate(40); break;
    case "cash": tone(880, 0.08, "sine"); tone(1318, 0.14, "sine", 0.05, 0.06); break;
    case "error": tone(200, 0.12, "square", 0.04); vibrate(60); break;
  }
}
function renderSoundToggle() {
  const btn = $("#soundToggle");
  if (btn) btn.textContent = soundEnabled ? "🔊" : "🔇";
}

/* ---------------------------------------------------------
   모드별 DOM 요소 맵 (single / online / ranked)
--------------------------------------------------------- */
const MODE_ELEMENTS = {
  single: {
    input: "#singleInput", send: "#singleSend", message: "#message",
    history: "#history", players: null, last: "#last", hint: "#lastHint",
    turn: "#turn", depth: "#depth", startWord: "#startWord", timer: "#timer",
    turnIndicator: "#turnIndicator", ruleNotice: "#ruleNotice", hearts: "#hearts",
    mistakes: "#mistakesDisplay", timerBox: "#single .timer-box"
  },
  online: {
    input: "#onlineInput", send: "#onlineSend", message: "#onlineMessage",
    history: "#onlineHistory", players: "#onlinePlayers", last: "#onlineLast",
    hint: "#onlineLastHint", turn: "#onlineTurn", depth: "#onlineDepth",
    startWord: "#onlineStartWord", timer: "#onlineTimer",
    turnIndicator: "#onlineTurnIndicator", ruleNotice: "#onlineRuleNotice",
    hearts: "#heartsOnline", mistakes: "#mistakesDisplayOnline",
    timerBox: "#online .timer-box", roomInfo: "#roomInfo"
  },
  ranked: {
    input: "#rankedInput", send: "#rankedSend", message: "#rankedMessage",
    history: "#rankedHistory", players: "#rankedPlayers", last: "#rankedLast",
    hint: "#rankedLastHint", turn: "#rankedTurn", depth: "#rankedDepth",
    startWord: "#rankedStartWord", timer: "#rankedTimer",
    turnIndicator: "#rankedTurnIndicator", ruleNotice: "#onlineRuleNotice",
    hearts: "#heartsRanked", mistakes: "#mistakesDisplayRanked",
    timerBox: "#ranked .timer-box", roomInfo: "#rankedRoomInfo"
  }
};

function modeEl(name) { return MODE_ELEMENTS[currentMode]?.[name] || null; }
function modeGet(name) { const q = modeEl(name); return q ? $(q) : null; }

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
  const el = modeGet("message") || (currentMode === "single" ? $("#message") : $("#onlineMessage"));
  if (el) {
    el.textContent = text;
    el.dataset.type = type || "";
    return;
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
  const password = $("#accPwInput")?.value ?? "";
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
    persistPassword(password);
    updateNicknameUI();
  }
}

/* 비밀번호 localStorage 저장 규칙
   - 일반 사용자: 입력한 비밀번호 무조건 저장 (다시 물어보지 않게)
   - 관리자: '비밀번호 저장' 체크박스가 켜져 있을 때만 저장, 꺼져 있으면 삭제 */

/* 비밀번호 localStorage 저장 규칙
   - 일반 사용자: 입력한 비밀번호 무조건 저장 (다시 물어보지 않게)
   - 관리자: '비밀번호 저장' 체크박스가 켜져 있을 때만 저장, 꺼져 있으면 삭제 */
function persistPassword(pw) {
  const saveAdmin = localStorage.getItem("kkSaveAdmin") === "1";
  const isAdmin = myAdminRole !== "none";
  if (isAdmin && !saveAdmin) {
    localStorage.removeItem("kkPassword");
    return;
  }
  if (pw) {
    localStorage.setItem("kkPassword", pw);
    myPassword = pw;
  } else if (localStorage.getItem("kkPassword")) {
    localStorage.setItem("kkPassword", myPassword || "");
  }
}

/* 관리자로 로그인됐는데 저장 옵션이 꺼져 있으면 저장된 비밀번호 제거 */
function syncSavedCredentials() {
  const saveAdmin = localStorage.getItem("kkSaveAdmin") === "1";
  const isAdmin = myAdminRole !== "none";
  if (isAdmin && !saveAdmin) {
    localStorage.removeItem("kkPassword");
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
"럴": ["럴", "널"], "럽": ["럽", "넙"],
  "레": ["레", "네", "에"],
  "력": ["력", "역"],
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
  "늄": ["늄", "윰"], "윰": ["윰", "늄"],
  "력": ["력", "역"], "역": ["역", "력"],
  "렁": ["렁", "엉"], "렴": ["렴", "염"],
  "렷": ["렷", "엿", "녓"],
  "녓": ["녓", "엿"], "엿": ["엿", "녓"],
  "릊": ["릊", "늦", "읒"], "늦": ["늦", "릊", "읒"], "읒": ["읒", "릊", "늦"],
  "릅": ["릅", "늡"], "늡": ["늡", "릅"],
  "닢": ["닢", "잎"], "잎": ["잎", "닢"]
};

/* 자동 두음법칙 확장 — 서버 game.js와 동일 로직
   (초성 두음법칙 교체만, 받침 유지, 역방향 포함) */
const Y_GLIDE_MOS = new Set([2, 3, 6, 7, 12, 17, 20]); /* 이/야/여/예/요/유 앞 */

function buildDueumAuto() {
  const map = new Map();
  for (let m = 0; m < 21; m++) {
    const yg = Y_GLIDE_MOS.has(m);
    for (let j = 0; j < 28; j++) {
      for (let cho = 0; cho < 19; cho++) {
        const base = 0xAC00 + (cho * 21 + m) * 28 + j;
        const c = String.fromCharCode(base);
        let partners = [];
        if (cho === 5) partners = yg ? [11] : [2];         /* ㄹ */
        else if (cho === 2) partners = yg ? [11, 5] : [5]; /* ㄴ */
        else if (cho === 11) partners = yg ? [5, 2] : [];  /* ㅇ */
        for (const pcho of partners) {
          const p = String.fromCharCode(0xAC00 + (pcho * 21 + m) * 28 + j);
          if (p === c) continue;
          if (!map.has(c)) map.set(c, new Set());
          map.get(c).add(p);
          if (!map.has(p)) map.set(p, new Set());
          map.get(p).add(c);
        }
      }
    }
  }
  return map;
}

const AUTO_DUEUM = buildDueumAuto();

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

  const auto = AUTO_DUEUM.get(lastChar);
  if (auto) for (const ch of auto) result.add(ch);

  return [...result];
}

/* ---------------------------------------------------------
   랭크 계산 (클라이언트)
--------------------------------------------------------- */
function calculateRank(rating) {
  rating = Math.max(0, Number(rating) || 0);
  const tierTables = [
    { tier: "Bronze", base: 0, span: 1000 },
    { tier: "Silver", base: 1000, span: 400 },
    { tier: "Gold", base: 1400, span: 400 },
    { tier: "Platinum", base: 1800, span: 400 },
    { tier: "Diamond", base: 2200, span: 400 },
    { tier: "Master", base: 2600, span: 400 }
  ];
  if (rating >= 3000) return { tier: "Grandmaster", sub: "" };
  let tier = tierTables[tierTables.length - 1];
  for (const t of tierTables) {
    if (rating >= t.base) tier = t;
  }
  const step = Math.floor((rating - tier.base) / (tier.span / 5));
  const sub = 5 - Math.max(0, Math.min(4, step));
  return { tier: tier.tier, sub: String(sub) };
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

/* 같은 소켓에 남아 있던 싱글(AI) 게임 이벤트가 멀티/랭크 화면에
   스며들어 "AI가 들어온 것처럼" 보이는 문제 방지 —
   AI 모드 이벤트는 싱글 탭에 있을 때만 처리한다 */
function isStaleAIEvent(payloadMode, state) {
  const m = payloadMode || (state && state.mode);
  return m === "ai" && currentMode !== "single";
}

/* ---------------------------------------------------------
   입력 포커스
--------------------------------------------------------- */
function focusInput() {
  setTimeout(() => {
    const input = modeGet("input");
    if (input && !input.disabled) input.focus();
  }, 100);
}

function clearInput() {
  const input = modeGet("input");
  if (input) input.value = "";
}

/* 제출 중 잠금 — 응답 이벤트가 어떤 이유로든 늦더라도
   2초 후 자동 해제되어 입력이 영원히 씹히지 않게 한다 */
function lockSubmitting() {
  submitting = true;
  clearTimeout(submitLockTimer);
  submitLockTimer = setTimeout(() => {
    submitLockTimer = null;
    if (submitting) {
      submitting = false;
      updateInputState();
    }
  }, 2000);
}

/* ---------------------------------------------------------
   Socket.IO 연결 (한 번만)
--------------------------------------------------------- */
function initSocket() {
  if (socket) return;

  socket = io({
    transports: ["websocket"],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000
  });

  socket.on("connect", () => {
    socketConnected = true;
    console.log("[SOCKET] 연결됨:", socket.id);
    /* 브라우저 새로고침 후에도 자동 로그인되도록 저장된 비밀번호를 함께 전송
       (일반 사용자는 입력한 비밀번호 자동 저장 / 관리자는 체크박스 선택 시에만 저장) */
    if (myNickname) socket.emit("player:setName", { nickname: myNickname, password: myPassword });
    socket.emit("admin:getRole");
    /* 연결이 늦어져 싱글 게임 자동 시작 타이머를 놓친 경우를 대비해 재시도 */
    if (currentMode === "single" && !roomId && !gameState && !startingGame) {
      startSingleGame();
    }
  });

  socket.on("disconnect", () => {
    socketConnected = false;
    submitting = false;
    startingGame = false;
    rankedQueued = false;
    updateRankedQueueUI();
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
    const rkd = data.ranked || { rank: null, rating: null, wins: 0, losses: 0 };
    setText(["#singleRank"], formatRank(sng.rank || calculateRank(sng.rating)));
    setText(["#singleRating"], sng.rating);
    setText(["#onlineRank"], formatRank(mul.rank || calculateRank(mul.rating)));
    setText(["#onlineRating"], mul.rating);
    setText(["#accSingleRating"], sng.rating);
    setText(["#accSingleRank"], sng.rank ? formatRank(sng.rank) : "");
    setText(["#accMultiRating"], mul.rating);
    setText(["#accMultiRank"], mul.rank ? formatRank(mul.rank) : "");
    setText(["#accRankedRating"], rkd.rating);
    setText(["#accRankedRank"], rkd.rank ? formatRank(rkd.rank) : "");
    rankedStreak = rkd.streak || 0;
    rankedBestStreak = rkd.bestStreak || 0;
    setText(["#accRankedStreak"], rankedStreak || 0);
    setText(["#accRankedBestStreak"], rankedBestStreak > 0 ? `최대 ${rankedBestStreak}연승` : "최대 -");
    if (currentMode === "ranked" && rankedStreak > lastRankedStreak && rankedStreak >= 2) {
      showMessage(`🔥 ${rankedStreak}연승 달성!`, "win");
    }
    lastRankedStreak = rankedStreak;
    renderRankedStreakChip();
    if (typeof data.money === "number") moneyBalance = data.money;
    moneyMultiplier = data.moneyMultiplier || 1;
    ratingBoostGames = data.ratingBoostGames || 0;
    if (Array.isArray(data.titles)) ownedTitles = data.titles;
    currentTitle = data.currentTitle || "";
    renderMoneyBar();
    renderAccountScoresStatic();
    if (data.attendance) {
      attendanceCheckedToday = !!data.attendance.checkedToday;
      attendanceStreak = data.attendance.streak || 0;
      attendanceNextReward = attendanceCheckedToday ? 0 : attendanceReward(attendanceStreak + 1);
      renderAttendance();
    }
    if (Array.isArray(data.recentGames)) {
      recentGamesState = data.recentGames;
      renderRecentGames();
    }
    if (data.daily) {
      dailyCounters = data.daily;
      if (missionsState.length > 0) {
        applyDailyToMissions(data.daily);
        renderMissions();
      }
    }
    if (shopInfo) renderShop();
    renderAccTitles();
    renderAccountScoresStatic();
  });

  /* -- 랭크 매칭 -------------------------------------- */
  socket.on("ranked:matched", (data) => {
    if (!data || !data.ok || !data.state) return;
    clearTimeout(rankedAutoLeave);
    rankedAutoLeave = null;
    rankedQueued = false;
    rankedRematchReq = false;
    showRankedRematchBar(false, false);
    rankedMatchInfo = { opponent: data.opponent, opponentRating: data.opponentRating };
    gameState = data.state;
    roomId = data.roomId;
    playerIndex = data.playerIndex ?? data.state.players?.find(p => p.socketId === socket.id || p.id === socket.id)?.playerIndex ?? 0;
    gameSessionId++;
    const tab = $(".tabs button[data-mode='ranked']");
    if (tab && currentMode !== "ranked") tab.click();
    $("#rankedLobby")?.classList.add("hidden");
    $("#rankedGame")?.classList.remove("hidden");
    renderGameState(gameState);
    showMessage(`상대를 찾았습니다! ${data.opponent} vs 나 (상대 랭크 ${data.opponentRating})`, "success");
    updateRankedQueueUI();
  });

  socket.on("ranked:queueStatus", (data) => {
    if (!data) return;
    rankedQueued = !!data.queued;
    updateRankedQueueUI();
    if (data.ok && data.reason) showMessage(data.reason, "warning");
    if (data.ok === false && data.reason) showMessage(data.reason, "error");
  });

  socket.on("ranked:queueSize", (data) => {
    const info = $("#rankedQueueInfo");
    if (info && rankedQueued) {
      info.textContent = `매칭 대기 중... (대기 인원: ${data?.size ?? 0}명)`;
      info.dataset.active = "true";
    }
  });

  /* -- 랭크 복수전 (다시 대결) -------------------------- */
  socket.on("ranked:rematchStatus", (data) => {
    if (!data) return;
    if (data.ok === false) {
      rankedRematchReq = false;
      showRankedRematchBar(true, false);
      showMessage(data.reason || "복수전 신청에 실패했습니다.", "error");
      return;
    }
    if (data.waiting) {
      rankedRematchReq = true;
      showRankedRematchBar(true, true);
      showMessage(`⚔ 복수전을 신청했습니다. (상대 ${data.opponent || ""}의 수락을 기다립니다.)`, "info");
    } else {
      rankedRematchReq = false;
      showRankedRematchBar(true, false);
    }
  });

  socket.on("ranked:rematchOffer", (data) => {
    if (!data || !data.from || currentMode !== "ranked") return;
    if (gameState && !gameState.finished) return;
    showMessage(`⚔ ${data.from}님이 복수전을 신청했습니다! [복수전] 버튼을 눌러 받아들이세요.`, "success");
  });

  socket.on("money:received", (data) => {
    if (!data) return;
    moneyBalance += data.amount;
    renderMoneyBar();
    playSound("cash");
    const mult = data.multiplier && data.multiplier > 1 ? ` (배율 ${data.multiplier}배 적용!)` : "";
    showMessage(`💰 +${data.amount.toLocaleString()}원 획득!${mult}`, "win");
    applyFx($("#rankedMessage") || $(".money-bar"), "fx-cash");
    socket.emit("player:getRanking");
  });

  /* -- 상점 ------------------------------------------- */
  socket.on("shop:info", (data) => {
    if (!data) return;
    shopInfo = data;
    moneyBalance = data.money;
    moneyMultiplier = data.moneyMultiplier;
    ratingBoostGames = data.ratingBoostGames;
    ownedTitles = data.titles || [];
    currentTitle = data.currentTitle || "";
    renderMoneyBar();
    renderShop();
  });

  socket.on("shop:result", (data) => {
    if (!data) return;
    showMessage(data.reason || data.message || (data.ok ? "성공했습니다." : "실패했습니다."), data.ok ? "success" : "error");
    if (data.ok) {
      if (typeof data.money === "number") moneyBalance = data.money;
      if (Array.isArray(data.titles)) ownedTitles = data.titles;
      if (typeof data.currentTitle === "string" && data.currentTitle !== currentTitle) {
        currentTitle = data.currentTitle;
        renderMoneyBar();
        const chip = $("#titleChip");
        if (chip) applyFx(chip, "fx-title-pop", 900);
      }
      if (typeof data.ratingBoostGames === "number") ratingBoostGames = data.ratingBoostGames;
      if (typeof data.moneyMultiplier === "number") moneyMultiplier = data.moneyMultiplier;
      renderMoneyBar();
      renderShop();
    }
  });

  /* -- 일일 미션 ---------------------------------------- */
  socket.on("missions:status", (data) => {
    if (!data || !Array.isArray(data.missions)) return;
    missionsState = data.missions;
    if (data.daily) dailyCounters = data.daily;
    renderMissions();
  });

  socket.on("missions:result", (data) => {
    if (!data) return;
    showMessage(data.reason || data.message || (data.ok ? "보상을 수령했습니다!" : "보상 수령에 실패했습니다."), data.ok ? "success" : "error");
    if (data.daily) dailyCounters = data.daily;
    if (Array.isArray(data.missions)) missionsState = data.missions;
    if (typeof data.money === "number") moneyBalance = data.money;
    if (Array.isArray(data.titles)) ownedTitles = data.titles;
    if (typeof data.currentTitle === "string") currentTitle = data.currentTitle;
    renderMoneyBar();
    renderMissions();
    renderShop();
    renderAccTitles();
  });

  /* -- 출석체크 --------------------------------------- */
  socket.on("attendance:status", (data) => {
    if (!data || !data.ok) return;
    attendanceCheckedToday = !!data.checkedToday;
    attendanceStreak = data.streak || 0;
    attendanceNextReward = data.nextReward || 0;
    renderAttendance();
  });

  socket.on("attendance:result", (data) => {
    if (!data) return;
    if (data.ok) {
      attendanceCheckedToday = true;
      attendanceStreak = data.streak || 0;
      attendanceNextReward = 0;
      if (typeof data.money === "number") moneyBalance = data.money;
      renderMoneyBar();
      renderShop();
      renderAttendance();
      showMessage(`📅 출석 완료! ${data.streak ? data.streak + "일 연속 " : ""} +${(data.reward || 0).toLocaleString()}원 획득!`, "win");
      playSound("cash");
      if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
      socket.emit("player:getRanking");
    } else {
      attendanceCheckedToday = true;
      renderAttendance();
      if (data.reason) showMessage(data.reason, "info");
    }
  });

  /* -- 버그 제보 --------------------------------------- */
  socket.on("bug:submitted", (data) => {
    const msg = $("#bugMsg");
    if (msg) {
      msg.textContent = data?.reason || "제보 처리 완료.";
      msg.dataset.type = data?.ok ? "ok" : "error";
    }
    if (data?.ok) {
      const m = $("#bugMessage");
      if (m) m.value = "";
    }
  });

  /* -- 관리자: 돈 조절 / 버그 제보 목록 ---------------- */
  socket.on("admin:moneyResult", (data) => {
    if (!data) return;
    setAdminStatus(data.message || data.reason || (data.ok ? "완료" : "실패"), data.ok ? "ok" : "error");
    if (data.ok) {
      showMessage(data.message || "돈이 조절되었습니다.", "success");
      socket.emit("player:getRanking");
    } else {
      showMessage(data.reason || "돈 조절에 실패했습니다.", "error");
    }
  });

  socket.on("admin:bugs", (data) => {
    if (!data) return;
    if (data.ok === false) {
      setAdminStatus(data.reason || "버그 제보를 불러올 수 없습니다.", "error");
      return;
    }
    renderAdminBugs(data.reports || []);
  });

  /* -- 닉네임 ----------------------------------------- */
  socket.on("player:nameUpdated", (data) => {
    if (!data) return;
    if (data.ok && data.nickname) {
      myNickname = data.nickname;
      const currentPw = $("#accPwInput")?.value;
      if (currentPw) {
        myPassword = currentPw;
        $("#accPwInput").value = "";
        persistPassword(currentPw);
      }
      localStorage.setItem("kkNickname", myNickname);
      updateNicknameUI();
      renderAccountInfo();
      showMessage("닉네임이 저장되었습니다.", "success");
      accountMsg("적용되었습니다.", "ok");
      socket.emit("admin:getRole");
      socket.emit("friends:list");
      socket.emit("player:getRanking");
    } else if (data.adminRequired) {
      const msg = $("#nickMsg");
      const hint = data.reason || "관리자 계정입니다. 계정 탭에서 비밀번호를 입력해 로그인해주세요.";
      if (msg) { msg.textContent = hint; msg.dataset.type = "error"; }
      else showMessage(hint, "error");
      const accPw = $("#accPwInput");
      if (accPw) {
        openAccountPanel(true);
        accPw.focus();
      }
    } else if (data.reason) {
      const msg = $("#nickMsg");
      if (msg) { msg.textContent = data.reason; msg.dataset.type = "error"; }
      else showMessage(data.reason, "error");
      accountMsg(data.reason, "error");
    }
  });

  /* -- 관리자 패널 ------------------------------------- */
  socket.on("admin:role", (data) => {
    if (!data) return;
    myAdminRole = data.role === "super" || data.role === "sub" ? data.role : "none";
    updateAdminVisibility();
    renderAccountInfo();
    syncSavedCredentials();
  });

  socket.on("admin:panel", (data) => {
    if (!data) return;
    /* 전체 패널(role 포함)일 때만 재렌더링 — 적용/비밀번호 변경 같은
       경량 결과로 패널이 초기화되어 반영이 안 보이는 문제 방지 */
    if ("role" in data) {
      renderAdminBody(data);
    } else if (data.ok && "hasPassword" in data && adminModalOpen) {
      /* 비밀번호 변경 후 경량 응답에는 패널 데이터가 없으므로 전체 패널을 다시 요청 */
      socket.emit("admin:getPanel");
    }
    if (data.ok === false && data.reason) {
      setAdminStatus(data.reason, "error");
      accountMsg(data.reason, "error");
    } else if (data.message) {
      setAdminStatus(data.message, "ok");
      accountMsg(data.message, "ok");
      showMessage(data.message, "success");
    }
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
    if (isStaleAIEvent(null, data.state)) return;
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
    if (isStaleAIEvent(null, data.state)) return;
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
    startingGame = false;
    showMessage(data.reason || "방 오류", "error");
  });

  socket.on("room:playerJoined", (data) => {
    if (isStaleAIEvent(null, data && data.state)) return;
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
    if (data.registered === false) return;
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
    }
    if (typeof data.hintsLeft === "number") {
      const hintBtn = $("#hintBtn");
      if (hintBtn) {
        hintBtn.textContent = `힌트 (${data.hintsLeft})`;
        if (data.hintsLeft <= 0) hintBtn.disabled = true;
      }
    }
    if (!data.ok && data.reason) showMessage(data.reason, "info");
  });

  /* -- 게임 이벤트 ------------------------------------- */
  socket.on("game:state", (data) => {
    if (data && data.roomId && roomId && data.roomId !== roomId) return;
    if (isStaleAIEvent(data && data.mode, data)) return;
    const wasMyTurn = gameState && gameState.turnPlayer === playerIndex;
    gameState = data;
    renderGameState(gameState);
    const isMyTurn = data.turnPlayer === playerIndex;
    if (isMyTurn) {
      submitting = false;
      updateInputState();
      if (!wasMyTurn) {
        focusInput();
        playSound("turn");
      }
    }
  });

  socket.on("game:started", (data) => {
    if (!data || !data.state || (data.state.roomId && roomId && data.state.roomId !== roomId)) return;
    if (isStaleAIEvent(data.state.mode)) return;
    gameState = data.state;
    gameSessionId++;
    localUsedWords.clear();
    clearInput();
    lastPopChar = null;
    renderGameState(gameState);
    showMessage("게임이 시작되었습니다!", "success");
    playSound("start");
    socket.emit("player:getRanking");
    updateRuleNotice(gameState);
    const hostControls = $("#hostControls");
    if (hostControls) hostControls.classList.add("hidden");
    const wrap = $("#onlineRestartWrap");
    if (wrap) wrap.classList.add("hidden");
    const specNotice = $("#spectatorNotice");
    if (specNotice) specNotice.classList.add("hidden");
    submitting = false;
    if (currentMode === "ranked") {
      rankedRematchReq = false;
      showRankedRematchBar(false, false);
      clearTimeout(rankedAutoLeave);
      rankedAutoLeave = null;
    }
    updateInputState();
    focusInput();
  });

  socket.on("game:word", (data) => {
    if (!data || data.ok === false) return;
    if (data.roomId && roomId && data.roomId !== roomId) return;
    if (isStaleAIEvent(data.mode)) return;
    if (currentMode === "single") {
      localUsedWords.add(data.word);
    }
      applyFx($(".last-char-box"), "fx-flash-ok");
      const plName = (gameState?.players?.find(p => p.playerIndex === data.player)?.title)
        ? `[${gameState.players.find(p => p.playerIndex === data.player).title}]${data.nickname}`
        : data.nickname;
      showMessage(`${data.nickname ? plName : "플레이어"}: ${data.word}${data.depth != null ? " [깊이 " + data.depth + "]" : ""}`, "success");
      const isMyWord = data.player === playerIndex;
      if (isMyWord) {
        playSound("word");
        submitting = false;
        clearInput();
        updateInputState();
      } else {
        playSound("oppWord");
        /* 상대가 낸 단어 이후에 'game:state'가 늦게 오는 경우에도 내 턴이면 바로 입력 가능하도록 */
        if (isMyTurn()) {
          submitting = false;
          updateInputState();
          focusInput();
        }
      }
  });

  socket.on("game:roundReset", (data) => {
    if (data && data.roomId && roomId && data.roomId !== roomId) return;
    if (isStaleAIEvent(data && data.mode)) return;
    showMessage(data.reason || "새 라운드가 시작됩니다!", "info");
  });

  socket.on("game:oneshot", (data) => {
    if (!data) return;
    if (data.roomId && roomId && data.roomId !== roomId) return;
    if (isStaleAIEvent(data.mode)) return;
    const target = data.targetNickname || "상대";
    const isMe = data.target === playerIndex;
    if (isMe) playSound("heartLost");
    else if (data.killer === playerIndex) playSound("oneshot");
    let msg = `한방 단어! ${data.killerNickname || "상대"}님이 ${target}님의 하트를 1개 깎았습니다.`;
    if (isMe && data.hearts != null) msg += ` (남은 하트: ${data.hearts})`;
    showMessage(msg, isMe ? "error" : "info");
    if (isMe && data.hearts != null) renderHearts(data.hearts);
    applyFx($(".game-status"), "fx-heartlost");
    applyFx($(".last-char-box"), "fx-flash-ok");
  });

  socket.on("game:error", (data) => {
    if (data && data.roomId && roomId && data.roomId !== roomId) return;
    playSound("error");
    const inputArea = currentMode === "single" ? $(".single-input-area") : $(".online-input-area");
    applyFx(inputArea, "fx-shake");
    const nearHeart = data.mistakes != null && data.mistakesPerLife != null
      && (data.mistakesPerLife - data.mistakes) > 0 && (data.mistakesPerLife - data.mistakes) <= 2;
    let message = data.reason || "오류";
    if (data.allowed) message += " (다시 시도해주세요)";
    if (nearHeart) message += ` (실수 ${data.mistakes}/${data.mistakesPerLife}, 하트까지 ${data.mistakesPerLife - data.mistakes}번)`;
    showMessage(message, data.heartLost ? "error" : (data.allowed || nearHeart ? "warning" : "error"));
    if (data.hearts != null) renderHearts(data.hearts);
    if (data.mistakes != null && data.mistakesPerLife != null) renderMistakes(data.mistakes, data.mistakesPerLife);
    submitting = false;
    updateInputState();
    focusInput();
  });

  socket.on("game:timeout", (data) => {
    if (data && data.roomId && roomId && data.roomId !== roomId) return;
    if (isStaleAIEvent(data && data.mode)) return;
    const timeoutName = data.nickname || `플레이어 ${data.player + 1}`;
    if (data.player === playerIndex) {
      playSound("heartLost");
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
    /* 같은 소켓에 남아 있던 다른 게임(싱글/ai 등)이 끝났을 때 도착하는
       game:finished를 현재 랭크 게임의 종료로 오인해 자동으로 나가지는
       버그 방지 — 현재 방과 다른 방의 종료 이벤트는 무시한다. */
    const finishedRoomId = data && data.state ? data.state.roomId : (data ? data.roomId : null);
    if (finishedRoomId && roomId && finishedRoomId !== roomId) {
      return;
    }

    submitting = false;
    stopCountdown();
    clearInput();
    updateInputState();

    if (data.winner !== null && data.winner === playerIndex) {
      showMessage("게임에서 승리했습니다!", "win");
      playSound("win");
      if (currentMode === "single") {
        localStats.wins++;
        localStats.games++;
        localStats.totalLength += (gameState?.history?.length || 0);
        saveStats();
        updateStatsUI();
      }
    } else if (data.loser !== null && data.loser === playerIndex) {
      showMessage("게임에서 패배했습니다.", "lose");
      playSound("lose");
      if (currentMode === "single") {
        localStats.losses++;
        localStats.games++;
        localStats.totalLength += (gameState?.history?.length || 0);
        saveStats();
        updateStatsUI();
      }
    } else if (data.winner === null && data.loser === null) {
      showMessage("무승부입니다 — 공동 탈락!", "info");
      playSound("draw");
      if (currentMode === "single") {
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
    socket.emit("missions:status");

    if (currentMode === "single") {
      showRestartButton(true);
    } else {
      const wrap = $("#onlineRestartWrap");
      if (wrap) wrap.classList.remove("hidden");
    }

    /* 랭크 게임 종료 후 처리 — 복수전 버튼 제공, 자동 계속매칭 설정에 따라
       자동 재매칭 또는 매칭 대기실 복귀 */
    if (currentMode === "ranked") {
      clearTimeout(rankedAutoLeave);
      rankedAutoLeave = null;
      rankedRematchReq = false;
      showRankedRematchBar(true, false);
      if (rankedAutoContinue) {
        showMessage("게임이 끝났습니다. 잠시 후 자동으로 다음 상대를 찾습니다...", "info");
        rankedAutoLeave = setTimeout(() => {
          rankedAutoLeave = null;
          if (gameState && gameState.finished && (!gameState.roomId || gameState.roomId === roomId)) {
            resetRankedBoard();
            rankedQueued = true;
            updateRankedQueueUI();
            if (socket && socketConnected) socket.emit("ranked:queue");
          }
        }, 2200);
      } else {
        showRankedRematchBar(true, false);
        rankedAutoLeave = setTimeout(() => {
          rankedAutoLeave = null;
          if (gameState && gameState.finished && (!gameState.roomId || gameState.roomId === roomId)) leaveRoom();
        }, 8000);
      }
    }
  });

}

/* ---------------------------------------------------------
   렌더링
--------------------------------------------------------- */
function renderGameState(state) {
  if (!state) return;
  if (Number.isInteger(state.maxHearts) && state.maxHearts > 0) currentMaxHearts = state.maxHearts;
  const isSingle = currentMode === "single";

  const syllable = state.startSyllable || state.history?.[0]?.word;
  setText([modeEl("startWord") || "#startWord"], syllable ? syllable.at(0) : "-");

  const lastChar = state.currentWord ? state.currentWord.at(-1) : null;
  setText([modeEl("last") || "#last"], lastChar || "-");
  if (lastChar && lastChar !== lastPopChar) {
    lastPopChar = lastChar;
    applyFx(document.querySelector(".last-char-box"), "fx-word-pop", 600);
  }

  const allowed = lastChar ? allowedFirstChars(lastChar) : [];
  const hintEl = modeGet("hint") || (isSingle ? $("#lastHint") : $("#onlineLastHint"));
  if (hintEl) {
    if (state.started && !state.finished) {
      if (state.turnNumber === 0) {
        const s = state.startSyllable || "";
        hintEl.innerHTML = `"${s}"(으)로 시작하는 단어`;
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

  setText([modeEl("turn") || "#turn"], state.turnNumber);

  if (state.history && state.history.length > 0) {
    const lastEntry = state.history[state.history.length - 1];
    setText([modeEl("depth") || "#depth"], lastEntry.depth != null ? lastEntry.depth : "-");
  } else {
    setText([modeEl("depth") || "#depth"], "-");
  }

  const myTurn = state.started && !state.finished && state.turnPlayer === playerIndex;
  const turnIndicator = modeGet("turnIndicator") || (isSingle ? $("#turnIndicator") : $("#onlineTurnIndicator"));
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
  if (state.started && !state.finished) {
    const turnMe = state.players?.find(p => p.playerIndex === state.turnPlayer);
    renderMistakes(turnMe?.mistakes ?? 0, state.mistakesPerLife || 5);
  }
  updateInputState();
}

function updateRuleNotice(state) {
  if (!state) return;
  const freeTurns = state.oneShotFreeTurns || 1;
  const turn = state.turnNumber || 0;
  const el = modeGet("ruleNotice");
  if (!el) return;

  /* 게임 진행 중일 때만 안내 표시 — 방을 나갔다가 새 게임을 시작해도 다시 보이게 한다 */
  el.classList.toggle("hidden", !(state.started && !state.finished));
  if (!(state.started && !state.finished)) return;

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

  const container = modeGet("players");

  if (container) {
    container.innerHTML = "";
    const canKick = (state.hostSocketId === socket?.id) || myAdminRole !== "none";
    const showKick = currentMode === "online" || currentMode === "ranked";
    for (const p of state.players) {
      const row = document.createElement("div");
      row.className = "player-item";
      if (p.playerIndex === state.turnPlayer) row.dataset.turn = "true";
      if (p.eliminated) row.dataset.eliminated = "true";

      const hearts = "♥".repeat(Math.max(0, p.hearts)) + "♡".repeat(Math.max(0, currentMaxHearts - p.hearts));
      const mistakesMax = state.mistakesPerLife || 5;
      const mistakesText = p.mistakes != null && !p.waiting ? ` 실수:${p.mistakes}/${mistakesMax}` : "";
      const status = p.waiting ? "대기 중" : p.eliminated ? "탈락" : p.connected ? (p.isBot ? "AI" : "접속 중") : "연결 끊김";
      let ratingTag = "";
      if (currentMode === "ranked") {
        const r = state.rankedRatings?.[p.playerIndex];
        if (r != null) {
          const rr = calculateRank(r);
          ratingTag = ` <span class="rated-chip">${formatRank(rr)} · ${r}점</span>`;
        }
      }
      const titleHtml = p.title ? `<span class="player-title">[${escapeHtml(String(p.title))}]</span> ` : "";
      row.innerHTML = `${titleHtml}${escapeHtml(String(p.nickname || "플레이어"))} — ${p.waiting ? "-" : hearts}${mistakesText} — ${status}${ratingTag}`;

      if (canKick && showKick && !p.isBot && p.playerIndex !== playerIndex) {
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
let lastPopChar = null;

function renderHearts(hearts) {
  const v = Math.max(0, Number(hearts) || 0);
  const lost = lastHearts !== null && v < lastHearts;
  lastHearts = v;
  const text = "♥".repeat(v) + "♡".repeat(Math.max(0, currentMaxHearts - v));
  const targets = [{ s: modeEl("hearts"), fallback: "#hearts" }, { s: "#heartDisplay" }, { s: "#heartsOnline" }];
  for (const t of targets) {
    const q = t.s || t.fallback;
    if (q) setText([q], text);
  }
  if (lost) {
    for (const t of targets) {
      const q = t.s || t.fallback;
      if (!q) continue;
      const node = $(q);
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
  setText([modeEl("mistakes") || "#mistakesDisplay"], text);
  const els = [...document.querySelectorAll("#mistakesDisplay, #mistakesDisplayOnline")];
  const modeM = modeEl("mistakes");
  if (modeM && currentMode === "ranked") {
    const node = $(modeM);
    if (node && !els.includes(node)) els.push(node);
  }
  els.forEach(el => { el.dataset.danger = remaining <= 1 ? "true" : "false"; });
}

function renderHistory(state) {
  const history = state?.history || [];
  const container = modeGet("history") || (currentMode === "single" ? $("#history") : $("#onlineHistory"));
  if (!container) return;

  container.innerHTML = "";
  const titleHtmlFor = (idx) => {
    const pl = state?.players?.find(p => p.playerIndex === idx);
    return pl?.title ? `<span class="player-title">[${escapeHtml(String(pl.title))}]</span> ` : "";
  };
  for (const item of history) {
    const row = document.createElement("div");
    row.className = "history-item";
    const isStartEntry = item.player === -1 || item.nickname === "시작";
    if (!isStartEntry && item.turn === history.length - 1 && item.turn > 0) {
      row.classList.add("latest");
    }
    const depth = item.depth != null ? ` [${item.depth}]` : "";
    if (isStartEntry) {
      row.textContent = `시작: ${item.word}${depth}`;
    } else {
      row.innerHTML = `${item.turn}. ${titleHtmlFor(item.player)}${escapeHtml(item.nickname || "플레이어")}: <span class="history-word">${escapeHtml(item.word)}</span>${depth}`;
    }
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}

function renderRoomInfo(state) {
  if (currentMode !== "online" && currentMode !== "ranked") return;
  const el = modeGet("roomInfo");
  if (!el) return;
  if (!state) { el.innerHTML = ""; return; }

  const isHost = state.hostSocketId === socket?.id;
  const statusText = state.finished ? "게임 종료" : state.started ? "게임 진행 중" : "대기 중";
  const isRanked = currentMode === "ranked";
  const modeLabel = isRanked ? "랭크 매칭" : "온라인 멀티";

  el.innerHTML = `
    <div class="room-header">
      <div>${isRanked ? "🎮" : "방 코드: "}<strong>${isRanked ? escapeHtml(modeLabel) : `<span class="room-code" title="클릭하면 복사됩니다">${state.roomId}</span>`}</strong></div>
      <div class="room-status">${statusText}</div>
    </div>
    <div>인원: ${state.playerCount}/${state.maxPlayers}${isHost && !isRanked ? " (방장)" : ""}</div>
  `;

  const codeEl = el.querySelector(".room-code");
  if (codeEl) codeEl.addEventListener("click", () => {
    navigator.clipboard.writeText(state.roomId).then(() => {
      showMessage("방 코드가 복사되었습니다!", "success");
    }).catch(() => {});
  });

  const hostControls = $("#hostControls");
  if (hostControls) {
    if (!isRanked && isHost && !state.started && !state.finished) {
      hostControls.classList.remove("hidden");
      const startBtn = $("#startOnline");
      if (startBtn) startBtn.textContent = "게임 시작";
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
  const timerSelector = modeEl("timer") || "#timer";
  if (!state || !state.turnEndsAt || state.finished || !state.started) {
    setText([timerSelector], "-");
    const timerBox = modeGet("timerBox") || $(".timer-box");
    if (timerBox) timerBox.dataset.urgent = "false";
    return;
  }
  const update = () => {
    if (!gameState?.turnEndsAt) { stopCountdown(); return; }
    const remaining = Math.max(0, gameState.turnEndsAt - Date.now());
    const secs = Math.ceil(remaining / 1000);
    setText([timerSelector], secs + "s");
    const timerBox = modeGet("timerBox") || $(".timer-box");
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
  const input = modeGet("input");
  const btn = modeGet("send");
  const hintBtn = $("#hintBtn");

  const myTurn = gameState && gameState.started && !gameState.finished
    && gameState.turnPlayer === playerIndex;

  const amEliminated = gameState && gameState.players
    && gameState.players[playerIndex] && gameState.players[playerIndex].eliminated;

  const disabled = !socketConnected || !roomId || !myTurn || amEliminated;

  if (input) input.disabled = disabled;
  if (btn) btn.disabled = disabled;

  const hintsAvail = gameState && Number.isInteger(gameState.hintsLimit)
    ? Math.max(0, gameState.hintsLimit - (gameState.hintsUsed || 0)) : null;
  if (hintBtn) {
    const inSingleGame = currentMode === "single" && gameState && gameState.started && !gameState.finished && hintsAvail != null;
    if (inSingleGame) {
      hintBtn.textContent = `힌트 (${hintsAvail})`;
      hintBtn.disabled = disabled || hintsAvail <= 0;
    } else {
      hintBtn.textContent = "힌트";
      hintBtn.disabled = disabled || currentMode !== "single";
    }
  }

  const inputArea = currentMode === "single" ? $(".single-input-area") : (currentMode === "ranked" ? $("#ranked .entry") : $(".online-input-area"));
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
    mode: "ai",
    difficulty: aiDifficulty
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

  lockSubmitting();
  socket.emit("game:word", { word });
  updateInputState();
}

/* ---------------------------------------------------------
   온라인 방 관리
--------------------------------------------------------- */
function createOnlineRoom() {
  if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
  if (!requireNickname()) return;
  socket.emit("room:create", { nickname: makeNickname(), mode: "online" });
  showMessage("방을 만드는 중...", "waiting");
}

function joinOnlineRoom() {
  if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
  if (!requireNickname()) return;
  const code = normalizeWord($("#roomCode")?.value);
  if (!code) { showMessage("방 코드를 입력해주세요.", "error"); return; }
  socket.emit("room:join", { roomId: code, nickname: makeNickname() });
  showMessage("방에 입장하는 중...", "waiting");
}

/* ---------------------------------------------------------
   온라인 / 랭크 — 단어 입력
--------------------------------------------------------- */
function submitWord(targetMode) {
  const mode = targetMode || currentMode;
  if (mode === "single") return submitSingleWord();
  if (mode !== "online" && mode !== "ranked") return;
  if (submitting) return;
  if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
  if (!roomId || !gameState) { showMessage("게임 준비 중입니다...", "waiting"); return; }
  if (!gameState.started || gameState.finished) { showMessage("게임이 아직 시작되지 않았습니다.", "info"); return; }
  if (gameState.turnPlayer !== playerIndex) { showMessage("아직 내 차례가 아닙니다.", "info"); return; }

  const input = modeGet("input");
  if (!input) return;

  const word = normalizeWord(input.value);
  if (!word) return;

  lockSubmitting();
  socket.emit("game:word", { word });
  updateInputState();
}

/* 하위 호환 — 기존 온라인 핸들러 호출 참조를 제거하지 않고 유지 */
function submitOnlineWord() { return submitWord("online"); }
function submitRankedWord() { return submitWord("ranked"); }

function leaveRoom() {
  clearTimeout(rankedAutoLeave);
  rankedAutoLeave = null;
  rankedRematchReq = false;
  showRankedRematchBar(false, false);
  if (!socket || !socketConnected) return;
  socket.emit("room:leave");
  roomId = null;
  playerIndex = null;
  gameState = null;
  rankedMatchInfo = null;
  localUsedWords.clear();
  startingGame = false;
  stopCountdown();
  if (currentMode === "online") resetOnlineBoard();
  else if (currentMode === "ranked") resetRankedBoard();
  updateInputState();
}

function resetRankedBoard() {
  const els = [
    "#rankedHistory", "#rankedPlayers", "#rankedLastHint", "#rankedTurnIndicator",
    "#onlineRuleNotice"
  ];
  for (const sel of els) {
    const el = $(sel);
    if (!el) continue;
    if (sel === "#onlineRuleNotice" || sel === "#rankedTurnIndicator") el.classList.add("hidden");
    else el.innerHTML = "";
  }
  setText(["#rankedLast"], "-");
  setText(["#rankedStartWord"], "-");
  setText(["#rankedTurn", "#rankedDepth", "#rankedTimer"], "-");
  renderHearts(currentMaxHearts);
  renderMistakes(0, 5);
  clearInput();
  rankedRematchReq = false;
  showRankedRematchBar(false, false);
  $("#rankedGame")?.classList.add("hidden");
  $("#rankedLobby")?.classList.remove("hidden");
  updateRankedQueueUI();
  renderRankedStreakChip();
}

/* 온라인 보드/UI를 초기 상태로 정리 */
function resetOnlineBoard() {
  const els = [
    "#onlineHistory", "#onlinePlayers", "#onlineLastHint", "#onlineTurnIndicator",
    "#onlineRestartWrap", "#onlineRuleNotice"
  ];
  for (const sel of els) {
    const el = $(sel);
    if (!el) continue;
    if (sel === "#onlineRestartWrap" || sel === "#onlineRuleNotice" || sel === "#onlineTurnIndicator") {
      el.classList.add("hidden");
    } else {
      el.innerHTML = "";
    }
  }
  setText(["#onlineLast"], "-");
  setText(["#onlineStartWord"], "-");
  setText(["#onlineTurn", "#onlineDepth", "#onlineTimer"], "-");
  renderHearts(currentMaxHearts);
  renderMistakes(0, 5);
  clearInput();
  const timerBox = $("#online .timer-box");
  if (timerBox) timerBox.dataset.urgent = "false";
}

function updateRankedQueueUI() {
  const queueBtn = $("#rankedQueueBtn");
  const cancelBtn = $("#rankedCancelBtn");
  const info = $("#rankedQueueInfo");
  if (queueBtn) queueBtn.classList.toggle("hidden", rankedQueued);
  if (cancelBtn) cancelBtn.classList.toggle("hidden", !rankedQueued);
  if (info) {
    info.dataset.active = rankedQueued ? "true" : "false";
    if (!rankedQueued) info.textContent = "";
  }
}

/* 랭크 종료 후 복수전/취소 버튼 표시 */
function showRankedRematchBar(visible, requested) {
  const wrap = $("#rankedRematchWrap");
  if (wrap) wrap.classList.toggle("hidden", !visible);
  const btn = $("#rankedRematchBtn");
  const cancel = $("#rankedRematchCancelBtn");
  if (btn) btn.classList.toggle("hidden", !(visible && !requested));
  if (cancel) cancel.classList.toggle("hidden", !(visible && requested));
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
   돈 바 (상단 바 + 계정 패널)
--------------------------------------------------------- */
function renderMoneyBar() {
  const chip = $("#moneyDisplay");
  if (chip) chip.textContent = moneyBalance.toLocaleString();
  const bar = $(".money-bar");
  if (bar) bar.classList.toggle("hidden", false);
  const boostChip = $("#boostChip");
  if (boostChip) {
    boostChip.classList.toggle("hidden", ratingBoostGames <= 0);
    setText(["#boostCount"], ratingBoostGames);
  }
  const titleChip = $("#titleChip");
  if (titleChip) {
    if (currentTitle) { titleChip.textContent = currentTitle; titleChip.classList.remove("hidden"); }
    else titleChip.classList.add("hidden");
  }
}

function renderAccountScoresStatic() {
  setText(["#accMoney"], moneyBalance.toLocaleString());
  setText(["#accTitle"], currentTitle || "없음");
}

/* 랭크 대기실 연승 칩 — 현재/최대 연승 표시 */
function renderRankedStreakChip() {
  const chip = $("#rankedStreakChip");
  if (!chip) return;
  const show = currentMode === "ranked" && rankedBestStreak > 0;
  chip.classList.toggle("hidden", !show);
  if (show) {
    setText(["#rankedStreakNum"], rankedStreak);
    setText(["#rankedBestStreakNum"], rankedBestStreak);
  }
}

/* ---------------------------------------------------------
   상점 렌더링
--------------------------------------------------------- */
function renderAttendance() {
  const btn = $("#attendanceBtn");
  const info = $("#attendanceInfo");
  if (!btn || !info) return;
  const streakLabel = attendanceStreak > 0
    ? `<span class="att-num">연속 ${attendanceStreak}일</span>`
    : "오늘부터 첫 출석을 노려보세요!";
  if (attendanceCheckedToday) {
    btn.disabled = true;
    btn.textContent = "오늘 출석 완료 ✓";
    info.innerHTML = `이미 출석했습니다. 내일 또 만나요! ${streakLabel}`;
  } else {
    btn.disabled = false;
    btn.textContent = "📅 출석체크 하기";
    info.innerHTML = `출석하면 <b>${(attendanceNextReward || 0).toLocaleString()}원</b>을 받아요. ${streakLabel}`;
  }
}

function renderShop() {
  const body = $("#shopBody");
  if (!body || !shopInfo) return;
  const mkRow = (label, desc, btnId, btnLabel, btnStyle, price) => {
    const disabled = typeof price === "number" && moneyBalance < price ? " disabled" : "";
    return `<div class="shop-item">
      <div><strong>${escapeHtml(label)}</strong><div class="shop-item-desc">${escapeHtml(desc)}</div></div>
      <button class="shop-buy${btnStyle ? " " + btnStyle : ""}" id="${btnId}"${disabled}>${btnLabel}</button>
    </div>`;
  };

  let html = `<div class="shop-sub">칭호</div>`;
  html += shopInfo.titleCatalog.map(t => {
    const owned = ownedTitles.some(o => o.id === t.id);
    if (owned) {
      const equipped = currentTitle === t.name;
      return equipped
        ? mkRow(t.name, `보유 중 · 장착됨 · ${t.price.toLocaleString()}원`, "", "장착중", "equipped", Infinity)
        : mkRow(t.name, `보유 중 · ${t.price.toLocaleString()}원`, "equipTitle:" + t.id, "장착", "equip", t.price);
    }
    return mkRow(t.name, `${t.price.toLocaleString()}원`, "buyTitle:" + t.id, "구매", "", t.price);
  }).join("");
  html += `<div class="shop-sub">물약</div>`;
  html += mkRow("레이팅 2배 물약", "다음 10판 동안 레이팅 + 보상 2배", "buyPotion", "구매 · 1,000,000원", "", shopInfo.potionPrice);

  html += `<div class="shop-sub">영구 배율</div>`;
  for (const m of shopInfo.multiplierPrices) {
    const owned = moneyMultiplier >= m.multiplier;
    const label = `${m.multiplier}배 돈`;
    const desc = owned ? `보유 중 (현재 ${moneyMultiplier}배)` : `${m.price.toLocaleString()}원`;
    if (owned) html += mkRow(label, desc, "", "보유 중", "owned", m.price);
    else html += mkRow(label, desc, "buyMultiplier:" + m.multiplier, `구매 · ${m.price.toLocaleString()}원`, "", m.price);
  }
  body.innerHTML = html;

  body.querySelectorAll("[id^='buyTitle:'],[id^='buyPotion'],[id^='buyMultiplier'],[id^='equipTitle:']").forEach(btn => {
    btn.addEventListener("click", () => {
      const [kind, val] = btn.id.split(":");
      if (kind === "buyTitle") socket.emit("shop:buyTitle", { titleId: val });
      else if (kind === "buyPotion") socket.emit("shop:buyPotion");
      else if (kind === "buyMultiplier") socket.emit("shop:buyMultiplier", { multiplier: Number(val) });
      else if (kind === "equipTitle") socket.emit("shop:setTitle", { titleId: val });
    });
  });
}

/* ---------------------------------------------------------
   칭호 장착 (계정 패널) — 보유 칭호를 클릭해 장착/확인
--------------------------------------------------------- */
function renderAccTitles() {
  const box = $("#accTitleBox");
  const list = $("#accTitleList");
  if (!box || !list) return;
  box.classList.toggle("hidden", ownedTitles.length === 0);
  if (ownedTitles.length === 0) { list.innerHTML = ""; return; }
  list.innerHTML = ownedTitles.map(t => {
    const isCur = currentTitle === t.name;
    return `<button type="button" class="acc-title-chip${isCur ? " current" : ""}" data-title-id="${escapeHtml(t.id)}">${isCur ? "장착중 · " : ""}${escapeHtml(t.name)}</button>`;
  }).join("");
  list.querySelectorAll("[data-title-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("current")) return;
      if (socket && socketConnected) socket.emit("shop:setTitle", { titleId: btn.dataset.titleId });
    });
  });
}

/* ---------------------------------------------------------
   일일 미션 패널
--------------------------------------------------------- */
function applyDailyToMissions(daily) {
  missionsState.forEach(m => {
    const cur = m.id === "rankedWins" ? (daily.rankedWins || 0) : (m.id === "oneShots" ? (daily.oneShots || 0) : (daily.streakDone || 0));
    m.current = Math.min(m.target, cur);
  });
}

function rewardLabel(m) {
  const parts = [];
  if (m.coin) parts.push(`${m.coin.toLocaleString()}원`);
  if (m.title) parts.push(`칭호 '${m.title.name}'`);
  return parts.length ? parts.join(" + ") : "보상 없음";
}

function renderMissions() {
  const list = $("#missionList");
  const box = $("#missionBox");
  if (!list || !box) return;
  if (missionsState.length === 0) { box.classList.add("hidden"); list.innerHTML = ""; return; }
  box.classList.remove("hidden");
  list.innerHTML = missionsState.map(m => {
    const done = m.current >= m.target;
    const claimed = !!m.claimed;
    const pct = m.target > 0 ? Math.min(100, Math.round((m.current / m.target) * 100)) : 0;
    return `<div class="mission-row${claimed ? " claimed" : (done ? " done" : "")}">
      <div class="mission-head">
        <span class="mission-label">${escapeHtml(m.label)}</span>
        <span class="mission-state">${claimed ? "보상 수령 완료" : (done ? "달성! 보상을 받으세요" : `${m.current}/${m.target}`)}</span>
      </div>
      <div class="mission-bar"><div class="mission-bar-fill" style="width:${pct}%"></div></div>
      <div class="mission-foot">
        <span class="mission-reward">보상: ${escapeHtml(rewardLabel(m))}</span>
        ${claimed ? "" : (done ? `<button type="button" class="mission-claim" data-mission-claim="${m.id}">받기</button>` : "")}
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-mission-claim]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.missionClaim;
      if (socket && socketConnected) socket.emit("missions:claim", { id });
    });
  });
}

/* ---------------------------------------------------------
   최근 10판 전적 패널
--------------------------------------------------------- */
function renderRecentGames() {
  const list = $("#recentGamesList");
  const box = $("#recentGamesBox");
  if (!list || !box) return;
  if (!Array.isArray(recentGamesState) || recentGamesState.length === 0) { box.classList.add("hidden"); list.innerHTML = ""; return; }
  box.classList.remove("hidden");
  const modeLabel = { ranked: "랭크", online: "온라인", single: "싱글", ai: "싱글" };
  list.innerHTML = recentGamesState.map(g => {
    const res = g.result === "win" ? "<span class='rec-win'>승</span>" : (g.result === "lose" ? "<span class='rec-lose'>패</span>" : "<span class='rec-draw'>무</span>");
    const date = String(g.date || "").slice(0, 16).replace("T", " ");
    return `<div class="rec-row">
      <span class="rec-res">${res}</span>
      <span class="rec-mode">${modeLabel[g.mode] || g.mode || "-"}</span>
      <span class="rec-vs">vs ${escapeHtml(g.vs || "?")}</span>
      <span class="rec-words">단어 ${g.wordCount ?? 0}개</span>
      <span class="rec-len">평균 ${g.avgWordLen ?? 0}자</span>
      <span class="rec-date">${date}</span>
    </div>`;
  }).join("");
}

/* ---------------------------------------------------------
   버그 제보 / 관리자: 버그 목록
--------------------------------------------------------- */
function renderAdminBugs(reports) {
  const body = $("#adminBody");
  if (!body) return;
  const rows = reports.length === 0
    ? `<div class="admin-info">접수된 버그가 없습니다.</div>`
    : reports.map(r => `<div class="admin-card" style="font-size:13px;">
        <div><b>${escapeHtml(r.nickname)}</b> · ${escapeHtml(r.category)} · ${escapeHtml(r.createdAt?.slice(0,16) || "")}</div>
        <div style="margin:4px 0;">${escapeHtml(r.message)}</div>
        <button class="admin-apply" data-admin-bug-del="${escapeHtml(r.id)}">삭제</button>
      </div>`).join("");
  body.innerHTML = `<div class="admin-card"><h4>버그 제보 (총관리자만 열람)</h4>${rows}</div><div class="admin-status" id="adminStatus"></div>`;
  body.querySelectorAll("[data-admin-bug-del]").forEach(btn => {
    btn.addEventListener("click", () => socket.emit("admin:deleteBug", { id: btn.dataset.adminBugDel }));
  });
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
      <h4>게임 규칙 설정 (게임 전체에 적용 — 최고 관리자 전용)</h4>
      <div class="admin-info">아래 값들을 바꾸고 [적용]을 누르면 다음 게임부터 반영됩니다. 값은 1 이상이어야 합니다.</div>
      <input type="password" id="adminPw" placeholder="관리자 비밀번호 (변경 시 필요)" autocomplete="off" data-pw-toggle>
      ${rows}
    </div>
  ` : "";

  /* 두음법칙 연결 안내 — 관리자가 왜 특정 단어가 연결되는지 이해할 수 있게 */
  const dueumCard = isSuper ? `
    <div class="admin-card">
      <h4>두음법칙 (연결 규칙) 안내</h4>
      <div class="admin-info">기본 규칙은 앞 단어의 끝 글자와 같은 글자로 시작해야 합니다.
        여기에 두음법칙 예외가 적용되어, 끝이 <b>레</b>면 <b>레·에·네</b> 로 시작하는 단어도 이어집니다.</div>
      <div class="admin-dueum">
        <span class="dueum-chip">래 → 내</span><span class="dueum-chip">레 → 에·네</span>
        <span class="dueum-chip">례 → 예</span><span class="dueum-chip">랑 → 낭</span>
        <span class="dueum-chip">럭 → 넉</span><span class="dueum-chip">리 → 이</span>
        <span class="dueum-chip">려 → 여</span><span class="dueum-chip">로 → 노</span>
        <span class="dueum-chip">루 → 누</span><span class="dueum-chip">니 → 이</span>
        <span class="dueum-chip">녀 → 여</span><span class="dueum-chip">뇨 → 요</span>
      </div>
      <div class="admin-info">이 예외가 없으면 '에'나 '예'로 시작하는 단어가 끝 글자 때문에 거부될 수 있습니다.<br>
        단어가 있는데 안 먹힌다고 제보가 오면 먼저 마지막 글자와 두음법칙 여부를 확인해보세요.</div>
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
      <h4>관리자 추가 (최고 관리자 전용)</h4>
      <div class="admin-row">
        <input type="text" id="adminSubNick" class="admin-text" placeholder="관리자로 추가할 닉네임" autocomplete="off" data-admin-enter="[data-admin-addsub]">
        <button type="button" class="admin-apply" data-admin-addsub="1">관리자로 추가</button>
      </div>
      <div class="admin-info">※ 닉네임만 입력하면 바로 관리자(개인 통계 관리 권한)로 추가됩니다.
        계정 비밀번호는 자동으로 발급되어 위에 표시되며, 그 비밀번호를 해당 관리자에게 꼭 알려주세요.</div>
      <ul class="admin-sub-list">${subList || '<li class="admin-info">등록된 서브 관리자가 없습니다.</li>'}</ul>
      <div class="admin-info">※ 관리자 계정 로그인은 '닉네임 + 계정 비밀번호'입니다. 비밀번호를 모르는 사람은
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

  /* 관리자: 돈 조절 (최고 관리자 전용) */
  const moneyCard = isSuper ? `
    <div class="admin-card">
      <h4>돈(코인) 조절 (최고 관리자 전용)</h4>
      <div class="admin-row">
        <input type="text" id="adminMoneyNick" class="admin-text" placeholder="닉네임" autocomplete="off">
        <input type="number" id="adminMoneyAmount" class="admin-num" placeholder="변동액 (+/- 숫자)" autocomplete="off">
        <button type="button" class="admin-apply" id="adminMoneyApply">적용</button>
      </div>
      <div class="admin-info">※ 양수는 추가, 음수는 차감입니다.</div>
    </div>
  ` : "";

  /* 관리자: 버그 제보 (최고 관리자 전용) */
  const bugCard = isSuper ? `
    <div class="admin-card">
      <h4>버그 제보 목록 (최고 관리자만 열람)</h4>
      <button type="button" class="admin-apply" id="adminBugLoad">버그 제보 불러오기</button>
      <div id="adminBugList"></div>
    </div>
  ` : "";

  body.innerHTML = `
    ${data.message ? `<div class="admin-msg ok">${escapeHtml(data.message)}</div>` : ""}
    ${statusLine}
    <div class="admin-info">시작 음절: <b>${(data.startSyllables || []).join(" ")}</b> &nbsp;·&nbsp; 현재 연결: <b>${escapeHtml(myNickname || "-")}</b></div>
    ${pwCard}
    ${subCard}
    ${resetCard}
    ${configCard}
    ${dueumCard}
    ${statsCard}
    ${moneyCard}
    ${bugCard}
    <div class="admin-status" id="adminStatus"></div>
  `;
  bindAdminBody();

  const moneyApply = $("#adminMoneyApply");
  if (moneyApply) moneyApply.addEventListener("click", () => {
    const nick = $("#adminMoneyNick")?.value.trim() || "";
    const amount = Number($("#adminMoneyAmount")?.value ?? 0);
    const pw = $("#adminPw")?.value || "";
    if (!nick) { setAdminStatus("닉네임을 입력해주세요.", "error"); return; }
    if (!pw) { setAdminStatus("관리자 비밀번호가 필요합니다.", "error"); return; }
    socket.emit("admin:setMoney", { nickname: nick, amount, password: pw });
  });

  const bugLoad = $("#adminBugLoad");
  if (bugLoad) bugLoad.addEventListener("click", () => socket.emit("admin:getBugs"));
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
    if (!nickname || nickname.length < 2) { setAdminStatus("관리자로 추가할 닉네임을 입력해주세요.", "error"); return; }
    socket.emit("admin:addSubAdmin", { nickname });
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

/* ---------------------------------------------------------
   계정 탭 (왼쪽 위) — 정보, 점수, 닉네임·비밀번호 변경
--------------------------------------------------------- */
function accountMsg(text, type) {
  const el = $("#accountMsg");
  if (!el) { showMessage(text, type === "ok" ? "success" : "error"); return; }
  el.textContent = text || "";
  el.className = "account-msg" + (type === "ok" ? " ok" : type === "error" ? " error" : "");
}

function openAccountPanel(force) {
  const panel = $("#accountPanel");
  if (!panel) return;
  const open = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  if (open) {
    renderAccountInfo($("#nickInput")?.value.trim() || myNickname || "");
    renderMissions();
    renderRecentGames();
    renderAccTitles();
    if (socket && socketConnected) socket.emit("missions:status");
    setTimeout(() => $("#accPwInput")?.focus(), 60);
  }
}

function renderAccountInfo(nick) {
  const input = $("#accNickInput");
  if (input && nick !== undefined) input.value = nick || "";
  const pw = $("#accPwInput");
  if (pw && myAdminRole !== "none" && !pw.value) {
    pw.placeholder = myAdminRole === "super" ? "최고 관리자 로그인됨" : "서브 관리자 로그인됨";
  }
  const box = $("#accChangeBox");
  if (box) box.classList.toggle("hidden", myAdminRole === "none");

  /* 비밀번호 저장 — 일반 사용자는 항상 자동 저장(선택 화면 없음), 관리자만 체크박스 표시 */
  const creWrap = $(".acc-save-creds");
  if (creWrap) {
    const isAdmin = myAdminRole !== "none";
    creWrap.classList.toggle("hidden", !isAdmin);
  }
  const cre = $("#accSaveCreds");
  if (cre) {
    const stored = localStorage.getItem("kkSaveAdmin");
    const isAdmin = myAdminRole !== "none";
    const def = !isAdmin;
    cre.checked = stored === null ? def : stored === "1";
  }
  const lbl = $("#accSaveCredsLabel");
  if (lbl) {
    if (myAdminRole !== "none") {
      lbl.textContent = myNickname ? `'${myNickname}' 관리자 로그인 정보 저장 (체크 시 자동 로그인)` : "관리자 비밀번호 저장 (체크 시 자동 로그인)";
    } else {
      lbl.textContent = "일반 사용자는 비밀번호가 항상 자동 저장됩니다.";
    }
  }
}

function renderAccountScores() {
  if (socket && socketConnected) socket.emit("player:getRanking");
}

function saveAccount() {
  const nick = normalizeWord($("#accNickInput")?.value || "");
  const pw = $("#accPwInput")?.value ?? "";
  if (!nick) {
    accountMsg("닉네임을 입력해주세요.", "error");
    return;
  }
  if (nick.length > 12) {
    accountMsg("닉네임은 12자 이내로 입력해주세요.", "error");
    return;
  }
  if (socket && socketConnected && socket.id) {
    socket.emit("player:setName", { nickname: nick, password: pw });
  } else {
    accountMsg("서버에 연결되지 않았습니다.", "error");
  }
}

function changeAccountPassword() {
  const current = $("#accCurPw")?.value ?? "";
  const next = $("#accNewPw")?.value ?? "";
  if (next.length < 4) {
    accountMsg("새 비밀번호는 4자 이상이어야 합니다.", "error");
    return;
  }
  if (myAdminRole === "super") {
    socket.emit("admin:setPassword", { current, next });
  } else if (myAdminRole === "sub") {
    socket.emit("admin:setSubPassword", { current, next });
  } else {
    accountMsg("관리자 계정으로 로그인해야 변경할 수 있습니다.", "error");
    return;
  }
  if ($("#accCurPw")) $("#accCurPw").value = "";
  if ($("#accNewPw")) $("#accNewPw").value = "";
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
      ${f.online ? `<button class="friend-invite" data-friend-invite="${escapeHtml(f.nickname)}">대결 신청</button>` : `<span class="friend-offline">오프라인</span>`}
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
  showMessage("대결용 온라인 방을 만들고 있습니다...", "info");
  const t = setTimeout(() => { startingGame = false; }, 6000);
  const created = (d) => {
    socket.off("room:created", created);
    clearTimeout(t);
    if (d && d.ok) socket.emit("room:invite", { nickname: name });
    else showMessage("온라인 방을 만들지 못해 대결 신청을 보내지 못했습니다.", "error");
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

let lbMode = "multi";

function lbMarkup(rows, mode, showToggle = true) {
  const modeLabel = mode === "multi" ? "온라인 멀티" : mode === "ranked" ? "랭크 매칭" : "싱글플레이";
  const toggle = showToggle ? `<div class="lb-toggle">
        <button data-mode="multi" class="active">온라인 멀티</button>
      </div>` : "";
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

function bindLbToggles(box, btn, fetchFn) {
  box.querySelectorAll(".lb-toggle button").forEach(b => {
    b.classList.toggle("active", true);
    /* no-op — only multi available */
  });
}

/* ---------------------------------------------------------
   실시간 랭킹 패널 — 멀티/랭크/돈/연승 탭, 상시 렌더
--------------------------------------------------------- */
function sideRankMarkup(rows, mode) {
  if (!Array.isArray(rows) || rows.length === 0) return `<div class="side-rank-empty">기록이 없습니다.</div>`;
  return rows.map(r => {
    const me = String(r.nickname || "플레이어").replace(/\s+/g, "").toLowerCase() === String(myNickname || "").replace(/\s+/g, "").toLowerCase() && myNickname;
    let val = (r.ranking || 0) + "점";
    let sub = `${r.wins || 0}승 ${r.losses || 0}패`;
    if (mode === "money") { val = Number(r.money || 0).toLocaleString() + "원"; sub = ""; }
    else if (mode === "streak") { val = (r.bestStreak || 0) + "연승"; sub = `현재 ${r.streak || 0}`; }
    const cls = (r.rank === 1 ? " top1" : r.rank <= 3 ? " top3" : "") + (me ? " lb-me" : "");
    return `<div class="side-rank-row${cls}">
      <span class="side-rank-num">${r.rank}</span>
      <span class="side-rank-name" title="${escapeHtml(r.nickname || "플레이어")}">${escapeHtml(r.nickname || "플레이어")}</span>
      <span class="side-rank-val">${escapeHtml(val)}</span>
      ${sub ? `<span class="side-rank-sub">${escapeHtml(sub)}</span>` : ""}
    </div>`;
  }).join("");
}

async function loadSideRanking(mode = sideRankMode, silent = false) {
  if (mode === "money") sideRankMode = "money";
  else if (mode === "streak") sideRankMode = "streak";
  else if (mode === "ranked") sideRankMode = "ranked";
  else sideRankMode = "multi";
  const body = $("#sideRankBody");
  if (!body) return;
  if (!silent) {
    $all(".side-rank-tabs button").forEach(b => b.classList.toggle("active", b.dataset.sideMode === sideRankMode));
    body.innerHTML = `<div class="side-rank-empty">불러오는 중...</div>`;
  }
  try {
    const res = await fetch(`/api/leaderboard?limit=${SIDE_RANK_LIMIT}&mode=${sideRankMode}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("bad payload");
    body.innerHTML = sideRankMarkup(rows, sideRankMode);
  } catch (err) {
    body.innerHTML = `<div class="side-rank-empty">랭킹을 불러오지 못했습니다.</div>`;
  }
}

function initSideRanking() {
  $all(".side-rank-tabs button").forEach(btn => {
    btn.addEventListener("click", () => loadSideRanking(btn.dataset.sideMode));
  });
  $("#sideRankClose")?.addEventListener("click", () => {
    $("#sideRank").classList.add("closed");
    $("#sideRankOpen").classList.remove("hidden");
  });
  $("#sideRankOpen")?.addEventListener("click", () => {
    $("#sideRank").classList.remove("closed");
    $("#sideRank").style.display = "flex";
    $("#sideRankOpen").classList.add("hidden");
    loadSideRanking(sideRankMode, true);
  });
  if (window.innerWidth < 1080) {
    $("#sideRank").classList.add("closed");
    $("#sideRankOpen").classList.remove("hidden");
  }
  loadSideRanking("multi");
  setInterval(() => { if (!$("#sideRank").classList.contains("closed")) loadSideRanking(sideRankMode, true); }, 180000);
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
    const res = await fetch(`/api/leaderboard?limit=10&mode=multi`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("bad payload");
    box.innerHTML = lbMarkup(rows, "multi", false);
    box.classList.remove("hidden");
    if (btn) btn.textContent = "리더보드 접기";
  } catch (err) {
    box.innerHTML = `<div class="lb-empty" style="color:#f87171">리더보드를 불러오지 못했습니다.</div>`;
    box.classList.remove("hidden");
    if (btn) btn.textContent = "리더보드 보기";
  }
}

async function toggleLeaderboardRanked() {
  const box = $("#leaderboardRanked");
  const btn = $("#loadLbRanked");
  if (!box) return;
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    if (btn) btn.textContent = "랭크 리더보드 보기";
    return;
  }
  if (btn) btn.textContent = "불러오는 중...";
  try {
    const res = await fetch(`/api/leaderboard?limit=10&mode=ranked`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("bad payload");
    box.innerHTML = lbMarkup(rows, "ranked", false);
    box.classList.remove("hidden");
    if (btn) btn.textContent = "랭크 리더보드 접기";
  } catch (err) {
    box.innerHTML = `<div class="lb-empty" style="color:#f87171">리더보드를 불러오지 못했습니다.</div>`;
    box.classList.remove("hidden");
    if (btn) btn.textContent = "랭크 리더보드 보기";
  }
}

/* ---------------------------------------------------------
   초기화
--------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initSocket();
  initNicknameBar();
  updateStatsUI();
  initSideRanking();
  renderSoundToggle();

  /* 소리/진동 토글 — 첫 조작 시 AudioContext 시작 (자동재생 정책 대응) */
  $("#soundToggle")?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("kkSound", soundEnabled ? "1" : "0");
    renderSoundToggle();
    playSound("word");
  });
  document.addEventListener("pointerdown", () => ensureAudio(), { once: false });
  document.addEventListener("keydown", () => ensureAudio(), { once: false });

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
        if (!gameState || !roomId) setTimeout(startSingleGame, 100);
      } else if (currentMode === "ranked") {
        if (gameState && roomId && currentMode === "ranked") { /* in game */ }
        else { $("#rankedLobby")?.classList.remove("hidden"); $("#rankedGame")?.classList.add("hidden"); }
        updateRankedQueueUI();
        renderRankedStreakChip();
      } else if (currentMode === "shop") {
        if (socket && socketConnected) {
          socket.emit("shop:list");
          socket.emit("attendance:status");
        }
      }
      loadSideRanking(sideRankMode, true);
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

  /* 싱글 AI 난이도 선택 */
  const diffSel = $("#aiDifficulty");
  if (diffSel) {
    diffSel.value = aiDifficulty;
    diffSel.addEventListener("change", () => {
      aiDifficulty = diffSel.value || "normal";
      localStorage.setItem("kkAiDiff", aiDifficulty);
    });
  }

  $("#singleSend")?.addEventListener("click", submitSingleWord);
  $("#hintBtn")?.addEventListener("click", () => {
    if (!socket || !socketConnected) return;
    socket.emit("game:hint");
  });
  $("#singleInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (e.isComposing || e.keyCode === 229) return;
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
  $("#onlineSend")?.addEventListener("click", () => submitWord("online"));
  $("#onlineInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submitWord("online");
    }
  });
  $("#onlineRestart")?.addEventListener("click", () => {
    if (!socket || !socketConnected) return;
    const wrap = $("#onlineRestartWrap");
    if (wrap) wrap.classList.add("hidden");
    socket.emit("game:restart");
  });

  $("#loadLb")?.addEventListener("click", toggleLeaderboard);

  /* 랭크 매칭 */
  $("#rankedQueueBtn")?.addEventListener("click", () => {
    if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
    if (!requireNickname()) return;
    rankedQueued = true;
    updateRankedQueueUI();
    socket.emit("ranked:queue");
  });
  $("#rankedCancelBtn")?.addEventListener("click", () => {
    rankedQueued = false;
    updateRankedQueueUI();
    socket.emit("ranked:cancel");
  });

  /* 자동 계속매칭 — 게임 후 자동으로 다음 매칭 이어가기 */
  const autoCb = $("#rankedAutoContinue");
  if (autoCb) {
    autoCb.checked = rankedAutoContinue;
    autoCb.addEventListener("change", () => {
      rankedAutoContinue = autoCb.checked;
      localStorage.setItem("kkAutoRequeue", rankedAutoContinue ? "1" : "0");
    });
  }

  /* 복수전 — 같은 상대와 다시 대결 */
  $("#rankedRematchBtn")?.addEventListener("click", () => {
    if (!socket || !socketConnected) return;
    if (!gameState || !gameState.finished) { showMessage("게임이 종료된 후 사용할 수 있습니다.", "info"); return; }
    clearTimeout(rankedAutoLeave);
    rankedAutoLeave = null;
    rankedRematchReq = true;
    showRankedRematchBar(true, true);
    socket.emit("ranked:rematch");
  });
  $("#rankedRematchCancelBtn")?.addEventListener("click", () => {
    rankedRematchReq = false;
    showRankedRematchBar(true, false);
    socket.emit("ranked:rematchCancel");
    showMessage("복수전 신청을 취소했습니다.", "info");
    clearTimeout(rankedAutoLeave);
    rankedAutoLeave = setTimeout(() => {
      rankedAutoLeave = null;
      if (gameState && gameState.finished && (!gameState.roomId || gameState.roomId === roomId)) leaveRoom();
    }, 4000);
  });
  $("#rankedSend")?.addEventListener("click", () => submitWord("ranked"));
  $("#rankedInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submitWord("ranked");
    }
  });
  $("#rankedLeave")?.addEventListener("click", () => {
    leaveRoom();
    renderRoomInfo(null);
  });
  $("#loadLbRanked")?.addEventListener("click", toggleLeaderboardRanked);

  /* 출석체크 */
  $("#attendanceBtn")?.addEventListener("click", () => {
    if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
    if (!myNickname) { showMessage("출석체크는 닉네임을 저장한 뒤 이용할 수 있습니다.", "error"); return; }
    socket.emit("attendance:check");
  });

  /* 상점/버그 */
  $("#bugBtn")?.addEventListener("click", () => { $("#bugModal")?.classList.remove("hidden"); });
  $("#bugClose")?.addEventListener("click", () => { $("#bugModal")?.classList.add("hidden"); });
  $("#bugModal")?.addEventListener("click", (e) => { if (e.target === $("#bugModal")) $("#bugModal")?.classList.add("hidden"); });
  $("#bugSubmit")?.addEventListener("click", () => {
    const category = $("#bugCategory")?.value || "기타";
    const message = $("#bugMessage")?.value?.trim() || "";
    if (!message) { const m = $("#bugMsg"); if (m) { m.textContent = "내용을 입력해주세요."; m.dataset.type = "error"; } return; }
    if (socket && socketConnected) socket.emit("bug:submit", { category, message });
  });

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

  /* 게임 방법 (우하단) */
  const howModal = $("#howModal");
  $("#howBtn")?.addEventListener("click", () => howModal?.classList.remove("hidden"));
  if (howModal) {
    howModal.addEventListener("click", (e) => {
      if (e.target.closest("[data-how-close]")) howModal.classList.add("hidden");
      if (e.target === howModal) howModal.classList.add("hidden");
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAdminPanel();
      $("#howModal")?.classList.add("hidden");
    }
  });

  /* 닉네임 */
  $("#nickSave")?.addEventListener("click", saveNickname);
  $("#nickInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveNickname();
    }
  });

  /* 계정 탭 (왼쪽 위) */
  $("#accountBtn")?.addEventListener("click", () => openAccountPanel());
  $("#accountClose")?.addEventListener("click", () => openAccountPanel(false));
  $("#accApply")?.addEventListener("click", saveAccount);
  $("#accNickInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveAccount(); }
  });
  $("#accPwInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveAccount(); }
  });
  $("#accPwSave")?.addEventListener("click", changeAccountPassword);
  $("#accSaveCreds")?.addEventListener("change", (e) => {
    localStorage.setItem("kkSaveAdmin", e.target.checked ? "1" : "0");
    if (!e.target.checked && myAdminRole !== "none") localStorage.removeItem("kkPassword");
    syncSavedCredentials();
  });
  $("#accountPanel").querySelectorAll("[data-pw-toggle]").forEach(setupPwToggleInput);
  renderAccountInfo(myNickname);
  renderAccountScores();

});
