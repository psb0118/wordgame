const fs = require('fs');
const path = require('path');

console.log('game.js: 데이터 로딩 시작');

const WORD_FILE = path.join(__dirname, '..', 'data', 'word.txt');
const ATTACK_FILE = path.join(__dirname, '..', 'data', 'attack.txt');

/*
 * 두음법칙
 *
 * 끝말잇기에서 마지막 글자가 아래 글자라면
 * 다음 단어의 첫 글자를 변환해서 인정한다.
 *
 * 예:
 * 리 -> 이
 * 녀 -> 여
 * 력 -> 역
 * 륨 -> 윰
 * 늄 -> 윰
 */

const DUEUM = {
  // ㄴ -> ㅇ 계열
  '녀': ['녀', '여'],
  '년': ['년', '연'],
  '념': ['념', '염'],
  '녕': ['녕', '영'],
  '뇨': ['뇨', '요'],
  '뉴': ['뉴', '유'],
  '니': ['니', '이'],
  '녑': ['녑', '엽'],
  '녁': ['녁', '역'],
  '뇰': ['뇰', '욜'],
  '닐': ['닐', '일'],
  '닉': ['닉', '익'],
  '뉵': ['뉵', '육'],

  // ㄹ -> ㄴ 계열
  '라': ['라', '나'],
  '락': ['락', '낙'],
  '란': ['란', '난'],
  '랄': ['랄', '날'],
  '람': ['람', '남'],
  '랑': ['랑', '낭'],
  '래': ['래', '내'],
  '뢰': ['뢰', '뇌'],
  '로': ['로', '노'],
  '록': ['록', '녹'],
  '론': ['론', '논'],
  '루': ['루', '누'],
  '륵': ['륵', '늑'],
  '릉': ['릉', '능'],
  '름': ['름', '늠'],
  '릅': ['릅', '늡'],
  '른': ['른', '는'],
  '릎': ['릎', '늪'],
  '릇': ['릇', '늣'],
  '랏': ['랏', '낫'],
  '롯': ['롯', '놋'],
  '롱': ['롱', '농'],
  '룡': ['룡', '용'],
  '륜': ['륜', '윤'],
  '륭': ['륭', '융'],

  // ㄹ -> ㅇ 계열
  '려': ['려', '여'],
  '례': ['례', '예'],
  '료': ['료', '요'],
  '류': ['류', '유'],
  '리': ['리', '이'],
  '력': ['력', '역'],
  '략': ['략', '약'],
  '량': ['량', '양'],
  '련': ['련', '연'],
  '렴': ['렴', '염'],
  '령': ['령', '영'],
  '렬': ['렬', '열'],
  '률': ['률', '율'],
  '린': ['린', '인'],
  '립': ['립', '입'],
  '륙': ['륙', '육'],
  '렵': ['렵', '엽'],

  // 끝말잇기에서 자주 사용하는 특수 두음
  '릿': ['릿', '잇'],
  '랸': ['랸', '얀'],
  '룔': ['룔', '욜'],

  // 끄투/끝말잇기에서 자주 허용하는 륨/늄 -> 윰
  '륨': ['륨', '윰'],
  '늄': ['늄', '윰'],

  // 녘 -> 옄
  '녘': ['녘', '옄']
};

function allowedFirstChars(lastChar) {
  const result = [lastChar];

  if (DUEUM[lastChar]) {
    for (const c of DUEUM[lastChar]) {
      if (!result.includes(c)) result.push(c);
    }
  }

  return result;
}

