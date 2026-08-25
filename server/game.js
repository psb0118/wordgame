"use strict";

/*
 * =========================================================
 * 끝말잇기 공통 게임 엔진
 * =========================================================
 *
 * word.txt
 *   실제 사용 가능한 전체 단어 목록
 *
 * attack.txt
 *   공격 단어만 존재
 *   예:
 *
 *   가녘 1
 *   가마깥 3
 *   가겍 5
 *
 * attackDepth:
 *   {
 *     "가녘": 1,
 *     "가마깥": 3,
 *     "가겍": 5
 *   }
 *
 * =========================================================
 */


/* =========================================================
   기본 처리
========================================================= */

function normalizeWord(word) {
  if (typeof word !== "string") {
    return "";
  }

  return word
    .trim()
    .replace(/\s+/g, "")
    .normalize("NFC");
}


/* =========================================================
   두음법칙
========================================================= */

function allowedFirstChars(lastChar, dueum = {}) {
  if (!lastChar) {
    return [];
  }

  const result = new Set();

  result.add(lastChar);

  /*
   * 정방향
   *
   * 녀 -> 여
   * 년 -> 연
   */
  const direct = dueum[lastChar];

  if (Array.isArray(direct)) {
    for (const char of direct) {
      if (char) {
        result.add(char);
      }
    }
  }

  /*
   * 역방향
   *
   * 여 -> 녀
   * 연 -> 년
   *
   * 기존 프로젝트의 두음 처리 방식과
   * 호환하기 위한 부분.
   */
  for (const [from, values] of Object.entries(dueum)) {
    if (!Array.isArray(values)) {
      continue;
    }

    if (values.includes(lastChar)) {
      result.add(from);
    }
  }

  return [...result];
}


/* =========================================================
   연결 가능 여부
========================================================= */

function canConnect(
  previousWord,
  nextWord,
  dueum = {}
) {
  previousWord =
    normalizeWord(previousWord);

  nextWord =
    normalizeWord(nextWord);

  if (!previousWord || !nextWord) {
    return false;
  }

  const last =
    previousWord.at(-1);

  const first =
    nextWord.at(0);

  return allowedFirstChars(
    last,
    dueum
  ).includes(first);
}


/* =========================================================
   단어 목록 검사
========================================================= */

function hasWord(word, words) {
  word =
    normalizeWord(word);

  if (!word || !words) {
    return false;
  }

  if (words instanceof Set) {
    return words.has(word);
  }

  if (Array.isArray(words)) {
    return words.includes(word);
  }

  return false;
}


/* =========================================================
   후보 검색
========================================================= */

function getCandidates(
  previousWord,
  usedWords,
  words,
  dueum = {}
) {
  previousWord =
    normalizeWord(previousWord);

  if (!previousWord || !words) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const allowed =
    new Set(
      allowedFirstChars(
        previousWord.at(-1),
        dueum
      )
    );

  const result = [];

  /*
   * words가 Set이면 그대로 순회.
   * 매번 new Set(words)를 만들지 않는다.
   */
  for (const word of words) {
    if (!word) {
      continue;
    }

    if (used.has(word)) {
      continue;
    }

    if (!allowed.has(word.at(0))) {
      continue;
    }

    result.push(word);
  }

  return result;
}


/* =========================================================
   시작 글자 후보
========================================================= */

function getCandidatesFromChar(
  char,
  usedWords,
  words,
  dueum = {}
) {
  if (!char || !words) {
    return [];
  }

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  const allowed =
    new Set(
      allowedFirstChars(
        char,
        dueum
      )
    );

  const result = [];

  for (const word of words) {
    if (!word) {
      continue;
    }

    if (used.has(word)) {
      continue;
    }

    if (!allowed.has(word.at(0))) {
      continue;
    }

    result.push(word);
  }

  return result;
}


/* =========================================================
   공격 데이터
========================================================= */

function getAttackDepth(
  word,
  attackDepth = {}
) {
  if (!word) {
    return null;
  }

  const value =
    attackDepth[word];

  if (value == null) {
    return null;
  }

  const depth =
    Number(value);

  if (!Number.isFinite(depth)) {
    return null;
  }

  return depth;
}


