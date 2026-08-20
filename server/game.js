const fs = require('fs');
const path = require('path');

const WORD_FILE = path.join(__dirname, '..', 'data', 'word.txt');
const ATTACK_FILE = path.join(__dirname, '..', 'data', 'attack.txt');

function loadData() {
  const rawWords = fs.readFileSync(WORD_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const words = [...new Set(rawWords.filter(w => /^[가-힣]+$/.test(w)))];
  const wordSet = new Set(words);
  const byFirst = new Map();
  for (const w of words) {
    const c = w[0];
    if (!byFirst.has(c)) byFirst.set(c, []);
    byFirst.get(c).push(w);
  }

  const attackDepth = new Map();
  let current = null;
  for (const line of fs.readFileSync(ATTACK_FILE, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    const group = s.match(/^\[(.+)\]$/);
    if (group) { current = group[1]; continue; }
    const m = s.match(/^깊이\s+(\d+)\s*:\s*(.+)$/);
    if (!m || !current) continue;
    const depth = Number(m[1]);
    for (const w of m[2].split(',').map(x => x.trim()).filter(Boolean)) {
      if (wordSet.has(w)) attackDepth.set(w, depth);
    }
  }

  const startPool = words.filter(w => !attackDepth.has(w) && (byFirst.get(w.at(-1)) || []).some(x => x !== w));
  return { words, wordSet, byFirst, attackDepth, startPool };
}

const DATA = loadData();

function candidates(lastChar, used) {
  const list = DATA.byFirst.get(lastChar) || [];
  return list.filter(w => !used.has(w));
}

function randomStart() {
  return DATA.startPool[Math.floor(Math.random() * DATA.startPool.length)];
}

function validateWord(word, current, used) {
  if (!DATA.wordSet.has(word)) return '목록에 없는 단어입니다.';
  if (used.has(word)) return '이미 사용한 단어입니다.';
  if (current && word[0] !== current.at(-1)) return `'${current.at(-1)}'으로 시작하는 단어가 필요합니다.`;
  return null;
}

function publicData() {
  return {
    words: DATA.words,
    attackDepth: Object.fromEntries(DATA.attackDepth),
    startPool: DATA.startPool
  };
}

module.exports = { DATA, candidates, randomStart, validateWord, publicData };
