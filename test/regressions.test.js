"use strict";

/* Real server functions/handlers in an isolated VM: no HTTP listener, dictionary
   loading, production credentials, or database connection is needed. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const game = require("../server/game.js");
const source = fs.readFileSync(
  process.env.WORDGAME_TEST_SOURCE || path.join(__dirname, "../server/server.js"), "utf8"
);

function functionSource(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, `missing function: ${name}`);
  const firstLine = source.slice(match.index, source.indexOf("\n", match.index));
  if (firstLine.trimEnd().endsWith("}")) return firstLine;
  const end = source.indexOf("\n}", match.index);
  assert.ok(end > match.index, `missing function end: ${name}`);
  return source.slice(match.index, end + 2);
}

/* 한 줄 const는 그대로, 여러 줄 배열/식은 닫는 줄(');' 또는 '];')까지 포함 (CRLF 포함) */
function constSource(name) {
  const single = new RegExp(`^const ${name} = [^\\n]*;\\r?$`, "m").exec(source);
  if (single) return single[0];
  const start = new RegExp(`^const ${name} = `, "m").exec(source);
  assert.ok(start, `missing constant: ${name}`);
  let idx = start.index;
  for (;;) {
    const nl = source.indexOf("\n", idx);
    assert.ok(nl > 0, `missing constant end: ${name}`);
    if (/[)\]]\s*;\s*$/.test(source.slice(idx, nl))) return source.slice(start.index, nl + 1);
    idx = nl + 1;
  }
}

/* 클로저 스코프의 const 화살표 함수 (moderationAction 등) — 닫는 '};'까지 추출 */
function constFnSource(name) {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `missing const fn: ${name}`);
  const end = source.indexOf("\n  };", start);
  assert.ok(end > start, `missing const fn end: ${name}`);
  return source.slice(start, end + 5);
}

function installHandler(c, event, socket) {
  const start = source.indexOf(`  socket.on("${event}",`);
  assert.ok(start >= 0, `missing handler: ${event}`);
  const end = source.indexOf("\n  });", start);
  assert.ok(end > start, `missing handler end: ${event}`);
  c.socket = socket;
  vm.runInContext(`(function(socket) {\n${source.slice(start, end + 6)}\n})(socket);`, c);
}

function context(extra = {}) {
  const errors = [];
  const timers = [];
  const emissions = [];
  const ioRooms = [];   /* io.to(room) 브로드캐스트를 방 ID와 함께 기록 */
  const c = vm.createContext({
    structuredClone,
    console: { log() {}, warn() {}, error(...args) { errors.push(args.join(" ")); } },
    playerCache: new Map(), socketNicks: new Map(), onlineNicks: new Map(),
    adminAuthed: new Map(), disconnectedPlayers: new Map(), REMATCHES: new Map(),
    socketFirebaseUid: new Map(), socketFirebaseEmail: new Map(),
    ROOMS: new Map(),
    bannedMap: new Map(), mutedMap: new Map(),
    bugReports: [],
    guildCache: null, guildsPath: "guilds.json",
    seasonStore: null, seasonJsonPath: "season.json",
    process: { env: {} },
    customWords: { nextId: 1, pending: [], approved: [], rejected: [] },
    customWordsPath: "custom-words.json", customDictPath: "legacy-custom-words.json",
    writeStoreFile() {}, loadStoreJSON: async () => null,
    saveBugReports() {}, notifySuperAdmins() {},
    dbMode: "json", dbPool: null,
    firebaseReady: false, firebaseAuth: null,
    saveJsonDb() {},
    getKstDate: () => "2026-10-04",
    getKstWeek: () => "2026-W40",
    getKstMonth: () => "2026-10",
    calculateElo: game.calculateElo, calculateRank: game.calculateRank,
    normalizeWord: game.normalizeWord,
    isAdminNick: () => false, findSubAdmin: () => null, watchNicks: [],
    getPlayerRoom: () => null,
    cancelRankedInvitesFor() {}, removeFromRankedQueue() {}, broadcastRankedQueue() {},
    leaveRoomForSocket() {}, addBot() {}, startNewGame() {},
    broadcastRoomState() {}, getPublicRoomState: r => ({ roomId: r.id, practice: !!r.practice }),
    TURN_TIME: 20, MAX_PLAYERS: 10, RECONNECT_GRACE_MS: 30000, MAX_HEARTS: 3,
    PARTY_PLAYERS: 4, PARTY_TEAM_SIZE: 2, PARTY_TEAM_COUNT: 2,
    setTimeout(fn, ms) { const t = { fn, ms, active: true }; timers.push(t); return t; },
    clearTimeout(t) { if (t && typeof t === "object") t.active = false; },
    io: { to: (room) => ({ emit: (...args) => { emissions.push(args); ioRooms.push({ room, args }); } }),
      emit: (...args) => emissions.push(args),
      sockets: { sockets: new Map() } },
    requireNickname: async () => ({ ok: true, role: "super", nickname: "admin" }),
    ...extra,
  });
  for (const name of ["normKey", "MODE_DEFAULT", "SEASON_DEFAULT", "REACT_EMOJIS", "REACT_COOLDOWN_MS",
    "REFERRAL_JOIN_COIN", "REFERRAL_INVITE_COIN", "MAIL_MAX", "MAIL_COIN_MAX", "PLAYER_COLUMN_KEYS",
    "GUILD_MAX_MEMBERS", "GUILD_CREATE_COIN", "SEA_TITLE", "RENAME_PRICE",
    "CHAT_MAX_LEN", "CHAT_COOLDOWN_MS", "CHAT_WINDOW_MS", "CHAT_WINDOW_MAX",
    "GLOBAL_CHAT_HISTORY", "GLOBAL_CHAT_MAX",
    "ATTENDANCE_REWARD", "SHOP_POTION_PRICE", "SHOP_SHIELD_PRICE",
    "DAILY_MISSIONS", "WEEKLY_MISSIONS", "MONTHLY_MISSIONS",
    "SHOP_TITLES", "SHOP_MULTIPLIER_PRICES", "missionCurrent", "ADMIN_EMAILS", "AI_PLAYER_ID"]) {
    vm.runInContext(constSource(name), c);
  }
  for (const name of [
    "initPeriodData", "initDailyData", "initWeeklyData", "initMonthlyData",
    "migratePlayerData", "resolvePlayerId", "getPlayerData", "savePlayerData",
    "claimDisplayName", "verifyFirebaseIdToken",
    "registerOnline", "unregisterOnline", "updateRating", "updateSingleResult",
    "recordMatchHistory", "finishGame", "migrateJsonPlayersToPg",
    "getPlayerBySocket", "getPlayerByIndex", "getAlivePlayers", "findNextAlivePlayer",
    "stopTurnTimer", "startTurnTimer", "removePlayer",
    "bumpMission", "bumpDaily", "playWord", "runAI",
    "pushRatingHistory", "applyWelcomeReward",
    "getBan", "getMute", "banGuard", "banGuardByUid", "readModEntries",
    "applyModeration", "saveModeration", "loadModeration",
    "listModeration", "addModeration", "removeModeration",
    "roomCapacity", "partyAliveTeams", "checkPartyEnd",
    "partyReadyError", "partyResultPairs", "addPlayer",
    "achievementStats", "evaluateAchievements", "achievementDefs",
    "findPlayerIdByNickname", "findAllPlayerIdsByNickname",
    "playerExtras",
    "applyGuilds", "loadGuilds", "saveGuilds", "guildOf",
    "buildGuildState", "notifyGuildMembers",
    "seasonRewardFor", "buildSeasonInfo", "nowForSeason", "seasonKeyOf",
    "seasonEndMs", "currentSeasonKey", "getSeasonStore",
    "applyCustomWord", "saveCustomWords", "loadCustomDict", "applyCustomDict",
    "rebuildWordViews", "emitCustomWords", "notifyRequester",
    "missionKeyOf", "missionListOf", "buildMissionProgress",
    "getRankingPayload", "isAdminEmail", "isAdminPd",
    "listAllPlayers", "saveSeasonStore", "closeSeason", "ensureSeasonRollover",
    "chatFilter", "createRoomId", "createRoom",
  ]) vm.runInContext(functionSource(name), c);
  return { c, errors, timers, emissions, ioRooms };
}

function seed(c, nickname, extra = {}) {
  const p = c.migratePlayerData({
    nickname, money: 90000,
    single: { rating: 1300, wins: 9, losses: 2 },
    multi: { rating: 1500, wins: 12, losses: 3, streak: 4, bestStreak: 7 },
    ranked: { rating: 1900, wins: 50, losses: 10, streak: 3, bestStreak: 8 },
    ...extra,
  });
  c.playerCache.set(nickname.toLowerCase(), p);
  return p;
}

function socket(id) {
  const handlers = new Map(), emissions = [];
  return { id, handlers, emissions, data: {},
    on: (event, fn) => handlers.set(event, fn),
    emit: (...args) => emissions.push(args), join() {}, leave() {} };
}

test("new socket logs into existing account without resetting balances or statistics", async () => {
  const { c, errors } = context();
  const s = socket("new-socket");
  const before = seed(c, "existing");
  c.socketFirebaseUid.set(s.id, "uid-existing");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "existing" });
  const after = c.playerCache.get("existing");
  assert.equal(after.money, before.money);
  assert.equal(after.ranked.rating, 1900);
  assert.equal(after.ranked.wins, 50);
  assert.equal(c.socketNicks.get(s.id), "existing");
  assert.equal(errors.length, 0);
});

test("first rename is free and carries the account to the new name", async () => {
  const { c, errors } = context();
  const s = socket("connected");
  seed(c, "old", { money: 2000000, ranked: { rating: 1900, wins: 50, losses: 10 } });
  c.registerOnline(s.id, "old");
  c.socketFirebaseUid.set(s.id, "uid-old");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "target" });
  const hit = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.ok(hit);
  assert.equal(hit[1].ok, true);
  assert.equal(hit[1].renamed, true);
  assert.equal(hit[1].nameChanges, 1);
  const after = c.playerCache.get("target");
  assert.ok(after, "새 이름 행이 만들어져야 합니다");
  assert.equal(after.money, 2000000);        /* 첫 개명은 무료 */
  assert.equal(after.ranked.wins, 50);       /* 전적·레이팅 승계 */
  assert.equal(after.ranked.rating, 1900);
  assert.equal(after.firebaseUid, "uid-old"); /* 계정 연결 유지 */
  assert.equal(after.nameChanges, 1);
  assert.equal(c.playerCache.has("old"), false, "옛 이름 행은 제거되어야 합니다");
  assert.equal(c.socketNicks.get(s.id), "target");
  assert.equal(errors.length, 0);
});

test("new nickname still creates a new account", async () => {
  const { c } = context();
  const s = socket("new");
  c.socketFirebaseUid.set(s.id, "uid-new");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "new-account" });
  assert.equal(c.playerCache.get("new-account").money, 0);
  assert.equal(c.playerCache.get("new-account").ranked.rating, 1000);
});

test("PostgreSQL login queries normalized account key before saving", async () => {
  const queries = [];
  const { c } = context({ dbMode: "pg", dbPool: { async query(sql, values) {
    queries.push({ sql, values });
    return { rows: sql.includes("SELECT") ? [{
      id: "existing", nickname: "existing", money: 90000,
      ranked_rating: 1900, ranked_wins: 50, ranked_losses: 10,
      rating: 1500, wins: 12, losses: 3, streak: 4, best_streak: 7,
      single_rating: 1300, single_wins: 9, single_losses: 2,
    }] : [] };
  } } });
  const s = socket("fresh");
  c.socketFirebaseUid.set(s.id, "uid-fresh");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "Existing" });
  assert.equal(queries[0].values[0], "existing");
  assert.equal(c.playerCache.get("existing").money, 90000);
  assert.equal(c.playerCache.get("existing").ranked.wins, 50);
});

test("database read error does not become a default account write", async () => {
  const queries = [];
  const { c } = context({ dbMode: "pg", dbPool: { async query(sql) {
    queries.push(sql); throw new Error("read failure");
  } } });
  const s = socket("fresh");
  c.socketFirebaseUid.set(s.id, "uid-fresh");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "existing" });
  assert.equal(queries.length, 1);
  assert.ok(queries[0].includes("SELECT"));
  assert.equal(c.playerCache.size, 0);
  assert.equal(c.socketNicks.has(s.id), false);
});

