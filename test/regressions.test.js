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
  const c = vm.createContext({
    structuredClone,
    console: { log() {}, warn() {}, error(...args) { errors.push(args.join(" ")); } },
    playerCache: new Map(), socketNicks: new Map(), onlineNicks: new Map(),
    adminAuthed: new Map(), disconnectedPlayers: new Map(), REMATCHES: new Map(),
    socketFirebaseUid: new Map(), socketFirebaseEmail: new Map(),
    ROOMS: new Map(),
    bannedMap: new Map(), mutedMap: new Map(),
    guildCache: null, guildsPath: "guilds.json",
    seasonStore: null,
    process: { env: {} },
    writeStoreFile() {}, loadStoreJSON: async () => null,
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
    broadcastRoomState() {}, getPublicRoomState: r => ({ roomId: r.id }),
    TURN_TIME: 20, MAX_PLAYERS: 10, RECONNECT_GRACE_MS: 30000, MAX_HEARTS: 3,
    PARTY_PLAYERS: 4, PARTY_TEAM_SIZE: 2, PARTY_TEAM_COUNT: 2,
    setTimeout(fn, ms) { const t = { fn, ms, active: true }; timers.push(t); return t; },
    clearTimeout(t) { if (t && typeof t === "object") t.active = false; },
    io: { to: () => ({ emit: (...args) => emissions.push(args) }),
      emit: (...args) => emissions.push(args),
      sockets: { sockets: new Map() } },
    requireNickname: async () => ({ ok: true, role: "super", nickname: "admin" }),
    ...extra,
  });
  for (const name of ["normKey", "MODE_DEFAULT", "SEASON_DEFAULT", "REACT_EMOJIS", "REACT_COOLDOWN_MS",
    "REFERRAL_JOIN_COIN", "REFERRAL_INVITE_COIN", "MAIL_MAX", "MAIL_COIN_MAX", "PLAYER_COLUMN_KEYS",
    "GUILD_MAX_MEMBERS", "GUILD_CREATE_COIN", "SEA_TITLE"]) {
    const declaration = new RegExp(`^const ${name} = .*;$`, "m").exec(source);
    assert.ok(declaration, `missing constant: ${name}`);
    vm.runInContext(declaration[0], c);
  }
  for (const name of [
    "initPeriodData", "initDailyData", "initWeeklyData", "initMonthlyData",
    "migratePlayerData", "resolvePlayerId", "getPlayerData", "savePlayerData",
    "claimDisplayName", "verifyFirebaseIdToken",
    "registerOnline", "unregisterOnline", "updateRating", "updateSingleResult",
    "recordMatchHistory", "finishGame", "migrateJsonPlayersToPg",
    "getPlayerBySocket", "getPlayerByIndex", "getAlivePlayers", "findNextAlivePlayer",
    "stopTurnTimer", "startTurnTimer", "removePlayer",
    "bumpMission", "bumpDaily", "playWord", "runAI", "startNewGame",
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
  ]) vm.runInContext(functionSource(name), c);
  return { c, errors, timers, emissions };
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

test("nickname switching loads target account instead of copying old account", async () => {
  const { c } = context();
  const s = socket("connected");
  seed(c, "old", { money: 100 });
  seed(c, "target", { money: 500 });
  c.registerOnline(s.id, "old");
  c.socketFirebaseUid.set(s.id, "uid-old");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "target" });
  assert.equal(c.playerCache.get("target").money, 500);
  assert.equal(c.playerCache.get("old").money, 100);
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

test("display name requires a verified Google session", async () => {
  const { c } = context();
  const s = socket("anon");
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "someone" });
  const hit = s.emissions.find(([event]) => event === "player:nameUpdated");
  assert.ok(hit);
  assert.equal(hit[1].ok, false);
  assert.equal(hit[1].needGoogleLogin, true);
  assert.equal(c.socketNicks.has(s.id), false);
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
