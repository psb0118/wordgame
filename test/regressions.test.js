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
const clientSource = fs.readFileSync(path.join(__dirname, "../client/script.js"), "utf8");

function functionSource(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(match, `missing function: ${name}`);
  const firstLine = source.slice(match.index, source.indexOf("\n", match.index));
  if (firstLine.trimEnd().endsWith("}")) return firstLine;
  const end = source.indexOf("\n}", match.index);
  assert.ok(end > match.index, `missing function end: ${name}`);
  return source.slice(match.index, end + 2);
}

function clientFunctionSource(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(clientSource);
  assert.ok(match, `missing client function: ${name}`);
  const end = clientSource.indexOf("\n}", match.index);
  assert.ok(end > match.index, `missing client function end: ${name}`);
  return clientSource.slice(match.index, end + 2);
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
    friendsMap: new Map(), friendRequests: new Map(),
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
    chatHistoryPath: "chat-history.json", chatSaveTimer: null, scheduleSaveChatHistory() {},
    chatReportCounts: new Map(), saveModeration() {}, saveFriends() {}, saveGuilds() {},
    saveAdminConfig() {},
    PUBLIC_URL: "", setInterval: (fn, ms) => ({ unref() {} }),
    fetch: () => Promise.resolve({ body: { cancel() {} } }), AbortSignal: { timeout: () => null },
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
    "CHAT_AUTO_MUTE_REPORTS", "CHAT_AUTO_MUTE_MINUTES",
    "GLOBAL_CHAT_HISTORY", "GLOBAL_CHAT_MAX",
    "ECONOMY_MEMORY", "ECONOMY_IDEM", "ECONOMY_MAX_MEMORY",
    "CHAT_ACCOUNT_RATE", "CHAT_RATE_MAX_ACCOUNTS",
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
    "loadChatHistory", "saveChatHistoryNow", "renameAccountRefs", "startKeepAlivePing",
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
    "beginEconomyTx", "finishEconomyTx", "abortEconomyTx", "getEconomyHistory",
    "chatRateKey", "takeChatSlot", "renameEconomyAccount",
    "safeEconomyRequestId", "recordAchievementLedger", "getEconomySummary", "recordWelcomeLedger",
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

test("recent match history keeps a compact replay flow with my words", async () => {
  const { c, errors } = context();
  seed(c, "flow-user");
  seed(c, "flow-opp");
  const r = room(c, 2);
  r.mode = "online";
  r.players[0].nickname = "flow-user";
  r.players[1].nickname = "flow-opp";
  r.history = [
    { word: "가방", player: -1, nickname: "시작", turn: 0, depth: null },
    { word: "방패", player: 0, nickname: "flow-user", turn: 1, depth: 2 },
    { word: "패션", player: 1, nickname: "flow-opp", turn: 2, depth: null }
  ];
  await c.recordMatchHistory(r, 0, 1);
  const game = c.playerCache.get("flow-user").recentGames[0];
  assert.equal(game.flow.length, 3);
  assert.equal(game.flow[1].w, "방패");
  assert.equal(game.flow[1].m, true, "내 단어는 리플레이에서 구분된다");
  assert.equal(game.flow[2].m, false);
  assert.equal(errors.length, 0, errors.join(" | "));
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
  const p0Ledger = await c.getEconomyHistory("p0");
  assert.equal(p0Ledger.find(h => h.reason === "game_win").delta, 5000);
  assert.equal(p0Ledger.filter(h => h.reason === "achievement").length, 2);
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

test("ranked rooms cap at 2 and party rooms are no longer creatable", async () => {
  const { c } = context();
  assert.equal(c.roomCapacity({ mode: "ranked" }), 2, "랭크 방 정원은 2명(1:1 고정)");
  assert.equal(c.roomCapacity({ mode: "online" }), c.MAX_PLAYERS, "일반 방은 MAX_PLAYERS 유지");

  const { c: c2, errors } = context();
  const s = socket("party-gone");
  installHandler(c2, "room:create", s);
  await s.handlers.get("room:create")({ nickname: "파티러버", mode: "party" });
  const created = s.emissions.find(([event]) => event === "room:created");
  assert.ok(created);
  const made = c2.ROOMS.get(created[1].roomId);
  assert.equal(made.mode, "online", "2v2 파티 요청도 일반 방으로 생성된다");
  assert.equal(c2.roomCapacity(made), c2.MAX_PLAYERS);
  assert.equal(errors.length, 0, errors.join(" | "));
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

test("Open Dictionary results extract exact-headword senses and ignore unrelated hits", () => {
  const extract = vm.runInNewContext(
    `${functionSource("extractOpenDictionaryEntries")}\nextractOpenDictionaryEntries`,
    { normalizeWord: game.normalizeWord },
  );
  const entries = extract({ channel: { item: [
    { word: "나무", sense: { definition: " 줄기나 가지가 목질인 식물. ", pos: "명사", type: "일반어", link: "https://opendict.korean.go.kr/dictionary/view?sense_no=1" } },
    { word: "나무", sense: [ { definition: "뜻 하나", pos: "명사" }, { definition: "뜻 둘", pos: "동사" } ] },
    { word: "나무꾼", sense: { definition: "다른 표제어" } },
  ] } }, "나무");
  assert.equal(entries.length, 3);
  assert.equal(entries[0].definition, "줄기나 가지가 목질인 식물.");
  assert.equal(entries[0].link, "https://opendict.korean.go.kr/dictionary/view?sense_no=1");
  assert.equal(entries[2].link, "https://opendict.korean.go.kr/search");
});

test("dictionary API request keeps its key server-side and uses exact JSON search", async () => {
  let requestedUrl = "";
  let requestedOptions;
  const fetchEntries = vm.runInNewContext(
    `${functionSource("fetchOpenDictionaryEntries")}\nfetchOpenDictionaryEntries`,
    {
      URLSearchParams,
      AbortSignal,
      extractOpenDictionaryEntries: (payload, word) => ({ payload, word }),
    },
  );
  const result = await fetchEntries("나무", "private-test-key", async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return { ok: true, async json() { return { channel: { total: 1 } }; } };
  });
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://opendict.korean.go.kr");
  assert.equal(url.pathname, "/api/search");
  assert.equal(url.searchParams.get("key"), "private-test-key");
  assert.equal(url.searchParams.get("q"), "나무");
  assert.equal(url.searchParams.get("method"), "exact");
  assert.equal(url.searchParams.get("req_type"), "json");
  assert.equal(requestedOptions.headers.Accept, "application/json");
  assert.deepEqual(result, { payload: { channel: { total: 1 } }, word: "나무" });
});

test("dictionary endpoint validates game words, handles missing keys, and caches successful lookups", async () => {
  const dictionaryDefinitionCache = new Map();
  let lookups = 0;
  const c = vm.createContext({
    normalizeWord: game.normalizeWord,
    WORD_SET: new Set(["나무"]),
    dictionaryDefinitionCache,
    DICTIONARY_INFLIGHT: new Map(),
    DICTIONARY_CACHE_LIMIT: 500,
    DICTIONARY_CACHE_TTL_MS: 3600000,
    DICTIONARY_EMPTY_CACHE_TTL_MS: 600000,
    process: { env: { OPENDICT_API_KEY: "test-key" } },
    fetchOpenDictionaryEntries: async (word, key) => {
      lookups++;
      assert.equal(word, "나무");
      assert.equal(key, "test-key");
      return [{ definition: "나무 뜻", pos: "명사", type: "일반어", link: "https://opendict.korean.go.kr/search" }];
    },
    fetch: async () => ({}),
    AbortSignal: { timeout: () => ({}) },
  });
  vm.runInContext(`${functionSource("getCachedDictionaryDefinition")}\n${functionSource("cacheDictionaryDefinition")}\n${functionSource("handleDictionaryDefinition")}\nhandleDictionaryDefinition`, c);
  const invoke = async (word) => {
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await c.handleDictionaryDefinition({ query: { word } }, res);
    return res;
  };
  assert.equal((await invoke("없는단어")).code, 404);
  assert.equal((await invoke("1bad")).code, 400);
  c.process.env.OPENDICT_API_KEY = "";
  const missingKey = await invoke("나무");
  assert.equal(missingKey.code, 503);
  assert.match(missingKey.body.reason, /API 키/);
  c.process.env.OPENDICT_API_KEY = "test-key";
  const first = await invoke("나무");
  const second = await invoke("나무");
  assert.equal(first.body.entries[0].definition, "나무 뜻");
  assert.equal(first.body.cached, false);
  assert.equal(second.body.cached, true);
  assert.equal(second.body.source, "우리말샘", "캐시된 응답도 사전 출처를 포함합니다");
  assert.equal(lookups, 1);
});

test("dictionary cache uses short negative TTL, evicts least-recently-used entries, and shares concurrent requests", async () => {
  const cache = new Map();
  let now = 1000;
  const cacheContext = vm.createContext({
    dictionaryDefinitionCache: cache,
    DICTIONARY_CACHE_LIMIT: 2,
    DICTIONARY_CACHE_TTL_MS: 6000,
    DICTIONARY_EMPTY_CACHE_TTL_MS: 1000,
    Date: class extends Date { static now() { return now; } },
  });
  vm.runInContext(`${functionSource("getCachedDictionaryDefinition")}\n${functionSource("cacheDictionaryDefinition")}`, cacheContext);
  cacheContext.cacheDictionaryDefinition("빈값", []);
  assert.equal(cache.get("빈값").expiresAt, 2000);
  now = 1500;
  assert.equal(cacheContext.getCachedDictionaryDefinition("빈값").source, "우리말샘");
  cacheContext.cacheDictionaryDefinition("정의", [{ definition: "뜻" }]);
  now = 1800;
  cacheContext.getCachedDictionaryDefinition("빈값");
  cacheContext.cacheDictionaryDefinition("새 단어", [{ definition: "뜻" }]);
  assert.equal(cache.has("정의"), false, "최근 사용된 빈 결과가 LRU에서 살아남습니다");
  assert.equal(cache.has("빈값"), true);
  now = 2500;
  assert.equal(cacheContext.getCachedDictionaryDefinition("빈값"), null, "빈 결과는 짧은 TTL 후 다시 조회됩니다");

  const dictionaryDefinitionCache = new Map();
  const inFlight = new Map();
  let releaseLookup;
  let lookupCount = 0;
  const concurrent = vm.createContext({
    normalizeWord: game.normalizeWord,
    WORD_SET: new Set(["나무"]), dictionaryDefinitionCache, DICTIONARY_INFLIGHT: inFlight,
    DICTIONARY_CACHE_LIMIT: 2, DICTIONARY_CACHE_TTL_MS: 6000, DICTIONARY_EMPTY_CACHE_TTL_MS: 1000,
    process: { env: { OPENDICT_API_KEY: "test-key" } },
    AbortSignal: { timeout: () => ({}) }, fetch: async () => ({}),
    fetchOpenDictionaryEntries: () => {
      lookupCount++;
      return new Promise(resolve => { releaseLookup = () => resolve([{ definition: "나무 뜻" }]); });
    },
  });
  const concurrentHandlers = [
    functionSource("getCachedDictionaryDefinition"),
    functionSource("cacheDictionaryDefinition"),
    functionSource("handleDictionaryDefinition"),
    "handleDictionaryDefinition",
  ];
  vm.runInContext(concurrentHandlers.join(String.fromCharCode(10)), concurrent);
  const invoke = async () => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await concurrent.handleDictionaryDefinition({ query: { word: "나무" } }, res);
    return res;
  };
  const first = invoke();
  const second = invoke();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lookupCount, 1);
  releaseLookup();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].body.ok, true);
  assert.equal(results[1].body.ok, true);
  assert.equal(lookupCount, 1);
});

