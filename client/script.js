const $ = id => document.getElementById(id);

let data = null;
let used = new Set();
let current = '';
let turn = 0;
let over = false;

let wins = 0;
let losses = 0;
let totalTurns = 0;

const attack = () => data?.attackDepth || {};

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[c])
  );
}

/*
 * 두음법칙
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
   * 실제 두음법칙:
   *
   * ㄹ → ㄴ
   */
  if (initial === 5) {
    result.add(
      replaceInitial(lastChar, 'ㄴ')
    );

    /*
     * ㄹ → ㅇ
     *
     * 려 → 여
     * 력 → 역
     * 료 → 요
     * 류 → 유
     * 리 → 이
     */
    const toIeung = new Set([
      2, 6, 7, 8, 12, 20
    ]);

    if (toIeung.has(medial)) {
      result.add(
        replaceInitial(lastChar, 'ㅇ')
      );
    }
  }

  /*
   * ㄴ → ㅇ
   *
   * 녀 → 여
   * 뇨 → 요
   * 뉴 → 유
   * 니 → 이
   */
  if (initial === 2) {
    const toIeung = new Set([
      2, 6, 7, 8, 12, 20
    ]);

    if (toIeung.has(medial)) {
      result.add(
        replaceInitial(lastChar, 'ㅇ')
      );
    }
  }

  return result;
}

function canConnect(currentWord, nextWord) {
  if (!currentWord || !nextWord) {
    return true;
  }

  return allowedNextFirstChars(
    currentWord.at(-1)
  ).has(nextWord[0]);
}

/*
 * 가능한 단어
 */
function candidates(ch) {
  const result = new Set();

  for (
    const firstChar of
      allowedNextFirstChars(ch)
  ) {
    for (
      const word of
        data.byFirst[firstChar] || []
    ) {
      if (!used.has(word)) {
        result.add(word);
      }
    }
  }

  return [...result];
}

/*
 * 통계
 */
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
    ({
      wins = 0,
      losses = 0,
      totalTurns = 0
    } = JSON.parse(
      localStorage.kkeulStats || '{}'
    ));
  } catch {
    wins = 0;
    losses = 0;
    totalTurns = 0;
  }

  updateStats();
}

function updateStats() {
  const games = wins + losses;

  $('wins').textContent = wins;
  $('losses').textContent = losses;
  $('games').textContent = games;

  $('winrate').textContent =
    games
      ? Math.round(
          wins / games * 100
        ) + '%'
      : '0%';

  $('avg').textContent =
    games
      ? (
          totalTurns / games
        ).toFixed(1) + '턴'
      : '-';
}

/*
 * 싱글플레이 기록
 */
function addHistory(who, word) {
  $('history').insertAdjacentHTML(
    'beforeend',
    `<div class="line"><b>${esc(who)}</b> · ${esc(word)}${
      attack()[word] != null
        ? ` <span class="attack">(공격 깊이 ${attack()[word]})</span>`
        : ''
    }</div>`
  );

  $('history').scrollTop =
    $('history').scrollHeight;
}

/*
 * 게임 시작
 */
function start() {
  used.clear();
  over = false;
  turn = 0;

  $('history').innerHTML = '';

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  const pool = data.startPool;

  if (!pool.length) {
    $('message').textContent =
      '시작할 수 있는 단어가 없습니다.';
    return;
  }

  current =
    pool[
      Math.floor(
        Math.random() * pool.length
      )
    ];

  used.add(current);

  $('startWord').value = current;
  $('last').textContent = current.at(-1);
  $('turn').textContent = 0;
  $('depth').textContent =
    attack()[current] ?? '-';

  $('message').textContent =
    `시작 단어는 '${current}'. '${current.at(-1)}'로 시작하는 단어를 입력해!`;

  addHistory('시작', current);

  $('singleInput').focus();
}

/*
 * 게임 종료
 */
function finish(ai) {
  over = true;

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  if (ai) {
    wins++;
  } else {
    losses++;
  }

  totalTurns += turn;

  saveStats();
  updateStats();

  $('message').textContent =
    ai
      ? 'AI 승리!'
      : '플레이어 승리!';
}

/*
 * AI 점수
 */
function score(word, level) {
  const depth =
    attack()[word] ?? 99;

  const count =
    candidates(
      word.at(-1)
    ).length;

  let score =
    (100 - depth) * 5 +
    Math.max(0, 40 - count) +
    Math.min(
      20,
      word.length * 2
    );

  if (level >= 4) {
    score += Math.random() * 3;
  }

  return score;
}

/*
 * AI 단어 선택
 */