/*
 * attack.txt에는 공격 단어만 있으므로
 *
 * 홀수 깊이 = 공격 성공 계열
 *
 * 로 취급한다.
 *
 * 단, 실제 봇은 이것만 보고 무조건 사용하지 않는다.
 */

function isWinningAttack(
  word,
  attackDepth = {}
) {
  const depth =
    getAttackDepth(
      word,
      attackDepth
    );

  return (
    depth != null &&
    depth % 2 === 1
  );
}


/*
 * attack.txt에 없는 일반 단어는
 * losingAttack가 아니다.
 *
 * 짝수 깊이가 들어오는 경우에만
 * 별도 분석용으로 취급한다.
 */

function isLosingAttack(
  word,
  attackDepth = {}
) {
  const depth =
    getAttackDepth(
      word,
      attackDepth
    );

  return (
    depth != null &&
    depth % 2 === 0
  );
}


/* =========================================================
   후보 분석
========================================================= */

function analyzeWord(
  word,
  usedWords,
  words,
  attackDepth = {},
  dueum = {}
) {
  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);

  /*
   * 이 단어를 사용한 뒤의 상태
   */
  const nextUsed =
    new Set(used);

  nextUsed.add(word);

  /*
   * 상대가 다음 턴에 사용할 수 있는 수
   */
  const next =
    getCandidates(
      word,
      nextUsed,
      words,
      dueum
    );

  const depth =
    getAttackDepth(
      word,
      attackDepth
    );

  return {
    word,

    depth,

    nextCount:
      next.length,

    /*
     * 상대에게 선택지가 하나도 없음.
     */
    oneShot:
      next.length === 0,

    /*
     * 공격 단어인지
     */
    winningAttack:
      depth != null &&
      depth % 2 === 1,

    /*
     * 짝수 깊이가 존재하는 경우
     */
    losingAttack:
      depth != null &&
      depth % 2 === 0
  };
}


/* =========================================================
   상대가 다음에 막힐 가능성 분석
========================================================= */

function analyzeFutureRisk(
  info,
  words,
  usedWords,
  dueum
) {
  /*
   * 상대가 info.word에 답한 뒤
   * 봇에게 돌아올 후보를 확인한다.
   */

  const usedAfterOpponent =
    usedWords instanceof Set
      ? new Set(usedWords)
      : new Set(usedWords || []);

  usedAfterOpponent.add(info.word);

  const opponentCandidates =
    getCandidates(
      info.word,
      usedAfterOpponent,
      words,
      dueum
    );

  /*
   * 상대 선택지가 많으면
   * 상대가 좋은 수를 고를 가능성이 높다.
   */

  if (opponentCandidates.length === 0) {
    return {
      risk: 0,
      botNextCount: 0
    };
  }

  /*
   * 상대 후보 중 하나씩 봇에게 돌아오는 상황을
   * 간단하게 샘플링한다.
   *
   * 모든 후보를 깊게 탐색하면
   * 50만 단어에서 너무 느려질 수 있으므로
   * 최대 일부만 검사한다.
   */

  const limit =
    Math.min(
      opponentCandidates.length,
      60
    );

  let dangerous = 0;

  for (let i = 0; i < limit; i++) {
    const opponentWord =
      opponentCandidates[i];

    const nextUsed =
      new Set(
        usedAfterOpponent
      );

    nextUsed.add(
      opponentWord
    );

    const botCandidates =
      getCandidates(
        opponentWord,
        nextUsed,
        words,
        dueum
      );

    if (botCandidates.length === 0) {
      dangerous++;
    }
  }

  return {
    risk:
      dangerous / limit,

    botNextCount:
      Math.max(
        0,
        limit - dangerous
      )
  };
}


/* =========================================================
   봇 후보 점수
========================================================= */

/*
 * 핵심 AI 정책
 *
 * 상대 선택지 0개
 *   -> 매우 강한 공격
 *
 * 상대 선택지 1개
 *   -> 강한 공격
 *
 * 상대 선택지 많음
 *   -> 중간 정도
 *
 * 내가 다음 턴에 막힐 가능성이 높음
 *   -> 위험한 수
 *
 * 현재 승률이 너무 높음
 *   -> 공격 강도 감소
 */

