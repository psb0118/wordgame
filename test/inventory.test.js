"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const inventory = require("../server/inventory.js");

test("inventory serialization normalizes all account item fields", () => {
  const pd = {
    moneyMultiplier: 3,
    ratingBoostGames: 7,
    shieldTickets: 2,
    titles: [{ id: "t_rookie", name: " 풋내기 도전자 " }, { id: "t_rookie", name: "중복" }, null],
    currentTitle: " 풋내기 도전자 "
  };
  inventory.ensure(pd);
  const snap = inventory.serialize(pd);
  assert.equal(snap.version, 1);
  assert.equal(snap.revision, 0);
  assert.equal(snap.moneyMultiplier, 3);
  assert.equal(snap.ratingBoostGames, 7);
  assert.equal(snap.shieldTickets, 2);
  assert.deepEqual(snap.titles, [{ id: "t_rookie", name: "풋내기 도전자" }]);
  assert.equal(snap.currentTitle, "풋내기 도전자");
});

test("inventory revision increments only when bumped and rejects stale patches", () => {
  const pd = inventory.ensure({ moneyMultiplier: 1, titles: [] });
  assert.equal(inventory.revisionOf(pd), 0);
  inventory.bumpRevision(pd);
  inventory.bumpRevision(pd);
  assert.equal(inventory.serialize(pd).revision, 2);
  assert.equal(inventory.isStale(1, 2), true);
  assert.equal(inventory.isStale(2, 2), false);
  assert.equal(inventory.isStale(3, 2), false);
});

test("inventory clamps unsafe values and title ids", () => {
  const pd = inventory.ensure({
    moneyMultiplier: 999,
    ratingBoostGames: -10,
    shieldTickets: "4",
    titles: [{ id: "<script>", name: "x" }, { id: "ok_title", name: "정상" }],
    currentTitle: 42
  });
  assert.equal(pd.moneyMultiplier, 99);
  assert.equal(pd.ratingBoostGames, 0);
  assert.equal(pd.shieldTickets, 4);
  assert.deepEqual(pd.titles, [{ id: "ok_title", name: "정상" }]);
  assert.equal(pd.currentTitle, "");
});
