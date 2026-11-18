"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseDatabaseUrl,
  classifyError,
  buildVerdict,
  formatReport
} = require("../tools/diagnose-db.js");

test("database diagnostic never exposes credentials in its target", () => {
  const parsed = parseDatabaseUrl("postgres://wordgame:supersecret@dpg-abc-a:5432/wordgame?sslmode=require");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.target, "dpg-abc-a:5432/wordgame?sslmode=require");
  assert.equal(parsed.target.includes("supersecret"), false);
  assert.equal(parsed.target.includes("wordgame:supersecret"), false);
  assert.equal(parsed.hasPassword, true);
  assert.equal(parseDatabaseUrl("not-a-url").ok, false);
  assert.equal(parseDatabaseUrl("").ok, false);
});

test("database diagnostic classifies Render and Postgres connection failures", () => {
  assert.equal(classifyError({ code: "ENOTFOUND" }), "host-not-found");
  assert.equal(classifyError({ code: "ECONNREFUSED" }), "refused");
  assert.equal(classifyError({ code: "28P01" }), "auth");
  assert.equal(classifyError({ code: "3D000" }), "database-missing");
  assert.equal(classifyError({ code: "57P03" }), "starting");
  assert.equal(classifyError({ message: "SSL required" }), "ssl");
});

test("database diagnostic recommends keeping a database that has data", () => {
  const keep = buildVerdict({ connected: true, tables: { players: true, kv: true, ledger: true }, data: { players: 3, ledger: 5, kv: 2 } });
  assert.equal(keep.code, "keep-data");
  const empty = buildVerdict({ connected: true, tables: { players: true, kv: true, ledger: true }, data: { players: 0, ledger: 0, kv: 0 } });
  assert.equal(empty.code, "empty");
  const unknown = buildVerdict({ connected: true, tables: null, data: null });
  assert.equal(unknown.code, "connected-unknown");
  const queryFailed = buildVerdict({ connected: true, dataError: true, tables: { players: true, kv: true, ledger: true }, data: { players: 0, ledger: 0, kv: 0 } });
  assert.equal(queryFailed.code, "connected-unknown");
});

test("database diagnostic explains unreachable hosts and URL mismatches", () => {
  assert.equal(buildVerdict({ connected: false, errorKind: "host-not-found" }).code, "host-unreachable");
  assert.equal(buildVerdict({ connected: false, errorKind: "auth" }).code, "url-mismatch");
  assert.equal(buildVerdict({ connected: false, errorKind: "refused" }).code, "db-unreachable");
});

test("formatted diagnostic output does not leak the password", () => {
  const parsed = parseDatabaseUrl("postgres://wordgame:supersecret@dpg-abc-a:5432/wordgame?sslmode=require");
  const report = {
    target: parsed.target,
    dns: { ok: true, addresses: ["10.0.0.1"] },
    tcp: { ok: true },
    connected: false,
    errorKind: "host-not-found",
    errorCode: "ENOTFOUND",
    errorMessage: "getaddrinfo ENOTFOUND dpg-abc-a",
    verdict: buildVerdict({ connected: false, errorKind: "host-not-found" })
  };
  const text = formatReport(report);
  assert.equal(text.includes("supersecret"), false);
  assert.match(text, /dpg-abc-a:5432\/wordgame/);
  assert.match(text, /DB 호스트를 찾지 못했습니다/);
});
