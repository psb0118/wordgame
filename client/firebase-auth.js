/* =========================================================
   client/firebase-auth.js — Firebase Google 로그인 + 서버 연동
   · firebase-config.js 의 window.FIREBASE_CONFIG 로 초기화
   · 로그인 성공 시 ID 토큰을 서버(player:firebaseAuth)로 보내
     현재 닉네임 계정에 Firebase uid를 연결한다.
   · 설정이 비어 있으면 계정 패널의 Firebase 영역을 숨긴다.
======================================================== */
(function () {
  "use strict";

  const cfg = window.FIREBASE_CONFIG || {};
  const configured = !!(cfg.apiKey && cfg.projectId && window.firebase && firebase.auth);

  let fbAuth = null;
  let fbUser = null;
  let pendingToken = null;

  const $id = (id) => document.getElementById(id);

  /* 로그인 상태를 script.js에 알린다 — 채팅·랭킹 게이트와 튜토리얼 표시 조건이 이 값을 본다 */
  function notifyAuthState(loggedIn, fromServer) {
    window.kkLoggedIn = !!loggedIn;
    try {
      window.dispatchEvent(new CustomEvent("kk-auth", { detail: { loggedIn: !!loggedIn, fromServer: !!fromServer } }));
    } catch (e) { /* 무시 */ }
  }

  function setStatus(text, type) {
    const el = $id("fbStatus");
    if (!el) return;
    el.textContent = text || "";
    el.className = "acc-fb-status" + (type === "ok" ? " ok" : type === "error" ? " error" : "");
  }

  function setMsg(text, type) {
    const el = $id("fbMsg");
    if (!el) return;
    el.textContent = text || "";
    el.dataset.type = type || "";
  }

  /* 소켓이 준비되면(연결됨) 보류 중이거나 현재 로그인된 사용자의 토큰을 서버로 전송 */
  async function sendTokenToServer() {
    if (!fbUser) return;
    let token = pendingToken;
    try {
      token = await fbUser.getIdToken();
    } catch (e) {
      token = pendingToken;
    }
    if (!token) return;
    pendingToken = token;
    try {
      if (typeof socket !== "undefined" && socket && socket.connected) {
        socket.emit("player:firebaseAuth", { idToken: token });
      }
    } catch (e) { /* 소켓 준비 전이면 연결 이벤트에서 재시도 */ }
  }

  function renderAuthState() {
    const loginBtn = $id("fbGoogleBtn");
    const logoutBtn = $id("fbLogoutBtn");
    if (fbUser) {
      if (loginBtn) loginBtn.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");
      const label = fbUser.displayName || fbUser.email || "Google 사용자";
      setStatus("로그인됨: " + label, "ok");
    } else {
      if (loginBtn) loginBtn.classList.remove("hidden");
      if (logoutBtn) logoutBtn.classList.add("hidden");
      setStatus("로그인하지 않음", "");
    }
  }

  function hideFirebaseUI(reason) {
    const box = $id("fbBox");
    if (box) box.classList.add("hidden");
    if (reason) console.log("[firebase]", reason);
  }

  function init() {
    const box = $id("fbBox");
    if (!configured) {
      hideFirebaseUI("설정 없음 — client/firebase-config.js 를 채워주세요.");
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      fbAuth = firebase.auth();
    } catch (err) {
      hideFirebaseUI("초기화 실패: " + err.message);
      return;
    }
    if (box) box.classList.remove("hidden");
    renderAuthState();

    $id("fbGoogleBtn")?.addEventListener("click", async () => {
      setMsg("Google 로그인 창을 여는 중...", "");
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await fbAuth.signInWithPopup(provider);
      } catch (err) {
        if (err && err.code === "auth/popup-closed-by-user") {
          setMsg("로그인이 취소되었습니다.", "error");
        } else {
          setMsg("로그인 실패: " + (err && err.message ? err.message : err), "error");
        }
      }
    });

    $id("fbLogoutBtn")?.addEventListener("click", async () => {
      try {
        await fbAuth.signOut();
        /* 서버 세션의 로그인 정보도 함께 제거 — 채팅/랭킹 게이트가 즉시 게스트로 동작 */
        try { if (typeof socket !== "undefined" && socket && socket.connected) socket.emit("player:firebaseLogout"); } catch (e) { /* 무시 */ }
        notifyAuthState(false, false);
        setMsg("로그아웃되었습니다.", "ok");
      } catch (err) {
        setMsg("로그아웃 실패: " + err.message, "error");
      }
    });

    /* 인증 상태 변화 → UI 갱신 + 서버 연동 */
    fbAuth.onAuthStateChanged(async (user) => {
      fbUser = user;
      renderAuthState();
      if (user) {
        setMsg("서버에 계정을 연결하는 중...", "");
        await sendTokenToServer();
      } else {
        pendingToken = null;
        notifyAuthState(false, false);
        setMsg("", "");
      }
    });
  }

  /* 서버 인증 결과 수신 */
  function listenServerResult() {
    const attach = () => {
      try {
        if (typeof socket !== "undefined" && socket) {
          socket.on("player:firebaseAuthResult", (data) => {
            if (!data) return;
            if (data.ok) {
              notifyAuthState(true, true);
              setMsg("Google 계정이 '" + (data.nickname || "") + "' 닉네임에 연결되었습니다.", "ok");
            } else if (data.needNickname) {
              notifyAuthState(true, true);
              setMsg(data.reason || "닉네임을 먼저 저장해주세요.", "error");
              const nick = $id("accNickInput");
              if (nick && !nick.value && (data.name || data.email)) {
                nick.value = (data.name || data.email).split("@")[0].slice(0, 12);
              }
            } else if (data.loggedOut) {
              notifyAuthState(false, true);
              setMsg("", "");
            } else {
              setMsg(data.reason || "Firebase 인증에 실패했습니다.", "error");
            }
          });
          /* 소켓이 나중에 연결되면 보류 중인 로그인 토큰을 전송 */
          socket.on("connect", () => { if (fbUser) sendTokenToServer(); });
          return true;
        }
      } catch (e) { /* 무시 */ }
      return false;
    };
    if (attach()) return;
    /* script.js가 아직 소켓을 만들기 전이면 잠깐 기다렸다가 재시도 */
    let tries = 0;
    const timer = setInterval(() => {
      if (attach() || ++tries > 20) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { init(); listenServerResult(); });
  } else {
    init();
    listenServerResult();
  }

  /* 다른 스크립트(script.js)에서 필요 시 호출할 수 있게 노출 */
  window.firebaseAuthRefresh = () => { if (fbUser) sendTokenToServer(); };
})();