function aiPick() {
  const level =
    +$('difficulty').value;

  const possible =
    candidates(
      current.at(-1)
    );

  if (!possible.length) {
    finish(false);
    return null;
  }

  /*
   * Lv.5
   */
  if (level === 5) {
    const immediate =
      possible.filter(
        word =>
          candidates(
            word.at(-1)
          ).length === 0
      );

    if (immediate.length) {
      return immediate.sort(
        (a, b) =>
          (attack()[a] ?? 999) -
          (attack()[b] ?? 999)
      )[0];
    }

    const attackWords =
      possible.filter(
        word =>
          attack()[word] != null
      );

    if (attackWords.length) {
      return attackWords.sort(
        (a, b) =>
          (attack()[a] ?? 999) -
          (attack()[b] ?? 999)
      )[0];
    }
  }

  let list =
    level < 5
      ? possible.filter(
          word =>
            attack()[word] == null
        )
      : possible;

  if (!list.length) {
    list = possible;
  }

  if (level === 1) {
    return list[
      Math.floor(
        Math.random() * list.length
      )
    ];
  }

  list.sort(
    (a, b) =>
      score(b, level) -
      score(a, level)
  );

  if (level === 2) {
    return list[
      Math.floor(
        Math.random() *
        Math.min(
          10,
          list.length
        )
      )
    ];
  }

  if (level === 3) {
    return list[
      Math.floor(
        Math.random() *
        Math.min(
          4,
          list.length
        )
      )
    ];
  }

  return list[0];
}

/*
 * AI 차례
 */
function aiTurn() {
  if (over) return;

  const word = aiPick();

  if (!word) return;

  used.add(word);

  current = word;

  turn++;

  $('last').textContent =
    word.at(-1);

  $('turn').textContent =
    turn;

  $('depth').textContent =
    attack()[word] ?? '-';

  addHistory('AI', word);

  if (
    !candidates(
      word.at(-1)
    ).length
  ) {
    finish(true);
    return;
  }

  $('message').textContent =
    `AI: ${word} → '${word.at(-1)}'`;

  $('singleInput').disabled = false;
  $('singleSend').disabled = false;

  $('singleInput').focus();
}

/*
 * 싱글플레이 입력
 */
