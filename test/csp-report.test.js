"use strict";

/* CSP 위반 수집기 — 레거시/Reporting API 형식, 중복 집계, 레이트리밋, 상한을 검증한다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCspReportCollector, MAX_ENTRIES, MAX_REPORTS_PER_MINUTE } = require("../server/csp-report.js");

function createCollector(options = {}) {
  const logs = [];
  const collector = createCspReportCollector({
    logger: { warn: (line) => logs.push(line) },
    now: options.now || (() => 1_700_000_000_000)
  });
  return { collector, logs };
}

const legacyReport = (overrides = {}) => ({
  "csp-report": {
    "effective-directive": "script-src",
    "blocked-uri": "https://evil.example/x.js",
    "document-uri": "https://game.example.com/",
    ...overrides
  }
});

test("legacy csp-report payloads are aggregated and logged once", () => {
  const { collector, logs } = createCollector();

  assert.deepEqual(collector.ingest(legacyReport(), "1.1.1.1"), { accepted: 1 });
  collector.ingest(legacyReport(), "1.1.1.1");
  collector.ingest(legacyReport(), "2.2.2.2");

  const snapshot = collector.snapshot();
  assert.equal(snapshot.received, 3);
  assert.equal(snapshot.entries.length, 1, "같은 위반은 한 항목으로 모아야 합니다");
  assert.equal(snapshot.entries[0].count, 3);
  assert.equal(snapshot.entries[0].directive, "script-src");
  assert.equal(snapshot.entries[0].blockedUri, "https://evil.example/x.js");
  assert.equal(logs.length, 1, "로그는 처음 한 번만 남깁니다");
  assert.match(logs[0], /\[CSP\] report-only 위반: script-src/);
});

test("Reporting API arrays are accepted and non-violation entries ignored", () => {
  const { collector } = createCollector();

  const result = collector.ingest([
    { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://cdn.example/a.png", documentURL: "https://game.example.com/" } },
    { type: "deprecation", body: {} }
  ], "1.1.1.1");

  assert.deepEqual(result, { accepted: 1 });
  const [entry] = collector.snapshot().entries;
  assert.equal(entry.directive, "img-src");
  assert.equal(entry.blockedUri, "https://cdn.example/a.png");
  assert.equal(entry.documentUri, "https://game.example.com/");
});

test("malformed payloads are ignored without throwing", () => {
  const { collector } = createCollector();
  for (const body of [undefined, null, "text", 42, {}, []]) {
    assert.deepEqual(collector.ingest(body, "1.1.1.1"), { accepted: 0 });
  }
  assert.equal(collector.snapshot().entries.length, 0);
});

test("one IP cannot flood the logs", () => {
  const { collector } = createCollector();
  for (let i = 0; i < MAX_REPORTS_PER_MINUTE; i += 1) {
    collector.ingest(legacyReport({ "blocked-uri": `https://evil.example/${i}.js` }), "9.9.9.9");
  }
  assert.equal(collector.snapshot().overLimit, 0);

  collector.ingest(legacyReport({ "blocked-uri": "https://evil.example/last.js" }), "9.9.9.9");
  const snapshot = collector.snapshot();
  assert.equal(snapshot.overLimit, 1);
  assert.equal(snapshot.entries.length, MAX_REPORTS_PER_MINUTE, "초과분은 집계하지 않습니다");

  /* 다른 IP는 영향받지 않는다. */
  collector.ingest(legacyReport({ "blocked-uri": "https://other.example/x.js" }), "8.8.8.8");
  assert.equal(collector.snapshot().entries.length, MAX_REPORTS_PER_MINUTE + 1);
});

test("the window resets after a minute", () => {
  let clock = 1_700_000_000_000;
  const { collector } = createCollector({ now: () => clock });

  for (let i = 0; i < MAX_REPORTS_PER_MINUTE + 5; i += 1) {
    collector.ingest(legacyReport({ "blocked-uri": `https://evil.example/${i}.js` }), "9.9.9.9");
  }
  assert.equal(collector.snapshot().overLimit, 5);

  clock += 61_000;
  collector.ingest(legacyReport({ "blocked-uri": "https://evil.example/after.js" }), "9.9.9.9");
  assert.equal(collector.snapshot().overLimit, 5);
});

test("the entry table has a hard cap so memory stays bounded", () => {
  const { collector } = createCollector();
  for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
    collector.ingest(legacyReport({ "blocked-uri": `https://evil.example/${i}.js` }), `10.0.0.${i}`);
  }
  const snapshot = collector.snapshot();
  assert.equal(snapshot.entries.length, MAX_ENTRIES);
  assert.equal(snapshot.dropped, 10);
});
