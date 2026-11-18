"use strict";

/* PG 모드의 코인 원자성 검증 — server.js의 실제 players 스키마와 UPSERT SQL을
   PGlite(내장 Postgres)에 그대로 실행한다. 외부 DB 없이 CI에서 돌릴 수 있다. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const source = fs.readFileSync(path.join(__dirname, "..", "server", "server.js"), "utf8");

function extract(pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `server.js에서 ${label}를 찾지 못했습니다`);
  return match[0];
}

const playersDdl = extract(/CREATE TABLE IF NOT EXISTS players \([\s\S]*?\n\s*\)/, "players 스키마") + ";";
const ledgerDdl = extract(/CREATE TABLE IF NOT EXISTS economy_ledger \([\s\S]*?\n\s*\)/, "economy_ledger 스키마") + ";";
const upsertSql = extract(
  /const saved = await dbPool\.query\(`([\s\S]*?)`,\s*\[/,
  "플레이어 UPSERT SQL"
).match(/`([\s\S]*?)`/)[1]
  .replace(/\$\{moneyInsert\}/g, "GREATEST(0, $16::bigint + $35::bigint)")
  .replace(/\$\{moneyUpdate\}/g, "GREATEST(0, players.money + $35::bigint)");

function playerParams({ nickname = "pg-tester", money = 0, delta = 0 } = {}) {
  return [
    nickname, nickname,
    1000, 0, 0, 0, 0,
    1000, 0, 0,
    1000, 0, 0, 0, 0,
    money, 1, 0,
    "[]", "", "", 0,
    "[]", "{}", "{}", "{}", "{}",
    null, "", "", 0, "[]", "", "{}",
    delta
  ];
}

test("player upsert applies coin deltas without losing concurrent changes", async () => {
  const db = new PGlite();
  try {
    await db.exec(playersDdl);
    const params = playerParams({ money: 1000, delta: 500 });
    assert.equal(params.length, 35, "UPSERT 파라미터 수가 SQL과 맞아야 한다");
    const first = await db.query(upsertSql, params);
    assert.equal(Number(first.rows[0].money), 1500);

    /* 오래된 스냅샷(잔액 1000)으로 저장해도 DB의 최신 잔액에 차분이 더해진다 */
    const second = await db.query(upsertSql, playerParams({ money: 1000, delta: 250 }));
    assert.equal(Number(second.rows[0].money), 1750);

    const floored = await db.query(upsertSql, playerParams({ money: 1000, delta: -999999 }));
    assert.equal(Number(floored.rows[0].money), 0, "잔액은 0 아래로 내려가지 않는다");
  } finally {
    await db.close();
  }
});

test("a firebase UID can move to a new player row only after the old row releases it", async () => {
  const db = new PGlite();
  try {
    await db.exec(playersDdl);
    await db.exec("CREATE UNIQUE INDEX idx_players_firebase_uid ON players(firebase_uid)");
    await db.query("INSERT INTO players (id, nickname, firebase_uid) VALUES ($1,$2,$3)", ["old", "old", "uid-move"]);

    await assert.rejects(
      db.query("INSERT INTO players (id, nickname, firebase_uid) VALUES ($1,$2,$3)", ["new", "new", "uid-move"]),
      /unique|duplicate/i,
      "옛 행이 UID를 쥐고 있으면 새 행 저장은 실패한다"
    );

    await db.query("UPDATE players SET firebase_uid = NULL WHERE id = $1 AND firebase_uid = $2", ["old", "uid-move"]);
    await db.query("INSERT INTO players (id, nickname, firebase_uid) VALUES ($1,$2,$3)", ["new", "new", "uid-move"]);
    const moved = await db.query("SELECT id, firebase_uid FROM players WHERE id = $1", ["new"]);
    assert.equal(moved.rows[0].firebase_uid, "uid-move");
  } finally {
    await db.close();
  }
});

test("economy ledger rejects a duplicate idempotency key", async () => {
  const db = new PGlite();
  try {
    await db.exec(ledgerDdl);
    const insert = "INSERT INTO economy_ledger (idem_key, account_id, delta, reason, ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idem_key) DO NOTHING RETURNING id";
    const first = await db.query(insert, ["attendance:pg-tester:2026-11-18", "pg-tester", 100, "attendance", "2026-11-18"]);
    const second = await db.query(insert, ["attendance:pg-tester:2026-11-18", "pg-tester", 100, "attendance", "2026-11-18"]);
    assert.equal(first.rows.length, 1);
    assert.equal(second.rows.length, 0, "같은 멱등 키는 두 번 기록되지 않는다");
  } finally {
    await db.close();
  }
});
