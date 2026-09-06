"use strict";

/* =========================================================
   server/game.js — 끝말잇기 공통 게임 엔진
   
   서버에서만 사용.
   AI 로직, 단어 검증, 두음법칙, 연결 판정 등을 담당.
========================================================= */

const fs = require("fs");
const path = require("path");

/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
  "녀": ["녀", "여"],
  "년": ["년", "연"],
  "녕": ["녕", "영"],
  "녜": ["녜", "예"],
  "뇨": ["뇨", "요"],
  "뉴": ["뉴", "유"],
  "니": ["니", "이"],

  "랴": ["랴", "야"],
  "려": ["려", "여"],
  "례": ["례", "예"],
  "료": ["료", "요"],
  "류": ["류", "유"],
  "리": ["리", "이"],

  "라": ["라", "나"],
  "락": ["락", "낙"],
  "란": ["란", "난"],
  "랄": ["랄", "날"],
  "람": ["람", "남"],
  "랍": ["랍", "납"],
  "랏": ["랏", "낫"],
  "랑": ["랑", "낭"],
  "래": ["래", "내"],
  "랭": ["랭", "냉"],

  "략": ["략", "약"],
  "량": ["량", "양"],
  "련": ["련", "연"],
  "렬": ["렬", "열"],
  "령": ["령", "영"],

  "로": ["로", "노"],
  "록": ["록", "녹"],
  "론": ["론", "논"],
  "롤": ["롤", "놀"],
  "롬": ["롬", "놈"],
  "롭": ["롭", "놉"],
  "롯": ["롯", "놃"],
  "롱": ["롱", "농"],
  "뢰": ["뢰", "뇌"],

  "루": ["루", "누"],
  "륙": ["륙", "육"],
  "률": ["률", "율"],
  "륜": ["륜", "윤"],
  "륭": ["륭", "융"]
};

/* =========================================================
   정규화
========================================================= */

function normalizeWord(word) {
  if (typeof word !== "string") return "";
  return word.trim().replace(/\s+/g, "").normalize("NFC");
}

/* =========================================================
   두음법칙 — 허용 시작 글자
========================================================= */

function allowedFirstChars(lastChar) {
  lastChar = normalizeWord(lastChar);
  if (!lastChar) return [];

  const result = new Set();
  result.add(lastChar);

  const direct = DUEUM[lastChar];
  if (Array.isArray(direct)) {
    for (const ch of direct) {
      if (ch) result.add(ch);
    }
  }

  for (const [from, values] of Object.entries(DUEUM)) {
    if (!Array.isArray(values)) continue;
    if (values.includes(lastChar)) {
      result.add(from);
    }
  }

  return [...result];
}

/* =========================================================
   연결 판정
========================================================= */

function canConnect(previousWord, nextWord) {
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);
  if (!previousWord || !nextWord) return false;

  const last = previousWord.at(-1);
  const first = nextWord.at(0);
  return allowedFirstChars(last).includes(first);
}

/* =========================================================
   데이터 로드
========================================================= */

function findExistingFile(candidates) {
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function loadData(dataDir, rootDir) {
  const WORD_SET = new Set();
  const ATTACK_DEPTH = Object.create(null);
  const WORD_INDEX = new Map();

  const wordCandidates = [
    path.join(dataDir, "word.txt"),
    path.join(rootDir, "word.txt")
  ];
  const attackCandidates = [
    path.join(dataDir, "attack.txt"),
    path.join(rootDir, "attack.txt")
  ];

  const wordFile = findExistingFile(wordCandidates);
  if (!wordFile) {
    console.error("ERROR: word.txt를 찾을 수 없습니다.");
  } else {
    const text = fs.readFileSync(wordFile, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const word = normalizeWord(trimmed.split(/\s+/)[0]);
      if (word) WORD_SET.add(word);
    }
    console.log(`단어 로딩 완료: ${WORD_SET.size.toLocaleString()}개`);
  }

  const attackFile = findExistingFile(attackCandidates);
  if (!attackFile) {
    console.warn("WARNING: attack.txt를 찾을 수 없습니다.");
  } else {
    const text = fs.readFileSync(attackFile, "utf8");
    let currentDepth = null;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) { currentDepth = null; continue; }

      const depthMatch = trimmed.match(/^깊이\s+(\d+)/);
      if (depthMatch) {
        currentDepth = Number(depthMatch[1]);
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          const wordsPart = trimmed.slice(colonIdx + 1);
          for (const w of wordsPart.split(/[,，\s]+/)) {
            const nw = normalizeWord(w);
            if (nw && Number.isFinite(currentDepth)) {
              ATTACK_DEPTH[nw] = currentDepth;
            }
          }
        }
        continue;
      }
      if (trimmed.startsWith("[")) { currentDepth = null; continue; }
    }
    console.log(`공격 단어 로딩 완료: ${Object.keys(ATTACK_DEPTH).length.toLocaleString()}개`);
  }

  WORD_INDEX.clear();
  for (const word of WORD_SET) {
    const first = word.at(0);
    if (!first) continue;
    if (!WORD_INDEX.has(first)) WORD_INDEX.set(first, []);
    WORD_INDEX.get(first).push(word);
  }
  console.log(`단어 인덱스 생성 완료: ${WORD_INDEX.size}개 시작 글자`);

  return { WORD_SET, ATTACK_DEPTH, WORD_INDEX };
}

