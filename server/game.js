const fs = require('fs');
const path = require('path');

const WORD_FILE = path.join(__dirname, '..', 'data', 'word.txt');
const ATTACK_FILE = path.join(__dirname, '..', 'data', 'attack.txt');

/*
 * 두음법칙
 * ㄹ → ㄴ / ㅇ
 * ㄴ → ㅇ
 *
 * 예:
 * 량 → 양
 * 력 → 역
 * 류 → 유
 * 녀 → 여
 * 뇨 → 요
 * 니 → 이
 */
const INITIAL_SOUND_RULES = {
  'ㄹ': ['ㄴ', 'ㅇ'],
  'ㄴ': ['ㅇ']
};

const L_TO_N = new Set(['라','래','로','뢰','루','르','리']);
const L_TO_Y = new Set(['랴','려','례','료','류','리']);
const N_TO_Y = new Set(['냐','녀','녜','뇨','뉴','니']);

function getAllowedFirstChars(lastChar) {
  const result = new Set([lastChar]);

  if (L_TO_N.has(lastChar)) {
    result.add(String.fromCharCode(lastChar.charCodeAt(0) - 0));
  }

  if (L_TO_Y.has(lastChar)) {
    result.add(lastChar.replace(/^ㄹ/, ''));
  }

  return result;
}

/*
 * 실제 한글 두음법칙을 처리하기 위한 변환.
 * 마지막 글자를 기준으로 허용되는 다음 첫 글자를 반환한다.
 */
function allowedNextFirstChars(lastChar) {
  const result = new Set([lastChar]);

  const code = lastChar?.charCodeAt(0);
  if (!code || code < 0xAC00 || code > 0xD7A3) return result;

  const base = code - 0xAC00;
  const initial = Math.floor(base / 588);
  const medial = Math.floor((base % 588) / 28);

  // 초성 번호:
  // ㄱ0 ㄲ1 ㄴ2 ㄷ3 ㄸ4 ㄹ5 ㅁ6 ㅂ7 ㅃ8 ㅅ9 ㅆ10 ㅇ11 ㅈ12 ...
  const lastInitial = initial;

  // ㄹ로 끝나는 음절 -> ㄴ 또는 ㅇ으로 시작하는 음절 허용
  if (lastInitial === 5) {
    // 려/례/료/류/리 계열 -> 여/예/요/유/이
    if ([5, 6, 7, 8, 12].includes(medial)) {
      result.add(String.fromCharCode(code - (5 - 11) * 588));
    }

    // 라/래/로/뢰/루/르 -> 나/내/노/뇌/누/느
    if ([0, 1, 8, 9, 13, 18].includes(medial)) {
      result.add(String.fromCharCode(code - (5 - 2) * 588));
    }
  }

  // ㄴ + 이/야/여/요/유 계열 -> ㅇ
  if (lastInitial === 2 && [2, 6, 7, 8, 13, 18].includes(medial)) {
    result.add(String.fromCharCode(code - (2 - 11) * 588));
  }

  return result;
}

function canConnect(current, next) {
  if (!current || !next) return true;

  const lastChar = current.at(-1);
  const firstChar = next[0];

  if (firstChar === lastChar) return true;

  return allowedNextFirstChars(lastChar).has(firstChar);
}

function loadData() {
  const rawWords = fs.readFileSync(WORD_FILE, 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const words = [
    ...new Set(
      rawWords.filter(w => /^[가-힣]+$/.test(w))
    )
  ];

  const wordSet = new Set(words);

  const byFirst = new Map();

  for (const w of words) {
    const c = w[0];

    if (!byFirst.has(c)) {
      byFirst.set(c, []);
    }

    byFirst.get(c).push(w);
  }

  const attackDepth = new Map();
  let current = null;

  for (const line of fs.readFileSync(ATTACK_FILE, 'utf8').split(/\r?\n/)) {
    const s = line.trim();

    const group = s.match(/^\[(.+)\]$/);

    if (group) {
      current = group[1];
      continue;
    }

    const m = s.match(/^깊이\s+(\d+)\s*:\s*(.+)$/);

    if (!m || !current) continue;

    const depth = Number(m[1]);

    for (
      const w of m[2]
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
    ) {
      if (wordSet.has(w)) {
        attackDepth.set(w, depth);
      }
    }
  }

  const startPool = words.filter(
    w =>
      !attackDepth.has(w) &&
      [...(byFirst.get(w.at(-1)) || [])].some(x => x !== w)
  );

  return {
    words,
    wordSet,
    byFirst,
    attackDepth,
    startPool
  };
}

const DATA = loadData();

function candidates(lastChar, used) {
  const result = new Set();

  // 같은 글자로 시작하는 단어
  for (const w of DATA.byFirst.get(lastChar) || []) {
    if (!used.has(w)) {
      result.add(w);
    }
  }

  // 두음법칙으로 연결되는 단어
  for (const firstChar of allowedNextFirstChars(lastChar)) {
    for (const w of DATA.byFirst.get(firstChar) || []) {
      if (!used.has(w)) {
        result.add(w);
      }
    }
  }

  return [...result];
}

function randomStart() {
  if (!DATA.startPool.length) {
    return DATA.words[Math.floor(Math.random() * DATA.words.length)];
  }

  return DATA.startPool[
    Math.floor(Math.random() * DATA.startPool.length)
  ];
}

function validateWord(word, current, used) {
  if (!DATA.wordSet.has(word)) {
    return '목록에 없는 단어입니다.';
  }

  if (used.has(word)) {
    return '이미 사용한 단어입니다.';
  }

  if (current && !canConnect(current, word)) {
    return `'${current.at(-1)}'으로 시작하는 단어가 필요합니다.`;
  }

  return null;
}

function publicData() {
  return {
    words: DATA.words,
    attackDepth: Object.fromEntries(DATA.attackDepth),
    startPool: DATA.startPool
  };
}

module.exports = {
  DATA,
  candidates,
  randomStart,
  validateWord,
  publicData,
  canConnect,
  allowedNextFirstChars
};