test("multi streak fields survive JSON and PostgreSQL saves", async () => {
  for (const mode of ["json", "pg"]) {
    let values;
    const { c } = context({ dbMode: mode, dbPool: {
      async query(sql, args) { values = args; return { rows: [] }; },
    } });
    const p = seed(c, "existing");
    await c.savePlayerData("existing", p);
    assert.equal(c.playerCache.get("existing").multi.streak, 4);
    assert.equal(c.playerCache.get("existing").multi.bestStreak, 7);
    if (mode === "pg") { assert.equal(values[5], 4); assert.equal(values[6], 7); }
  }
});

test("cached account reads are detached from nested live data", async () => {
  const { c } = context();
  seed(c, "existing", { titles: [{ id: "t", name: "title" }] });
  const p = await c.getPlayerData("existing");
  p.titles[0].name = "changed";
  p.daily.claimed.push("rankedWins");
  assert.equal(c.playerCache.get("existing").titles[0].name, "title");
  assert.equal(c.playerCache.get("existing").daily.claimed.length, 0);
});

test("failed PostgreSQL save throws and does not advance cached account", async () => {
  const { c } = context({ dbMode: "pg", dbPool: {
    async query() { throw new Error("write failure"); },
  } });
  seed(c, "existing");
  const p = await c.getPlayerData("existing");
  p.money = 0;
  await assert.rejects(c.savePlayerData("existing", p), /write failure/);
  assert.equal(c.playerCache.get("existing").money, 90000);
});

test("failed JSON save restores previous cached account", async () => {
  const { c } = context({ saveJsonDb() { throw new Error("disk failure"); } });
  seed(c, "existing");
  const p = await c.getPlayerData("existing");
  p.money = 0;
  await assert.rejects(c.savePlayerData("existing", p), /disk failure/);
  assert.equal(c.playerCache.get("existing").money, 90000);
});

test("disconnected loser retains existing account when rating is updated", async () => {
  const { c } = context();
  seed(c, "winner", { ranked: { rating: 1800, wins: 5, losses: 0 } });
  seed(c, "loser");
  c.registerOnline("socket-w", "winner");
  c.registerOnline("socket-l", "loser");
  c.unregisterOnline("socket-l");
  await c.updateRating("socket-w", "socket-l", "winner", "loser", "ranked");
  const after = c.playerCache.get("loser");
  assert.equal(after.ranked.rating, game.calculateElo(1800, 1900).newLoserRating);
  assert.equal(after.ranked.wins, 50);
  assert.equal(after.ranked.losses, 11);
  assert.equal(after.money, 90000);
});

