"use strict";

/* =========================================================
   server/game.js — 끝말잇기 공통 게임 엔진
========================================================= */

const fs = require("fs");
const path = require("path");

/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
  "녀": ["녀", "여"], "년": ["년", "연"], "녕": ["녕", "영"],
  "녜": ["녜", "예"], "뇨": ["뇨", "요"], "뉴": ["뉴", "유"], "니": ["니", "이"],
  "랴": ["랴", "야"], "려": ["려", "여"], "례": ["례", "예"],
  "료": ["료", "요"], "류": ["류", "유"], "리": ["리", "이"],
  "라": ["라", "나"], "락": ["락", "낙"], "란": ["란", "난"],
  "랄": ["랄", "날"], "람": ["람", "남"], "랍": ["랍", "납"],
  "랏": ["랏", "낫"], "랑": ["랑", "낭"], "래": ["래", "내"], "랭": ["랭", "냉"],
  "략": ["략", "약"], "량": ["량", "양"], "련": ["련", "연"],
  "렬": ["렬", "열"], "령": ["령", "영"],
  "로": ["로", "노"], "록": ["록", "녹"], "론": ["론", "논"],
  "롤": ["롤", "놀"], "롬": ["롬", "놈"], "롭": ["롭", "놑"],
  "롯": ["롯", "놃"], "롱": ["롱", "농"], "뢰": ["뢰", "뇌"],
  "루": ["루", "누"], "륙": ["륙", "육"], "률": ["률", "율"],
  "륜": ["륜", "윤"], "륭": ["륭", "융"],
  "렁": ["렁", "엉"], "렴": ["렴", "염"]
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

   두 가지 레벨:
   1. 음절 단위: DUEUM 매핑 (리→이, 라→나 등)
   2. 받침 단위: 이전 글자의 받침에 따라 다음 초성 결정
      - ㄹ 받침 → 다음 초성: ㄹ, ㅇ
      - ㄴ 받침 → 다음 초성: ㄴ, ㄹ
      - ㅁ 받침 → 다음 초성: ㅇ
      - ㅂ 받침 → 다음 초성: ㅇ
      - ㅅ/ㅆ 받침 → 다음 초성: ㅅ/ㅆ, ㅇ
      - ㅈ/ㅊ 받침 → 다음 초성: ㅈ/ㅊ, ㅇ
      - ㄱ/ㅋ 받침 → 다음 초성: ㄱ/ㅋ, ㅇ
      - ㄷ/ㅌ 받침 → 다음 초성: ㄷ/ㅌ, ㅇ
      - ㅍ 받침 → 다음 초성: ㅇ
      - ㅎ 받침 → 다음 초성: ㅇ
========================================================= */

const JONGSUNG_ALLOWED_INITIALS = {
  "ㄹ": new Set(["ㄹ", "ㅇ"]),
  "ㄴ": new Set(["ㄴ", "ㄹ"]),
  "ㅁ": new Set(["ㅇ"]),
  "ㅂ": new Set(["ㅇ"]),
  "ㅅ": new Set(["ㅅ", "ㅇ"]),
  "ㅆ": new Set(["ㅆ", "ㅇ"]),
  "ㅈ": new Set(["ㅈ", "ㅇ"]),
  "ㅊ": new Set(["ㅊ", "ㅇ"]),
  "ㄱ": new Set(["ㄱ", "ㅇ"]),
  "ㄲ": new Set(["ㄲ", "ㅇ"]),
  "ㅋ": new Set(["ㅋ", "ㅇ"]),
  "ㄷ": new Set(["ㄷ", "ㅇ"]),
  "ㅌ": new Set(["ㅌ", "ㅇ"]),
  "ㅍ": new Set(["ㅍ", "ㅇ"]),
  "ㅎ": new Set(["ㅎ", "ㅇ"]),
};

function getJongsung(char) {
  if (!char || char.length !== 1) return null;
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;
  const jong = (code - 0xAC00) % 28;
  if (jong === 0) return null;
  const JONGSUNG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  return JONGSUNG[jong] || null;
}

