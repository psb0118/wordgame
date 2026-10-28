"use strict";

/* 단어장(계정 동기화) 순수 로직
   ---------------------------------------------------------
   - 저장 항목은 { word, at } 이고 최대 300개다.
   - 같은 단어는 한 번만 저장하며, 새 단어가 앞에 온다.
   - 서버(플레이어 데이터)와 클라이언트(localStorage)가 같은 규칙을 쓴다. */

const MAX_ITEMS = 300;
const MAX_WORD_LENGTH = 30;

function cleanWord(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, "").trim().slice(0, MAX_WORD_LENGTH);
}

function cleanAt(raw) {
  if (typeof raw !== "string") return "";
  const at = raw.trim();
  return at && at.length <= 40 ? at : "";
}

function sanitize(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const word = cleanWord(item && item.word);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push({ word, at: cleanAt(item && item.at) });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function add(items, word, at = new Date().toISOString()) {
  const w = cleanWord(word);
  const list = sanitize(items);
  if (!w) return list;
  const rest = list.filter(entry => entry.word !== w);
  rest.unshift({ word: w, at: cleanAt(at) || new Date().toISOString() });
  return rest.slice(0, MAX_ITEMS);
}

function remove(items, word) {
  const w = cleanWord(word);
  return sanitize(items).filter(entry => entry.word !== w);
}

/* 로컬(브라우저) 단어를 서버 목록 뒤에 합친다 — 서버 순서를 우선한다. */
function merge(items, incoming) {
  const list = sanitize(items);
  const seen = new Set(list.map(entry => entry.word));
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const word = cleanWord(item && item.word);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    list.push({ word, at: cleanAt(item && item.at) });
    if (list.length >= MAX_ITEMS) break;
  }
  return list;
}

module.exports = { MAX_ITEMS, MAX_WORD_LENGTH, cleanWord, sanitize, add, remove, merge };
