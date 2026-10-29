"use strict";

/* =========================================================
   다중 인스턴스 — 단일 게임 코어 + 릴레이
   ---------------------------------------------------------
   · game 역할: 방·턴 타이머·대기열·접속자 상태를 가진 유일한 코어.
   · web 역할: 정적 파일을 직접 서빙하고 /socket.io 와 상태성 API를
     게임 코어로 프록시한다. 게임 상태를 복제하지 않으므로 인스턴스가
     늘어나도 방/매칭/접속 상태가 갈라지지 않는다.
   · PostgreSQL의 cluster_leases 로 게임 코어가 하나만 뜨도록 보호하고,
     cluster_nodes 로 살아있는 인스턴스를 관측한다.
========================================================= */

const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const os = require("os");

const SOCKET_IO_PATH = "/socket.io/";
const RELAY_HEADER = "x-kk-cluster-relay";
const LEASE_NAME = "kk-wordgame-game-core-v1";
const DEFAULT_LEASE_TTL_MS = 30000;
const DEFAULT_LEASE_WAIT_MS = 35000;
const DEFAULT_TAKEOVER_GRACE_MS = 20000;
const NODE_STALE_MS = 120000;

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeServiceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol + "//" + url.host + trimTrailingSlash(url.pathname);
  } catch (e) {
    return "";
  }
}

function toTimeMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/* 같은 서비스(Render)의 새 배포만 lease를 인계한다.
   - 같은 서비스여야 한다(Render 서비스 ID 우선, 없으면 공개 URL).
   - 커밋이 다르면 새 배포이므로 즉시 인계한다.
   - 커밋을 비교할 수 없을 때(같은 커밋 재배포, 커밋 환경변수 없음)는
     기존 소유자가 충분히 오래 전에 기동했을 때만 인계한다. 같은 시점에
     함께 뜬 스케일아웃 인스턴스끼리는 인계하지 않아 서로 죽이는 순환을 막는다. */
function canTakeOverLease(opts = {}) {
  const owner = String(opts.owner || "").trim();
  const instanceId = String(opts.instanceId || "").trim();
  if (!owner || !instanceId || owner === instanceId) return false;
  const publicUrl = normalizeServiceUrl(opts.publicUrl);
  const ownerUrl = normalizeServiceUrl(opts.ownerUrl);
  const serviceId = String(opts.serviceId || "").trim();
  const ownerServiceId = String(opts.ownerServiceId || "").trim();
  const sameService = serviceId && ownerServiceId
    ? serviceId === ownerServiceId
    : !!publicUrl && !!ownerUrl && publicUrl === ownerUrl;
  if (!sameService) return false;

  const commit = String(opts.commit || "").trim();
  const ownerCommit = String(opts.ownerCommit || "").trim();
  if (commit && ownerCommit !== commit) return true;

  const startedAt = toTimeMs(opts.startedAt);
  const ownerStartedAt = toTimeMs(opts.ownerStartedAt);
  if (!startedAt || !ownerStartedAt) return false;
  const graceMs = Number.isFinite(Number(opts.graceMs))
    ? Math.max(0, Number(opts.graceMs))
    : DEFAULT_TAKEOVER_GRACE_MS;
  return startedAt - ownerStartedAt >= graceMs;
}

function joinTargetPath(basePath, requestUrl) {
  const base = trimTrailingSlash(basePath);
  const url = String(requestUrl || "/");
  return base + (url.startsWith("/") ? url : `/${url}`);
}