test("empty title inventory offers a direct jump to the shop", () => {
  const list = {
    innerHTML: "",
    querySelector(selector) { return selector === "[data-items-open-shop]" ? shopButton : null; },
  };
  const shopButton = { addEventListener(event, handler) { this.event = event; this.handler = handler; } };
  const tabs = { clicked: false, click() { this.clicked = true; } };
  const context = vm.createContext({
    currentTitle: "", ownedTitles: [], shopInfo: { isAdmin: false }, ratingBoostGames: 0,
    $(selector) {
      if (selector === "#itemsCurrentTitle") return { textContent: "" };
      if (selector === "#itemsTitleList") return list;
      if (selector === ".tabs button[data-mode='shop']") return tabs;
      return null;
    },
    escapeHtml: String, renderRatingChart() {}, renderRecentGames() {}, renderEconomyHistory() {},
  });
  vm.runInContext(`${clientFunctionSource("renderItems")}`, context);
  context.renderItems();
  assert.match(list.innerHTML, /아직 보유한 칭호가 없습니다/);
  assert.equal(shopButton.event, "click");
  shopButton.handler();
  assert.equal(tabs.clicked, true);
});

test("owned titles sort current first then Korean alphabetical without mutating input", () => {
  const sortTitles = vm.runInNewContext(
    `${clientFunctionSource("sortOwnedTitles")}\nsortOwnedTitles`,
  );
  const titles = [
    { id: "b", name: "나무" },
    { id: "current", name: "하늘" },
    { id: "a", name: "가을" },
  ];
  const sorted = sortTitles(titles, "하늘");
  assert.deepEqual(Array.from(sorted, item => item.id), ["current", "a", "b"]);
  assert.deepEqual(titles.map(item => item.id), ["b", "current", "a"]);
});

