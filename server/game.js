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
  "력": ["력", "역"], "역": ["역", "력"],
  "러": ["러", "너"], "럭": ["럭", "넉"], "런": ["런", "넌"],
"럴": ["럴", "널"], "럽": ["럽", "넙"],
  "레": ["레", "네", "에"],
  "로": ["로", "노"], "록": ["록", "녹"], "론": ["론", "논"],
  "롤": ["롤", "놀"], "롬": ["롬", "놈"], "롭": ["롭", "놑", "놉"],
  "롯": ["롯", "놃"], "롱": ["롱", "농"], "뢰": ["뢰", "뇌"],
  "루": ["루", "누"], "륙": ["륙", "육"], "률": ["률", "율"],
  "룬": ["룬", "운"],
  "륜": ["륜", "윤"], "륭": ["륭", "융"],
  "르": ["르", "느"], "른": ["른", "는"],
  "릇": ["릇", "늣"], "룩": ["룩", "눅"], "룅": ["룅", "뇡"], "럿": ["럿", "엇", "넛"],
  "럼": ["럼", "엄", "넘"], "름": ["름", "늠"],
  "륨": ["륨", "늄", "윰"], "늉": ["늉", "융"],
  "늄": ["늄", "윰"], "윰": ["윰", "늄"],
  "렁": ["렁", "엉"], "렴": ["렴", "염"],
  "렷": ["렷", "엿", "녓"],
  "녓": ["녓", "엿"], "엿": ["엿", "녓"],
  "릊": ["릊", "늦", "읒"], "늦": ["늦", "릊", "읒"], "읒": ["읒", "릊", "늦"],
  "릅": ["릅", "늡"], "늡": ["늡", "릅"],
  "닢": ["닢", "잎"], "잎": ["잎", "닢"],
  "놉": ["놉", "롭"],
  "름": ["름", "늠", "음"], "늠": ["늠", "름", "음"], "음": ["음", "름", "늠"],
  "뤠": ["뤠", "눼", "웨"], "눼": ["눼", "뤠", "웨"], "웨": ["웨", "뤠", "눼"]
};

/* =========================================================
   자동 두음법칙 확장

   위 DUEUM 외에도 모든 음절에 대해 두음법칙 변형(초성 문자 교체)을
   적용해 연결 허용 글자를 자동 생성한다. 받침(종성)은 그대로 둔다.

   - 초성 ㄹ : 두음법칙 → ㄴ (라→나, 룹→눕, 랓→낯…)
   - 초성 ㄹ : 이/야/여/예/요/유 앞 → ㅇ (리→이, 릿→잇, 류→유…)
   - 초성 ㄴ : 이/야/여/예/요/유 앞 → ㅇ (니→이, 녀→여…)
   역방향(눕→룹, 잇→릿)도 같은 표로 함께 허용된다.
========================================================= */

const Y_GLIDE_MOS = new Set([2, 3, 6, 7, 12, 17, 20]);

function buildDueumAuto() {
  const map = new Map();
  for (let m = 0; m < 21; m++) {
    const yg = Y_GLIDE_MOS.has(m);
    for (let j = 0; j < 28; j++) {
      for (let cho = 0; cho < 19; cho++) {
        const base = 0xAC00 + (cho * 21 + m) * 28 + j;
        const c = String.fromCharCode(base);
        /* 냐·냑은 두음법칙을 적용하지 않는다 — 냐(ㄴ+ㅑ), 냑(ㄴ+ㅑㄱ)는 그대로 쓰고
           야/랴, 약/략과 섞지 않는다 */
        if (c === "냐" || c === "냑") continue;
        /* 두음법칙 변형 초성 후보 — 종성은 그대로 */
        let partners = [];
        if (cho === 5) partners = yg ? [11] : [2];          /* ㄹ */
        else if (cho === 2) partners = yg ? [11, 5] : [5];  /* ㄴ */
        else if (cho === 11) partners = yg ? [5, 2] : [];   /* ㅇ */
        for (const pcho of partners) {
          const p = String.fromCharCode(0xAC00 + (pcho * 21 + m) * 28 + j);
          if (p === c || p === "냐" || p === "냑") continue;
          if (!map.has(c)) map.set(c, new Set());
          map.get(c).add(p);
          if (!map.has(p)) map.set(p, new Set());
          map.get(p).add(c);
        }
      }
    }
  }
  return map;
}

