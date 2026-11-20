"use strict";

/* 제품 패널 계측
   ---------------------------------------------------------
   어떤 화면/패널이 실제로 열리고 어떤 액션이 일어나는지 서버에서 집계한다.
   개인 식별 정보는 저장하지 않고 (panel, action) 카운터만 보관한다.
   /api/metrics와 관리자 패널에서 같은 스냅샷을 본다. */

const PANELS = new Set([
  "single", "online", "ranked", "tournament", "season", "achievements",
  "wordbook", "items", "shop", "guild", "account", "friends", "admin",
  "replay", "coach", "seasonCup", "dailyChallenge", "how", "chat"
]);

const ACTIONS = new Set(["view", "open", "close", "claim", "reserve", "enter", "cancel", "coach"]);

const counters = new Map();
const MAX_KEYS = 500;

function keyOf(panel, action) {
  return `${panel}:${action}`;
}

function track(panel, action = "view") {
  const p = String(panel || "").trim();
  const a = String(action || "view").trim();
  if (!PANELS.has(p) || !ACTIONS.has(a)) return false;
  const key = keyOf(p, a);
  const current = counters.get(key) || { panel: p, action: a, count: 0, lastAt: "" };
  current.count += 1;
  current.lastAt = new Date().toISOString();
  counters.set(key, current);
  if (counters.size > MAX_KEYS) {
    const oldest = counters.keys().next().value;
    if (oldest) counters.delete(oldest);
  }
  return true;
}

function snapshot() {
  return [...counters.values()]
    .map(row => ({ ...row }))
    .sort((a, b) => b.count - a.count || a.panel.localeCompare(b.panel) || a.action.localeCompare(b.action));
}

function reset() {
  counters.clear();
}

module.exports = { PANELS, ACTIONS, track, snapshot, reset };
