(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.KkeutmalRules = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const START_SYLLABLES = ['가', '기', '나', '다', '사', '마', '시', '자', '이', '아'];
  const HANGUL = /^[가-힣]+$/;

  function normalize(word) {
    return String(word || '').trim().normalize('NFC');
  }

  function charsFor(syllable) {
    const c = syllable.charCodeAt(0);
    if (c < 0xAC00 || c > 0xD7A3) return [syllable];

    const offset = c - 0xAC00;
    const choseong = Math.floor(offset / 588);
    const jung = Math.floor((offset % 588) / 28);
    const jong = offset % 28;
    const make = initial => String.fromCharCode(0xAC00 + initial * 588 + jung * 28 + jong);
    const alternatives = new Set([syllable]);

    if (choseong === 5) {
      alternatives.add(make(2));
      alternatives.add(make(11));
    }

    if (choseong === 2 && [2, 6, 7, 8, 12, 13, 17, 18, 20].includes(jung)) {
      alternatives.add(make(11));
    }

    return [...alternatives];
  }

  function canConnect(requiredSyllable, word) {
    const value = normalize(word);
    return value.length > 0 && charsFor(requiredSyllable).includes(value[0]);
  }

  return { START_SYLLABLES, HANGUL, normalize, charsFor, canConnect };
});
