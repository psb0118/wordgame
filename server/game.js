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

  // 게임에서 허용하는 추가 규칙
  '레': ['레', '에'],
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

function allowedFirstChars(lastChar) {
  if (!lastChar) {
    return [];
  }

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
  if (!word || !lastChar) {
    return false;
  }

  return allowedFirstChars(lastChar).includes(word[0]);
}

/* =========================================================
   단어 로딩
========================================================= */

console.log('game.js: word.txt 읽는 중...');

const rawWords = fs
  .readFileSync(WORD_FILE, 'utf8')
  .split(/\r?\n/);

console.log(
  `game.js: word.txt 읽기 완료 (${rawWords.length}개)`
);

const wordSet = new Set();
const words = [];

for (const raw of rawWords) {
  const word = raw.trim();

  if (!word) {
    continue;
  }

  if (!/^[가-힣]+$/.test(word)) {
    continue;
  }

  if (wordSet.has(word)) {
    continue;
  }

  wordSet.add(word);
  words.push(word);
}

console.log(
  `game.js: 단어 정리 완료 (${words.length}개)`
);

/* =========================================================
   첫 글자별 인덱스
========================================================= */

const byFirst = new Map();

for (const word of words) {
  const first = word[0];

  let list = byFirst.get(first);

  if (!list) {
    list = [];
    byFirst.set(first, list);
  }

  list.push(word);
}

console.log(
  'game.js: 첫 글자별 단어 목록 생성 완료'
);

/* =========================================================
   공격 단어 (attack.txt 검증 강화)
========================================================= */

console.log('game.js: attack.txt 읽는 중...');

const attackDepth = new Map();
const validAttackWords = new Set(); // Phase 1: 검증된 공격 단어만 저장

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

    if (!s) {
      continue;
    }

    const group = s.match(/^\[(.+)\]$/);

    if (group) {
      currentGroup = group[1];
      continue;
    }

    const match = s.match(
      /^깊이\s+(\d+)\s*:\s*(.+)$/
    );

    if (!match || !currentGroup) {
      continue;
    }

    const depth = Number(match[1]);

    const attackWords = match[2]
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    for (const word of attackWords) {
      // Phase 1: word.txt에 실제로 존재하는지 검증
      if (!wordSet.has(word)) {
        console.warn(
          `game.js: 공격 단어 "${word}"는 word.txt에 없습니다. 제외됨.`
        );
        continue;
      }

      validAttackWords.add(word);
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
  `game.js: 공격 단어 처리 완료 (${attackDepth.size}개 / 원본 ${validAttackWords.size}개 검증됨)`
);

/* =========================================================
   후보 검색
========================================================= */

function candidates(lastChar, used = new Set()) {
  if (!lastChar) {
    return [];
  }

  const result = [];

  for (const firstChar of allowedFirstChars(lastChar)) {
    const list = byFirst.get(firstChar);

    if (!list) {
      continue;
    }

    for (const word of list) {
      if (!used.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

/* =========================================================
   후보 개수
========================================================= */

function countCandidates(lastChar, used = new Set()) {
  if (!lastChar) {
    return 0;
  }

  let count = 0;

  for (const firstChar of allowedFirstChars(lastChar)) {
    const list = byFirst.get(firstChar);

    if (!list) {
      continue;
    }

    for (const word of list) {
      if (!used.has(word)) {
        count++;
      }
    }
  }

  return count;
}

/* =========================================================
   한방 단어 (정확한 검증)
========================================================= */

function isOneShot(word, used = new Set()) {
  if (!word) {
    return true;
  }

  const nextUsed = new Set(used);
  nextUsed.add(word);

  return countCandidates(
    word.at(-1),
    nextUsed
  ) === 0;
}

/* =========================================================
   시작 음절
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

function randomStart() {
  return START_FIRST[
    Math.floor(
      Math.random() * START_FIRST.length
    )
  ];
}

/* =========================================================
   첫 단어 검증
========================================================= */

function validateFirstWord(word, startChar) {
  if (!word) {
    return '단어를 입력해주세요.';
  }

  if (!wordSet.has(word)) {
    return '목록에 없는 단어입니다.';
  }

  if (!startChar) {
    return '시작 음절이 없습니다.';
  }

  if (!word.startsWith(startChar)) {
    return (
      `'${startChar}'으로 시작하는 단어를 입력해야 합니다.`
    );
  }

  /*
   * 첫 단어 공격 금지
   */
  if (attackDepth.has(word)) {
    return '첫 단어에서는 공격 단어를 사용할 수 없습니다.';
  }

  /*
   * 첫 단어 한방 금지
   */
  if (isOneShot(word)) {
    return '첫 단어로 한방 단어는 사용할 수 없습니다.';
  }

  /*
   * 첫 단어는 어느 정도 선택지가 있어야 함
   */
  const nextCount = countCandidates(
    word.at(-1),
    new Set([word])
  );

  if (nextCount < 5) {
    return (
      '첫 단어로는 선택지가 너무 적은 단어를 사용할 수 없습니다.'
    );
  }

  return null;
}

/* =========================================================
   일반 단어 검증
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
    const last = current.at(-1);

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
   공격 깊이
========================================================= */

function getAttackDepth(word) {
  if (!word) {
    return null;
  }

  return attackDepth.has(word)
    ? attackDepth.get(word)
    : null;
}

/* =========================================================
   공격 후보 추출 (Phase 2 용)
========================================================= */

function getAttackCandidates(lastChar, used = new Set()) {
  const all = candidates(lastChar, used);
  return all.filter(w => attackDepth.has(w));
}

function countAttackCandidates(lastChar, used = new Set()) {
  return getAttackCandidates(lastChar, used).length;
}

/* =========================================================
   클라이언트 데이터
========================================================= */

function publicData() {
  const byFirstObject = {};

  for (const [first, list] of byFirst.entries()) {
    byFirstObject[first] = list;
  }

  return {
    byFirst: byFirstObject,

    attackDepth:
      Object.fromEntries(
        attackDepth
      ),

    startFirst: START_FIRST,

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
  startPool: [],
  startFirst: START_FIRST,
  dueum: DUEUM
};

console.log(
  'game.js: 모든 데이터 로딩 완료'
);

/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  DATA,

  candidates,

  countCandidates,

  randomStart,

  validateWord,

  validateFirstWord,

  publicData,

  canStartWith,

  allowedFirstChars,

  isOneShot,

  getAttackDepth,

  // Phase 2용 추가 함수
  getAttackCandidates,

  countAttackCandidates
};
