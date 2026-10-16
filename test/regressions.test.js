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
    ROOMS: new Map(),
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
    TURN_TIME: 20, MAX_PLAYERS: 10, RECONNECT_GRACE_MS: 30000,
    setTimeout(fn, ms) { const t = { fn, ms, active: true }; timers.push(t); return t; },
    clearTimeout(t) { if (t && typeof t === "object") t.active = false; },
    io: { to: () => ({ emit: (...args) => emissions.push(args) }),
      sockets: { sockets: new Map() } },
    ...extra,
  });
  for (const name of ["normKey", "MODE_DEFAULT", "SEASON_DEFAULT"]) {
    const declaration = new RegExp(`^const ${name} = .*;$`, "m").exec(source);
    assert.ok(declaration, `missing constant: ${name}`);
    vm.runInContext(declaration[0], c);
  }
  for (const name of [
    "initPeriodData", "initDailyData", "initWeeklyData", "initMonthlyData",
    "migratePlayerData", "resolvePlayerId", "getPlayerData", "savePlayerData",
    "verifyFirebaseIdToken",
    "registerOnline", "unregisterOnline", "updateRating", "updateSingleResult",
    "recordMatchHistory", "finishGame", "migrateJsonPlayersToPg",
    "getPlayerBySocket", "getPlayerByIndex", "getAlivePlayers", "findNextAlivePlayer",
    "stopTurnTimer", "startTurnTimer", "removePlayer",
    "bumpMission", "bumpDaily", "playWord",
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
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "existing", password: "ignored" });
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
  installHandler(c, "player:setName", s);
  await s.handlers.get("player:setName")({ nickname: "target" });
  assert.equal(c.playerCache.get("target").money, 500);
  assert.equal(c.playerCache.get("old").money, 100);
});

test("new nickname still creates a new account", async () => {
  const { c } = context();
  const s = socket("new");
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
  assert.equal(c.playerCache.get("p1").money, 90000);
  assert.equal(c.playerCache.get("p0").money, 95000);
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

test("firebase token verification throws when service account is missing", async () => {
  const { c } = context();
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