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