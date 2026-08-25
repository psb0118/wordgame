"use strict";


/* =========================================================
   전역 상태
========================================================= */

let apiData = null;

let singleId = null;

let singleState = null;

let singleDifficulty = 3;

let onlineState = null;

let socket = null;

let stats = {
  wins: 0,
  losses: 0,
  games: 0,
  totalTurns: 0
};


/* =========================================================
   DOM
========================================================= */

const $ =
  id =>
    document.getElementById(id);


/* =========================================================
   메시지
========================================================= */

function message(text) {
  $("message").textContent =
    text || "";
}


function onlineMessage(text) {
  $("onlineMessage").textContent =
    text || "";
}


/* =========================================================
   API 데이터
========================================================= */

async function loadData() {
  try {
    const res =
      await fetch(
        "/api/data"
      );

    apiData =
      await res.json();

    console.log(
      "게임 데이터 로드:",
      apiData
    );

  } catch (err) {
    console.error(err);

    message(
      "게임 데이터를 불러오지 못했습니다."
    );
  }
}


/* =========================================================
   싱글 UI
========================================================= */

function renderSingle() {
  if (!singleState) {
    return;
  }


  const current =
    singleState.currentWord;


  $("startWord").value =
    current || "-";


  $("last").textContent =
    current
      ? current.at(-1)
      : "-";


  $("turn").textContent =
    singleState.history?.length ||
    0;


  const last =
    singleState.history?.at(-1);


  $("depth").textContent =
    last?.depth ??
    "-";


  const history =
    singleState.history || [];


  $("history").innerHTML =
    history
      .map(
        item => `
          <div class="historyItem">
            <span>
              ${escapeHtml(item.word)}
            </span>

            <small>
              ${
                item.player === 0
                  ? "플레이어"
                  : "AI"
              }

              ${
                item.depth != null
                  ? ` · 깊이 ${item.depth}`
                  : ""
              }
            </small>
          </div>
        `
      )
      .join("");


  $("wins").textContent =
    stats.wins;


  $("losses").textContent =
    stats.losses;


  $("games").textContent =
    stats.games;


  $("avg").textContent =
    stats.games
      ? (
          stats.totalTurns /
          stats.games
        ).toFixed(1)
      : "-";


  const winRate =
    stats.games
      ? (
          stats.wins /
          stats.games *
          100
        )
      : 0;


  $("winrate").textContent =
    `${winRate.toFixed(0)}%`;
}


/* =========================================================
   HTML escape
========================================================= */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   싱글 게임 시작
========================================================= */

async function startSingle() {
  singleDifficulty =
    Number(
      $("difficulty").value
    ) || 3;


  message(
    "새 게임을 시작하는 중..."
  );


  $("singleInput").disabled =
    true;

  $("singleSend").disabled =
    true;


  try {
    const res =
      await fetch(
        "/api/single/start",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              difficulty:
                singleDifficulty
            })
        }
      );


    const data =
      await res.json();


    if (!data.ok) {
      throw new Error(
        data.message ||
        "게임 시작 실패"
      );
    }


    singleId =
      data.id;

    singleState =
      data.state;


    stats.games++;


    renderSingle();


    $("singleInput").disabled =
      false;

    $("singleSend").disabled =
      false;


    $("singleInput").focus();


    message(
      `시작 단어: ${data.startWord} — 당신의 차례`
    );

  } catch (err) {
    console.error(err);

    message(
      err.message ||
      "게임 시작에 실패했습니다."
    );
  }
}


/* =========================================================
   싱글 단어 입력
========================================================= */

async function sendSingleWord() {
  if (!singleId) {
    message(
      "먼저 새 게임을 시작해주세요."
    );

    return;
  }


  const input =
    $("singleInput");

  const word =
    input.value.trim();


  if (!word) {
    return;
  }


  input.value = "";


  input.disabled =
    true;

  $("singleSend").disabled =
    true;


  try {
    const res =
      await fetch(
        "/api/single/play",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              id:
                singleId,

              word
            })
        }
      );


    const data =
      await res.json();


    if (!data.ok) {
      message(
        data.reason ||
        "단어를 사용할 수 없습니다."
      );

      return;
    }


    singleState =
      data.state;


    renderSingle();


    /*
     * 플레이어 승리
     */
    if (
      data.finished &&
      data.result?.winner === 0
    ) {
      stats.wins++;

      stats.totalTurns +=
        singleState.history.length;

      renderSingle();

      message(
        "승리했습니다."
      );

      return;
    }


    /*
     * AI가 끝낸 경우
     */
    if (
      data.finished &&
      data.botResult?.winner === 1
    ) {
      stats.losses++;

      stats.totalTurns +=
        singleState.history.length;

      renderSingle();

      message(
        `AI가 ${data.botWord}로 승리했습니다.`
      );

      return;
    }


    /*
     * AI가 단어를 냈음
     */
    if (data.botWord) {

      const depth =
        data.botDepth != null
          ? ` · 공격 깊이 ${data.botDepth}`
          : "";


      const choices =
        data.botNextCount != null
          ? ` · 다음 선택지 ${data.botNextCount}개`
          : "";


      message(
        `AI: ${data.botWord}${depth}${choices} — 당신의 차례`
      );
    }


  } catch (err) {
    console.error(err);

    message(
      "서버와 통신 중 오류가 발생했습니다."
    );

  } finally {

    input.disabled =
      false;

    $("singleSend").disabled =
      false;

    input.focus();
  }
}


