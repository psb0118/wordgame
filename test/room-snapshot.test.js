"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const snap = require("../server/room-snapshot.js");

function room(overrides = {}) {
  const now = Date.now();
  return {
    id: "AB12CD",
    mode: "online",
    createdAt: now - 60000,
    started: true,
    finished: false,
    currentWord: "사과",
    turnPlayerIndex: 1,
    turnNumber: 3,
    gameSessionId: 2,
    hintsUsed: 1,
    history: [{ word: "사과", player: 0, nickname: "가", depth: 1, turn: 1 }],
    usedWords: new Set(["사과"]),
    players: [
      { id: "u1", socketId: "s1", playerIndex: 0, nickname: "가", isBot: false, alive: true, connected: true, hearts: 2, eliminated: false, mistakes: 1, teamOf: null },
      { id: "u2", socketId: "s2", playerIndex: 1, nickname: "나", isBot: false, alive: true, connected: true, hearts: 1, eliminated: false, mistakes: 0, teamOf: null }
    ],
    ...overrides
  };
}

test("room snapshots keep human gameplay state and drop sockets", () => {
  const payload = snap.collectRooms([room()], { now: Date.now() });
  assert.equal(payload.rooms.length, 1);
  const saved = payload.rooms[0];
  assert.equal(saved.id, "AB12CD");
  assert.equal(saved.players.length, 2);
  assert.equal(saved.players[0].socketId, undefined, "소켓 ID는 저장하지 않는다");
  assert.deepEqual(saved.usedWords, ["사과"]);
  assert.equal(saved.currentWord, "사과");
});

test("room snapshots skip AI rooms, finished rooms, and rooms without humans", () => {
  const now = Date.now();
  const payload = snap.collectRooms([
    room({ id: "AIROOM", mode: "ai" }),
    room({ id: "DONE01", finished: true }),
    room({ id: "BOTS01", players: [{ nickname: "AI", isBot: true }] })
  ], { now });
  assert.equal(payload.rooms.length, 0);
});

test("restored rooms start disconnected and wait for reconnects", () => {
  const payload = snap.collectRooms([room()], { now: Date.now() });
  const [restored] = snap.restoreRooms(payload, { now: Date.now() });
  assert.equal(restored.restored, true);
  assert.equal(restored.finished, false);
  assert.equal(restored.timer, null);
  assert.equal(restored.turnStartedAt, null);
  assert.equal(restored.players.length, 2);
  assert.ok(restored.players.every(p => p.connected === false));
  assert.ok(restored.players.every(p => p.socketId === null));
  assert.ok(restored.usedWords instanceof Set);
  assert.ok(restored.usedWords.has("사과"));
  assert.equal(restored.turnPlayerIndex, 1);
  assert.equal(snap.allHumansConnected(restored), false);
});

test("restored rooms fix a turn index that points at an eliminated player", () => {
  const base = room();
  base.players[1].eliminated = true;
  base.players[1].alive = false;
  const [restored] = snap.restoreRooms(snap.collectRooms([base], { now: Date.now() }), { now: Date.now() });
  assert.equal(restored.turnPlayerIndex, 0);
});

test("stale snapshots and malformed rooms are ignored", () => {
  const now = Date.now();
  const payload = { version: 1, savedAt: now - snap.MAX_AGE_MS - 1000, rooms: [snap.serializeRoom(room())] };
  assert.deepEqual(snap.restoreRooms(payload, { now }), [], "24시간 지난 스냅샷은 복구하지 않는다");

  const malformed = { version: 1, savedAt: now, rooms: [{ id: "bad id", mode: "online", players: [] }, null] };
  assert.deepEqual(snap.restoreRooms(malformed, { now }), []);
});

test("allHumansConnected only passes when every human is back", () => {
  const [restored] = snap.restoreRooms(snap.collectRooms([room()], { now: Date.now() }), { now: Date.now() });
  assert.equal(snap.allHumansConnected(restored), false);
  restored.players[0].connected = true;
  assert.equal(snap.allHumansConnected(restored), false);
  restored.players[1].connected = true;
  assert.equal(snap.allHumansConnected(restored), true);
});
