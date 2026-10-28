"use strict";

/* 길드 주간 대항전 계산
   ---------------------------------------------------------
   길드 객체에 주차별 기여 점수를 누적한다. 서버는 랭크/대회 승리 시
   addGuildWeekContribution을 호출하고, 주가 바뀌면 ensureGuildWeek가
   이전 주 점수를 비운다. 길드 가입 직후 점수 파밍을 막기 위해
   24시간 유예와 일일/주간 상한을 둔다. 저장은 호출하는 쪽이 담당한다. */

const GUILD_WEEK_JOIN_GRACE_MS = 24 * 60 * 60 * 1000;
const GUILD_WEEK_MEMBER_DAILY_CAP = 240;
const GUILD_WEEK_MEMBER_WEEKLY_CAP = 900;
const GUILD_WEEK_TOP_LIMIT = 10;
const GUILD_WEEK_REWARDS = [
  { rank: 1, amount: 20000 },
  { rank: 2, amount: 10000 },
  { rank: 3, amount: 5000 }
];

function kstWeekKey(ts) {
  const d = new Date((ts == null ? Date.now() : ts) + 9 * 3600 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay() || 7;                /* 월=1 ~ 일=7 */
  d.setUTCDate(d.getUTCDate() + 4 - day);        /* 그 주의 목요일 기준 */
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function kstDateKey(ts) {
  return new Date((ts == null ? Date.now() : ts) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function toPoints(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* 길드 객체의 주차 데이터를 안전한 형태로 보정한다 (로드/저장 공용). */
function normalizeGuildWeek(guild) {
  if (!guild || typeof guild !== "object") return guild;
  const raw = guild.week && typeof guild.week === "object" ? guild.week : {};
  const points = {};
  if (raw.points && typeof raw.points === "object" && !Array.isArray(raw.points)) {
    for (const [k, v] of Object.entries(raw.points)) {
      const key = String(k || "").trim();
      const amount = toPoints(v);
      if (key && amount > 0) points[key] = amount;
    }
  }
  const dailyPoints = {};
  if (raw.dailyPoints && typeof raw.dailyPoints === "object" && !Array.isArray(raw.dailyPoints)) {
    for (const [k, v] of Object.entries(raw.dailyPoints)) {
      const key = String(k || "").trim();
      const amount = toPoints(v);
      if (key && amount > 0) dailyPoints[key] = amount;
    }
  }
  guild.week = {
    key: String(raw.key || ""),
    points,
    dailyKey: String(raw.dailyKey || ""),
    dailyPoints,
    updatedAt: String(raw.updatedAt || "")
  };
  return guild;
}

/* 주가 바뀌었으면 점수를 초기화한다. 같은 주면 그대로 둔다. */
function ensureGuildWeek(guild, weekKey) {
  normalizeGuildWeek(guild);
  if (!guild || !guild.week) return false;
  const key = String(weekKey || "");
  if (!key) return false;
  if (guild.week.key === key) return false;
  guild.week.key = key;
  guild.week.points = {};
  guild.week.dailyKey = "";
  guild.week.dailyPoints = {};
  guild.week.updatedAt = new Date().toISOString();
  return true;
}

/* 가입 후 24시간이 지나야 점수를 낼 수 있다. joinedAt이 없으면 길드 생성일을,
   그것도 없으면 레거시 길드로 보고 허용한다. */
function contributionAllowed(guild, member, now) {
  const joined = Date.parse(String((member && member.joinedAt) || (guild && guild.createdAt) || ""));
  if (!Number.isFinite(joined)) return { ok: true, reason: "legacy" };
  const elapsed = Number(now) - joined;
  if (elapsed < GUILD_WEEK_JOIN_GRACE_MS) {
    return { ok: false, reason: "grace", waitMs: GUILD_WEEK_JOIN_GRACE_MS - elapsed };
  }
  return { ok: true, reason: "ok" };
}

function guildWeekTotal(guild) {
  if (!guild || !guild.week || !guild.week.points) return 0;
  return Object.values(guild.week.points).reduce((sum, n) => sum + toPoints(n), 0);
}

/* 주간 기여 추가. 반환값은 실제로 반영된 점수(상한/유예로 0일 수 있음). */
function addGuildWeekContribution(guild, opts = {}) {
  const memberKey = String(opts.memberKey || "").trim();
  const weekKey = String(opts.weekKey || "");
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  const requested = toPoints(opts.points);
  if (!guild || !memberKey || !weekKey || requested <= 0) {
    return { ok: false, reason: "invalid", added: 0, total: guildWeekTotal(guild), memberTotal: 0 };
  }
  if (!Array.isArray(guild.members)) return { ok: false, reason: "no_members", added: 0, total: 0, memberTotal: 0 };
  const member = guild.members.find(m => m && m.key === memberKey);
  if (!member) return { ok: false, reason: "not_member", added: 0, total: guildWeekTotal(guild), memberTotal: 0 };

  ensureGuildWeek(guild, weekKey);
  const allowed = contributionAllowed(guild, member, now);
  if (!allowed.ok) {
    return { ok: false, reason: allowed.reason, waitMs: allowed.waitMs, added: 0, total: guildWeekTotal(guild), memberTotal: 0 };
  }

  const dailyKey = kstDateKey(now);
  if (guild.week.dailyKey !== dailyKey) {
    guild.week.dailyKey = dailyKey;
    guild.week.dailyPoints = {};
  }
  const daily = toPoints(guild.week.dailyPoints[memberKey]);
  const memberTotal = toPoints(guild.week.points[memberKey]);
  const remaining = Math.min(
    GUILD_WEEK_MEMBER_DAILY_CAP - daily,
    GUILD_WEEK_MEMBER_WEEKLY_CAP - memberTotal
  );
  if (remaining <= 0) {
    return { ok: false, reason: "capped", added: 0, total: guildWeekTotal(guild), memberTotal };
  }
  const added = Math.min(requested, remaining);
  guild.week.points[memberKey] = memberTotal + added;
  guild.week.dailyPoints[memberKey] = daily + added;
  guild.week.updatedAt = new Date(now).toISOString();
  return {
    ok: true,
    reason: added < requested ? "capped" : "ok",
    added,
    total: guildWeekTotal(guild),
    memberTotal: guild.week.points[memberKey]
  };
}

/* 주간 보상 대상 — 이번 주에 실제로 점수를 낸 길드원만.
   가입만 하고 기여하지 않은 길드원에게 보상이 새는 것을 막는다. */
function guildWeekRewardMembers(guild) {
  if (!guild || !guild.week || !guild.week.points || !Array.isArray(guild.members)) return [];
  const seen = new Set();
  const out = [];
  for (const member of guild.members) {
    if (!member || !member.key) continue;
    const key = String(member.key);
    if (seen.has(key)) continue;
    seen.add(key);
    if (toPoints(guild.week.points[key]) <= 0) continue;
    out.push(member);
  }
  return out;
}

/* 현재 주차 리더보드 — 점수가 0인 길드는 제외한다. */
function guildWeekLeaderboard(guilds, weekKey, limit = GUILD_WEEK_TOP_LIMIT) {
  const key = String(weekKey || "");
  const rows = [];
  for (const g of Object.values(guilds || {})) {
    if (!g || !g.week || g.week.key !== key) continue;
    const points = guildWeekTotal(g);
    if (points <= 0) continue;
    rows.push({
      key: String(g.key || ""),
      name: String(g.name || ""),
      points,
      memberCount: Array.isArray(g.members) ? g.members.length : 0,
      leader: String(g.leaderNick || g.leader || "")
    });
  }
  rows.sort((a, b) => (b.points - a.points) || String(a.name).localeCompare(String(b.name)));
  const top = rows.slice(0, Math.max(1, Math.floor(Number(limit) || GUILD_WEEK_TOP_LIMIT)));
  top.forEach((row, i) => { row.rank = i + 1; });
  return top;
}

function guildWeekRank(guilds, weekKey, guildKey) {
  const rows = guildWeekLeaderboard(guilds, weekKey, 100000);
  const idx = rows.findIndex(r => r.key === guildKey);
  return idx >= 0 ? rows[idx].rank : null;
}

function guildMemberWeekPoints(guild, memberKey) {
  if (!guild || !guild.week || !guild.week.points) return 0;
  return toPoints(guild.week.points[memberKey]);
}

function guildWeekRewardFor(rank) {
  const row = GUILD_WEEK_REWARDS.find(r => r.rank === Number(rank));
  return row ? row.amount : 0;
}

module.exports = {
  GUILD_WEEK_JOIN_GRACE_MS,
  GUILD_WEEK_MEMBER_DAILY_CAP,
  GUILD_WEEK_MEMBER_WEEKLY_CAP,
  GUILD_WEEK_TOP_LIMIT,
  GUILD_WEEK_REWARDS,
  kstWeekKey,
  kstDateKey,
  normalizeGuildWeek,
  ensureGuildWeek,
  contributionAllowed,
  guildWeekTotal,
  guildWeekRewardMembers,
  addGuildWeekContribution,
  guildWeekLeaderboard,
  guildWeekRank,
  guildMemberWeekPoints,
  guildWeekRewardFor
};
