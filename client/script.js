const socket = io();


/* =========================================================
   기본
========================================================= */

const $ = id =>
  document.getElementById(id);

let currentMode = "single";
let myPlayerIndex = null;
let currentTurn = 0;
let singleBusy = false;


/* =========================================================
   통계
========================================================= */

let stats = JSON.parse(
  localStorage.getItem("kkeulStats") ||
  '{"wins":0,"losses":0,"games":0,"totalTurns":0}'
);

function saveStats() {
  localStorage.setItem(
    "kkeulStats",
    JSON.stringify(stats)
  );

  updateStats();
}

function updateStats() {

  $("wins").textContent =
    stats.wins;

  $("losses").textContent =
    stats.losses;

  $("games").textContent =
    stats.games;

  $("avg").textContent =
    stats.games
      ? Math.round(
          stats.totalTurns /
          stats.games
        )
      : "-";

  const rate =
    stats.games
      ? Math.round(
          stats.wins /
          stats.games *
          100
        )
      : 0;

  $("winrate").textContent =
    `${rate}%`;
}

updateStats();


/* =========================================================
   모드 전환
========================================================= */

document
  .querySelectorAll(".tabs button")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll(
            ".tabs button"
          )
          .forEach(b =>
            b.classList.remove(
              "active"
            )
          );

        button.classList.add(
          "active"
        );

        currentMode =
          button.dataset.mode;

        $("single")
          .classList.toggle(
            "hidden",
            currentMode !== "single"
          );

        $("online")
          .classList.toggle(
            "hidden",
            currentMode !== "online"
          );
      }
    );
  });


/* =========================================================
   싱글 UI
========================================================= */

function setMessage(text) {
  $("message").textContent = text;
}

function addHistory(word, player, depth) {

  const item =
    document.createElement("div");

  item.className =
    `historyItem player${player}`;

  item.textContent =
    `${player === 0 ? "나" : "AI"}: ${word}` +
    (depth != null
      ? ` · 깊이 ${depth}`
      : "");

  $("history")
    .appendChild(item);

  $("history").scrollTop =
    $("history").scrollHeight;
}


function updateSingleState(data) {

  if (data.currentWord) {
    $("last").textContent =
      data.currentWord.at(-1);
  }

  if (data.history) {
    $("turn").textContent =
      data.history.length;
  }

  if (data.depth != null) {
    $("depth").textContent =
      data.depth;
  }

  if (data.nextCount != null) {
    $("message").textContent =
      `다음 선택지 ${data.nextCount}개`;
  }
}


/* =========================================================
   새 게임
========================================================= */

function newSingleGame() {

  if (singleBusy) return;

  singleBusy = true;

  $("history").innerHTML = "";
  $("last").textContent = "-";
  $("turn").textContent = "0";
  $("depth").textContent = "-";
  $("startWord").value = "";

  setMessage(
    "새 게임을 준비하는 중..."
  );

  socket.emit(
    "singleNewGame",
    {
      difficulty:
        Number(
          $("difficulty").value
        )
    }
  );
}


$("newStart")
  .addEventListener(
    "click",
    newSingleGame
  );

$("restart")
  .addEventListener(
    "click",
    newSingleGame
  );


/* =========================================================
   싱글 단어 입력
========================================================= */

function sendSingleWord() {

  if (singleBusy) return;

  const input =
    $("singleInput");

  const word =
    input.value.trim();

  if (!word) return;

  input.value = "";

  socket.emit(
    "singlePlay",
    {
      word
    }
  );
}


$("singleSend")
  .addEventListener(
    "click",
    sendSingleWord
  );


$("singleInput")
  .addEventListener(
    "keydown",
    e => {

      if (e.key === "Enter") {
        e.preventDefault();
        sendSingleWord();
      }
    }
  );


/* =========================================================
   싱글 시작됨
========================================================= */

socket.on(
  "singleStarted",
  data => {

    singleBusy = false;

    $("startWord").value =
      data.startWord;

    $("last").textContent =
      data.startWord.at(-1);

    $("turn").textContent =
      data.history.length;

    $("history").innerHTML = "";

    data.history.forEach(
      item =>
        addHistory(
          item.word,
          item.player,
          item.depth
        )
    );

    if (data.nextCount != null) {
      $("message").textContent =
        `AI 차례 · 선택지 ${data.nextCount}개`;
    }

    $("singleInput").focus();
  }
);


/* =========================================================
   싱글 단어 처리
========================================================= */

socket.on(
  "singleWordPlayed",
  data => {

    addHistory(
      data.word,
      data.player,
      data.depth
    );

    $("turn").textContent =
      data.history.length;

    $("last").textContent =
      data.word.at(-1);

    if (data.player === 0) {

      setMessage(
        `AI가 생각 중...`
      );

      singleBusy = true;

    } else {

      singleBusy = false;

      setMessage(
        `내 차례 · 선택지 ${data.nextCount ?? 0}개`
      );

      $("singleInput").focus();
    }

    if (data.depth != null) {
      $("depth").textContent =
        data.depth;
    }
  }
);


/* =========================================================
   싱글 오류
========================================================= */

socket.on(
  "singleError",
  message => {

    singleBusy = false;

    setMessage(message);
  }
);


/* =========================================================
   단어 거부
========================================================= */

