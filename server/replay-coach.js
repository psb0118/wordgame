"use strict";

/* AI 복기 코치
   ---------------------------------------------------------
   리플레이의 단어 흐름만으로 결정적인 피드백을 만든다. 외부 AI 호출 없이
   서버에서 즉시 응답하며, 개인정보(내부 ID)는 사용하지 않는다.
   공격 깊이/한방 여부는 이미 리플레이에 포함된 값을 사용한다. */

const MAX_WORDS = 200;

function cleanWord(value) {
  return String(value == null ? "" : value).replace(/\s+/g, "").slice(0, 30);
}

function toInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function normalizeFlow(flow, myIndex) {
  const out = [];
  const idx = Number.isInteger(Number(myIndex)) ? Number(myIndex) : null;
  for (const item of Array.isArray(flow) ? flow : []) {
    if (!item || typeof item !== "object") continue;
    const word = cleanWord(item.w != null ? item.w : item.word);
    if (!word) continue;
    const player = toInt(item.player, -1, 999);
    out.push({
      word,
      player,
      mine: item.mine === true || item.m === true || (idx != null && player === idx),
      depth: toInt(item.depth != null ? item.depth : item.d, 0, 99) || 0,
      oneShot: item.oneShot === true || item.o === true,
      turn: toInt(item.turn != null ? item.turn : item.t, 0, 9999)
    });
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

function average(list) {
  return list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function analyze(flow, opts = {}) {
  const words = normalizeFlow(flow, opts.myIndex);
  if (words.length < 2) {
    return { ok: false, reason: "분석할 단어가 부족합니다." };
  }
  const mine = words.filter(item => item.mine);
  const theirs = words.filter(item => !item.mine);
  const mineLengths = mine.map(item => item.word.length);
  const theirLengths = theirs.map(item => item.word.length);
  const myAvg = average(mineLengths);
  const theirAvg = average(theirLengths);
  const myLong = mine.filter(item => item.word.length >= 4).length;
  const myAttacks = mine.filter(item => item.depth > 0 || item.oneShot).length;
  const myOneShots = mine.filter(item => item.oneShot).length;
  const myShort = mine.filter(item => item.word.length <= 2).length;
  const longest = mine.reduce((best, item) => (!best || item.word.length > best.word.length ? item : best), null);
  const opponentLongest = theirs.reduce((best, item) => (!best || item.word.length > best.word.length ? item : best), null);
  const win = opts.win === true || opts.result === "win";
  const loss = opts.result === "lose";
  const destroyed = mine.length === 0;

  const tips = [];
  if (destroyed) {
    tips.push({
      icon: "🌱",
      title: "첫 단어를 만들어 보세요",
      body: "이번 흐름에는 내 단어가 없습니다. 짧은 단어라도 먼저 연결하면 리듬을 잡을 수 있어요."
    });
  } else if (myAvg < 3) {
    tips.push({
      icon: "📏",
      title: "3글자 이상을 노려 보세요",
      body: `내 평균 단어 길이가 ${round1(myAvg)}자입니다. 긴 단어는 상대의 다음 선택지를 줄여 줍니다.`
    });
  } else {
    tips.push({
      icon: "📏",
      title: "길이 싸움은 좋아요",
      body: `내 평균 ${round1(myAvg)}자로 상대(${round1(theirAvg)}자)보다 ${myAvg >= theirAvg ? "길거나 비슷합니다" : "짧습니다"}. 4글자 이상 단어를 한 번 더 섞어 보세요.`
    });
  }

  if (myAttacks === 0) {
    tips.push({
      icon: "⚡",
      title: "공격 단어를 아껴 두세요",
      body: "공격 단어가 한 번도 나오지 않았습니다. 상대가 짧게 끝낼 때를 기다렸다가 한 번에 압박해 보세요."
    });
  } else if (mine.length > 0 && myAttacks / mine.length < 0.2) {
    tips.push({
      icon: "🎯",
      title: "공격 타이밍을 조금 더",
      body: `내 단어 ${mine.length}개 중 공격은 ${myAttacks}개입니다. 연결이 끊길 것 같은 순간에 공격을 집중해 보세요.`
    });
  } else {
    tips.push({
      icon: "🔥",
      title: "압박 흐름이 좋습니다",
      body: `공격 ${myAttacks}개${myOneShots ? ` · 한방 ${myOneShots}개` : ""}로 상대를 흔들었습니다. 같은 리듬을 유지해 보세요.`
    });
  }

  if (myShort >= 3 && myLong === 0) {
    tips.push({
      icon: "🧠",
      title: "짧은 단어만으로는 한계가 있어요",
      body: "2글자 이하 단어가 많고 4글자 이상 단어가 없습니다. 단어장에 긴 단어를 저장해 두면 선택지가 넓어집니다."
    });
  } else if (opponentLongest && longest && opponentLongest.word.length >= longest.word.length + 2) {
    tips.push({
      icon: "🛡️",
      title: "상대의 긴 단어를 견제하세요",
      body: `상대 최장 단어는 '${opponentLongest.word}'(${opponentLongest.word.length}자)입니다. 끝 글자를 좁히는 짧은 응수가 효과적입니다.`
    });
  } else if (win) {
    tips.push({
      icon: "🏆",
      title: "이기는 흐름을 복기했어요",
      body: "승리한 판입니다. 오늘 사용한 연결 단어를 단어장에 저장해 다음 판에도 재사용해 보세요."
    });
  } else if (loss) {
    tips.push({
      icon: "🔁",
      title: "패배 지점을 한 번만 더",
      body: "마지막 2~3수에서 선택지가 좁아졌는지 확인해 보세요. 다음 판에는 그 전에 공격을 섞는 편이 좋습니다."
    });
  } else {
    tips.push({
      icon: "🧭",
      title: "다음 판 목표",
      body: "4글자 이상 단어 2개와 공격 단어 1개를 목표로 플레이해 보세요."
    });
  }

  let score = 55;
  score += Math.min(18, myLong * 4);
  score += Math.min(18, myAttacks * 6);
  score += Math.min(9, Math.round(myAvg * 2));
  score += win ? 8 : 0;
  score -= Math.min(12, myShort * 2);
  if (destroyed) score = 20;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 85 ? "S" : score >= 72 ? "A" : score >= 58 ? "B" : score >= 42 ? "C" : "D";

  return {
    ok: true,
    score,
    grade,
    headline: win
      ? "승리한 판의 강점을 복기했어요."
      : loss
        ? "패배 지점을 다음 판의 무기로 바꿔 봐요."
        : "이번 판의 습관을 한눈에 정리했어요.",
    stats: {
      myWords: mine.length,
      opponentWords: theirs.length,
      avgLength: round1(myAvg),
      opponentAvgLength: round1(theirAvg),
      longWords: myLong,
      attacks: myAttacks,
      oneShots: myOneShots,
      longestWord: longest ? longest.word : "",
      opponentLongestWord: opponentLongest ? opponentLongest.word : ""
    },
    tips: tips.slice(0, 3)
  };
}

module.exports = { MAX_WORDS, normalizeFlow, analyze };
