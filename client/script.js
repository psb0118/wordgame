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
let spectating = false;
let gameState = null;
let currentMaxHearts = 2;
let submitting = false;
let submitLockTimer = null;
let countdownTimer = null;
let gameSessionId = 0;
let startingGame = false;
let myNickname = localStorage.getItem("kkNickname") || "";
let friends = [];
let friendRequests = [];
let friendsPanelOpen = false;
let accountPanelOpen = false;
let pendingInvite = null;
/* 끊긴 온라인/랭크 게임 재접속(30초 유예)용 — 마지막으로 있던 방 */
let lastRoomId = sessionStorage.getItem("kkLastRoom") || null;
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
let rankedInvitePending = false;
let rankedInviteIncoming = null;
let rankedAutoContinue = localStorage.getItem("kkAutoRequeue") === "1";
let rankedStreak = 0;
let rankedBestStreak = 0;
let lastRankedStreak = 0;

/* 출석체크 상태 */
let attendanceCheckedToday = false;
let attendanceStreak = 0;
let attendanceNextReward = 0;
const attendanceReward = (streak) => Math.min(10000, 2000 + (streak - 1) * 1000);

/* 일일/주간/월간 미션 & 최근 전적 상태 */
let missionsGroups = { daily: [], weekly: [], monthly: [] };
let missionPeriods = {};
let recentGamesState = [];
let dailyCounters = null;

/* 실시간 랭킹 패널 상태 */
let sideRankMode = "ranked";
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

function bindAdminEnter(selector, fn) {
  const inp = $(selector);
  if (!inp) return;
  inp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    fn();
  });
}

/* 이름 표시 — name-bar가 없으므로 money-bar 칩과 계정 탭만 갱신한다 */
let myNameChanges = 0;
const RENAME_COST = 1000000;

function updateNicknameUI() {
  const chip = $("#myNickChip");
  if (chip) chip.textContent = myNickname || "이름 설정";
  const input = $("#accNickInput");
  if (input && document.activeElement !== input) input.value = myNickname || "";
  updateRenameInfo();
  updateAdminVisibility();
}

/* 다음 이름 변경 비용 안내 — 첫 1회 무료, 이후 회당 100만 코인 */
function updateRenameInfo() {
  const el = $("#accRenameInfo");
  if (!el) return;
  const nextCost = myNameChanges >= 1 ? RENAME_COST : 0;
  el.classList.remove("hidden");
  el.innerHTML = nextCost > 0
    ? `다음 이름 변경 비용: <b>${nextCost.toLocaleString()}코인</b> (이전 ${myNameChanges}회 변경)`
    : `다음 이름 변경: <b>무료</b> (첫 1회 · 이후 1회당 ${RENAME_COST.toLocaleString()}코인)`;
}

/* 이름이 없으면 계정 탭을 열어 입력으로 유도한다 */
function requireNickname() {
  if (myNickname) return true;
  showMessage("먼저 계정 탭에서 닉네임을 설정해 주세요.", "error");
  openAccountPanel(true);
  const bar = $(".money-bar");
  if (bar) {
    bar.classList.add("attention");
    setTimeout(() => bar.classList.remove("attention"), 2000);
  }
  return false;
}

/* 관리자 패널은 서버가 검증한 Google 관리자 계정에만 보임 */
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
  "롤": ["롤", "놀"], "롬": ["롬", "놈"], "롭": ["롭", "놑", "놉"],
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
  "닢": ["닢", "잎"], "잎": ["잎", "닢"],
  "놉": ["놉", "롭"]
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
        /* 냐·냑은 두음법칙을 적용하지 않는다 — 서버 game.js와 동일 */
        if (c === "냐" || c === "냑") continue;
        let partners = [];
        if (cho === 5) partners = yg ? [11] : [2];         /* ㄹ */
        else if (cho === 2) partners = yg ? [11, 5] : [5]; /* ㄴ */
        else if (cho === 11) partners = yg ? [5, 2] : [];  /* ㅇ */
        for (const pcho of partners) {
          const p = String.fromCharCode(0xAC00 + (pcho * 21 + m) * 28 + j);
          if (p === c || p === "냐" || p === "냑") continue;
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
    { tier: "Master", base: 2600, span: 400 },
    { tier: "Grandmaster", base: 3000, span: 400 },
    { tier: "Challenger", base: 3400, span: 400 }
  ];
  let tier = tierTables[tierTables.length - 1];
  for (const t of tierTables) {
    if (rating >= t.base) tier = t;
  }
  if (rating >= 3400) return { tier: "Challenger", sub: "" };
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

/* 재접속한 방의 모드로 화면 전환 — 탭 클릭처럼 보이되 방을 나가지 않는다 */
function switchToModeTab(mode, rankedInGame) {
  if (currentMode === mode) return;
  $all(".tabs button").forEach(b => b.classList.remove("active"));
  const tab = $(`.tabs button[data-mode='${mode}']`);
  if (tab) tab.classList.add("active");
  currentMode = mode;
  $all(".panel").forEach(p => p.classList.add("hidden"));
  const target = $(`#${mode}`);
  if (target) target.classList.remove("hidden");
  if (mode === "ranked") {
    $("#rankedLobby")?.classList.toggle("hidden", !!rankedInGame);
    $("#rankedGame")?.classList.toggle("hidden", !rankedInGame);
  }
  if (mode === "season") {
    refreshSeasonBar();
    if (socket && socketConnected) socket.emit("missions:status");
  }
}

/* 재접속용 — 현재 방에 있는 상태를 세션에 기록한다 */
function storeLastRoomId(rid) {
  if (!rid) return;
  lastRoomId = rid;
  try { sessionStorage.setItem("kkLastRoom", rid); } catch (e) { /* 무시 */ }
}

