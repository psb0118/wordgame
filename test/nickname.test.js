"use strict";

/* 입력창 안내문이 계정 이름으로 저장돼 랭킹에 노출되던 문제의 회귀 방지 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../server/server.js"), "utf8");

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker for: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

const normKeyLine = /^const normKey = [^\n]*;$/m.exec(source);
assert.ok(normKeyLine, "missing normKey");

const sandbox = vm.createContext({});
vm.runInContext([
  normKeyLine[0],
  slice("const PLACEHOLDER_NICKS = ", "]);"),
  slice("function isPlaceholderNickname(", "\n}"),
  slice("function isGhostRecord(", "\n}")
].join("\n"), sandbox);

test("placeholder and empty nicknames are rejected as names", () => {
  for (const n of ["닉네임", " 닉네임 ", "정보", "플레이어", "이름", "undefined", "", "   "]) {
    assert.equal(sandbox.isPlaceholderNickname(n), true, JSON.stringify(n));
  }
  for (const n of ["정보왕", "정재", "버프", "닉네임2", "플레이어1"]) {
    assert.equal(sandbox.isPlaceholderNickname(n), false, n);
  }
});

test("ghost records cover placeholder, empty, and missing nicknames", () => {
  assert.equal(sandbox.isGhostRecord({ nickname: "정보" }), true);
  assert.equal(sandbox.isGhostRecord({ nickname: "닉네임" }), true);
  assert.equal(sandbox.isGhostRecord({ nickname: "" }), true);
  assert.equal(sandbox.isGhostRecord({}), true);
  assert.equal(sandbox.isGhostRecord({ nickname: "정재" }), false);
});
