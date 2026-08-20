const fs = require('fs');
const path = require('path');

console.log('game.js: 데이터 로딩 시작');

const WORD_FILE = path.join(__dirname, '..', 'data', 'word.txt');
const ATTACK_FILE = path.join(__dirname, '..', 'data', 'attack.txt');

//
// 두음법칙
//
// 입력 단어의 첫 글자가 현재 단어의 마지막 글자와
// 정확히 같거나, 두음법칙상 허용되는 경우를 모두 인정한다.
//
const DUEUM = {
  '녀': ['녀', '여'],
  '뇨': ['뇨', '요'],
  '뉴': ['뉴', '유'],
  '니': ['니', '이'],

  '려': ['려', '여'],
  '료': ['료', '요'],
  '류': ['류', '유'],
  '리': ['리', '이'],

  '라': ['라', '나'],
  '래': ['래', '내'],
  '로': ['로', '노'],
  '뢰': ['뢰', '뇌'],
  '루': ['루', '누'],
  '르': ['르', '느']
};

function getAllowedFirstChars(lastChar) {
  const result = new Set([lastChar]);

  for (const [from, chars] of Object.entries(DUEUM)) {
    if (from === lastChar) {
      for (const c of chars) result.add(c);
    }

    if (chars.includes(lastChar)) {
      for (const c of chars) result.add(c);
    }
  }

  return [...result];
}

function canConnect(currentWord, nextWord) {
  if (!currentWord || !nextWord) return false;

  const lastChar = currentWord.at(-1);
  const firstChar = nextWord[0];

  return getAllowedFirstChars(lastChar).includes(firstChar);
}

console.log('game.js: word.txt 읽는 중...');

const rawWords = fs
  .readFileSync(WORD_FILE, 'utf8')
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(Boolean);

console.log(`game.js: word.txt 읽기 완료 (${rawWords.length}개)`);

const words = [
  ...new Set(
    rawWords.filter(word => /^[가-힣]+$/.test(word))
  )
];

console.log(`game.js: 단어 정리 완료 (${words.length}개)`);

const wordSet = new Set(words);

const byFirst = new Map();

for (const word of words) {
  const first = word[0];

  if (!byFirst.has(first)) {
    byFirst.set(first, []);
  }

  byFirst.get(first).push(word);
}

console.log('game.js: 첫 글자별 단어 목록 생성 완료');

//
// 두음법칙을 고려한 후보 검색
//
function candidates(lastChar, used = new Set()) {
  const result = [];
  const firstChars = getAllowedFirstChars(lastChar);

  for (const firstChar of firstChars) {
    const list = byFirst.get(firstChar) || [];

    for (const word of list) {
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

//
// attack.txt
//
console.log('game.js: attack.txt 읽는 중...');

const attackDepth = new Map();

let currentGroup = null;

const attackLines = fs
  .readFileSync(ATTACK_FILE, 'utf8')
  .split(/\r?\n/);

console.log(`game.js: attack.txt 읽기 완료 (${attackLines.length}줄)`);

for (const line of attackLines) {
  const s = line.trim();

  const group = s.match(/^\[(.+)\]$/);

  if (group) {
    currentGroup = group[1];
    continue;
  }

  const match = s.match(/^깊이\s+(\d+)\s*:\s*(.+)$/);

  if (!match || !currentGroup) {
    continue;
  }

  const depth = Number(match[1]);

  const groupWords = match[2]
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

  for (const word of groupWords) {
    if (wordSet.has(word)) {
      attackDepth.set(word, depth);
    }
  }
}

console.log(`game.js: 공격 단어 처리 완료 (${attackDepth.size}개)`);

//
// 특정 단어가 사실상 한방인지 확인
//
function isOneHitWord(word) {
  const next = candidates(word.at(-1), new Set([word]));
  return next.length === 0;
}

//
// 시작 단어
//
// 반드시:
// 1. 가/나/다/마/사/자/기/시 중 하나로 시작
// 2. 공격 단어가 아님
// 3. 첫 단어 자체가 한방단어가 아님
// 4. 다음 선택지가 충분히 존재
//
const START_CHARS = new Set([
  '가',
  '나',
  '다',
  '마',
  '사',
  '자',
  '기',
  '시'
]);

const startPool = words.filter(word => {
  if (!START_CHARS.has(word[0])) {
    return false;
  }

  // 공격 깊이가 있는 단어 제외
  if (attackDepth.has(word)) {
    return false;
  }

  // 첫 단어부터 바로 끝나는 단어 제외
  if (isOneHitWord(word)) {
    return false;
  }

  // 선택지가 너무 적은 단어도 제외
  const next = candidates(word.at(-1), new Set([word]));

  if (next.length < 2) {
    return false;
  }

  return true;
});

console.log(`game.js: 시작 단어 생성 완료 (${startPool.length}개)`);

//
// 랜덤 시작 단어
//
function randomStart() {
  if (!startPool.length) {
    throw new Error('사용 가능한 시작 단어가 없습니다.');
  }

  return startPool[
    Math.floor(Math.random() * startPool.length)
  ];
}

//
// 단어 판정
//
function validateWord(word, current, used) {
  if (!word) {
    return '단어를 입력해주세요.';
  }

  if (!wordSet.has(word)) {
    return '목록에 없는 단어입니다.';
  }

  if (used.has(word)) {
    return '이미 사용한 단어입니다.';
  }

  if (current && !canConnect(current, word)) {
    const lastChar = current.at(-1);
    const allowed = getAllowedFirstChars(lastChar);

    return `'${lastChar}'으로 시작하는 단어가 필요합니다. 허용: ${allowed.join(', ')}`;
  }

  return null;
}

//
// 공격 단어인지
//
function getAttackDepth(word) {
  return attackDepth.get(word) ?? null;
}

//
// 깊이 없는 양보 단어
//
function isYieldWord(word) {
  return !attackDepth.has(word);
}

//
// 상대에게 주는 선택지 수
//
function countNextMoves(word, used) {
  const nextUsed = new Set(used);
  nextUsed.add(word);

  return candidates(word.at(-1), nextUsed).length;
}

//
// AI용 정보
//
function analyzeWord(word, used) {
  const nextMoves = countNextMoves(word, used);
  const depth = getAttackDepth(word);

  return {
    word,
    depth,
    nextMoves,
    oneHit: nextMoves === 0,
    yield: depth == null
  };
}

//
// 공개 데이터
//
function publicData() {
  return {
    words,
    attackDepth: Object.fromEntries(attackDepth),
    startPool
  };
}

const DATA = {
  words,
  wordSet,
  byFirst,
  attackDepth,
  startPool
};

console.log('game.js: 모든 데이터 로딩 완료');

module.exports = {
  DATA,
  candidates,
  randomStart,
  validateWord,
  publicData,
  canConnect,
  getAllowedFirstChars,
  getAttackDepth,
  isYieldWord,
  countNextMoves,
  analyzeWord,
  isOneHitWord
};