function clearLastRoomId() {
  lastRoomId = null;
  try { sessionStorage.removeItem("kkLastRoom"); } catch (e) { /* 무시 */ }
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
    /* 저장된 이름으로 재등록 (Google 세션이 있으면 서버가 연결을 복원한다) */
    if (myNickname) socket.emit("player:setName", { nickname: myNickname });
    socket.emit("admin:getRole");
    /* 연결이 늦어져 싱글 게임 자동 시작 타이머를 놓친 경우를 대비해 재시도 */
    if (currentMode === "single" && !roomId && !gameState && !startingGame) {
      startSingleGame();
    }
    /* 끊겼던 온라인/랭크 게임 — 30초 유예 안이면 서버가 room:joined(reconnect)로 복구한다 */
    if (myNickname && lastRoomId && !startingGame) {
      const rid = lastRoomId;
      setTimeout(() => {
        if (lastRoomId === rid) socket.emit("room:join", { roomId: rid, nickname: myNickname });
      }, 150);
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
    if ("isAdmin" in data) {
      myAdminRole = data.isAdmin ? "super" : "none";
      updateAdminVisibility();
    }
    const sng = data.single || { rank: null, rating: null, wins: 0, losses: 0 };
    const mul = data.multi || { rank: null, rating: null, wins: 0, losses: 0 };
    const rkd = data.ranked || { rank: null, rating: null, wins: 0, losses: 0 };
    setText(["#onlineRank"], formatRank(mul.rank || calculateRank(mul.rating)));
    setText(["#onlineRating"], mul.rating);
    setText(["#accMultiRating"], mul.rating);
    setText(["#accMultiRank"], mul.rank ? formatRank(mul.rank) : "");
    setText(["#accRankedRating"], rkd.rating);
    setText(["#accRankedRank"], rkd.rank ? formatRank(rkd.rank) : "");
    setText(["#accSingleWL"], `${sng.wins || 0}승 ${sng.losses || 0}패`);
    setText(["#accMultiWL"], `${mul.wins || 0}승 ${mul.losses || 0}패`);
    setText(["#accRankedWL"], `${rkd.wins || 0}승 ${rkd.losses || 0}패`);
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
    if (Number.isFinite(Number(data.nameChanges))) { myNameChanges = Number(data.nameChanges); updateRenameInfo(); }
    if (Array.isArray(data.titles)) ownedTitles = data.titles;
    currentTitle = data.currentTitle || "";
    renderMoneyBar();
    renderAccountScoresStatic();
    renderItems();
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
    if (data.daily || data.weekly || data.monthly) {
      if (data.daily) dailyCounters = data.daily;
      const any = applyRankingToMissions(data);
      if (!any && socket && socket.connected) socket.emit("missions:status");
      renderMissions();
    }
    if (shopInfo) renderShop();
    renderAccountScoresStatic();
  });

  /* -- 랭크 매칭 -------------------------------------- */
  socket.on("ranked:matched", (data) => {
    if (!data || !data.ok || !data.state) return;
    clearTimeout(rankedAutoLeave);
    rankedAutoLeave = null;
    rankedQueued = false;
    rankedRematchReq = false;
    rankedInvitePending = false;
    rankedInviteIncoming = null;
    hideRankedInviteBar();
    showRankedRematchBar(false, false);
    rankedMatchInfo = { opponent: data.opponent, opponentRating: data.opponentRating };
    gameState = data.state;
    roomId = data.roomId;
    playerIndex = data.playerIndex ?? data.state.players?.find(p => p.socketId === socket.id || p.id === socket.id)?.playerIndex ?? 0;
    storeLastRoomId(data.roomId);
    gameSessionId++;
    const tab = $(".tabs button[data-mode='ranked']");
    if (tab && currentMode !== "ranked") tab.click();
    $("#rankedLobby")?.classList.add("hidden");
    $("#rankedGame")?.classList.remove("hidden");
    clearChat(); /* 방 채팅으로 전환 */
    updateChatScopeLabel();
    if (socket && socketConnected) socket.emit("chat:history", { roomId: data.roomId }); /* 방 이력 복원 */
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

  /* -- 랭크 대결 초대 (2인전) -------------------------- */
  socket.on("ranked:inviteSent", (data) => {
    if (!data) return;
    if (data.ok === false) {
      showMessage(data.reason || "랭크 초대를 보내지 못했습니다.", "error");
      return;
    }
    if (data.canceled) {
      rankedInvitePending = false;
      updateRankedInviteUI();
      showMessage("랭크 초대를 취소했습니다.", "info");
      return;
    }
    rankedInvitePending = true;
    updateRankedInviteUI();
    showMessage(`⚔ ${data.nickname || ""}님에게 랭크 대결을 신청했습니다. 상대의 수락을 기다립니다.`, "info");
  });

  socket.on("ranked:inviteReceived", (data) => {
    if (!data || !data.from) return;
    rankedInviteIncoming = data;
    const wrap = $("#rankedInviteWrap");
    if (wrap) {
      const text = $("#rankedInviteText");
      if (text) text.textContent = `⚔ ${data.from}님이 랭크 대결을 신청했습니다! (상대 랭크 ${data.fromRating != null ? data.fromRating : "-"})`;
      wrap.classList.remove("hidden");
    }
    showMessage(`⚔ ${data.from}님이 랭크 대결을 신청했습니다! 수락하시겠습니까?`, "success");
  });

  socket.on("ranked:inviteStatus", (data) => {
    if (!data) return;
    if (data.ok === false) {
      hideRankedInviteBar();
      showMessage(data.reason || "요청을 처리하지 못했습니다.", "error");
    } else if (data.rejected) {
      hideRankedInviteBar();
      showMessage("랭크 초대를 거절했습니다.", "info");
    }
  });

  socket.on("ranked:inviteRejected", (data) => {
    rankedInvitePending = false;
    updateRankedInviteUI();
    showMessage(`${data?.from || "상대"}님이 랭크 대결을 거절했습니다.`, "info");
  });

  socket.on("ranked:inviteCanceled", (data) => {
    hideRankedInviteBar();
    showMessage(`${data?.reason ? data.reason : (data?.from || "상대") + "님이 랭크 대결을 취소했습니다."}`, "info");
  });

  socket.on("money:received", (data) => {
    if (!data) return;
    moneyBalance += Number(data.amount) || 0;
    renderMoneyBar();
    playSound("cash");
    const mult = data.multiplier && data.multiplier > 1 ? ` (배율 ${data.multiplier}배 적용!)` : "";
    showMessage(`💰 +${(Number(data.amount) || 0).toLocaleString()}원 획득!${mult}`, "win");
    applyFx($("#rankedMessage") || $(".money-bar"), "fx-cash");
    socket.emit("player:getRanking");
  });

  /* 복귀 환영 보상 — 3일 이상 접속하지 않았다 돌아온 유저에게 지급 */
  socket.on("welcome:reward", (data) => {
    if (!data || !data.amount) return;
    moneyBalance += Number(data.amount) || 0;
    renderMoneyBar();
    playSound("win");
    showMessage(data.message || `환영 보상 +${Number(data.amount).toLocaleString()}원을 받았습니다!`, "win");
    applyFx($(".money-bar"), "fx-cash");
    socket.emit("player:getRanking");
  });

  /* 랭크 보호 티켓 자동 사용 알림 */
  socket.on("shield:used", (data) => {
    showMessage(data?.message || "랭크 보호 티켓이 사용되었습니다!", "success");
    playSound("win");
    if (shopInfo) shopInfo.shieldTickets = Math.max(0, (shopInfo.shieldTickets || 1) - 1);
    renderItems();
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
      }
      if (typeof data.ratingBoostGames === "number") ratingBoostGames = data.ratingBoostGames;
      if (typeof data.moneyMultiplier === "number") moneyMultiplier = data.moneyMultiplier;
      if (typeof data.shieldTickets === "number" && shopInfo) shopInfo.shieldTickets = data.shieldTickets;
      renderMoneyBar();
      renderShop();
    }
  });

  /* -- 일일/주간/월간 미션 ---------------------------------------- */
  socket.on("missions:status", (data) => {
    if (!data) return;
    const safe = (arr) => Array.isArray(arr) ? arr : [];
    if (data.groups) {
      missionsGroups = {
        daily: safe(data.groups.daily),
        weekly: safe(data.groups.weekly),
        monthly: safe(data.groups.monthly)
      };
    } else if (Array.isArray(data.missions)) {
      missionsGroups.daily = data.missions;
    }
    if (data.periods) missionPeriods = data.periods || {};
    if (data.daily) dailyCounters = data.daily;
    renderMissions();
  });

  socket.on("missions:result", (data) => {
    if (!data) return;
    showMessage(data.reason || data.message || (data.ok ? "보상을 수령했습니다!" : "보상 수령에 실패했습니다."), data.ok ? "success" : "error");
    const safe = (arr) => Array.isArray(arr) ? arr : [];
    if (data.groups) {
      missionsGroups = {
        daily: safe(data.groups.daily),
        weekly: safe(data.groups.weekly),
        monthly: safe(data.groups.monthly)
      };
    } else if (Array.isArray(data.missions)) {
      missionsGroups.daily = data.missions;
    }
    if (data.daily) dailyCounters = data.daily;
    if (typeof data.money === "number") moneyBalance = data.money;
    if (Array.isArray(data.titles)) ownedTitles = data.titles;
    if (typeof data.currentTitle === "string") currentTitle = data.currentTitle;
    renderMoneyBar();
    renderMissions();
    renderShop();
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

  /* -- 제재 목록(밴/뮤트) 결과 -------------------------- */
  socket.on("admin:chatClearResult", (data) => {
    if (data && data.ok) { setAdminStatus(data.reason || "전체 채팅 이력을 비웠습니다.", "ok"); }
    else { setAdminStatus((data && data.reason) || "채팅 이력 비우기에 실패했습니다.", "error"); }
  });

  socket.on("admin:moderation", (data) => {
    if (!data) return;
    renderAdminModeration(data);
  });

  /* -- 계정 삭제 결과 ------------------------------------ */
  socket.on("admin:deletePlayerResult", (data) => {
    if (!data) return;
    if (data.ok) {
      setAdminStatus(data.message || "삭제했습니다.", "ok");
      socket.emit("admin:moderationList");
    } else {
      setAdminStatus(data.reason || "삭제에 실패했습니다.", "error");
    }
  });

  /* -- 내 계정이 삭제/제재당했을 때 안내 ----------------- */
  socket.on("player:deleted", (data) => {
    const msg = (data && data.reason) || "관리자에 의해 계정이 삭제되었습니다.";
    showMessage(msg, "error");
    accountMsg(msg, "error");
  });

  /* -- 내 계정이 제재당했을 때 안내 -------------------- */
  socket.on("player:banned", (data) => {
    const msg = (data && data.reason) || "이 계정은 이용이 정지되었습니다.";
    showMessage(msg, "error");
    accountMsg(msg, "error");
  });

  socket.on("player:muted", (data) => {
    showMessage((data && data.reason) || "채팅이 차단되었습니다.", "error");
  });

  socket.on("player:unbanned", () => showMessage("이제 다시 이용할 수 있습니다.", "success"));
  socket.on("player:unmuted", () => showMessage("채팅 차단이 해제되었습니다.", "success"));

  /* -- 실시간 채팅 -------------------------------------- */
  socket.on("chat:message", (data) => {
    if (data && data.scope === "global") {
      globalChatCache.push(data);
      if (globalChatCache.length > 30) globalChatCache.shift();
    }
    appendChatLine(data);
  });
  socket.on("chat:history", (data) => {
    if (!data || !data.ok) return;
    const msgs = (Array.isArray(data.messages) ? data.messages : []).slice(-30);
    if (data.scope === "room") {
      /* 방 이력 — 방이 살아 있는 동안 유지되는 로컬 기록. 전역 캐시는 건드리지 않는다 */
      clearChat();
      msgs.forEach(m => appendChatLine(m, { silent: true }));
    } else {
      globalChatCache = msgs;
      clearChat();
      msgs.forEach(m => appendChatLine(m, { silent: true }));
    }
    const list = $("#chatList");
    if (list) list.scrollTop = list.scrollHeight;
  });
  socket.on("chat:cleared", () => { globalChatCache = []; clearChat(); });

  socket.on("chat:error", (data) => chatNotice((data && data.reason) || "전송하지 못했습니다.", false));
  socket.on("chat:reportResult", (data) => {
    chatNotice((data && data.reason) || (data && data.ok ? "접수되었습니다." : "신고에 실패했습니다."), !!(data && data.ok));
  });

  /* -- 닉네임 ----------------------------------------- */
  socket.on("player:nameUpdated", (data) => {
    if (!data) return;
    if (data.ok && data.nickname) {
      const renamed = !!data.renamed;
      myNickname = data.nickname;
      if (Number.isFinite(Number(data.nameChanges))) myNameChanges = Number(data.nameChanges);
      localStorage.setItem("kkNickname", myNickname);
      updateNicknameUI();
      renderAccountInfo();
      showMessage(renamed ? "이름이 변경되었습니다. 전적·코인은 그대로 유지됩니다." : "이름이 저장되었습니다.", "success");
      accountMsg(renamed ? "이름이 변경되었습니다." : "적용되었습니다.", "ok");
      socket.emit("admin:getRole");
      socket.emit("friends:list");
      socket.emit("player:getRanking");
      /* 랭킹/리더보드 즉시 갱신 — 이름 변경이 순위표에 바로 반영되도록 */
      loadSideRanking(sideRankMode, true);
    } else if (data.reason) {
      showMessage(data.reason, "error");
      accountMsg(data.reason, "error");
    }
  });

  /* -- 관리자 패널 ------------------------------------- */
  socket.on("admin:role", (data) => {
    if (!data) return;
    myAdminRole = data.role === "super" ? data.role : "none";
    updateAdminVisibility();
    renderAccountInfo();
  });

  socket.on("admin:panel", (data) => {
    if (!data) return;
    /* 전체 패널(role 포함)일 때만 재렌더링 — 적용/비밀번호 변경 같은
       경량 결과로 패널이 초기화되어 반영이 안 보이는 문제 방지 */
    if ("role" in data) {
      renderAdminBody(data);
      /* 패널이 열릴 때 제재 목록도 함께 최신화 */
      socket.emit("admin:moderationList");
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

  /* 감시 중인 닉네임이 로그인하면 최고 관리자에게 실시간 알림 */
  socket.on("admin:loginNotice", (data) => {
    if (!data) return;
    const msg = data.nickname ? `🔔 감시 중인 '${data.nickname}' 님이 로그인했습니다.` : "로그인 알림이 도착했습니다.";
    if (myAdminRole === "super") {
      showMessage(msg, "info");
      if (adminModalOpen) setAdminStatus(msg, "ok");
    }
  });

  socket.on("admin:words", (data) => {
    if (!data) return;
    if (data.ok) {
      renderAdminWords(data);
      if (data.message) setAdminStatus(data.message, "ok");
    } else {
      setAdminStatus(data.reason || "커스텀 사전을 불러오지 못했습니다.", "error");
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
    setPracticeBar(!!(data.state && data.state.practice));
    updateChatScopeLabel();
    renderGameState(gameState);
    /* 싱글(AI) 방은 재접속 유예 대상이 아니므로 기록하지 않는다 */
    if (data.state && data.state.mode !== "ai") storeLastRoomId(data.roomId);
    if (currentMode === "online") {
      showMessage(`방이 생성되었습니다. 방 코드: ${data.roomId}`, "success");
    }
  });

  socket.on("room:joined", (data) => {
    if (!data.ok) return;
    if (isStaleAIEvent(null, data.state)) return;
    if (data.state && data.state.mode !== "ai") storeLastRoomId(data.roomId);
    /* 새 소켓으로 재접속됨 — 방의 실제 모드에 맞게 탭을 전환한다
       (파티는 별도 탭이 없으므로 온라인 탭으로 복원) */
    if (data.reconnect && data.state && data.state.mode) {
      const rMode = data.state.mode;
      const rTab = rMode === "ai" ? "single" : (rMode === "ranked" ? "ranked" : "online");
      switchToModeTab(rTab, rMode === "ranked");
    }
    roomId = data.roomId;
    playerIndex = data.playerIndex;
    spectating = false;
    /* 방(온라인/랭크)에 들어가면 방 채팅으로, AI 방이면 전체 채팅 유지 */
    if (data.state && data.state.mode !== "ai") {
      clearChat();
      /* 방 이력 복원 — 재접속한 경우에도 남아있던 방 대화를 되살린다 */
      if (socket && socketConnected) socket.emit("chat:history", { roomId: data.roomId });
    }
    gameSessionId++;
    gameState = data.state;
    setPracticeBar(!!(data.state && data.state.practice));
    updateChatScopeLabel();
    renderGameState(gameState);
    if (data.waiting) {
      showMessage("게임이 진행 중입니다. 다음 게임부터 참여합니다.", "info");
    } else {
      showMessage(data.reconnect ? "방에 재접속했습니다." : "방에 입장했습니다.", "success");
    }
  });

  /* 관전 입장 — 플레이어가 아니라 채널만 참가하므로 입력 없이 상태만 받는다 */
  socket.on("room:spectating", (data) => {
    if (!data || !data.ok) return;
    roomId = data.roomId;
    playerIndex = null;
    spectating = true;
    gameSessionId++;
    gameState = data.state;
    const mode = data.state && data.state.mode ? data.state.mode : "online";
    const tabMode = mode === "ai" ? "online" : (mode === "ranked" ? "ranked" : "online");
    switchToModeTab(tabMode, tabMode === "ranked" && !!(data.state && data.state.started));
    if (tabMode === "ranked") {
      $("#rankedLobby")?.classList.toggle("hidden", !!(data.state && data.state.started));
      $("#rankedGame")?.classList.toggle("hidden", !(data.state && data.state.started));
    }
    renderGameState(gameState);
    clearChat(); /* 관전 중에도 스코프는 방 채팅 */
    updateChatScopeLabel();
    if (socket && socketConnected) socket.emit("chat:history", { roomId: data.roomId }); /* 방 이력 복원 */
    showMessage("관전 중입니다 — 이 방의 게임을 구경하고 있습니다.", "info");
    updateInputState();
  });

  socket.on("room:error", (data) => {
    startingGame = false;
    showMessage(data.reason || "방 오류", "error");
    /* 재접속을 시도하다 실패한 경우 저장된 방은 무효 — 다시 시도하지 않는다 */
    if (lastRoomId) {
      clearLastRoomId();
      /* 페이지를 새로 연 상태(싱글 탭)면 대신 싱글 게임을 이어준다 */
      if (currentMode === "single" && !gameState) setTimeout(startSingleGame, 200);
    }
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
    if (data.registered === false) { friendRequests = []; renderFriends(); return; }
    if (Array.isArray(data.friends)) friends = data.friends;
    if (Array.isArray(data.requests)) friendRequests = data.requests;
    const badge = $("#friendsReqBadge");
    if (badge) badge.classList.toggle("hidden", friendRequests.length === 0);
    renderFriends();
    if (data.reason) showMessage(data.reason, data.ok ? "success" : "error");
  });

  /* 다른 유저의 개명 알림 — 화면에 떠 있는 옛 이름을 모두 새 이름으로 교체한다.
     (친구 목록·채팅 목록·받은 신청·길드 패널·랭킹이 즉시 갱신된다) */
  socket.on("profile:nickChanged", (data) => {
    const oldName = String(data?.old || "");
    const newName = String(data?.new || "");
    if (!oldName || !newName || oldName === newName) return;
    const nk = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
    const oldKey = nk(oldName);

    /* 친구/받은 신청 로컬 목록 */
    let dirty = false;
    for (const f of friends) if (nk(f.nickname) === oldKey) { f.nickname = newName; dirty = true; }
    if (friendRequests.some(n => nk(n) === oldKey)) {
      friendRequests = friendRequests.map(n => (nk(n) === oldKey ? newName : n));
      dirty = true;
    }
    if (dirty) renderFriends();

    /* 채팅 — 이미 화면에 그려진 줄과 캐시(전체 이력)의 옛 이름을 교체 */
    globalChatCache.forEach(m => { if (nk(m.from) === oldKey) m.from = newName; });
    $all(".chat-line").forEach(line => {
      const el = line.querySelector(".chat-line-nick");
      if (el && nk(el.textContent) === oldKey) el.textContent = newName;
    });

    /* 길드 패널/길드 탭이 떠 있으면 최신 구성으로 재조회 */
    const accPanel = $("#accountPanel");
    const accOpen = accPanel && !accPanel.classList.contains("hidden");
    if ((accOpen || currentMode === "guild") && socket && socketConnected) {
      socket.emit("guild:info");
    }
    /* 사이드 랭킹이 떠 있으면 조용히 새로고침 (표시명 반영) */
    const rank = $("#sideRank");
    if (rank && !rank.classList.contains("closed")) loadSideRanking(sideRankMode, true);
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
    setPracticeBar(false);
    updateChatScopeLabel();
    restoreGlobalChat(); /* 방을 나가면 전체 채팅으로 — 캐시+이력 복원 */
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

  /* -- 방 목록 브라우저 -------------------------------- */
  socket.on("room:list", (data) => {
    if (!data) return;
    if (!data.ok) { roomListStatus(data.reason || "방 목록을 불러오지 못했습니다.", "error"); return; }
    roomListRooms = Array.isArray(data.rooms) ? data.rooms : [];
    renderRoomList();
  });

  /* -- 업적 ------------------------------------------------ */
  socket.on("achievements:list", (data) => renderAchievements(data));
  socket.on("achievements:unlocked", (data) => {
    const list = data && Array.isArray(data.list) ? data.list : [];
    if (!list.length) return;
    if (typeof data.money === "number") { moneyBalance = data.money; renderMoneyBar(); }
    const total = list.reduce((s, d) => s + (Number(d.coin) || 0), 0);
    showMessage(list.length === 1
      ? `업적 달성: ${list[0].name} (+${Number(list[0].coin) || 0}코인)`
      : `업적 ${list.length}개 달성! (+${total}코인)`, "success");
    playSound("win");
    if (currentMode === "achievements") fetchAchievements();
  });

  /* -- 레퍼럴(추천인) ---------------------------------- */
  socket.on("referral:result", (data) => {
    if (!data) return;
    const el = $("#refMsg");
    if (el) {
      el.textContent = data.message || data.reason || "";
      el.classList.toggle("ok", !!data.ok);
    }
    if (data.ok) {
      if (typeof data.money === "number") { moneyBalance = data.money; renderMoneyBar(); }
      const apply = $("#refApply");
      if (apply) apply.disabled = true;
      const inp = $("#refNickInput");
      if (inp) { inp.disabled = true; inp.value = ""; }
      const st = $("#refStatus");
      if (st && data.referredBy) st.innerHTML = `추천인 <b>${escapeHtml(String(data.referredBy))}</b> 님 등록 완료 · <b>+${Number(data.coin) || 0}</b>코인 지급!`;
      showMessage(data.message || "추천인이 등록되었습니다.", "success");
    } else {
      showMessage(data.reason || "추천인 등록에 실패했습니다.", "error");
    }
  });
  socket.on("referral:status", (data) => {
    if (!data || !data.ok) return;
    const st = $("#refStatus");
    const apply = $("#refApply");
    const inp = $("#refNickInput");
    if (data.referredBy) {
      if (st) st.innerHTML = `추천인 <b>${escapeHtml(String(data.referredBy))}</b> 님 등록 완료${data.count ? ` · 받은 추천 <b>${data.count}명</b>` : ""}`;
      if (apply) apply.disabled = true;
      if (inp) inp.disabled = true;
      const el = $("#refMsg");
      if (el) { el.textContent = ""; el.classList.remove("ok"); }
    } else {
      if (st) st.innerHTML = `추천인을 등록하면 <b>둘 다 코인</b>을 받아요. (나 +${Number(data.joinCoin) || 3000} · 상대 +${Number(data.inviteCoin) || 5000})`;
      if (apply) apply.disabled = false;
      if (inp) inp.disabled = false;
    }
  });
  socket.on("referral:reward", (data) => {
    if (!data) return;
    if (typeof data.money === "number") { moneyBalance = data.money; renderMoneyBar(); }
    const text = `${data.from || "친구"} 님이 당신을 추천인으로 등록! +${Number(data.coin) || 0}코인 (누적 ${Number(data.count) || 0}회)`;
    showMessage(text, "success");
    chatNotice(text, true);
  });

  /* -- 전체 공지 · 우편(쪽지) --------------------------- */
  socket.on("notice:global", (data) => {
    const text = String(data?.text || "").trim();
    if (!text) return;
    showMessage(text, "info");
    chatNotice(`📢 ${text}`);
  });
  socket.on("admin:noticeResult", (data) => {
    if (!data) return;
    if (data.ok) { setAdminStatus(data.message || "공지를 보냈습니다.", "ok"); showMessage(data.message || "공지를 보냈습니다.", "success"); }
    else { setAdminStatus(data.reason || "공지 전송에 실패했습니다.", "error"); showMessage(data.reason || "공지 전송에 실패했습니다.", "error"); }
  });
  socket.on("admin:mailResult", (data) => {
    if (!data) return;
    if (data.ok) { setAdminStatus(data.message || "쪽지를 보냈습니다.", "ok"); showMessage(data.message || "쪽지를 보냈습니다.", "success"); }
    else { setAdminStatus(data.reason || "쪽지 발송에 실패했습니다.", "error"); showMessage(data.reason || "쪽지 발송에 실패했습니다.", "error"); }
  });
  socket.on("mail:list", (data) => {
    if (!data || !data.ok) return;
    renderMailList(data.mail || [], data.unread || 0);
  });
  socket.on("mail:claim", (data) => {
    if (!data) return;
    if (data.ok) {
      if (typeof data.money === "number") { moneyBalance = data.money; renderMoneyBar(); }
      showMessage(data.message || "쪽지를 수령했습니다.", "success");
      if (socket && socketConnected) socket.emit("mail:list");
    } else {
      showMessage(data.reason || "쪽지를 수령하지 못했습니다.", "error");
    }
  });
  socket.on("mail:new", (data) => {
    const title = String(data?.title || "쪽지");
    const coin = Number(data?.coin) || 0;
    showMessage(`새 쪽지가 도착했습니다: ${title}${coin ? ` (+${coin}코인)` : ""}`, "info");
    const panel = $("#accountPanel");
    if (panel && !panel.classList.contains("hidden")) socket.emit("mail:list");
  });

  /* -- 길드/클랜 ---------------------------------------- */
  socket.on("guild:state", (data) => {
    if (!data) return;
    if (data.ok && typeof data.money === "number") { moneyBalance = data.money; renderMoneyBar(); }
    renderGuildState(data);
    if (data.ok && data.message) showMessage(data.message, "success");
    if (!data.ok && data.reason) showMessage(data.reason, "error");
    /* 멤버 구성이 바뀌면 다른 멤버 화면도 함께 갱신되도록 상태 재요청 유도 */
    if (data.ok && data.message && socket && socketConnected) socket.emit("guild:info");
  });
  socket.on("guild:notice", (data) => {
    const text = String(data?.text || "").trim();
    if (!text) return;
    showMessage(text, "info");
    const panel = $("#accountPanel");
    const accOpen = panel && !panel.classList.contains("hidden");
    if ((accOpen || currentMode === "guild") && socket && socketConnected) socket.emit("guild:info");
  });

  /* -- 커스텀 사전 (단어 신청) — 상점 탭에서만 사용 ------------------------- */
  socket.on("word:requestResult", (data) => {
    if (!data) return;
    if (data.ok) {
      setWordReqStatusFrom("#shopWordReqStatus", data.message || "신청이 접수되었습니다.", "ok");
    } else {
      setWordReqStatusFrom("#shopWordReqStatus", data.reason || "신청에 실패했습니다.", "error");
    }
    fetchWordList();
  });

  socket.on("word:listResult", (data) => {
    if (!data) return;
    renderWordList(data);
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
      const pl = gameState?.players?.find(p => p.playerIndex === data.player);
      const plName = pl
        ? `${pl.title ? `[${escapeHtml(String(pl.title))}]` : ""}${(pl.isAdmin && pl.title !== "관리자") ? "[관리자]" : ""}${data.nickname}`
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

    /* 파티(2v2)는 팀 단위 승패 — 같은 팀이면 승리/패배 메시지를 함께 받는다 */
    const statePlayers = (data.state && Array.isArray(data.state.players)) ? data.state.players : null;
    const isPractice = !!(data.state && data.state.practice);
    const myStateP = statePlayers ? statePlayers.find(p => p.playerIndex === playerIndex) : null;
    const winnerStateP = (statePlayers && data.winner != null) ? statePlayers.find(p => p.playerIndex === data.winner) : null;
    const loserStateP = (statePlayers && data.loser != null) ? statePlayers.find(p => p.playerIndex === data.loser) : null;
    const sameTeam = (other) => !!other && myStateP && other.team != null && myStateP.team != null && other.team === myStateP.team;
    const iWon = data.winner !== null && (data.winner === playerIndex || sameTeam(winnerStateP));
    const iLost = data.loser !== null && (data.loser === playerIndex || sameTeam(loserStateP));

    if (iWon) {
      showMessage(myStateP && myStateP.team != null ? "소속 팀이 승리했습니다!" : "게임에서 승리했습니다!", "win");
      playSound("win");
      if (currentMode === "single" && !isPractice) {
        localStats.wins++;
        localStats.games++;
        localStats.totalLength += (gameState?.history?.length || 0);
        saveStats();
        updateStatsUI();
      }
    } else if (iLost) {
      showMessage(myStateP && myStateP.team != null ? "소속 팀이 패배했습니다." : "게임에서 패배했습니다.", "lose");
      playSound("lose");
      if (currentMode === "single" && !isPractice) {
        localStats.losses++;
        localStats.games++;
        localStats.totalLength += (gameState?.history?.length || 0);
        saveStats();
        updateStatsUI();
      }
    } else if (data.winner === null && data.loser === null) {
      showMessage("무승부입니다 — 공동 탈락!", "info");
      playSound("draw");
      if (currentMode === "single" && !isPractice) {
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
    showReplay(data);
    if (!isPractice) {
      socket.emit("player:getRanking");
      socket.emit("missions:status");
    } else {
      onPracticeGameFinished(data);
    }

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
      const titleHtml = `${p.title ? `<span class="player-title">[${escapeHtml(String(p.title))}]</span> ` : ""}${(p.isAdmin && p.title !== "관리자") ? `<span class="player-title">[관리자]</span> ` : ""}`;
      const teamHtml = (p.team === 0 || p.team === 1) ? `<span class="team-chip team-${p.team}">${p.team === 0 ? "A" : "B"}팀</span> ` : "";
      row.innerHTML = `${teamHtml}${titleHtml}${escapeHtml(String(p.nickname || "플레이어"))} — ${p.waiting ? "-" : hearts}${mistakesText} — ${status}${ratingTag}`;

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
    return pl ? `${pl.title ? `<span class="player-title">[${escapeHtml(String(pl.title))}]</span> ` : ""}${(pl.isAdmin && pl.title !== "관리자") ? `<span class="player-title">[관리자]</span> ` : ""}` : "";
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
      row.innerHTML = `시작: <span class="history-word" data-def-word="${escapeHtml(item.word)}" title="클릭하면 뜻 보기">${escapeHtml(item.word)}</span>${depth}`;
    } else {
      row.innerHTML = `${item.turn}. ${titleHtmlFor(item.player)}${escapeHtml(item.nickname || "플레이어")}: <span class="history-word" data-def-word="${escapeHtml(item.word)}" title="클릭하면 뜻 보기">${escapeHtml(item.word)}</span>${depth}`;
    }
    container.appendChild(row);
  }
  container.querySelectorAll("[data-def-word]").forEach(w => {
    w.addEventListener("click", () => showWordDefinition(w.dataset.defWord));
  });
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

  el.innerHTML = `
    <div class="room-header">
      <div>${isRanked ? "🎮" : "방 코드: "}<strong>${isRanked ? "랭크 매칭" : `<span class="room-code" title="클릭하면 복사됩니다">${state.roomId}</span>`}</strong></div>
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

  const showSpec = (spectating && gameState?.started && !gameState?.finished)
    || (amEliminated && gameState?.started && !gameState?.finished);
  const specText = spectating ? "관전 모드 — 이 방의 게임을 구경 중입니다" : "관전 모드 — 탈락했습니다";
  for (const sel of ["#spectatorNotice", "#spectatorNoticeRanked"]) {
    const specNotice = $(sel);
    if (specNotice) {
      specNotice.classList.toggle("hidden", !showSpec);
      specNotice.textContent = specText;
    }
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

  /* 끊겼던 온라인/랭크 게임으로 복귀 대기 중이면 싱글을 자동으로 시작하지 않는다 */
  if (lastRoomId && myNickname) {
    showMessage("이전 게임에 복귀하는 중입니다...", "waiting");
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
  closeRoomList();
  socket.emit("room:join", { roomId: code, nickname: makeNickname() });
  showMessage("방에 입장하는 중...", "waiting");
}

/* -- 방 목록 브라우저 ----------------------------------- */
let roomListRooms = [];
let roomListTimer = null;

function openRoomList() {
  const panel = $("#roomListPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  if (roomListTimer) clearInterval(roomListTimer);
  roomListTimer = setInterval(fetchRoomList, 10000);
  fetchRoomList();
}

function closeRoomList() {
  const panel = $("#roomListPanel");
  if (panel) panel.classList.add("hidden");
  if (roomListTimer) { clearInterval(roomListTimer); roomListTimer = null; }
}

function fetchRoomList() {
  if (!socket || !socketConnected) return;
  socket.emit("room:list");
}

function roomListStatus(text, type) {
  const body = $("#roomListBody");
  if (!body) return;
  body.innerHTML = `<div class="room-list-status ${type}">${escapeHtml(text)}</div>`;
}

function renderRoomList() {
  const body = $("#roomListBody");
  if (!body) return;
  const rooms = roomListRooms.filter(r => r && r.roomId !== roomId);
  if (rooms.length === 0) {
    body.innerHTML = `<div class="room-list-status">현재 열린 방이 없습니다. 방을 만들면 여기에 표시됩니다.</div>`;
    return;
  }
  const rows = rooms.map(r => `
    <button class="room-list-row" data-id="${escapeHtml(String(r.roomId))}">
      <span class="rl-code">${escapeHtml(String(r.roomId))}</span>
      <span class="rl-host">${escapeHtml(String(r.host || "플레이어"))}</span>
      <span class="rl-count">${Number(r.playerCount) || 0}/${Number(r.maxPlayers) || 0}</span>
      <span class="rl-status">${r.started ? "진행 중" : "대기 중"}</span>
      <span class="rl-watch" data-watch="${escapeHtml(String(r.roomId))}" title="구경만 하기">관전</span>
      <span class="rl-join">입장 →</span>
    </button>`).join("");
  body.innerHTML = rows;
  body.querySelectorAll(".room-list-row").forEach(row => {
    row.addEventListener("click", (e) => {
      const watch = e.target.closest ? e.target.closest("[data-watch]") : null;
      if (watch) {
        e.stopPropagation();
        if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
        closeRoomList();
        socket.emit("room:spectate", { roomId: watch.dataset.watch });
        showMessage("관전으로 입장하는 중...", "waiting");
        return;
      }
      joinRoomFromList(row.dataset.id);
    });
  });
}

function joinRoomFromList(roomIdToJoin) {
  if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
  if (!requireNickname()) return;
  closeRoomList();
  socket.emit("room:join", { roomId: roomIdToJoin, nickname: makeNickname() });
  showMessage("방에 입장하는 중...", "waiting");
}

function randomJoinRoom() {
  if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
  if (!requireNickname()) return;
  const rooms = roomListRooms.filter(r => r && r.roomId !== roomId);
  if (rooms.length === 0) { roomListStatus("입장할 수 있는 방이 없습니다.", "error"); return; }
  joinRoomFromList(rooms[Math.floor(Math.random() * rooms.length)].roomId);
}

/* -- 업적 렌더링 ------------------------------------------ */
function fetchAchievements() {
  if (socket && socketConnected) socket.emit("achievements:list");
}

function renderAchievements(data) {
  const grid = $("#achGrid");
  const sum = $("#achSummary");
  if (!grid) return;
  if (!data || !data.ok) {
    grid.innerHTML = `<div class="room-list-status error">${escapeHtml((data && data.reason) || "업적을 불러오지 못했습니다.")}</div>`;
    return;
  }
  const list = Array.isArray(data.list) ? data.list : [];
  const done = list.filter(d => d && d.unlockedAt).length;
  if (sum) sum.textContent = `해금 ${done}/${list.length}`;
  if (list.length === 0) {
    grid.innerHTML = `<div class="room-list-status">등록된 업적이 없습니다.</div>`;
    return;
  }
  grid.innerHTML = list.map(d => {
    const on = !!d.unlockedAt;
    let when = "미해금";
    if (on) {
      const t = new Date(d.unlockedAt);
      when = Number.isNaN(t.getTime()) ? "해금됨" : `${t.toLocaleDateString("ko-KR")} 해금`;
    }
    return `<div class="ach-card${on ? " unlocked" : ""}">
      <div class="ach-top">
        <span class="ach-name">${escapeHtml(String(d.name || ""))}</span>
        <span class="ach-coin">${on ? "✓ 해금" : `+${Number(d.coin) || 0}코인`}</span>
      </div>
      <div class="ach-desc">${escapeHtml(String(d.desc || ""))}</div>
      <div class="ach-when">${when}</div>
    </div>`;
  }).join("");
}

/* -- 커스텀 사전 (단어 신청) --------------------------- */
function fetchWordList() {
  if (!socket || !socketConnected) return;
  socket.emit("word:list", { nickname: myNickname || undefined });
}

function setWordReqStatusFrom(statusSel, text, type) {
  const el = $(statusSel);
  if (!el) return;
  el.innerHTML = `<div class="room-list-status ${type === "ok" ? "" : type === "error" ? "error" : ""}">${escapeHtml(text)}</div>`;
}

function submitWordRequestFrom(inputSel, statusSel) {
  if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
  if (!requireNickname()) return;
  const input = $(inputSel);
  if (!input) return;
  const word = normalizeWord(input.value);
  if (!word) { setWordReqStatusFrom(statusSel, "신청할 단어를 입력해주세요.", "error"); return; }
  socket.emit("word:request", { word });
  setWordReqStatusFrom(statusSel, "신청 중...", "");
  input.value = "";
}

function wordListMarkup(data) {
  const pending = Array.isArray(data.pending) ? data.pending : [];
  const rejected = Array.isArray(data.rejected) ? data.rejected : [];
  const total = Number(data.approvedTotal) || 0;

  let html = "";
  if (pending.length === 0 && rejected.length === 0) {
    html = `<div class="room-list-status">아직 신청 내역이 없습니다.</div>`;
  } else {
    const items = [
      ...pending.map(p => ({ text: p.word, cls: "word-pending", label: "대기 중" })),
      ...rejected.map(r => ({ text: r.word, cls: "word-rejected", label: `거절 ${r.reason ? "· " + r.reason : ""}` }))
    ];
    html = `<div class="word-my-head">내 신청 내역</div>` +
      items.map(it => `<div class="word-my-row ${it.cls}"><span class="word-my-word">${escapeHtml(it.text)}</span><span class="word-my-label">${escapeHtml(it.label)}</span></div>`).join("");
  }
  html += `<div class="room-list-status">🏆 승인된 커스텀 단어: <b>${total}</b>개</div>`;
  return html;
}

function renderWordList(data) {
  const markup = wordListMarkup(data);
  const shop = $("#shopWordReqMyList");
  if (shop) shop.innerHTML = markup;
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
  clearLastRoomId();
  if (!socket || !socketConnected) return;
  socket.emit("room:leave");
  roomId = null;
  playerIndex = null;
  spectating = false;
  gameState = null;
  rankedMatchInfo = null;
  localUsedWords.clear();
  startingGame = false;
  setPracticeBar(false);
  updateChatScopeLabel();
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
  rankedInvitePending = false;
  hideRankedInviteBar();
  updateRankedInviteUI();
  showRankedRematchBar(false, false);
  $("#rankedGame")?.classList.add("hidden");
  $("#rankedLobby")?.classList.remove("hidden");
  updateRankedQueueUI();
  renderRankedStreakChip();
  refreshSeasonBar();
}

/* 시즌제 랭킹 — 현재 시즌/종료까지 남은 기간/지난 시즌 1위/보상 정보를 표시 */
async function refreshSeasonBar() {
  const bars = [$("#rankedSeasonBar"), $("#seasonPanelBar")].filter(Boolean);
  if (bars.length === 0) return;
  try {
    const info = await (await fetch(`/api/season`)).json();
    if (!info || info.ok === false) throw new Error("bad payload");
    const reward = (info.rewards || []).map(r => `<span class="season-reward-item"><b>${escapeHtml(r.rank)}</b> ${escapeHtml(r.value)}</span>`).join("");
    const html = `<div class="season-bar">
        <div class="season-bar-top">
          <b>시즌 ${escapeHtml(info.key)}</b>
          <span>· 종료까지 <b>${Number(info.daysLeft || 0)}일</b></span>
        </div>
        <div class="season-bar-prev">${info.previous ? `🏆 지난 시즌(${escapeHtml(info.previous.season)}) 1위 <b>${escapeHtml(info.previous.champion)}</b>` : "아직 종료된 시즌이 없습니다."}</div>
        <div class="season-bar-reward">${reward}</div>
      </div>`;
    bars.forEach(b => { b.innerHTML = html; b.classList.remove("hidden"); });
  } catch (err) {
    bars.forEach(b => b.classList.add("hidden"));
  }
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

/* 랭크 대결 초대(2인전) — 수신 바 숨기기 및 초대 상태 갱신 */
function hideRankedInviteBar() {
  rankedInviteIncoming = null;
  $("#rankedInviteWrap")?.classList.add("hidden");
}

function updateRankedInviteUI() {
  const cancel = $("#rankedInviteCancelBtn");
  if (cancel) cancel.classList.toggle("hidden", !rankedInvitePending);
}

function sendRankedInvite() {
  if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
  if (!isLoggedIn()) {
    showMessage("랭킹은 Google 로그인 후 이용할 수 있습니다.", "error");
    openAccountPanel(true);
    return;
  }
  if (!requireNickname()) return;
  if (rankedQueued) { showMessage("매칭 대기 중에는 초대를 보낼 수 없습니다. 매칭을 먼저 취소해주세요.", "warning"); return; }
  const input = $("#rankedInviteInput");
  if (!input) return;
  const nick = normalizeWord(input.value);
  if (!nick) { showMessage("초대할 닉네임을 입력해주세요.", "error"); return; }
  socket.emit("ranked:invite", { nickname: nick });
}

function cancelRankedInvite() {
  if (!socket || !socketConnected) return;
  socket.emit("ranked:inviteCancel");
}

function acceptRankedInvite() {
  if (!socket || !socketConnected) return;
  if (!isLoggedIn()) {
    showMessage("랭킹은 Google 로그인 후 이용할 수 있습니다.", "error");
    openAccountPanel(true);
    return;
  }
  hideRankedInviteBar();
  socket.emit("ranked:inviteAccept");
}

function rejectRankedInvite() {
  if (!socket || !socketConnected) return;
  hideRankedInviteBar();
  socket.emit("ranked:inviteReject");
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
  const shopMoney = $("#shopMoney");
  if (shopMoney) shopMoney.textContent = moneyBalance.toLocaleString();
  setText(["#accMoney"], moneyBalance.toLocaleString());
  const bar = $(".money-bar");
  if (bar) bar.classList.toggle("hidden", false);
  const boostChip = $("#boostChip");
  if (boostChip) {
    boostChip.classList.toggle("hidden", ratingBoostGames <= 0);
    setText(["#boostCount"], ratingBoostGames);
  }
}

function renderAccountScoresStatic() {
  setText(["#accMoney"], moneyBalance.toLocaleString());
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
  const shopMoney = $("#shopMoney");
  if (shopMoney) shopMoney.textContent = moneyBalance.toLocaleString();
  const mkRow = (label, desc, btnId, btnLabel, btnStyle, price) => {
    const disabled = typeof price === "number" && moneyBalance < price ? " disabled" : "";
    return `<div class="shop-item">
      <div><strong>${escapeHtml(label)}</strong><div class="shop-item-desc">${escapeHtml(desc)}</div></div>
      <button class="shop-buy${btnStyle ? " " + btnStyle : ""}" id="${btnId}"${disabled}>${btnLabel}</button>
    </div>`;
  };

  let html = `<div class="shop-sub">칭호 구매</div>`;
  html += shopInfo.titleCatalog.map(t => {
    const owned = ownedTitles.some(o => o.id === t.id);
    if (owned) return mkRow(t.name, `보유 중 · ${t.price.toLocaleString()}원`, "", "보유 중", "owned", t.price);
    return mkRow(t.name, `${t.price.toLocaleString()}원`, "buyTitle:" + t.id, "구매", "", t.price);
  }).join("");
  html += `<div class="shop-sub">물약</div>`;
  html += mkRow("레이팅 2배 물약", "구매 시 다음 랭크 10판에 자동 적용", "buyPotion", "구매 · 1,000,000원", "", shopInfo.potionPrice);

  html += `<div class="shop-sub">아이템</div>`;
  const shieldCount = Number(shopInfo.shieldTickets) || 0;
  html += mkRow("랭크 보호 티켓", `랭크 패배 1회 방어 (레이팅 감소 막음) · 보유 ${shieldCount}장`, "buyShield", `구매 · ${(shopInfo.shieldPrice || 2000000).toLocaleString()}원`, "", shopInfo.shieldPrice || 2000000);

  html += `<div class="shop-sub">영구 배율</div>`;
  for (const m of shopInfo.multiplierPrices) {
    const owned = moneyMultiplier >= m.multiplier;
    const label = `${m.multiplier}배 돈`;
    const desc = owned ? `보유 중 (현재 ${moneyMultiplier}배)` : `${m.price.toLocaleString()}원`;
    if (owned) html += mkRow(label, desc, "", "보유 중", "owned", m.price);
    else html += mkRow(label, desc, "buyMultiplier:" + m.multiplier, `구매 · ${m.price.toLocaleString()}원`, "", m.price);
  }
  body.innerHTML = html;

  body.querySelectorAll("[id^='buyTitle:'],[id^='buyPotion'],[id^='buyShield'],[id^='buyMultiplier']").forEach(btn => {
    btn.addEventListener("click", () => {
      const [kind, val] = btn.id.split(":");
      if (kind === "buyTitle") socket.emit("shop:buyTitle", { titleId: val });
      else if (kind === "buyPotion") socket.emit("shop:buyPotion");
      else if (kind === "buyShield") socket.emit("shop:buyShield");
      else if (kind === "buyMultiplier") socket.emit("shop:buyMultiplier", { multiplier: Number(val) });
    });
  });
  renderItems();
}

/* ---------------------------------------------------------
   칭호·아이템 패널 — 칭호 장착/해제, 물약 현황, 최근 전적
--------------------------------------------------------- */
function renderItems() {
  const titleEl = $("#itemsCurrentTitle");
  const listEl = $("#itemsTitleList");
  if (titleEl) titleEl.textContent = currentTitle || "없음";
  if (listEl) {
    const isAdmin = !!(shopInfo && shopInfo.isAdmin);
    const entries = [];
    if (isAdmin) entries.push({ id: "t_admin", name: "관리자" });
    for (const t of ownedTitles) entries.push(t);
    if (entries.length === 0) {
      listEl.innerHTML = `<div class="items-empty">보유한 칭호가 없습니다. 상점에서 구매하세요.</div>`;
    } else {
      let html = entries.map(t => {
        const isCur = currentTitle === t.name;
        return `<button type="button" class="items-title-chip${isCur ? " current" : ""}" data-item-title="${escapeHtml(t.id)}">${isCur ? "장착 중 · " : ""}${escapeHtml(t.name)}</button>`;
      }).join("");
      if (currentTitle) html += `<button type="button" class="items-title-chip items-unset" data-item-unset="1">칭호 해제</button>`;
      listEl.innerHTML = html;
      listEl.querySelectorAll("[data-item-title]").forEach(btn => {
        btn.addEventListener("click", () => {
          if (btn.classList.contains("current")) return;
          if (socket && socketConnected) socket.emit("shop:setTitle", { titleId: btn.dataset.itemTitle });
        });
      });
      listEl.querySelector("[data-item-unset]")?.addEventListener("click", () => {
        if (socket && socketConnected) socket.emit("shop:unsetTitle");
      });
    }
  }
  const potionEl = $("#itemsPotionStatus");
  if (potionEl) {
    potionEl.innerHTML = ratingBoostGames > 0
      ? `<b>사용 중</b> — 다음 <b>${ratingBoostGames}</b>판 적용`
      : `<span class="items-potion-off">미사용</span>`;
  }
  const shieldEl = $("#itemsShieldStatus");
  if (shieldEl) {
    const sc = Number(shopInfo && shopInfo.shieldTickets) || 0;
    shieldEl.innerHTML = sc > 0
      ? `<b>${sc}장 보유</b> — 랭크 패배 시 자동 사용`
      : `<span class="items-potion-off">보유 없음 (상점에서 구매)</span>`;
  }
  renderRatingChart();
  renderRecentGames();
}

/* ---------------------------------------------------------
   미션 패널 (일일/주간/월간)
--------------------------------------------------------- */
function applyRankingToMissions(payload) {
  const scopeMap = { daily: "daily", weekly: "weekly", monthly: "monthly" };
  let touched = false;
  ["daily", "weekly", "monthly"].forEach(g => {
    const raw = payload[scopeMap[g]];
    if (!raw || !Array.isArray(missionsGroups[g]) || missionsGroups[g].length === 0) return;
    missionsGroups[g].forEach(m => {
      const cur = m.id === "rankedWins" ? (raw.rankedWins || 0) : (m.id === "oneShots" ? (raw.oneShots || 0) : (raw.streakDone || 0));
      m.current = Math.min(m.target, cur);
      m.claimed = Array.isArray(raw.claimed) && raw.claimed.includes(m.id) ? true : !!m.claimed;
    });
    touched = true;
  });
  return touched;
}

function rewardLabel(m) {
  const parts = [];
  if (m.coin) parts.push(`${m.coin.toLocaleString()}원`);
  if (m.title) parts.push(`칭호 '${m.title.name}'`);
  return parts.length ? parts.join(" + ") : "보상 없음";
}

function missionGroupInfo(g) {
  const map = {
    daily: { listSel: "#missionListDaily", periodSel: "#missionPeriodDaily", name: "일일 미션" },
    weekly: { listSel: "#missionListWeekly", periodSel: "#missionPeriodWeekly", name: "주간 미션" },
    monthly: { listSel: "#missionListMonthly", periodSel: "#missionPeriodMonthly", name: "월간 미션" }
  };
  return map[g] || map.daily;
}

function renderMissionGroup(g) {
  const info = missionGroupInfo(g);
  const list = $(info.listSel);
  if (!list) return;
  const missions = Array.isArray(missionsGroups[g]) ? missionsGroups[g] : [];
  const periodEl = $(info.periodSel);
  if (periodEl) {
    const key = missionPeriods[g];
    const range = g === "daily" ? key : (missionPeriods[g + "Range"] || key);
    if (range) periodEl.textContent = `(${String(range)})`;
  }
  if (missions.length === 0) {
    list.innerHTML = `<div class="missions-empty">미션 정보를 불러오는 중...</div>`;
    return;
  }
  list.innerHTML = missions.map(m => {
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
        ${claimed ? "" : (done ? `<button type="button" class="mission-claim" data-group="${g}" data-mission-claim="${m.id}">받기</button>` : "")}
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-mission-claim]").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group || "daily";
      const id = btn.dataset.missionClaim;
      if (socket && socketConnected) socket.emit("missions:claim", { group, id });
    });
  });
}

function renderMissions() {
  ["daily", "weekly", "monthly"].forEach(renderMissionGroup);
  const mini = $("#missionMiniCount");
  let total = 0, done = 0;
  ["daily", "weekly", "monthly"].forEach(g => {
    const arr = Array.isArray(missionsGroups[g]) ? missionsGroups[g] : [];
    total += arr.length;
    done += arr.filter(m => m.current >= m.target).length;
  });
  const miniBtn = $("#missionBtn");
  if (total === 0) {
    if (miniBtn) miniBtn.classList.add("hidden");
    if (mini) mini.textContent = "0/0";
    return;
  }
  if (miniBtn) miniBtn.classList.remove("hidden");
  if (mini) mini.textContent = `${done}/${total}`;
}

/* ---------------------------------------------------------
   최근 10판 전적 패널
--------------------------------------------------------- */
function renderRecentGames() {
  const list = $("#recentGamesList");
  if (!list) return;
  if (!Array.isArray(recentGamesState) || recentGamesState.length === 0) { list.innerHTML = `<div class="items-empty">아직 기록이 없습니다.</div>`; return; }
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

/* 제재 목록(밴/뮤트) 렌더 — 패널 전체를 지우지 않고 목록 영역만 갱신 */
function renderAdminModeration(data) {
  if (!data.ok) { setAdminStatus(data.reason || "제재 목록을 불러오지 못했습니다.", "error"); return; }
  const fill = (listId, countId, items, kind) => {
    const ul = document.getElementById(listId);
    const cnt = document.getElementById(countId);
    if (cnt) cnt.textContent = `(${(items || []).length}명)`;
    if (!ul) return;
    if (!items || items.length === 0) {
      ul.innerHTML = `<li class="admin-info">해당 제재가 없습니다.</li>`;
      return;
    }
    ul.innerHTML = items.map(it => `
      <li class="admin-sub-row">
        <span class="admin-mod-nick">${escapeHtml(it.nick)}</span>
        <span class="admin-mod-meta">${escapeHtml(it.reason || "사유 없음")}</span>
        <span class="admin-mod-when">${escapeHtml(String(it.at || "").slice(0, 10))}</span>
        <button type="button" class="admin-apply" data-mod-del="${kind}" data-mod-nick="${escapeHtml(it.nick)}">해제</button>
      </li>`).join("");
    ul.querySelectorAll("[data-mod-del]").forEach(btn => {
      btn.addEventListener("click", () => {
        const nick = btn.dataset.modNick;
        socket.emit(btn.dataset.modDel === "banned" ? "admin:unban" : "admin:unmute", { nickname: nick });
      });
    });
  };
  fill("adminBanList", "adminBanCount", data.banned, "banned");
  fill("adminMuteList", "adminMuteCount", data.muted, "muted");
  if (data.message) setAdminStatus(data.message, "ok");
}

/* ---------------------------------------------------------
   실시간 채팅 UI (방 단위)
--------------------------------------------------------- */
let chatUnread = 0;
let chatNoticeTimer = null;

function renderChatUnread() {
  const badge = $("#chatUnread");
  if (!badge) return;
  if (chatUnread > 0) {
    badge.textContent = chatUnread > 99 ? "99+" : String(chatUnread);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

/* 로그인 여부 — firebase-auth.js의 kk-auth 이벤트로 갱신된다 (서버가 최종 게이트) */
function isLoggedIn() { return window.kkLoggedIn === true; }

/* 채팅 스코프 — 방(온라인/파티/랭크)이 아니면 전체 채팅 (서버와 동일 규칙) */
function chatScopeNow() {
  const mode = gameState && gameState.mode;
  return (roomId && mode && mode !== "ai") ? "room" : "global";
}

function updateChatScopeLabel() {
  const title = $("#chatTitle");
  if (title) title.textContent = chatScopeNow() === "room" ? "💬 방 채팅" : "💬 전체 채팅";
  const btn = $("#chatBtn");
  if (btn) btn.title = chatScopeNow() === "room" ? "방 채팅 열기" : "전체 채팅 열기";
}

/* 채팅은 누구나 볼 수 있다 — 쓰기·신고만 로그인(서버가 게이트).
   전체 채팅은 클라이언트 캐시를 유지해 방 이동·새로고침에도 목록이 사라지지 않는다. */
let globalChatCache = [];

function updateChatVisibility() {
  const wrap = $("#chatWrap");
  /* 계정 패널이 열려 있으면 채팅을 숨겨 가림을 피한다 */
  if (wrap) wrap.classList.toggle("hidden", accountPanelOpen);
  updateChatScopeLabel();
  const inp = $("#chatInput");
  if (inp) {
    inp.disabled = !isLoggedIn();
    inp.placeholder = isLoggedIn() ? "메시지 입력" : "Google 로그인 후 채팅할 수 있어요";
  }
}

/* 전체 스코프로 돌아올 때 — 캐시에서 목록을 되살리고 서버 이력도 다시 받는다 */
function restoreGlobalChat() {
  clearChat();
  globalChatCache.forEach(m => appendChatLine(m, { silent: true }));
  if (socket && socketConnected) socket.emit("chat:history");
}

/* 튜토리얼 실습 배너 — 실습 게임이 진행 중임을 알린다 */
let practiceGameActive = false;
function setPracticeBar(on) {
  practiceGameActive = !!on;
  const bar = $("#practiceBar");
  if (bar) bar.classList.toggle("hidden", !on);
}

function appendChatLine(data, opts) {
  const list = $("#chatList");
  if (!list || !data) return;
  const empty = list.querySelector(".chat-empty");
  if (empty) empty.remove();

  const line = document.createElement("div");
  line.className = "chat-line" + (data.from && data.from === myNickname ? " self" : "");

  if (data.scope) {
    const scope = document.createElement("span");
    scope.className = `chat-scope-tag ${data.scope}`;
    scope.textContent = data.scope === "room" ? "방" : "전체";
    line.append(scope);
  }

  const nick = document.createElement("span");
  nick.className = "chat-line-nick";
  nick.textContent = data.from || "??";

  const text = document.createElement("span");
  text.className = "chat-line-text";
  text.textContent = data.text || "";

  /* @내이름 멘션 — 줄을 강조하고 알림음을 울린다 (자기 자신이 쓴 글은 제외) */
  const mention = myNickname && data.from !== myNickname && (data.text || "").includes(`@${myNickname}`);
  if (mention) {
    line.classList.add("mention");
    if (!opts || !opts.silent) { playSound("word"); vibrate([30, 20, 30]); }
  }

  const flag = document.createElement("button");
  flag.type = "button";
  flag.className = "chat-flag";
  flag.title = "이 메시지 신고";
  flag.textContent = "🚩";
  flag.addEventListener("click", () => {
    const target = data.from || "";
    if (!target) return;
    if (!window.confirm(`'${target}' 님의 메시지를 신고하시겠습니까?`)) return;
    socket.emit("chat:report", { nickname: target, text: data.text });
  });

  line.append(nick, text, flag);
  list.appendChild(line);
  while (list.children.length > 100) list.removeChild(list.firstChild);

  const panel = $("#chatPanel");
  const opened = panel && !panel.classList.contains("hidden");
  if (opened) list.scrollTop = list.scrollHeight;
  else if (!opts || !opts.silent) { chatUnread += 1; renderChatUnread(); }
}

function chatNotice(text, ok) {
  const el = $("#chatMsg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("ok", !!ok);
  el.classList.remove("hidden");
  if (chatNoticeTimer) clearTimeout(chatNoticeTimer);
  chatNoticeTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

function clearChat() {
  const list = $("#chatList");
  if (list) {
    list.innerHTML = `<div class="chat-empty">아직 메시지가 없습니다.<br>${chatScopeNow() === "room" ? "방에 들어와 있으면 채팅할 수 있어요." : "로그인하면 전체 채팅에 참여할 수 있어요."}</div>`;
  }
  chatUnread = 0;
  renderChatUnread();
}

/* ---------------------------------------------------------
   관리자 패널 (서버 검증 Google 관리자 계정에만 보이는 버튼)
--------------------------------------------------------- */
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

  const isSuper = true;
  const role = "super";
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

  /* 감시 닉네임 — 등록된 닉이 로그인하면 최고 관리자에게 알림 */
  const watchItems = (data.watchlist || []).map(n => `
    <li class="admin-sub-row">
      <span>${escapeHtml(n)}</span>
      <button type="button" class="admin-apply" data-admin-watch-del="${escapeHtml(n)}">제거</button>
    </li>
  `).join("");
  const watchCard = isSuper ? `
    <div class="admin-card">
      <h4>로그인 감시 (최고 관리자 전용)</h4>
      <div class="admin-info">등록한 닉네임이 로그인하면 이 패널과 상단 알림으로 즉시 표시됩니다.</div>
      <div class="admin-row">
        <input type="text" id="adminWatchInput" class="admin-text" placeholder="감시할 닉네임" autocomplete="off" data-admin-enter="[data-admin-watch-add]">
        <button type="button" class="admin-apply" data-admin-watch-add="1">추가</button>
      </div>
      <ul class="admin-sub-list">${watchItems || '<li class="admin-info">등록된 감시 대상이 없습니다.</li>'}</ul>
    </div>
  ` : "";

  /* 플레이어 통계 관리 */
  const statsCard = `
    <div class="admin-card">
      <h4>플레이어 통계 관리</h4>
      <div class="admin-row">
        <input type="text" id="adminFindNick" class="admin-text" placeholder="닉네임 검색" autocomplete="off" data-admin-enter="[data-admin-find]">
        <button type="button" class="admin-apply" data-admin-find="1">검색</button>
      </div>
      <div id="adminFound"><div class="admin-info">닉네임을 검색하면 그 유저의 승·패·점수를 관리할 수 있습니다.</div></div>
    </div>
  `;

  const statusLine = `<div class="admin-msg ok">Google 관리자 계정으로 인증되었습니다.</div>`;

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

  /* 관리자: 전체 공지 · 개별 쪽지(우편) */
  const noticeCard = isSuper ? `
    <div class="admin-card">
      <h4>공지 · 우편(쪽지)</h4>
      <div class="admin-info"><b>공지</b>는 접속 중인 모든 유저에게 즉시 뜨고, <b>쪽지</b>는 특정 유저의 쪽지함에 코인과 함께 저장됩니다.</div>
      <div class="admin-row">
        <input type="text" id="adminNoticeText" class="admin-text" maxlength="200" placeholder="전체 공지 내용" autocomplete="off" data-admin-enter="[data-admin-notice]">
        <button type="button" class="admin-apply" data-admin-notice="1">공지 보내기</button>
      </div>
      <div class="admin-info" style="margin-top:8px;">쪽지 보내기 (개별 — 코인 보상 포함 가능)</div>
      <div class="admin-row">
        <input type="text" id="adminMailNick" class="admin-text" maxlength="12" placeholder="받는 닉네임" autocomplete="off">
        <input type="text" id="adminMailTitle" class="admin-text" maxlength="40" placeholder="제목" autocomplete="off">
      </div>
      <div class="admin-row">
        <input type="text" id="adminMailBody" class="admin-text" maxlength="200" placeholder="내용 (선택)" autocomplete="off">
        <input type="number" id="adminMailCoin" class="admin-num" placeholder="코인 (선택)" autocomplete="off" min="0">
        <button type="button" class="admin-apply" id="adminMailSend">쪽지 보내기</button>
      </div>
    </div>
  ` : "";

  /* 관리자: 버그 제보 (최고 관리자 전용) */
  const bugCard = isSuper ? `
    <div class="admin-card">
      <h4>버그 제보 목록 (최고 관리자 전용)</h4>
      <button type="button" class="admin-apply" id="adminBugLoad">버그 제보 불러오기</button>
      <div id="adminBugList"></div>
    </div>
  ` : "";

  /* 관리자: 제재 관리 — 밴/뮤트 (최고 관리자 전용) */
  const modCard = isSuper ? `
    <div class="admin-card">
      <h4>제재 관리 — 차단(밴) / 음소거(뮤트)</h4>
      <div class="admin-info"><b>차단</b>은 로그인·방 참가를 막고 <b>음소거</b>는 채팅 작성을 막습니다.
        온라인 중인 대상은 즉시 퇴장 처리되며, Google 계정 기준으로 닉네임을 바꿔도 계속 차단됩니다.</div>
      <div class="admin-row">
        <input type="text" id="adminModNick" class="admin-text" maxlength="12" placeholder="닉네임" autocomplete="off" data-admin-enter="[data-mod-ban]">
        <input type="text" id="adminModReason" class="admin-text" maxlength="100" placeholder="사유 (선택)" autocomplete="off">
      </div>
      <div class="admin-row">
        <button type="button" class="admin-apply admin-reject" data-mod-ban="1">⛔ 차단</button>
        <button type="button" class="admin-apply admin-reject" data-mod-mute="1">🔇 음소거</button>
        <button type="button" class="admin-apply" id="adminModLoad">목록 불러오기</button>
      </div>
      <div class="admin-danger">
        <div class="admin-info">⚠ <b>계정 삭제</b> — 해당 닉네임의 전적·돈·칭호 등 모든 데이터가 영구 삭제됩니다. (복구 불가)</div>
        <button type="button" class="admin-apply admin-reject" data-mod-delete="1">🗑 계정 전체 삭제</button>
      </div>
      <div class="admin-info" style="margin-top:8px;">⛔ 차단 목록 <span id="adminBanCount"></span></div>
      <ul class="admin-sub-list" id="adminBanList"></ul>
      <div class="admin-info" style="margin-top:8px;">🔇 음소거 목록 <span id="adminMuteCount"></span></div>
      <ul class="admin-sub-list" id="adminMuteList"></ul>
      <div class="admin-info" style="margin-top:12px;">🧹 전체 채팅</div>
      <div class="admin-info">저장된 전체 채팅 이력(DB·파일)을 즉시 비웁니다. 방 채팅은 영향을 받지 않습니다.</div>
      <button type="button" class="admin-apply admin-reject" id="adminChatClear">전체 채팅 이력 비우기</button>
    </div>
  ` : "";

  /* 관리자: 단어 승인 (커스텀 사전) — 최고 관리자 전용 */
  const wordCard = isSuper ? `
    <div class="admin-card">
      <h4>단어 승인 (커스텀 사전)</h4>
      <div class="admin-info">사용자가 신청한 단어를 승인하면 게임 사전에 추가되어 모든 유저가 쓸 수 있습니다.</div>
      <button type="button" class="admin-apply" id="adminWordLoad">대기 목록 불러오기</button>
      <div id="adminWordList"></div>
    </div>
  ` : "";

  body.innerHTML = `
    ${data.message ? `<div class="admin-msg ok">${escapeHtml(data.message)}</div>` : ""}
    ${statusLine}
    <div class="admin-info">시작 음절: <b>${(data.startSyllables || []).join(" ")}</b> &nbsp;·&nbsp; 현재 연결: <b>${escapeHtml(myNickname || "-")}</b></div>
    ${configCard}
    ${dueumCard}
    ${watchCard}
    ${statsCard}
    ${moneyCard}
    ${noticeCard}
    ${wordCard}
    ${bugCard}
    ${modCard}
    <div class="admin-status" id="adminStatus"></div>
  `;
  bindAdminBody();

  const wordLoad = $("#adminWordLoad");
  if (wordLoad) wordLoad.addEventListener("click", () => socket.emit("admin:wordList"));

  const moneyApply = $("#adminMoneyApply");
  if (moneyApply) moneyApply.addEventListener("click", () => {
    const nick = $("#adminMoneyNick")?.value.trim() || "";
    const amount = Number($("#adminMoneyAmount")?.value ?? 0);
    if (!nick) { setAdminStatus("닉네임을 입력해주세요.", "error"); return; }
    socket.emit("admin:setMoney", { nickname: nick, amount });
  });

  /* 전체 공지 · 쪽지 발송 */
  const noticeSend = $("[data-admin-notice]");
  if (noticeSend) noticeSend.addEventListener("click", () => {
    const text = $("#adminNoticeText")?.value.trim() || "";
    if (!text) { setAdminStatus("공지 내용을 입력해주세요.", "error"); return; }
    socket.emit("admin:notice", { text });
  });
  const mailSend = $("#adminMailSend");
  if (mailSend) mailSend.addEventListener("click", () => {
    const nick = $("#adminMailNick")?.value.trim() || "";
    if (!nick) { setAdminStatus("받는 닉네임을 입력해주세요.", "error"); return; }
    socket.emit("admin:mailSend", {
      nickname: nick,
      title: $("#adminMailTitle")?.value.trim() || "",
      body: $("#adminMailBody")?.value.trim() || "",
      coin: Number($("#adminMailCoin")?.value || 0)
    });
  });

  const bugLoad = $("#adminBugLoad");
  if (bugLoad) bugLoad.addEventListener("click", () => socket.emit("admin:getBugs"));

  /* 제재 관리 — 밴/뮤트 실행 및 목록 조회 */
  const modLoad = $("#adminModLoad");
  if (modLoad) modLoad.addEventListener("click", () => socket.emit("admin:moderationList"));
  /* 전체 채팅 이력 비우기 — 확인 후 서버에 요청 */
  const chatClear = $("#adminChatClear");
  if (chatClear) chatClear.addEventListener("click", () => {
    if (!window.confirm("저장된 전체 채팅 이력을 모두 비우시겠습니까?\n(이 작업은 되돌릴 수 없습니다)")) return;
    socket.emit("admin:chatClear");
    setAdminStatus("채팅 이력을 비우는 중...", "");
  });
  const modTarget = () => {
    const nick = modal.querySelector("#adminModNick")?.value.trim() || "";
    if (!nick) { setAdminStatus("제재할 닉네임을 입력해주세요.", "error"); return null; }
    const reason = modal.querySelector("#adminModReason")?.value.trim() || "";
    return { nickname: nick, reason };
  };
  const modBan = modal.querySelector("[data-mod-ban]");
  if (modBan) modBan.addEventListener("click", () => {
    const payload = modTarget();
    if (payload) socket.emit("admin:ban", payload);
  });
  const modMute = modal.querySelector("[data-mod-mute]");
  if (modMute) modMute.addEventListener("click", () => {
    const payload = modTarget();
    if (payload) socket.emit("admin:mute", payload);
  });
  const modDelete = modal.querySelector("[data-mod-delete]");
  if (modDelete) modDelete.addEventListener("click", () => {
    const payload = modTarget();
    if (!payload) return;
    if (!window.confirm(`'${payload.nickname}' 계정을 정말 삭제하시겠습니까?\n\n전적·돈·칭호 등 모든 데이터가 영구 삭제되며 복구할 수 없습니다.`)) return;
    socket.emit("admin:deletePlayer", { nickname: payload.nickname });
  });
}

function renderAdminWords(data) {
  const wrap = $("#adminWordList");
  if (!wrap) return;
  const pending = (data.pending || []);
  const approved = (data.approved || []);
  const rejected = (data.rejected || []);

  let html = `<div class="admin-info">대기 <b>${pending.length}</b> · 승인 <b>${approved.length}</b> · 거절 <b>${rejected.length}</b></div>`;
  if (pending.length === 0) {
    html += `<div class="room-list-status">승인 대기 단어가 없습니다.</div>`;
  } else {
    html += pending.map(p => `
      <div class="admin-word-row">
        <span class="admin-word-text" title="${escapeHtml(p.by || "")}">${escapeHtml(p.word)}</span>
        <input type="text" class="admin-word-reason" maxlength="50" placeholder="거절 사유 (선택)" autocomplete="off" data-word="${escapeHtml(p.word)}">
        <button type="button" class="admin-apply" data-word-approve="${escapeHtml(p.word)}">승인</button>
        <button type="button" class="admin-apply admin-reject" data-word-reject="${escapeHtml(p.word)}">거절</button>
      </div>`).join("");
  }
  if (rejected.length > 0) {
    html += `<div class="admin-info" style="margin-top:10px;">최근 거절: ${rejected.slice(-5).map(r => escapeHtml(r.word)).join(", ")}</div>`;
  }
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-word-approve]").forEach(btn => {
    btn.addEventListener("click", () => socket.emit("admin:wordApprove", { word: btn.dataset.wordApprove }));
  });
  wrap.querySelectorAll("[data-word-reject]").forEach(btn => {
    btn.addEventListener("click", () => {
      const reason = wrap.querySelector(`.admin-word-reason[data-word="${btn.dataset.wordReject}"]`)?.value || "";
      socket.emit("admin:wordReject", { word: btn.dataset.wordReject, reason });
    });
  });
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
  const statsRow = (mode, label, hasRating, winLabel, lossLabel) => {
    const s = p[mode] || {};
    return `
      <div class="admin-stats-mode">
        <div class="admin-stats-title">${label}</div>
        ${hasRating ? `<label class="admin-row"><span>점수</span><input type="number" class="admin-num" data-admin-m="${mode}" data-admin-f="rating" value="${s.rating ?? 0}" min="0" max="9999"></label>` : `<div class="admin-row"><span>점수</span><b>${s.rating ?? 0}</b> <span class="admin-single-hint">(싱글은 점수가 없습니다)</span></div>`}
        <label class="admin-row"><span>${winLabel}</span><input type="number" class="admin-num" data-admin-m="${mode}" data-admin-f="wins" value="${s.wins ?? 0}" min="0"></label>
        <label class="admin-row"><span>${lossLabel}</span><input type="number" class="admin-num" data-admin-m="${mode}" data-admin-f="losses" value="${s.losses ?? 0}" min="0"></label>
        <div class="admin-row"><span></span><button type="button" class="admin-apply" data-admin-stats="${mode}">${label} 통계 적용</button></div>
      </div>`;
  };
  wrap.innerHTML = `
    <div class="admin-found-head">대상: <b>${escapeHtml(p.nickname)}</b></div>
    ${statsRow("single", "싱글 (AI 대전)", false, "승 (AI 격파)", "패 (AI 승)")}
    ${statsRow("multi", "멀티 (온라인)", true, "승 (상대 격파)", "패 (상대 승)")}
    ${statsRow("ranked", "랭크 (랭크 매칭)", true, "승 (상대 격파)", "패 (상대 승)")}
    <div class="admin-info">※ 승·패·점수를 직접 조정합니다. 점수를 바꾸면 티어가 자동으로 다시 계산됩니다. 저장 후 새 게임 결과부터 반영됩니다.</div>
  `;
  wrap.querySelectorAll("[data-admin-stats]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.adminStats;
      const get = (f) => {
        const i = wrap.querySelector(`[data-admin-m="${mode}"][data-admin-f="${f}"]`);
        return Number(i?.value ?? 0);
      };
      socket.emit("admin:setPlayerStats", {
        nickname: adminFoundNick, mode,
        rating: get("rating"), wins: get("wins"), losses: get("losses")
      });
    });
  });
}

function bindAdminBody() {
  const modal = $("#adminModal");
  if (!modal) return;

  const gotoNick = modal.querySelector("[data-admin-goto-nick]");
  if (gotoNick) gotoNick.addEventListener("click", () => { closeAdminPanel(); openAccountPanel(true); setTimeout(() => $("#accNickInput")?.focus(), 60); });

  const foundBtn = modal.querySelector("[data-admin-find]");
  if (foundBtn) foundBtn.addEventListener("click", () => {
    const nick = modal.querySelector("#adminFindNick")?.value.trim() ?? "";
    if (!nick) { setAdminStatus("검색할 닉네임을 입력해주세요.", "error"); return; }
    socket.emit("admin:findPlayer", { nickname: nick });
  });

  /* 감시 목록 — 추가/제거 후 목록 전체를 서버에 저장 */
  const emitWatchlist = (list) => {
    socket.emit("admin:setWatchlist", { watchlist: list });
    setAdminStatus("감시 목록을 저장하는 중...", "");
  };
  const watchAdd = modal.querySelector("[data-admin-watch-add]");
  if (watchAdd) watchAdd.addEventListener("click", () => {
    const input = modal.querySelector("#adminWatchInput");
    const nick = (input?.value || "").trim();
    if (!nick) { setAdminStatus("감시할 닉네임을 입력해주세요.", "error"); return; }
    const cur = Array.from(modal.querySelectorAll("[data-admin-watch-del]")).map(b => b.dataset.adminWatchDel);
    if (cur.includes(nick)) { setAdminStatus(`'${nick}' 닉네임은 이미 감시 목록에 있습니다.`, "error"); return; }
    emitWatchlist([...cur, nick]);
    if (input) input.value = "";
  });
  modal.querySelectorAll("[data-admin-watch-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const cur = Array.from(modal.querySelectorAll("[data-admin-watch-del]")).map(b => b.dataset.adminWatchDel);
      emitWatchlist(cur.filter(n => n !== btn.dataset.adminWatchDel));
    });
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

  modal.querySelectorAll("[data-admin-apply]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.adminApply;
      if (btn.hasAttribute("data-admin-find")) return;
      const input = modal.querySelector(`[data-admin-key="${key}"]`);
      socket.emit("admin:updateConfig", { key, value: Number(input?.value) });
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
  accountPanelOpen = open;
  updateChatVisibility(); /* 계정 패널이 채팅을 가리지 않도록 채팅을 숨겼다/되살린다 */
  if (open) {
    renderAccountInfo(myNickname);
    if (socket && socketConnected) { socket.emit("referral:status"); socket.emit("mail:list"); socket.emit("guild:info"); }
    setTimeout(() => $("#accNickInput")?.focus(), 60);
  }
}

function renderAccountInfo(nick) {
  const input = $("#accNickInput");
  if (input && nick !== undefined) input.value = nick || "";
}

function renderMailList(list, unread) {
  const badge = $("#mailUnread");
  if (badge) {
    badge.textContent = String(unread);
    badge.classList.toggle("hidden", !unread);
  }
  const wrap = $("#mailList");
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = `<div class="acc-referral-status">쪽지가 없습니다.</div>`;
    return;
  }
  wrap.innerHTML = list.map(m => {
    let at = "";
    try {
      const d = new Date(m.at);
      if (!Number.isNaN(d.getTime())) at = d.toLocaleString();
    } catch {}
    return `
    <div class="mail-item${m.read ? " read" : ""}">
      <div class="mail-item-head"><b>${escapeHtml(String(m.title || "쪽지"))}</b>${m.coin ? `<span class="mail-coin">+${Number(m.coin).toLocaleString()}코인</span>` : ""}</div>
      ${m.body ? `<div class="mail-item-body">${escapeHtml(String(m.body))}</div>` : ""}
      <div class="mail-item-foot">
        <span class="mail-item-at">${escapeHtml(at)}</span>
        ${m.read ? `<span class="mail-done">수령 완료</span>` : `<button type="button" class="mail-claim-btn" data-mail-claim="${escapeHtml(String(m.id))}">수령</button>`}
      </div>
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-mail-claim]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (socket && socketConnected) socket.emit("mail:claim", { id: btn.dataset.mailClaim });
    });
  });
}

function showGuildMsg(text, ok) {
  const el = $("#guildMsg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("ok", !!ok);
}

function renderGuildState(data) {
  const body = $("#guildBody");
  const accGuild = $("#accGuildName");
  if (!data || data.ok === false) {
    if (data && data.reason) showGuildMsg(data.reason, false);
    if (accGuild && (!data || !data.guild)) { accGuild.textContent = "소속된 길드가 없습니다."; accGuild.classList.add("empty"); }
    return;
  }
  if (data.message) showGuildMsg(data.message, true);

  const g = data.guild;
  if (accGuild) {
    if (g) {
      accGuild.textContent = `🏰 ${g.name} · ${g.memberCount}/${g.maxMembers}명${g.isLeader ? " · 리더" : ""}`;
      accGuild.classList.remove("empty");
    } else {
      accGuild.textContent = "소속된 길드가 없습니다.";
      accGuild.classList.add("empty");
    }
  }
  if (!body) return;
  if (!g) {
    body.innerHTML = `
      <div class="acc-referral-status">길드가 없나요? <b>생성</b>(10,000코인)하거나 이름으로 <b>가입</b>하세요. 최대 30명.</div>
      <div class="account-row ref-row">
        <input id="guildNameInput" maxlength="12" placeholder="새 길드 이름" autocomplete="off">
        <button id="guildCreateBtn">생성</button>
      </div>
      <div class="account-row ref-row">
        <input id="guildFindInput" maxlength="12" placeholder="가입할 길드 이름" autocomplete="off">
        <button id="guildJoinBtn">가입</button>
      </div>`;
    $("#guildCreateBtn")?.addEventListener("click", () => {
      const v = $("#guildNameInput")?.value.trim() || "";
      if (v.length < 2) { showGuildMsg("길드 이름은 2자 이상 입력해주세요.", false); return; }
      if (socket && socketConnected) socket.emit("guild:create", { name: v });
    });
    $("#guildJoinBtn")?.addEventListener("click", () => {
      const v = $("#guildFindInput")?.value.trim() || "";
      if (!v) { showGuildMsg("가입할 길드 이름을 입력해주세요.", false); return; }
      if (socket && socketConnected) socket.emit("guild:join", { name: v });
    });
    $("#guildNameInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("#guildCreateBtn")?.click(); }
    });
    $("#guildFindInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("#guildJoinBtn")?.click(); }
    });
    return;
  }

  const members = (g.members || []).map(m => `
    <li class="guild-member${m.online ? " online" : ""}">
      <span class="guild-dot" title="${m.online ? "온라인" : "오프라인"}"></span>
      <span class="guild-member-nick">${escapeHtml(m.nick)}${m.leader ? " 👑" : ""}</span>
      ${g.isLeader && !m.leader ? `<button type="button" class="guild-kick" data-guild-kick="${escapeHtml(m.nick)}">추방</button>` : ""}
    </li>`).join("");
  body.innerHTML = `
    <div class="guild-head">
      <b>${escapeHtml(g.name)}</b>
      <span class="guild-sub">${g.memberCount}/${g.maxMembers}명 · 리더 ${escapeHtml(g.leader || "-")}</span>
    </div>
    <ul class="guild-members">${members}</ul>
    <div class="guild-actions">
      <button type="button" id="guildLeaveBtn" class="guild-leave">나가기</button>
      ${g.isLeader ? `<button type="button" id="guildDisbandBtn" class="guild-disband">길드 해산</button>` : ""}
    </div>`;
  body.querySelectorAll("[data-guild-kick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.guildKick;
      if (!window.confirm(`'${t}' 님을 추방하시겠습니까?`)) return;
      if (socket && socketConnected) socket.emit("guild:kick", { nickname: t });
    });
  });
  $("#guildLeaveBtn")?.addEventListener("click", () => {
    if (!window.confirm("정말 길드에서 나가시겠습니까?")) return;
    if (socket && socketConnected) socket.emit("guild:leave");
  });
  $("#guildDisbandBtn")?.addEventListener("click", () => {
    if (!window.confirm("길드를 정말 해산하시겠습니까? (복구 불가)")) return;
    if (socket && socketConnected) socket.emit("guild:disband");
  });
}