/* =========================================================
   단어 검색
========================================================= */

function hasWord(word, WORD_SET) {
  return WORD_SET.has(normalizeWord(word));
}

function getAttackDepth(word, ATTACK_DEPTH) {
  word = normalizeWord(word);
  if (!word) return null;
  const depth = ATTACK_DEPTH[word];
  return Number.isFinite(depth) ? depth : null;
}

function isAttackWord(word, ATTACK_DEPTH) {
  return getAttackDepth(word, ATTACK_DEPTH) !== null;
}

function getCandidates(previousWord, usedWords, WORD_INDEX) {
  previousWord = normalizeWord(previousWord);
  if (!previousWord) return [];

  const used = usedWords instanceof Set ? usedWords : new Set(usedWords || []);
  const result = [];
  const allowed = allowedFirstChars(previousWord.at(-1));

  for (const firstChar of allowed) {
    const bucket = WORD_INDEX.get(firstChar);
    if (!bucket) continue;
    for (const word of bucket) {
      if (!used.has(word)) result.push(word);
    }
  }
  return result;
}

function getStartCandidates(usedWords, WORD_SET) {
  const used = usedWords instanceof Set ? usedWords : new Set();
  const result = [];
  for (const word of WORD_SET) {
    if (used.has(word)) continue;
    result.push(word);
    if (result.length >= 5000) break;
  }
  return result;
}

function chooseStartWord(usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH) {
  const used = usedWords instanceof Set ? usedWords : new Set();
  const candidates = getStartCandidates(used, WORD_SET);

  if (candidates.length === 0) return null;

  const safe = [];
  for (const word of candidates) {
    const next = getCandidates(word, new Set([...used, word]), WORD_INDEX);
    if (next.length > 0 && !isAttackWord(word, ATTACK_DEPTH)) {
      safe.push(word);
    }
  }

  const pool = safe.length > 0 ? safe : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* =========================================================
   AI — 인간 수준 단일 AI
   
   항상 최적이지 않되, 공격 단어를 적절히 활용.
   깊이가 높은 공격 단어를 어느 정도 선호하되
   여러 후보 중에서 랜덤하게 선택.
========================================================= */

function scoreAIWord(word, currentWord, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH) {
  const next = getCandidates(word, new Set([...usedWords, word]), WORD_INDEX);
  const depth = getAttackDepth(word, ATTACK_DEPTH);

  let score = Math.random() * 15;

  if (depth !== null) {
    score += depth * 8;
  }

  if (next.length === 0) {
    score += 500;
  }

  if (next.length > 0) {
    score += Math.max(0, 50 - next.length) * 0.5;
  }

  score -= Math.min(next.length, 50) * 0.1;

  return score;
}

function chooseAIWord(currentWord, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH) {
  const candidates = getCandidates(currentWord, usedWords, WORD_INDEX);
  if (!candidates.length) return null;

  const sampleSize = Math.min(120, candidates.length);
  const shuffled = candidates.slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, sampleSize);

  const scored = shuffled.map(word => ({
    word,
    score: scoreAIWord(word, currentWord, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH)
  }));

  scored.sort((a, b) => b.score - a.score);

  const poolSize = Math.min(5, scored.length);
  const pool = scored.slice(0, poolSize);
  return pool[Math.floor(Math.random() * pool.length)].word;
}

/* =========================================================
   랭크 계산
========================================================= */

function calculateRank(rating) {
  if (rating >= 2200) return { tier: "Challenger", sub: "" };
  if (rating >= 2000) return { tier: "Grandmaster", sub: "" };
  if (rating >= 1800) return { tier: "Master", sub: "" };

  if (rating >= 1600) return { tier: "Diamond", sub: rating >= 1734 ? "I" : rating >= 1667 ? "II" : "III" };
  if (rating >= 1400) return { tier: "Platinum", sub: rating >= 1534 ? "I" : rating >= 1467 ? "II" : "III" };
  if (rating >= 1200) return { tier: "Gold", sub: rating >= 1334 ? "I" : rating >= 1267 ? "II" : "III" };
  if (rating >= 1000) return { tier: "Silver", sub: rating >= 1134 ? "I" : rating >= 1067 ? "II" : "III" };
  return { tier: "Bronze", sub: rating >= 934 ? "I" : rating >= 867 ? "II" : "III" };
}

function calculateElo(winnerRating, loserRating, K = 32) {
  const expectedW = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedL = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));
  const newWinnerRating = Math.round(winnerRating + K * (1 - expectedW));
  const newLoserRating = Math.round(loserRating + K * (0 - expectedL));
  return { newWinnerRating, newLoserRating };
}

module.exports = {
  DUEUM,
  normalizeWord,
  allowedFirstChars,
  canConnect,
  loadData,
  hasWord,
  getAttackDepth,
  isAttackWord,
  getCandidates,
  getStartCandidates,
  chooseStartWord,
  chooseAIWord,
  calculateRank,
  calculateElo
};
