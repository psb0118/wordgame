const fs = require('fs');
const path = require('path');

console.log('game.js: 데이터 로딩 시작');

const WORD_FILE = path.join(__dirname, '..', 'data', 'word.txt');
const ATTACK_FILE = path.join(__dirname, '..', 'data', 'attack.txt');

/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
  // ㄴ → ㅇ
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

  // ㄹ → ㄴ
  '라': ['라', '나'],
  '락': ['락', '낙'],
  '란': ['란', '난'],
  '랄': ['랄', '날'],
  '람': ['람', '남'],
  '랑': ['랑', '낭'],
  '래': ['래', '내'],
  '로': ['로', '노'],
  '록': ['록', '녹'],
  '론': ['론', '논'],
  '루': ['루', '누'],
  '뢰': ['뢰', '뇌'],

  // ㄹ → ㅇ
  '랴': ['랴', '야'],
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
  '림': ['림', '임'],
  '립': ['립', '입'],
  '륙': ['륙', '육'],
  '륭': ['륭', '융'],
  '렵': ['렵', '엽'],

  // 일부 끝말잇기 사전에서 허용하는 형태
  '륨': ['륨', '윰'],
  '늄': ['늄', '윰'],

  '릉': ['릉', '능'],
  '름': ['름', '늠'],
  '릅': ['릅', '늡'],
  '른': ['른', '는'],
  '릎': ['릎', '늪'],
  '릇': ['릇', '늣'],

  '륜': ['륜', '윤'],
  '릿': ['릿', '잇'],
  '랸': ['랸', '얀'],
  '룔': ['룔', '욜']
};

/*
 * 마지막 글자에서 실제로 인정되는 첫 글자 목록.
 */
function allowedFirstChars(lastChar) {
  if (!lastChar) return [];

  const result = [lastChar];

  const extra = DUEUM[lastChar];

  if (extra) {
    for (const char of extra) {
      if (!result.includes(char)) {
        result.push(char);
      }
    }
  }

  return result;
}

function canStartWith(word, lastChar) {
  if (!word || !lastChar) return false;

  return allowedFirstChars(lastChar).includes(word[0]);
}

/* =========================================================
   단어 데이터
========================================================= */

console.log('game.js: word.txt 읽는 중...');

const rawWords = fs
  .readFileSync(WORD_FILE, 'utf8')
  .split(/\r?\n/)
  .map(x => x.trim())
  .filter(Boolean);

console.log(
  `game.js: word.txt 읽기 완료 (${rawWords.length}개)`
);

const words = [
  ...new Set(
    rawWords.filter(
      word => /^[가-힣]+$/.test(word)
    )
  )
];

const wordSet = new Set(words);

console.log(
  `game.js: 단어 정리 완료 (${words.length}개)`
);

/* 첫 글자별 인덱스 */

const byFirst = new Map();

for (const word of words) {
  const first = word[0];

  if (!byFirst.has(first)) {
    byFirst.set(first, []);
  }

  byFirst.get(first).push(word);
}

console.log(
  'game.js: 첫 글자별 단어 목록 생성 완료'
);

/* =========================================================
   공격 단어 데이터
========================================================= */

console.log('game.js: attack.txt 읽는 중...');

const attackDepth = new Map();

if (fs.existsSync(ATTACK_FILE)) {
  const attackLines = fs
    .readFileSync(ATTACK_FILE, 'utf8')
    .split(/\r?\n/);

  console.log(
    `game.js: attack.txt 읽기 완료 (${attackLines.length}줄)`
  );

  let currentGroup = null;

  for (const line of attackLines) {
    const s = line.trim();

    if (!s) continue;

    const group = s.match(/^\[(.+)\]$/);

    if (group) {
      currentGroup = group[1];
      continue;
    }

    const match = s.match(
      /^깊이\s+(\d+)\s*:\s*(.+)$/
    );

    if (!match || !currentGroup) continue;

    const depth = Number(match[1]);

    const attackWords = match[2]
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    for (const word of attackWords) {
      if (!wordSet.has(word)) continue;

      const oldDepth = attackDepth.get(word);

      if (
        oldDepth == null ||
        depth < oldDepth
      ) {
        attackDepth.set(word, depth);
      }
    }
  }
}