function renderAccountScores() {
  if (socket && socketConnected) socket.emit("player:getRanking");
}

function saveAccount() {
  const nick = normalizeWord($("#accNickInput")?.value || "");
  if (!nick) {
    accountMsg("닉네임을 입력해주세요.", "error");
    return;
  }
  if (nick.length > 12) {
    accountMsg("닉네임은 12자 이내로 입력해주세요.", "error");
    return;
  }
  if (socket && socketConnected && socket.id) {
    socket.emit("player:setName", { nickname: nick });
  } else {
    accountMsg("서버에 연결되지 않았습니다.", "error");
  }
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
    count.textContent = friends.length;
    count.classList.toggle("hidden", friends.length === 0);
  }
  if (!myNickname) {
    list.innerHTML = `<div class="friends-empty">닉네임을 먼저 저장해주세요.</div>`;
    return;
  }

  let reqHtml = "";
  if (friendRequests.length > 0) {
    reqHtml = `<div class="friends-req-title">받은 친구 신청 (${friendRequests.length})</div>` +
      friendRequests.map(n => `
      <div class="friend-row req">
        <span class="friend-dot"></span>
        <span class="friend-name">${escapeHtml(n)}</span>
        <button class="friend-invite" data-friend-accept="${escapeHtml(n)}">수락</button>
        <button class="friend-del" data-friend-reject="${escapeHtml(n)}">거절</button>
      </div>`).join("");
  }

  let listHtml;
  if (friends.length === 0) {
    listHtml = `<div class="friends-empty">아직 친구가 없습니다.<br>위 입력란에 친구 닉네임을 입력해 추가하세요.</div>`;
  } else {
    listHtml = friends.map(f => `
      <div class="friend-row${f.online ? " online" : ""}">
        <span class="friend-dot"></span>
        <span class="friend-name">${escapeHtml(f.nickname)}</span>
        ${f.online ? `<button class="friend-invite" data-friend-invite="${escapeHtml(f.nickname)}">대결 신청</button><button class="friend-watch" data-friend-watch="${escapeHtml(f.nickname)}" title="친구가 진행 중인 게임 구경">관전</button>` : `<span class="friend-offline">오프라인</span>`}
        <button class="friend-del" data-friend-del="${escapeHtml(f.nickname)}">삭제</button>
      </div>`).join("");
  }
  list.innerHTML = reqHtml + listHtml;
  list.querySelectorAll("[data-friend-invite]").forEach(btn => {
    btn.addEventListener("click", () => inviteByNickname(btn.dataset.friendInvite));
  });
  list.querySelectorAll("[data-friend-watch]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
      socket.emit("friends:spectate", { nickname: btn.dataset.friendWatch });
      toggleFriendsPanel(false);
    });
  });
  list.querySelectorAll("[data-friend-del]").forEach(btn => {
    btn.addEventListener("click", () => socket?.emit("friends:remove", { nickname: btn.dataset.friendDel }));
  });
  list.querySelectorAll("[data-friend-accept]").forEach(btn => {
    btn.addEventListener("click", () => socket?.emit("friends:accept", { nickname: btn.dataset.friendAccept }));
  });
  list.querySelectorAll("[data-friend-reject]").forEach(btn => {
    btn.addEventListener("click", () => socket?.emit("friends:reject", { nickname: btn.dataset.friendReject }));
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
            <span class="lb-rating"><strong>${r.ranking}점</strong> · ${r.wins}승 ${r.losses}패 · ${r.streak || 0}연승</span>
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
   실시간 랭킹 패널 — 랭크/돈/연승/티어 탭, 상시 렌더
--------------------------------------------------------- */
function sideRankMarkup(rows, mode) {
  if (!Array.isArray(rows) || rows.length === 0) return `<div class="side-rank-empty">기록이 없습니다.</div>`;
  return rows.map(r => {
    const me = String(r.nickname || "플레이어").replace(/\s+/g, "").toLowerCase() === String(myNickname || "").replace(/\s+/g, "").toLowerCase() && myNickname;
    let val = (r.ranking || 0) + "점";
    if (mode === "money") val = Number(r.money || 0).toLocaleString() + "원";
    else if (mode === "streak") val = (r.bestStreak || 0) + "연승";
    else if (mode === "tier") val = formatRank(r.tier);
    const cls = (r.rank === 1 ? " top1" : r.rank <= 3 ? " top3" : "") + (me ? " lb-me" : "");
    return `<div class="side-rank-row${cls}">
      <span class="side-rank-num">${r.rank}</span>
      <span class="side-rank-name" title="${escapeHtml(r.nickname || "플레이어")}">${escapeHtml(r.nickname || "플레이어")}</span>
      <span class="side-rank-val">${escapeHtml(val)}</span>
    </div>`;
  }).join("");
}

async function loadSideRanking(mode = sideRankMode, silent = false) {
  if (mode === "money") sideRankMode = "money";
  else if (mode === "streak") sideRankMode = "streak";
  else if (mode === "ranked") sideRankMode = "ranked";
  else if (mode === "tier") sideRankMode = "tier";
  else sideRankMode = "ranked";
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
  const closeRanking = () => {
    $("#sideRank").classList.add("closed");
    $("#sideRank").style.display = "";
    $("#sideRankOpen").classList.remove("hidden");
  };
  const openRanking = () => {
    $("#sideRank").classList.remove("closed");
    $("#sideRank").style.display = "flex";
    $("#sideRankOpen").classList.add("hidden");
    loadSideRanking(sideRankMode, true);
  };
  $all(".side-rank-tabs button").forEach(btn => {
    btn.addEventListener("click", () => loadSideRanking(btn.dataset.sideMode));
  });
  $("#sideRankClose")?.addEventListener("click", closeRanking);
  $("#sideRankOpen")?.addEventListener("click", openRanking);
  $("#sideRankRefresh")?.addEventListener("click", () => loadSideRanking(sideRankMode));
  closeRanking(); /* 로드 시 항상 닫힘 — 마지막 상태 복원 안 함 */
  loadSideRanking("ranked");
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
/* ---------------------------------------------------------
   다크 모드 토글 — CSS 변수만 갈아끼운다 (kkTheme: light/dark)
--------------------------------------------------------- */
function renderThemeToggle() {
  const btn = $("#themeToggle");
  if (!btn) return;
  const dark = document.documentElement.classList.contains("dark");
  btn.textContent = dark ? "☀️" : "🌙";
  btn.title = dark ? "라이트 모드로 전환" : "다크 모드로 전환";
}

function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  try { localStorage.setItem("kkTheme", dark ? "dark" : "light"); } catch (e) { /* 무시 */ }
  renderThemeToggle();
}

/* ---------------------------------------------------------
   게임 종료 리플레이 — 이번 판 단어 흐름 한눈에 보기
--------------------------------------------------------- */
function showReplay(data) {
  const modal = $("#replayModal");
  const list = $("#replayList");
  const head = $("#replayHead");
  if (!modal || !list) return;
  const st = (data && data.state) || gameState;
  const hist = (st && Array.isArray(st.history)) ? st.history : [];
  if (hist.length < 2) return;   /* 시작 단어뿐이면 굳이 띄우지 않는다 */

  const winnerIdx = data ? data.winner : (st ? st.winner : null);
  const winnerName = data && data.winnerName ? data.winnerName : "";
  if (head) {
    head.textContent = winnerIdx == null
      ? `무승부 · 총 ${hist.length}단어`
      : `${winnerName || "승자"} 승리 · 총 ${hist.length}단어`;
  }
  list.innerHTML = hist.map(item => {
    const isStart = item.player === -1 || item.nickname === "시작";
    const isWinner = winnerIdx != null && item.player === winnerIdx;
    const depthBadge = item.depth != null ? `<span class="replay-depth">공격 ${item.depth}</span>` : "";
    const who = isStart ? "시작" : escapeHtml(item.nickname || "플레이어");
    return `<div class="replay-row${isWinner ? " win" : ""}${isStart ? " start" : ""}">
      <span class="replay-turn">${isStart ? "●" : (item.turn != null ? item.turn : "")}</span>
      <span class="replay-who">${who}</span>
      <span class="replay-word" data-def-word="${escapeHtml(item.word)}" title="클릭하면 뜻 보기">${escapeHtml(item.word)}</span>
      ${depthBadge}
    </div>`;
  }).join("");
  list.querySelectorAll("[data-def-word]").forEach(w => {
    w.addEventListener("click", () => showWordDefinition(w.dataset.defWord));
  });
  modal.classList.remove("hidden");
}

/* ---------------------------------------------------------
   단어 뜻 표시 — 위키백과 요약 API(키 불필요, CORS 허용)
--------------------------------------------------------- */
async function showWordDefinition(word) {
  const modal = $("#wordDefModal");
  const title = $("#wordDefTitle");
  const body = $("#wordDefBody");
  if (!modal || !title || !body) return;
  const w = String(word || "").trim();
  if (!w) return;
  title.textContent = w;
  body.innerHTML = `<div class="word-def-loading">뜻을 찾는 중...</div>`;
  modal.classList.remove("hidden");
  try {
    const res = await fetch(`https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w)}?origin=*`);
    if (!res.ok) throw new Error("not found");
    const j = await res.json();
    const extract = String(j.extract || "").trim();
    const desc = String(j.description || "").trim();
    if (extract || desc) {
      body.innerHTML = `${desc ? `<div class="word-def-desc">${escapeHtml(desc)}</div>` : ""}<div class="word-def-text">${escapeHtml(extract || desc)}</div>
        <div class="word-def-src">출처: 한국어 위키백과</div>`;
      return;
    }
    throw new Error("empty");
  } catch (e) {
    body.innerHTML = `<div class="word-def-none">뜻 정보를 찾지 못했습니다.<br><span class="word-def-hint">단어가 사전/위키백과에 아직 없을 수 있어요.</span></div>`;
  }
}

/* ---------------------------------------------------------
   레이팅 변동 그래프 (아이템 탭, 최근 30일·점당 1일)
   표시하는 값은 오직 랭크 게임 레이팅(r)뿐 — 멀티 레이팅은 제외
--------------------------------------------------------- */
function renderRatingChart() {
  const box = $("#ratingChartBox");
  if (!box) return;
  const hist = (shopInfo && Array.isArray(shopInfo.ratingHistory)) ? shopInfo.ratingHistory : [];
  const pts = hist.slice(-30);
  if (pts.length < 2) {
    box.innerHTML = `<div class="items-empty">아직 그래프가 없어요.<br>랭크 게임을 2판 이상 하면 레이팅이 어떻게 변했는지 보여 줍니다.</div>`;
    return;
  }
  const W = 320, H = 130, PADX = 8, PADY = 14;
  const all = pts.map(p => Number(p.r)).filter(Number.isFinite);
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 10; max += 10; }
  const x = i => PADX + (i / (pts.length - 1)) * (W - PADX * 2);
  const y = v => H - PADY - ((v - min) / (max - min)) * (H - PADY * 2);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Number(p.r) || 0).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const dateFirst = String(pts[0].d || "").slice(5).replace("-", "/");
  const dateLast = String(last.d || "").slice(5).replace("-", "/");
  box.innerHTML = `
    <div class="chart-legend"><span class="chart-leg"><i style="background:#818cf8"></i>랭크 점수 <b>${Number(last.r) || "-"}</b></span><span class="chart-range">${dateFirst} ~ ${dateLast}</span></div>
    <div class="chart-hint">숫자가 높을수록 실력이 좋다는 뜻! 랭크 게임을 해야만 올라가요.</div>
    <svg class="rating-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="랭크 게임 레이팅 변동 그래프">
      <line class="chart-grid" x1="${PADX}" y1="${H - PADY}" x2="${W - PADX}" y2="${H - PADY}"/>
      <line class="chart-grid" x1="${PADX}" y1="${PADY}" x2="${W - PADX}" y2="${PADY}" stroke-dasharray="3 4"/>
      <text x="${PADX + 2}" y="${PADY - 4}" class="chart-max">${Math.round(max)}</text>
      <text x="${PADX + 2}" y="${H - PADY - 4}" class="chart-min">${Math.round(min)}</text>
      <path d="${d}" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(Number(last.r) || 0).toFixed(1)}" r="3.5" fill="#818cf8"/>
    </svg>`;
}

