"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const rankSeason = require("../server/rank-season.js");
const guildWeek = require("../server/guild-week.js");
const push = require("../server/push.js");

/* =========================================================
   시즌 소프트 리셋 · 배치고사
========================================================= */
test("soft reset keeps half the distance from 1000 and clamps at zero", () => {
  assert.equal(rankSeason.softResetRating(1900), 1450);
  assert.equal(rankSeason.softResetRating(1500), 1250);
  assert.equal(rankSeason.softResetRating(1000), 1000);
  assert.equal(rankSeason.softResetRating(600), 800);
  assert.equal(rankSeason.softResetRating(0), 500);
  assert.equal(rankSeason.softResetRating(NaN), 1000);
});

test("season reset is idempotent and reserves five placement games", () => {
  const pd = { ranked: { rating: 1900, wins: 50, losses: 10, streak: 4 } };
  const first = rankSeason.applySeasonSoftReset(pd, "2026-09");
  assert.equal(first.changed, true);
  assert.equal(first.before, 1900);
  assert.equal(first.after, 1450);
  assert.equal(pd.ranked.rating, 1450);
  assert.equal(pd.ranked.placementGamesLeft, 5);
  assert.equal(pd.ranked.placementSeason, "2026-09");
  assert.equal(pd.ranked.lastResetSeason, "2026-09");
  assert.equal(pd.ranked.streak, 0);

  pd.ranked.rating = 1600;
  const second = rankSeason.applySeasonSoftReset(pd, "2026-09");
  assert.equal(second.changed, false);
  assert.equal(second.reason, "already_reset");
  assert.equal(pd.ranked.rating, 1600, "같은 시즌에 두 번 리셋하지 않는다");
});

test("placement games decrement once each and stop at zero", () => {
  const pd = { ranked: { rating: 1450, placementGamesLeft: 2, placementSeason: "2026-09" } };
  assert.equal(rankSeason.ratingMultiplier(pd.ranked), rankSeason.PLACEMENT_RATING_MULTIPLIER);
  let r = rankSeason.recordPlacementResult(pd);
  assert.deepEqual({ active: r.active, completed: r.completed, left: r.left }, { active: true, completed: false, left: 1 });
  r = rankSeason.recordPlacementResult(pd);
  assert.deepEqual({ active: r.active, completed: r.completed, left: r.left }, { active: true, completed: true, left: 0 });
  r = rankSeason.recordPlacementResult(pd);
  assert.equal(r.active, false);
  assert.equal(pd.ranked.placementGamesLeft, 0);
  assert.equal(rankSeason.ratingMultiplier(pd.ranked), 1);
  assert.deepEqual(rankSeason.placementState(pd.ranked), {
    active: false, left: 0, required: 5, done: 5, season: "2026-09"
  });
});

/* =========================================================
   길드 주간 대항전
========================================================= */
function weeklyGuild(joinedAt, createdAt = joinedAt) {
  return {
    key: "g1", name: "호랑이", leader: "a", leaderNick: "A",
    createdAt,
    members: [{ key: "a", nick: "A", joinedAt }, { key: "b", nick: "B", joinedAt }],
    week: { key: "", points: {}, dailyKey: "", dailyPoints: {}, updatedAt: "" }
  };
}