function parseClusterConfig(env = process.env) {
  const roleRaw = String(env.CLUSTER_ROLE || "auto").trim().toLowerCase();
  const gameUrlRaw = String(env.CLUSTER_GAME_URL || "").trim();
  let role;

  if (roleRaw === "game") role = "game";
  else if (roleRaw === "web") role = "web";
  else if (roleRaw === "auto" || !roleRaw) role = gameUrlRaw ? "web" : "game";
  else throw new Error(`CLUSTER_ROLE 값이 올바르지 않습니다: '${roleRaw}' (game|web|auto)`);

  let target = null;
  if (gameUrlRaw) {
    try {
      target = new URL(gameUrlRaw);
    } catch (e) {
      throw new Error("CLUSTER_GAME_URL이 올바른 URL이 아닙니다. 예: https://game.example.com");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("CLUSTER_GAME_URL은 http:// 또는 https:// URL이어야 합니다.");
    }
    if (target.username || target.password) {
      throw new Error("CLUSTER_GAME_URL에 사용자 정보를 넣지 마세요.");
    }
  }

  if (role === "web" && !target) {
    throw new Error("CLUSTER_ROLE=web 에는 CLUSTER_GAME_URL(게임 코어 주소)이 필요합니다.");
  }

  /* Render 인스턴스 ID를 우선 사용한다 — pid/호스트명이 같아도 인스턴스마다 고유하다. */
  const instanceId = String(
    env.CLUSTER_INSTANCE_ID || `${env.RENDER_INSTANCE_ID || os.hostname()}-${process.pid}`
  ).trim();
  const publicUrl = trimTrailingSlash(
    env.CLUSTER_NODE_URL || env.RENDER_EXTERNAL_URL || env.KK_PUBLIC_URL || ""
  );

  return {
    role,
    isGameCore: role === "game",
    target,
    gameUrl: target ? `${target.origin}${trimTrailingSlash(target.pathname)}` : "",
    instanceId: instanceId || `${os.hostname()}-${process.pid}`,
    publicUrl,
    /* Render 서비스 ID — 공개 URL이 바뀌어도 같은 서비스의 새 배포임을 알 수 있다. */
    serviceId: String(env.RENDER_SERVICE_ID || "").trim(),
    /* Render가 주입하는 배포 커밋 — 같은 서비스의 새 배포 판별에만 쓴다. */
    commit: String(env.RENDER_GIT_COMMIT || env.GIT_COMMIT || "").trim().slice(0, 40),
    proxyApi: String(env.CLUSTER_PROXY_API || "1") !== "0",
    leaseTtlMs: Math.max(5000, Number(env.CLUSTER_LEASE_TTL_MS) || DEFAULT_LEASE_TTL_MS),
    leaseWaitMs: Math.max(0, Number(env.CLUSTER_LEASE_WAIT_MS) || DEFAULT_LEASE_WAIT_MS),
    /* 이 인스턴스가 시작한 시각 — 같은 커밋 재배포 판별에 쓴다. */
    bootedAt: Date.now(),
    takeoverGraceMs: Number.isFinite(Number(env.CLUSTER_TAKEOVER_GRACE_MS))
      ? Math.max(0, Number(env.CLUSTER_TAKEOVER_GRACE_MS))
      : DEFAULT_TAKEOVER_GRACE_MS,
    strictLease: String(env.CLUSTER_REQUIRE_LEASE ?? "1") !== "0"
  };
}

function isSocketIoPath(url) {
  const value = String(url || "");
  return value === "/socket.io" || value.startsWith(SOCKET_IO_PATH);
}

function isApiPath(url) {
  const value = String(url || "");
  return value === "/api" || value.startsWith("/api/");
}

function isLocalApiPath(url) {
  const value = String(url || "");
  return value === "/api/health" || value === "/api/cluster" || value.startsWith("/api/cluster/");
}

function shouldProxyPath(url, config) {
  if (isSocketIoPath(url)) return true;
  return !!config.proxyApi && isApiPath(url) && !isLocalApiPath(url);
}

function normalizeHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).host.toLowerCase();
  } catch (e) {
    return raw.toLowerCase();
  }
}

function sameOriginAsTarget(req, target) {
  if (!target) return false;
  return normalizeHost(req.headers?.host) === normalizeHost(target.host);
}

function forwardedFor(req) {
  const existing = String(req.headers?.["x-forwarded-for"] || "").trim();
  const remote = String(req.socket?.remoteAddress || req.connection?.remoteAddress || "").trim();
  if (existing && remote) return `${existing}, ${remote}`;
  return existing || remote;
}

function proxyHeaders(req, target, instanceId) {
  const headers = { ...(req.headers || {}) };
  headers.host = target.host;
  const xf = forwardedFor(req);
  if (xf) headers["x-forwarded-for"] = xf;
  headers["x-forwarded-proto"] = String(req.headers?.["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http"));
  headers["x-forwarded-host"] = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "");
  headers[RELAY_HEADER] = instanceId;
  delete headers["proxy-connection"];
  return headers;
}

function writePlainResponse(res, status, message) {
  if (res.headersSent) {
    try { res.destroy(); } catch (e) { /* 무시 */ }
    return;
  }
  const body = Buffer.from(String(message || ""), "utf8");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store"
  });
  res.end(body);
}

