const fs = require('fs');
const path = require('path');

const WORD_FILE = path.join(__dirname, '..', 'data', 'word.txt');
const ATTACK_FILE = path.join(__dirname, '..', 'data', 'attack.txt');

/*
 * 두음법칙
 *
 * ㄹ → ㄴ
 * ㄹ → ㅇ
 * ㄴ → ㅇ
 *
 * 실제 한글 음절의 초성/중성을 계산해서
 * 가능한 첫 글자를 만들어낸다.
 */

function replaceInitial(char, newInitial) {
  const code = char.charCodeAt(0);

  if (code < 0xAC00 || code > 0xD7A3) {
    return char;
  }

  const syllable = code - 0xAC00;
  const medial = Math.floor((syllable % 588) / 28);
  const final = syllable % 28;

  const initialIndex = {
    'ㄱ': 0,
    'ㄴ': 2,
    'ㄹ': 5,
    'ㅇ': 11
  }[newInitial];

  if (initialIndex == null) {
    return char;
  }

  return String.fromCharCode(
    0xAC00 +
    initialIndex * 588 +
    medial * 28 +
    final
  );
}

function allowedNextFirstChars(lastChar) {
  const result = new Set([lastChar]);

  if (!lastChar) {
    return result;
  }

  const code = lastChar.charCodeAt(0);

  if (code < 0xAC00 || code > 0xD7A3) {
    return result;
  }

  const syllable = code - 0xAC00;
  const initial = Math.floor(syllable / 588);
  const medial = Math.floor((syllable % 588) / 28);

  /*
   * ㄹ → ㄴ
   *
   * 라 래 로 뢰 루 르
   * → 나 내 노 뇌 누 느
   */
  if (initial === 5) {
    result.add(replaceInitial(lastChar, 'ㄴ'));

    /*
     * ㄹ → ㅇ
     *
     * 랴 려 례 료 류 리
     * → 야 여 예 요 유 이
     */
    const toIeung = new Set([
      2, 6, 7, 8, 12, 20
    ]);

    if (toIeung.has(medial)) {
      result.add(replaceInitial(lastChar, 'ㅇ'));
    }
  }

  /*
   * ㄴ → ㅇ
   *
   * 냐 녀 녜 뇨 뉴 니
   * → 야 여 예 요 유 이
   */
  if (initial === 2) {
    const toIeung = new Set([
      2, 6, 7, 8, 12, 20
    ]);

    if (toIeung.has(medial)) {
      result.add(replaceInitial(lastChar, 'ㅇ'));
    }
  }

  return result;
}

function canConnect(current, next) {
  if (!current || !next) {
    return true;
  }

  const lastChar = current.at(-1);
  const firstChar = next[0];

  if (lastChar === firstChar) {
    return true;
  }

  return allowedNextFirstChars(lastChar).has(firstChar);
}

function loadData() {
  const rawWords = fs.readFileSync(
    WORD_FILE,
    'utf8'
  )
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const words = [
    ...new Set(
      rawWords.filter(
        w => /^[가-힣]+$/.test(w)
      )
    )
  ];

  const wordSet = new Set(words);

  const byFirst = new Map();

  for (const w of words) {
    const first = w[0];

    if (!byFirst.has(first)) {
      byFirst.set(first, []);
    }

    byFirst.get(first).push(w);
  }

  const attackDepth = new Map();

  let currentGroup = null;

  const attackText = fs.readFileSync(
    ATTACK_FILE,
    'utf8'
  );

  for (
    const line of attackText.split(/\r?\n/)
  ) {
    const s = line.trim();

    const group = s.match(
      /^\[(.+)\]$/
    );

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

    for (
      const w of match[2]
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
    ) {
      if (wordSet.has(w)) {
        attackDepth.set(w, depth);
      }
    }
  }

  /*
   * 시작 단어는:
   * 1. 공격 단어가 아니고
   * 2. 다음 단어가 최소 하나 존재해야 함
   *
   * 따라서 시작하자마자 한방으로 끝나는
   * 단어가 나오지 않는다.
   */

  const startPool = words.filter(w => {
    if (attackDepth.has(w)) {
      return false;
    }

    const next = candidatesForWord(
      w,
      byFirst
    );

    return next.length > 0;
  });

  return {
    words,
    wordSet,
    byFirst,
    attackDepth,
    startPool
  };
}

function candidatesForWord(
  word,
  byFirst
) {
  const result = new Set();

  const possibleFirstChars =
    allowedNextFirstChars(
      word.at(-1)
    );

  for (
    const firstChar of possibleFirstChars
  ) {
    for (
      const next of
        byFirst.get(firstChar) || []
    ) {
      if (next !== word) {
        result.add(next);
      }
    }
  }

  return [...result];
}

const DATA = loadData();

function candidates(lastChar, used) {
  const result = new Set();

  const possibleFirstChars =
    allowedNextFirstChars(lastChar);

  for (
    const firstChar of possibleFirstChars
  ) {
    for (
      const word of
        DATA.byFirst.get(firstChar) || []
    ) {
      if (!used.has(word)) {
        result.add(word);
      }
    }
  }

  return [...result];
}

function randomStart() {
  if (!DATA.startPool.length) {
    return DATA.words[
      Math.floor(
        Math.random() *
        DATA.words.length
      )
    ];
  }

  return DATA.startPool[
    Math.floor(
      Math.random() *
      DATA.startPool.length
    )
  ];
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
    return `'${current.at(-1)}'에서 이어지는 단어가 필요합니다.`;
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
  randomStart,
  validateWord,
  publicData,
  canConnect,
  allowedNextFirstChars
};
