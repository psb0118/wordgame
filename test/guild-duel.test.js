"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const duel = require("../server/guild-duel.js");

function makeGuild(key, points, name) {
  return {
    key,
    name: name || key,
    week: { key: "2026-W44", points: { [key]: points } },
    members: [{ key, nick: key }]
  };
}

test("guild duel pairings are symmetric, closest by points, and stable", () => {
  const guilds = {
    a: makeGuild("a", 300), b: makeGuild("b", 280),
    c: makeGuild("c", 100), d: makeGuild("d", 90)
  };
  assert.equal(duel.ensurePairings(guilds, "2026-W44", Date.UTC(2026, 9, 28)), 4);
  assert.equal(guilds.a.duel.opponentKey, "b");
  assert.equal(guilds.b.duel.opponentKey, "a");
  assert.equal(guilds.c.duel.opponentKey, "d");
  assert.equal(guilds.d.duel.opponentKey, "c");
  assert.equal(duel.ensurePairings(guilds, "2026-W44", Date.UTC(2026, 9, 28)), 0);
});

test("guild duel ignores zero-point guilds and gives an odd guild a bye", () => {
  const guilds = { a: makeGuild("a", 100), b: makeGuild("b", 50), c: makeGuild("c", 0) };
  assert.equal(duel.ensurePairings(guilds, "2026-W44"), 2);
  assert.equal(guilds.a.duel.opponentKey, "b");
  assert.equal(guilds.c.duel.week, "");
  const alone = { a: makeGuild("a", 100) };
  assert.equal(duel.ensurePairings(alone, "2026-W44"), 1);
  assert.equal(alone.a.duel.opponentKey, "");
  assert.equal(duel.duelView(alone.a, alone, "2026-W44").state, "bye");
});

test("guild duel view compares live points and shows the record", () => {
  const guilds = { a: makeGuild("a", 120), b: makeGuild("b", 80) };
  duel.ensurePairings(guilds, "2026-W44");
  const view = duel.duelView(guilds.a, guilds, "2026-W44");
  assert.equal(view.state, "winning");
  assert.equal(view.myPoints, 120);
  assert.equal(view.opponent.points, 80);
  assert.deepEqual(view.record, { wins: 0, losses: 0, draws: 0 });
});

test("guild duel settlement picks a winner and records both sides", () => {
  const a = makeGuild("a", 120);
  const b = makeGuild("b", 80);
  const outcome = duel.settleDuel({ weekKey: "2026-W44", guild: a, opponent: b });
  assert.deepEqual({ result: outcome.result, amount: outcome.amount }, {
    result: "win", amount: duel.DUEL_WIN_REWARD
  });
  duel.applyDuelRecord(a, { weekKey: "2026-W44", result: "win", myPoints: 120, theirPoints: 80, opponentKey: "b", opponentName: "b", amount: 8000 });
  duel.applyDuelRecord(b, { weekKey: "2026-W44", result: "loss", myPoints: 80, theirPoints: 120, opponentKey: "a", opponentName: "a", amount: 3000 });
  assert.equal(a.duelWins, 1);
  assert.equal(b.duelLosses, 1);
  assert.equal(a.duelHistory.length, 1);
  assert.equal(a.duel.settled, true);
});

test("guild duel history is capped and reward amounts are fixed", () => {
  const g = makeGuild("a", 10);
  for (let i = 0; i < 12; i++) {
    duel.applyDuelRecord(g, {
      weekKey: "W" + i,
      result: i % 3 === 0 ? "win" : i % 3 === 1 ? "loss" : "draw",
      myPoints: 10, theirPoints: 5, opponentKey: "b", opponentName: "b", amount: 1
    });
  }
  assert.equal(g.duelHistory.length, duel.DUEL_HISTORY_LIMIT);
  assert.equal(duel.duelRewardFor("win"), 8000);
  assert.equal(duel.duelRewardFor("draw"), 5000);
  assert.equal(duel.duelRewardFor("loss"), 3000);
});