test("guild weekly contribution enforces join grace, daily cap, and weekly cap", () => {
  const now = Date.UTC(2026, 9, 28, 3, 0, 0);
  const key = guildWeek.kstWeekKey(now);
  const g = weeklyGuild(new Date(now - 3 * 86400000).toISOString());
  const add = (points, deltaMs = 0) => guildWeek.addGuildWeekContribution(g, {
    memberKey: "a", points, now: now + deltaMs, weekKey: key
  });

  assert.equal(add(30).added, 30);
  assert.equal(add(300).added, guildWeek.GUILD_WEEK_MEMBER_DAILY_CAP - 30);
  assert.equal(add(100).added, 0, "일일 상한을 넘으면 더하지 않는다");
  assert.equal(add(300, 86400000).added, guildWeek.GUILD_WEEK_MEMBER_DAILY_CAP);

  /* 다음 날부터 다시 일일 상한이 열리지만 주간 상한(900)이 남아 있다 */
  assert.equal(guildWeek.guildWeekTotal(g), 480);
  assert.equal(add(500, 2 * 86400000).added, guildWeek.GUILD_WEEK_MEMBER_DAILY_CAP);
  assert.equal(guildWeek.guildWeekTotal(g), 720);
  assert.equal(add(500, 3 * 86400000).added, guildWeek.GUILD_WEEK_MEMBER_WEEKLY_CAP - 720);
  assert.equal(add(100, 4 * 86400000).added, 0);
  assert.equal(guildWeek.guildWeekTotal(g), guildWeek.GUILD_WEEK_MEMBER_WEEKLY_CAP);
});

test("new guild members cannot farm points during the 24h grace", () => {
  const now = Date.UTC(2026, 9, 28, 3, 0, 0);
  const g = weeklyGuild(new Date(now - 60 * 1000).toISOString());
  const r = guildWeek.addGuildWeekContribution(g, {
    memberKey: "a", points: 30, now, weekKey: guildWeek.kstWeekKey(now)
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "grace");
  assert.ok(r.waitMs > 0);
});

test("weekly leaderboard ranks only the current week and resets on a new key", () => {
  const now = Date.UTC(2026, 9, 28, 3, 0, 0);
  const key = guildWeek.kstWeekKey(now);
  const g1 = weeklyGuild(new Date(now - 3 * 86400000).toISOString());
  const g2 = weeklyGuild(new Date(now - 3 * 86400000).toISOString());
  g2.key = "g2"; g2.name = "독수리";
  guildWeek.addGuildWeekContribution(g1, { memberKey: "a", points: 30, now, weekKey: key });
  guildWeek.addGuildWeekContribution(g2, { memberKey: "a", points: 60, now, weekKey: key });
  const top = guildWeek.guildWeekLeaderboard({ g1, g2 }, key, 5);
  assert.deepEqual(top.map(r => [r.key, r.rank, r.points]), [["g2", 1, 60], ["g1", 2, 30]]);
  assert.equal(guildWeek.guildWeekRank({ g1, g2 }, key, "g1"), 2);

  const next = guildWeek.kstWeekKey(now + 7 * 86400000);
  assert.notEqual(next, key);
  assert.equal(guildWeek.ensureGuildWeek(g2, next), true);
  assert.equal(guildWeek.guildWeekTotal(g2), 0);
  assert.equal(guildWeek.guildWeekLeaderboard({ g1, g2 }, next, 5).length, 0);
});

/* =========================================================
   웹 푸시
========================================================= */
function fakeWebPush() {
  const calls = [];
  let vapidDetails = null;
  return {
    calls,
    generateVAPIDKeys: () => ({ publicKey: "pub-key", privateKey: "priv-key" }),
    setVapidDetails: (subject, publicKey, privateKey) => { vapidDetails = { subject, publicKey, privateKey }; },
    getDetails: () => vapidDetails,
    sendNotification: async (sub, body) => {
      calls.push({ sub, body });
      if (sub.endpoint.includes("gone")) {
        const err = new Error("gone");
        err.statusCode = 410;
        throw err;
      }
      return { statusCode: 201 };
    }
  };
}

function subscription(endpoint) {
  return { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } };
}