function scoreBotCandidate({
  info,
  futureRisk,
  strength,
  winBias
}) {
  let score = 0;

  const nextCount =
    info.nextCount;

  const depth =
    info.depth ?? 0;

  const risk =
    futureRisk?.risk ?? 0;


  /* =======================================================
     1. 상대 선택지
  ======================================================= */

  if (nextCount === 0) {
    /*
     * 즉시 승리
     *
     * 단, 승률이 이미 너무 높으면
     * 아래 winBias에서 일부 감쇠한다.
     */
    score += 12000;
  }

  else if (nextCount === 1) {
    score += 4200;
  }

  else if (nextCount <= 4) {
    score += 1700;
  }

  else if (nextCount <= 10) {
    score += 500;
  }

  else {
    /*
     * 선택지가 많으면
     * 너무 공격적으로 보지 않는다.
     */
    score += 80;
  }


  /* =======================================================
     2. 공격 단어
  ======================================================= */

  if (info.winningAttack) {

    score +=
      900 +
      depth * 45;

    /*
     * 공격 깊이가 높을수록
     * 이론적인 공격력이 강하다고 본다.
     */
    score +=
      Math.min(
        depth,
        30
      ) * 25;
  }


  /* =======================================================
     3. 일반 단어
  ======================================================= */

  if (!info.winningAttack) {

    /*
     * 일반 단어는 너무 강하지 않게
     * 선택지를 확보하는 정도만 평가.
     */
    score +=
      Math.min(
        nextCount,
        30
      ) * 12;
  }


  /* =======================================================
     4. 내가 위험한지
  ======================================================= */

  if (risk >= 0.75) {
    /*
     * 이 수를 두면
     * 봇이 다음 턴에 막힐 가능성이 높음.
     */
    score -= 4500;
  }

  else if (risk >= 0.50) {
    score -= 2200;
  }

  else if (risk >= 0.25) {
    score -= 700;
  }


  /* =======================================================
     5. 승률 조절
  ======================================================= */

  /*
   * winBias
   *
   * 0.50 = 정상
   * 0.60 이상 = 봇이 너무 유리
   * 0.40 이하 = 플레이어가 너무 유리
   */

  if (winBias > 0.60) {

    /*
     * 봇이 너무 강함.
     *
     * 공격 수를 약화한다.
     */
    if (info.winningAttack) {
      score -=
        (winBias - 0.60) *
        9000;
    }

    /*
     * 즉시 승리도 일부 감쇠.
     */
    if (info.oneShot) {
      score -=
        (winBias - 0.60) *
        7000;
    }
  }


  else if (winBias < 0.40) {

    /*
     * 플레이어가 너무 유리함.
     *
     * 공격 수를 강화.
     */
    if (info.winningAttack) {
      score +=
        (0.40 - winBias) *
        7000;
    }

    if (info.nextCount <= 1) {
      score +=
        (0.40 - winBias) *
        4000;
    }
  }


  /* =======================================================
     6. 난이도
  ======================================================= */

  /*
   * strength가 높을수록
   * 공격을 조금 더 선호.
   */

  if (info.winningAttack) {
    score +=
      strength *
      1800;
  }

  else {
    score +=
      (1 - strength) *
      250;
  }


  return score;
}


/* =========================================================
   봇 선택
========================================================= */

function chooseBotWord({
  currentWord = null,
  startChar = "",
  usedWords = new Set(),
  words,
  dueum = {},
  attackDepth = {},
  strength = 0.50,
  winBias = 0.50
}) {

  const used =
    usedWords instanceof Set
      ? usedWords
      : new Set(usedWords || []);


  /* =======================================================
     후보 생성
  ======================================================= */

  const candidates =
    currentWord
      ? getCandidates(
          currentWord,
          used,
          words,
          dueum
        )
      : getCandidatesFromChar(
          startChar,
          used,
          words,
          dueum
        );


  if (!candidates.length) {
    return null;
  }


  /* =======================================================
     후보 분석
  ======================================================= */

  const analyzed =
    candidates.map(
      word =>
        analyzeWord(
          word,
          used,
          words,
          attackDepth,
          dueum
        )
    );


  /* =======================================================
     첫 수 특별 처리
  ======================================================= */

  if (!currentWord) {

    /*
     * 첫 수에서 바로 게임을 끝내는 단어를
     * 우선적으로 피한다.
     */

    const safe =
      analyzed.filter(
        info =>
          !info.oneShot &&
          !info.winningAttack
      );

    if (safe.length > 0) {
      return chooseFromScored(
        safe,
        used,
        words,
        dueum,
        strength,
        winBias
      );
    }
  }


  return chooseFromScored(
    analyzed,
    used,
    words,
    dueum,
    strength,
    winBias
  );
}


