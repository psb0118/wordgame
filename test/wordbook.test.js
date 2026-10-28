"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const wordbook = require("../server/wordbook.js");

test("wordbook sanitize trims, dedupes, and caps the list", () => {
  const items = [
    { word: " 사과 ", at: "2026-10-01" },
    { word: "사과", at: "2026-10-02" },
    { word: "  " },
    { word: "나무", at: 123 }
  ];
  assert.deepEqual(wordbook.sanitize(items), [
    { word: "사과", at: "2026-10-01" },
    { word: "나무", at: "" }
  ]);
  const many = Array.from({ length: 400 }, (_, i) => ({ word: `단어${i}` }));
  assert.equal(wordbook.sanitize(many).length, wordbook.MAX_ITEMS);
});

test("wordbook add moves an existing word to the front without duplicating", () => {
  const before = [{ word: "가방", at: "1" }, { word: "나무", at: "2" }];
  const after = wordbook.add(before, "나무", "3");
  assert.deepEqual(after.map(entry => entry.word), ["나무", "가방"]);
  assert.equal(after.length, 2);
  assert.equal(after[0].at, "3");
});

test("wordbook merge keeps server order and only appends new local words", () => {
  const merged = wordbook.merge(
    [{ word: "가방", at: "1" }],
    [{ word: "나무", at: "2" }, { word: "가방", at: "3" }, { word: "구름" }]
  );
  assert.deepEqual(merged.map(entry => entry.word), ["가방", "나무", "구름"]);
});

test("wordbook remove only deletes the exact word", () => {
  const list = [{ word: "가방" }, { word: "나무" }];
  assert.deepEqual(wordbook.remove(list, "가방").map(entry => entry.word), ["나무"]);
  assert.deepEqual(wordbook.remove(list, "없는단어").map(entry => entry.word), ["가방", "나무"]);
});
