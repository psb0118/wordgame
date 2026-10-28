"use strict";

/* 시즌 랭크 소프트 리셋 · 배치고사
   ---------------------------------------------------------
   - 시즌이 끝나면 참가자의 랭크 레이팅을 1000 기준으로 일부만 이월한다.
   - 이월된 참가자는 다음 시즌 첫 PLACEMENT_GAMES 판을 배치고사로 치른다.
   - 배치 중에는 레이팅 변동 폭을 키워 몇 판 만에 실력대에 수렴하게 한다.
   - 모든 함수는 순수 함수이며, 저장은 호출하는 쪽(서버)이 담당한다. */

const PLACEMENT_GAMES = 5;
const SOFT_RESET_RATIO = 0.5;
const PLACEMENT_RATING_MULTIPLIER = 1.5;

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* 1000 + (현재-1000) * ratio — 0 미만으로 내려가지 않게 한다. */
function softResetRating(rating, ratio = SOFT_RESET_RATIO) {
  const current = Number(rating);
  const base = Number.isFinite(current) ? current : 1000;
  const r = Number.isFinite(Number(ratio)) ? Number(ratio) : SOFT_RESET_RATIO;
  const bounded = Math.min(1, Math.max(0, r));
  return Math.max(0, Math.round(1000 + (base - 1000) * bounded));
}

/* migratePlayerData가 호출하는 필드 보정 — 기존 계정에는 필드가 없다. */
function ensurePlacementFields(ranked) {
  if (!ranked || typeof ranked !== "object") return ranked;
  ranked.placementGamesLeft = clampInt(ranked.placementGamesLeft, 0, PLACEMENT_GAMES, 0);
  ranked.placementSeason = typeof ranked.placementSeason === "string" ? ranked.placementSeason : "";
  ranked.lastResetSeason = typeof ranked.lastResetSeason === "string" ? ranked.lastResetSeason : "";
  return ranked;
}

function placementState(ranked) {
  const left = clampInt(ranked && ranked.placementGamesLeft, 0, PLACEMENT_GAMES, 0);
  return {
    active: left > 0,
    left,
    required: PLACEMENT_GAMES,
    done: Math.max(0, PLACEMENT_GAMES - left),
    season: String((ranked && ranked.placementSeason) || "")
  };
}

/* 시즌 종료 시 1회만 적용된다. 같은 시즌 키로 다시 호출해도 변경하지 않는다. */
function applySeasonSoftReset(playerData, seasonKey, opts = {}) {
  const pd = playerData;
  if (!pd || !pd.ranked || typeof pd.ranked !== "object") {
    return { changed: false, reason: "no_ranked", before: null, after: null };
  }
  const key = String(seasonKey || "");
  if (!key) return { changed: false, reason: "no_season", before: null, after: null };
  if (pd.ranked.lastResetSeason === key) {
    return { changed: false, reason: "already_reset", before: pd.ranked.rating, after: pd.ranked.rating };
  }
  const before = Number.isFinite(Number(pd.ranked.rating)) ? Number(pd.ranked.rating) : 1000;
  const ratio = opts.ratio == null ? SOFT_RESET_RATIO : opts.ratio;
  const after = opts.skipRatingReset ? before : softResetRating(before, ratio);
  pd.ranked.rating = after;
  pd.ranked.placementGamesLeft = PLACEMENT_GAMES;
  /* 배치가 진행되는 시즌(보통 새 시즌) — 마커(lastResetSeason)는 종료된 시즌을 가리킨다. */
  pd.ranked.placementSeason = String(opts.placementSeason || key);
  pd.ranked.lastResetSeason = key;
  pd.ranked.streak = 0;
  return { changed: true, reason: "reset", before, after };
}

/* 배치 판 결과를 1회 차감한다. 이미 끝났으면 아무 것도 하지 않는다. */
function recordPlacementResult(playerData) {
  const ranked = playerData && playerData.ranked;
  if (!ranked || typeof ranked !== "object") return { active: false, completed: false, left: 0 };
  const left = clampInt(ranked.placementGamesLeft, 0, PLACEMENT_GAMES, 0);
  if (left <= 0) return { active: false, completed: false, left: 0 };
  ranked.placementGamesLeft = left - 1;
  return {
    active: true,
    completed: ranked.placementGamesLeft === 0,
    left: ranked.placementGamesLeft,
    required: PLACEMENT_GAMES
  };
}

/* 배치 중 레이팅 변동 배율 — 배치가 아닌 일반 경기는 1. */
function ratingMultiplier(ranked) {
  return placementState(ranked).active ? PLACEMENT_RATING_MULTIPLIER : 1;
}

module.exports = {
  PLACEMENT_GAMES,
  SOFT_RESET_RATIO,
  PLACEMENT_RATING_MULTIPLIER,
  softResetRating,
  ensurePlacementFields,
  placementState,
  applySeasonSoftReset,
  recordPlacementResult,
  ratingMultiplier
};
