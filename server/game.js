const fs = require('fs');
const path = require('path');

console.log(
  'game.js: 데이터 로딩 시작'
);

const WORD_FILE =
  path.join(
    __dirname,
    '..',
    'data',
    'word.txt'
  );

const ATTACK_FILE =
  path.join(
    __dirname,
    '..',
    'data',
    'attack.txt'
  );

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

  '릉': ['릉', '능'],
  '름': ['름', '늠'],
  '릅': ['릅', '늡'],
  '른': ['른', '는'],
  '릎': ['릎', '늪'],
  '릇': ['릇', '늣'],

  '륵': ['륵', '늑'],

  '랏': ['랏', '낫'],
  '롯': ['롯', '놋'],
  '롱': ['롱', '농'],

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

  /*
   * 림 → 임
   */
  '림': ['림', '임'],

  '립': ['립', '입'],
  '륙': ['륙', '육'],
  '륭': ['륭', '융'],
  '렵': ['렵', '엽'],

  /*
   * 륨 → 윰
   * 늄 → 윰
   */
  '륨': ['륨', '윰'],
  '늄': ['늄', '윰'],

  '륜': ['륜', '윤'],

  /*
   * 기타 끝말잇기에서 사용하는 형태
   */
  '릿': ['릿', '잇'],
  '랸': ['랸', '얀'],
  '룔': ['룔', '욜'],

  /*
   * 님 → 임
   *
   * 끝말잇기에서 사용하는 두음 허용 형태.
   */
  '님': ['님', '임'],

  /*
   * 녘 → 옄
   */
  '녘': ['녘', '옄']
};

/* =========================================================
   두음법칙 처리
========================================================= */

function allowedFirstChars(lastChar) {

  if (!lastChar) {
    return [];
  }

  const result = [
    lastChar
  ];

  const extra =
    DUEUM[lastChar];

  if (extra) {

    for (
      const char of extra
    ) {

      if (
        !result.includes(char)
      ) {
        result.push(char);
      }
    }
  }

  return result;
}

function canStartWith(
  word,
  lastChar
) {

  if (
    !word ||
    !lastChar
  ) {
    return false;
  }

  return allowedFirstChars(
    lastChar
  ).includes(
    word[0]
  );
}

/* =========================================================
   단어 로딩
========================================================= */

console.log(
  'game.js: word.txt 읽는 중...'
);

const rawWords =
  fs
    .readFileSync(
      WORD_FILE,
      'utf8'
    )
    .split(/\r?\n/)
    .map(
      word => word.trim()
    )
    .filter(Boolean);

console.log(
  `game.js: word.txt 읽기 완료 (${rawWords.length}개)`
);

/*
 * 중복 제거 + 한글 단어만 허용
 */
const words =
  Array.from(
    new Set(
      rawWords.filter(
        word =>
          /^[가-힣]+$/.test(word)
      )
    )
  );

const wordSet =
  new Set(words);

console.log(
  `game.js: 단어 정리 완료 (${words.length}개)`
);

/* =========================================================
   첫 글자 인덱스
========================================================= */

const byFirst =
  new Map();

for (
  const word of words
) {

  const first =
    word[0];

  let list =
    byFirst.get(first);

  if (!list) {

    list = [];

    byFirst.set(
      first,
      list
    );
  }

  list.push(word);
}

console.log(
  'game.js: 첫 글자별 단어 목록 생성 완료'
);

/* =========================================================
   공격 단어
========================================================= */

console.log(
  'game.js: attack.txt 읽는 중...'
);

const attackDepth =
  new Map();