/* ---------------------------------------------------------
   튜토리얼 — 규칙 3스텝 → 숙련도 질문 2문항 → AI 실습 1판
   표시 조건: 완료 전이거나 Google 로그인 전(게스트)이면 항상 먼저 띄운다.
   실습은 practice 플래그 게임이라 전적/미션/연승에 기록되지 않는다.
   질문 합산 점수 → 쉬움/보통/어려움 3단계 (상위 답변은 최강 AI와 대결)
--------------------------------------------------------- */
const TUTORIAL_STEPS = [
  { title: "① 기본 규칙", body: "끝말잇기! <b>끝 글자</b>로 시작하는 단어를 입력창에 쓰고 [입력]을 누르세요. 예) 사과 → 과일 → 일몰... 국어사전에 있는 한글 단어만 인정됩니다." },
  { title: "② 공격과 방어", body: "<b>공격 단어</b>(상대가 막기 어려운 단어)는 라운드 첫 턴에만 사용할 수 없고, 대응이 불가능하면 <b>한방</b>이 되어 상대 하트가 차감됩니다. 위기엔 <b>방어 단어</b>로 버티세요." },
  { title: "③ 하트 · 시간 · 보상", body: "실수 5회 = 하트 1개 차감(게임당 2개). 제한 시간 안에 입력해야 합니다. 랭크 매칭에서 이기면 <b>돈</b>과 레이팅을 얻고, 상점에서 <b>칭호·물약·보호 티켓</b>을 구매할 수 있어요. 기록은 오른쪽 상단 랭킹, 자세한 규칙은 ❓ 게임 방법을 확인하세요!" }
];
const TUTORIAL_QUIZ = [
  { id: "know", q: "끝말잇기를 얼마나 아나요?", opts: ["처음이에요", "대충 알아요", "잘 알아요"] },
  { id: "skill", q: "보통 게임을 잘하는 편인가요?", opts: ["처음/하위권이에요", "보통이에요", "자주 이겨요"] }
];
let tutorialStep = 0;
let tutorialActive = false;
let tutorialPhase = "steps";      /* steps | quiz | done */
let tutorialPending = true;      /* 표시 여부 결정 전 — 싱글 자동시작을 막는다 */
let autoStartAllowed = false;
let tutorialAnswers = { know: 0, skill: 0 };