console.log(
  `game.js: 공격 단어 처리 완료 (${attackDepth.size}개)`
);

/* =========================================================
   후보 검색
========================================================= */

function candidates(lastChar, used = new Set()) {
  const result = [];

  for (
    const firstChar of allowedFirstChars(lastChar)
  ) {
    const list =
      byFirst.get(firstChar) || [];

    for (const word of list) {
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

/*
 * 현재 상태에서 한방인지 검사.
 */
function isOneShot(word, used = new Set()) {
  if (!word) return true;

  const nextUsed = new Set(used);
  nextUsed.add(word);

  return (
    candidates(
      word.at(-1),
      nextUsed
    ).length === 0
  );
}

/* =========================================================
   시작 단어
========================================================= */

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
 * 시작 단어가 너무 공격적인지 검사.
 *
 * 단순히 시작 단어 자체만 보는 게 아니라
 * 바로 다음 선택지까지 검사한다.
 */
function isBadStart(word) {
  if (!START_FIRST.includes(word[0])) {
    return true;
  }

  // 시작 단어 자체가 공격 단어면 제외
  if (attackDepth.has(word)) {
    return true;
  }

  const used = new Set([word]);

  const next = candidates(
    word.at(-1),
    used
  );

  // 시작하자마자 한방
  if (next.length === 0) {
    return true;
  }

  // 선택지가 너무 적으면 승부가 너무 빨리 결정됨
  if (next.length < 8) {
    return true;
  }

  /*
   * 바로 다음에 공격 단어가 너무 많이 나오면
   * 시작부터 특정 루트로 유도되는 단어일 가능성이 높음.
   */
  let attackCount = 0;
  let oneShotCount = 0;

  const sampleSize =
    Math.min(next.length, 100);

  for (let i = 0; i < sampleSize; i++) {
    const nextWord = next[i];

    if (attackDepth.has(nextWord)) {
      attackCount++;
    }

    if (
      isOneShot(
        nextWord,
        used
      )
    ) {
      oneShotCount++;
    }
  }

  /*
   * 바로 다음 후보 대부분이 공격이면 시작 단어로 사용하지 않음.
   */
  if (
    sampleSize >= 10 &&
    attackCount / sampleSize > 0.35
  ) {
    return true;
  }

  /*
   * 바로 다음 후보 대부분이 한방이면 제외.
   */
  if (
    sampleSize >= 10 &&
    oneShotCount / sampleSize > 0.45
  ) {
    return true;
  }

  return false;
}

const startPool = words.filter(
  word => !isBadStart(word)
);

console.log(
  `game.js: 시작 단어 생성 완료 (${startPool.length}개)`
);

function randomStart() {
  if (!startPool.length) {
    throw new Error(
      '사용할 수 있는 시작 단어가 없습니다.'
    );
  }

  return startPool[
    Math.floor(
      Math.random() *
      startPool.length
    )
  ];
}

/* =========================================================
   단어 검증
========================================================= */

function validateWord(
  word,
  current,
  used = new Set()
) {
  if (!word) {
    return '단어를 입력해주세요.';
  }

  if (!wordSet.has(word)) {
    return '목록에 없는 단어입니다.';
  }

  if (used.has(word)) {
    return '이미 사용한 단어입니다.';
  }

  if (
    current &&
    !canStartWith(
      word,
      current.at(-1)
    )
  ) {
    const last =
      current.at(-1);

    const accepted =
      allowedFirstChars(last);

    if (accepted.length > 1) {
      return (
        `'${last}' 다음에는 ` +
        `${accepted.join(', ')}으로 ` +
        `시작하는 단어가 필요합니다.`
      );
    }

    return (
      `'${last}'으로 시작하는 ` +
      `단어가 필요합니다.`
    );
  }

  return null;
}

/* =========================================================
   클라이언트 데이터
========================================================= */

function publicData() {
  return {
    words,
    attackDepth:
      Object.fromEntries(
        attackDepth
      ),
    startPool,
    dueum: DUEUM
  };
}

/* =========================================================
   DATA
========================================================= */

const DATA = {
  words,
  wordSet,
  byFirst,
  attackDepth,
  startPool,
  dueum: DUEUM
};

console.log(
  'game.js: 모든 데이터 로딩 완료'
);

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