/* =========================================================
   점수 계산 후 선택
========================================================= */

function chooseFromScored(
  analyzed,
  used,
  words,
  dueum,
  strength,
  winBias
) {

  const scored = [];

  /*
   * 모든 후보를 미래 분석하면 너무 느릴 수 있으므로
   * 우선 기본 점수를 계산한다.
   */

  const preliminary =
    analyzed.map(
      info => {

        let base = 0;

        if (info.oneShot) {
          base += 12000;
        }

        if (info.winningAttack) {
          base +=
            900 +
            (info.depth ?? 0) * 45;
        }

        base +=
          Math.min(
            info.nextCount,
            30
          ) * 12;

        return {
          info,
          base
        };
      }
    );


  /*
   * 후보가 매우 많을 때는
   * 상위 후보만 미래 위험까지 계산한다.
   *
   * 이렇게 해야 새 게임이 지나치게 오래 걸리는
   * 문제를 막을 수 있다.
   */

  preliminary.sort(
    (a, b) =>
      b.base - a.base
  );


  const analysisLimit =
    Math.min(
      preliminary.length,
      80
    );


  for (
    let i = 0;
    i < analysisLimit;
    i++
  ) {

    const info =
      preliminary[i].info;

    const futureRisk =
      analyzeFutureRisk(
        info,
        words,
        used,
        dueum
      );


    const score =
      scoreBotCandidate({
        info,
        futureRisk,
        strength,
        winBias
      });


    scored.push({
      info,
      score
    });
  }


  /*
   * 나머지 후보는
   * 미래 분석 없이 기본 점수만 사용.
   */

  for (
    let i = analysisLimit;
    i < preliminary.length;
    i++
  ) {

    const info =
      preliminary[i].info;

    const score =
      scoreBotCandidate({
        info,
        futureRisk: {
          risk: 0.2,
          botNextCount:
            info.nextCount
        },
        strength,
        winBias
      });

    scored.push({
      info,
      score
    });
  }


  if (!scored.length) {
    return null;
  }


  scored.sort(
    (a, b) =>
      b.score - a.score
  );


  /* =======================================================
     선택 풀
  ======================================================= */

  let poolSize;


  if (strength >= 0.85) {
    poolSize = 3;
  }

  else if (strength >= 0.70) {
    poolSize = 5;
  }

  else if (strength >= 0.55) {
    poolSize = 8;
  }

  else {
    poolSize = 12;
  }


  /*
   * 승률이 너무 높으면
   * 더 넓은 후보에서 선택한다.
   */
  if (winBias > 0.60) {
    poolSize += 8;
  }


  /*
   * 승률이 너무 낮으면
   * 상위 공격 후보에 조금 더 집중한다.
   */
  if (winBias < 0.40) {
    poolSize =
      Math.max(
        2,
        poolSize - 3
      );
  }


  const pool =
    scored.slice(
      0,
      Math.min(
        poolSize,
        scored.length
      )
    );


  /*
   * 최고 점수와 너무 차이 나는 수는
   * 선택하지 않는다.
   *
   * 완전히 랜덤하게 해서 AI가
   * 이상한 단어를 내는 것을 방지한다.
   */

  const bestScore =
    pool[0].score;

  const reasonable =
    pool.filter(
      item =>
        item.score >=
        bestScore - 900
    );


  const finalPool =
    reasonable.length
      ? reasonable
      : [pool[0]];


  const selected =
    finalPool[
      Math.floor(
        Math.random() *
        finalPool.length
      )
    ];


  return selected.info.word;
}


/* =========================================================
   게임 생성
========================================================= */