/* =========================================================
   Socket.IO
========================================================= */

function connectSocket() {

  if (socket) {
    return;
  }


  socket =
    io();


  socket.on(
    "connect",
    () => {

      console.log(
        "Socket.IO 연결:",
        socket.id
      );

      onlineMessage(
        "서버에 연결되었습니다."
      );
    }
  );


  socket.on(
    "disconnect",
    () => {

      onlineMessage(
        "서버 연결이 끊어졌습니다."
      );
    }
  );


  socket.on(
    "errorMessage",
    text => {

      onlineMessage(
        text
      );
    }
  );


  socket.on(
    "roomMessage",
    text => {

      onlineMessage(
        text
      );
    }
  );


  socket.on(
    "roomCreated",
    data => {

      $("roomCode").value =
        data.code;


      onlineMessage(
        `방이 생성되었습니다. 코드: ${data.code}`
      );
    }
  );


  socket.on(
    "joinedRoom",
    data => {

      $("roomCode").value =
        data.code;


      onlineMessage(
        "방에 참가했습니다."
      );
    }
  );


  socket.on(
    "roomState",
    state => {

      onlineState =
        state;

      renderRoom();
    }
  );


  socket.on(
    "onlineStarted",
    data => {

      onlineMessage(
        `게임 시작! "${data.startChar}"으로 시작하는 단어를 입력하세요.`
      );

      renderRoom();
    }
  );


  socket.on(
    "wordPlayed",
    data => {

      onlineState =
        data.state;

      renderOnlineHistory();


      const myIndex =
        getMyPlayerIndex();


      if (
        data.player ===
        myIndex
      ) {
        onlineMessage(
          `${data.word} 입력 완료`
        );
      } else {
        onlineMessage(
          `상대: ${data.word}`
        );
      }


      renderRoom();
    }
  );


  socket.on(
    "wordRejected",
    data => {

      onlineMessage(
        data.reason
      );
    }
  );


  socket.on(
    "gameFinished",
    data => {

      onlineState =
        data.state;

      renderRoom();


      const myIndex =
        getMyPlayerIndex();


      if (
        data.winner ===
        myIndex
      ) {
        onlineMessage(
          "승리했습니다."
        );
      } else {
        onlineMessage(
          "패배했습니다."
        );
      }
    }
  );
}


/* =========================================================
   방 UI
========================================================= */

function getMyPlayerIndex() {

  if (
    !onlineState ||
    !onlineState.players
  ) {
    return -1;
  }


  return onlineState.players
    .findIndex(
      p =>
        p.id ===
        socket?.id
    );
}


function renderRoom() {

  if (!onlineState) {
    $("roomInfo").innerHTML =
      "";

    $("startOnline")
      .classList.add(
        "hidden"
      );

    return;
  }


  const players =
    onlineState.players || [];


  $("roomInfo").innerHTML =
    `
      <div>
        방 코드:
        <strong>
          ${escapeHtml(onlineState.code)}
        </strong>
      </div>

      <div>
        플레이어:
        ${players
          .map(
            (p, index) =>
              `<span>
                ${escapeHtml(p.name)}
                ${index === 0 ? " (방장)" : ""}
              </span>`
          )
          .join(" · ")}
      </div>

      ${
        onlineState.game
          ? `
            <div>
              현재 단어:
              <strong>
                ${
                  escapeHtml(
                    onlineState.game.currentWord ||
                    "-"
                  )
                }
              </strong>
            </div>

            <div>
              ${
                onlineState.game.turnPlayer ===
                getMyPlayerIndex()
                  ? "내 차례"
                  : "상대 차례"
              }
            </div>
          `
          : ""
      }
    `;


  /*
   * 방장이고 2명이면 시작 버튼
   */
  const isHost =
    players[0]?.id ===
    socket?.id;


  if (
    isHost &&
    players.length === 2 &&
    !onlineState.started
  ) {
    $("startOnline")
      .classList.remove(
        "hidden"
      );
  } else {
    $("startOnline")
      .classList.add(
        "hidden"
      );
  }


  /*
   * 입력 가능 여부
   */
  const myTurn =
    onlineState.started &&
    onlineState.game &&
    onlineState.game.turnPlayer ===
      getMyPlayerIndex();


  $("onlineInput").disabled =
    !myTurn;

  $("onlineSend").disabled =
    !myTurn;
}


