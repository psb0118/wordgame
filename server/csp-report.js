"use strict";

/* CSP Report-Only 위반 수집 — 브라우저가 보내는 리포트를 집계한다.

   같은 위반(지시문 + 차단 대상)은 횟수만 올리고 로그는 처음 한 번만 남긴다.
   로그 폭주를 막기 위해 IP당 분당 요청 수를 제한하고, 항목 수에도 상한을 둔다. */

const MAX_ENTRIES = 200;
const MAX_REPORTS_PER_MINUTE = 60;
const WINDOW_MS = 60 * 1000;
const MAX_BUCKETS = 2000;

function createCspReportCollector(options = {}) {
  const logger = options.logger || console;
  const now = options.now || (() => Date.now());
  const entries = new Map();
  const buckets = new Map();
  const stats = { received: 0, dropped: 0, overLimit: 0 };

  function overRateLimit(ip) {
    const at = now();
    const bucket = buckets.get(ip);
    if (!bucket || at - bucket.start >= WINDOW_MS) {
      if (buckets.size >= MAX_BUCKETS) {
        for (const [key, value] of buckets) {
          if (at - value.start >= WINDOW_MS) buckets.delete(key);
        }
      }
      buckets.set(ip, { start: at, count: 1 });
      return false;
    }
    bucket.count += 1;
    return bucket.count > MAX_REPORTS_PER_MINUTE;
  }

  /* 레거시 {"csp-report": {...}} 와 Reporting API [{type, body}] 를 모두 받는다. */
  function toReports(body) {
    if (Array.isArray(body)) {
      return body
        .filter((item) => item && typeof item === "object" && item.type === "csp-violation")
        .map((item) => item.body || {});
    }
    if (body && typeof body === "object" && body["csp-report"]) return [body["csp-report"]];
    if (body && typeof body === "object") return [body];
    return [];
  }

  function record(report) {
    if (!report || typeof report !== "object") return false;
    const directive = String(
      report["effective-directive"] || report.effectiveDirective ||
      report["violated-directive"] || report.violatedDirective || ""
    ).slice(0, 80);
    const blockedUri = String(report["blocked-uri"] || report.blockedURL || "").slice(0, 300);
    const documentUri = String(report["document-uri"] || report.documentURL || "").slice(0, 300);
    /* 위반 정보가 하나도 없는 페이로드는 버린다. */
    if (!directive && !blockedUri && !documentUri) return false;
    const key = `${directive || "unknown"} ${blockedUri}`;
    const at = now();

    const existing = entries.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastAt = new Date(at).toISOString();
      return true;
    }
    if (entries.size >= MAX_ENTRIES) {
      stats.dropped += 1;
      return false;
    }
    entries.set(key, {
      directive: directive || "unknown",
      blockedUri,
      documentUri,
      count: 1,
      firstAt: new Date(at).toISOString(),
      lastAt: new Date(at).toISOString()
    });
    logger.warn(`[CSP] report-only 위반: ${directive || "unknown"} ← ${blockedUri || "(inline)"} (${documentUri || "문서 미상"})`);
    return true;
  }

  function ingest(body, ip = "unknown") {
    const reports = toReports(body);
    if (reports.length === 0) return { accepted: 0 };
    if (overRateLimit(String(ip))) {
      stats.overLimit += reports.length;
      return { accepted: 0 };
    }
    let accepted = 0;
    for (const report of reports) {
      stats.received += 1;
      if (record(report)) accepted += 1;
    }
    return { accepted };
  }

  function snapshot() {
    return {
      received: stats.received,
      dropped: stats.dropped,
      overLimit: stats.overLimit,
      entries: [...entries.values()].sort((a, b) => b.count - a.count)
    };
  }

  return { ingest, snapshot };
}

module.exports = { createCspReportCollector, MAX_ENTRIES, MAX_REPORTS_PER_MINUTE };