function renderTutorialStep() {
  const body = $("#tutorBody");
  const idx = $("#tutorIndex");
  const prev = $("#tutorPrev");
  const next = $("#tutorNext");

  if (tutorialPhase === "quiz") {
    setText(["#tutorTitle"], "④ 실력 파악");
    if (body) {
      body.innerHTML = TUTORIAL_QUIZ.map((q, qi) => `
        <div class="tutor-quiz">
          <div class="tutor-quiz-q">${q.q}</div>
          <div class="tutor-quiz-opts">${q.opts.map((o, oi) => `
            <label class="tutor-quiz-opt"><input type="radio" name="kk-tq-${qi}" value="${oi}"${tutorialAnswers[q.id] === oi ? " checked" : ""}><span>${o}</span></label>`).join("")}</div>
        </div>`).join("");
    }
    if (idx) idx.textContent = `${TUTORIAL_STEPS.length + 1} / ${TUTORIAL_STEPS.length + 1}`;
    if (prev) prev.disabled = false;
    if (next) next.textContent = "AI와 실습하기";
    return;
  }
  if (tutorialPhase === "done") {
    setText(["#tutorTitle"], "🎓 튜토리얼 완료!");
    if (body) body.innerHTML = `<p><b>준비 완료!</b> 이제 실제 게임을 시작할 수 있어요.</p><p>실습으로 플레이한 내용은 전적·미션·랭킹에 기록되지 않습니다. 이름 설정은 <b>계정 탭</b>에서 할 수 있어요.</p>`;
    if (idx) idx.textContent = "완료";
    if (prev) prev.disabled = true;
    if (next) next.textContent = "게임 시작하기";
    return;
  }

  const step = TUTORIAL_STEPS[tutorialStep];
  if (!step) return;
  setText(["#tutorTitle"], step.title);
  if (body) body.innerHTML = step.body;
  if (idx) idx.textContent = `${tutorialStep + 1} / ${TUTORIAL_STEPS.length + 1}`;
  if (prev) prev.disabled = tutorialStep === 0;
  if (next) next.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? "숙련도 질문" : "다음";
}