function createGame({
  startChar = "",
  startPlayer = 0
} = {}) {

  return {

    startChar,

    currentWord: null,

    turnPlayer:
      startPlayer,

    history: [],

    usedWords:
      new Set(),

    finished: false,

    winner: null,

    loser: null
  };
}


/* =========================================================
   단어 플레이
========================================================= */

function playWord(
  game,
  word,
  words,
  dueum = {},
  attackDepth = {}
) {

  if (!game) {
    return {
      ok: false,
      reason:
        "게임 정보를 찾을 수 없습니다."
    };
  }


  if (game.finished) {
    return {
      ok: false,
      reason:
        "이미 끝난 게임입니다."
    };
  }


  word =
    normalizeWord(word);


  if (!word) {
    return {
      ok: false,
      reason:
        "단어를 입력해주세요."
    };
  }


  /* =======================================================
     단어 목록
  ======================================================= */

  if (!hasWord(word, words)) {
    return {
      ok: false,
      reason:
        "단어 목록에 없는 단어입니다."
    };
  }


  /* =======================================================
     중복
  ======================================================= */

  if (game.usedWords.has(word)) {
    return {
      ok: false,
      reason:
        "이미 사용한 단어입니다."
    };
  }


  /* =======================================================
     첫 단어
  ======================================================= */

  if (!game.currentWord) {

    if (
      game.startChar &&
      !allowedFirstChars(
        game.startChar,
        dueum
      ).includes(
        word.at(0)
      )
    ) {

      return {
        ok: false,

        reason:
          `"${game.startChar}"으로 시작하는 단어가 아닙니다.`
      };
    }
  }


  /* =======================================================
     연결
  ======================================================= */

  if (
    game.currentWord &&
    !canConnect(
      game.currentWord,
      word,
      dueum
    )
  ) {

    const last =
      game.currentWord.at(-1);

    return {
      ok: false,

      reason:
        `"${last}" 다음에 연결할 수 없는 단어입니다.`,

      allowed:
        allowedFirstChars(
          last,
          dueum
        )
    };
  }


  /* =======================================================
     현재 플레이어
  ======================================================= */

  const player =
    game.turnPlayer;


  /* =======================================================
     등록
  ======================================================= */

  game.currentWord =
    word;

  game.usedWords.add(
    word
  );

  game.history.push({

    word,

    player,

    turn:
      game.history.length + 1,

    depth:
      getAttackDepth(
        word,
        attackDepth
      )
  });


  /* =======================================================
     다음 플레이어
  ======================================================= */

  game.turnPlayer =
    player === 0
      ? 1
      : 0;


  /* =======================================================
     다음 후보
  ======================================================= */

  const next =
    getCandidates(
      word,
      game.usedWords,
      words,
      dueum
    );


  /* =======================================================
     게임 종료
  ======================================================= */

  if (!next.length) {

    game.finished = true;

    game.winner =
      player;

    game.loser =
      game.turnPlayer;


    return {

      ok: true,

      finished: true,

      winner: player,

      loser:
        game.turnPlayer,

      word,

      depth:
        getAttackDepth(
          word,
          attackDepth
        ),

      nextCount: 0
    };
  }


  return {

    ok: true,

    finished: false,

    word,

    depth:
      getAttackDepth(
        word,
        attackDepth
      ),

    nextTurn:
      game.turnPlayer,

    nextCount:
      next.length
  };
}


/* =========================================================
   공개 상태
========================================================= */

function getPublicGameState(game) {

  if (!game) {
    return null;
  }


  return {

    startChar:
      game.startChar,

    currentWord:
      game.currentWord,

    turnPlayer:
      game.turnPlayer,

    history:
      game.history.map(
        item => ({
          word: item.word,

          player:
            item.player,

          turn:
            item.turn,

          depth:
            item.depth
        })
      ),

    finished:
      game.finished,

    winner:
      game.winner,

    loser:
      game.loser
  };
}


/* =========================================================
   exports
========================================================= */

module.exports = {

  normalizeWord,

  allowedFirstChars,

  canConnect,

  hasWord,

  getCandidates,

  getCandidatesFromChar,

  getAttackDepth,

  isWinningAttack,

  isLosingAttack,

  analyzeWord,

  analyzeFutureRisk,

  createGame,

  playWord,

  chooseBotWord,

  getPublicGameState
};
