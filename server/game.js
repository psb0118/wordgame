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
  "룬": ["룬", "운"],
  "륜": ["륜", "윤"], "륭": ["륭", "융"],
  "르": ["르", "느"], "른": ["른", "는"],
  "릇": ["릇", "늣"], "룩": ["룩", "눅"], "룅": ["룅", "뇡"], "럿": ["럿", "엇", "넛"],
  "럼": ["럼", "엄", "넘"], "름": ["름", "늠"],
  "륨": ["륨", "늄", "윰"], "늉": ["늉", "융"],
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

   기본 규칙: 이전 단어의 마지막 음절과 동일한 음절로 시작해야 함.
   두음법칙에 따라 DUEUM 매핑된 음절(리→이, 락→낙, 라→나 등)도 허용.
   (초성 기반의 임의 확장은 허용하지 않는다 — 락→라 같은 잘못된 연결 차단)
========================================================= */

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
   절대 원칙 (우선순위):
   1. 즉시 승리(한방) → 무조건 사용
   2. 공격 단어로 받아칠 수 있으면 무조건 공격 단어 (깊이 낮을수록 강함)
   3. 값으로 끝나는 루트 단어(값표, 표준값, ~~값) → 상대가 받아치기 힘든 승리 루트
   4. 공격 단어가 없으면 루트/희귀 루트 단어 사용
   5. 그마저 없으면 일반(비방어) 단어 중 상대 선택지를 최소화
   6. 모든 후보가 방어 단어일 때만 마지막 수단으로 사용
   - 방어 단어는 지지 않기 위해 평소엔 절대 쓰지 않는다
   - 상대에게 즉시 승리(한방)를 주는 단어는 회피
   - 상대가 이 단어를 받아친 뒤에도 AI가 이길 수 있는지 2수 먼저 내다본다
========================================================= */

function chooseAIWord(currentWord, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, turnNumber, DEFENSE_WORDS) {
  const candidates = getCandidates(currentWord, usedWords, WORD_INDEX);
  if (!candidates.length) return null;

  const newUsed = new Set([...usedWords]);
  const defenseSet = DEFENSE_WORDS || new Set();

  /* 2수 평가 비용 제한용 샘플 크기 */
  const EVAL_CAP = 60;
  const OPP_CAP = 10;
  const OPP_PLY_CAP = 4;

  let list = candidates.map(w => {
    const next = getCandidates(w, newUsed, WORD_INDEX);
    const depth = ATTACK_DEPTH[w];
    return {
      w, nextCount: next.length, depth,
      isAttack: Number.isFinite(depth),
      isRoot: !!(ROOT_WORDS && ROOT_WORDS.has(w)),
      isDefense: !!defenseSet.has(w),
      isValue: w.endsWith("값")
    };
  });

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const capSample = (arr) => {
    if (arr.length <= EVAL_CAP) return arr;
    const pool = [...arr];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, EVAL_CAP);
  };

  /* 상대 입장 평가: 이 단어를 맞은 뒤 상대가 쓸 수 있는 옵션/역공 점검.
     상대가 곧바로 한방을 내는지(1수), 그 한방을 받아칠 수 없는지(2수)까지 본다. */
  const oppScore = (info) => {
    let score = 0;
    if (info.isValue) score += 90;                /* 값 루트 강력 우선 */
    score -= info.nextCount * 2;                  /* 상대 선택지 적을수록 좋음 */
    const opp = getCandidates(info.w, newUsed, WORD_INDEX);
    const sample = opp.slice(0, OPP_CAP);
    for (const ow of sample) {
      const owUsed = new Set(newUsed);
      owUsed.add(info.w);
      const owNext = getCandidates(ow, owUsed, WORD_INDEX);
      if (owNext.length === 0) { score -= 110; continue; }  /* 상대 즉시 승리 금지 */
      if (Number.isFinite(ATTACK_DEPTH[ow]) && ATTACK_DEPTH[ow] <= 2) score -= 45;
      if (ROOT_WORDS && ROOT_WORDS.has(ow)) score -= 25;
      if (ow.endsWith("값")) score -= 30;
      /* 2수: 상대의 답 중 AI가 받아칠 수 없는 한방이 있으면 크게 감점 */
      const ply = owNext.slice(0, OPP_PLY_CAP);
      for (const o2 of ply) {
        const o2Used = new Set(owUsed);
        o2Used.add(o2);
        if (getCandidates(o2, o2Used, WORD_INDEX).length === 0) { score -= 120; break; }
      }
    }
    score += Math.random() * 5;
    return score;
  };

  const bestFrom = (group) => {
    const scored = capSample(group).map(i => ({ i, s: oppScore(i) }));
    scored.sort((a, b) => b.s - a.s);
    const topScore = scored[0].s;
    const top = scored.filter(x => x.s >= topScore - 5);
    return pick(top).i.w;
  };

  /* 1. 즉시 승리 */
  const wins = list.filter(i => i.nextCount === 0);
  if (wins.length) return pick(wins).w;

  /* 2. 공격 단어 — 깊이 최저만 사용 */
  const attacks = list.filter(i => i.isAttack);
  if (attacks.length) {
    const minDepth = Math.min(...attacks.map(i => i.depth));
    return bestFrom(attacks.filter(i => i.depth === minDepth));
  }

  /* 3. 값 루트 — ~~값/값표/표준값. 받아치기 어려운 강력한 수 */
  const values = list.filter(i => i.isValue);
  if (values.length) return bestFrom(values);

  /* 4. 루트/희귀 루트 단어 */
  const roots = list.filter(i => i.isRoot);
  if (roots.length) return bestFrom(roots);

  /* 5. 일반(비방어) 단어 — 지지 않는 최선 */
  const normals = list.filter(i => !i.isDefense);
  if (normals.length) return bestFrom(normals);

  /* 6. 전부 방어 단어일 때만 최후 수단 */
  return bestFrom(list);
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
