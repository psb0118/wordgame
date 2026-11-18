/* PostgreSQL 연결 진단 (읽기 전용)
   사용법:
     read -rsp "Database URL: " DATABASE_URL; echo; export DATABASE_URL
     npm run diagnose:db
     npm run diagnose:db -- --json
     npm run diagnose:db -- --timeout-ms=8000

   - SELECT만 실행한다. 테이블/행 생성·수정·삭제 없음.
   - URL의 사용자명·비밀번호는 출력하지 않고 host:port/database만 표시한다.
   - Render 내부 URL은 같은 리전의 Render 서비스에서만 해석된다.
     로컬에서 Internal URL을 진단하면 DNS 실패가 정상일 수 있다.
   종료 코드: 0 연결됨, 2 입력/URL 오류, 3 연결 실패.
*/
"use strict";

const dns = require("node:dns").promises;
const net = require("node:net");
const { Client } = require("pg");

const DEFAULT_TIMEOUT_MS = 8000;

function parseDatabaseUrl(connectionString) {
  const raw = String(connectionString || "").trim();
  if (!raw) return { ok: false, reason: "DATABASE_URL이 없습니다." };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "DATABASE_URL이 postgres:// URL 형식이 아닙니다." };
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { ok: false, reason: "postgres:// 또는 postgresql:// URL만 지원합니다." };
  }
  const host = url.hostname;
  const port = Number(url.port) || 5432;
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "(default)";
  const sslmode = url.searchParams.get("sslmode") || url.searchParams.get("ssl") || "";
  if (!host) return { ok: false, reason: "URL에 호스트가 없습니다." };
  return {
    ok: true,
    host,
    port,
    database,
    sslmode,
    target: `${host}:${port}/${database}${sslmode ? `?sslmode=${sslmode}` : ""}`,
    hasPassword: !!url.password
  };
}

function classifyError(error) {
  const code = String((error && error.code) || "");
  const message = String((error && error.message) || "");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host-not-found";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (code === "28P01" || code === "28000") return "auth";
  if (code === "3D000") return "database-missing";
  if (code === "57P03") return "starting";
  if (/ssl|certificate|tls/i.test(message)) return "ssl";
  return "unknown";
}

function buildVerdict(report) {
  if (report && report.connected) {
    if (report.dataError || !report.data || !report.tables) {
      return {
        code: "connected-unknown",
        headline: "접속은 됐지만 테이블/데이터를 읽지 못했습니다",
        detail: "연결 권한은 있지만 조회 중 오류가 발생했습니다.",
        next: "오류 메시지를 확인하고, 필요하면 DB 관리자 권한으로 다시 실행하세요."
      };
    }
    const data = report.data || {};
    const players = Number(data.players) || 0;
    const ledger = Number(data.ledger) || 0;
    const kv = Number(data.kv) || 0;
    if (players > 0 || ledger > 0) {
      return {
        code: "keep-data",
        headline: "기존 데이터가 있습니다 — 기존 DB 유지/업그레이드 권장",
        detail: `players ${players}명, economy_ledger ${ledger}건, kv_store ${kv}건`,
        next: "만료 상태라면 삭제하지 말고 유예 기간 안에 유료 플랜으로 업그레이드하세요. 이미 Available이라면 DATABASE_URL만 올바르게 유지하면 됩니다."
      };
    }
    if (kv > 0) {
      return {
        code: "keep-config",
        headline: "플레이어 행은 없지만 설정/길드 등 데이터가 있습니다 — 유지 검토",
        detail: `kv_store ${kv}건`,
        next: "이 설정이 필요 없다면 새 DB로 가도 되지만, 필요하다면 기존 DB를 유지하세요."
      };
    }
    return {
      code: "empty",
      headline: "접속되지만 저장된 데이터가 없습니다 — 새 DB로 가도 손실 없음",
      detail: "players, economy_ledger, kv_store 모두 0건",
      next: "새 Blueprint DB를 사용해도 됩니다."
    };
  }

  const kind = report && report.errorKind;
  if (kind === "host-not-found") {
    return {
      code: "host-unreachable",
      headline: "DB 호스트를 찾지 못했습니다 — 만료·삭제 또는 리전 불일치",
      detail: "Internal URL은 같은 Render 리전에서만 해석됩니다.",
      next: "같은 DB의 External Database URL로 한 번 더 진단하세요. External도 실패하고 상태가 Expired라면 유예 기간 내 업그레이드 여부를 결정해야 합니다."
    };
  }
  if (kind === "auth" || kind === "database-missing") {
    return {
      code: "url-mismatch",
      headline: "DB는 응답했지만 URL의 계정/DB 이름이 맞지 않습니다",
      detail: "호스트 문제가 아니라 연결 문자열 문제입니다.",
      next: "Render DB의 Connect 탭에서 현재 Internal/External URL을 다시 복사하세요. (비밀번호는 채팅에 붙여넣지 마세요)"
    };
  }
  if (kind === "refused" || kind === "timeout") {
    return {
      code: "db-unreachable",
      headline: "DB가 응답하지 않습니다 — 정지·만료 가능성",
      detail: "TCP 연결이 거부되었거나 시간 초과되었습니다.",
      next: "대시보드에서 상태와 리전을 확인하고 External URL로 재시도하세요."
    };
  }
  if (kind === "starting") {
    return {
      code: "retry",
      headline: "DB가 시작 중입니다 — 잠시 후 재시도",
      detail: "PostgreSQL이 아직 연결을 받을 준비가 되지 않았습니다.",
      next: "1~2분 뒤 같은 명령을 다시 실행하세요."
    };
  }
  if (kind === "ssl") {
    return {
      code: "ssl",
      headline: "TLS/인증서 문제로 연결하지 못했습니다",
      detail: "외부 URL에는 보통 sslmode=require가 필요합니다.",
      next: "External Database URL을 그대로 사용하고, 사설 CA라면 DATABASE_CA_CERT를 설정하세요."
    };
  }
  return {
    code: "unknown",
    headline: "연결 실패 — 오류 코드를 확인하세요",
    detail: "자동으로 원인을 분류하지 못했습니다.",
    next: "Render DB 상태(Expired/Available)와 웹 서비스 리전을 확인하세요."
  };
}