const AUTO_DUEUM = buildDueumAuto();

/* 자동 확장 중 과허용 케이스 정리 — 잎(ㅇ+ㅣ+ㅂ)은 닢(ㄴ+ㅣ+ㅂ)과만 연결하고,
   자동 역방향으로 섞인 맆(ㄹ+ㅣ+ㅂ)과는 연결하지 않는다 */
AUTO_DUEUM.get("잎")?.delete("맆");
AUTO_DUEUM.get("맆")?.delete("잎");

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

  const auto = AUTO_DUEUM.get(lastChar);
  if (auto) for (const ch of auto) result.add(ch);

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
  const RARE_ROOT_WORDS = new Set();
  const DEFENSE_WORDS = new Set();
  const DOLRIM_WORDS = new Set();

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
        if (nw) RARE_ROOT_WORDS.add(nw);
      }
    }
    console.log(`희귀 루트 단어 로딩 완료: ${RARE_ROOT_WORDS.size.toLocaleString()}개`);
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

  /* 돌림 단어 — 끝 음절로 되돌아와 순환시키는 회전 단어. AI가 유리할 때 활용하도록
     전용 셋으로 로드한다. 라인 형식: `단어A, 단어B` (양쪽 모두 돌림 단어) */
  const dolrimFile = findExistingFile([
    path.join(dataDir, "끄글_돌림 단어_20260823005523.txt"),
  ]);
  if (dolrimFile) {
    const text = fs.readFileSync(dolrimFile, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      for (const part of trimmed.split(",")) {
        const nw = normalizeWord(part);
        if (nw) DOLRIM_WORDS.add(nw);
      }
    }
    console.log(`돌림 단어 로딩 완료: ${DOLRIM_WORDS.size.toLocaleString()}개`);
  }

  WORD_INDEX.clear();
  for (const word of WORD_SET) {
    const first = word.at(0);
    if (!first) continue;
    if (!WORD_INDEX.has(first)) WORD_INDEX.set(first, []);
    WORD_INDEX.get(first).push(word);
  }

  console.log(`단어 인덱스 생성 완료: ${WORD_INDEX.size}개 시작 글자`);

  return { WORD_SET, ATTACK_DEPTH, WORD_INDEX, ROOT_WORDS, RARE_ROOT_WORDS, DEFENSE_WORDS, DOLRIM_WORDS };
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

let _syllableRarityCache = null;
function syllableRarity(WORD_INDEX) {
  if (!_syllableRarityCache) {
    const count = new Map();
    for (const [ch] of WORD_INDEX) {
      const bucket = WORD_INDEX.get(ch);
      if (bucket) count.set(ch, bucket.length);
    }
    _syllableRarityCache = count;
  }
  return _syllableRarityCache;
}

