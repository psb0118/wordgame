"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const metrics = require("../server/panel-metrics.js");

test("panel metrics counts known panels and actions", () => {
  metrics.reset();
  assert.equal(metrics.track("shop", "view"), true);
  assert.equal(metrics.track("shop", "view"), true);
  assert.equal(metrics.track("coach", "open"), true);
  assert.equal(metrics.track("unknown", "view"), false);
  assert.equal(metrics.track("shop", "delete"), false);
  const snap = metrics.snapshot();
  assert.equal(snap.find(row => row.panel === "shop").count, 2);
  assert.equal(snap.find(row => row.panel === "coach").count, 1);
  assert.equal(snap[0].panel, "shop");
});

test("panel metrics reset clears counters", () => {
  metrics.reset();
  metrics.track("season", "view");
  assert.equal(metrics.snapshot().length, 1);
  metrics.reset();
  assert.equal(metrics.snapshot().length, 0);
});