function renderOnlineHistory() {

  const history =
    onlineState?.game?.history ||
    [];


  $("onlineHistory").innerHTML =
    history
      .map(
        item => `
          <div class="historyItem">
            <span>
              ${escapeHtml(item.word)}
            </span>

            <small>
              ${
                item.player === 0
                  ? "플레이어 1"
                  : "플레이어 2"
              }

              ${
                item.depth != null
                  ? ` · 깊이 ${item.depth}`
                  : ""
              }
            </small>
          </div>
        `
      )
      .join("");
}


/* =========================================================
   온라인 방 만들기
========================================================= */

function createRoom() {

  connectSocket();


  const name =
    $("name").value.trim() ||
    "Player";


  socket.emit(
    "createRoom",
    {
      name
    }
  );
}


/* =========================================================
   온라인 방 참가
========================================================= */

function joinRoom() {

  connectSocket();


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


/* =========================================================
   온라인 시작
========================================================= */

function startOnline() {

  if (!socket) {
    connectSocket();
  }


  socket.emit(
    "startOnline"
  );
}


/* =========================================================
   온라인 단어 입력
========================================================= */

function sendOnlineWord() {

  if (!socket) {
    return;
  }


  const input =
    $("onlineInput");


  const word =
    input.value.trim();


  if (!word) {
    return;
  }


  input.value = "";


  socket.emit(
    "playWord",
    {
      word
    }
  );
}


/* =========================================================
   탭
========================================================= */

function setupTabs() {

  document
    .querySelectorAll(
      ".tabs button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const mode =
              button.dataset.mode;


            document
              .querySelectorAll(
                ".tabs button"
              )
              .forEach(
                b =>
                  b.classList.remove(
                    "active"
                  )
              );


            button.classList.add(
              "active"
            );


            $("single")
              .classList.toggle(
                "hidden",
                mode !== "single"
              );


            $("online")
              .classList.toggle(
                "hidden",
                mode !== "online"
              );


            if (
              mode === "online"
            ) {
              connectSocket();
            }
          }
        );
      }
    );
}


/* =========================================================
   버튼 연결
========================================================= */

function setupButtons() {

  /*
   * 싱글
   */
  $("newStart")
    .addEventListener(
      "click",
      startSingle
    );


  $("restart")
    .addEventListener(
      "click",
      startSingle
    );


  $("singleSend")
    .addEventListener(
      "click",
      sendSingleWord
    );


  $("singleInput")
    .addEventListener(
      "keydown",
      event => {

        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          sendSingleWord();
        }
      }
    );


  $("difficulty")
    .addEventListener(
      "change",
      () => {

        singleDifficulty =
          Number(
            $("difficulty").value
          ) || 3;

        /*
         * 다음 게임부터 적용
         */
        message(
          `AI 난이도 Lv.${singleDifficulty}`
        );
      }
    );


  /*
   * 온라인
   */
  $("create")
    .addEventListener(
      "click",
      createRoom
    );


  $("join")
    .addEventListener(
      "click",
      joinRoom
    );


  $("startOnline")
    .addEventListener(
      "click",
      startOnline
    );


  $("onlineSend")
    .addEventListener(
      "click",
      sendOnlineWord
    );


  $("onlineInput")
    .addEventListener(
      "keydown",
      event => {

        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          sendOnlineWord();
        }
      }
    );


  $("roomCode")
    .addEventListener(
      "keydown",
      event => {

        if (
          event.key ===
          "Enter"
        ) {
          joinRoom();
        }
      }
    );
}


/* =========================================================
   시작
========================================================= */

async function init() {

  setupTabs();

  setupButtons();

  await loadData();

  /*
   * 첫 화면에서 바로
   * 싱글 게임 준비
   */
  await startSingle();
}


init();