function getCandidates(previousWord, usedWords, WORD_INDEX, limit) {
  previousWord = normalizeWord(previousWord);
  if (!previousWord) return [];
  const used = usedWords instanceof Set ? usedWords : new Set(usedWords || []);
  const result = [];
  const lastChar = previousWord.at(-1);
  const allowed = allowedFirstChars(lastChar);
  /* 각 허용 글자는 서로 다른 버킷 → 단어 중복 없음 (existingSet 불필요) */
  for (const firstChar of allowed) {
    const bucket = WORD_INDEX.get(firstChar);
    if (!bucket) continue;
    for (const word of bucket) {
      if (!used.has(word)) {
        result.push(word);
        if (limit > 0 && result.length >= limit) return result;
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
  /* 후보 16개로 조기 중단 — 다음 후보 존재 여부(0/1+)는 정확하게 보존 */
  const next = getCandidates(word, ws, WORD_INDEX, 16);
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
   - 공격 단어/한방 단어/이미 사용한 단어/방어 단어 배제
   - 시작 단어 = 상대 대응지(끝 음절 버킷)가 좁은 수 우선 — 켄(자르브뤼켄 등)·꾼류의
     좁은 끝밭침 오프닝으로 상대를 골목으로 몰아 넣는다. 같은 좁음 안에서는
     희귀루트 > 루트 > 돌림 > 일반 순서로 무작위 다양하게
   - 어떤 경우에도 방어 단어는 시작으로 절대 두지 않는다
========================================================= */

function chooseAIStartWord(syllable, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, DEFENSE_WORDS, ROOT_WORDS, RARE_ROOT_WORDS, DOLRIM_WORDS) {
  const used = usedWords instanceof Set ? usedWords : new Set();
  const defenseSet = DEFENSE_WORDS || new Set();
  const rootSet = ROOT_WORDS || new Set();
  const rareRootSet = RARE_ROOT_WORDS || new Set();
  const dolrimSet = DOLRIM_WORDS || new Set();
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

  /* 시작 단어 = "상대 대응지(내 끝 음절 버킷)가 가장 좁은 수"를 우선.
     켄(자르브뤼켄·마우어하켄·시클로헥사데켄·나주켄)이나 꾼처럼 남은 버킷이 좁은
     오프닝이면 상대를 골목으로 몰아 넣을 수 있다. 같은 좁은-끝음절 안에서는
     희귀루트 > 루트 > 돌림 > 일반 순으로 우선하되 무작위로 다양하게 고른다 */
  const tierOf = (nw) => rareRootSet.has(nw) ? 4 : rootSet.has(nw) ? 3 : dolrimSet.has(nw) ? 2 : 1;

  /* 끝 음절의 실제 상대 대응 수 — 두음법칙 확장(리→이 등)까지 포함해
     "상대가 이 수를 받은 뒤 답할 수 있는 후보"를 센다 */
  const endSizes = new Map();
  for (const [ch, bucket] of WORD_INDEX) endSizes.set(ch, bucket.length);
  const replyPoolOf = (endChar) => {
    let n = 0;
    for (const fc of allowedFirstChars(endChar)) n += endSizes.get(fc) || 0;
    return n;
  };

  const ranked = legal.map(w => {
    const nw = normalizeWord(w);
    /* 켄 계열(자르브뤼켄·마우어하켄·시클로헥사데켄·나주켄 등)은 상대 대응 버킷이
       좁아 골목으로 몰아넣기에 유리해 가산 -25 */
    const bias = nw.endsWith("켄") ? 25 : 0;
    return { w, nw, endBucket: replyPoolOf(nw.at(-1)) - bias, tier: tierOf(nw) };
  });
  ranked.sort((a, b) => a.endBucket - b.endBucket || b.tier - a.tier);
  return pick(ranked.slice(0, Math.min(5, ranked.length))).w;
}

/* =========================================================
   강제 승리/패배 탐색 — 제한 깊이 네가맥스
   solveWin(word, usedSet, depth, budget, WORD_INDEX, cap):
   - word를 방금 두어 차례가 넘어온 상태에서, "이제 움직일 쪽"이
     정확한 수뒤놓기로 이길 수 있는지(-1=움직일 쪽 패배, 1=움직일 쪽 승리, 0=증명 불가) 판정
   - 가지가 너무 넓거나 깊이 예산을 넘으면 0(증명 불가) — 빠르게 포기
   - 공유 used Set을 add/delete로 재활용해 검색 속도를 확보
   - AI가 수를 고를 때:
       * 후보 w를 두고 상대 차례로 solveWin(w) = -1 → AI 강제 승리 수
       * 후보 w를 두고 상대 차례로 solveWin(w) =  1 → AI가 지는(=상대가 이기는) 수
     꾼처럼 2개뿐인 좁은 말밭에서는 상대의 응수가 1개뿐이므로 증명이 쉽게
     열리고, AI는 그런 "확정 패배" 라인을 능동적으로 피하게 된다
========================================================= */

const WIN_NODE_CAP = 12000;   /* 탐색 노드 예산 */
const WIN_MAX_DEPTH = 18;     /* 최대 수심(플라이) */
const WIN_BRANCH = 64;        /* 한 위치에서 고려할 최대 가지 수 */

/* AI 난이도(어려움) 대비 더 넓게/깊게 탐색하기 위한 가변 파라미터 —
   chooseAIWord가 강모드 진입 시 임시로 조정하고 항상 원복한다 */
let _winBranch = WIN_BRANCH;
let _winDepth = WIN_MAX_DEPTH;

function solveWin(word, usedSet, depth, budget, WORD_INDEX) {
  if (depth > _winDepth) return 0;
  if (--budget.nodes < 0) return 0;
  const moves = getCandidates(word, usedSet, WORD_INDEX);
  if (moves.length === 0) return -1;             /* 움직일 쪽 수 없음 → 패배 */
  if (moves.length > _winBranch) return 0;       /* 가지가 넓어 증명 불가 */
  for (const m of moves) {
    usedSet.add(m);
    const r = solveWin(m, usedSet, depth + 1, budget, WORD_INDEX);
    usedSet.delete(m);
    if (r !== 1) return r === -1 ? 1 : 0;        /* -1 → 상대 차례 패배 = 내 승리, 0 → 불가 */
  }
  return -1;                                     /* 어느 수를 둬도 상대가 이김 → 패배 */
}

/* =========================================================
   AI — 최강 전략적 단어 선택
   절대 원칙 (우선순위):
   1. 방어 단어는 어떤 경우에도 절대 사용하지 않는다 (후보에서 제거, 전부 방어면 수를 내지 않음)
   2. 무조건 루트/희귀 루트 단어만 사용한다 (그 외 공격/일반/돌림 단어는 두지 않는다)
      단, 아래는 예외로 허용:
     a. 즉시 승리(한방) → 루트가 아니어도 무조건 사용
     b. 강제 승리 증명 → 상대가 지는 수(꾼·늬 같은 짧은 말밭)면 무조건 사용,
        상대가 이기는 것이 증명되는 수는 배제
     c. 값 루트(값표, 표준값, ~~값) → 받아치기 힘든 승리 루트
     d. 돌림 좁힘(펀넬) → 그 돌림 이후에 다시 루트/희귀 루트 단어로
        이어질 수 있을 때만 사용 (틀라솔테오틀 → 틀가락 → 낙타사슴 → … → 접꾼)
   - 루트/희귀 루트가 하나도 없으면 수를 내지 않는다(= 패배)
   - 상대에게 즉시 승리(한방)를 주는 단어는 회피
   - 상대가 이 단어를 받아친 뒤에도 AI가 이길 수 있는지 여러 수 먼저 내다본다
========================================================= */

function chooseAIWord(currentWord, usedWords, WORD_SET, WORD_INDEX, ATTACK_DEPTH, ROOT_WORDS, turnNumber, DEFENSE_WORDS, RARE_ROOT_WORDS, DOLRIM_WORDS, opts) {
  const candidates = getCandidates(currentWord, usedWords, WORD_INDEX);
  if (!candidates.length) return null;

  /* 난이도 — strong(어려움): 강제 승리를 더 넓게/깊게 탐색하고 최선에 가깝게 고름 */
  const strong = !!(opts && opts.strong);

  const newUsed = new Set([...usedWords]);
  const defenseSet = DEFENSE_WORDS || new Set();
  const rareRootSet = RARE_ROOT_WORDS || new Set();
  const dolrimSet = DOLRIM_WORDS || new Set();

  const EVAL_CAP = 220;
  const OPP_CAP = 14;
  const OPP_PLY_CAP = 4;

  const lastChar = normalizeWord(currentWord).at(-1);

  const SYLLABLE_RARITY = syllableRarity(WORD_INDEX);

  let list = candidates.map(w => {
    /* nextCount 16개까지만 조기 중단 계산 —
       min(count,15) 점수와 '후보 0 = 한방' 판정은 그대로 정확 (16 < 15+1 보장) */
    const nextCount = getCandidates(w, newUsed, WORD_INDEX, 16).length;
    const depth = ATTACK_DEPTH[w];
    const lastSyl = w.at(-1);
    const rarityCount = SYLLABLE_RARITY.get(lastSyl) ?? 9999;
    return {
      w, nextCount, depth,
      isAttack: Number.isFinite(depth),
      isRoot: !!(ROOT_WORDS && ROOT_WORDS.has(w)),
      isRareRoot: !!rareRootSet.has(w),
      isDefense: !!defenseSet.has(w),
      isDolrim: !!dolrimSet.has(w),
      isValue: w.endsWith("값"),
      lastSyl,
      rarityCount
    };
  });

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  /* 0. 방어 단어 절대 배제 — 어떤 경우에도 방어 단어로 받아치지 않는다.
     전부 방어 단어뿐이면 수를 내지 않는다(= 패배). */
  list = list.filter(i => !i.isDefense);
  if (!list.length) return null;

  const capSample = (arr) => {
    if (arr.length <= EVAL_CAP) return arr;
    const pool = [...arr];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, EVAL_CAP);
  };

  /* 돌림 좁힘(펀넬) 점수 — 돌림 단어(예: 틀라솔테오틀)는 상대를 내 끝 음절 말밭으로
     되돌려 상대의 선택 폭을 그 버킷 안으로 단단히 묶는다. 버킷(남은 대응 풀)이 좁을수록
     상대를 골목(꾼 등)으로 몰아넣기 유리해 점수가 높다. 판정은 두음법칙 확장을 포함한
     실제 대응 수로 센다 */
  const funnelCache = new Map();
  const funnelOf = (info) => {
    if (!info.isDolrim) return 0;
    if (funnelCache.has(info.w)) return funnelCache.get(info.w);
    let score = 0;
    const oppPool = getCandidates(info.w, newUsed, WORD_INDEX, 1000);
    if (oppPool.length === 0) { funnelCache.set(info.w, 0); return 0; }
    let P = 0;
    for (const fc of allowedFirstChars(info.w.at(-1))) P += (WORD_INDEX.get(fc) || []).length;
    const eff = Math.max(1, Math.min(P, oppPool.length));
    if (eff <= 60) score = 90;
    else if (eff <= 95) score = 80;
    else if (eff <= 130) score = 65;
    else if (eff <= 180) score = 45;
    /* 그 말밭의 후보들이 대부분 '좁은 끝음절로 끝나는 수'라면 좁힘이 더 확실하다 */
    let narrow = 0;
    for (const ow of oppPool) {
      let rp = 0;
      for (const fc of allowedFirstChars(ow.at(-1))) rp += (WORD_INDEX.get(fc) || []).length;
      if (rp <= 40) narrow++;
    }
    if (narrow / oppPool.length >= 0.7) score = Math.min(110, score + 20);
    funnelCache.set(info.w, score);
    return score;
  };

  const oppScore = (info) => {
    let score = 0;
    if (info.isValue) score += 90;
    if (info.isRoot) score += 35;
    if (info.isDolrim) score += 18; /* 돌림 단어 — 순환이나 상대 빗겨가기에 유리해 보너스 */
    /* 유도 보너스 — 끝밭침 뒤에 남은 단어가 적을수록 상대를 좁은 골목으로 몰아넣는다
       (꾼·늬처럼 남은 단어 1~2개뿐인 끝밭침이면 사실상 확정 승리 도미노) */
    if (info.rarityCount <= 2) score += 60;
    else if (info.rarityCount <= 5) score += 38;
    else if (info.rarityCount <= 15) score += 18;
    else if (info.rarityCount <= 30) score += 12;
    /* 꾼 마무리 — 접꾼·감꾼류. 상대는 22개뿐인 꾼 말밭으로 몰려 좁은 골목에 갇힌다.
       꾼으로 끝내는 수를 적극적으로 쓴다 */
    if (info.lastSyl === "꾼") score += 45;
    score += Math.min(60, funnelOf(info)); /* 펀넬 보너스는 60 상한 — 루트/좁은 말밭과 비교 가능하게 */

    /* 상대가 받아칠 루트/희귀 루트가 적은 수를 우선. 예: 가듁 → 상대의 루트 대응은
       듁슌 하나뿐이므로 보너스. 3개 미만이면 상대 반격이 제한된다. 6개 이상이면 산만한 수. */
    const oppRootPool = getCandidates(info.w, newUsed, WORD_INDEX, 64);
    let oppRoots = 0;
    for (const ow of oppRootPool) {
      if ((ROOT_WORDS && ROOT_WORDS.has(ow)) || rareRootSet.has(ow)) oppRoots++;
    }
    if (oppRoots === 0) score += 40;
    else if (oppRoots === 1) score += 25;
    else if (oppRoots === 2) score += 15;
    else if (oppRoots === 3) score += 8;
    else if (oppRoots >= 6) score -= 20;

    score -= Math.min(info.nextCount, 15) * 2;
    const opp = getCandidates(info.w, newUsed, WORD_INDEX, OPP_CAP + 1);
    const sample = opp.slice(0, OPP_CAP);
    for (const ow of sample) {
      const owUsed = new Set(newUsed);
      owUsed.add(info.w);
      const owNext = getCandidates(ow, owUsed, WORD_INDEX, 16);
      if (owNext.length === 0) { score -= 110; continue; }
      /* 상대 응수가 나를 좁은 골목으로 몰아넣는 구조(뒤에 1~3개뿐)면 위험 */
      if (owNext.length <= 3) { score -= 35; continue; }
      if (Number.isFinite(ATTACK_DEPTH[ow]) && ATTACK_DEPTH[ow] <= 2) score -= 45;
      if (ROOT_WORDS && ROOT_WORDS.has(ow)) score -= 25;
      if (rareRootSet.has(ow)) score -= 30;
      if (ow.endsWith("값")) score -= 30;
      const ply = owNext.slice(0, OPP_PLY_CAP);
      for (const o2 of ply) {
        const o2Used = new Set(owUsed);
        o2Used.add(o2);
        if (getCandidates(o2, o2Used, WORD_INDEX, 16).length === 0) { score -= 120; break; }
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
    /* 어려움은 최선에 거의 결정적으로, 보통은 상위 몇 개 중 무작위(다양성) */
    const band = strong ? 3 : 12;
    const top = scored.filter(x => x.s >= topScore - band);
    return pick(top).i.w;
  };

  /* 1. 즉시 승리 */
  const wins = list.filter(i => i.nextCount === 0);
  if (wins.length) return pick(wins).w;

  /* 2. 승리/패배 증명 — 좁은 말밭(꾼·늬 등)에서 제한 네가맥스(canForceWin 품질 교체)로
        (a) 상대 차례가 지는 수(내 강제 승리)가 있으면 무조건 그 수를 둔다
        (b) 상대가 증명 가능하게 이기는 수(내 확정 패배)는 선택지에서 배제한다
        넓은 지점은 빠르게 포기하고 기존 전략으로 내려간다. nextCount가 16 Cap이라
        리스트가 너무 크면 스킵. */
  const provenWins = [];
  const provenLosses = new Set();
  if (list.length <= 160) {
    const winUsed = new Set(usedWords);
    const prevBranch = _winBranch;
    const prevDepth = _winDepth;
    if (strong) { _winBranch = 160; _winDepth = 24; }
    const budget = { nodes: strong ? WIN_NODE_CAP * 5 : WIN_NODE_CAP };
    try {
      for (const item of list) {
        const oppAll = getCandidates(item.w, winUsed, WORD_INDEX, strong ? 200 : WIN_BRANCH + 1);
        if (oppAll.length > (strong ? 200 : WIN_BRANCH)) continue; /* 상대 응수가 넓어 증명 불가 */
        winUsed.add(item.w);
        const r = solveWin(item.w, winUsed, 0, budget, WORD_INDEX);
        winUsed.delete(item.w);
        if (r === -1) provenWins.push(item.w);      /* 상대 차례 패배 → 내 강제 승리 */
        else if (r === 1) provenLosses.add(item.w); /* 상대 차례 승리 → 내 확정 패배 수 */
        if (budget.nodes <= 0) break;
      }
    } finally {
      _winBranch = prevBranch;
      _winDepth = prevDepth;
    }
  }
  if (provenWins.length) return pick(provenWins);
  if (provenLosses.size) {
    const safe = list.filter(i => !provenLosses.has(i.w));
    if (safe.length) list = safe;
  }

  /* 3. 모든 수 비교 — 값/루트/희귀 루트/펀넬 돌림 후보를 한 점수로 매겨 더 좋은 수를
        계산한다. 돌림은 "상대 말밭에 꺼낼 루트/희귀 루트가 남아 있을 때"(루트 팔로우)만
        후보로 남겨, 돌림이 유리하면 돌림이, 더 좋은 루트/좁은 말밭 수가 있으면 그 수가
        점수에서 앞서도록 한다. 즉 돌림에 치우치지 않고 더 좋은 수가 있는지 확인한다. */
  const rootFollow = (info) => {
    const opp = getCandidates(info.w, newUsed, WORD_INDEX, 1000);
    for (const ow of opp) {
      if ((ROOT_WORDS && ROOT_WORDS.has(ow)) || rareRootSet.has(ow)) return true;
    }
    return false;
  };
  const eligible = list.filter(i =>
    i.isValue ||
    i.isRoot ||
    i.isRareRoot ||
    (i.isDolrim && funnelOf(i) >= 60 && rootFollow(i)));
  if (!eligible.length) return null; /* 값/루트/희귀루트/유효 펀넬이 없으면 수를 내지 않는다 */
  return bestFrom(eligible);
}

/* =========================================================
   랭크 계산
========================================================= */

function calculateRank(rating) {
  /* 등급 체계 — 숫자가 낮을수록 높은 등급 (브론즈5~브론즈1, 실버5~실버1, ...)
     마스터·그랜드마스터·챌린저(400 간격)는 다이아를 넘어서도 계속 오른다 */
  const tierTables = [
    { tier: "Bronze", base: 0, span: 1000 },
    { tier: "Silver", base: 1000, span: 400 },
    { tier: "Gold", base: 1400, span: 400 },
    { tier: "Platinum", base: 1800, span: 400 },
    { tier: "Diamond", base: 2200, span: 400 },
    { tier: "Master", base: 2600, span: 400 },
    { tier: "Grandmaster", base: 3000, span: 400 },
    { tier: "Challenger", base: 3400, span: 400 }
  ];
  let tier = tierTables[tierTables.length - 1];
  for (const t of tierTables) {
    if (rating >= t.base) tier = t;
  }
  if (rating >= 3400) return { tier: "Challenger", sub: "" };
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

/* 커스텀 사전(유저 등록 단어)을 배치에 합친 합성 뷰 반환 — baseSet/baseIndex는 그대로 두고,
   새 검색 뷰만 만든다. 희귀(수시) 승인 시 호출하므로 성능 부담이 크지 않다 */
function mergeCustomWords(baseSet, baseIndex, customWords) {
  const mergedSet = new Set(baseSet);
  const mergedIndex = new Map();
  for (const [k, arr] of baseIndex) mergedIndex.set(k, arr.slice());
  for (const raw of customWords || []) {
    const word = normalizeWord(raw);
    if (!word) continue;
    if (mergedSet.has(word)) continue;
    mergedSet.add(word);
    const first = word[0];
    if (!mergedIndex.has(first)) mergedIndex.set(first, []);
    mergedIndex.get(first).push(word);
  }
  return { WORD_SET: mergedSet, WORD_INDEX: mergedIndex };
}

module.exports = {
  DUEUM, normalizeWord, allowedFirstChars, canConnect,
  loadData, hasWord, getAttackDepth, isAttackWord,
  getCandidates, isOneShot, getStartCandidates, chooseStartWord,
  chooseAIWord, chooseAIStartWord, calculateRank, calculateElo,
  mergeCustomWords
};