function showTutorial(fromStart = true) {
  const modal = $("#tutorialModal");
  if (!modal) return;
  if (fromStart) { tutorialStep = 0; tutorialPhase = "steps"; }
  tutorialActive = true;
  renderTutorialStep();
  modal.classList.remove("hidden");
}

function readQuizAnswers() {
  TUTORIAL_QUIZ.forEach((q, qi) => {
    const el = document.querySelector(`input[name="kk-tq-${qi}"]:checked`);
    tutorialAnswers[q.id] = el ? Number(el.value) : 0;
  });
}

/* 질문 합산(0~4점) → 난이도 — ≤1 쉬움 / 2~3 보통 / 4 어려움(최강 AI) */
function tutorialDifficulty() {
  const score = (Number(tutorialAnswers.know) || 0) + (Number(tutorialAnswers.skill) || 0);
  if (score <= 1) return "easy";
  if (score <= 3) return "normal";
  return "hard";
}

function startTutorialPractice() {
  readQuizAnswers();
  const diff = tutorialDifficulty();
  const modal = $("#tutorialModal");
  if (modal) modal.classList.add("hidden");
  tutorialPhase = "practice";
  tutorialActive = true;
  showMessage(`튜토리얼 실습을 시작합니다! (난이도: ${{ easy: "쉬움", normal: "보통", hard: "어려움" }[diff]}) — 이 게임은 기록되지 않아요.`, "info");
  switchToModeTab("single", false);
  leaveRoom();
  if (submitting || startingGame) return;
  startingGame = true;
  localUsedWords.clear();
  showRestartButton(false);
  gameState = null;
  socket.emit("room:create", { nickname: makeNickname(), mode: "ai", difficulty: diff, practice: true });
}

