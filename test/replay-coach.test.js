"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const coach = require("../server/replay-coach.js");

function flow() {
  return [
    { w: "가", n: "시작", player: -1 },
    { w: "가방", n: "나", player: 0, m: true },
    { w: "방패", n: "상대", player: 1 },
    { w: "패션", n: "나", player: 0, m: true, d: 2 },
    { w: "션", n: "상대", player: 1 },
    { w: "션션이", n: "나", player: 0, m: true }
  ];
}

test("coach computes my stats without exposing opponent words as mine", () => {
  const result = coach.analyze(flow(), { win: true });
  assert.equal(result.ok, true);
  assert.equal(result.stats.myWords, 3);
  assert.equal(result.stats.longWords, 0);
  assert.equal(result.stats.attacks, 1);
  assert.equal(result.stats.longestWord, "션션이");
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(["S", "A", "B", "C", "D"].includes(result.grade));
  assert.equal(result.tips.length, 3);
});

test("coach recommends longer words and attacks for short defensive play", () => {
  const short = [
    { w: "가", n: "시작", player: -1 },
    { w: "가방", n: "나", player: 0, m: true },
    { w: "방", n: "상대", player: 1 },
    { w: "방울", n: "나", player: 0, m: true }
  ];
  const result = coach.analyze(short, { myIndex: 0, result: "lose" });
  assert.equal(result.ok, true);
  assert.ok(result.tips.some(tip => /공격|긴 단어|3글자/.test(tip.title + tip.body)));
  assert.ok(result.score < 100);
});

test("coach rejects flows with fewer than two words", () => {
  assert.equal(coach.analyze([], {}).ok, false);
  assert.equal(coach.analyze([{ w: "가" }], {}).ok, false);
});