function allowedFirstChars(lastChar) {
  lastChar = normalizeWord(lastChar);
  if (!lastChar) return [];
  const result = new Set();
  result.add(lastChar);

  const direct = DUEUM[lastChar];
  if (Array.isArray(direct)) for (const ch of direct) if (ch) result.add(ch);
  for (const [from, values] of Object.entries(DUEUM)) {
    if (Array.isArray(values) && values.includes(lastChar)) result.add(from);
  }

  return [...result];
}

/* =========================================================
   연결 판정
========================================================= */

function getInitialConsonant(char) {
  if (!char || char.length !== 1) return null;
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;
  const initial = Math.floor((code - 0xAC00) / 588);
  const INITIALS = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  return INITIALS[initial] || null;
}

function canConnect(previousWord, nextWord) {
  previousWord = normalizeWord(previousWord);
  nextWord = normalizeWord(nextWord);
  if (!previousWord || !nextWord) return false;
  const last = previousWord.at(-1);
  const first = nextWord.at(0);

  if (allowedFirstChars(last).includes(first)) return true;

  const jong = getJongsung(last);
  if (jong && JONGSUNG_ALLOWED_INITIALS[jong]) {
    const firstInit = getInitialConsonant(first);
    if (firstInit && JONGSUNG_ALLOWED_INITIALS[jong].has(firstInit)) return true;
  }

  return false;
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
  const ROOT_WORDS = new Set();
  const DEFENSE_WORDS = new Set();

  const wordFile = findExistingFile([
    path.join(dataDir, "word.txt"),
    path.join(rootDir, "word.txt")
  ]);
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

  const attackFile = findExistingFile([
    path.join(dataDir, "attack.txt"),
    path.join(rootDir, "attack.txt")
  ]);
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

  const rootFile = findExistingFile([
    path.join(dataDir, "끄글_주요 루트 단어_20260823005524.txt"),
  ]);
  if (rootFile) {
    const text = fs.readFileSync(rootFile, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const wordsPart = trimmed.slice(colonIdx + 1);
      for (const w of wordsPart.split(/[,，\s]+/)) {
        const nw = normalizeWord(w);
        if (nw) ROOT_WORDS.add(nw);
      }
    }
    console.log(`루트 단어 로딩 완료: ${ROOT_WORDS.size.toLocaleString()}개`);
  }

  const defenseFile = findExistingFile([
    path.join(dataDir, "끄글_방어 단어_20260823005525.txt"),
  ]);
  if (defenseFile) {
    const text = fs.readFileSync(defenseFile, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("[")) continue;
      const depthMatch = trimmed.match(/^깊이\s+(\d+)/);
      if (depthMatch) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          const wordsPart = trimmed.slice(colonIdx + 1);
          for (const w of wordsPart.split(/[,，]+/)) {
            const nw = normalizeWord(w);
            if (nw) DEFENSE_WORDS.add(nw);
          }
        }
        continue;
      }
      if (trimmed.startsWith("돌림")) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          const wordsPart = trimmed.slice(colonIdx + 1);
          for (const w of wordsPart.split(/[,，]+/)) {
            const nw = normalizeWord(w);
            if (nw) DEFENSE_WORDS.add(nw);
          }
        }
      }
    }
    console.log(`방어 단어 로딩 완료: ${DEFENSE_WORDS.size.toLocaleString()}개`);
  }

  WORD_INDEX.clear();
  for (const word of WORD_SET) {
    const first = word.at(0);
    if (!first) continue;
    if (!WORD_INDEX.has(first)) WORD_INDEX.set(first, []);
    WORD_INDEX.get(first).push(word);
  }

  const initialMap = new Map();
  for (const key of WORD_INDEX.keys()) {
    if (key.length !== 1) continue;
    const init = getInitialConsonant(key);
    if (!init) continue;
    if (!initialMap.has(init)) initialMap.set(init, []);
    initialMap.get(init).push(key);
  }
  WORD_INDEX._initialMap = initialMap;

  console.log(`단어 인덱스 생성 완료: ${WORD_INDEX.size}개 시작 글자`);

  return { WORD_SET, ATTACK_DEPTH, WORD_INDEX, ROOT_WORDS, DEFENSE_WORDS };
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
  const lastChar = previousWord.at(-1);
  const allowed = allowedFirstChars(lastChar);
  const existingSet = new Set();
  for (const firstChar of allowed) {
    const bucket = WORD_INDEX.get(firstChar);
    if (!bucket) continue;
    for (const word of bucket) {
      if (!used.has(word) && !existingSet.has(word)) {
        result.push(word);
        existingSet.add(word);
      }
    }
  }

  const jong = getJongsung(lastChar);
  if (jong && JONGSUNG_ALLOWED_INITIALS[jong]) {
    const allowedInits = JONGSUNG_ALLOWED_INITIALS[jong];
    let added = 0;
    const MAX_DUEUM_ADD = 200;
    for (const init of allowedInits) {
      const keys = WORD_INDEX._initialMap?.get(init);
      if (!keys) continue;
      for (const key of keys) {
        const bucket = WORD_INDEX.get(key);
        if (!bucket) continue;
        for (const word of bucket) {
          if (!used.has(word) && !existingSet.has(word)) {
            result.push(word);
            existingSet.add(word);
            added++;
            if (added >= MAX_DUEUM_ADD) break;
          }
        }
        if (added >= MAX_DUEUM_ADD) break;
      }
      if (added >= MAX_DUEUM_ADD) break;
    }
  }

  return result;
}

