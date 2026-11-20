"use strict";

/* 예약 토너먼트 — 시즌 컵
   ---------------------------------------------------------
   매일 KST 21:00에 시작하는 4인 시즌 컵의 예약/시간 상태를 계산한다.
   서버는 이 모듈의 slot 정보로 예약자를 자동 큐에 넣고, 실제 경기 정산은
   기존 tournament 엔진을 재사용한다. 이 파일은 순수 시간/상태 로직만 담당한다. */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CUP_HOUR_KST = 21;
const CUP_DURATION_MS = 30 * 60 * 1000;
const CUP_RESERVE_AHEAD_MS = 24 * 60 * 60 * 1000;

function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Date.now();
}

function kstDateParts(now) {
  const d = new Date(toMs(now) + KST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/* 해당 KST 날짜의 21:00을 UTC epoch로 변환한다. */
function slotAt(parts) {
  return Date.UTC(parts.year, parts.month, parts.day, CUP_HOUR_KST - 9, 0, 0, 0);
}

function todaySlot(now) {
  return slotAt(kstDateParts(now));
}

function nextSlot(now) {
  const current = todaySlot(now);
  return toMs(now) < current ? current : current + 86400000;
}

function currentLiveSlot(now) {
  const start = todaySlot(now);
  const t = toMs(now);
  return t >= start && t < start + CUP_DURATION_MS ? start : null;
}

function slotKey(startMs) {
  return new Date(Number(startMs)).toISOString();
}

function slotLabel(startMs) {
  const d = new Date(Number(startMs) + KST_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}.${dd} 21:00`;
}

function info(now, options = {}) {
  const t = toMs(now);
  const liveStart = currentLiveSlot(t);
  const startAt = liveStart != null ? liveStart : nextSlot(t);
  const endAt = startAt + CUP_DURATION_MS;
  const state = liveStart != null ? "live" : "upcoming";
  const reserved = Array.isArray(options.reservations) ? options.reservations : [];
  const online = new Set((Array.isArray(options.onlineAccounts) ? options.onlineAccounts : []).map(String));
  const myAccount = String(options.myAccount || "");
  const forSlot = reserved.filter(entry => entry && entry.slot === slotKey(startAt));
  const onlineReserved = forSlot.filter(entry => online.has(String(entry.account))).length;
  return {
    state,
    slot: slotKey(startAt),
    label: slotLabel(startAt),
    startAt,
    endAt,
    durationMs: CUP_DURATION_MS,
    msUntilStart: Math.max(0, startAt - t),
    msUntilEnd: Math.max(0, endAt - t),
    reservedCount: forSlot.length,
    onlineReservedCount: onlineReserved,
    myReserved: !!myAccount && forSlot.some(entry => String(entry.account) === myAccount),
    reserveAheadMs: CUP_RESERVE_AHEAD_MS,
    rewards: {
      winnerCoins: 120000,
      title: { id: "t_season_cup", name: "시즌 컵 챔피언" },
      participation: "예약 참가자 전원 시즌 포인트"
    }
  };
}

function sanitizeReservation(entry) {
  if (!entry || typeof entry !== "object") return null;
  const account = String(entry.account || "").trim().toLowerCase().slice(0, 40);
  const nickname = String(entry.nickname || "").trim().slice(0, 20);
  const slot = String(entry.slot || "").trim().slice(0, 40);
  if (!account || !nickname || !slot) return null;
  return {
    account,
    nickname,
    slot,
    reservedAt: typeof entry.reservedAt === "string" ? entry.reservedAt.slice(0, 40) : new Date().toISOString()
  };
}

function sanitizeStore(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const reservations = (Array.isArray(data.reservations) ? data.reservations : [])
    .map(sanitizeReservation)
    .filter(Boolean)
    .slice(-500);
  return {
    reservations,
    lastStarted: typeof data.lastStarted === "string" ? data.lastStarted.slice(0, 40) : "",
    history: (Array.isArray(data.history) ? data.history : []).filter(h => h && typeof h === "object").slice(-20)
  };
}

module.exports = {
  KST_OFFSET_MS,
  CUP_HOUR_KST,
  CUP_DURATION_MS,
  CUP_RESERVE_AHEAD_MS,
  kstDateParts,
  slotAt,
  todaySlot,
  nextSlot,
  currentLiveSlot,
  slotKey,
  slotLabel,
  info,
  sanitizeReservation,
  sanitizeStore
};
