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
  "러": ["러", "너"], "럭": ["럭", "넉"], "런": ["런", "넌"],
  "럴": ["럴", "널"], "럽": ["럽", "넙"],
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
  "렁": ["렁", "엉"], "렴": ["렴", "염"],
  "녓": ["녓", "엿"], "엿": ["엿", "녓"],
  "닢": ["닢", "잎"], "잎": ["잎", "닢"]
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

  const rareRootFile = findExistingFile([
    path.join(dataDir, "끄글_희귀 루트 단어_20260823005524.txt"),
  ]);
  if (rareRootFile) {
    const text = fs.readFileSync(rareRootFile, "utf8");
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
    console.log(`희귀 루트 단어 로딩 완료: ${ROOT_WORDS.size.toLocaleString()}개 (누적)`);
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
   AI — 첫 턴(턴 0) 시작 단어 선택
   - 반드시 주어진 시작 음절로 시작
   - 공격 단어/한방 단어/이미 사용한 단어 배제
   - 방어 단어는 지지 않기 위한 수이므로 첫 수로 쓰지 않는다
   - 우선순위:
     1. 루트/희귀 루트 단어 (상대가 받아치기 어려운 시작)
     2. 값 루트 단어 (~~값)
     3. 일반 단어 (희귀한 끝 음절 우선)
========================================================= */

function chooseAIStartWord(syllable, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, DEFENSE_WORDS, ROOT_WORDS) {
  const used = usedWords instanceof Set ? usedWords : new Set();
  const defenseSet = DEFENSE_WORDS || new Set();
  const rootSet = ROOT_WORDS || new Set();
  const syllableF = normalizeWord(syllable);
  if (!syllableF) return null;
  const legal = [];
  for (const w of getCandidates(syllableF, used, WORD_INDEX)) {
    if (!w.startsWith(syllableF)) continue;
    if (isAttackWord(w, ATTACK_DEPTH)) continue;
    if (isOneShot(w, used, WORD_INDEX)) continue;
    if (defenseSet.has(w)) continue;
    legal.push(w);
  }
  if (legal.length === 0) return null;

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  /* 루트 단어가 있다면 무조건 루트 먼저 — 희귀 루트일수록 좋다.
     희귀도 = 그 끝 음절로 이어지는 후보 수가 적을수록 상대가 응수하기 어렵다 */
  const roots = legal.filter(w => rootSet.has(normalizeWord(w)));
  if (roots.length > 0) {
    const countLast = w => {
      const bucket = WORD_INDEX.get(normalizeWord(w).at(-1));
      return bucket ? bucket.length : 9999;
    };
    roots.sort((a, b) => countLast(a) - countLast(b));
    return pick(roots.slice(0, Math.min(3, roots.length)));
  }

  /* 값 루트 (~~값) */
  const values = legal.filter(w => normalizeWord(w).endsWith("값"));
  if (values.length > 0) return pick(values);

  /* 일반 단어 — 끝 음절이 희귀할수록 상대 선택지가 좁아진다 */
  const byLast = new Map();
  for (const w of legal) {
    const last = normalizeWord(w).at(-1);
    if (!byLast.has(last)) byLast.set(last, []);
    byLast.get(last).push(w);
  }
  const rareLast = [...byLast.entries()].sort((a, b) => a[1].length - b[1].length)[0];
  if (rareLast) return pick(rareLast[1].slice(0, Math.min(3, rareLast[1].length)));
  return pick(legal);
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

  const EVAL_CAP = 80;
  const OPP_CAP = 12;
  const OPP_PLY_CAP = 4;

  const lastChar = normalizeWord(currentWord).at(-1);

  const SYLLABLE_RARITY = (() => {
    const count = new Map();
    for (const [ch] of WORD_INDEX) {
      const bucket = WORD_INDEX.get(ch);
      if (bucket) count.set(ch, bucket.length);
    }
    return count;
  })();

  let list = candidates.map(w => {
    const next = getCandidates(w, newUsed, WORD_INDEX);
    const depth = ATTACK_DEPTH[w];
    const lastSyl = w.at(-1);
    const rarityCount = SYLLABLE_RARITY.get(lastSyl) ?? 9999;
    return {
      w, nextCount: next.length, depth,
      isAttack: Number.isFinite(depth),
      isRoot: !!(ROOT_WORDS && ROOT_WORDS.has(w)),
      isDefense: !!defenseSet.has(w),
      isValue: w.endsWith("값"),
      lastSyl,
      rarityCount
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

  const oppScore = (info) => {
    let score = 0;
    if (info.isValue) score += 90;
    if (info.isRoot) score += 35;
    if (info.rarityCount <= 5) score += 20;
    else if (info.rarityCount <= 15) score += 10;

    score -= Math.min(info.nextCount, 15) * 2;
    const opp = getCandidates(info.w, newUsed, WORD_INDEX);
    const sample = opp.slice(0, OPP_CAP);
    for (const ow of sample) {
      const owUsed = new Set(newUsed);
      owUsed.add(info.w);
      const owNext = getCandidates(ow, owUsed, WORD_INDEX);
      if (owNext.length === 0) { score -= 110; continue; }
      if (Number.isFinite(ATTACK_DEPTH[ow]) && ATTACK_DEPTH[ow] <= 2) score -= 45;
      if (ROOT_WORDS && ROOT_WORDS.has(ow)) score -= 25;
      if (ow.endsWith("값")) score -= 30;
      const ply = owNext.slice(0, OPP_PLY_CAP);
      for (const o2 of ply) {
        const o2Used = new Set(owUsed);
        o2Used.add(o2);
        if (getCandidates(o2, o2Used, WORD_INDEX).length === 0) { score -= 120; break; }
      }
    }
    score += Math.random() * 8;
    return score;
  };

  const bestFrom = (group) => {
    if (!group.length) return null;
    const scored = capSample(group).map(i => ({ i, s: oppScore(i) }));
    scored.sort((a, b) => b.s - a.s);
    const topScore = scored[0].s;
    const top = scored.filter(x => x.s >= topScore - 12);
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

  /* 3. 값 루트 */
  const values = list.filter(i => i.isValue);
  if (values.length) return bestFrom(values);

  /* 4. 루트 단어 (방어 회피: 루트가 있으면 무조건 루트만 사용) */
  const roots = list.filter(i => i.isRoot);
  if (roots.length) {
    const chosen = bestFrom(roots);
    if (chosen) return chosen;
  }

  /* 4-2. 비방어 단어 중 희귀 끝 음절 우선 (방어 회피 강화) */
  const nonDefense = list.filter(i => !i.isDefense);
  if (nonDefense.length) return bestFrom(nonDefense);

  /* 5. 전부 방어 단어일 때만 최후 수단 */
  return bestFrom(list);
}

/* =========================================================
   랭크 계산
========================================================= */

function calculateRank(rating) {
  /* 5단계 등급 체계 — 숫자가 낮을수록 높은 등급 (브론즈5~브론즈1, 실버5~실버1, ...) */
  const tierTables = [
    { tier: "Bronze", base: 0, span: 1000 },
    { tier: "Silver", base: 1000, span: 400 },
    { tier: "Gold", base: 1400, span: 400 },
    { tier: "Platinum", base: 1800, span: 400 },
    { tier: "Diamond", base: 2200, span: 400 },
    { tier: "Master", base: 2600, span: 400 }
  ];
  if (rating >= 3000) return { tier: "Grandmaster", sub: "" };
  let tier = tierTables[tierTables.length - 1];
  for (const t of tierTables) {
    if (rating >= t.base) tier = t;
  }
  const step = Math.floor((rating - tier.base) / (tier.span / 5));
  const sub = 5 - Math.max(0, Math.min(4, step));
  return { tier: tier.tier, sub: String(sub) };
}

function calculateElo(winnerRating, loserRating, K = 32) {
  const expectedW = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedL = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));
  return {
    newWinnerRating: Math.round(winnerRating + K * (1 - expectedW)),
    newLoserRating: Math.round(loserRating + K * (0 - expectedL))
  };
}

/* =========================================================
   AI 현재 승률(이길 확률) 추정 — 현재 보드 상태 기반 대략적 추정
   - 한방(즉시 승리) 후보가 있는지
   - 공격/루트 후보 비율
   - 상대가 필중(즉시 승리)을 가질 위험
   - 누구 차례인지 반영
   말도 안 되는 값이 아닌 대략적인 퍼센트를 돌려준다
========================================================= */

function estimateAIVictoryProbability(currentWord, usedWords, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, isAITurn) {
  const candidates = getCandidates(currentWord, usedWords, WORD_INDEX);
  if (!candidates.length) {
    /* 후보 0 = 차례인 쪽 즉시 패배 */
    return isAITurn ? 10 : 90;
  }
  const used = new Set(usedWords);
  const SAMPLE = 30;
  const sample = candidates.slice(0, SAMPLE);
  const n = Math.max(1, sample.length);

  let aiOneShot = 0;      /* 내 수로 즉시 끝내는 단어 수 */
  let aiAttack = 0;       /* 내 공격 후보 수 */
  let aiRoot = 0;         /* 내 루트 후보 수 */
  let oppThreat = 0;      /* 상대가 즉시 한방을 낼 수 있는 위협 수 */
  let oppOptions = 0;

  for (const w of sample) {
    const nextUsed = new Set(used);
    nextUsed.add(w);
    const next = getCandidates(w, nextUsed, WORD_INDEX);
    if (next.length === 0) aiOneShot++;
    if (Number.isFinite(ATTACK_DEPTH[w])) aiAttack++;
    if (ROOT_WORDS && ROOT_WORDS.has(w)) aiRoot++;
    oppOptions += next.length;
    const oppSample = next.slice(0, 8);
    for (const ow of oppSample) {
      const nextUsed2 = new Set(nextUsed);
      nextUsed2.add(ow);
      if (getCandidates(ow, nextUsed2, WORD_INDEX).length === 0) oppThreat++;
    }
  }

  let p = 50;
  if (aiOneShot > 0) p += Math.min(15 + aiOneShot * 5, 35);
  p += Math.min(aiAttack / n, 0.6) * 12;
  p += Math.min(aiRoot / n, 0.35) * 8;
  p += Math.min(Math.max(0, 100 - candidates.length) / 100, 1) * 5;
  p -= Math.min(oppThreat / n, 0.5) * 20;
  p += Math.min(oppOptions / n / 100, 0.2) * 5;

  /* 내가 아닌 상대 차례면 간단히 대칭 보정 */
  if (!isAITurn) {
    const aiStrong = Math.min(1, (aiOneShot / n) + (aiAttack / n) * 0.5);
    p = p * 0.45 + (1 - aiStrong) * 50;
  }

  return Math.max(2, Math.min(98, Math.round(p)));
}

module.exports = {
  DUEUM, normalizeWord, allowedFirstChars, canConnect,
  loadData, hasWord, getAttackDepth, isAttackWord,
  getCandidates, isOneShot, getStartCandidates, chooseStartWord,
  chooseAIWord, chooseAIStartWord, calculateRank, calculateElo
};