if (
  fs.existsSync(
    ATTACK_FILE
  )
) {

  const attackLines =
    fs
      .readFileSync(
        ATTACK_FILE,
        'utf8'
      )
      .split(/\r?\n/);

  console.log(
    `game.js: attack.txt 읽기 완료 (${attackLines.length}줄)`
  );

  let currentGroup =
    null;

  for (
    const line of attackLines
  ) {

    const s =
      line.trim();

    if (!s) {
      continue;
    }

    const group =
      s.match(
        /^\[(.+)\]$/
      );

    if (group) {

      currentGroup =
        group[1];

      continue;
    }

    const match =
      s.match(
        /^깊이\s+(\d+)\s*:\s*(.+)$/
      );

    if (
      !match ||
      !currentGroup
    ) {
      continue;
    }

    const depth =
      Number(
        match[1]
      );

    const attackWords =
      match[2]
        .split(',')
        .map(
          word =>
            word.trim()
        )
        .filter(Boolean);

    for (
      const word of attackWords
    ) {

      if (
        !wordSet.has(word)
      ) {
        continue;
      }

      const oldDepth =
        attackDepth.get(
          word
        );

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
   후보 검색
========================================================= */

/*
 * 매우 자주 호출되는 함수라서
 * 배열을 매번 새로 만들도록 유지하되
 * 불필요한 작업은 최소화.
 */

function candidates(
  lastChar,
  used = new Set()
) {

  if (!lastChar) {
    return [];
  }

  const result = [];

  const accepted =
    allowedFirstChars(
      lastChar
    );

  for (
    const firstChar of accepted
  ) {

    const list =
      byFirst.get(
        firstChar
      );

    if (!list) {
      continue;
    }

    for (
      const word of list
    ) {

      if (
        !used.has(word)
      ) {
        result.push(word);
      }
    }
  }

  return result;
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

  /*
   * 이미 사용된 단어까지 포함해서
   * 실제 다음 후보를 계산.
   */
  const nextUsed =
    new Set(used);

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
 * 시작 단어는 매우 중요한 부분.
 *
 * 기존 코드처럼 54만 개 전체를 대상으로
 * 무거운 isOneShot() 검사를 반복하지 않는다.
 */

/*
 * 시작 글자에 해당하는 단어만 먼저 가져온다.
 */
const startCandidates = [];

for (
  const first of START_FIRST
) {

  const list =
    byFirst.get(first);

  if (!list) {
    continue;
  }

  for (
    const word of list
  ) {
    startCandidates.push(
      word
    );
  }
}

console.log(
  `game.js: 시작 후보 생성 완료 (${startCandidates.length}개)`
);

/*
 * 시작 단어의 기본 조건.
 *
 * 1. 가/나/다/마/사/자/기/시
 * 2. 공격 단어 아님
 * 3. 한방 단어 아님
 * 4. 다음 선택지가 어느 정도 존재
 *
 * 여기서는 가장 무거운 전체 트리 계산을 하지 않고
 * 실제 다음 후보가 충분한지만 검사한다.
 */

const startPool = [];

for (
  const word of startCandidates
) {

  /*
   * 공격 루트 시작 단어 방지
   */
  if (
    attackDepth.has(word)
  ) {
    continue;
  }

  /*
   * 자기 자신은 사용된 상태로 계산
   */
  const used =
    new Set([word]);

  const next =
    candidates(
      word.at(-1),
      used
    );

  /*
   * 시작하자마자 끝나는 단어 금지
   */
  if (
    next.length === 0
  ) {
    continue;
  }

  /*
   * 선택지가 너무 적은 단어 금지
   */
  if (
    next.length < 8
  ) {
    continue;
  }

  /*
   * 다음 후보 중 공격 단어가
   * 지나치게 많은 경우 제외.
   *
   * 전체를 검사하지 않고 최대 50개만 검사한다.
   */
  const sampleSize =
    Math.min(
      next.length,
      50
    );

  let attackCount =
    0;

  for (
    let i = 0;
    i < sampleSize;
    i++
  ) {

    if (
      attackDepth.has(
        next[i]
      )
    ) {
      attackCount++;
    }
  }

  /*
   * 시작하자마자 공격 루트로
   * 몰리는 경우 제외.
   */
  if (
    sampleSize >= 10 &&
    attackCount /
      sampleSize >
      0.5
  ) {
    continue;
  }

  startPool.push(
    word
  );
}

console.log(
  `game.js: 시작 단어 생성 완료 (${startPool.length}개)`
);

/* =========================================================
   랜덤 시작
========================================================= */

function randomStart() {

  if (
    !startPool.length
  ) {

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
   공격 깊이
========================================================= */

function getAttackDepth(
  word
) {

  if (!word) {
    return null;
  }

  const depth =
    attackDepth.get(
      word
    );

  return depth == null
    ? null
    : depth;
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

  if (
    !wordSet.has(word)
  ) {
    return '목록에 없는 단어입니다.';
  }

  if (
    used.has(word)
  ) {
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
      allowedFirstChars(
        last
      );

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

    dueum:
      DUEUM
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

  dueum:
    DUEUM
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

  allowedFirstChars,

  isOneShot,

  getAttackDepth
};
