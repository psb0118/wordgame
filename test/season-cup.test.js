"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cup = require("../server/season-cup.js");

/* 2026-11-20 12:00 UTC = 2026-11-20 21:00 KST */
const start = Date.UTC(2026, 10, 20, 12, 0, 0);

test("season cup schedule uses KST 21:00 and opens a 30 minute live window", () => {
  assert.equal(cup.todaySlot(start - 1), start);
  assert.equal(cup.nextSlot(start - 1), start);
  assert.equal(cup.nextSlot(start), start + 86400000);
  assert.equal(cup.currentLiveSlot(start), start);
  assert.equal(cup.currentLiveSlot(start + cup.CUP_DURATION_MS - 1), start);
  assert.equal(cup.currentLiveSlot(start + cup.CUP_DURATION_MS), null);
  assert.equal(cup.slotLabel(start), "11.20 21:00");
});

test("season cup info picks the live slot and reports reservation counts", () => {
  const slot = cup.slotKey(start);
  const info = cup.info(start + 1000, {
    myAccount: "alice",
    onlineAccounts: ["alice", "bob"],
    reservations: [
      { account: "alice", nickname: "Alice", slot },
      { account: "bob", nickname: "Bob", slot },
      { account: "carol", nickname: "Carol", slot }
    ]
  });
  assert.equal(info.state, "live");
  assert.equal(info.myReserved, true);
  assert.equal(info.reservedCount, 3);
  assert.equal(info.onlineReservedCount, 2);
  assert.equal(info.rewards.winnerCoins, 120000);
  assert.equal(info.rewards.title.id, "t_season_cup");
});

test("season cup info shows the next slot after the live window", () => {
  const info = cup.info(start + cup.CUP_DURATION_MS, {
    myAccount: "alice",
    reservations: [{ account: "alice", nickname: "Alice", slot: cup.slotKey(start + 86400000) }]
  });
  assert.equal(info.state, "upcoming");
  assert.equal(info.startAt, start + 86400000);
  assert.equal(info.myReserved, true);
  assert.ok(info.msUntilStart > 0);
});

test("season cup reservations and stores are sanitized", () => {
  const entry = cup.sanitizeReservation({ account: " Alice ", nickname: " Alice ", slot: " 2026-11-20T12:00:00.000Z " });
  assert.deepEqual({ account: entry.account, nickname: entry.nickname, slot: entry.slot }, {
    account: "alice", nickname: "Alice", slot: "2026-11-20T12:00:00.000Z"
  });
  assert.equal(cup.sanitizeReservation({ account: "", nickname: "x", slot: "s" }), null);
  const store = cup.sanitizeStore({ reservations: [entry, null], lastStarted: 123, history: [{}] });
  assert.equal(store.reservations.length, 1);
  assert.equal(store.lastStarted, "");
  assert.equal(store.history.length, 1);
});