function rejectUpgrade(socket, status, message) {
  const body = Buffer.from(String(message || ""), "utf8");
  try {
    socket.write(
      `HTTP/1.1 ${status} ${status === 508 ? "Loop Detected" : "Bad Gateway"}\r\n` +
      "connection: close\r\n" +
      "content-type: text/plain; charset=utf-8\r\n" +
      `content-length: ${body.length}\r\n\r\n`
    );
    socket.end(body);
  } catch (e) {
    try { socket.destroy(); } catch (e2) { /* 무시 */ }
  }
}

function upgradeRequestHead(req, target, targetPath, instanceId) {
  const headers = proxyHeaders(req, target, instanceId);
  const lines = [`${req.method || "GET"} ${targetPath} HTTP/1.1`];
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) lines.push(`${key}: ${item}`);
  }
  return lines.join("\r\n") + "\r\n\r\n";
}

function createClusterProxy(config, options = {}) {
  const log = options.log || console;
  const target = config?.target || null;
  const isWeb = config?.role === "web";
  const instanceId = config?.instanceId || "unknown";
  const stats = { httpProxied: 0, upgradesProxied: 0, proxyErrors: 0, loopsRejected: 0 };

  function refuseLoop(res) {
    stats.loopsRejected++;
    writePlainResponse(res, 508, "클러스터 프록시 순환 설정입니다. CLUSTER_GAME_URL이 이 인스턴스 자신을 가리키지 않는지 확인하세요.");
  }

  function middleware(req, res, next) {
    if (!isWeb || !shouldProxyPath(req.url, config)) return next();
    if (!target) return writePlainResponse(res, 503, "게임 코어 주소가 설정되지 않았습니다.");
    if (req.headers?.[RELAY_HEADER] || sameOriginAsTarget(req, target)) return refuseLoop(res);

    let targetPath;
    try {
      targetPath = joinTargetPath(target.pathname, req.url || "/");
    } catch (e) {
      return writePlainResponse(res, 400, "잘못된 요청 경로입니다.");
    }

    const isHttps = target.protocol === "https:";
    const mod = isHttps ? https : http;
    const headers = proxyHeaders(req, target, instanceId);
    let upstream;
    try {
      upstream = mod.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        method: req.method,
        path: targetPath,
        headers
      }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage || "", upstreamRes.headers);
        upstreamRes.pipe(res);
        upstreamRes.on("error", () => {
          try { res.destroy(); } catch (e) { /* 무시 */ }
        });
      });
    } catch (e) {
      stats.proxyErrors++;
      return writePlainResponse(res, 502, "게임 코어에 연결할 수 없습니다.");
    }

    stats.httpProxied++;
    upstream.on("error", (err) => {
      stats.proxyErrors++;
      log.warn?.("[CLUSTER] HTTP 프록시 오류:", err.message);
      writePlainResponse(res, 502, "게임 코어에 연결할 수 없습니다.");
    });
    req.on("aborted", () => { try { upstream.destroy(); } catch (e) { /* 무시 */ } });
    res.on("close", () => { if (!res.writableEnded) { try { upstream.destroy(); } catch (e) { /* 무시 */ } } });
    req.pipe(upstream);
  }

  function upgrade(req, clientSocket, head) {
    if (!isWeb || !isSocketIoPath(req.url)) return;
    if (!target) {
      rejectUpgrade(clientSocket, 502, "게임 코어 주소가 설정되지 않았습니다.");
      return;
    }
    if (req.headers?.[RELAY_HEADER] || sameOriginAsTarget(req, target)) {
      stats.loopsRejected++;
      rejectUpgrade(clientSocket, 508, "클러스터 프록시 순환 설정입니다.");
      return;
    }

    const targetPath = joinTargetPath(target.pathname, req.url || "/");
    const requestHead = upgradeRequestHead(req, target, targetPath, instanceId);
    const isHttps = target.protocol === "https:";
    const port = Number(target.port || (isHttps ? 443 : 80));
    let connected = false;
    let upstream;

    const onConnect = () => {
      connected = true;
      stats.upgradesProxied++;
      try {
        upstream.setNoDelay(true);
        clientSocket.setNoDelay(true);
        upstream.write(requestHead);
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      } catch (e) {
        stats.proxyErrors++;
        try { upstream.destroy(); } catch (e2) { /* 무시 */ }
        rejectUpgrade(clientSocket, 502, "게임 코어 WebSocket 연결에 실패했습니다.");
      }
    };

    try {
      if (isHttps) {
        upstream = tls.connect({
          host: target.hostname,
          port,
          servername: target.hostname,
          ALPNProtocols: ["http/1.1"]
        }, onConnect);
      } else {
        upstream = net.connect({ host: target.hostname, port }, onConnect);
      }
    } catch (e) {
      stats.proxyErrors++;
      rejectUpgrade(clientSocket, 502, "게임 코어 WebSocket 연결에 실패했습니다.");
      return;
    }

    upstream.on("error", (err) => {
      stats.proxyErrors++;
      log.warn?.("[CLUSTER] WebSocket 프록시 오류:", err.message);
      if (!connected) rejectUpgrade(clientSocket, 502, "게임 코어 WebSocket 연결에 실패했습니다.");
      else {
        try { clientSocket.destroy(); } catch (e) { /* 무시 */ }
      }
    });
    upstream.on("close", () => { try { clientSocket.destroy(); } catch (e) { /* 무시 */ } });
    clientSocket.on("error", () => { try { upstream.destroy(); } catch (e) { /* 무시 */ } });
    clientSocket.on("close", () => { try { upstream.destroy(); } catch (e) { /* 무시 */ } });
  }

  return { middleware, upgrade, stats, target, isWeb };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createCluster(options = {}) {
  const env = options.env || process.env;
  const config = parseClusterConfig(env);
  const log = options.log || console;
  const proxy = createClusterProxy(config, { log });
  const state = {
    started: false,
    db: false,
    lease: config.isGameCore ? "pending" : "web",
    leaseOwner: null,
    leaseExpiresAt: 0,
    startedAt: new Date().toISOString(),
    heartbeatTimer: null,
    heartbeatBusy: false,
    lastHeartbeatAt: 0,
    lastError: null,
    leaseLost: false
  };

  async function ensureSchema(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cluster_leases (
        name TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cluster_nodes (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        url TEXT DEFAULT '',
        game_url TEXT DEFAULT '',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE cluster_nodes ADD COLUMN IF NOT EXISTS commit TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE cluster_nodes ADD COLUMN IF NOT EXISTS service TEXT DEFAULT ''`);
  }

  async function registerNode(pool) {
    await pool.query(
      `INSERT INTO cluster_nodes (id, role, url, game_url, commit, service, started_at, heartbeat_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         role = EXCLUDED.role,
         url = EXCLUDED.url,
         game_url = EXCLUDED.game_url,
         commit = EXCLUDED.commit,
         service = EXCLUDED.service,
         heartbeat_at = NOW()`,
      [config.instanceId, config.role, config.publicUrl, config.gameUrl, config.commit, config.serviceId]
    );
  }

  async function tryAcquireLease(pool) {
    const r = await pool.query(
      `INSERT INTO cluster_leases (name, owner, expires_at, updated_at)
       VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 millisecond'), NOW())
       ON CONFLICT (name) DO UPDATE SET
         owner = EXCLUDED.owner,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()
       WHERE cluster_leases.owner = EXCLUDED.owner
          OR cluster_leases.expires_at < NOW()
       RETURNING owner`,
      [LEASE_NAME, config.instanceId, config.leaseTtlMs]
    );
    return r.rows.length > 0 && r.rows[0].owner === config.instanceId;
  }

  /* 인계가 거부된 이유를 소유자가 바뀔 때 한 번만 남긴다. */
  let lastBlockedKey = "";
  function logLeaseBlocked(row) {
    const owner = String(row?.owner || "");
    if (!owner || owner === config.instanceId) return;
    const key = `${owner}|${row.commit || ""}|${row.url || ""}`;
    if (key === lastBlockedKey) return;
    lastBlockedKey = key;
    const ageMs = toTimeMs(row.started_at) ? Date.now() - toTimeMs(row.started_at) : null;
    log.warn?.(
      `[CLUSTER] 게임 코어 lease 인계 불가 — owner=${owner} commit=${row.commit || "-"} url=${row.url || "-"}` +
      `${ageMs === null ? "" : ` (owner 기동 ${Math.round(ageMs / 1000)}초 전)`}, ` +
      `이 인스턴스 commit=${config.commit || "-"} url=${config.publicUrl || "-"} 기동 ${Math.round((Date.now() - config.bootedAt) / 1000)}초 전`
    );
  }

  function markLeaseAcquired() {
    state.lease = "acquired";
    state.leaseOwner = config.instanceId;
    state.leaseExpiresAt = Date.now() + config.leaseTtlMs;
  }

  /* 기존 코어가 같은 서비스의 이전 배포라면 lease를 넘겨받는다.
     이전 인스턴스는 다음 heartbeat에서 lease 상실을 감지하고 스스로 종료한다. */
  async function tryTakeOverLease(pool) {
    const r = await pool.query(
      `SELECT l.owner, n.url, n.commit, n.started_at, n.service
       FROM cluster_leases l
       LEFT JOIN cluster_nodes n ON n.id = l.owner
       WHERE l.name = $1`,
      [LEASE_NAME]
    );
    if (!r.rows.length) return false;
    const row = r.rows[0];
    if (!canTakeOverLease({
      owner: row.owner,
      instanceId: config.instanceId,
      ownerUrl: row.url,
      ownerCommit: row.commit,
      ownerStartedAt: row.started_at,
      ownerServiceId: row.service,
      serviceId: config.serviceId,
      startedAt: config.bootedAt,
      graceMs: config.takeoverGraceMs,
      commit: config.commit,
      publicUrl: config.publicUrl
    })) {
      state.leaseOwner = row.owner || null;
      logLeaseBlocked(row);
      return false;
    }
    const upd = await pool.query(
      `UPDATE cluster_leases
       SET owner = $2, expires_at = NOW() + ($3::int * INTERVAL '1 millisecond'), updated_at = NOW()
       WHERE name = $1 AND owner = $4
       RETURNING owner`,
      [LEASE_NAME, config.instanceId, config.leaseTtlMs, row.owner]
    );
    if (upd.rows.length && upd.rows[0].owner === config.instanceId) {
      log.log?.("[CLUSTER] 배포 lease 인계: " + row.owner + " -> " + config.instanceId);
      return true;
    }
    return false;
  }

  async function acquireLease(pool) {
    const deadline = Date.now() + config.leaseWaitMs;
    for (;;) {
      try {
        if (await tryTakeOverLease(pool)) {
          markLeaseAcquired();
          return true;
        }
      } catch (err) {
        log.warn?.("[CLUSTER] lease 인계 확인 실패:", err.message);
      }
      if (await tryAcquireLease(pool)) {
        markLeaseAcquired();
        return true;
      }
      if (Date.now() >= deadline) return false;
      await sleep(1000);
    }
  }

  function markLeaseLost(reason) {
    if (state.leaseLost) return;
    state.leaseLost = true;
    state.lease = "lost";
    state.lastError = reason;
    log.error?.("[CLUSTER] 게임 코어 lease 상실 — 중복 코어 방지를 위해 종료합니다.");
    options.onLeaseLost?.();
  }

  async function renewLease(pool) {
    const r = await pool.query(
      `UPDATE cluster_leases
       SET expires_at = NOW() + ($3::int * INTERVAL '1 millisecond'), updated_at = NOW()
       WHERE name = $1 AND owner = $2
       RETURNING owner`,
      [LEASE_NAME, config.instanceId, config.leaseTtlMs]
    );
    if (!r.rows.length) {
      markLeaseLost("게임 코어 lease를 잃었습니다.");
      return false;
    }
    state.leaseExpiresAt = Date.now() + config.leaseTtlMs;
    return true;
  }

  function startHeartbeat(pool) {
    if (state.heartbeatTimer) return;
    const interval = Math.max(1000, Math.floor(config.leaseTtlMs / 3));
    state.heartbeatTimer = setInterval(async () => {
      if (state.heartbeatBusy) return;
      state.heartbeatBusy = true;
      try {
        if (config.isGameCore) {
          const ok = await renewLease(pool);
          if (!ok) return;
        }
        await registerNode(pool);
        state.lastHeartbeatAt = Date.now();
      } catch (err) {
        state.lastError = err.message;
        log.warn?.("[CLUSTER] heartbeat 실패:", err.message);
        /* DB 장애로 lease 갱신이 TTL을 넘기면 다른 코어가 뜰 수 있으므로
           이 코어는 스스로 내려간다. */
        if (config.isGameCore && Date.now() > state.leaseExpiresAt) {
          markLeaseLost(`lease 갱신 실패: ${err.message}`);
        }
      } finally {
        state.heartbeatBusy = false;
      }
    }, interval);
    state.heartbeatTimer.unref?.();
  }

  async function start(pool) {
    state.started = true;
    state.db = !!pool;
    if (!pool) {
      state.lease = "no-db";
      log.warn?.("[CLUSTER] DATABASE_URL 없음 — 단일 인스턴스로 동작합니다. 다중 인스턴스에서는 공유 DB와 게임 코어 URL이 필요합니다.");
      return { ok: true, mode: "no-db", role: config.role };
    }

    try {
      await ensureSchema(pool);
      await registerNode(pool);
    } catch (err) {
      state.lease = "unavailable";
      state.lastError = err.message;
      log.warn?.("[CLUSTER] 공유 상태 테이블 준비 실패:", err.message);
      if (config.isGameCore && config.strictLease) return { ok: false, reason: err.message };
      return { ok: true, mode: "unavailable", role: config.role };
    }

    if (config.isGameCore) {
      const acquired = await acquireLease(pool);
      if (!acquired) {
        state.lease = "busy";
        state.lastError = state.leaseOwner
          ? `다른 게임 코어가 lease를 보유 중입니다. (owner=${state.leaseOwner})`
          : "다른 게임 코어가 lease를 보유 중입니다.";
        log.error?.(
          "[CLUSTER] 게임 코어 lease를 얻지 못했습니다. 같은 서비스에 게임 코어를 여러 개 띄우는 구성이면 " +
          "추가 인스턴스를 CLUSTER_ROLE=web + CLUSTER_GAME_URL로 띄우세요."
        );
        return { ok: false, reason: state.lastError };
      }
      startHeartbeat(pool);
      log.log?.(`[CLUSTER] 게임 코어 lease 획득: ${config.instanceId}`);
    } else {
      state.lease = "relay";
      startHeartbeat(pool);
    }
    return { ok: true, mode: state.lease, role: config.role };
  }

  async function stop(pool) {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (!pool) return;
    try {
      if (config.isGameCore && state.lease === "acquired") {
        await pool.query(
          "UPDATE cluster_leases SET expires_at = NOW(), updated_at = NOW() WHERE name = $1 AND owner = $2",
          [LEASE_NAME, config.instanceId]
        );
      }
      await pool.query("DELETE FROM cluster_nodes WHERE id = $1", [config.instanceId]);
    } catch (err) {
      log.warn?.("[CLUSTER] 종료 정리 실패:", err.message);
    }
  }

  async function listNodes(pool) {
    if (!pool) return [];
    try {
      const r = await pool.query(
        `SELECT id, role, url, game_url, commit, started_at, heartbeat_at
         FROM cluster_nodes
         WHERE heartbeat_at > NOW() - ($1::int * INTERVAL '1 millisecond')
         ORDER BY heartbeat_at DESC`,
        [NODE_STALE_MS]
      );
      return r.rows.map(row => ({
        id: row.id,
        role: row.role,
        url: row.url || "",
        gameUrl: row.game_url || "",
        commit: row.commit || "",
        startedAt: row.started_at,
        heartbeatAt: row.heartbeat_at
      }));
    } catch (err) {
      log.warn?.("[CLUSTER] 노드 목록 조회 실패:", err.message);
      return [];
    }
  }

  function health() {
    return {
      role: config.role,
      instanceId: config.instanceId,
      isGameCore: config.isGameCore,
      gameUrl: config.gameUrl || null,
      proxyApi: config.proxyApi,
      lease: state.lease,
      leaseOwner: state.leaseOwner,
      leaseLost: state.leaseLost,
      db: state.db,
      startedAt: state.startedAt,
      lastHeartbeatAt: state.lastHeartbeatAt || null,
      lastError: state.lastError,
      proxy: { ...proxy.stats }
    };
  }

  return {
    config,
    role: config.role,
    isGameCore: config.isGameCore,
    instanceId: config.instanceId,
    gameUrl: config.gameUrl,
    middleware: proxy.middleware,
    upgrade: proxy.upgrade,
    start,
    stop,
    listNodes,
    health,
    state
  };
}

module.exports = {
  canTakeOverLease,
  createCluster,
  toTimeMs,
  parseClusterConfig,
  joinTargetPath,
  isSocketIoPath,
  isApiPath,
  isLocalApiPath,
  shouldProxyPath,
  normalizeHost,
  sameOriginAsTarget,
  LEASE_NAME,
  RELAY_HEADER
};
