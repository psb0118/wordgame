"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const daily = require("../server/daily-challenge.js");

test("daily challenge is deterministic per KST date", () => {
  const a = daily.challengeForDate("2026-11-20");
  const b = daily.challengeForDate("2026-11-20");
  const c = daily.challengeForDate("2026-11-21");
  assert.deepEqual(a, b);
  assert.ok(a.id);
  assert.ok(a.target > 0);
  assert.ok(a.reward > 0);
  assert.notEqual(a.id, c.id);
});

test("daily progress accumulates only matching game metrics and stops at target", () => {
  const date = "2026-11-20";
  const def = daily.challengeForDate(date);
  const raw = daily.emptyState(date);
  const game = {
    mode: def.metric === "rankedWords" ? "ranked" : "single",
    words: 5,
    longWords: 3,
    attacks: 4,
    win: true
  };
  const one = daily.applyGame(raw, game, date);
  const two = daily.applyGame(one, game, date);
  const pub = daily.publicState(two, date);
  assert.equal(pub.id, def.id);
  assert.equal(pub.target, def.target);
  assert.ok(pub.progress <= def.target);
  assert.equal(pub.claimed, false);
  assert.equal(daily.complete(two, date), pub.complete);
});

test("claimed challenge keeps progress and resets on a new date", () => {
  const date = "2026-11-20";
  const def = daily.challengeForDate(date);
  const raw = { date, progress: def.target, claimed: true, claimedAt: "2026-11-20T03:00:00.000Z" };
  const same = daily.normalizeState(raw, date);
  assert.equal(same.claimed, true);
  assert.equal(daily.publicState(same, date).percent, 100);
  assert.equal(daily.applyGame(same, { words: 99, longWords: 99, attacks: 99, wins: 1 }, date).progress, def.target);

  const next = daily.normalizeState(same, "2026-11-21");
  assert.equal(next.date, "2026-11-21");
  assert.equal(next.progress, 0);
  assert.equal(next.claimed, false);
});
