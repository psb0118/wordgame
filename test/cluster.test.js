"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const {
  createCluster,
  parseClusterConfig,
  joinTargetPath,
  shouldProxyPath,
  isSocketIoPath,
  isApiPath,
  isLocalApiPath,
  canTakeOverLease,
  RELAY_HEADER
} = require("../server/cluster.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method || "GET",
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test("cluster config defaults to a single game core and requires a URL for web relays", () => {
  const single = parseClusterConfig({});
  assert.equal(single.role, "game");
  assert.equal(single.isGameCore, true);
  assert.equal(single.target, null);

  assert.throws(
    () => parseClusterConfig({ CLUSTER_ROLE: "web" }),
    /CLUSTER_GAME_URL/
  );

  const web = parseClusterConfig({
    CLUSTER_ROLE: "web",
    CLUSTER_GAME_URL: "https://game.example.com/base/",
    CLUSTER_INSTANCE_ID: "web-1"
  });
  assert.equal(web.role, "web");
  assert.equal(web.isGameCore, false);
  assert.equal(web.instanceId, "web-1");
  assert.equal(web.gameUrl, "https://game.example.com/base");
  assert.equal(web.target.host, "game.example.com");

  assert.throws(
    () => parseClusterConfig({ CLUSTER_GAME_URL: "file:///tmp/game" }),
    /http/
  );
});

test("relay only proxies socket.io and stateful API paths", () => {
  const config = parseClusterConfig({ CLUSTER_ROLE: "web", CLUSTER_GAME_URL: "http://127.0.0.1:9" });
  assert.equal(isSocketIoPath("/socket.io/?EIO=4&transport=polling"), true);
  assert.equal(isApiPath("/api/leaderboard"), true);
  assert.equal(isLocalApiPath("/api/health"), true);
  assert.equal(shouldProxyPath("/socket.io/", config), true);
  assert.equal(shouldProxyPath("/api/leaderboard", config), true);
  assert.equal(shouldProxyPath("/api/health", config), false);
  assert.equal(shouldProxyPath("/api/cluster/status", config), false);
  assert.equal(shouldProxyPath("/script.js", config), false);

  assert.equal(joinTargetPath("", "/socket.io/?x=1"), "/socket.io/?x=1");
  assert.equal(joinTargetPath("/base/", "/api/health"), "/base/api/health");
});

test("web relay forwards polling/API requests and keeps health local", async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        url: req.url,
        method: req.method,
        body: Buffer.concat(chunks).toString("utf8"),
        relay: req.headers[RELAY_HEADER],
        forwardedFor: req.headers["x-forwarded-for"]
      });
      res.writeHead(200, { "content-type": "application/json", "x-upstream": "1" });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  const upstreamPort = await listen(upstream);

  const cluster = createCluster({
    env: {
      CLUSTER_ROLE: "web",
      CLUSTER_GAME_URL: `http://127.0.0.1:${upstreamPort}`,
      CLUSTER_INSTANCE_ID: "web-test"
    },
    log: { warn() {}, error() {}, log() {} }
  });

  const local = http.createServer((req, res) => {
    cluster.middleware(req, res, () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ local: true, url: req.url }));
    });
  });
  const localPort = await listen(local);
  t.after(() => {
    local.close();
    upstream.close();
  });

  const health = await request(localPort, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).local, true);

  const leaderboard = await request(localPort, "/api/leaderboard?mode=multi&limit=3");
  assert.equal(leaderboard.status, 200);
  assert.equal(leaderboard.headers["x-upstream"], "1");
  assert.equal(JSON.parse(leaderboard.body).url, "/api/leaderboard?mode=multi&limit=3");
  assert.equal(seen.at(-1).relay, "web-test");
  assert.match(seen.at(-1).forwardedFor, /127\.0\.0\.1/);

  const polling = await request(localPort, "/socket.io/?EIO=4&transport=polling");
  assert.equal(polling.status, 200);
  assert.equal(JSON.parse(polling.body).url, "/socket.io/?EIO=4&transport=polling");

  const postedBody = "{\"word\":\"나무\"}";
  const posted = await request(localPort, `/api/dictionary/definition?word=${encodeURIComponent("나무")}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(postedBody))
    },
    body: postedBody
  });
  assert.equal(posted.status, 200);
  assert.equal(seen.at(-1).body, postedBody);

  const loop = await request(localPort, "/api/leaderboard", {
    headers: { [RELAY_HEADER]: "already-relayed" }
  });
  assert.equal(loop.status, 508);
});

test("web relay rejects proxying to its own origin", async (t) => {
  let cluster;
  const local = http.createServer((req, res) => {
    cluster.middleware(req, res, () => {
      res.writeHead(200);
      res.end("local");
    });
  });
  const port = await listen(local);
  t.after(() => local.close());

  cluster = createCluster({
    env: {
      CLUSTER_ROLE: "web",
      CLUSTER_GAME_URL: `http://127.0.0.1:${port}`,
      CLUSTER_INSTANCE_ID: "web-loop"
    },
    log: { warn() {}, error() {}, log() {} }
  });

  const loop = await request(port, "/api/leaderboard");
  assert.equal(loop.status, 508);
});


test("deploy takeover requires the same service and a different commit", () => {
  const base = { instanceId: "new", publicUrl: "https://svc.example.com", commit: "newsha" };
  assert.equal(canTakeOverLease({ ...base, owner: "old", ownerUrl: "https://svc.example.com/", ownerCommit: "oldsha" }), true);
  assert.equal(canTakeOverLease({ ...base, owner: "old", ownerUrl: "https://svc.example.com", ownerCommit: "" }), true);
  assert.equal(canTakeOverLease({ ...base, owner: "old", ownerUrl: "https://svc.example.com", ownerCommit: "newsha" }), false);
  assert.equal(canTakeOverLease({ ...base, owner: "old", ownerUrl: "https://other.example.com", ownerCommit: "oldsha" }), false);
  assert.equal(canTakeOverLease({ ...base, commit: "", owner: "old", ownerUrl: "https://svc.example.com", ownerCommit: "oldsha" }), false);
  assert.equal(canTakeOverLease({ ...base, owner: "", ownerUrl: "https://svc.example.com", ownerCommit: "oldsha" }), false);
});

test("a same-service deploy takes over the game-core lease", async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push(text);
      if (text.includes("SELECT l.owner")) {
        return { rows: [{ owner: "old", url: "https://svc.example.com", commit: "oldsha" }], rowCount: 1 };
      }
      if (text.includes("UPDATE cluster_leases") && text.includes("owner = $4")) {
        return { rows: [{ owner: "new" }], rowCount: 1 };
      }
      if (text.includes("UPDATE cluster_leases")) {
        return { rows: [{ owner: "new" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
  const cluster = createCluster({
    env: {
      CLUSTER_ROLE: "game",
      CLUSTER_INSTANCE_ID: "new",
      CLUSTER_NODE_URL: "https://svc.example.com",
      RENDER_GIT_COMMIT: "newsha",
      CLUSTER_LEASE_WAIT_MS: "0"
    },
    log: { log() {}, warn() {}, error() {} }
  });
  const started = await cluster.start(pool);
  assert.equal(started.ok, true);
  assert.equal(cluster.state.lease, "acquired");
  assert.ok(queries.some(sql => sql.includes("owner = $4")), "takeover update was issued");
  await cluster.stop(pool);
});