socket.on(
  "wordRejected",
  data => {

    if (
      data.mode === "online"
    ) {
      $("onlineMessage")
        .textContent =
          data.reason;

      return;
    }

    singleBusy = false;

    setMessage(
      data.reason
    );

    $("singleInput").focus();
  }
);


/* =========================================================
   싱글 종료
========================================================= */

socket.on(
  "singleFinished",
  data => {

    singleBusy = false;

    const turns =
      data.history.length;

    stats.games++;
    stats.totalTurns += turns;

    if (data.winner === 0) {

      stats.wins++;

      setMessage(
        "승리! 게임이 끝났습니다."
      );

    } else {

      stats.losses++;

      setMessage(
        "AI 승리! 다시 도전해보세요."
      );
    }

    saveStats();
  }
);


/* =========================================================
   온라인
========================================================= */

function onlineMessage(text) {
  $("onlineMessage")
    .textContent = text;
}


$("create")
  .addEventListener(
    "click",
    () => {

      const name =
        $("name").value.trim() ||
        "Player";

      socket.emit(
        "createRoom",
        { name }
      );
    }
  );


$("join")
  .addEventListener(
    "click",
    () => {

      const name =
        $("name").value.trim() ||
        "Player";

      const code =
        $("roomCode")
          .value
          .trim()
          .toUpperCase();

      if (!code) {
        onlineMessage(
          "방 코드를 입력해주세요."
        );

        return;
      }

      socket.emit(
        "joinRoom",
        {
          name,
          code
        }
      );
    }
  );


$("startOnline")
  .addEventListener(
    "click",
    () => {

      socket.emit(
        "startOnline"
      );
    }
  );


$("onlineSend")
  .addEventListener(
    "click",
    () => {

      const input =
        $("onlineInput");

      const word =
        input.value.trim();

      if (!word) return;

      input.value = "";

      socket.emit(
        "playWord",
        { word }
      );
    }
  );


$("onlineInput")
  .addEventListener(
    "keydown",
    e => {

      if (e.key === "Enter") {
        e.preventDefault();

        $("onlineSend")
          .click();
      }
    }
  );


/* =========================================================
   온라인 방 생성
========================================================= */

socket.on(
  "roomCreated",
  data => {

    $("roomCode").value =
      data.code;

    onlineMessage(
      `방 생성 완료 · ${data.code}`
    );
  }
);


socket.on(
  "joinedRoom",
  data => {

    $("roomCode").value =
      data.code;

    onlineMessage(
      `방 참가 완료 · ${data.code}`
    );
  }
);


/* =========================================================
   방 상태
========================================================= */

socket.on(
  "roomState",
  room => {

    $("roomInfo").innerHTML = "";

    const title =
      document.createElement("div");

    title.textContent =
      `방 코드: ${room.code}`;

    $("roomInfo")
      .appendChild(title);


    room.players.forEach(
      player => {

        const div =
          document.createElement("div");

        div.textContent =
          `${player.index === 0 ? "방장" : "플레이어"}: ${player.name}`;

        $("roomInfo")
          .appendChild(div);

        if (
          player.id === socket.id
        ) {
          myPlayerIndex =
            player.index;
        }
      }
    );


    const canStart =
      room.players.length === 2 &&
      myPlayerIndex === 0 &&
      !room.started;

    $("startOnline")
      .classList.toggle(
        "hidden",
        !canStart
      );


    if (room.game) {

      currentTurn =
        room.game.turnPlayer;

      if (
        room.game.currentWord
      ) {
        $("onlineMessage")
          .textContent =
            currentTurn === myPlayerIndex
              ? "내 차례입니다."
              : "상대방 차례입니다.";
      }
    }
  }
);


/* =========================================================
   온라인 시작
========================================================= */

socket.on(
  "onlineStarted",
  data => {

    $("onlineHistory")
      .innerHTML = "";

    currentTurn =
      data.turnPlayer;

    onlineMessage(
      currentTurn === myPlayerIndex
        ? "게임 시작! 내 차례입니다."
        : "게임 시작! 상대방 차례입니다."
    );
  }
);


/* =========================================================
   온라인 단어
========================================================= */

socket.on(
  "wordPlayed",
  data => {

    if (
      data.mode === "single"
    ) {
      return;
    }

    const item =
      document.createElement("div");

    item.textContent =
      `${data.player === myPlayerIndex ? "나" : "상대"}: ${data.word}` +
      (data.depth != null
        ? ` · 깊이 ${data.depth}`
        : "");

    $("onlineHistory")
      .appendChild(item);

    $("onlineHistory").scrollTop =
      $("onlineHistory").scrollHeight;

    currentTurn =
      data.nextTurn;

    onlineMessage(
      currentTurn === myPlayerIndex
        ? "내 차례입니다."
        : "상대방 차례입니다."
    );
  }
);


/* =========================================================
   온라인 종료
========================================================= */

socket.on(
  "gameFinished",
  data => {

    const winner =
      data.winner === myPlayerIndex;

    onlineMessage(
      winner
        ? "승리했습니다!"
        : "게임에서 졌습니다."
    );
  }
);


/* =========================================================
   공통 오류
========================================================= */

socket.on(
  "errorMessage",
  message => {

    onlineMessage(message);
  }
);

socket.on(
  "roomMessage",
  message => {

    onlineMessage(message);
  }
);


/* =========================================================
   연결 상태
========================================================= */

socket.on(
  "connect",
  () => {

    console.log(
      "Socket.IO 연결:",
      socket.id
    );
  }
);