/* 실습 게임 종료 → 튜토리얼 마무리 + 실제 게임 개시 */
function onPracticeGameFinished() {
  if (!tutorialActive || tutorialPhase !== "practice") return;
  tutorialPhase = "done";
  showMessage("튜토리얼 실습이 끝났습니다! 이제 실제 게임을 시작할게요.", "success");
  finishTutorial();
}

/* 튜토리얼 마무리 — 완료 처리하고 실습이면 방을 정리한 뒤 싱글을 연다 */
function finishTutorial() {
  const wasPractice = tutorialPhase === "practice" || practiceGameActive;
  const modal = $("#tutorialModal");
  if (modal) modal.classList.add("hidden");
  tutorialActive = false;
  tutorialPhase = "steps";
  tutorialPending = false;
  autoStartAllowed = true;
  setPracticeBar(false);
  try { localStorage.setItem("kkTutorialDone", "1"); } catch (e) { /* 무시 */ }
  if (wasPractice) leaveRoom();
  if (currentMode === "single" && !roomId) setTimeout(startSingleGame, 250);
}

/* 실습 배너 나가기 — 튜토리얼을 끝내고 실제 게임으로 */
function quitTutorialPractice() {
  if (tutorialPhase !== "practice" && !practiceGameActive) return;
  tutorialPhase = "done";
  finishTutorial();
}