/* =========================================================
   한방단어 판별
   한방단어 = 상대가 이 단어를 낸 후 대응할 단어가 없는 경우
   (다음 후보가 0개인 단어)
========================================================= */

function isOneShot(word, usedWords, WORD_INDEX) {
  const ws = new Set(usedWords);
  ws.add(word);
  const next = getCandidates(word, ws, WORD_INDEX);
  return next.length === 0;
}

/* =========================================================
   안전한 시작 단어
   - 공격 단어가 아닌 것
   - 한방단어가 아닌 것 (상대가 대응할 수 있어야 함)
========================================================= */

function getStartCandidates(usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH) {
  const used = usedWords instanceof Set ? usedWords : new Set();
  const safeWords = [];
  for (const word of WORD_SET) {
    if (used.has(word)) continue;
    if (isAttackWord(word, ATTACK_DEPTH)) continue;
    safeWords.push(word);
  }
  const result = [];
  const TARGET = 5000;
  for (const word of safeWords) {
    if (isOneShot(word, new Set([word]), WORD_INDEX)) continue;
    result.push(word);
    if (result.length >= TARGET) break;
  }
  if (result.length === 0 && safeWords.length > 0) return safeWords.slice(0, 100);
  return result;
}

function chooseStartWord(usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH) {
  const candidates = getStartCandidates(usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH);
  if (candidates.length === 0) {
    for (const word of WORD_SET) {
      if (!usedWords.has(word)) return word;
    }
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* =========================================================
   AI — 최강 전략적 단어 선택

   절대 원칙:
   1. 즉시 승리(한방) → 무조건 사용
   2. 방어 단어 절대 사용 금지
   3. 공격 단어 즉시 사용 (깊이 낮을수록 강함)
   4. 루트/희귀 루트 단어 우선
   5. 상대 선택지 최소화
   6. 상대 역공 차단
   7. 절대 지지 않는 전략
========================================================= */

function chooseAIWord(currentWord, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, turnNumber, DEFENSE_WORDS) {
  const candidates = getCandidates(currentWord, usedWords, WORD_INDEX);
  if (!candidates.length) return null;

  const newUsed = new Set([...usedWords]);
  const defenseSet = DEFENSE_WORDS || new Set();

  let pool = candidates.filter(w => !defenseSet.has(w));
  if (pool.length === 0) pool = candidates;

  const immediateWins = [];
  const attackWords = [];
  const rootWords = [];

  for (const w of pool) {
    const next = getCandidates(w, newUsed, WORD_INDEX);
    if (next.length === 0) { immediateWins.push(w); continue; }
    const depth = ATTACK_DEPTH[w];
    if (Number.isFinite(depth)) attackWords.push({ w, depth, nextCount: next.length });
    if (ROOT_WORDS && ROOT_WORDS.has(w)) rootWords.push({ w, nextCount: next.length });
  }

  if (immediateWins.length > 0) {
    return immediateWins[Math.floor(Math.random() * immediateWins.length)];
  }

  if (attackWords.length > 0) {
    attackWords.sort((a, b) => a.depth - b.depth);
    const bestDepth = attackWords[0].depth;
    const topAttacks = attackWords.filter(a => a.depth <= bestDepth + 1);
    if (topAttacks.length > 3) {
      for (let i = topAttacks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [topAttacks[i], topAttacks[j]] = [topAttacks[j], topAttacks[i]];
      }
    }
    return topAttacks[Math.floor(Math.random() * Math.min(3, topAttacks.length))].w;
  }

  const EVAL_POOL_MAX = 150;
  let evalPool = pool;
  if (pool.length > EVAL_POOL_MAX) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    evalPool = shuffled.slice(0, EVAL_POOL_MAX);
  }

  let bestScore = -Infinity;
  let allScored = [];

  for (const w of evalPool) {
    const nextUsed = new Set(newUsed);
    nextUsed.add(w);
    const nextCandidates = getCandidates(w, nextUsed, WORD_INDEX);
    const nextCount = nextCandidates.length;

    if (nextCount === 0) {
      allScored.push({ w, score: 10000 });
      continue;
    }

    let score = 0;

    const depth = ATTACK_DEPTH[w];
    const isAttack = Number.isFinite(depth);
    if (isAttack) {
      score += (20 - depth) * 30;
    }

    if (ROOT_WORDS && ROOT_WORDS.has(w)) {
      score += 50;
    }

    if (nextCount <= 2) score += 40;
    else if (nextCount <= 5) score += 25;
    else if (nextCount <= 10) score += 15;
    else if (nextCount <= 20) score += 5;
    else score -= Math.min(nextCount, 50) * 0.3;

    const OPP_EVAL_MAX = Math.min(15, nextCandidates.length);
    const oppSample = nextCandidates.length > OPP_EVAL_MAX
      ? nextCandidates.slice(0, OPP_EVAL_MAX)
      : nextCandidates;

    let opponentEndGame = 0;
    let opponentStrongAttack = 0;
    let opponentWeakMoves = 0;

    for (const oppWord of oppSample) {
      const oppUsed = new Set(nextUsed);
      oppUsed.add(oppWord);
      const oppNext = getCandidates(oppWord, oppUsed, WORD_INDEX);

      if (oppNext.length === 0) { opponentEndGame++; score -= 80; continue; }

      const oppDepth = ATTACK_DEPTH[oppWord];
      if (Number.isFinite(oppDepth) && oppDepth <= 3) {
        opponentStrongAttack++;
        score -= (20 - oppDepth) * 8;
      }

      if (oppNext.length >= 10) opponentWeakMoves++;
      if (oppNext.length === 1) score -= 20;
    }

    score += opponentWeakMoves * 5;

    if (rootWords.some(r => r.w === w)) score += 10;

    score += Math.random() * 5;

    allScored.push({ w, score });
  }

  allScored.sort((a, b) => b.score - a.score);

  if (allScored.length === 0) {
    const fallback = pool[Math.floor(Math.random() * pool.length)];
    return canConnect(currentWord, fallback) ? fallback : pool.find(w => canConnect(currentWord, w)) || null;
  }

  const topN = Math.min(5, allScored.length);
  const topCandidates = allScored.slice(0, topN).map(x => x.w);
  const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)];
  if (canConnect(currentWord, chosen)) return chosen;
  return pool.find(w => canConnect(currentWord, w)) || chosen;
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
  return {
    newWinnerRating: Math.round(winnerRating + K * (1 - expectedW)),
    newLoserRating: Math.round(loserRating + K * (0 - expectedL))
  };
}

module.exports = {
  DUEUM, normalizeWord, allowedFirstChars, canConnect,
  loadData, hasWord, getAttackDepth, isAttackWord,
  getCandidates, isOneShot, getStartCandidates, chooseStartWord,
  chooseAIWord, calculateRank, calculateElo
};
