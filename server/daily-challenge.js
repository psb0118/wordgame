"use strict";

/* 데일리 챌린지
   ---------------------------------------------------------
   KST 날짜를 시드로 매일 하나의 챌린지를 고른다. 진행도는 계정에
   누적되고, 보상 수령은 economy_ledger의 멱등 키로 한 번만 지급한다.
   이 모듈은 순수 로직만 담당하며 저장/지급은 server.js가 맡는다. */

const CHALLENGES = [
  {
    id: "words",
    title: "말의 흐름",
    description: "아무 모드에서 단어 {target}개를 사용하세요.",
    metric: "words",
    target: 8,
    reward: 5000
  },
  {
    id: "long",
    title: "긴 단어 사냥",
    description: "4글자 이상 단어를 {target}개 사용하세요.",
    metric: "longWords",
    target: 4,
    reward: 7000
  },
  {
    id: "attack",
    title: "압박의 순간",
    description: "공격 단어를 {target}개 사용하세요.",
    metric: "attacks",
    target: 2,
    reward: 9000
  },
  {
    id: "wins",
    title: "오늘의 승부사",
    description: "아무 모드에서 {target}승을 거두세요.",
    metric: "wins",
    target: 2,
    reward: 8000
  },
  {
    id: "rankedWords",
    title: "랭크 집중력",
    description: "랭크 경기에서 단어 {target}개를 사용하세요.",
    metric: "rankedWords",
    target: 5,
    reward: 10000
  }
];

const METRICS = ["words", "longWords", "attacks", "wins", "rankedWords"];

function toInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function dateKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function seedOf(date) {
  const key = dateKey(date);
  let hash = 2166136261;
  for (const ch of key) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function challengeForDate(date) {
  const def = CHALLENGES[seedOf(date) % CHALLENGES.length];
  return { ...def, description: def.description.replace("{target}", String(def.target)) };
}

function emptyState(date) {
  return { date: dateKey(date), progress: 0, claimed: false, claimedAt: "" };
}

function normalizeState(raw, date) {
  const key = dateKey(date);
  if (!raw || typeof raw !== "object" || raw.date !== key) return emptyState(key);
  return {
    date: key,
    progress: toInt(raw.progress, 0, 1000000, 0),
    claimed: raw.claimed === true,
    claimedAt: typeof raw.claimedAt === "string" ? raw.claimedAt.slice(0, 40) : ""
  };
}

function gameProgress(game) {
  const data = game && typeof game === "object" ? game : {};
  const mode = String(data.mode || "");
  const words = toInt(data.words, 0, 10000, 0);
  return {
    words,
    longWords: toInt(data.longWords, 0, 10000, 0),
    attacks: toInt(data.attacks, 0, 10000, 0),
    wins: data.win === true ? 1 : 0,
    rankedWords: mode === "ranked" ? words : 0
  };
}

function applyGame(rawState, game, date) {
  const state = normalizeState(rawState, date);
  if (state.claimed) return state;
  const def = challengeForDate(state.date);
  const progress = gameProgress(game);
  const delta = progress[def.metric] || 0;
  if (delta <= 0) return state;
  return { ...state, progress: Math.min(def.target, state.progress + delta) };
}

function publicState(rawState, date) {
  const state = normalizeState(rawState, date);
  const def = challengeForDate(state.date);
  const progress = Math.min(def.target, state.progress);
  return {
    ...def,
    date: state.date,
    progress,
    target: def.target,
    percent: Math.round((progress / def.target) * 100),
    complete: progress >= def.target,
    claimed: state.claimed,
    claimedAt: state.claimedAt
  };
}

function complete(rawState, date) {
  const pub = publicState(rawState, date);
  return pub.complete && !pub.claimed;
}

module.exports = {
  CHALLENGES,
  METRICS,
  dateKey,
  seedOf,
  challengeForDate,
  emptyState,
  normalizeState,
  applyGame,
  publicState,
  complete
};
