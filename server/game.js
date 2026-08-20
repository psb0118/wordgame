const fs = require('fs');
const path = require('path');

console.log('game.js: 데이터 로딩 시작');

const WORD_FILE = path.join(__dirname, '..', 'data', 'word.txt');
const ATTACK_FILE = path.join(__dirname, '..', 'data', 'attack.txt');


/* =========================================================
   두음법칙
========================================================= */

const DUEUM = {
  /* ㄴ → ㅇ */

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

  /* ㄹ → ㄴ */

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

  /* ㄹ → ㅇ */

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

  /* 추가 */

  '님': ['님', '임'],

  '륨': ['륨', '윰'],
  '늄': ['늄', '윰'],

  '륜': ['륜', '윤'],

  '릿': ['릿', '잇'],

  '랸': ['랸', '얀'],
  '룔': ['룔', '욜']
};


/* =========================================================
   두음법칙
========================================================= */

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


/*
 * server.js 호환용
 */

function canConnect(word, lastChar) {
  return canStartWith(word, lastChar);
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
   마지막 글자별 후보 수
========================================================= */

/*
 * 여기서 중요한 최적화.
 *
 * 기존에는 시작 단어 하나마다 candidates()를 호출하고
 * 그 안에서 배열을 계속 만들었음.
 *
 * 이제 마지막 글자별 후보 개수를 미리 계산한다.
 */

const nextCountByLast = new Map();

for (const lastChar of byFirst.keys()) {
  let count = 0;

  const allowed =
    allowedFirstChars(lastChar);

  for (const firstChar of allowed) {
    const list =
      byFirst.get(firstChar);

    if (list) {
      count += list.length;
    }
  }

  nextCountByLast.set(
    lastChar,
    count
  );
}


/* =========================================================
   공격 단어
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

    if (!s) {
      continue;
    }


    const group =
      s.match(/^\[(.+)\]$/);

    if (group) {
      currentGroup = group[1];
      continue;
    }


    const match =
      s.match(/^깊이\s+(\d+)\s*:\s*(.+)$/);

    if (!match || !currentGroup) {
      continue;
    }

    const depth =
      Number(match[1]);

    const attackWords =
      match[2]
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);


    for (const word of attackWords) {

      if (!wordSet.has(word)) {
        continue;
      }

      const oldDepth =
        attackDepth.get(word);

      if (
        oldDepth == null ||
        depth < oldDepth
      ) {
        attackDepth.set(
          word,
          depth
        );
      }
    }
  }
}

console.log(
  `game.js: 공격 단어 처리 완료 (${attackDepth.size}개)`
);


/* =========================================================
   공격 깊이
========================================================= */

function getAttackDepth(word) {

  if (!word) {
    return null;
  }

  const depth =
    attackDepth.get(word);

  return depth == null
    ? null
    : depth;
}


/* =========================================================
   후보 검색
========================================================= */

function candidates(
  lastChar,
  used = new Set()
) {

  const result = [];

  const allowed =
    allowedFirstChars(lastChar);


  for (const firstChar of allowed) {

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


/* =========================================================
   후보 개수
========================================================= */

function candidateCount(
  lastChar,
  used = new Set()
) {

  let count = 0;

  const allowed =
    allowedFirstChars(lastChar);


  for (const firstChar of allowed) {

    const list =
      byFirst.get(firstChar);

    if (!list) {
      continue;
    }


    if (!used.size) {
      count += list.length;
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
   한방 단어
========================================================= */

function isOneShot(
  word,
  used = new Set()
) {

  if (!word) {
    return true;
  }

  const nextUsed =
    new Set(used);

  nextUsed.add(word);

  return (
    candidateCount(
      word.at(-1),
      nextUsed
    ) === 0
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
 * 시작 단어용 빠른 검사.
 *
 * 기존 버전:
 *
 * 54만 단어
 * × candidates()
 * × 여러 번 isOneShot()
 *
 * 을 수행해서 매우 느렸음.
 *
 * 현재 버전:
 *
 * 1. 첫 글자
 * 2. 공격 단어 여부
 * 3. 마지막 글자의 후보 수
 *
 * 를 먼저 확인하고,
 * 필요한 경우에만 일부 후보를 확인한다.
 */

function isBadStart(word) {

  /* 지정된 첫 글자만 허용 */

  if (
    !START_FIRST.includes(
      word[0]
    )
  ) {
    return true;
  }


  /* 시작 단어 자체가 공격 단어면 제외 */

  if (
    attackDepth.has(word)
  ) {
    return true;
  }


  /*
   * 마지막 글자에서 갈 수 있는
   * 전체 후보 수.
   *
   * 두음법칙 적용.
   */

  const last =
    word.at(-1);

  const totalNext =
    nextCountByLast.get(last) || 0;


  /*
   * 시작하자마자 선택지가 너무 적으면 제외.
   */

  if (totalNext < 8) {
    return true;
  }


  /*
   * 여기부터는 정말 필요한 경우만
   * 후보 일부를 검사한다.
   *
   * 전체 후보를 매번 검사하지 않는다.
   */

  const allowed =
    allowedFirstChars(last);


  let attackCount = 0;
  let oneShotCount = 0;
  let checked = 0;


  /*
   * 최대 30개만 검사.
   *
   * 시작 단어 3만 개 이상을 검사할 때
   * 속도 차이가 매우 큼.
   */

  const MAX_SAMPLE = 30;


  for (
    const firstChar of allowed
  ) {

    const list =
      byFirst.get(firstChar);

    if (!list) {
      continue;
    }


    for (
      const nextWord of list
    ) {

      if (
        nextWord === word
      ) {
        continue;
      }


      if (
        attackDepth.has(nextWord)
      ) {
        attackCount++;
      }


      /*
       * 한방 검사는 비싼 작업이므로
       * 최대 30개 샘플에서만 검사.
       */

      const nextLast =
        nextWord.at(-1);

      const nextCount =
        nextCountByLast.get(
          nextLast
        ) || 0;


      if (nextCount <= 1) {
        oneShotCount++;
      }


      checked++;


      if (
        checked >= MAX_SAMPLE
      ) {
        break;
      }

    }


    if (
      checked >= MAX_SAMPLE
    ) {
      break;
    }
  }


  /*
   * 공격 단어가 샘플의 35% 이상이면
   * 시작 단어로 부적합.
   */

  if (
    checked >= 10 &&
    attackCount / checked > 0.35
  ) {
    return true;
  }


  /*
   * 한방으로 이어질 가능성이 높은 단어가
   * 샘플의 45% 이상이면 제외.
   */

  if (
    checked >= 10 &&
    oneShotCount / checked > 0.45
  ) {
    return true;
  }


  return false;
}


/*
 * 시작 단어 생성
 */

const startPool =
  words.filter(
    word => !isBadStart(word)
  );


console.log(
  `game.js: 시작 단어 생성 완료 (${startPool.length}개)`
);


/* =========================================================
   랜덤 시작 단어
========================================================= */

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


    if (
      accepted.length > 1
    ) {

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


/* =========================================================
   EXPORT
========================================================= */

module.exports = {

  DATA,

  candidates,

  randomStart,

  validateWord,

  publicData,

  canStartWith,

  canConnect,

  allowedFirstChars,

  isOneShot,

  getAttackDepth

};
