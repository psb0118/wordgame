"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const share = require("../server/replay-share.js");

test("replay share sanitizes fields and strips unknown data", () => {
  const flow = share.sanitizeFlow([
    { w: " 사과 ", n: " 나 ", m: 1, d: 2, t: 3, o: 0, id: "secret" },
    { w: "과자", n: "", d: 500, t: -1 }
  ]);
  assert.deepEqual(flow, [
    { w: "사과", n: "나", m: true, d: 2, t: 3, o: false },
    { w: "과자", n: "플레이어", m: false, d: null, t: null, o: false }
  ]);
});

test("replay share rejects chains shorter than two words and caps length", () => {
  assert.equal(share.sanitizeFlow([{ w: "사과" }]), null);
  assert.equal(share.sanitizeFlow("nope"), null);
  const long = Array.from({ length: 260 }, (_, i) => ({ w: `단어${i}` }));
  assert.equal(share.sanitizeFlow(long).length, share.MAX_FLOW);
});

test("replay share tokens are unguessable and validated", () => {
  const token = share.createToken();
  assert.equal(share.isToken(token), true);
  assert.equal(share.isToken("short"), false);
  assert.equal(share.isToken("../../etc/passwd"), false);
  assert.notEqual(share.createToken(), token);
});