test("push subscription validation rejects insecure or incomplete entries", () => {
  assert.equal(push.sanitizeSubscription(null), null);
  assert.equal(push.sanitizeSubscription({ endpoint: "http://example.com/p", keys: { p256dh: "a", auth: "b" } }), null);
  assert.equal(push.sanitizeSubscription({ endpoint: "https://example.com/p", keys: {} }), null);
  /* 사설/로컬 주소로 푸시를 보내 내부망을 찌르는 SSRF를 막는다 */
  for (const endpoint of [
    "https://localhost/p", "https://127.0.0.1/p", "https://10.0.0.5/p",
    "https://192.168.0.2/p", "https://172.20.1.1/p", "https://169.254.169.254/p",
    "https://[::1]/p", "https://user:pass@example.com/p"
  ]) {
    assert.equal(push.sanitizeSubscription({ endpoint, keys: { p256dh: "a", auth: "b" } }), null, endpoint);
  }
  const ok = push.sanitizeSubscription(subscription("https://push.example.com/abc"));
  assert.equal(ok.endpoint, "https://push.example.com/abc");
  assert.ok(ok.addedAt);
});

test("push manager stores up to five devices and removes expired subscriptions", async () => {
  const wp = fakeWebPush();
  let saved = null;
  const manager = push.createPushManager({
    webpushImpl: wp,
    env: {},
    loadStore: async () => null,
    saveStore: async (store) => { saved = store; },
    logger: { warn() {} }
  });
  const init = await manager.init();
  assert.equal(init.enabled, true);
  assert.equal(init.publicKey, "pub-key");
  assert.ok(wp.getDetails().privateKey);

  const r1 = await manager.subscribe("alice", subscription("https://push.example.com/one"));
  assert.equal(r1.ok, true);
  assert.equal(r1.count, 1);
  await manager.subscribe("alice", subscription("https://push.example.com/gone"));
  assert.equal(manager.count("alice"), 2);

  const sent = await manager.send("alice", { title: "내 턴", body: "입력하세요", url: "/?room=ABC" });
  assert.equal(sent.sent, 1);
  assert.equal(sent.removed, 1);
  assert.equal(manager.count("alice"), 1, "만료된 410 구독은 정리된다");
  const body = JSON.parse(wp.calls[0].body);
  assert.equal(body.title, "내 턴");
  assert.equal(body.url, "/?room=ABC");

  await manager.unsubscribe("alice", "https://push.example.com/one");
  assert.equal(manager.count("alice"), 0);
  assert.equal(saved.subs.alice, undefined);
});

/* =========================================================
   내 턴 푸시 · 길드 보상 대상
========================================================= */
test("turn push is sent only to away players in live multiplayer games", () => {
  const base = { mode: "online", started: true, finished: false, practice: false, isBot: false, visible: false };
  assert.equal(push.shouldNotifyTurn(base), true);
  assert.equal(push.shouldNotifyTurn({ ...base, mode: "ranked" }), true);
  assert.equal(push.shouldNotifyTurn({ ...base, mode: "tournament" }), true);
  assert.equal(push.shouldNotifyTurn({ ...base, visible: true }), false, "보고 있는 플레이어에게는 보내지 않는다");
  assert.equal(push.shouldNotifyTurn({ ...base, started: false }), false);
  assert.equal(push.shouldNotifyTurn({ ...base, finished: true }), false);
  assert.equal(push.shouldNotifyTurn({ ...base, practice: true }), false);
  assert.equal(push.shouldNotifyTurn({ ...base, isBot: true }), false);
  assert.equal(push.shouldNotifyTurn({ ...base, mode: "ai" }), false);
});

test("guild weekly rewards only members who scored this week", () => {
  const g = weeklyGuild(new Date(Date.now() - 3 * 86400000).toISOString());
  g.members.push({ key: "c", nick: "C", joinedAt: new Date().toISOString() });
  const now = Date.UTC(2026, 9, 28, 3, 0, 0);
  const key = guildWeek.kstWeekKey(now);
  guildWeek.addGuildWeekContribution(g, { memberKey: "a", points: 30, now, weekKey: key });
  const rewarded = guildWeek.guildWeekRewardMembers(g).map(m => m.key);
  assert.deepEqual(rewarded, ["a"], "0점 길드원과 기여 없는 신규 가입자는 제외한다");
});
