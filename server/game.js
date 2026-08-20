const fs = require('fs');
const path = require('path');

const WORD_FILE = path.join(
  __dirname,
  '..',
  'data',
  'word.txt'
);

const ATTACK_FILE = path.join(
  __dirname,
  '..',
  'data',
  'attack.txt'
);

function loadData() {
  console.log('game.js: 데이터 로딩 시작');

  console.log('game.js: word.txt 읽는 중...');

  const rawWords = fs
    .readFileSync(WORD_FILE, 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim())
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

  console.log(
    `game.js: 단어 정리 완료 (${words.length}개)`
  );

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

  const attackDepth = new Map();

  console.log('game.js: attack.txt 읽는 중...');

  const attackLines = fs
    .readFileSync(ATTACK_FILE, 'utf8')
    .split(/\r?\n/);

  console.log(
    `game.js: attack.txt 읽기 완료 (${attackLines.length}줄)`
  );

  let current = null;

  for (const line of attackLines) {
    const text = line.trim();

    const group = text.match(
      /^\[(.+)\]$/
    );

    if (group) {
      current = group[1];
      continue;
    }

    const match = text.match(
      /^깊이\s+(\d+)\s*:\s*(.+)$/
    );

    if (!match || !current) {
      continue;
    }

    const depth = Number(match[1]);

    const attackWords = match[2]
      .split(',')
      .map(word => word.trim())
      .filter(Boolean);

    for (const word of attackWords) {
      if (wordSet.has(word)) {
        attackDepth.set(word, depth);
      }
    }
  }

  console.log(
    `game.js: 공격 단어 처리 완료 (${attackDepth.size}개)`
  );

  /*
   * 시작 단어는:
   * 1. 공격 단어가 아니고
   * 2. 마지막 글자로 이어지는 다른 단어가 존재해야 함
   */
  const startPool = [];

  for (const word of words) {
    if (attackDepth.has(word)) {
      continue;
    }

    const nextWords =
      byFirst.get(word.at(-1)) || [];

    if (
      nextWords.some(
        next => next !== word
      )
    ) {
      startPool.push(word);
    }
  }

  console.log(
    `game.js: 시작 단어 생성 완료 (${startPool.length}개)`
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

console.log('game.js: 모든 데이터 로딩 완료');

function candidates(lastChar, used) {
  const list =
    DATA.byFirst.get(lastChar) || [];

  return list.filter(
    word => !used.has(word)
  );
}

function randomStart() {
  if (!DATA.startPool.length) {
    throw new Error(
      '사용 가능한 시작 단어가 없습니다.'
    );
  }

  return DATA.startPool[
    Math.floor(
      Math.random() * DATA.startPool.length
    )
  ];
}

/*
 * 두음법칙
 *
 * 현재 단어의 마지막 글자와
 * 다음 단어의 첫 글자가 정확히 같지 않아도
 * 두음법칙으로 이어질 수 있는 경우를 허용한다.
 */

const DUEUM_MAP = {
  '녀': ['녀', '여'],
  '뇨': ['뇨', '요'],
  '뉴': ['뉴', '유'],
  '니': ['니', '이'],

  '랴': ['랴', '야'],
  '려': ['려', '여'],
  '례': ['례', '예'],
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

function canConnect(current, next) {
  if (!current || !next) {
    return true;
  }

  const last = current.at(-1);
  const first = next[0];

  if (first === last) {
    return true;
  }

  const allowed =
    DUEUM_MAP[last];

  return (
    Array.isArray(allowed) &&
    allowed.includes(first)
  );
}

function candidatesWithDueum(lastChar, used) {
  const result = [];

  /*
   * 정확히 같은 글자로 시작하는 단어
   */
  const exact =
    DATA.byFirst.get(lastChar) || [];

  for (const word of exact) {
    if (!used.has(word)) {
      result.push(word);
    }
  }

  /*
   * 두음법칙으로 이어지는 단어
   */
  const dueum =
    DUEUM_MAP[lastChar] || [];

  for (const first of dueum) {
    if (first === lastChar) {
      continue;
    }

    const list =
      DATA.byFirst.get(first) || [];

    for (const word of list) {
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

function validateWord(
  word,
  current,
  used
) {
  if (!DATA.wordSet.has(word)) {
    return '목록에 없는 단어입니다.';
  }

  if (used.has(word)) {
    return '이미 사용한 단어입니다.';
  }

  if (
    current &&
    !canConnect(current, word)
  ) {
    const last =
      current.at(-1);

    return `'${last}'으로 시작하거나 두음법칙으로 이어지는 단어가 필요합니다.`;
  }

  return null;
}

function publicData() {
  return {
    words: DATA.words,
    attackDepth:
      Object.fromEntries(
        DATA.attackDepth
      ),
    startPool: DATA.startPool
  };
}

module.exports = {
  DATA,
  candidates,
  candidatesWithDueum,
  randomStart,
  validateWord,
  publicData,
  canConnect
};