/* 표시 여부 결정 — 한 번만 (게스트는 로그인 전이면 무조건 먼저 표시) */
function initTutorialFlow() {
  let decided = false;
  const decide = (final) => {
    if (decided || tutorialActive) return;
    const settled = window.kkLoggedIn !== undefined;
    if (!settled && !final) return;
    let seen = false;
    try { seen = localStorage.getItem("kkTutorialDone") === "1"; } catch (e) { /* 무시 */ }
    const loggedIn = settled ? window.kkLoggedIn === true : false;
    decided = true;
    tutorialPending = false;
    if (!seen || !loggedIn) {
      showTutorial(true);
      return;
    }
    autoStartAllowed = true;
    if (currentMode === "single" && !roomId && !gameState) setTimeout(startSingleGame, 300);
  };
  setTimeout(() => decide(false), 1000);
  setTimeout(() => decide(true), 2600);
  window.addEventListener("kk-auth", () => { updateChatVisibility(); decide(true); });
}

document.addEventListener("DOMContentLoaded", () => {
  initSocket();
  updateNicknameUI();
  updateChatVisibility();
  updateStatsUI();
  initSideRanking();
  renderSoundToggle();
  refreshSeasonBar();

  /* 소리/진동 토글 — 첫 조작 시 AudioContext 시작 (자동재생 정책 대응) */
  $("#soundToggle")?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("kkSound", soundEnabled ? "1" : "0");
    renderSoundToggle();
    playSound("word");
  });

  /* 다크 모드 토글 */
  renderThemeToggle();
  /* 소리/테마 토글은 서버 데이터가 오기 전에도 바로 쓸 수 있게 바를 먼저 연다 */
  $(".money-bar")?.classList.remove("hidden");
  $("#themeToggle")?.addEventListener("click", () => {
    applyTheme(!document.documentElement.classList.contains("dark"));
    playSound("word");
  });

  /* 튜토리얼 — 미완료이거나 로그인 전이면 규칙→질문→AI 실습 흐름을 먼저 띄운다 */
  $("#tutorPrev")?.addEventListener("click", () => {
    if (tutorialPhase === "quiz") {
      tutorialPhase = "steps";
      tutorialStep = TUTORIAL_STEPS.length - 1;
      renderTutorialStep();
      return;
    }
    if (tutorialStep > 0) { tutorialStep--; renderTutorialStep(); }
  });
  $("#tutorNext")?.addEventListener("click", () => {
    if (tutorialPhase === "done") { finishTutorial(); return; }
    if (tutorialPhase === "quiz") { startTutorialPractice(); return; }
    if (tutorialStep < TUTORIAL_STEPS.length - 1) { tutorialStep++; renderTutorialStep(); return; }
    readQuizAnswers();
    tutorialPhase = "quiz";
    renderTutorialStep();
  });
  $("#tutorSkip")?.addEventListener("click", () => finishTutorial());
  $("#tutorClose")?.addEventListener("click", () => finishTutorial());
  $("#practiceQuit")?.addEventListener("click", () => quitTutorialPractice());
  $("#tutorialReplayBtn")?.addEventListener("click", () => showTutorial(true));
  $("#replayClose")?.addEventListener("click", () => $("#replayModal")?.classList.add("hidden"));
  $("#wordDefClose")?.addEventListener("click", () => $("#wordDefModal")?.classList.add("hidden"));
  document.addEventListener("pointerdown", () => ensureAudio(), { once: false });
  document.addEventListener("keydown", () => ensureAudio(), { once: false });

  /* 탭 전환 */
  $("#guildRefresh")?.addEventListener("click", () => {
    if (socket && socketConnected) socket.emit("guild:info");
  });
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
        if (autoStartAllowed && !tutorialActive && (!gameState || !roomId)) setTimeout(startSingleGame, 100);
      } else if (currentMode === "ranked") {
        if (gameState && roomId && currentMode === "ranked") { /* in game */ }
        else { $("#rankedLobby")?.classList.remove("hidden"); $("#rankedGame")?.classList.add("hidden"); refreshSeasonBar(); }
        updateRankedQueueUI();
        renderRankedStreakChip();
      } else if (currentMode === "shop") {
        if (socket && socketConnected) {
          socket.emit("shop:list");
          socket.emit("attendance:status");
          socket.emit("word:list", { nickname: myNickname || undefined });
        }
      } else if (currentMode === "items") {
        if (socket && socketConnected) socket.emit("shop:list");
        renderItems();
  } else if (currentMode === "season") {
    refreshSeasonBar();
    if (socket && socketConnected) socket.emit("missions:status");
  } else if (currentMode === "achievements") {
    fetchAchievements();
  } else if (currentMode === "guild") {
    if (socket && socketConnected) socket.emit("guild:info");
  }

      loadSideRanking(sideRankMode, true);
    });
  });

  /* 초기 로드 — 튜토리얼 표시 여부를 결정한 뒤 싱글플레이를 자동 시작한다 */
  initTutorialFlow();

  /* 싱글플레이 — 튜토리얼 실습 중이면 먼저 튜토리얼을 마친다 */
  $("#newStart")?.addEventListener("click", () => {
    if (tutorialPhase === "practice" || practiceGameActive) { finishTutorial(); return; }
    leaveRoom();
    setTimeout(startSingleGame, 200);
  });

  $("#restart")?.addEventListener("click", () => {
    if (tutorialPhase === "practice" || practiceGameActive) { finishTutorial(); return; }
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
  $("#roomListBtn")?.addEventListener("click", openRoomList);
  $("#roomListRefresh")?.addEventListener("click", fetchRoomList);
  $("#achRefresh")?.addEventListener("click", fetchAchievements);
  $("#roomListRandom")?.addEventListener("click", randomJoinRoom);
  $("#roomListClose")?.addEventListener("click", closeRoomList);
  $("#shopWordReqSend")?.addEventListener("click", () => submitWordRequestFrom("#shopWordReqInput", "#shopWordReqStatus"));
  bindAdminEnter("#shopWordReqInput", () => submitWordRequestFrom("#shopWordReqInput", "#shopWordReqStatus"));
  $("#missionBtn")?.addEventListener("click", () => {
  if (currentMode === "season") {
    switchToModeTab("season", true);
    refreshSeasonBar();
    if (socket && socketConnected) socket.emit("missions:status");
  } else {
    switchToModeTab("season", true);
  }
});
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
    if (!isLoggedIn()) {
      showMessage("랭킹은 Google 로그인 후 이용할 수 있습니다. (싱글·멀티는 게스트도 가능)", "error");
      openAccountPanel(true);
      return;
    }
    if (!requireNickname()) return;
    rankedQueued = true;
    rankedInvitePending = false;
    hideRankedInviteBar();
    updateRankedInviteUI();
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
  $("#rankedInviteBtn")?.addEventListener("click", sendRankedInvite);
  $("#rankedInviteCancelBtn")?.addEventListener("click", cancelRankedInvite);
  $("#rankedInviteAcceptBtn")?.addEventListener("click", acceptRankedInvite);
  $("#rankedInviteRejectBtn")?.addEventListener("click", rejectRankedInvite);
  bindAdminEnter("#rankedInviteInput", sendRankedInvite);
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
      $("#chatPanel")?.classList.add("hidden");
    }
  });

  /* 실시간 채팅 (좌측 하단 — 방/전체 자동 전환, 로그인자만) */
  const chatPanel = $("#chatPanel");
  $("#chatBtn")?.addEventListener("click", () => {
    if (!chatPanel) return;
    const opening = chatPanel.classList.contains("hidden");
    chatPanel.classList.toggle("hidden", !opening);
    if (opening) {
      chatUnread = 0;
      renderChatUnread();
      updateChatScopeLabel();
      /* 이력 요청 — 방에 있으면 방 이력, 없으면 전체 이력 */
      if (socket && socketConnected) socket.emit("chat:history", (roomId && chatScopeNow() === "room") ? { roomId } : {});
      const list = $("#chatList");
      if (list) list.scrollTop = list.scrollHeight;
      $("#chatInput")?.focus();
    }
  });
  $("#chatClose")?.addEventListener("click", () => chatPanel?.classList.add("hidden"));
  const sendChat = () => {
    const inp = $("#chatInput");
    if (!inp) return;
    const text = inp.value.trim();
    if (!text) return;
    socket.emit("chat:send", { text });
    inp.value = "";
    inp.focus();
  };
  $("#chatSend")?.addEventListener("click", sendChat);
  $("#chatInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendChat(); }
  });
  clearChat();

  /* 계정 탭 — 이름 설정/변경은 이 탭에서만 한다 */
  $("#accountBtn")?.addEventListener("click", () => openAccountPanel());
  $("#myNickChip")?.addEventListener("click", () => openAccountPanel(true));
  $("#accountClose")?.addEventListener("click", () => openAccountPanel(false));
  $("#accApply")?.addEventListener("click", saveAccount);

  /* 레퍼럴(추천인) 등록 */
  const registerReferral = () => {
    if (!socket || !socketConnected) { showMessage("서버에 연결 중입니다...", "waiting"); return; }
    const inp = $("#refNickInput");
    const nick = normalizeWord(inp?.value || "");
    if (!nick) {
      const el = $("#refMsg");
      if (el) { el.textContent = "추천인 닉네임을 입력해주세요."; el.classList.remove("ok"); }
      return;
    }
    socket.emit("referral:register", { nickname: nick });
  };
  $("#refApply")?.addEventListener("click", registerReferral);
  $("#refNickInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); registerReferral(); }
  });
  $("#accNickInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveAccount(); }
  });
  renderAccountInfo(myNickname);
  renderAccountScores();

});