async function checkDns(host) {
  try {
    const rows = await dns.lookup(host, { all: true });
    return { ok: true, addresses: [...new Set(rows.map(r => r.address))].slice(0, 4) };
  } catch (error) {
    return { ok: false, code: error.code || "", message: error.message };
  }
}

function checkTcp(host, port, timeoutMs) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, code: "ETIMEDOUT", message: "TCP 연결 시간 초과" }));
    socket.once("error", error => finish({ ok: false, code: error.code || "", message: error.message }));
  });
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function diagnose({ connectionString, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const parsed = parseDatabaseUrl(connectionString);
  if (!parsed.ok) return { ok: false, stage: "input", reason: parsed.reason };

  const report = {
    generatedAt: new Date().toISOString(),
    target: parsed.target,
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    sslmode: parsed.sslmode,
    connected: false,
    dns: null,
    tcp: null,
    server: null,
    tables: null,
    data: null,
    dataError: false,
    errorKind: null,
    errorCode: null,
    errorMessage: null,
    verdict: null
  };

  report.dns = await checkDns(parsed.host);
  if (report.dns.ok) {
    report.tcp = await checkTcp(parsed.host, parsed.port, timeoutMs);
  }

  let client = null;
  try {
    client = new Client({
      connectionString,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      application_name: "wordgame-db-diagnose"
    });
    await client.connect();
    report.connected = true;

    const info = await client.query(
      "SELECT current_database() AS database, version() AS version, pg_is_in_recovery() AS replica"
    );
    report.server = {
      database: info.rows[0].database,
      version: String(info.rows[0].version || "").split(" ").slice(0, 2).join(" "),
      replica: !!info.rows[0].replica
    };

    const tables = await client.query(`
      SELECT
        to_regclass('public.players') IS NOT NULL AS players,
        to_regclass('public.kv_store') IS NOT NULL AS kv,
        to_regclass('public.economy_ledger') IS NOT NULL AS ledger
    `);
    const has = tables.rows[0];
    report.tables = { players: !!has.players, kv: !!has.kv, ledger: !!has.ledger };
    report.data = { players: 0, kv: 0, ledger: 0, latestPlayerUpdate: null };

    if (report.tables.players) {
      const row = (await client.query(
        "SELECT count(*)::bigint AS count, max(updated_at) AS latest FROM players"
      )).rows[0];
      report.data.players = number(row.count);
      report.data.latestPlayerUpdate = row.latest ? new Date(row.latest).toISOString() : null;
    }
    if (report.tables.kv) {
      report.data.kv = number((await client.query("SELECT count(*)::bigint AS count FROM kv_store")).rows[0].count);
    }
    if (report.tables.ledger) {
      report.data.ledger = number((await client.query("SELECT count(*)::bigint AS count FROM economy_ledger")).rows[0].count);
    }
  } catch (error) {
    if (report.connected) report.dataError = true;
    report.errorKind = classifyError(error);
    report.errorCode = String((error && error.code) || "");
    report.errorMessage = String((error && error.message) || "");
    if (parsed.hasPassword && report.errorMessage) {
      /* 드라이버 오류 메시지에 연결 문자열이 섞여도 자격 증명은 남기지 않는다. */
      try {
        const url = new URL(connectionString);
        const secrets = new Set([url.password]);
        try { secrets.add(decodeURIComponent(url.password)); } catch { /* 인코딩되지 않은 값 */ }
        for (const secret of secrets) {
          if (secret) report.errorMessage = report.errorMessage.split(secret).join("***");
        }
        report.errorMessage = report.errorMessage.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://***");
      } catch { /* URL은 위에서 이미 검증됨 */ }
    }
  } finally {
    if (client) {
      try { await client.end(); } catch { /* 이미 종료됨 */ }
    }
  }

  report.verdict = buildVerdict(report);
  return { ok: report.connected, report };
}

function formatReport(report) {
  const lines = [];
  lines.push(`== PostgreSQL 진단: ${report.target} ==`);
  lines.push(`DNS: ${report.dns ? (report.dns.ok ? `OK (${report.dns.addresses.join(", ")})` : `실패 (${report.dns.code || report.dns.message})`) : "건너뜀"}`);
  if (report.tcp) lines.push(`TCP: ${report.tcp.ok ? "OK" : `실패 (${report.tcp.code || report.tcp.message})`}`);
  if (report.connected) {
    lines.push(`Postgres: OK (${report.server.version}${report.server.replica ? ", replica" : ""})`);
    lines.push(`테이블: players=${report.tables.players ? "있음" : "없음"}, kv_store=${report.tables.kv ? "있음" : "없음"}, economy_ledger=${report.tables.ledger ? "있음" : "없음"}`);
    lines.push(`데이터: players ${report.data.players}명 / economy_ledger ${report.data.ledger}건 / kv_store ${report.data.kv}건`);
    if (report.data.latestPlayerUpdate) lines.push(`최근 플레이어 갱신: ${report.data.latestPlayerUpdate}`);
  } else {
    lines.push(`Postgres: 실패 (${report.errorKind}${report.errorCode ? `, ${report.errorCode}` : ""})`);
    if (report.errorMessage) lines.push(`오류: ${report.errorMessage}`);
  }
  lines.push("");
  lines.push(`판정: ${report.verdict.headline}`);
  lines.push(`근거: ${report.verdict.detail}`);
  lines.push(`다음: ${report.verdict.next}`);
  if (!process.env.RENDER && /^dpg-/.test(report.host)) {
    lines.push("참고: 이 호스트는 Render 내부 주소입니다. 로컬에서 Internal URL DNS 실패는 정상일 수 있으니 External URL로도 진단하세요.");
  }
  return lines.join("\n");
}

async function main() {
  const json = process.argv.includes("--json");
  const timeoutArg = process.argv.find(arg => arg.startsWith("--timeout-ms="));
  const timeoutMs = Math.max(2000, Math.min(60000, Number(timeoutArg && timeoutArg.split("=")[1]) || DEFAULT_TIMEOUT_MS));

  const result = await diagnose({ connectionString: process.env.DATABASE_URL, timeoutMs });
  if (!result.ok && result.stage === "input") {
    console.error(result.reason);
    console.error("사용법: DATABASE_URL='postgres://...' npm run diagnose:db");
    process.exitCode = 2;
    return;
  }

  if (json) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(formatReport(result.report));
  }
  process.exitCode = result.ok ? 0 : 3;
}

if (require.main === module) {
  main().catch(error => {
    console.error("진단 중 오류:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  parseDatabaseUrl,
  classifyError,
  buildVerdict,
  diagnose,
  formatReport
};