function submit() {
  if (over) return;

  const word =
    $('singleInput')
      .value
      .trim();

  $('singleInput').value = '';

  if (!word) return;

  if (!data.wordSet[word]) {
    $('message').textContent =
      '목록에 없는 단어야.';
    return;
  }

  if (used.has(word)) {
    $('message').textContent =
      '이미 나온 단어야.';
    return;
  }

  if (
    !canConnect(
      current,
      word
    )
  ) {
    $('message').textContent =
      `'${current.at(-1)}'에서 이어지는 단어가 아니야.`;
    return;
  }

  /*
   * 첫 번째 플레이어 단어는
   * 한방단어 금지
   */
  if (turn === 0) {
    const next =
      candidates(
        word.at(-1)
      );

    if (!next.length) {
      $('message').textContent =
        '첫 번째 단어로 한방단어는 사용할 수 없어.';
      return;
    }
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

  addHistory('나', word);

  if (
    !candidates(
      word.at(-1)
    ).length
  ) {
    return finish(false);
  }

  $('singleInput').disabled = true;
  $('singleSend').disabled = true;

  $('message').textContent =
    'AI가 생각 중...';

  setTimeout(
    aiTurn,
    250
  );
}

$('singleSend').onclick =
  submit;

$('singleInput').onkeydown =
  e => {
    if (e.key === 'Enter') {
      submit();
    }
  };

$('restart').onclick =
  start;

$('newStart').onclick =
  start;

/*
 * 데이터 불러오기
 */
async function loadData() {
  const response =
    await fetch('/api/data');

  if (!response.ok) {
    throw new Error(
      '단어 데이터를 불러오지 못했습니다.'
    );
  }

  data =
    await response.json();

  data.wordSet =
    Object.fromEntries(
      data.words.map(
        word => [
          word,
          true
        ]
      )
    );

  data.byFirst = {};

  for (const word of data.words) {
    (
      data.byFirst[word[0]] ??=
      []
    ).push(word);
  }

  loadStats();

  start();
}

/*
 * ==========================
 * 온라인 1 : 1
 * ==========================
 */

const socket = io();

let room = null;
let myId = null;

let onlineLast = '';
let onlineTurn = null;
let onlineStarted = false;

/*
 * 온라인 입력창 상태
 */
function updateOnlineInput() {
  const myTurn =
    onlineStarted &&
    onlineTurn === myId;

  $('onlineInput').disabled =
    !myTurn;

  $('onlineSend').disabled =
    !myTurn;

  if (myTurn) {
    $('onlineInput').focus();
  }
}

/*
 * 방 화면
 */
function roomRender(state) {
  room = state;

  const currentPlayer =
    state.turnPlayer
      ? (
          state.players.find(
            player =>
              player.id ===
              state.turnPlayer
          )?.name || '-'
        )
      : '대기 중';

  $('roomInfo').innerHTML =
    `<b>방 코드: ${esc(state.roomCode)}</b><br>` +
    `플레이어: ${
      state.players
        .map(
          player =>
            `${esc(player.name)} (P${player.slot})`
        )
        .join(' · ') || '-'
    }<br>` +
    `현재 차례: ${esc(currentPlayer)}`;

  /*
   * 방장에게만 시작 버튼 표시
   */
  $('startOnline').classList.toggle(
    'hidden',
    !(
      state.players[0]?.id ===
        myId &&
      !state.started &&
      state.players.length === 2
    )
  );

  updateOnlineInput();
}

/*
 * 온라인 기록
 */
function addOnline(
  who,
  word,
  depth
) {
  $('onlineHistory')
    .insertAdjacentHTML(
      'beforeend',
      `<div class="line"><b>${esc(who)}</b> · ${esc(word)}${
        depth != null
          ? ` <span class="attack">(공격 깊이 ${depth})</span>`
          : ''
      }</div>`
    );

  $('onlineHistory').scrollTop =
    $('onlineHistory').scrollHeight;
}

/*
 * 서버 연결
 */
socket.on(
  'connect',
  () => {
    myId =
      socket.id;

    if (room) {
      roomRender(room);
    }
  }
);

/*
 * 방 생성
 */
socket.on(
  'room_created',
  result => {
    $('roomCode').value =
      result.code;

    $('onlineMessage').textContent =
      '방이 만들어졌어. 친구에게 코드를 알려줘.';
  }
);

/*
 * 방 상태
 */
socket.on(
  'room_state',
  roomRender
);

/*
 * 서버 알림
 */
socket.on(
  'notice',
  message => {
    $('onlineMessage').textContent =
      message;
  }
);

/*
 * 서버 오류
 */
socket.on(
  'error_msg',
  message => {
    $('onlineMessage').textContent =
      message;

    updateOnlineInput();
  }
);

/*
 * 게임 시작
 */
socket.on(
  'game_started',
  result => {
    $('onlineHistory').innerHTML =
      '';

    $('onlineMessage').textContent =
      `게임 시작! 시작 단어: ${result.startWord}`;

    onlineLast =
      result.startWord;

    onlineTurn =
      result.state.turnPlayer;

    onlineStarted = true;

    addOnline(
      '시작',
      result.startWord,
      result.state.lastDepth
    );

    roomRender(
      result.state
    );
  }
);

/*
 * 상대방/내 단어
 */
socket.on(
  'word_played',
  result => {
    onlineLast =
      result.word;

    onlineTurn =
      result.state.turnPlayer;

    const player =
      result.state.players.find(
        p =>
          p.id ===
          result.playerId
      );

    addOnline(
      result.playerId === myId
        ? '나'
        : (
            player?.name ||
            '상대'
          ),
      result.word,
      result.depth
    );

    roomRender(
      result.state
    );

    $('onlineMessage').textContent =
      result.state.turnPlayer ===
      myId
        ? '내 차례야.'
        : '상대방 차례야.';

    updateOnlineInput();
  }
);

/*
 * 온라인 게임 종료
 */
socket.on(
  'game_over',
  result => {
    $('onlineMessage').textContent =
      result.winner === myId
        ? '온라인 승리!'
        : '온라인 패배!';

    onlineStarted =
      false;

    onlineTurn =
      null;

    updateOnlineInput();
  }
);

/*
 * 방 만들기
 */
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

/*
 * 방 참가
 */
$('join').onclick =
  () => {
    socket.emit(
      'join_room',
      {
        code:
          $('roomCode')
            .value,

        name:
          $('name')
            .value
            .trim() ||
          'Player'
      }
    );
  };

/*
 * 게임 시작
 */
$('startOnline').onclick =
  () => {
    socket.emit(
      'start_online'
    );
  };

/*
 * 온라인 입력
 */
$('onlineSend').onclick =
  onlineSubmit;

$('onlineInput').onkeydown =
  e => {
    if (e.key === 'Enter') {
      onlineSubmit();
    }
  };

function onlineSubmit() {

  if (!onlineStarted) {
    $('onlineMessage').textContent =
      '아직 게임이 시작되지 않았어.';
    return;
  }

  if (onlineTurn !== myId) {
    $('onlineMessage').textContent =
      '상대방 차례야.';
    return;
  }

  const word =
    $('onlineInput')
      .value
      .trim();

  if (!word) return;

  /*
   * 클라이언트에서도
   * 기본적인 두음법칙 검사
   */
  if (
    onlineLast &&
    !canConnect(
      onlineLast,
      word
    )
  ) {
    $('onlineMessage').textContent =
      `'${onlineLast.at(-1)}'에서 이어지는 단어가 아니야.`;
    return;
  }

  $('onlineInput').value =
    '';

  socket.emit(
    'play_word',
    {
      word
    }
  );
}

/*
 * 탭
 */
document
  .querySelectorAll(
    '.tabs button'
  )
  .forEach(button => {

    button.onclick =
      () => {

        document
          .querySelectorAll(
            '.tabs button'
          )
          .forEach(
            other =>
              other.classList.remove(
                'active'
              )
          );

        button.classList.add(
          'active'
        );

        $('single')
          .classList.toggle(
            'hidden',
            button.dataset.mode !==
              'single'
          );

        $('online')
          .classList.toggle(
            'hidden',
            button.dataset.mode !==
              'online'
          );

        if (
          button.dataset.mode ===
          'online'
        ) {
          updateOnlineInput();
        }
      };
  });

/*
 * 시작
 */
loadData().catch(
  error => {
    console.error(error);

    $('message').textContent =
      '게임 데이터를 불러오지 못했습니다.';
  }
);
