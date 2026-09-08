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
========================================================= */

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
            const nw = normalizeWord(w.split(/\s+/)[0]);
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
            const nw = normalizeWord(w.split(/\s+/)[0]);
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

/* =========================================================
   한방단어 판별
   한방단어 = 상대가 이 단어를 낸 후 대응할 단어가 없는 경우
   (다음 후보가 0개인 단어)
========================================================= */

function isOneShot(word, usedWords, WORD_INDEX) {
  const next = getCandidates(word, new Set([...usedWords, word]), WORD_INDEX);
  return next.length === 0;
}

/* =========================================================
   안전한 시작 단어
   - 공격 단어가 아닌 것
   - 한방단어가 아닌 것 (상대가 대응할 수 있어야 함)
========================================================= */

function getStartCandidates(usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH) {
  const used = usedWords instanceof Set ? usedWords : new Set();
  const result = [];
  for (const word of WORD_SET) {
    if (used.has(word)) continue;
    if (isAttackWord(word, ATTACK_DEPTH)) continue;
    if (isOneShot(word, new Set([word]), WORD_INDEX)) continue;
    result.push(word);
    if (result.length >= 5000) break;
  }
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
   AI — 전략적 단어 선택

   원칙:
   1. 즉시 승리(한방) 단어 → 무조건 사용
   2. 방어 단어(지는 단어) 절대 사용 금지
   3. 3턴 이내: 공격 단어 사용 금지, 안전한 단어만 사용
   4. 3턴 이후: 공격 단어 우선 사용
   5. 루트 단어 우선 (안전한 루프 구간)
   6. 상대 선택지 최소화
   7. 상대 역공 방어
========================================================= */

function chooseAIWord(currentWord, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, turnNumber, DEFENSE_WORDS) {
  const candidates = getCandidates(currentWord, usedWords, WORD_INDEX);
  if (!candidates.length) return null;

  const newUsed = new Set([...usedWords]);
  const defenseSet = DEFENSE_WORDS || new Set();

  let pool = candidates.filter(w => !defenseSet.has(w));
  if (pool.length === 0) pool = candidates;

  if (turnNumber < 3) {
    const noAttack = pool.filter(w => !isAttackWord(w, ATTACK_DEPTH));
    if (noAttack.length > 0) pool = noAttack;
    const noOneshot = pool.filter(w => !isOneShot(w, new Set([...newUsed, w]), WORD_INDEX));
    if (noOneshot.length > 0) pool = noOneshot;
  }

  for (const w of pool) {
    const next = getCandidates(w, new Set([...newUsed, w]), WORD_INDEX);
    if (next.length === 0) return w;
  }

  let bestScore = -Infinity;
  let bestWords = [];

  for (const w of pool) {
    const nextUsed = new Set([...newUsed, w]);
    const nextCandidates = getCandidates(w, nextUsed, WORD_INDEX);
    const nextCount = nextCandidates.length;
    if (nextCount === 0) return w;

    let score = 0;

    const depth = ATTACK_DEPTH[w];
    const isAttack = Number.isFinite(depth);

    if (isAttack) {
      if (turnNumber >= 3) {
        score += (20 - depth) * 15;
      } else {
        score += (20 - depth) * 2;
      }
    }

    if (ROOT_WORDS && ROOT_WORDS.has(w)) {
      score += 10;
    }

    score -= nextCount * 2;

    let worstOpponentOptions = 0;
    let bestOpponentAttackDepth = Infinity;
    let opponentOneShotCount = 0;
    let opponentDefenseCount = 0;

    for (const oppWord of nextCandidates) {
      const oppUsed = new Set([...nextUsed, oppWord]);
      const oppNext = getCandidates(oppWord, oppUsed, WORD_INDEX);
      const oppNextCount = oppNext.length;

      if (oppNextCount === 0) {
        worstOpponentOptions += 100;
        continue;
      }

      if (oppNextCount === 1) opponentOneShotCount++;

      if (defenseSet.has(oppWord)) opponentDefenseCount++;

      worstOpponentOptions += oppNextCount;

      const oppDepth = ATTACK_DEPTH[oppWord];
      if (Number.isFinite(oppDepth) && oppDepth < bestOpponentAttackDepth) {
        bestOpponentAttackDepth = oppDepth;
      }
    }

    score -= worstOpponentOptions * 1.5;

    if (Number.isFinite(bestOpponentAttackDepth)) {
      score -= (20 - bestOpponentAttackDepth) * 4;
    }

    score -= opponentOneShotCount * 8;

    score += opponentDefenseCount * 6;

    const lastChar = w.at(-1);
    if (lastChar) {
      const loopCandidates = WORD_INDEX.get(lastChar);
      if (loopCandidates) {
        for (const lw of loopCandidates) {
          if (normalizeWord(lw) === w.split("").reverse().join("")) {
            score += 12;
            break;
          }
        }
      }
    }

    if (nextCount <= 2) score += 15;
    else if (nextCount <= 5) score += 8;
    else if (nextCount <= 10) score += 3;

    score += Math.random() * 2;

    if (score > bestScore) {
      bestScore = score;
      bestWords = [w];
    } else if (score === bestScore) {
      bestWords.push(w);
    }
  }

  return bestWords[Math.floor(Math.random() * bestWords.length)];
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