function canStartWith(word, lastChar) {
  if (!word || !lastChar) return false;

  const first = word[0];

  return allowedFirstChars(lastChar).includes(first);
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

const wordSet = new Set(words);

console.log(`game.js: 단어 정리 완료 (${words.length}개)`);

const byFirst = new Map();

for (const word of words) {
  const first = word[0];

  if (!byFirst.has(first)) {
    byFirst.set(first, []);
  }

  byFirst.get(first).push(word);
}

console.log('game.js: 첫 글자별 단어 목록 생성 완료');

console.log('game.js: attack.txt 읽는 중...');

const attackDepth = new Map();

if (fs.existsSync(ATTACK_FILE)) {
  const attackLines = fs
    .readFileSync(ATTACK_FILE, 'utf8')
    .split(/\r?\n/);

  console.log(`game.js: attack.txt 읽기 완료 (${attackLines.length}줄)`);

  let currentGroup = null;

  for (const line of attackLines) {
    const s = line.trim();

    if (!s) continue;

    const group = s.match(/^\[(.+)\]$/);

    if (group) {
      currentGroup = group[1];
      continue;
    }

    const match = s.match(/^깊이\s+(\d+)\s*:\s*(.+)$/);

    if (!match || !currentGroup) continue;

    const depth = Number(match[1]);

    const attackWords = match[2]
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    for (const word of attackWords) {
      if (!wordSet.has(word)) continue;

      const oldDepth = attackDepth.get(word);

      if (oldDepth == null || depth < oldDepth) {
        attackDepth.set(word, depth);
      }
    }
  }
}

console.log(`game.js: 공격 단어 처리 완료 (${attackDepth.size}개)`);

/*
 * 특정 마지막 글자에서 실제로 갈 수 있는 단어.
 * 두음법칙도 여기서 처리한다.
 */
function candidates(lastChar, used = new Set()) {
  const result = [];

  for (const firstChar of allowedFirstChars(lastChar)) {
    const list = byFirst.get(firstChar) || [];

    for (const word of list) {
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

/*
 * 한방단어 여부
 *
 * 두음법칙까지 고려해서 다음 단어가 하나라도 있으면
 * 한방단어가 아니다.
 */
function isOneShot(word, used = new Set()) {
  if (!word) return true;

  return candidates(word.at(-1), used).length === 0;
}

/*
 * 시작 단어는 무조건 이 8개 글자로 시작.
 */
const START_FIRST = [
  '가',
  '나',
  '다',
  '마',
  '사',
  '자',
  '기',
  '시'
];

/*
 * 시작 단어 조건:
 *
 * 1. 지정된 글자로 시작
 * 2. 공격 깊이가 없어야 함
 * 3. 한방단어가 아니어야 함
 * 4. 다음으로 갈 단어가 충분히 있어야 함
 *
 * 마지막 조건 때문에 시작하자마자 사실상 승부가 결정되는
 * 이상한 단어가 시작 단어로 나오지 않는다.
 */

const startPool = words.filter(word => {
  if (!START_FIRST.includes(word[0])) return false;

  // 공격 루트에 들어가는 시작 단어 금지
  if (attackDepth.has(word)) return false;

  // 시작하자마자 한방 금지
  const next = candidates(word.at(-1), new Set([word]));

  if (next.length === 0) return false;

  // 선택지가 너무 적은 시작 단어도 제외
  if (next.length < 5) return false;

  return true;
});

console.log(`game.js: 시작 단어 생성 완료 (${startPool.length}개)`);

function randomStart() {
  if (!startPool.length) {
    throw new Error('사용할 수 있는 시작 단어가 없습니다.');
  }

  return startPool[
    Math.floor(Math.random() * startPool.length)
  ];
}

/*
 * 서버에서 실제 입력을 검증한다.
 */
function validateWord(word, current, used = new Set()) {
  if (!word) {
    return '단어를 입력해주세요.';
  }

  if (!wordSet.has(word)) {
    return '목록에 없는 단어입니다.';
  }

  if (used.has(word)) {
    return '이미 사용한 단어입니다.';
  }

  if (current && !canStartWith(word, current.at(-1))) {
    const last = current.at(-1);

    const accepted = allowedFirstChars(last);

    if (accepted.length > 1) {
      return `'${last}' 다음에는 ${accepted.join(', ')}으로 시작하는 단어가 필요합니다.`;
    }

    return `'${last}'으로 시작하는 단어가 필요합니다.`;
  }

  return null;
}

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
  startPool,
  dueum: DUEUM
};

console.log('game.js: 모든 데이터 로딩 완료');

module.exports = {
  DATA,
  candidates,
  randomStart,
  validateWord,
  publicData,
  canStartWith,
  allowedFirstChars,
  isOneShot
};
