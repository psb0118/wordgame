"use strict";

/* 길드 1:1 주간 대항전
   ---------------------------------------------------------
   - 같은 주에 점수를 낸 길드끼리 점수가 가까운 순서로 1:1 매칭한다.
   - 매칭은 양쪽 길드에 대칭으로 기록되고, 한 번 정해지면 그 주 동안 유지된다.
   - 주가 끝나면 점수가 높은 길드가 승리하고, 이번 주에 기여한 길드원에게만
     승리/무승부/패배 보상을 지급한다(서버가 코인 원장 멱등 키로 처리).
   - 이 모듈은 순수 계산만 담당하고 저장은 호출하는 쪽이 한다. */

const DUEL_WIN_REWARD = 8000;
const DUEL_LOSS_REWARD = 3000;
const DUEL_DRAW_REWARD = 5000;
const DUEL_HISTORY_LIMIT = 8;

function toPoints(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function weekTotal(guild) {
  const points = guild && guild.week && guild.week.points;
  if (!points || typeof points !== "object") return 0;
  return Object.values(points).reduce((sum, value) => sum + toPoints(value), 0);
}

function cleanKey(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeDuel(guild) {
  if (!guild || typeof guild !== "object") return guild;
  const raw = guild.duel && typeof guild.duel === "object" ? guild.duel : {};
  guild.duel = {
    week: typeof raw.week === "string" ? raw.week : "",
    opponentKey: typeof raw.opponentKey === "string" ? raw.opponentKey : "",
    opponentName: typeof raw.opponentName === "string" ? raw.opponentName.slice(0, 12) : "",
    lockedAt: typeof raw.lockedAt === "string" ? raw.lockedAt : "",
    settled: !!raw.settled
  };
  guild.duelWins = Number.isFinite(Number(guild.duelWins)) ? Math.max(0, Math.floor(Number(guild.duelWins))) : 0;
  guild.duelLosses = Number.isFinite(Number(guild.duelLosses)) ? Math.max(0, Math.floor(Number(guild.duelLosses))) : 0;
  guild.duelDraws = Number.isFinite(Number(guild.duelDraws)) ? Math.max(0, Math.floor(Number(guild.duelDraws))) : 0;
  const history = Array.isArray(guild.duelHistory) ? guild.duelHistory : [];
  guild.duelHistory = history
    .filter(row => row && typeof row === "object" && typeof row.week === "string" && row.week)
    .map(row => ({
      week: row.week,
      opponentKey: cleanKey(row.opponentKey),
      opponentName: String(row.opponentName || "").slice(0, 12),
      result: ["win", "loss", "draw"].includes(row.result) ? row.result : "draw",
      myPoints: toPoints(row.myPoints),
      theirPoints: toPoints(row.theirPoints),
      amount: toPoints(row.amount),
      at: typeof row.at === "string" ? row.at : ""
    }))
    .slice(-DUEL_HISTORY_LIMIT);
  return guild;
}

/* 이번 주에 아직 상대가 없는 길드를 점수 근접 순으로 짝지어 준다.
   반환값은 새로 매칭된 길드 수(저장 필요 여부 판단용). */
function ensurePairings(guilds, weekKey, now = Date.now()) {
  const key = String(weekKey || "");
  if (!key || !guilds || typeof guilds !== "object") return 0;
  const all = Object.values(guilds).filter(guild => guild && typeof guild === "object");
  /* 점수가 아직 없는 길드도 빈 대항전 필드를 갖게 해 저장 형태를 일정하게 유지한다. */
  for (const guild of all) normalizeDuel(guild);
  const pool = all.filter(guild => guild.week && guild.week.key === key && weekTotal(guild) > 0);

  const taken = new Set();
  for (const guild of pool) {
    if (guild.duel.week === key) {
      taken.add(guild.key);
      if (guild.duel.opponentKey) taken.add(guild.duel.opponentKey);
    }
  }

  const open = pool
    .filter(guild => !taken.has(guild.key))
    .sort((a, b) => (weekTotal(b) - weekTotal(a)) || String(a.key).localeCompare(String(b.key)));

  let changed = 0;
  while (open.length >= 2) {
    const first = open.shift();
    /* 남은 길드 중 점수가 가장 가까운 상대. 동점이면 키 순서로 고정한다. */
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      const distance = Math.abs(weekTotal(open[i]) - weekTotal(first));
      const bestDistance = Math.abs(weekTotal(open[bestIndex]) - weekTotal(first));
      if (distance < bestDistance || (distance === bestDistance && String(open[i].key) < String(open[bestIndex].key))) {
        bestIndex = i;
      }
    }
    const second = open.splice(bestIndex, 1)[0];
    const lockedAt = new Date(now).toISOString();
    first.duel = { week: key, opponentKey: second.key, opponentName: second.name, lockedAt, settled: false };
    second.duel = { week: key, opponentKey: first.key, opponentName: first.name, lockedAt, settled: false };
    changed += 2;
  }

  if (open.length === 1) {
    const alone = open[0];
    alone.duel = { week: key, opponentKey: "", opponentName: "", lockedAt: new Date(now).toISOString(), settled: false };
    changed += 1;
  }
  return changed;
}

/* 화면에 보여줄 현재 대항전 상태. 상대가 없으면 null이 아니라 bye 상태를 준다. */
function duelView(guild, guilds, weekKey) {
  if (!guild) return null;
  normalizeDuel(guild);
  const duel = guild.duel;
  const key = String(weekKey || "");
  if (!duel || duel.week !== key) return null;
  const opponent = duel.opponentKey && guilds ? guilds[duel.opponentKey] : null;
  const myPoints = weekTotal(guild);
  const theirPoints = opponent ? weekTotal(opponent) : 0;
  const diff = myPoints - theirPoints;
  const liveState = !duel.opponentKey ? "bye" : diff > 0 ? "winning" : diff < 0 ? "losing" : "draw";
  return {
    weekKey: key,
    myName: String(guild.name || ""),
    myPoints,
    opponent: duel.opponentKey ? {
      key: duel.opponentKey,
      name: duel.opponentName || (opponent && opponent.name) || "상대 길드",
      points: theirPoints
    } : null,
    state: duel.settled ? "settled" : liveState,
    record: {
      wins: guild.duelWins,
      losses: guild.duelLosses,
      draws: guild.duelDraws
    },
    history: (guild.duelHistory || []).slice(-3).map(row => ({
      week: row.week,
      opponentName: row.opponentName,
      result: row.result,
      myPoints: row.myPoints,
      theirPoints: row.theirPoints,
      amount: row.amount
    }))
  };
}

function duelRewardFor(result) {
  if (result === "win") return DUEL_WIN_REWARD;
  if (result === "draw") return DUEL_DRAW_REWARD;
  return DUEL_LOSS_REWARD;
}

/* 주간 종료 시 한 번 호출 — 점수 비교로 승/패/무를 확정한다. */
function settleDuel({ weekKey, guild, opponent }) {
  const myPoints = weekTotal(guild);
  const theirPoints = weekTotal(opponent);
  const result = myPoints === theirPoints ? "draw" : (myPoints > theirPoints ? "win" : "loss");
  return {
    weekKey: String(weekKey || ""),
    result,
    myPoints,
    theirPoints,
    amount: duelRewardFor(result)
  };
}

/* 정산 결과를 길드 전적에 반영한다. 정산은 양쪽 길드에 각각 한 번씩만 호출한다. */
function applyDuelRecord(guild, opts = {}) {
  if (!guild) return guild;
  normalizeDuel(guild);
  const result = ["win", "loss", "draw"].includes(opts.result) ? opts.result : "draw";
  if (result === "win") guild.duelWins += 1;
  else if (result === "loss") guild.duelLosses += 1;
  else guild.duelDraws += 1;
  guild.duel.settled = true;
  guild.duelHistory.push({
    week: String(opts.weekKey || guild.duel.week || ""),
    opponentKey: cleanKey(opts.opponentKey),
    opponentName: String(opts.opponentName || "").slice(0, 12),
    result,
    myPoints: toPoints(opts.myPoints),
    theirPoints: toPoints(opts.theirPoints),
    amount: toPoints(opts.amount),
    at: new Date().toISOString()
  });
  guild.duelHistory = guild.duelHistory.slice(-DUEL_HISTORY_LIMIT);
  return guild;
}

module.exports = {
  DUEL_WIN_REWARD,
  DUEL_LOSS_REWARD,
  DUEL_DRAW_REWARD,
  DUEL_HISTORY_LIMIT,
  weekTotal,
  normalizeDuel,
  ensurePairings,
  duelView,
  duelRewardFor,
  settleDuel,
  applyDuelRecord
};
