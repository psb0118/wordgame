"use strict";

/* 리플레이 공유 링크 — 저장/전송에 쓰는 순수 로직
   ---------------------------------------------------------
   - 공유 토큰은 추측할 수 없는 base64url 문자열이다.
   - 플로우는 최대 200수, 단어/닉네임/깊이/턴만 남기고 내부 ID는 버린다.
   - 닉네임은 선택이며, 없으면 "플레이어"로 표시한다. */

const crypto = require("crypto");

const MAX_FLOW = 200;
const MAX_WORD_LENGTH = 30;
const MAX_NAME_LENGTH = 24;

function cleanText(raw, max) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, max);
}

function toInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function sanitizeFlow(flow) {
  if (!Array.isArray(flow)) return null;
  const out = [];
  for (const item of flow) {
    if (!item || typeof item !== "object") continue;
    const w = cleanText(item.w, MAX_WORD_LENGTH).replace(/\s+/g, "");
    if (!w) continue;
    const n = cleanText(item.n, MAX_NAME_LENGTH) || "플레이어";
    out.push({
      w,
      n,
      m: !!item.m,
      d: toInt(item.d, 0, 99),
      t: toInt(item.t, 0, 9999),
      o: !!item.o
    });
    if (out.length >= MAX_FLOW) break;
  }
  return out.length >= 2 ? out : null;
}

function createToken() {
  return crypto.randomBytes(9).toString("base64url");
}

function isToken(value) {
  const token = String(value == null ? "" : value);
  return /^[A-Za-z0-9_-]{12}$/.test(token);
}

module.exports = { MAX_FLOW, MAX_WORD_LENGTH, MAX_NAME_LENGTH, sanitizeFlow, createToken, isToken };
