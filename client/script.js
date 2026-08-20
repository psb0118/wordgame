const $ = id =>
  document.getElementById(id);

/* =========================================================
   기본 상태
========================================================= */

let data = null;

let used = new Set();

let current = '';

let startChar = '';

let turn = 0;

let over = false;

let playerTurn = true;

let wins = 0;
let losses = 0;
let totalTurns = 0;

/* =========================================================
   두음법칙
========================================================= */

let DUEUM = {};

function allowedFirstChars(lastChar) {
  if (!lastChar) {
    return [];
  }

  const result = [lastChar];

  const alternatives =
    DUEUM[lastChar];

  if (alternatives) {
    for (const char of alternatives) {
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

  return allowedFirstChars(lastChar)
    .includes(word[0]);
}

/* =========================================================
   공격 데이터
========================================================= */

function attack() {
  return data?.attackDepth || {};
}

/* =========================================================
   단어 존재 확인
========================================================= */

function hasWord(word) {
  if (!data || !data.wordSet) {
    return false;
  }

  return data.wordSet.has(word);
}

/* =========================================================
   후보
========================================================= */

function candidates(ch, usedSet = used) {
  if (!data || !ch) {
    return [];
  }

  const result = [];

  const firstChars =
    allowedFirstChars(ch);

  for (const first of firstChars) {
    const list =
      data.byFirst[first] || [];

    for (const word of list) {
      if (!usedSet.has(word)) {
        result.push(word);
      }
    }
  }

  return result;
}

/* =========================================================
   후보 개수
========================================================= */

function countCandidates(
  ch,
  usedSet = used
) {
  if (!data || !ch) {
    return 0;
  }

  let count = 0;

  const firstChars =
    allowedFirstChars(ch);

  for (const first of firstChars) {
    const list =
      data.byFirst[first] || [];

    for (const word of list) {
      if (!usedSet.has(word)) {
        count++;
      }
    }
  }

  return count;
}

/* =========================================================
   한방단어
========================================================= */

function isOneShot(
  word,
  usedSet = used
) {
  if (!word) {
    return true;
  }

  const nextUsed =
    new Set(usedSet);

  nextUsed.add(word);

  return (
    countCandidates(
      word.at(-1),
      nextUsed
    ) === 0
  );
}

/* =========================================================
   후보 정보
========================================================= */

function candidateInfo(word) {
  const next =
    candidates(word.at(-1));

  const attackData =
    attack();

  const depth =
    attackData[word] != null
      ? Number(attackData[word])
      : null;

  return {
    word,
    depth,
    nextCount: next.length,
    oneShot:
      next.length === 0
  };
}

/* =========================================================
   공격 후보
========================================================= */

/*
 * 현재 글자에서 실제 공격 단어만 가져온다.
 *
 * 반드시:
 * 1. 실제 data.byFirst에 존재
 * 2. 아직 사용하지 않음
 * 3. attackDepth에 등록됨
 *
 * 이 세 조건을 모두 만족해야 한다.
 */

function attackCandidates(
  ch,
  usedSet = used
) {
  if (!data || !ch) {
    return [];
  }

  const result = [];

  const firstChars =
    allowedFirstChars(ch);

  const attackData =
    attack();

  for (const first of firstChars) {
    const list =
      data.byFirst[first] || [];

    for (const word of list) {
      if (usedSet.has(word)) {
        continue;
      }

      if (attackData[word] == null) {
        continue;
      }

      result.push(word);
    }
  }

  return result;
}

/* =========================================================
   공격 루트 계산
========================================================= */

/*
 * 특정 공격 단어 이후
 * 공격 단어만으로 몇 단계 이어갈 수 있는지 계산한다.
 *
 * 절대로 일반 단어를 탐색하지 않는다.
 *
 * 반환:
 *
 * 0 = 다음 공격 단어 없음
 * 1 = 다음 공격 1개 가능
 * 2 = 다음 공격 2개 가능
 * ...
 *
 * depthLimit은 무한 루프를 막기 위한 안전장치다.
 */

function attackChainLength(
  word,
  localUsed = new Set(),
  memo = new Map(),
  depthLimit = 30
) {
  if (!word) {
    return 0;
  }

  if (
    localUsed.has(word) ||
    depthLimit <= 0
  ) {
    return 0;
  }

  /*
   * 중요:
   *
   * 예전 코드에서는
   * word + depthLimit만 memo key로 사용해서
   * 서로 다른 used 상태가 잘못 공유될 수 있었다.
   *
   * 현재 경로의 used를 같이 포함한다.
   */

  const usedKey =
    Array.from(localUsed)
      .sort()
      .join('\u0001');

  const key =
    `${word}|${depthLimit}|${usedKey}`;

  if (memo.has(key)) {
    return memo.get(key);
  }

  const nextUsed =
    new Set(localUsed);

  nextUsed.add(word);

  const nextCandidates =
    attackCandidates(
      word.at(-1),
      nextUsed
    );

  if (!nextCandidates.length) {
    memo.set(key, 0);
    return 0;
  }

  /*
   * 깊이가 높은 공격 단어를 먼저 검사한다.
   * 최종적으로는 전체 후보를 비교하므로
   * 단순 정렬 때문에 정확도가 떨어지지는 않는다.
   */

  const attackData =
    attack();

  nextCandidates.sort(
    (a, b) => {
      const da =
        Number(
          attackData[a] ?? 0
        );

      const db =
        Number(
          attackData[b] ?? 0
        );

      return db - da;
    }
  );

  let best = 0;

  for (const nextWord of nextCandidates) {
    const length =
      1 +
      attackChainLength(
        nextWord,
        nextUsed,
        memo,
        depthLimit - 1
      );

    if (length > best) {
      best = length;
    }

    /*
     * 제한 깊이까지 도달했다면
     * 더 좋은 결과가 나올 수 없으므로 종료.
     */

    if (
      best >= depthLimit
    ) {
      break;
    }
  }

  memo.set(key, best);

  return best;
}

/* =========================================================
   Lv.5 공격 선택
========================================================= */

/*
 * Lv.5 핵심 로직.
 *
 * 공격 후보가 하나라도 존재한다면
 * 일반 단어를 절대로 반환하지 않는다.
 *
 * 공격 후보 중:
 *
 * 1. 공격 연속 길이
 * 2. 공격 깊이
 * 3. 다음 공격 후보 수
 *
 * 순서로 선택한다.
 */

function pickLv5Attack(list) {
  const attackData =
    attack();

  const attackList =
    list.filter(
      word =>
        !used.has(word) &&
        attackData[word] != null
    );

  /*
   * 공격 후보가 없으면 null.
   *
   * 이 null을 aiPick에서 일반 단어로
   * 변환하지 않는다.
   */

  if (!attackList.length) {
    return null;
  }

  const memo =
    new Map();

  const evaluated =
    attackList.map(
      word => {
        const chain =
          attackChainLength(
            word,
            new Set(used),
            memo,
            30
          );

        const depth =
          Number(
            attackData[word]
          );

        const nextAttack =
          attackCandidates(
            word.at(-1),
            new Set([
              ...used,
              word
            ])
          );

        /*
         * 공격 루트가 길수록 압도적으로 우선.
         */

        const score =
          chain * 1000000000 +
          depth * 100000 +
          Math.max(
            0,
            1000 -
              nextAttack.length
          );

        return {
          word,
          chain,
          depth,
          nextAttackCount:
            nextAttack.length,
          score
        };
      }
    );

  evaluated.sort(
    (a, b) => {

      /*
       * 1순위:
       * 공격 루트 길이
       */

      if (
        b.chain !==
        a.chain
      ) {
        return (
          b.chain -
          a.chain
        );
      }

      /*
       * 2순위:
       * 공격 깊이
       */

      if (
        b.depth !==
        a.depth
      ) {
        return (
          b.depth -
          a.depth
        );
      }

      /*
       * 3순위:
       * 다음 공격 후보가 많은 쪽
       *
       * 공격을 계속 이어가기 위한 목적.
       */

      if (
        b.nextAttackCount !==
        a.nextAttackCount
      ) {
        return (
          b.nextAttackCount -
          a.nextAttackCount
        );
      }

      /*
       * 4순위:
       * 종합 점수
       */

      return (
        b.score -
        a.score
      );
    }
  );

  return evaluated[0].word;
}

/* =========================================================
   AI 점수
========================================================= */

function score(info, level) {
  const depth =
    info.depth == null
      ? 999
      : info.depth;

  const nextCount =
    info.nextCount;

  /*
   * 한방 단어
   */

  if (info.oneShot) {

    if (level >= 5) {
      return 100000000;
    }

    if (level >= 4) {
      return 50000;
    }

    if (level >= 3) {
      return 1000;
    }

    return -10000;
  }

  /*
   * 공격 단어
   */

  if (info.depth != null) {

    if (level === 1) {
      return -10000 - depth;
    }

    if (level === 2) {
      return (
        (depth >= 4
          ? 80
          : -30) +
        Math.min(
          nextCount,
          30
        )
      );
    }

    /*
     * Lv.3 상향
     */

    if (level === 3) {
      return (
        10000 -
        depth * 250 +
        Math.min(
          nextCount,
          50
        ) * 5
      );
    }

    /*
     * Lv.4 상향
     */

    if (level === 4) {
      return (
        50000 -
        depth * 500 +
        Math.min(
          nextCount,
          50
        ) * 10
      );
    }

    /*
     * Lv.5에서는 실제 공격 루트를 사용한다.
     */

    if (level === 5) {
      return (
        100000000 -
        depth * 1000
      );
    }
  }

  /*
   * 일반 공룰 단어
   */

  if (level === 1) {
    return (
      100 +
      Math.min(
        nextCount,
        100
      )
    );
  }

  if (level === 2) {
    return (
      150 +
      Math.min(
        nextCount,
        100
      )
    );
  }

  /*
   * Lv.3 상향
   */

  if (level === 3) {
    return (
      500 +
      Math.min(
        nextCount,
        100
      ) * 2
    );
  }

  /*
   * Lv.4 상향
   */

  if (level === 4) {
    return (
      300 +
      Math.min(
        nextCount,
        60
      ) * 3
    );
  }

  /*
   * Lv.5 일반 단어는
   * 공격 후보가 없을 때도 선택하지 않는다.
   */

  return -1000000000;
}

/* =========================================================
   AI 선택
========================================================= */

function aiPick() {
  const level =
    Number(
      $('difficulty').value
    );

  const list =
    candidates(
      current.at(-1)
    );

  if (!list.length) {
    finish(false);
    return null;
  }

  const infos =
    list.map(
      candidateInfo
    );

  /* =======================================================
     Lv.5
  ======================================================= */

  if (level === 5) {

    /*
     * 공격 후보만 만든다.
     */

    const attackWord =
      pickLv5Attack(list);

    /*
     * 공격 단어가 있으면
     * 무조건 공격 단어.
     */

    if (attackWord) {
      return attackWord;
    }

    /*
     * 여기서 절대로 일반 단어를 선택하지 않는다.
     *
     * 공격 중에 일반 단어로 넘어가는 현상을
     * 완전히 차단한다.
     *
     * 실제 공격 후보가 없다면
     * AI는 이 턴에서 더 이상 공격할 수 없다.
     */

    return null;
  }

  /* =======================================================
     Lv.4
  ======================================================= */

  if (level === 4) {

    /*
     * 한방 단어가 있으면 적극적으로 사용.
     */

    const oneShots =
      infos.filter(
        x =>
          x.oneShot
      );

    if (oneShots.length) {

      oneShots.sort(
        (a, b) => {

          const ad =
            a.depth ?? 999;

          const bd =
            b.depth ?? 999;

          return ad - bd;
        }
      );

      return oneShots[0].word;
    }

    /*
     * 공격 단어 우선.
     *
     * 깊이가 높은 공격을 우선한다.
     */

    const attacks =
      infos.filter(
        x =>
          x.depth != null
      );

    if (attacks.length) {

      attacks.sort(
        (a, b) =>
          b.depth -
          a.depth
      );

      return attacks[0].word;
    }

    /*
     * 공격이 없다면
     * 상대 선택지를 최대한 줄이는 일반 단어.
     */

    const normal =
      infos.filter(
        x =>
          !x.oneShot
      );

    if (normal.length) {

      normal.sort(
        (a, b) =>
          a.nextCount -
          b.nextCount
      );

      return normal[0].word;
    }

    return list[0];
  }

  /* =======================================================
     Lv.3
  ======================================================= */

  if (level === 3) {

    /*
     * 한방 단어를 적극적으로 사용.
     */

    const oneShots =
      infos.filter(
        x =>
          x.oneShot
      );

    if (oneShots.length) {

      /*
       * 깊이가 있는 공격 한방을 우선.
       */

      oneShots.sort(
        (a, b) =>
          (b.depth ?? 0) -
          (a.depth ?? 0)
      );

      return oneShots[0].word;
    }

    /*
     * 공격 단어 중
     * 너무 얕은 것만 고르지 않는다.
     *
     * 기존 Lv.3보다 공격 성향 강화.
     */

    const attacks =
      infos.filter(
        x =>
          x.depth != null
      );

    if (attacks.length) {

      attacks.sort(
        (a, b) => {

          /*
           * 깊이가 높은 공격을 우선.
           */

          if (
            b.depth !==
            a.depth
          ) {
            return (
              b.depth -
              a.depth
            );
          }

          return (
            a.nextCount -
            b.nextCount
          );
        }
      );

      /*
       * 완전히 랜덤하지 않고
       * 상위 공격 후보에서 선택.
       */

      const count =
        Math.min(
          3,
          attacks.length
        );

      return attacks[
        Math.floor(
          Math.random() *
          count
        )
      ].word;
    }

    /*
     * 공격이 없으면
     * 상대 선택지를 줄이는 단어.
     */

    const normal =
      infos.filter(
        x =>
          !x.oneShot
      );

    if (normal.length) {

      normal.sort(
        (a, b) =>
          a.nextCount -
          b.nextCount
      );

      const count =
        Math.min(
          5,
          normal.length
        );

      return normal[
        Math.floor(
          Math.random() *
          count
        )
      ].word;
    }

    return list[0];
  }

  /* =======================================================
     Lv.2
  ======================================================= */

  if (level === 2) {

    const sorted =
      [...infos].sort(
        (a, b) =>
          score(b, level) -
          score(a, level)
      );

    const count =
      Math.min(
        8,
        sorted.length
      );

    return sorted[
      Math.floor(
        Math.random() *
        count
      )
    ].word;
  }

  /* =======================================================
     Lv.1
  ======================================================= */

  const safe =
    infos.filter(
      x =>
        x.depth == null &&
        !x.oneShot
    );

  if (safe.length) {

    safe.sort(
      (a, b) =>
        b.nextCount -
        a.nextCount
    );

    const count =
      Math.min(
        15,
        safe.length
      );

    return safe[
      Math.floor(
        Math.random() *
        count
      )
    ].word;
  }

  const nonOneShot =
    infos.filter(
      x =>
        !x.oneShot
    );

  if (nonOneShot.length) {

    nonOneShot.sort(
      (a, b) =>
        b.nextCount -
        a.nextCount
    );

    return nonOneShot[0].word;
  }

  return list[
    Math.floor(
      Math.random() *
      list.length
    )
  ];
}

/* =========================================================
   AI 단어 적용
========================================================= */

function playAiWord(word) {
  if (!word) {
    return;
  }

  /*
   * 실제 데이터에 존재하는지 최종 확인.
   */

  if (!hasWord(word)) {
    console.error(
      'AI가 존재하지 않는 단어를 선택함:',
      word
    );

    finish(false);
    return;
  }

  /*
   * 이미 사용한 단어도 방어.
   */

  if (used.has(word)) {
    console.error(
      'AI가 이미 사용한 단어를 선택함:',
      word
    );

    finish(false);
    return;
  }

  /*
   * 현재 끝 글자와 연결되는지도 방어.
   */

  if (
    current &&
    !canStartWith(
      word,
      current.at(-1)
    )
  ) {
    console.error(
      'AI 단어 연결 오류:',
      current,
      word
    );

    finish(false);
    return;
  }

  used.add(word);

  current = word;

  turn++;

  $('last').textContent =
    word.at(-1);

  $('turn').textContent =
    turn;

  $('depth').textContent =
    attack()[word] ?? '-';

  addHistory(
    'AI',
    word
  );

  const next =
    countCandidates(
      word.at(-1)
    );

  if (next === 0) {
    finish(true);
    return;
  }

  $('message').textContent =
    `AI: ${word} → '${word.at(-1)}'`;

  playerTurn = true;

  $('singleInput').disabled =
    false;

  $('singleSend').disabled =
    false;

  $('singleInput').focus();
}

/* =========================================================
   AI 턴
========================================================= */

function aiTurn() {
  if (
    over ||
    playerTurn
  ) {
    return;
  }

  const word =
    aiPick();

  /*
   * Lv.5에서 공격 후보가 없으면
   * 일반 단어로 대체하지 않는다.
   */

  if (!word) {

    /*
     * 현재 AI가 낼 수 있는 단어 자체가 없거나
     * Lv.5 공격 루트가 막힌 상황.
     *
     * AI가 패배 처리된다.
     */

    finish(false);
    return;
  }

  playAiWord(word);
}

/* =========================================================
   플레이어 입력
========================================================= */

function submit() {
  if (
    over ||
    !playerTurn
  ) {
    return;
  }

  const word =
    $('singleInput')
      .value
      .trim();

  $('singleInput').value =
    '';

  if (!word) {
    return;
  }

  if (!hasWord(word)) {
    $('message').textContent =
      '목록에 없는 단어야.';
    return;
  }

  if (used.has(word)) {
    $('message').textContent =
      '이미 나온 단어야.';
    return;
  }

  /*
   * 첫 단어
   */

  if (!current) {

    const error =
      validateFirstWordClient(
        word
      );

    if (error) {
      $('message').textContent =
        error;
      return;
    }

    used.add(word);

    current = word;

    turn++;

    $('last').textContent =
      word.at(-1);

    $('turn').textContent =
      turn;

    $('depth').textContent =
      attack()[word] ?? '-';

    addHistory(
      '나',
      word
    );

  } else {

    /*
     * 연결 확인
     */

    if (
      !canStartWith(
        word,
        current.at(-1)
      )
    ) {

      const last =
        current.at(-1);

      const accepted =
        allowedFirstChars(last);

      $('message').textContent =
        accepted.length > 1
          ? `'${last}' 다음에는 ${accepted.join(', ')}으로 시작하는 단어를 써야 해.`
          : `'${last}'로 시작해야 해.`;

      return;
    }

    used.add(word);

    current = word;

    turn++;

    $('last').textContent =
      word.at(-1);

    $('turn').textContent =
      turn;

    $('depth').textContent =
      attack()[word] ?? '-';

    addHistory(
      '나',
      word
    );
  }

  /*
   * 상대가 이어갈 수 있는지
   */

  if (
    countCandidates(
      current.at(-1)
    ) === 0
  ) {

    finish(false);
    return;
  }

  playerTurn = false;

  $('singleInput').disabled =
    true;

  $('singleSend').disabled =
    true;

  $('message').textContent =
    'AI가 생각 중...';

  setTimeout(
    aiTurn,
    350
  );
}

/* =========================================================
   첫 단어 클라이언트 검사
========================================================= */

function validateFirstWordClient(word) {
  if (
    !word.startsWith(
      startChar
    )
  ) {
    return (
      `'${startChar}'으로 시작하는 단어를 입력해야 해.`
    );
  }

  if (
    attack()[word] != null
  ) {
    return (
      '첫 단어에서는 공격 단어를 사용할 수 없어.'
    );
  }

  if (
    isOneShot(
      word,
      new Set()
    )
  ) {
    return (
      '첫 단어로 한방 단어는 사용할 수 없어.'
    );
  }

  const next =
    countCandidates(
      word.at(-1),
      new Set([word])
    );

  if (next < 5) {
    return (
      '첫 단어로는 선택지가 너무 적은 단어를 사용할 수 없어.'
    );
  }

  return null;
}

/* =========================================================
   버튼
========================================================= */

$('singleSend').onclick =
  submit;

$('singleInput').onkeydown =
  e => {
    if (
      e.key === 'Enter'
    ) {
      e.preventDefault();
      submit();
    }
  };

$('restart').onclick =
  start;

$('newStart').onclick =
  start;

/* =========================================================
   온라인
========================================================= */

const socket =
  io();

let room = null;

let myId = null;

let onlineLast = '';

let onlineStartChar = '';

let onlineTurn = null;

let onlineStarted = false;

/* =========================================================
   방 렌더링
========================================================= */

function roomRender(state) {
  room = state;

  const players =
    state.players
      .map(
        p =>
          `${esc(p.name)} (P${p.slot})`
      )
      .join(' · ');

  const turnPlayer =
    state.turnPlayer
      ? state.players.find(
          p =>
            p.id ===
            state.turnPlayer
        )
      : null;

  $('roomInfo').innerHTML =
    `
      <b>방 코드: ${esc(
        state.roomCode
      )}</b><br>

      플레이어:
      ${
        players ||
        '-'
      }<br>

      ${
        state.started
          ? `시작 음절: <b>${esc(
              state.startChar ||
              '-'
            )}</b><br>`
          : ''
      }

      ${
        state.current
          ? `현재 단어: <b>${esc(
              state.current
            )}</b><br>`
          : ''
      }

      현재 차례:
      ${
        turnPlayer
          ? esc(
              turnPlayer.name
            )
          : '대기 중'
      }
    `;

  const isHost =
    state.players[0]?.id ===
    myId;

  const canStart =
    isHost &&
    !state.started &&
    state.players.length === 2;

  $('startOnline')
    .classList
    .toggle(
      'hidden',
      !canStart
    );

  if (
    onlineStarted &&
    state.started
  ) {

    const myTurn =
      state.turnPlayer ===
      myId;

    $('onlineInput').disabled =
      !myTurn;

    $('onlineSend').disabled =
      !myTurn;
  }
}

/* =========================================================
   Socket 연결
========================================================= */

socket.on(
  'connect',
  () => {
    myId =
      socket.id;

    console.log(
      'Socket 연결:',
      myId
    );
  }
);

socket.on(
  'room_created',
  info => {
    $('roomCode').value =
      info.code;

    $('onlineMessage').textContent =
      '방이 만들어졌어. 친구에게 코드를 알려줘.';
  }
);

socket.on(
  'room_state',
  state => {
    roomRender(state);
  }
);

socket.on(
  'notice',
  message => {
    $('onlineMessage').textContent =
      message;
  }
);

socket.on(
  'error_msg',
  message => {
    $('onlineMessage').textContent =
      message;
  }
);

/* =========================================================
   온라인 게임 시작
========================================================= */

socket.on(
  'game_started',
  info => {

    $('onlineHistory').innerHTML =
      '';

    onlineLast = '';

    onlineStartChar =
      info.startChar;

    onlineTurn =
      info.state.turnPlayer;

    onlineStarted =
      true;

    addOnline(
      '시작 음절',
      info.startChar,
      null
    );

    $('onlineMessage').textContent =
      info.state.turnPlayer ===
      myId
        ? `게임 시작! '${info.startChar}'으로 시작하는 단어를 입력해.`
        : `게임 시작! 시작 음절은 '${info.startChar}'. 상대방 차례야.`;

    roomRender(
      info.state
    );

    $('onlineInput').value =
      '';

    if (
      info.state.turnPlayer ===
      myId
    ) {
      $('onlineInput').focus();
    }
  }
);

/* =========================================================
   온라인 기록
========================================================= */

function addOnline(
  who,
  word,
  depth
) {
  $('onlineHistory')
    .insertAdjacentHTML(
      'beforeend',
      `
        <div class="line">
          <b>${esc(who)}</b> · ${esc(word)}
          ${
            depth != null
              ? `<span class="attack">(공격 깊이 ${depth})</span>`
              : ''
          }
        </div>
      `
    );

  $('onlineHistory').scrollTop =
    $('onlineHistory')
      .scrollHeight;
}

/* =========================================================
   온라인 단어
========================================================= */

socket.on(
  'word_played',
  info => {

    onlineLast =
      info.word;

    onlineTurn =
      info.state.turnPlayer;

    const player =
      info.state.players.find(
        p =>
          p.id ===
          info.playerId
      );

    addOnline(
      info.playerId === myId
        ? '나'
        : player?.name ||
          '상대',
      info.word,
      info.depth
    );

    roomRender(
      info.state
    );

    $('onlineMessage').textContent =
      info.state.turnPlayer ===
      myId
        ? '내 차례야.'
        : '상대방 차례야.';

    $('onlineInput').value =
      '';
  }
);

/* =========================================================
   온라인 게임 종료
========================================================= */

socket.on(
  'game_over',
  info => {

    onlineStarted =
      false;

    $('onlineInput').disabled =
      true;

    $('onlineSend').disabled =
      true;

    $('onlineMessage').textContent =
      info.winner ===
      myId
        ? '온라인 승리!'
        : '온라인 패배!';

    roomRender(
      info.state
    );
  }
);

/* =========================================================
   온라인 방 생성
========================================================= */

$('create').onclick =
  () => {

    socket.emit(
      'create_room',
      {
        name:
          $('name')
            .value
            .trim() ||
          'Player'
      }
    );
  };

/* =========================================================
   온라인 방 참가
========================================================= */

$('join').onclick =
  () => {

    socket.emit(
      'join_room',
      {
        code:
          $('roomCode')
            .value
            .trim(),

        name:
          $('name')
            .value
            .trim() ||
          'Player'
      }
    );
  };

/* =========================================================
   온라인 시작
========================================================= */

$('startOnline').onclick =
  () => {

    socket.emit(
      'start_online'
    );
  };

/* =========================================================
   온라인 입력
========================================================= */

$('onlineSend').onclick =
  onlineSubmit;

$('onlineInput').onkeydown =
  e => {

    if (
      e.key === 'Enter'
    ) {

      e.preventDefault();

      onlineSubmit();
    }
  };

function onlineSubmit() {

  if (!onlineStarted) {
    return;
  }

  if (
    onlineTurn !==
    myId
  ) {

    $('onlineMessage').textContent =
      '아직 네 차례가 아니야.';

    return;
  }

  const word =
    $('onlineInput')
      .value
      .trim();

  if (!word) {
    return;
  }

  if (!hasWord(word)) {

    $('onlineMessage').textContent =
      '목록에 없는 단어야.';

    return;
  }

  if (
    onlineLast &&
    !canStartWith(
      word,
      onlineLast.at(-1)
    )
  ) {

    const last =
      onlineLast.at(-1);

    const accepted =
      allowedFirstChars(last);

    $('onlineMessage').textContent =
      accepted.length > 1
        ? `'${last}' 다음에는 ${accepted.join(', ')}으로 시작해야 해.`
        : `'${last}'로 시작해야 해.`;

    return;
  }

  /*
   * 첫 온라인 단어
   */

  if (!onlineLast) {

    if (
      !word.startsWith(
        onlineStartChar
      )
    ) {

      $('onlineMessage').textContent =
        `'${onlineStartChar}'으로 시작하는 단어를 입력해야 해.`;

      return;
    }

    if (
      attack()[word] != null
    ) {

      $('onlineMessage').textContent =
        '첫 단어에서는 공격 단어를 사용할 수 없어.';

      return;
    }

    if (
      isOneShot(
        word,
        new Set()
      )
    ) {

      $('onlineMessage').textContent =
        '첫 단어로 한방 단어는 사용할 수 없어.';

      return;
    }
  }

  socket.emit(
    'play_word',
    {
      word
    }
  );

  $('onlineInput').value =
    '';
}

/* =========================================================
   탭
========================================================= */

document
  .querySelectorAll(
    '.tabs button'
  )
  .forEach(
    button => {

      button.onclick =
        () => {

          document
            .querySelectorAll(
              '.tabs button'
            )
            .forEach(
              x =>
                x.classList.remove(
                  'active'
                )
            );

          button.classList.add(
            'active'
          );

          $('single')
            .classList
            .toggle(
              'hidden',
              button.dataset.mode !==
                'single'
            );

          $('online')
            .classList
            .toggle(
              'hidden',
              button.dataset.mode !==
                'online'
            );
        };
    }
  );

/* =========================================================
   데이터 로딩
========================================================= */

async function loadData() {

  $('message').textContent =
    '게임 데이터를 불러오는 중...';

  try {

    const response =
      await fetch(
        '/api/data'
      );

    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const result =
      await response.json();

    if (
      !result.ready
    ) {

      throw new Error(
        '게임 데이터가 아직 준비되지 않았습니다.'
      );
    }

    data = {
      byFirst:
        result.byFirst || {},

      attackDepth:
        result.attackDepth || {},

      startFirst:
        result.startFirst ||
        [
          '가',
          '나',
          '다',
          '마',
          '사',
          '자',
          '기',
          '시'
        ]
    };

    /*
     * 클라이언트 단어 Set
     */

    data.wordSet =
      new Set();

    for (
      const first
      of Object.keys(
        data.byFirst
      )
    ) {

      const list =
        data.byFirst[first] || [];

      for (
        const word
        of list
      ) {

        data.wordSet.add(
          word
        );
      }
    }

    /*
     * 서버와 동일한 두음법칙
     */

    DUEUM =
      result.dueum || {};

    loadStats();

    start();

  } catch (error) {

    console.error(
      '데이터 로딩 실패:',
      error
    );

    $('message').textContent =
      '게임 데이터를 불러오지 못했어. 잠시 후 새로고침해줘.';

    setTimeout(
      loadData,
      1500
    );
  }
}

/* =========================================================
   통계
========================================================= */

function saveStats() {
  localStorage.kkeulStats =
    JSON.stringify({
      wins,
      losses,
      totalTurns
    });
}

function loadStats() {

  try {

    const saved =
      JSON.parse(
        localStorage.kkeulStats ||
        '{}'
      );

    wins =
      Number(
        saved.wins || 0
      );

    losses =
      Number(
        saved.losses || 0
      );

    totalTurns =
      Number(
        saved.totalTurns || 0
      );

  } catch {

    wins = 0;
    losses = 0;
    totalTurns = 0;
  }

  updateStats();
}

function updateStats() {

  const games =
    wins + losses;

  $('wins').textContent =
    wins;

  $('losses').textContent =
    losses;

  $('games').textContent =
    games;

  $('winrate').textContent =
    games
      ? Math.round(
          wins /
          games *
          100
        ) + '%'
      : '0%';

  $('avg').textContent =
    games
      ? (
          totalTurns /
          games
        ).toFixed(1) +
        '턴'
      : '-';
}

/* =========================================================
   기록
========================================================= */

function addHistory(
  who,
  word
) {

  const depth =
    attack()[word];

  $('history')
    .insertAdjacentHTML(
      'beforeend',
      `
        <div class="line">
          <b>${esc(who)}</b> · ${esc(word)}
          ${
            depth != null
              ? `<span class="attack">(공격 깊이 ${depth})</span>`
              : ''
          }
        </div>
      `
    );

  $('history').scrollTop =
    $('history').scrollHeight;
}

/* =========================================================
   게임 시작
========================================================= */

function start() {

  if (!data) {
    return;
  }

  used.clear();

  current = '';

  startChar =
    data.startFirst[
      Math.floor(
        Math.random() *
        data.startFirst.length
      )
    ];

  turn = 0;

  over = false;

  playerTurn =
    Math.random() < 0.5;

  $('history').innerHTML =
    '';

  $('singleInput').disabled =
    !playerTurn;

  $('singleSend').disabled =
    !playerTurn;

  $('startWord').value =
    startChar;

  $('last').textContent =
    startChar;

  $('turn').textContent =
    '0';

  $('depth').textContent =
    '-';

  addHistory(
    '시작 음절',
    startChar
  );

  if (playerTurn) {

    $('message').textContent =
      `시작 음절은 '${startChar}'. ${startChar}으로 시작하는 단어를 입력해!`;

    $('singleInput').focus();

  } else {

    $('message').textContent =
      `시작 음절은 '${startChar}'. AI가 먼저 생각 중...`;

    setTimeout(
      aiFirstTurn,
      350
    );
  }
}

/* =========================================================
   첫 단어 AI 후보
========================================================= */

function aiFirstCandidates() {

  const list =
    candidates(
      startChar,
      new Set()
    );

  return list.filter(
    word => {

      /*
       * 첫 단어 공격 금지
       */

      if (
        attack()[word] != null
      ) {
        return false;
      }

      /*
       * 첫 단어 한방 금지
       */

      if (
        isOneShot(
          word,
          new Set()
        )
      ) {
        return false;
      }

      const nextUsed =
        new Set([word]);

      /*
       * 최소 5개 이상의 선택지.
       */

      return (
        countCandidates(
          word.at(-1),
          nextUsed
        ) >= 5
      );
    }
  );
}

/* =========================================================
   첫 단어 AI
========================================================= */

function aiFirstTurn() {

  if (over) {
    return;
  }

  const safe =
    aiFirstCandidates();

  let word = null;

  if (safe.length) {

    word =
      safe[
        Math.floor(
          Math.random() *
          safe.length
        )
      ];

  } else {

    const list =
      candidates(
        startChar,
        new Set()
      );

    if (!list.length) {
      finish(false);
      return;
    }

    /*
     * 공격/한방 제외
     */

    const normal =
      list.filter(
        x =>
          attack()[x] == null &&
          !isOneShot(
            x,
            new Set()
          )
      );

    word =
      (
        normal.length
          ? normal
          : list
      )[
        Math.floor(
          Math.random() *
          (
            normal.length
              ? normal.length
              : list.length
          )
        )
      ];
  }

  playAiWord(word);
}

/* =========================================================
   AI 종료
========================================================= */

function finish(aiWon) {

  if (over) {
    return;
  }

  over = true;

  $('singleInput').disabled =
    true;

  $('singleSend').disabled =
    true;

  if (aiWon) {
    wins++;
  } else {
    losses++;
  }

  totalTurns +=
    turn;

  saveStats();
  updateStats();

  $('message').textContent =
    aiWon
      ? 'AI 승리!'
      : '플레이어 승리!';
}

/* =========================================================
   HTML escape
========================================================= */

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c =>
      ({
        '&':
          '&amp;',
        '<':
          '&lt;',
        '>':
          '&gt;',
        '"':
          '&quot;',
        "'":
          '&#039;'
      }[c])
  );
}

/* =========================================================
   시작
========================================================= */

loadData();
