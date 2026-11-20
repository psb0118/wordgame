"use strict";

/* 계정 인벤토리 직렬화
   ---------------------------------------------------------
   지갑과 달리 칭호·물약·보호권·배율은 여러 화면(상점/아이템/랭크)에서
   동시에 바뀔 수 있다. 저장 필드는 기존 계정 스키마를 그대로 유지하되,
   외부로 내보내는 인벤토리는 한 가지 형태로 정규화하고 revision을 붙인다.
   - 모든 값은 서버가 마지막으로 저장한 계정 스냅샷에서 만든다.
   - revision은 인벤토리가 실제로 바뀐 작업에서만 증가한다.
   - 클라이언트는 revision이 낮은 응답으로 최신 인벤토리를 덮어쓰지 않는다. */

const INVENTORY_VERSION = 1;
const MAX_TITLES = 200;
const MAX_TITLE_NAME = 40;

function toInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanTitle(entry) {
  if (!entry || typeof entry !== "object") return null;
  const rawId = String(entry.id || "").trim();
  if (!/^[a-zA-Z0-9:_-]{1,48}$/.test(rawId)) return null;
  const name = String(entry.name || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_NAME);
  if (!name) return null;
  return { id: rawId, name };
}

function sanitizeTitles(entries) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const clean = cleanTitle(entry);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= MAX_TITLES) break;
  }
  return out;
}

function ensure(playerData) {
  const pd = playerData && typeof playerData === "object" ? playerData : {};
  pd.titles = sanitizeTitles(pd.titles);
  pd.currentTitle = typeof pd.currentTitle === "string" ? pd.currentTitle.trim().slice(0, MAX_TITLE_NAME) : "";
  pd.moneyMultiplier = toInt(pd.moneyMultiplier, 1, 99, 1);
  pd.ratingBoostGames = toInt(pd.ratingBoostGames, 0, 1000000, 0);
  pd.shieldTickets = toInt(pd.shieldTickets, 0, 1000000, 0);
  pd.inventoryRevision = toInt(pd.inventoryRevision, 0, Number.MAX_SAFE_INTEGER, 0);
  return pd;
}

function revisionOf(playerData) {
  return toInt(playerData && playerData.inventoryRevision, 0, Number.MAX_SAFE_INTEGER, 0);
}

function bumpRevision(playerData) {
  const pd = ensure(playerData);
  pd.inventoryRevision = Math.min(Number.MAX_SAFE_INTEGER, revisionOf(pd) + 1);
  return pd.inventoryRevision;
}

/* 외부 응답용 정규화 스냅샷. 계정 단위로 한 번에 직렬화한다. */
function serialize(playerData) {
  const pd = ensure(playerData);
  return {
    version: INVENTORY_VERSION,
    revision: revisionOf(pd),
    moneyMultiplier: pd.moneyMultiplier,
    ratingBoostGames: pd.ratingBoostGames,
    shieldTickets: pd.shieldTickets,
    titles: pd.titles.map(entry => ({ id: entry.id, name: entry.name })),
    currentTitle: pd.currentTitle
  };
}

/* revision을 포함한 클라이언트 패치가 오래된 경우 무시한다. */
function isStale(clientRevision, currentRevision) {
  return Number(clientRevision) < Number(currentRevision);
}

module.exports = {
  INVENTORY_VERSION,
  MAX_TITLES,
  sanitizeTitles,
  ensure,
  revisionOf,
  bumpRevision,
  serialize,
  isStale
};