test("achievement filters render matching cards and preserve the unlocked total", () => {
  const grid = { innerHTML: "" };
  const summary = { textContent: "" };
  const context = vm.createContext({
    achievementFilter: "all", achievementData: null,
    $(selector) { return selector === "#achGrid" ? grid : selector === "#achSummary" ? summary : null; },
    escapeHtml: value => String(value),
  });
  vm.runInContext(
    `${clientFunctionSource("filterAchievementList")}\n${clientFunctionSource("renderAchievements")}`,
    context,
  );
  const data = { ok: true, list: [
    { id: "first_win", name: "첫 승리", desc: "한 번 승리", coin: 100, unlockedAt: "2026-10-01T00:00:00.000Z" },
    { id: "win10", name: "10승", desc: "열 번 승리", coin: 200 },
  ] };
  context.renderAchievements(data);
  assert.equal(summary.textContent, "해금 1/2");
  assert.equal((grid.innerHTML.match(/class="ach-card/g) || []).length, 2);
  context.achievementFilter = "unlocked";
  context.renderAchievements(data);
  assert.equal(summary.textContent, "해금 1/2", "필터가 전체 해금 현황을 바꾸지 않습니다");
  assert.equal((grid.innerHTML.match(/class="ach-card/g) || []).length, 1);
  assert.match(grid.innerHTML, /첫 승리/);
  context.achievementFilter = "locked";
  context.renderAchievements(data);
  assert.match(grid.innerHTML, /10승/);
  assert.doesNotMatch(grid.innerHTML, /첫 승리/);
});

test("릿 allows only 릿/잇 as the next initial; 닛 has no reverse exception", () => {
  assert.deepEqual(game.allowedFirstChars("릿"), ["릿", "잇"]);
  assert.equal(game.canConnect("릿", "잇다"), true);
  assert.equal(game.canConnect("릿", "릿다"), true);
  assert.equal(game.canConnect("릿", "닛다"), false);
  assert.equal(game.canConnect("닛", "릿다"), true, "릿은 닛의 일반 ㄹ→ㄴ 역방향 규칙을 그대로 따른다");
  assert.ok(game.allowedFirstChars("렙").includes("엡"));
  assert.ok(game.allowedFirstChars("륄").includes("윌"));
  assert.equal(game.canConnect("엡", "렙다"), false, "검증된 루트 연결을 반대 방향 두음으로 확장하지 않습니다");
  assert.equal(game.canConnect("윌", "륄다"), false, "검증된 루트 연결을 반대 방향 두음으로 확장하지 않습니다");
});

test("custom dueum exceptions retain rare-root continuations from the supplied root lists", () => {
  const d = dict();
  const rootFiles = ["끄글_주요 루트 단어_20260823005524.txt", "끄글_희귀 루트 단어_20260823005524.txt"];
  let checked = 0;
  for (const file of rootFiles) {
    for (const line of fs.readFileSync(path.join(__dirname, "../data", file), "utf8").split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const last = game.normalizeWord(line.slice(0, colon));
      for (const next of line.slice(colon + 1).split(/[,，\s]+/).map(game.normalizeWord).filter(Boolean)) {
        assert.equal(game.canConnect(last, next), true, `기존 루트 연결이 차단됨: ${last} → ${next}`);
        assert.ok(game.getCandidates(last, new Set(), d.WORD_INDEX).includes(next), `루트 후보가 후보 목록에서 누락됨: ${last} → ${next}`);
        assert.ok(game.getCandidates(next, new Set([last, next]), d.WORD_INDEX).length > 0, `기존에 지지 않던 루트 경로가 한방 패배로 바뀜: ${last} → ${next}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 3593);
  assert.equal(game.canConnect("렙", "엡스탱"), true);
  assert.equal(game.canConnect("륄", "윌리엄슨"), true);
});

test("mobile navigation hint appears only when the menu overflows", () => {
  const toggles = [];
  const nav = { scrollWidth: 300, clientWidth: 100, closest: () => shell };
  const shell = { classList: { toggle: (...args) => toggles.push(args) } };
  const updateHint = vm.runInNewContext(
    `${clientFunctionSource("updateMobileNavHint")}\nupdateMobileNavHint`,
    { $: selector => selector === ".tabs" ? nav : null },
  );
  updateHint();
  assert.deepEqual(toggles.at(-1), ["has-overflow", true]);
  nav.clientWidth = 320;
  updateHint();
  assert.deepEqual(toggles.at(-1), ["has-overflow", false]);
});


test("game result copy reports success and clipboard permission failures", async () => {
  const result = { winner: 1, winnerName: "승자", state: { history: [{ word: "사과", player: -1 }] } };
  const successStatus = { textContent: "" };
  let copied = "";
  const successCopy = vm.runInNewContext(
    `${clientFunctionSource("buildGameResultText")}\n${clientFunctionSource("copyReplayResult")}\ncopyReplayResult`,
    {
      lastReplayData: result,
      navigator: { clipboard: { async writeText(text) { copied = text; } } },
      $: () => successStatus,
    },
  );
  await successCopy();
  assert.match(copied, /승자 승리/);
  assert.equal(successStatus.textContent, "게임 결과를 복사했어요.");

  const failureStatus = { textContent: "" };
  const failedCopy = vm.runInNewContext(
    `${clientFunctionSource("buildGameResultText")}\n${clientFunctionSource("copyReplayResult")}\ncopyReplayResult`,
    {
      lastReplayData: result,
      navigator: { clipboard: { async writeText() { throw new Error("denied"); } } },
      $: () => failureStatus,
    },
  );
  await failedCopy();
  assert.match(failureStatus.textContent, /클립보드 권한/);
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

  const buyerLedger = await c.getEconomyHistory("buyer");
  assert.equal(buyerLedger.find(h => h.reason === "shop_shield").delta, -2000000);
  assert.equal(buyerLedger.find(h => h.reason === "shop_potion").delta, -1000000);
  const richLedger = await c.getEconomyHistory("rich");
  assert.equal(richLedger.find(h => h.reason === "shop_multiplier").delta, -5000000);

  /* 같은 요청 ID를 재전송해도 보호 티켓은 한 번만 차감된다 */
  c.socketNicks.set(s.id, "retry-buyer");
  seed(c, "retry-buyer", { money: 5000000 });
  await s.handlers.get("shop:buyShield")({ requestId: "same-request" });
  await s.handlers.get("shop:buyShield")({ requestId: "same-request" });
  const retryPd = c.playerCache.get("retry-buyer");
  assert.equal(retryPd.money, 3000000, "중복 요청은 두 번 차감하지 않는다");
  assert.equal(retryPd.shieldTickets, 1);
  assert.equal(errors.length, 0, errors.join(" | "));
});

test("title purchase is recorded once in the coin ledger", async () => {
  const { c, errors } = context();
  const s = socket("s-title");
  c.socketNicks.set(s.id, "title-buyer");
  seed(c, "title-buyer", { money: 100000, titles: [] });
  installHandler(c, "shop:buyTitle", s);
  await s.handlers.get("shop:buyTitle")({ titleId: "t_rookie", requestId: "title-1" });
  let res = s.emissions.filter(([event]) => event === "shop:result").at(-1);
  assert.equal(res[1].ok, true);
  assert.equal(c.playerCache.get("title-buyer").money, 80000);
  await s.handlers.get("shop:buyTitle")({ titleId: "t_rookie", requestId: "title-2" });
  res = s.emissions.filter(([event]) => event === "shop:result").at(-1);
  assert.equal(res[1].ok, false, "이미 보유한 칭호는 재구매할 수 없다");
  assert.equal(c.playerCache.get("title-buyer").money, 80000);
  const hist = await c.getEconomyHistory("title-buyer");
  assert.equal(hist.filter(h => h.reason === "shop_title").length, 1);
  assert.equal(hist.find(h => h.reason === "shop_title").delta, -20000);
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

test("economy ledger accepts an idempotency key once and records the balance", async () => {
  const { c, errors } = context();
  const first = await c.beginEconomyTx({
    accountId: "coin-user", idemKey: "attendance:coin-user:2026-10-04",
    delta: 2000, reason: "attendance", ref: "2026-10-04"
  });
  assert.equal(first.ok, true);
  await c.finishEconomyTx(first, 92000);
  const again = await c.beginEconomyTx({
    accountId: "coin-user", idemKey: "attendance:coin-user:2026-10-04",
    delta: 2000, reason: "attendance", ref: "2026-10-04"
  });
  assert.equal(again.ok, false);
  assert.equal(again.duplicate, true, "같은 요청은 두 번 지급되지 않는다");
  const hist = await c.getEconomyHistory("coin-user");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].delta, 2000);
  assert.equal(hist[0].balanceAfter, 92000);
  const summary = await c.getEconomySummary("coin-user");
  assert.equal(summary.today.income, 2000);
  assert.equal(summary.today.expense, 0);
  assert.equal(summary.today.net, 2000);
  assert.equal(summary.week.count, 1);
  assert.equal(errors.length, 0, errors.join(" | "));
});

test("welcome ledger records a reward once per day", async () => {
  const { c } = context();
  await c.recordWelcomeLedger("welcome-user", 4000, 94000);
  await c.recordWelcomeLedger("welcome-user", 4000, 94000);
  const hist = await c.getEconomyHistory("welcome-user");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].delta, 4000);
  assert.equal(hist[0].reason, "welcome");
  assert.equal(hist[0].balanceAfter, 94000);
});

test("rename moves the coin ledger to the new account key", async () => {
  const { c } = context();
  await c.beginEconomyTx({
    accountId: "old-name", idemKey: "attendance:old-name:2026-10-04",
    delta: 2000, reason: "attendance", ref: "2026-10-04"
  });
  await c.renameEconomyAccount("old-name", "new-name");
  assert.equal((await c.getEconomyHistory("old-name")).length, 0);
  const moved = await c.getEconomyHistory("new-name");
  assert.equal(moved.length, 1);
  assert.equal(moved[0].delta, 2000);
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
  assert.equal((await c.getEconomyHistory("champ")).find(h => h.reason === "season").delta, 1000000);
  assert.equal((await c.getEconomyHistory("runner")).find(h => h.reason === "season").delta, 500000);
  assert.equal((await c.getEconomyHistory("bystander")).length, 0);
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

test("ranked queue broadcasts nearby counts and records recent matches", () => {
  const now = Date.now();
  const queue = [
    { socketId: "rank-q1", nickname: "가", rating: 1000, joinedAt: now - 10000 },
    { socketId: "rank-q2", nickname: "나", rating: 1050, joinedAt: now - 2000 },
    { socketId: "rank-q3", nickname: "다", rating: 2000, joinedAt: now - 500 },
  ];
  const sent = new Map();
  const globalEmits = [];
  const c = vm.createContext({
    RANKED_QUEUE: queue,
    RANKED_QUEUE_MAP: new Map(queue.map(q => [q.socketId, true])),
    RANKED_RECENT_MATCHES: [{ at: now, waitMs: 5000 }],
    io: {
      to: (id) => ({ emit: (event, payload) => sent.set(id, { event, payload }) }),
      emit: (event, payload) => globalEmits.push({ event, payload }),
    },
  });
  vm.runInContext(`${functionSource("broadcastRankedQueue")}\nbroadcastRankedQueue`, c);
  c.broadcastRankedQueue();
  const first = sent.get("rank-q1");
  assert.equal(first.event, "ranked:queueSize");
  assert.equal(first.payload.size, 3);
  assert.equal(first.payload.nearbyCount, 1, "레이팅 ±100 이내 인원만 센다");
  assert.equal(sent.get("rank-q3").payload.nearbyCount, 0);
  assert.equal(first.payload.averageWaitMs, 5000);
  assert.ok(first.payload.oldestWaitMs >= 9000, "가장 오래 기다린 시간을 포함한다");

  queue.length = 0;
  c.RANKED_QUEUE_MAP.clear();
  c.broadcastRankedQueue();
  assert.equal(globalEmits.at(-1).payload.size, 0, "빈 큐는 전체 브로드캐스트");
});

test("ranked matching records the wait time of the matched pair", () => {
  const now = Date.now();
  const queue = [
    { socketId: "match-a", nickname: "가", rating: 1200, joinedAt: now - 8000 },
    { socketId: "match-b", nickname: "나", rating: 1210, joinedAt: now - 1000 },
  ];
  const started = [];
  const c = vm.createContext({
    RANKED_QUEUE: queue,
    RANKED_QUEUE_MAP: new Map(queue.map(q => [q.socketId, true])),
    RANKED_RECENT_MATCHES: [],
    io: { sockets: { sockets: new Map([["match-a", {}], ["match-b", {}]]) } },
    startRankedGame: (a, b) => started.push([a.socketId, b.socketId]),
    broadcastRankedQueue() {},
  });
  vm.runInContext(`${functionSource("tryMatchRanked")}\ntryMatchRanked`, c);
  c.tryMatchRanked();
  assert.equal(started.length, 1);
  assert.equal(c.RANKED_RECENT_MATCHES.length, 1);
  assert.ok(c.RANKED_RECENT_MATCHES[0].waitMs >= 7000, "오래 기다린 쪽 기준 대기 시간");
});

test("chat send/report require a Google session; history is readable by anyone", async () => {
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
  const hist = s.emissions.find(([event]) => event === "chat:history");
  assert.ok(hist, "이력은 로그인 없이도 받는다(보이는 채팅)");
  assert.equal(hist[1].ok, true);
  const rep = s.emissions.find(([event]) => event === "chat:reportResult");
  assert.ok(rep);
  assert.equal(rep[1].ok, false);
  assert.match(String(rep[1].reason || ""), /로그인/);
  assert.equal(emissions.some(([event]) => event === "chat:message"), false, "어디에도 브로드캐스트되지 않는다");
});

test("chat goes global without a room, stays inside a multiplayer room, global again in an AI room", async () => {
  const { c, emissions, ioRooms } = context();
  const s = socket("chatter");
  c.registerOnline(s.id, "말쟁이");
  c.socketFirebaseUid.set(s.id, "uid-chat");
  installHandler(c, "chat:send", s);
  const reset = () => { vm.runInContext("CHAT_ACCOUNT_RATE.clear()", c); s.data.chatLastAt = 0; s.data.chatWin = []; };

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

test("chat throttle follows the account across new sockets", async () => {
  const { c, emissions } = context();
  const a = socket("acc-a");
  const b = socket("acc-b");
  c.registerOnline(a.id, "계정유저");
  c.registerOnline(b.id, "계정유저");
  c.socketFirebaseUid.set(a.id, "uid-shared");
  c.socketFirebaseUid.set(b.id, "uid-shared");
  installHandler(c, "chat:send", a);
  installHandler(c, "chat:send", b);
  await a.handlers.get("chat:send")({ text: "첫 소켓" });
  await b.handlers.get("chat:send")({ text: "새 소켓" });
  assert.equal(emissions.filter(([event]) => event === "chat:message").length, 1, "새 소켓으로 우회할 수 없다");
  const err = b.emissions.find(([event]) => event === "chat:error");
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
  vm.runInContext("CHAT_ACCOUNT_RATE.clear()", c);
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

test("global chat history survives restarts via kv store", async () => {
  /* 부팅 로드: 저장소의 정상 형식 메시지만 이력으로 복원 */
  const { c } = context({
    loadStoreJSON: async () => [
      { from: "a", text: "지난 메시지", scope: "global", id: "1" },
      { junk: true },
      { from: "b", text: 123 }
    ]
  });
  await c.loadChatHistory();
  const hist = vm.runInContext("GLOBAL_CHAT_HISTORY", c);
  assert.equal(hist.length, 1, "정상 형식만 복원");
  assert.equal(hist[0].text, "지난 메시지");
  assert.equal(hist[0].scope, "global");

  /* 저장: 현재 이력이 저장소 키 chatHistory로 기록된다 */
  const saved = [];
  const { c: c2 } = context({ writeStoreFile: (fp, value, key) => saved.push({ fp, key, value }) });
  vm.runInContext(`GLOBAL_CHAT_HISTORY.push({ from: "x", text: "새 메시지", scope: "global", id: "9" })`, c2);
  c2.saveChatHistoryNow();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "chatHistory");
  assert.equal(saved[0].value.length, 1);
  assert.equal(saved[0].value[0].text, "새 메시지");
});

test("chat:history returns room backlog when roomId is provided", async () => {
  const { c } = context();
  const s = socket("room-reader");
  const room = { id: "ROOM-H", mode: "online", chat: [{ from: "a", text: "이전 방 대화", scope: "room", id: "1" }] };
  c.ROOMS.set("ROOM-H", room);
  installHandler(c, "chat:history", s);
  await s.handlers.get("chat:history")({ roomId: "ROOM-H" });
  const hit = s.emissions.find(([event]) => event === "chat:history");
  assert.equal(hit[1].scope, "room");
  assert.equal(hit[1].roomId, "ROOM-H");
  assert.equal(hit[1].messages.length, 1);
  assert.equal(hit[1].messages[0].text, "이전 방 대화");

  /* roomId가 없거나 없는 방이면 전체 이력으로 폴백 */
  const s2 = socket("global-reader");
  installHandler(c, "chat:history", s2);
  await s2.handlers.get("chat:history")({ roomId: "GONE" });
  const hit2 = s2.emissions.find(([event]) => event === "chat:history");
  assert.equal(hit2[1].scope, "global");
});

test("chat send stores messages into room.chat while room is alive", async () => {
  const { c } = context();
  const s = socket("room-writer");
  c.registerOnline(s.id, "말쟁이");
  c.socketFirebaseUid.set(s.id, "uid-rw");
  const room = { id: "ROOM-W", mode: "online", players: [{ socketId: s.id, nickname: "말쟁이", playerIndex: 0, isBot: false }], chat: [] };
  c.getPlayerRoom = () => room;
  installHandler(c, "chat:send", s);
  await s.handlers.get("chat:send")({ text: "방 메시지 하나" });
  assert.equal(room.chat.length, 1, "room.chat에 쌓인다");
  assert.equal(room.chat[0].text, "방 메시지 하나");
  assert.equal(room.chat[0].scope, "room");
  assert.equal(vm.runInContext("GLOBAL_CHAT_HISTORY", c).length, 0, "전역 이력에는 안 쌓인다");
});

test("three distinct reporters auto-mute the target for 10 minutes", async () => {
  const { c } = context();
  const target = "도배쟁이";
  /* 서로 다른 세 신고자 */
  for (const rid of ["r1", "r2", "r3"]) {
    const s = socket(rid);
    c.socketFirebaseUid.set(s.id, `uid-${rid}`);
    c.registerOnline(s.id, `신고자${rid}`);
    installHandler(c, "chat:report", s);
    await s.handlers.get("chat:report")({ nickname: target, text: "욕설" });
  }
  const normKey = vm.runInContext("normKey", c);
  const mute = c.mutedMap.get(normKey(target));
  assert.ok(mute, "3명 누적 시 자동 뮤트가 걸린다");
  assert.match(String(mute.reason || ""), /반복/);
  assert.ok(mute.until, "기간제(10분) 뮤트");
  assert.equal(mute.by, "auto-reports");
});

test("renameAccountRefs migrates friend/guild keys from old to new nick", () => {
  const { c } = context();
  const friendsMap = new Map();
  friendsMap.set("alice", new Set(["bob", "oldname"]));
  friendsMap.set("bob", new Set(["alice", "oldname"]));
  friendsMap.set("oldname", new Set(["alice", "bob"]));
  c.friendsMap = friendsMap;
  c.friendRequests = new Map([["oldname", new Set(["carol"])]]);
  c.guildCache = { g1: { key: "g1", name: "길드", leader: "oldname", leaderNick: "구명", members: [{ key: "oldname", nick: "구명" }, { key: "bob", nick: "bob" }] } };

  c.renameAccountRefs("oldname", "newname", "새명");

  assert.ok(!friendsMap.has("oldname"), "옛 키는 제거된다");
  assert.ok(friendsMap.get("newname").has("alice"), "새 키로 옮겨진다");
  assert.ok(friendsMap.get("alice").has("newname"), "상대 목록도 갱신된다");
  assert.ok(friendsMap.get("bob").has("newname"), "또 다른 친구 목록도 갱신된다");
  assert.ok(c.friendRequests.get("newname").has("carol"), "신청 대기열도 갱신된다");
  assert.equal(c.guildCache.g1.leader, "newname");
  assert.equal(c.guildCache.g1.leaderNick, "새명");
  assert.equal(c.guildCache.g1.members[0].key, "newname");
});

test("rename migrates moderation keys, watchlist, and chat history display names", () => {
  const { c, emissions } = context();
  const friendsMap = new Map();
  c.friendsMap = friendsMap;
  c.friendRequests = new Map();
  c.mutedMap.set("도배쟁이", { nick: "도배쟁이", by: "admin", at: "2026-01-01", reason: "도배", uid: "uid-d", until: null });
  c.bannedMap.set("도배쟁이", { nick: "도배쟁이", by: "admin", at: "2026-01-01", reason: "욕설", uid: "uid-d", until: null });
  c.watchNicks.push("도배쟁이", "남의이름");
  vm.runInContext(`GLOBAL_CHAT_HISTORY.push({ from: "도배쟁이", text: "이전 메시지", scope: "global", id: "1" })`, c);
  c.ROOMS.set("R1", { id: "R1", mode: "online", chat: [{ from: "도배쟁이", text: "방에서도", scope: "room", id: "2" }] });

  c.renameAccountRefs("도배쟁이", "얌전이", "얌전이");

  /* 제재 목록 — 옛 키로 남으면 개명 즉시 조회가 끊긴다 */
  assert.ok(!c.mutedMap.has("도배쟁이"), "뮤트가 옛 키에 남지 않는다");
  assert.ok(!c.bannedMap.has("도배쟁이"), "밴이 옛 키에 남지 않는다");
  assert.equal(c.mutedMap.get("얌전이").nick, "얌전이", "뮤트 표시명이 갱신된다");
  assert.equal(c.bannedMap.get("얌전이").reason, "욕설", "사유는 유지된다");
  /* 감시 목록 */
  assert.deepEqual([...c.watchNicks], ["얌전이", "남의이름"], "감시 대상도 개명된다");
  /* 채팅 이력 표시명 — 전체·방 모두 */
  const hist = vm.runInContext("GLOBAL_CHAT_HISTORY", c);
  assert.equal(hist[0].from, "얌전이", "전체 채팅 이력 표시명이 갱신된다");
  assert.equal(c.ROOMS.get("R1").chat[0].from, "얌전이", "방 채팅 이력 표시명이 갱신된다");
  assert.equal(emissions.length, 0, "이 함수는 브로드캐스트하지 않는다");
});

test("rename broadcasts profile:nickChanged so other screens update immediately", async () => {
  const { c, emissions } = context();
  const s = socket("renamed-live");
  seed(c, "oldname", { money: 5000000, nameChanges: 0 });
  c.registerOnline(s.id, "oldname");
  c.socketFirebaseUid.set(s.id, "uid-live");
  vm.runInContext(`GLOBAL_CHAT_HISTORY.push({ from: "oldname", text: "안녕", scope: "global", id: "1" })`, c);
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "newname" });
  const upd = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.equal(upd[1].ok, true);
  const nickChanged = emissions.find(([event]) => event === "profile:nickChanged");
  assert.ok(nickChanged, "개명이 전체에 브로드캐스트되어야 합니다");
  assert.equal(nickChanged[1].old, "oldname");
  assert.equal(nickChanged[1].new, "newname");
  assert.equal(nickChanged[1].oldKey, "oldname");
  /* 이력 표시명도 함께 갱신된다 */
  const hist = vm.runInContext("GLOBAL_CHAT_HISTORY", c);
  assert.equal(hist[0].from, "newname");
});

test("admin:chatClear wipes global history and emits chat:cleared", async () => {
  const { c, emissions } = context();
  const s = socket("admin-cc");
  vm.runInContext(`GLOBAL_CHAT_HISTORY.push({ from: "a", text: "지워질 대화", scope: "global", id: "1" })`, c);
  installHandler(c, "admin:chatClear", s);
  await s.handlers.get("admin:chatClear")();
  const result = s.emissions.find(([event]) => event === "admin:chatClearResult");
  assert.equal(result[1].ok, true);
  assert.equal(vm.runInContext("GLOBAL_CHAT_HISTORY", c).length, 0, "이력이 비워진다");
  const cleared = emissions.find(([event]) => event === "chat:cleared");
  assert.ok(cleared, "모든 유저에게 chat:cleared 브로드캐스트");
});

test("startKeepAlivePing schedules fetch when PUBLIC_URL is set", () => {
  const { c } = context({ fetchCalls: [] });
  /* PUBLIC_URL이 없는 환경에서는 ping을 설치하지 않는다 */
  c.PUBLIC_URL = "";
  assert.equal(typeof c.startKeepAlivePing, "function");
  /* PUBLIC_URL이 있으면 setInterval로 핑을 예약한다 */
  let intervalSet = false;
  c.setInterval = (fn, ms) => { intervalSet = true; assert.ok(ms >= 60000); return { unref() {} }; };
  c.PUBLIC_URL = "https://example.onrender.com";
  c.startKeepAlivePing();
  assert.ok(intervalSet, "PUBLIC_URL이 있으면 setInterval이 호출된다");
});