function room(c, count = 3) {
  const r = { id: "ROOM", mode: "online", started: true, finished: false,
    players: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`, socketId: `s${i}`, playerIndex: i, nickname: `p${i}`,
      isBot: false, connected: true, eliminated: false, waiting: false, hearts: 2,
    })),
    turnPlayerIndex: 0, turnNumber: 1, gameSessionId: 1,
    hostSocketId: "s0", timer: null, history: [] };
  c.ROOMS.set(r.id, r);
  c.getPlayerRoom = () => r;
  return r;
}

test("AI finish stores history then statistics, even if UI restarts immediately", async () => {
  const { c, emissions, errors } = context();
  const p = seed(c, "existing", { recentGames: [] });
  const r = room(c, 2);
  r.mode = "ai";
  Object.assign(r.players[0], { nickname: "existing" });
  Object.assign(r.players[1], { isBot: true, nickname: "AI" });
  r.history = [{ player: 0, word: "가방" }];
  c.registerOnline("s0", "existing");
  c.io.to = () => ({ emit(event, payload) {
    emissions.push([event, payload]);
    if (event === "game:finished") r.history = []; // UI starts a new round.
  } });
  await c.finishGame(r, 0, 1);
  const after = c.playerCache.get("existing");
  assert.equal(after.single.wins, p.single.wins + 1);
  assert.equal(after.recentGames.length, 1);
  assert.equal(after.recentGames[0].wordCount, 1);
  assert.equal(after.recentGames[0].result, "win");
  assert.equal(errors.length, 0);
});

test("ranked finish uses stable account keys after disconnect and room cleanup", async () => {
  const { c, errors } = context();
  seed(c, "p0", { ranked: { rating: 1800, wins: 5, losses: 0 } });
  seed(c, "p1");
  const r = room(c, 2);
  r.mode = "ranked";
  r.players.forEach(p => { p.connected = false; });
  c.bumpDaily = async () => {};
  c.bumpSeasonFor = async () => {};
  c.rollMoney = () => 5000;
  c.computeMoneyReward = base => base;
  await c.finishGame(r, 0, 1);
  assert.equal(c.playerCache.get("p1").ranked.losses, 11);
  assert.equal(c.playerCache.get("p1").ranked.wins, 50);
  /* 시드 기본값(bestStreak 7)이면 업적 '5연승'이 함께 해금되어 +5000이 붙는다 */
  assert.equal(c.playerCache.get("p1").money, 95000);
  /* 승자: 랭크 승리 보상 5000 + 업적 '5연승' 5000 + '첫 승리' 1000 */
  assert.equal(c.playerCache.get("p0").money, 101000);
  assert.equal(c.playerCache.get("p0").recentGames.length, 1);
  assert.equal(c.ROOMS.has(r.id), false);
  assert.equal(errors.length, 0);
});

test("last one-shot mission increment survives match rating and history writes", async () => {
  const { c, errors } = context();
  seed(c, "p0");
  seed(c, "p1");
  const r = room(c, 2);
  r.history = [];
  r.usedWords = new Set();
  r.currentWord = "가";
  r.players[1].hearts = 1;
  Object.assign(c, {
    WORD_SET: new Set(["가방"]), WORD_INDEX: new Map(), ATTACK_DEPTH: {},
    ONESHOT_FREE_TURNS: 1, hasWord: () => true, canConnect: () => true,
    getAttackDepth: () => null, getCandidates: () => [],
  });
  const finish = c.finishGame;
  let settlement;
  c.finishGame = (...args) => { settlement = finish(...args); return settlement; };
  const result = c.playWord(r, r.players[0], "가방", r.gameSessionId);
  assert.equal(result.ok, true);
  await settlement;
  const winner = c.playerCache.get("p0");
  assert.equal(winner.daily.oneShots, 1);
  assert.equal(winner.weekly.oneShots, 1);
  assert.equal(winner.monthly.oneShots, 1);
  assert.equal(winner.multi.wins, 13);
  assert.equal(winner.recentGames.length, 1);
  assert.equal(errors.length, 0);
});

test("failed import has no completion marker; retry preserves already imported accounts", async () => {
  const stored = new Map(), markers = [];
  let failSecond = true;
  const { c } = context({
    dbMode: "pg", jsonPath: "/fake/player-data.json",
    fs: { existsSync: () => true, readFileSync: () => JSON.stringify({
      first: { nickname: "first", money: 100 },
      second: { nickname: "second", money: 200 },
    }) },
    pgStoreGet: async () => null,
    dbPool: { async query(sql, values) {
      if (sql.includes("SELECT id")) return { rows: stored.has(values[0]) ? [{ id: values[0] }] : [] };
      if (sql.includes("INSERT INTO players")) {
        if (values[0] === "second" && failSecond) throw new Error("write failure");
        stored.set(values[0], { money: values[15] });
      } else markers.push(JSON.parse(values[1]));
      return { rows: [] };
    } },
  });
  await c.migrateJsonPlayersToPg();
  assert.equal(markers.length, 0);
  assert.equal(stored.get("first").money, 100);
  stored.get("first").money = 999; // Progress made after the partial import.
  failSecond = false;
  await c.migrateJsonPlayersToPg();
  assert.equal(stored.get("first").money, 999);
  assert.equal(stored.get("second").money, 200);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].imported, 1);
});

test("non-turn disconnect resumes turn timeout after grace period", () => {
  const { c, timers } = context();
  const r = room(c);
  c.startTurnTimer(r, r.gameSessionId);
  const s = socket("s2");
  c.registerOnline(s.id, "p2");
  installHandler(c, "disconnect", s);
  s.handlers.get("disconnect")("transport close");
  assert.equal(r.timer, null);
  timers.find(t => t.ms === 30000).fn();
  assert.equal(r.players[2].eliminated, true);
  assert.ok(r.timer);
  assert.equal(r.timer.ms, 20000);
  assert.equal(r.turnPlayerIndex, 0);
});

test("timer stays paused until all disconnected active players are resolved", () => {
  const { c, timers } = context();
  const r = room(c, 4);
  c.startTurnTimer(r, r.gameSessionId);
  for (const i of [2, 3]) {
    const s = socket(`s${i}`);
    c.registerOnline(s.id, `p${i}`);
    installHandler(c, "disconnect", s);
    s.handlers.get("disconnect")("transport close");
  }
  const grace = timers.filter(t => t.ms === 30000);
  grace[0].fn();
  assert.equal(r.timer, null);
  grace[1].fn();
  assert.ok(r.timer);
  assert.equal(c.getAlivePlayers(r).length, 2);
});

test("full room accepts a reconnect into its existing seat", () => {  const { c } = context();
  const r = room(c, 10);
  r.players[2].connected = false;
  c.disconnectedPlayers.set("s2", { timer: {}, roomId: r.id });
  const s = socket("new-s2");
  installHandler(c, "room:join", s);
  s.handlers.get("room:join")({ roomId: r.id, nickname: "p2" });
  assert.equal(r.players.length, 10);
  assert.equal(r.players[2].socketId, s.id);
  assert.equal(r.players[2].connected, true);
  assert.ok(s.emissions.some(([event, data]) => event === "room:joined" && data.reconnect));
  assert.ok(r.timer);
});

test("guest can set a display name without a Google session", async () => {
  const { c, errors } = context();
  const s = socket("anon");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "someone" });
  const hit = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.ok(hit);
  assert.equal(hit[1].ok, true);
  assert.equal(hit[1].nickname, "someone");
  assert.equal(c.socketNicks.get(s.id), "someone");
  assert.equal(c.playerCache.get("someone").nickname, "someone");
  assert.equal(c.playerCache.get("someone").firebaseUid, "");
  assert.equal(errors.length, 0);
});

test("display name already linked to another Google account is rejected", async () => {
  const { c } = context();
  seed(c, "taken", { firebaseUid: "uid-other" });
  const s = socket("mine");
  c.socketFirebaseUid.set(s.id, "uid-mine");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "Taken" });
  const hit = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.ok(hit);
  assert.equal(hit[1].ok, false);
  assert.match(String(hit[1].reason || ""), /이미 사용 중/);
  assert.equal(c.playerCache.get("taken").firebaseUid, "uid-other");
});

test("firebase token verification throws when service account is missing", async () => {  const { c } = context();
  await assert.rejects(c.verifyFirebaseIdToken("aaa.bbb.ccc"), /firebase_not_configured/);
});

test("firebase login without service account explains setup instead of crashing", async () => {
  const { c } = context();
  const s = socket("s9");
  installHandler(c, "player:firebaseAuth", s);
  await s.handlers.get("player:firebaseAuth")({ idToken: "aaa.bbb.ccc" });
  const hit = s.emissions.find(([event]) => event === "player:firebaseAuthResult");
  assert.ok(hit);
  assert.equal(hit[1].ok, false);
  assert.match(String(hit[1].reason || ""), /FIREBASE_SERVICE_ACCOUNT/);
});

/* =========================================================
   AI — 앞 N턴 공격/한방 금지 규칙 (조기 탈락 회귀)
   chooseAIWord가 turnNumber를 무시해 공격 단어를 고르면 playWord가 거부하고
   재시도도 거부되어 AI가 수를 못 내 타임아웃 하트를 잃는 조기 탈락이 발생했다.
========================================================= */
let _dict = null;
function dict() {
  if (_dict) return _dict;
  _dict = game.loadData(path.join(__dirname, "../data"), path.join(__dirname, ".."));
  return _dict;
}

let _fixture = null;
/* 공격 단어 후보와 안전(비공격·비한방) 후보를 함께 가진 위치 — 실제 사전에서 탐색 */
function attackFixture() {
  if (_fixture) return _fixture;
  const d = dict();
  let examined = 0;
  scan:
  for (const arr of d.WORD_INDEX.values()) {
    for (const w of arr) {
      if (++examined > 40000) break scan;
      const used = new Set([w]);
      const cands = game.getCandidates(w, used, d.WORD_INDEX);
      if (cands.length < 6) continue;
      let atk = 0, safe = 0;
      for (const x of cands) {
        if (Number.isFinite(d.ATTACK_DEPTH[x])) atk++;
        else if (!game.isOneShot(x, used, d.WORD_INDEX)) safe++;
      }
      if (atk >= 1 && safe >= 3) { _fixture = { word: w }; break scan; }
    }
  }
  assert.ok(_fixture, "사전에서 공격 단어 후보가 있는 지점을 찾지 못했습니다");
  return _fixture;
}

function aiGlobals(extra = {}) {
  const d = dict();
  return {
    WORD_SET: d.WORD_SET, WORD_INDEX: d.WORD_INDEX, ATTACK_DEPTH: d.ATTACK_DEPTH,
    ROOT_WORDS: d.ROOT_WORDS, RARE_ROOT_WORDS: d.RARE_ROOT_WORDS,
    DEFENSE_WORDS: d.DEFENSE_WORDS, DOLRIM_WORDS: d.DOLRIM_WORDS,
    getCandidates: game.getCandidates, canConnect: game.canConnect,
    hasWord: game.hasWord, isAttackWord: game.isAttackWord,
    isOneShot: game.isOneShot, getAttackDepth: game.getAttackDepth,
    allowedFirstChars: game.allowedFirstChars, normalizeWord: game.normalizeWord,
    MAX_HEARTS: 2, MISTAKES_PER_LIFE: 5, HINTS_PER_GAME: 5,
    STARTING_SYLLABLES: ["가", "기", "나", "다", "사", "마", "자", "시"],
    ...extra,
  };
}

test("chooseAIWord never returns attack or one-shot words before free turns end", () => {
  const d = dict();
  const fx = attackFixture();
  const used = new Set([fx.word]);
  for (let i = 0; i < 12; i++) {
    const word = game.chooseAIWord(fx.word, used, d.WORD_SET, d.WORD_INDEX, d.ATTACK_DEPTH,
      d.ROOT_WORDS, 1, d.DEFENSE_WORDS, d.RARE_ROOT_WORDS, d.DOLRIM_WORDS, { freeTurns: 3 });
    assert.ok(word, "free-turn 금지로 수를 아예 못 내면 안 됩니다");
    assert.equal(game.isAttackWord(word, d.ATTACK_DEPTH), false,
      `free-turn 중 공격 단어 '${word}'를 냈습니다`);
    assert.equal(game.isOneShot(word, used, d.WORD_INDEX), false,
      `free-turn 중 한방 단어 '${word}'를 냈습니다`);
  }
});

test("runAI forwards the free-turn ban and never submits a banned word", () => {
  const d = dict();
  const fx = attackFixture();
  const seen = { opts: null };
  const { c } = context(aiGlobals({
    ONESHOT_FREE_TURNS: 3,
    chooseAIWord: (...args) => { seen.opts = args[10]; return game.chooseAIWord(...args); },
    chooseAIStartWord: (...args) => game.chooseAIStartWord(...args),
  }));
  const room = {
    id: "r-ai", mode: "ai", difficulty: "normal", hostSocketId: "h",
    players: [
      { id: "h", socketId: "h", playerIndex: 0, nickname: "사람", isBot: false,
        hearts: 2, alive: true, eliminated: false, connected: true, waiting: false, mistakes: 0 },
      { id: "bot", socketId: "bot", playerIndex: 1, nickname: "AI", isBot: true,
        hearts: 2, alive: true, eliminated: false, connected: true, waiting: false, mistakes: 0 },
    ],
    turnPlayerIndex: 1, turnNumber: 1, gameSessionId: 1,
    started: true, finished: false, winner: null, loser: null,
    currentWord: fx.word, startSyllable: null, lastSyllable: null,
    usedWords: new Set([fx.word]),
    history: [{ word: fx.word, player: 0, nickname: "사람", depth: null, turn: 0 }],
    hintsUsed: 0,
  };
  c.runAI(room, room.gameSessionId);
  assert.ok(seen.opts, "chooseAIWord가 호출되지 않았습니다");
  assert.equal(seen.opts.freeTurns, 3, "server가 ONESHOT_FREE_TURNS를 선택기에 전달해야 합니다");
  assert.equal(room.history.length, 2, "AI가 실제로 단어를 제출해야 합니다(수 미제출 = 타임아웃 조기 탈락)");
  const played = room.history[1].word;
  assert.equal(game.isAttackWord(played, d.ATTACK_DEPTH), false,
    `free-turn 중 공격 단어 '${played}'를 제출했습니다`);
  assert.equal(game.isOneShot(played, room.usedWords, d.WORD_INDEX), false,
    `free-turn 중 한방 단어 '${played}'를 제출했습니다`);
  assert.equal(room.finished, false);
});

/* =========================================================
   커스텀 사전 — 승인 단어가 곧바로 게임 사전에 반영되는가
========================================================= */
test("approved custom word becomes playable immediately", async () => {
  const word = "코끼리사과";
  const { c } = context(aiGlobals({
    customWords: { pending: [], approved: [], rejected: [] },
    saveCustomWords() {},
    emitCustomWords() {},
    requireNickname: async () => ({ ok: true, nickname: "admin", role: "super" }),
  }));
  assert.equal(c.hasWord(word, c.WORD_SET), false, "테스트 단어는 원래 사전에 없어야 합니다");

  const user = socket("word-user");
  c.socketNicks.set(user.id, "신청자");
  /* 실제 applyCustomWord와 동일: 승인 즉시 WORD_SET/WORD_INDEX에 반영 */
  c.applyCustomWord = (w) => {
    c.WORD_SET.add(w);
    const first = w[0];
    if (!c.WORD_INDEX.has(first)) c.WORD_INDEX.set(first, []);
    c.WORD_INDEX.get(first).push(w);
  };
  installHandler(c, "word:request", user);
  await user.handlers.get("word:request")({ word });
  const requested = user.emissions.find(([event]) => event === "word:requestResult");
  assert.ok(requested && requested[1].ok, "단어 신청이 접수되어야 합니다");
  assert.equal(c.customWords.pending.length, 1);

  const admin = socket("word-admin");
  installHandler(c, "admin:wordApprove", admin);
  await admin.handlers.get("admin:wordApprove")({ word });
  assert.equal(c.customWords.pending.length, 0, "승인되면 대기에서 빠져야 합니다");
  assert.deepEqual(c.customWords.approved, [word]);
  assert.equal(c.hasWord(word, c.WORD_SET), true,
    "승인 직후 게임 사전(WORD_SET)에 반영되어 모든 유저가 쓸 수 있어야 합니다");
});

/* =========================================================
   랭크 보호 티켓 / 복귀 환영 보상 / 레이팅 추이 기록
========================================================= */
test("ranked loss consumes shield ticket and keeps loser rating", async () => {
  const { c } = context();
  seed(c, "winner", { ranked: { rating: 1800, wins: 5, losses: 0 } });
  seed(c, "loser", { shieldTickets: 2 });
  const before = c.playerCache.get("loser").ranked.rating;
  const res = await c.updateRating("winner", "loser", "winner", "loser", "ranked");
  const after = c.playerCache.get("loser");
  assert.equal(after.shieldTickets, 1, "티켓 1장이 소모되어야 합니다");
  assert.equal(after.ranked.rating, before, "보호 중이므로 레이팅이 그대로여야 합니다");
  assert.equal(res.loserProtected, true, "보호 적용 사실이 반환되어야 합니다");
  assert.equal(after.ranked.losses, 11, "패배 전적은 그대로 기록됩니다");
  assert.equal(after.ranked.streak, 0, "연승은 초기화됩니다");
});

test("shield ticket is not consumed in multi mode", async () => {
  const { c } = context();
  seed(c, "winner");
  seed(c, "loser", { shieldTickets: 3 });
  await c.updateRating("winner", "loser", "winner", "loser", "multi");
  const after = c.playerCache.get("loser");
  assert.equal(after.shieldTickets, 3, "멀티 모드에서는 소모되지 않습니다");
});

test("welcome reward pays after a 3-day gap and never twice a day", () => {
  const { c } = context();   /* getKstDate = "2026-10-04" 고정 */
  const pd = c.migratePlayerData({ nickname: "a", money: 0, lastSeen: "2026-10-01" });
  const emissions = [];
  const socket = { emit: (...args) => emissions.push(args) };
  const amount = c.applyWelcomeReward(pd, socket);
  assert.equal(amount, 3 * 2000, "3일 공백 × 2000원");
  assert.equal(pd.money, 6000);
  assert.equal(pd.lastSeen, "2026-10-04");
  assert.ok(emissions.some(([e]) => e === "welcome:reward"), "보상 이벤트가 전송되어야 합니다");
  const again = c.applyWelcomeReward(pd, socket);
  assert.equal(again, null, "같은 날 재접속 시 중복 지급되지 않습니다");
  const fresh = c.migratePlayerData({ nickname: "b", money: 0 });
  assert.equal(c.applyWelcomeReward(fresh, socket), null, "최초 접속은 날짜만 기록");
  assert.equal(fresh.lastSeen, "2026-10-04");
});

test("rating history keeps one snapshot per day for ranked and multi", async () => {
  const { c } = context();
  seed(c, "winner");
  seed(c, "loser");
  await c.updateRating("winner", "loser", "winner", "loser", "ranked");
  await c.updateRating("winner", "loser", "winner", "loser", "multi");
  const w = c.playerCache.get("winner");
  assert.equal(w.ratingHistory.length, 1, "같은 날은 하루 1점으로 갱신됩니다");
  assert.equal(w.ratingHistory[0].d, "2026-10-04");
  assert.ok(Number.isFinite(w.ratingHistory[0].r) && Number.isFinite(w.ratingHistory[0].m));
});

/* =========================================================
   2v2 파티 모드 — 팀 배정 / 팀 승패 / 레이팅
========================================================= */
function partyRoom(nicknames = ["pa1", "pb1", "pa2", "pb2"]) {
  const room = {
    id: "PTY01", mode: "party", hostSocketId: "s1",
    players: [], history: [], usedWords: new Set(),
    started: true, finished: false, turnPlayerIndex: 0, turnNumber: 1,
    gameSessionId: 7, hintsUsed: 0, timer: null,
    turnStartedAt: null, turnEndsAt: null, currentWord: null,
    pendingMissionWrites: null
  };
  const teams = [0, 1, 0, 1];
  nicknames.forEach((n, i) => {
    room.players.push({
      id: `s${i + 1}`, socketId: `s${i + 1}`, playerIndex: i,
      nickname: n, isBot: false, alive: true, connected: true,
      hearts: 3, eliminated: false, mistakes: 0, waiting: false, teamOf: teams[i]
    });
  });
  return room;
}

test("party seats alternate teams (A,B,A,B) and stop at four players", () => {
  const { c } = context();
  const room = { id: "p1", mode: "party", players: [] };
  const a = c.addPlayer(room, "s1", "alpha", { teamOf: 0 });
  const b = c.addPlayer(room, "s2", "bravo");
  const d = c.addPlayer(room, "s3", "charlie");
  const e = c.addPlayer(room, "s4", "delta");
  assert.deepEqual([a.teamOf, b.teamOf, d.teamOf, e.teamOf], [0, 1, 0, 1], "팀이 번갈아 배정되어야 합니다");
  assert.deepEqual([a.playerIndex, b.playerIndex, d.playerIndex, e.playerIndex], [0, 1, 2, 3], "좌석은 인터리브 순서여야 합니다");
  assert.equal(c.addPlayer(room, "s5", "fifth"), null, "정원 4명 초과 시 입장 거절");
});

test("party capacity is 4 regardless of MAX_PLAYERS", () => {
  const { c } = context();
  assert.equal(c.roomCapacity({ mode: "party" }), 4);
  assert.equal(c.roomCapacity({ mode: "online" }), c.MAX_PLAYERS);
  assert.equal(c.roomCapacity(null), c.MAX_PLAYERS);
});

test("party ends only when an entire team is eliminated", async () => {
  const { c, errors } = context();
  const room = partyRoom();
  assert.equal(c.checkPartyEnd(room), false, "양 팀 모두 생존이면 계속 진행");

  room.players[1].eliminated = true;
  room.players[1].alive = false;
  assert.equal(c.checkPartyEnd(room), false, "팀 중 한 명만 탈락해도 계속 진행");

  room.players[3].eliminated = true;
  room.players[3].alive = false;
  assert.equal(c.checkPartyEnd(room), true, "한 팀이 전멸하면 종료 처리");
  assert.equal(room.finished, true);
  assert.equal(room.players[room.winner].teamOf, 0, "승자는 생존 팀(0번) 소속이어야 합니다");

  await new Promise(r => setImmediate(r));
  assert.equal(errors.length, 0);
});

test("party rating pairs match each winner against a loser of the other team", () => {
  const { c } = context();
  const room = partyRoom();
  const jp = v => JSON.parse(JSON.stringify(v));
  assert.deepEqual(jp(c.partyResultPairs(room, 0)), [[0, 1], [2, 3]]);
  assert.deepEqual(jp(c.partyResultPairs(room, 1)), [[1, 0], [3, 2]]);
  assert.deepEqual(jp(c.partyResultPairs(room, null)), [], "무승부는 페어 없음");
  assert.deepEqual(jp(c.partyResultPairs({ mode: "online", players: room.players }, 0)), [], "비파티는 페어 없음");
});

test("party start requires one connected player per team", () => {
  const { c } = context();
  const room = partyRoom();
  const eligible = room.players;
  assert.equal(c.partyReadyError(room, eligible), null);
  assert.equal(c.partyReadyError({ mode: "online", players: room.players }, [room.players[0]]), null, "비파티는 검사 없음");
  const onlyA = [room.players[0], room.players[2]];
  assert.match(String(c.partyReadyError(room, onlyA)), /각 팀/);
});

test("party win rates up both teammates and down both opponents", async () => {
  const { c, errors } = context();
  for (const n of ["pa1", "pb1", "pa2", "pb2"]) seed(c, n);
  const room = partyRoom();
  const before = n => c.playerCache.get(n).multi.rating;
  const b = { pa1: before("pa1"), pb1: before("pb1"), pa2: before("pa2"), pb2: before("pb2") };

  await c.finishGame(room, 0, 1);
  await new Promise(r => setImmediate(r));

  assert.ok(c.playerCache.get("pa1").multi.rating > b.pa1, "승팀 1 레이팅 상승");
  assert.ok(c.playerCache.get("pa2").multi.rating > b.pa2, "승팀 2 레이팅 상승");
  assert.ok(c.playerCache.get("pb1").multi.rating < b.pb1, "패팀 1 레이팅 하락");
  assert.ok(c.playerCache.get("pb2").multi.rating < b.pb2, "패팀 2 레이팅 하락");

  const hist = c.playerCache.get("pa2").recentGames;
  assert.equal(hist.length, 1, "팀원 전원에게 전적이 기록됩니다");
  assert.equal(hist[0].result, "win");
  assert.equal(hist[0].mode, "party");
  const histB = c.playerCache.get("pb2").recentGames;
  assert.equal(histB[0].result, "lose");
  assert.equal(errors.length, 0, "오류 없이 처리되어야 합니다");
});

/* =========================================================
   업적 — 해금/보상/전적 집계
========================================================= */
test("achievement unlocks once, pays its coin, and never repeats", () => {
  const { c } = context();
  const pd = c.migratePlayerData({ nickname: "ach", money: 100 });
  assert.equal(c.evaluateAchievements(pd).length, 0, "조건 미충족이면 해금 없음");

  c.achievementStats(pd).wins = 1;
  const got = c.evaluateAchievements(pd);
  assert.equal(got.length, 1, "첫 승리 업적이 해금되어야 합니다");
  assert.equal(got[0].id, "first_win");
  assert.equal(pd.money, 1100, "보상 코인이 지급되어야 합니다");
  assert.ok(pd.achievements.first_win);

  assert.equal(c.evaluateAchievements(pd).length, 0, "이미 해금된 업적은 다시 해금되지 않습니다");
  assert.equal(pd.money, 1100, "보상도 중복 지급되지 않습니다");
});

test("game end feeds achievement counters (wins, words, longest, oneshots)", async () => {
  const { c, errors } = context();
  const pd = c.migratePlayerData({ nickname: "hong", money: 0 });
  c.playerCache.set("hong", pd);
  const room = {
    id: "R1", mode: "online", hostSocketId: "s1",
    players: [
      { id: "s1", socketId: "s1", playerIndex: 0, nickname: "hong", isBot: false, hearts: 3, eliminated: false, waiting: false, connected: true },
      { id: "s2", socketId: "s2", playerIndex: 1, nickname: "kim", isBot: false, hearts: 0, eliminated: true, waiting: false, connected: true }
    ],
    history: [
      { word: "시작음절", player: -1, nickname: "시작", depth: null, turn: 0 },
      { word: "사랑해요한글단어", player: 0, nickname: "hong", depth: null, turn: 1 },
      { word: "한방단어다", player: 0, nickname: "hong", depth: null, turn: 2, oneShot: true },
      { word: "이어지는말", player: 1, nickname: "kim", depth: null, turn: 3 }
    ]
  };
  await c.recordMatchHistory(room, 0, 1);
  await new Promise(r => setImmediate(r));

  const after = c.playerCache.get("hong");
  assert.equal(after.ach.games, 1, "판 수 1회 누적");
  assert.equal(after.ach.wins, 1, "승리 1회 누적");
  assert.equal(after.ach.words, 2, "본인 단어 수만 누적");
  assert.equal(after.ach.oneshots, 1, "한방 성공 누적");
  assert.equal(after.ach.longest, 8, "최장 단어 길이 갱신");
  assert.ok(after.achievements.first_win, "첫 승리 업적 해금");
  assert.ok(after.achievements.long8, "8글자 단어 업적 해금");
  assert.equal(after.recentGames[0].result, "win");
  assert.equal(after.recentGames[0].mode, "online");
  assert.equal(errors.length, 0, "오류 없이 처리되어야 합니다");
});

test("achievements list reports unlocked and locked state", async () => {
  const { c } = context();
  const s = socket("s-ach");
  c.socketNicks.set(s.id, "hong");
  seed(c, "hong", {
    achievements: { first_win: "2026-10-01T00:00:00.000Z" },
    ach: { games: 3, wins: 1, words: 5, oneshots: 0, longest: 4, partyWins: 0, streak: 0 }
  });
  installHandler(c, "achievements:list", s);
  await s.handlers.get("achievements:list")();
  const msg = s.emissions.at(-1);
  assert.equal(msg[0], "achievements:list");
  const body = msg[1];
  assert.equal(body.ok, true);
  const fw = body.list.find(d => d.id === "first_win");
  assert.ok(fw && fw.unlockedAt, "해금된 업적은 시각과 함께 반환");
  const w10 = body.list.find(d => d.id === "win10");
  assert.ok(w10 && !w10.unlockedAt, "미해금 업적은 unlockedAt 없음");
  assert.ok(body.unlockedCount >= 1);
  assert.equal(body.totals.wins, 1);
});

/* =========================================================
   이모지 리액션 — 허용 목록 / 뮤트 / 속도 제한
========================================================= */
function reactRoom(nick = "hong") {
  return { id: "RR1", players: [{ id: "s-r1", socketId: "s-r1", playerIndex: 0, nickname: nick, isBot: false }] };
}

test("emoji reaction is broadcast to the room", () => {
  const room = reactRoom();
  const { c, emissions } = context({ getPlayerRoom: () => room });
  const s = socket("s-r1");
  installHandler(c, "game:react", s);
  s.handlers.get("game:react")({ emoji: "🔥" });
  assert.equal(emissions.length, 1, "방 전체에 브로드캐스트되어야 합니다");
  assert.equal(emissions[0][0], "game:react");
  assert.equal(emissions[0][1].emoji, "🔥");
  assert.equal(emissions[0][1].from, "hong");
  assert.equal(emissions[0][1].roomId, "RR1");
  assert.equal(s.emissions.length, 0, "오류 응답은 없어야 합니다");
});

test("reaction with a non-allowlisted emoji is rejected", () => {
  const room = reactRoom();
  const { c, emissions } = context({ getPlayerRoom: () => room });
  const s = socket("s-r1");
  installHandler(c, "game:react", s);
  s.handlers.get("game:react")({ emoji: "💣" });
  assert.equal(emissions.length, 0, "허용되지 않은 이모지는 브로드캐스트 금지");
  assert.equal(s.emissions[0][0], "react:error");
  assert.match(String(s.emissions[0][1].reason), /이모지/);
});

test("muted player cannot send emoji reactions", () => {
  const room = reactRoom("mutedUser");
  const { c, emissions } = context({ getPlayerRoom: () => room });
  const normKey = vm.runInContext("normKey", c);
  c.mutedMap.set(normKey("mutedUser"), { nick: "mutedUser", by: "admin", at: Date.now(), reason: "도배" });
  const s = socket("s-r1");
  installHandler(c, "game:react", s);
  s.handlers.get("game:react")({ emoji: "👍" });
  assert.equal(emissions.length, 0, "뮤트 상태면 브로드캐스트 금지");
  assert.equal(s.emissions[0][0], "react:error");
  assert.match(String(s.emissions[0][1].reason), /차단/);
});

test("reactions are rate limited per socket", () => {
  const room = reactRoom();
  const { c, emissions } = context({ getPlayerRoom: () => room });
  const s = socket("s-r1");
  installHandler(c, "game:react", s);
  s.handlers.get("game:react")({ emoji: "👍" });
  s.handlers.get("game:react")({ emoji: "🔥" });
  assert.equal(emissions.length, 1, "연속 요청은 조용히 무시되어야 합니다");
  assert.equal(s.emissions.length, 0, "속도 제한은 오류가 아니라 무시로 처리");
});

/* =========================================================
   레퍼럴(추천인) — 등록 / 중복 / 본인 / 존재하지 않는 닉네임
========================================================= */
test("referral registration rewards both sides once", async () => {
  const { c, errors } = context();
  const joinCoin = vm.runInContext("REFERRAL_JOIN_COIN", c);
  const inviteCoin = vm.runInContext("REFERRAL_INVITE_COIN", c);
  seed(c, "kate");
  seed(c, "tom");
  const s = socket("s-ref1");
  c.socketNicks.set(s.id, "tom");
  installHandler(c, "referral:register", s);
  await s.handlers.get("referral:register")({ nickname: "kate" });

  const tomPd = c.playerCache.get("tom");
  const katePd = c.playerCache.get("kate");
  assert.equal(tomPd.referredBy, "kate", "피추천인에게 추천인이 기록됩니다");
  assert.ok(tomPd.referredAt, "등록 시각이 기록됩니다");
  assert.equal(tomPd.money, 90000 + joinCoin, "피추천인은 즉시 코인을 받습니다");
  assert.equal(katePd.referralCount, 1, "추천인은 누적 횟수가 오릅니다");
  assert.equal(katePd.money, 90000 + inviteCoin, "추천인도 코인을 받습니다");

  const msg = s.emissions.at(-1);
  assert.equal(msg[0], "referral:result");
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].referredBy, "kate");
  assert.equal(msg[1].coin, joinCoin);
  assert.equal(msg[1].money, tomPd.money);
  assert.equal(errors.length, 0, "오류 없이 처리되어야 합니다");
});

test("referral registration is rejected when already registered", async () => {
  const { c } = context();
  seed(c, "kate");
  seed(c, "tom", { referredBy: "kate", money: 91000 });
  const s = socket("s-ref2");
  c.socketNicks.set(s.id, "tom");
  installHandler(c, "referral:register", s);
  await s.handlers.get("referral:register")({ nickname: "kate" });

  const tomPd = c.playerCache.get("tom");
  assert.equal(tomPd.referredBy, "kate", "기존 추천인이 유지됩니다");
  assert.equal(tomPd.money, 91000, "중복 등록 시 추가 보상이 없습니다");
  const msg = s.emissions.at(-1);
  assert.equal(msg[0], "referral:result");
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /이미/);
});

test("referral registration rejects self as referrer", async () => {
  const { c } = context();
  seed(c, "hong");
  const s = socket("s-ref3");
  c.socketNicks.set(s.id, "hong");
  installHandler(c, "referral:register", s);
  await s.handlers.get("referral:register")({ nickname: "hong" });

  const pd = c.playerCache.get("hong");
  assert.equal(pd.referredBy, undefined, "본인 추천은 기록되지 않습니다");
  assert.equal(pd.money, 90000, "보상이 지급되지 않습니다");
  const msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /자기 자신/);
});

test("referral registration rejects unknown referrer nickname", async () => {
  const { c } = context();
  seed(c, "tom");
  const s = socket("s-ref4");
  c.socketNicks.set(s.id, "tom");
  installHandler(c, "referral:register", s);
  await s.handlers.get("referral:register")({ nickname: "없는사람" });

  const pd = c.playerCache.get("tom");
  assert.equal(pd.referredBy, undefined, "존재하지 않는 추천인은 기록되지 않습니다");
  assert.equal(pd.money, 90000, "보상이 지급되지 않습니다");
  const msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /존재하지/);
});

test("referral status reports current registration state", async () => {
  const { c } = context();
  seed(c, "tom", { referredBy: "kate", referralCount: 3 });
  const s = socket("s-ref5");
  c.socketNicks.set(s.id, "tom");
  installHandler(c, "referral:status", s);
  await s.handlers.get("referral:status")();

  const msg = s.emissions.at(-1);
  assert.equal(msg[0], "referral:status");
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].referredBy, "kate");
  assert.equal(msg[1].count, 3);
  assert.ok(msg[1].joinCoin > 0 && msg[1].inviteCoin > 0);
});

/* =========================================================
   PG extras — 컬럼 외 필드(업적/추천인/쪽지) 영속화
========================================================= */
test("PG save persists non-column fields through extras JSON", async () => {
  const calls = [];
  const { c } = context({
    dbMode: "pg",
    dbPool: { async query(sql, values) { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; } }
  });
  seed(c, "kate", {
    achievements: { first_win: "2026-10-01T00:00:00.000Z" },
    referredBy: "lee", referralCount: 2,
    mail: [{ id: "m1", title: "보상", coin: 500, read: false }]
  });
  await c.savePlayerData("kate", c.playerCache.get("kate"));

  const call = calls.find(x => /INSERT INTO players/.test(x.sql));
  assert.ok(call, "upsert 쿼리가 실행되어야 합니다");
  assert.match(call.sql, /extras=\$34/);
  const extras = JSON.parse(call.values[33]);
  assert.equal(extras.referredBy, "lee");
  assert.equal(extras.referralCount, 2);
  assert.ok(extras.achievements && extras.achievements.first_win);
  assert.ok(Array.isArray(extras.mail) && extras.mail[0].id === "m1");
  assert.equal(extras.money, undefined, "컬럼 필드는 extras에 포함되지 않는다");
  assert.equal(extras.nickname, undefined, "닉네임은 extras에 포함되지 않는다");
});

/* =========================================================
   공지 · 우편(쪽지) — 전체 공지 / 쪽지 발송·목록·수령
========================================================= */
test("admin notice broadcasts to every connected client", async () => {
  const { c, emissions } = context();
  const s = socket("s-notice");
  installHandler(c, "admin:notice", s);
  await s.handlers.get("admin:notice")({ text: "  점검 공지입니다  " });

  const global = emissions.find(e => e[0] === "notice:global");
  assert.ok(global, "전체 공지가 broadcast되어야 합니다");
  assert.equal(global[1].text, "점검 공지입니다");
  const res = s.emissions.at(-1);
  assert.equal(res[0], "admin:noticeResult");
  assert.equal(res[1].ok, true);
});

test("admin notice rejects empty text", async () => {
  const { c, emissions } = context();
  const s = socket("s-notice2");
  installHandler(c, "admin:notice", s);
  await s.handlers.get("admin:notice")({ text: "   " });
  assert.equal(emissions.length, 0, "빈 공지는 broadcast되지 않는다");
  const res = s.emissions.at(-1);
  assert.equal(res[1].ok, false);
  assert.match(String(res[1].reason), /공지 내용/);
});

test("admin mail send stores entry with coin in target inbox", async () => {
  const { c } = context();
  seed(c, "kate");
  const s = socket("s-mail1");
  installHandler(c, "admin:mailSend", s);
  await s.handlers.get("admin:mailSend")({ nickname: "kate", title: " 이벤트 보상 ", body: "참여 감사", coin: 1500 });

  const kate = c.playerCache.get("kate");
  assert.ok(Array.isArray(kate.mail) && kate.mail.length === 1, "쪽지가 저장되어야 합니다");
  assert.equal(kate.mail[0].title, "이벤트 보상");
  assert.equal(kate.mail[0].coin, 1500);
  assert.equal(kate.mail[0].read, false);
  const res = s.emissions.at(-1);
  assert.equal(res[0], "admin:mailResult");
  assert.equal(res[1].ok, true);
});

test("admin mail send trims oldest read entries above MAIL_MAX", async () => {
  const { c } = context();
  const max = vm.runInContext("MAIL_MAX", c);
  const old = Array.from({ length: max }, (_, i) => ({
    id: `old-${i}`, title: `오래된쪽지${i}`, coin: 0, at: "", read: true
  }));
  seed(c, "kate", { mail: old });
  const s = socket("s-mail2");
  installHandler(c, "admin:mailSend", s);
  await s.handlers.get("admin:mailSend")({ nickname: "kate", title: "새쪽지", coin: 10 });

  const kate = c.playerCache.get("kate");
  assert.equal(kate.mail.length, max, "보관 상한을 넘지 않는다");
  assert.equal(kate.mail[0].title, "새쪽지", "새 쪽지는 맨 앞에 온다");
  assert.equal(kate.mail.filter(m => m.id === "old-0").length, 0, "가장 오래된 읽은 쪽지부터 제거된다");
});

test("admin mail send rejects unknown nickname", async () => {
  const { c } = context();
  const s = socket("s-mail3");
  installHandler(c, "admin:mailSend", s);
  await s.handlers.get("admin:mailSend")({ nickname: "없는사람", title: "쪽지", coin: 10 });
  const res = s.emissions.at(-1);
  assert.equal(res[1].ok, false);
  assert.match(String(res[1].reason), /존재하지/);
});

test("mail list returns entries with unread count and claim pays coin once", async () => {
  const { c } = context();
  seed(c, "kate", {
    money: 5000,
    mail: [
      { id: "m-unread", title: "포상", body: "수고하셨습니다", coin: 800, at: "2026-10-01T00:00:00.000Z", read: false },
      { id: "m-read", title: "지난쪽지", body: "", coin: 100, at: "2026-09-01T00:00:00.000Z", read: true }
    ]
  });
  const s = socket("s-mail4");
  c.socketNicks.set(s.id, "kate");
  installHandler(c, "mail:list", s);
  installHandler(c, "mail:claim", s);

  await s.handlers.get("mail:list")();
  let msg = s.emissions.at(-1);
  assert.equal(msg[0], "mail:list");
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].mail.length, 2);
  assert.equal(msg[1].unread, 1);
  assert.equal(msg[1].mail[0].title, "포상");

  await s.handlers.get("mail:claim")({ id: "m-unread" });
  msg = s.emissions.at(-1);
  assert.equal(msg[0], "mail:claim");
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].coin, 800);
  const kate = c.playerCache.get("kate");
  assert.equal(kate.money, 5800, "쪽지 코인이 지급된다");
  assert.equal(kate.mail.find(m => m.id === "m-unread").read, true);
  assert.equal(msg[1].unread, 0);

  await s.handlers.get("mail:claim")({ id: "m-unread" });
  msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, false, "이미 수령한 쪽지는 다시 수령할 수 없다");
  assert.equal(c.playerCache.get("kate").money, 5800, "중복 수령 시 추가 지급 없음");
});

/* =========================================================
   길드/클랜 — 생성 / 가입 / 승계 / 추방 / 해산
========================================================= */
test("guild creation deducts fee and sets leader", async () => {
  const { c } = context();
  seed(c, "kate", { money: 90000 });
  const s = socket("s-g1");
  c.socketNicks.set(s.id, "kate");
  installHandler(c, "guild:create", s);
  await s.handlers.get("guild:create")({ name: "호랑이 길드" });

  const g = c.guildCache["호랑이길드"];
  assert.ok(g, "길드 캐시에 저장된다 (키는 공백 없는 정규화)");
  assert.equal(g.leader, "kate");
  assert.equal(g.members.length, 1);
  assert.equal(c.playerCache.get("kate").money, 80000, "생성비가 차감된다");
  const msg = s.emissions.at(-1);
  assert.equal(msg[0], "guild:state");
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].guild.name, "호랑이 길드");
  assert.equal(msg[1].guild.isLeader, true);
  assert.equal(msg[1].money, 80000);
});

test("guild creation is blocked for members and for broke players", async () => {
  const { c } = context();
  seed(c, "kate", { money: 100 });
  c.applyGuilds({ existing: { name: "기존길드", leader: "kate", members: [{ key: "kate", nick: "kate" }] } });
  const s1 = socket("s-g2a");
  c.socketNicks.set(s1.id, "kate");
  installHandler(c, "guild:create", s1);
  await s1.handlers.get("guild:create")({ name: "새길드" });
  let msg = s1.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /이미 길드/);

  const { c: c2 } = context();
  seed(c2, "poor", { money: 100 });
  const s2 = socket("s-g2b");
  c2.socketNicks.set(s2.id, "poor");
  installHandler(c2, "guild:create", s2);
  await s2.handlers.get("guild:create")({ name: "새길드" });
  msg = s2.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /필요/);
  assert.equal(Object.keys(c2.guildCache || {}).length, 0, "실패 시 길드가 만들어지지 않는다");
  assert.equal(c2.playerCache.get("poor").money, 100, "실패 시 생성비가 차감되지 않는다");
});

test("player joins an existing guild and member list shows online state", async () => {
  const { c } = context();
  seed(c, "kate"); seed(c, "tom");
  c.onlineNicks.set("kate", "s-ga");
  const s1 = socket("s-ga"); c.socketNicks.set(s1.id, "kate");
  const s2 = socket("s-gb"); c.socketNicks.set(s2.id, "tom");
  installHandler(c, "guild:create", s1);
  installHandler(c, "guild:join", s2);
  await s1.handlers.get("guild:create")({ name: "선착순" });
  await s2.handlers.get("guild:join")({ name: "선착순" });

  const g = c.guildCache["선착순"];
  assert.equal(g.members.length, 2, "가입하면 멤버가 늘어난다");
  const msg = s2.emissions.at(-1);
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].guild.isLeader, false);
  assert.equal(msg[1].guild.memberCount, 2);
  const kateMember = msg[1].guild.members.find(m => m.key === "kate");
  assert.ok(kateMember, "기존 멤버가 목록에 있다");
  assert.equal(kateMember.online, true, "온라인 멤버는 온라인 표시");
  assert.equal(kateMember.leader, true, "리더 표시");
});

test("guild join rejects unknown, duplicate membership, and full guilds", async () => {
  const { c } = context();
  seed(c, "tom");
  const s = socket("s-g3");
  c.socketNicks.set(s.id, "tom");
  installHandler(c, "guild:join", s);

  await s.handlers.get("guild:join")({ name: "없는길드" });
  let msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /존재하지/);

  c.applyGuilds({
    "내길드": { name: "내길드", leader: "tom", members: [{ key: "tom", nick: "tom" }] },
    "가득찬길드": {
      name: "가득찬길드", leader: "other",
      members: [{ key: "other", nick: "other" },
        ...Array.from({ length: 29 }, (_, i) => ({ key: `m${i}`, nick: `m${i}` }))]
    }
  });
  await s.handlers.get("guild:join")({ name: "가득찬길드" });
  msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /이미 길드/, "이미 가입 상태면 거부");

  const { c: c2 } = context();
  seed(c2, "alice");
  const s2 = socket("s-g3b");
  c2.socketNicks.set(s2.id, "alice");
  installHandler(c2, "guild:join", s2);
  c2.applyGuilds({
    "가득찬길드": {
      name: "가득찬길드", leader: "other",
      members: [{ key: "other", nick: "other" },
        ...Array.from({ length: 29 }, (_, i) => ({ key: `m${i}`, nick: `m${i}` }))]
    }
  });
  await s2.handlers.get("guild:join")({ name: "가득찬길드" });
  msg = s2.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /가득/, "정원이 차면 거부");
});

test("leader leaving promotes the next member; last member leaving disbands", async () => {
  const { c } = context();
  seed(c, "kate"); seed(c, "tom");
  c.applyGuilds({ g1: { name: "해체위기", leader: "kate", members: [
    { key: "kate", nick: "kate" }, { key: "tom", nick: "tom" }
  ] } });
  const s1 = socket("s-gl1"); c.socketNicks.set(s1.id, "kate");
  installHandler(c, "guild:leave", s1);
  await s1.handlers.get("guild:leave")();

  const g = c.guildCache["g1"];
  assert.equal(g.members.length, 1, "리더가 나가면 멤버가 줄어든다");
  assert.equal(g.leader, "tom", "다음 멤버가 리더를 승계한다");
  let msg = s1.emissions.at(-1);
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].guild, null, "나간 뒤 내 길드는 없음");

  const s2 = socket("s-gl2"); c.socketNicks.set(s2.id, "tom");
  installHandler(c, "guild:leave", s2);
  await s2.handlers.get("guild:leave")();
  assert.equal(c.guildCache["g1"], undefined, "마지막 멤버가 나가면 길드가 해산된다");
  msg = s2.emissions.at(-1);
  assert.equal(msg[1].ok, true);
  assert.match(String(msg[1].message), /해산/);
});

test("only the guild leader can kick and disband", async () => {
  const { c } = context();
  seed(c, "kate"); seed(c, "tom"); seed(c, "rong");
  c.applyGuilds({ g1: { name: "우리길드", leader: "kate", members: [
    { key: "kate", nick: "kate" }, { key: "tom", nick: "tom" }, { key: "rong", nick: "rong" }
  ] } });

  const st = socket("s-gk1"); c.socketNicks.set(st.id, "tom");
  installHandler(c, "guild:kick", st);
  installHandler(c, "guild:disband", st);
  await st.handlers.get("guild:kick")({ nickname: "rong" });
  let msg = st.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /리더만/);
  await st.handlers.get("guild:disband")();
  msg = st.emissions.at(-1);
  assert.equal(msg[1].ok, false);
  assert.match(String(msg[1].reason), /리더만/);
  assert.equal(c.guildCache["g1"].members.length, 3, "비리더 작업은 변경 없음");

  const sk = socket("s-gk2"); c.socketNicks.set(sk.id, "kate");
  installHandler(c, "guild:kick", sk);
  installHandler(c, "guild:disband", sk);
  await sk.handlers.get("guild:kick")({ nickname: "rong" });
  let g = c.guildCache["g1"];
  assert.equal(g.members.length, 2, "리더는 추방할 수 있다");
  assert.ok(!g.members.some(m => m.key === "rong"));
  msg = sk.emissions.at(-1);
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].guild.memberCount, 2);

  await sk.handlers.get("guild:disband")();
  assert.equal(c.guildCache["g1"], undefined, "리더는 해산할 수 있다");
  msg = sk.emissions.at(-1);
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].guild, null);
});

/* =========================================================
   시즌 — 보상 안내 문구가 실제 지급 로직과 일치해야 한다
========================================================= */
test("season reward guide matches actual payouts", () => {
  const { c } = context();
  const rf = c.seasonRewardFor;
  assert.equal(rf(1).amount, 1000000);
  assert.equal(rf(3).amount, 500000);
  assert.equal(rf(4).amount, 150000);
  assert.equal(rf(10).amount, 150000);
  assert.equal(rf(11).amount, 30000);
  assert.equal(rf(50).amount, 30000);
  assert.equal(rf(51).amount, 2000);
  assert.ok(rf(1).title && rf(1).title.id === "t_season", "1위는 챔피언 칭호를 받는다");

  const info = c.buildSeasonInfo();
  assert.equal(info.ok, true);
  const rewards = info.rewards;
  assert.equal(rewards.length, 5);
  assert.match(rewards[0].value, /^1,000,000코인/, "1위 안내는 실제 1,000,000코인과 일치한다");
  assert.match(rewards[0].value, /챔피언/);
  assert.match(rewards[1].value, /^500,000코인/);
  assert.match(rewards[2].value, /^150,000코인/);
  assert.match(rewards[3].value, /^30,000코인/);
  assert.match(rewards[4].value, /^2,000코인/);
  for (const r of rewards) {
    assert.ok(!/원/.test(r.value), "게임 화폐는 '원'이 아니라 '코인'으로 표기한다");
  }
  assert.match(info.key, /^\d{4}-\d{2}$/, "시즌 키는 YYYY-MM 형식");
});

/* =========================================================
   커스텀 단어 — 단일 저장소 통합(구 customDict 병합 포함)
========================================================= */
test("legacy custom dictionary data merges into the unified word store", async () => {
  const { c } = context({
    loadStoreJSON: async (key) => key === "customDict" ? {
      nextId: 9,
      pending: [{ id: "1", word: "바다래", requester: "old", at: 1 }],
      approved: ["옛말", "사과"],
      rejected: [{ word: "가짜", by: "old", at: 1 }]
    } : null
  });
  c.customWords.pending.push({ word: "새단어", by: "new", at: 2 });
  c.customWords.approved.push("사과");

  await c.loadCustomDict();

  assert.ok(c.customWords.approved.includes("옛말"), "구 승인 단어가 이관된다");
  assert.equal(c.customWords.approved.length, 2, "이미 있던 단어는 중복 이관되지 않는다");
  assert.ok(c.customWords.pending.some(p => p.word === "바다래"));
  assert.ok(c.customWords.pending.some(p => p.word === "새단어"));
  assert.equal(c.customWords.pending.length, 2, "대기 목록도 병합된다");
  assert.equal(c.customWords.rejected.length, 1);
  assert.equal(c.customWords.nextId, 9, "구 nextId를 이어받는다");
});

test("word request and approval flow through the unified store", async () => {
  const { c, errors } = context({
    WORD_SET: new Set(["사과"]), WORD_INDEX: new Map([["사", ["사과"]]]),
    hasWord: (w, set) => set.has(w),
  });
  const s = socket("s-w1");
  c.socketNicks.set(s.id, "kate");
  installHandler(c, "word:request", s);
  installHandler(c, "admin:wordApprove", s);

  await s.handlers.get("word:request")({ word: "바다래" });
  let msg = s.emissions.at(-1);
  assert.equal(msg[0], "word:requestResult");
  assert.equal(msg[1].ok, true);
  assert.equal(c.customWords.pending.length, 1);
  assert.equal(c.customWords.pending[0].by, "kate", "신청은 단일 저장소 쪽지 대기 목록에 쌓인다");

  await s.handlers.get("word:request")({ word: "바다래" });
  msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, false, "같은 단어는 중복 신청 불가");

  await s.handlers.get("admin:wordApprove")({ word: "바다래" });
  assert.equal(errors.length, 0, "승인 처리 중 오류가 없어야 합니다: " + errors.join(" | "));
  msg = s.emissions.at(-1);
  assert.equal(msg[0], "admin:words");
  assert.equal(msg[1].ok, true);
  assert.equal(c.customWords.pending.length, 0, "승인되면 대기에서 빠진다");
  assert.ok(c.customWords.approved.includes("바다래"), "승인 목록에 오른다");
  assert.ok(c.WORD_SET.has("바다래"), "승인 즉시 게임 사전에 반영된다");
});

test("dictionary submit shares the store and admin approve rebuilds views", async () => {
  const { c } = context({
    WORD_SET: new Set(["사과"]), WORD_INDEX: new Map([["사", ["사과"]]]),
    BASE_WORD_SET: new Set(["사과"]),
    baseWordData: { WORD_SET: new Set(["사과"]), WORD_INDEX: new Map([["사", ["사과"]]]) },
    mergeCustomWords: game.mergeCustomWords,
    hasWord: (w, set) => set.has(w),
  });
  seed(c, "kate");
  const s = socket("s-d1");
  c.socketNicks.set(s.id, "kate");
  installHandler(c, "dictionary:submit", s);
  installHandler(c, "word:request", s);
  installHandler(c, "admin:dictionaryApprove", s);

  await s.handlers.get("dictionary:submit")({ word: "코코아" });
  let msg = s.emissions.at(-1);
  assert.equal(msg[0], "dictionary:status");
  assert.equal(msg[1].ok, true);
  assert.equal(c.customWords.pending.length, 1, "dictionary 신청도 단일 저장소에 쌓인다");
  assert.equal(c.customWords.pending[0].by, "kate", "shop 흐름에서 읽는 by 필드도 채워진다");

  await s.handlers.get("word:request")({ word: "코코아" });
  msg = s.emissions.at(-1);
  assert.equal(msg[0], "word:requestResult");
  assert.equal(msg[1].ok, false, "다른 흐름의 동일 단어 신청은 중복으로 거부된다");

  const id = c.customWords.pending[0].id;
  await s.handlers.get("admin:dictionaryApprove")({ id });
  msg = s.emissions.at(-1);
  assert.equal(msg[0], "admin:dictionary");
  assert.equal(msg[1].ok, true);
  assert.equal(c.customWords.pending.length, 0);
  assert.ok(c.customWords.approved.includes("코코아"));
  assert.ok(c.WORD_SET.has("코코아"), "승인 후 재구성된 게임 사전에 반영된다");
  assert.ok(c.WORD_INDEX.get("코") && c.WORD_INDEX.get("코").includes("코코아"));
});

test("rebuildWordViews merges the unified approved list into game views", () => {
  const { c } = context({
    WORD_SET: new Set(["사과"]), WORD_INDEX: new Map([["사", ["사과"]]]),
    BASE_WORD_SET: new Set(["사과"]),
    baseWordData: { WORD_SET: new Set(["사과"]), WORD_INDEX: new Map([["사", ["사과"]]]) },
    mergeCustomWords: game.mergeCustomWords,
  });
  c.customWords.approved.push("코코아");
  c.rebuildWordViews();
  assert.ok(c.WORD_SET.has("사과"), "기본 단어는 유지된다");
  assert.ok(c.WORD_SET.has("코코아"), "단일 저장소의 승인 단어가 합쳐진다");
  assert.deepEqual(c.WORD_INDEX.get("코"), ["코코아"]);
});

/* =========================================================
   출석 / 상점 / 미션 수령 / 시즌 롤오버 — 기존 회귀 공백 보강
========================================================= */
test("attendance check pays streak rewards once per day and resets after a gap", async () => {
  const { c, errors } = context({
    getKstDate: (ts) => (ts == null ? "2026-10-04" : "2026-10-03"),
  });
  const s = socket("s-att");
  c.socketNicks.set(s.id, "fresh");
  seed(c, "fresh");
  installHandler(c, "attendance:status", s);
  installHandler(c, "attendance:check", s);

  await s.handlers.get("attendance:check")();
  let msg = s.emissions.at(-1);
  assert.equal(msg[0], "attendance:result");
  assert.deepEqual(
    { ok: msg[1].ok, reward: msg[1].reward, streak: msg[1].streak, money: msg[1].money },
    { ok: true, reward: 2000, streak: 1, money: 92000 },
    "첫 출석은 2000원 지급");

  await s.handlers.get("attendance:check")();
  msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, false, "같은 날 두 번 출석은 거부된다");
  assert.match(String(msg[1].reason), /이미 오늘/);

  await s.handlers.get("attendance:status")();
  msg = s.emissions.at(-1);
  assert.equal(msg[1].checkedToday, true, "출석 상태는 오늘 완료를 알린다");

  c.socketNicks.set(s.id, "streaker");
  seed(c, "streaker", { lastCheckDate: "2026-10-03", attendanceStreak: 3 });
  await s.handlers.get("attendance:check")();
  msg = s.emissions.at(-1);
  assert.equal(msg[1].ok, true);
  assert.equal(msg[1].streak, 4, "어제 출석 이력이 있으면 연속이 이어진다");
  assert.equal(msg[1].reward, 5000, "4일차 보상은 5000원");
  assert.equal(c.playerCache.get("streaker").attendanceStreak, 4);
  assert.equal(c.playerCache.get("streaker").money, 95000);

  c.socketNicks.set(s.id, "skipper");
  seed(c, "skipper", { lastCheckDate: "2026-10-01", attendanceStreak: 7 });
  await s.handlers.get("attendance:check")();
  msg = s.emissions.at(-1);
  assert.equal(msg[1].streak, 1, "하루를 건너뛰면 연속이 초기화된다");
  assert.equal(msg[1].reward, 2000);
  assert.equal(errors.length, 0, errors.join(" | "));
});

test("shop purchases deduct money and stack tickets, boosts, and multipliers", async () => {
  const { c, errors } = context();
  const s = socket("s-shop");
  c.socketNicks.set(s.id, "buyer");
  seed(c, "buyer", { money: 5000000 });
  installHandler(c, "shop:buyShield", s);
  installHandler(c, "shop:buyPotion", s);
  installHandler(c, "shop:buyMultiplier", s);
  const lastShop = () => {
    for (let i = s.emissions.length - 1; i >= 0; i--) {
      if (s.emissions[i][0] === "shop:result") return s.emissions[i][1];
    }
    return null;
  };

  await s.handlers.get("shop:buyShield")();
  let res = lastShop();
  assert.equal(res.ok, true, "보호 티켓 구매 성공");
  let pd = c.playerCache.get("buyer");
  assert.equal(pd.money, 3000000, "보호 티켓 200만 차감");
  assert.equal(pd.shieldTickets, 1, "티켓 1장 적립");

  await s.handlers.get("shop:buyPotion")();
  res = lastShop();
  assert.equal(res.ok, true, "물약 구매 성공");
  pd = c.playerCache.get("buyer");
  assert.equal(pd.money, 2000000, "물약 100만 차감");
  assert.equal(pd.ratingBoostGames, 10, "레이팅 2배 10판 적립");

  await s.handlers.get("shop:buyMultiplier")({ multiplier: 9 });
  res = lastShop();
  assert.equal(res.ok, false, "존재하지 않는 배율은 거부된다");

  await s.handlers.get("shop:buyMultiplier")({ multiplier: 2 });
  res = lastShop();
  assert.equal(res.ok, false, "돈이 부족하면 거부된다");
  assert.equal(c.playerCache.get("buyer").moneyMultiplier, 1, "실패 시 배율은 불변이다");

  c.socketNicks.set(s.id, "rich");
  seed(c, "rich", { money: 6000000 });
  await s.handlers.get("shop:buyMultiplier")({ multiplier: 2 });
  res = lastShop();
  assert.equal(res.ok, true, "영구 2배 구매 성공");
  pd = c.playerCache.get("rich");
  assert.equal(pd.moneyMultiplier, 2);
  assert.equal(pd.money, 1000000, "영구 2배 500만 차감");

  await s.handlers.get("shop:buyMultiplier")({ multiplier: 2 });
  res = lastShop();
  assert.equal(res.ok, false, "이미 보유한 배율은 중복 구매가 거부된다");
  assert.equal(errors.length, 0, errors.join(" | "));
});

test("missions claim pays coins and titles once, rejecting unmet and duplicate claims", async () => {
  const { c, errors } = context();
  const s = socket("s-mis");
  c.socketNicks.set(s.id, "mser");
  seed(c, "mser", {
    daily: { date: "2026-10-04", rankedWins: 3, oneShots: 0, streakDone: 1, claimed: [] }
  });
  installHandler(c, "missions:claim", s);
  const lastResult = () => {
    for (let i = s.emissions.length - 1; i >= 0; i--) {
      if (s.emissions[i][0] === "missions:result") return s.emissions[i][1];
    }
    return null;
  };

  await s.handlers.get("missions:claim")({ group: "daily", id: "streakDone" });
  let res = lastResult();
  assert.equal(res.ok, true, "달성한 미션 수령 성공");
  assert.equal(res.money, 91000, "미션 코인 1000원 지급");
  assert.equal(res.currentTitle, "데일리 마스터", "미션 칭호를 현재 칭호로 장착");
  const pd = c.playerCache.get("mser");
  assert.ok(pd.daily.claimed.includes("streakDone"), "수령 기록이 남는다");
  assert.ok(pd.titles.some(t => t.id === "t_daily"), "칭호가 보관된다");

  await s.handlers.get("missions:claim")({ group: "daily", id: "streakDone" });
  res = lastResult();
  assert.equal(res.ok, false, "이미 수령한 미션은再次 수령이 거부된다");

  await s.handlers.get("missions:claim")({ group: "daily", id: "oneShots" });
  res = lastResult();
  assert.equal(res.ok, false, "미달성 미션은 수령이 거부된다");
  assert.match(String(res.reason), /달성하지 못했습니다/);

  await s.handlers.get("missions:claim")({ group: "daily", id: "nope" });
  res = lastResult();
  assert.equal(res.ok, false, "알 수 없는 미션은 거부된다");
  assert.equal(errors.length, 0, errors.join(" | "));
});

test("season rollover closes the previous season, pays rewards, and archives standings", async () => {
  const { c, errors } = context({ seasonStore: { lastClosed: "2026-09", history: [] } });
  const champ = seed(c, "champ", {
    season: { season: "2026-09", games: 5, wins: 4, losses: 1 },
    ranked: { rating: 1900, wins: 50, losses: 10 }
  });
  champ.id = "champ";
  const runner = seed(c, "runner", {
    season: { season: "2026-09", games: 3, wins: 1, losses: 2 },
    ranked: { rating: 1500, wins: 20, losses: 15 }
  });
  runner.id = "runner";
  const bystander = seed(c, "bystander");
  bystander.id = "bystander";

  const key = await c.ensureSeasonRollover();
  assert.equal(errors.length, 0, "롤오버 중 오류가 없어야 합니다: " + errors.join(" | "));
  assert.equal(key, c.currentSeasonKey());
  const store = c.getSeasonStore();
  assert.equal(store.lastClosed, key, "마감 키가 갱신된다");
  const hist = store.history[store.history.length - 1];
  assert.equal(hist.season, "2026-09", "이전 시즌이 기록된다");
  assert.equal(hist.champion, "champ", "1위가 챔피언으로 기록된다");
  assert.equal(hist.participants, 2, "시즌 참가 2명만 집계된다");
  assert.equal(hist.top.length, 2, "상위 기록이 보관된다");

  const champAfter = c.playerCache.get("champ");
  assert.equal(champAfter.money, 1090000, "1위 보상 100만 코인 지급");
  assert.ok(champAfter.titles.some(t => t.id === "t_season"), "챔피언 칭호 지급");
  assert.equal(champAfter.season.games, 0, "시즌 기록이 초기화된다");
  assert.equal(c.playerCache.get("runner").money, 590000, "2위 보상 50만 코인 지급");
  assert.equal(c.playerCache.get("bystander").money, 90000, "미참가자에게는 보상이 없다");
});

/* =========================================================
   배치 구현 — 이름 변경 비용 / Firebase 세션 유지 / 랭킹 게이트 /
   채팅(스코프·필터·기간제 뮤트) / 튜토리얼 실습 / 랭킹 nameChanges
========================================================= */

test("second rename charges 1,000,000 coins and deducts the balance", async () => {
  const { c, errors } = context();
  assert.equal(vm.runInContext("RENAME_PRICE", c), 1000000);
  const s = socket("renamed");
  seed(c, "old", { money: 2000000, nameChanges: 1, ranked: { rating: 1900, wins: 50 } });
  c.registerOnline(s.id, "old");
  c.socketFirebaseUid.set(s.id, "uid-old");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "newname" });
  const hit = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.equal(hit[1].ok, true);
  assert.equal(hit[1].renamed, true);
  assert.equal(hit[1].nameChanges, 2);
  const after = c.playerCache.get("newname");
  assert.equal(after.money, 1000000, "2회차 개명은 100만 코인 차감");
  assert.equal(after.nameChanges, 2);
  assert.equal(after.ranked.wins, 50, "전적은 그대로 승계");
  assert.equal(c.playerCache.has("old"), false);
  assert.equal(errors.length, 0);
});

test("rename is rejected when the balance cannot cover the price", async () => {
  const { c } = context();
  const s = socket("broke");
  seed(c, "old", { money: 500000, nameChanges: 1 });
  c.registerOnline(s.id, "old");
  c.socketFirebaseUid.set(s.id, "uid-old");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "richname" });
  const hit = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.equal(hit[1].ok, false);
  assert.match(String(hit[1].reason || ""), /부족/);
  assert.equal(c.playerCache.get("old").money, 500000, "차감되지 않는다");
  assert.equal(c.playerCache.get("old").nameChanges, 1, "횟수도 오르지 않는다");
  assert.equal(c.playerCache.has("richname"), false, "새 이름이 만들어지지 않는다");
  assert.equal(c.socketNicks.get(s.id), "old");
});

test("firebase login keeps uid/email so a later name change works", async () => {
  const { c, errors } = context({
    firebaseReady: true,
    firebaseAuth: { async verifyIdToken() { return { uid: "uid-fb-1", email: "user@example.com", name: "U" }; } },
  });
  const s = socket("fresh-login");
  installHandler(c, "player:firebaseAuth", s);
  await s.handlers.get("player:firebaseAuth")({ idToken: "a.b.c" });
  const auth = s.emissions.find(([event]) => event === "player:firebaseAuthResult");
  assert.ok(auth);
  assert.equal(auth[1].ok, true);
  assert.equal(auth[1].needNickname, true);
  /* 핵심 회귀: needNickname 경로에서도 UID/이메일은 세션에 남아 있어야 한다 */
  assert.equal(c.socketFirebaseUid.get(s.id), "uid-fb-1");
  assert.equal(c.socketFirebaseEmail.get(s.id), "user@example.com");
  /* 이어서 이름을 정하면 세션 UID로 계정이 연결된다 */
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "freshuser" });
  const upd = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.equal(upd[1].ok, true);
  assert.equal(c.playerCache.get("freshuser").firebaseUid, "uid-fb-1");
  assert.equal(c.socketNicks.get(s.id), "freshuser");
  assert.equal(errors.length, 0);
});

test("firebase logout clears the gated login session", async () => {
  const { c } = context();
  const s = socket("logout");
  c.socketFirebaseUid.set(s.id, "uid-1");
  c.socketFirebaseEmail.set(s.id, "a@b.c");
  c.adminAuthed.set(s.id, { role: "super", email: "a@b.c" });
  installHandler(c, "player:firebaseLogout", s);
  await s.handlers.get("player:firebaseLogout")();
  assert.equal(c.socketFirebaseUid.has(s.id), false);
  assert.equal(c.socketFirebaseEmail.has(s.id), false);
  assert.equal(c.adminAuthed.has(s.id), false);
  const hit = s.emissions.find(([event]) => event === "player:firebaseAuthResult");
  assert.ok(hit);
  assert.equal(hit[1].ok, false);
  assert.equal(hit[1].loggedOut, true);
});

test("ranked queue/rematch/invite require a Google session", async () => {
  const { c, emissions } = context();
  const s = socket("guest-ranked");
  c.registerOnline(s.id, "게스트랭커");
  installHandler(c, "ranked:queue", s);
  await s.handlers.get("ranked:queue")();
  installHandler(c, "ranked:rematch", s);
  await s.handlers.get("ranked:rematch")();
  installHandler(c, "ranked:invite", s);
  await s.handlers.get("ranked:invite")({ nickname: "상대" });
  installHandler(c, "ranked:inviteAccept", s);
  await s.handlers.get("ranked:inviteAccept")();
  const expected = [["ranked:queueStatus"], ["ranked:rematchStatus"], ["ranked:inviteSent"], ["ranked:inviteStatus"]];
  for (const [evt] of expected) {
    const hit = s.emissions.find(([event]) => event === evt);
    assert.ok(hit, `${evt} 응답이 있어야 합니다`);
    assert.equal(hit[1].ok, false);
    assert.match(String(hit[1].reason || ""), /로그인/);
  }
  assert.equal(emissions.length, 0, "게스트는 매칭·초대 동작이 일어나지 않는다");
});

test("chat send/history/report require a Google session", async () => {
  const { c, emissions } = context();
  const s = socket("guest-chat");
  c.registerOnline(s.id, "게스트");
  installHandler(c, "chat:send", s);
  await s.handlers.get("chat:send")({ text: "안녕" });
  installHandler(c, "chat:history", s);
  await s.handlers.get("chat:history")();
  installHandler(c, "chat:report", s);
  await s.handlers.get("chat:report")({ nickname: "나쁜이", text: "spam" });
  const sendErr = s.emissions.find(([event]) => event === "chat:error");
  assert.ok(sendErr);
  assert.match(String(sendErr[1].reason || ""), /로그인/);
  assert.equal(s.emissions.some(([event]) => event === "chat:history"), false, "이력도 내주지 않는다");
  const rep = s.emissions.find(([event]) => event === "chat:reportResult");
  assert.ok(rep);
  assert.equal(rep[1].ok, false);
  assert.match(String(rep[1].reason || ""), /로그인/);
  assert.equal(emissions.length, 0, "어디에도 브로드캐스트되지 않는다");
});

test("chat goes global without a room, stays inside a multiplayer room, global again in an AI room", async () => {
  const { c, emissions, ioRooms } = context();
  const s = socket("chatter");
  c.registerOnline(s.id, "말쟁이");
  c.socketFirebaseUid.set(s.id, "uid-chat");
  installHandler(c, "chat:send", s);
  const reset = () => { s.data.chatLastAt = 0; s.data.chatWin = []; };

  /* 방 없음 → 전체 채팅 */
  await s.handlers.get("chat:send")({ text: "대기실입니다" });
  let hit = emissions.find(([event]) => event === "chat:message");
  assert.ok(hit);
  assert.equal(hit[1].scope, "global");
  assert.equal(hit[1].from, "말쟁이");
  const history = vm.runInContext("GLOBAL_CHAT_HISTORY", c);
  assert.equal(history.length, 1, "전체 이력에 쌓인다");

  /* 온라인 방 → 방 단위 브로드캐스트 */
  const room = { id: "CR1", mode: "online", players: [{ socketId: s.id, nickname: "말쟁이", playerIndex: 0, isBot: false }] };
  c.getPlayerRoom = () => room;
  reset();
  await s.handlers.get("chat:send")({ text: "방 안입니다" });
  const roomHit = ioRooms.find((r) => r.room === "CR1");
  assert.ok(roomHit, "io.to(방ID)로 방에만 전파되어야 합니다");
  assert.equal(roomHit.args[0], "chat:message");
  assert.equal(roomHit.args[1].scope, "room");
  assert.equal(vm.runInContext("GLOBAL_CHAT_HISTORY", c).length, 1, "방 메시지는 전체 이력에 쌓이지 않는다");

  /* AI(싱글·실습) 방 → 전체 채팅 */
  c.getPlayerRoom = () => ({ id: "AI1", mode: "ai", players: [{ socketId: s.id, nickname: "말쟁이", playerIndex: 0, isBot: false }] });
  reset();
  await s.handlers.get("chat:send")({ text: "AI 게임 중" });
  const global2 = vm.runInContext("GLOBAL_CHAT_HISTORY", c);
  assert.equal(global2.length, 2, "AI 방 메시지는 전체 이력으로");
  const last = emissions.filter(([event]) => event === "chat:message").at(-1);
  assert.equal(last[1].scope, "global");
});

test("chat filter allows ordinary words including 시발점 and caps length at 100", () => {
  const { c } = context();
  const chatFilter = vm.runInContext("chatFilter", c);
  assert.equal(chatFilter("시발점").ok, true, "비속어 필터는 제거되었다");
  assert.equal(chatFilter("바보바보").ok, true);
  assert.equal(chatFilter("ㅋ".repeat(101)).ok, false, "100자 제한은 유지된다");
  assert.equal(chatFilter("").ok, false, "빈 내용은 거부된다");
});

test("chat history returns the recent global backlog after login", async () => {
  const { c } = context();
  const s = socket("reader");
  c.socketFirebaseUid.set(s.id, "uid-r");
  vm.runInContext(`GLOBAL_CHAT_HISTORY.push({ from: "a", text: "첫 메시지", scope: "global", id: "1" })`, c);
  installHandler(c, "chat:history", s);
  await s.handlers.get("chat:history")();
  const hit = s.emissions.find(([event]) => event === "chat:history");
  assert.ok(hit);
  assert.equal(hit[1].ok, true);
  assert.equal(hit[1].messages.length, 1);
  assert.equal(hit[1].messages[0].text, "첫 메시지");
});

test("chat rate limit keeps only the first message inside the window", async () => {
  const { c, emissions } = context();
  const s = socket("speedy");
  c.registerOnline(s.id, "빨리막");
  c.socketFirebaseUid.set(s.id, "uid-s");
  installHandler(c, "chat:send", s);
  await s.handlers.get("chat:send")({ text: "하나" });
  await s.handlers.get("chat:send")({ text: "둘" });
  assert.equal(emissions.filter(([event]) => event === "chat:message").length, 1);
  const err = s.emissions.find(([event]) => event === "chat:error");
  assert.ok(err);
  assert.match(String(err[1].reason || ""), /천천히/);
});

test("mute blocks chat until its expiry; an expired mute passes again", async () => {
  const { c, emissions } = context();
  const s = socket("muted");
  c.registerOnline(s.id, "조용이");
  c.socketFirebaseUid.set(s.id, "uid-m");
  const normKey = vm.runInContext("normKey", c);
  c.mutedMap.set(normKey("조용이"), { nick: "조용이", by: "admin", at: new Date().toISOString(), reason: "도배", uid: "", until: null });
  installHandler(c, "chat:send", s);
  await s.handlers.get("chat:send")({ text: "안녕" });
  assert.equal(emissions.filter(([event]) => event === "chat:message").length, 0);
  const blocked = s.emissions.find(([event]) => event === "chat:error");
  assert.ok(blocked);
  assert.match(String(blocked[1].reason || ""), /차단/);
  assert.match(String(blocked[1].reason || ""), /도배/);

  /* 만료 시각이 지난 뮤트는 자동으로 무시된다 */
  c.mutedMap.set(normKey("조용이"), { nick: "조용이", by: "admin", at: new Date().toISOString(), reason: "도배", uid: "", until: new Date(Date.now() - 1000).toISOString() });
  s.data.chatLastAt = 0;
  s.data.chatWin = [];
  await s.handlers.get("chat:send")({ text: "다시" });
  assert.equal(emissions.filter(([event]) => event === "chat:message").length, 1, "만료 후에는 발화 가능");
});

test("mute by account uid follows the player after a rename", async () => {
  const { c, emissions } = context();
  const s = socket("uidmuted");
  c.registerOnline(s.id, "새이름");
  c.socketFirebaseUid.set(s.id, "uid-x");
  const normKey = vm.runInContext("normKey", c);
  c.mutedMap.set(normKey("옛이름"), { nick: "옛이름", by: "admin", at: new Date().toISOString(), reason: "욕설", uid: "uid-x", until: null });
  installHandler(c, "chat:send", s);
  await s.handlers.get("chat:send")({ text: "안녕" });
  assert.equal(emissions.filter(([event]) => event === "chat:message").length, 0, "개명해도 UID 기준 뮤트는 우회되지 않는다");
  const blocked = s.emissions.find(([event]) => event === "chat:error");
  assert.ok(blocked);
  assert.match(String(blocked[1].reason || ""), /차단/);
});

test("moderation entries: timed mutes expire, bans stay permanent, expired mutes hide from the list", () => {
  const { c } = context();
  const normKey = vm.runInContext("normKey", c);
  const timed = c.addModeration("muted", "temp", { by: "admin", reason: "spam", days: 1 });
  assert.equal(timed.ok, true);
  const days = (Date.parse(timed.entry.until) - Date.now()) / 86400000;
  assert.ok(days > 0.99 && days <= 1, `1일 후 만료되어야 합니다 (${days})`);
  const permanent = c.addModeration("muted", "forever", { by: "admin", reason: "심각" });
  assert.equal(permanent.entry.until, null, "기간 없으면 영구");
  const banned = c.addModeration("banned", "badguy", { by: "admin", reason: "사기", days: 7 });
  assert.equal(banned.entry.until, null, "계정정지(밴)는 기간과 무관하게 영구");
  /* 만료된 뮤트는 목록·판정 모두에서 제외된다 */
  c.mutedMap.set(normKey("지난놈"), { nick: "지난놈", by: "admin", at: new Date().toISOString(), reason: "", uid: "", until: new Date(Date.now() - 1000).toISOString() });
  const list = c.listModeration();
  const mutedNicks = list.muted.map((e) => e.nick);
  assert.ok(mutedNicks.includes("temp"));
  assert.ok(mutedNicks.includes("forever"));
  assert.ok(!mutedNicks.includes("지난놈"), "만료 뮤트는 숨김");
  assert.equal(list.banned.length, 1);
  assert.equal(c.getMute("지난놈"), null);
  assert.ok(c.getMute("forever"));
});

test("admin mute applies a day span message; bans are always permanent", async () => {
  const { c, errors } = context();
  const messages = [];
  c.emitModeration = (m) => messages.push(m);   /* 핸들러의 닫힌 스코프 함수 대체 */
  vm.runInContext(constFnSource("moderationAction"), c);
  const s = socket("adm");
  installHandler(c, "admin:mute", s);
  await s.handlers.get("admin:mute")({ nickname: "loudmouth", reason: "도배", days: 3 });
  const key = vm.runInContext("normKey", c);
  const entry = c.mutedMap.get(key("loudmouth"));
  assert.ok(entry, "뮤트 항목이 등록된다");
  const span = (Date.parse(entry.until) - Date.now()) / 86400000;
  assert.ok(span > 2.99 && span <= 3, `3일 후 만료 (${span})`);
  assert.match(String(messages[0] || ""), /3일간/);
  assert.match(String(messages[0] || ""), /음소거/);

  /* 기간 미지정 → 영구 */
  await s.handlers.get("admin:mute")({ nickname: "quiet", reason: "악성" });
  assert.equal(c.mutedMap.get(key("quiet")).until, null);

  /* 밴은 days를 줘도 영구 */
  installHandler(c, "admin:ban", s);
  await s.handlers.get("admin:ban")({ nickname: "badguy", reason: "사기", days: 7 });
  assert.equal(c.bannedMap.get(key("badguy")).until, null);
  assert.match(String(messages.at(-1) || ""), /차단/);
  assert.equal(errors.length, 0, errors.join(" | "));
});

test("practice AI rooms carry the flag and record no statistics", async () => {
  const { c, errors } = context();
  const s = socket("tut");
  installHandler(c, "room:create", s);
  /* ① 실습 방 생성 → practice 플래그 */
  await s.handlers.get("room:create")({ nickname: "연습생", mode: "ai", difficulty: "easy", practice: true });
  const created = s.emissions.find(([event]) => event === "room:created");
  assert.ok(created);
  assert.equal(created[1].state.practice, true, "공개 상태에 practice가 보여야 합니다");
  const practiceRoom = c.ROOMS.get(created[1].roomId);
  assert.equal(practiceRoom.practice, true);
  assert.equal(practiceRoom.difficulty, "easy");
  /* ② 일반 싱글은 practice 없음 */
  await s.handlers.get("room:create")({ nickname: "연습생", mode: "ai" });
  const second = s.emissions.filter(([event]) => event === "room:created")[1];
  assert.ok(second);
  assert.equal(second[1].state.practice, false);
  assert.equal(c.ROOMS.get(second[1].roomId).practice, false);
  assert.equal(errors.length, 0);

  /* ③ 실습 게임 종료 → 전적·돈·최근경기 아무것도 기록하지 않는다 */
  const p = seed(c, "연습생2", { recentGames: [] });
  const r = room(c, 2);
  r.mode = "ai";
  r.practice = true;
  Object.assign(r.players[0], { nickname: "연습생2" });
  Object.assign(r.players[1], { isBot: true, nickname: "AI" });
  c.registerOnline("s0", "연습생2");
  await c.finishGame(r, 0, 1);
  const after = c.playerCache.get("연습생2");
  assert.equal(after.single.wins, p.single.wins, "승수 미기록");
  assert.equal(after.money, p.money, "보상 없음");
  assert.equal(after.recentGames.length, 0, "최근경기 미기록");
  assert.equal(errors.length, 0);
});

test("ranking payload carries nameChanges for rename pricing", async () => {
  const { c } = context();
  const s = socket("ranked-nick");
  seed(c, "renamedtwice", { nameChanges: 2 });
  c.registerOnline(s.id, "renamedtwice");
  const payload = await c.getRankingPayload(s.id);
  assert.equal(payload.nickname, "renamedtwice");
  assert.equal(payload.nameChanges, 2);
  const fresh = seed(c, "newbie");
  fresh.nameChanges = 0;
  c.playerCache.set("newbie", fresh);
  const p2 = await c.getRankingPayload("newbie");
  assert.equal(p2.nameChanges, 0);
});
