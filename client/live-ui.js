/* 리액션 · 입력 중 · 관전자 표시 — 채팅/게임 상태와 독립적인 UI 조각.
   script.js가 init()으로 소켓·닉네임 접근자를 넘겨준다. */
(function () {
  "use strict";

  const REACTION_EMOJIS = ["👍", "👏", "🔥", "😂", "🎉", "😮"];
  const TYPING_TTL_MS = 3000;
  const TYPING_THROTTLE_MS = 1500;
  const typingUsers = new Map();

  let lastTypingSentAt = 0;
  let deps = {
    getNickname: () => "",
    canEmit: () => false,
    emit: () => {},
    notify: () => {}
  };

  const $ = (selector) => document.querySelector(selector);

  function renderSpectatorLine(data) {
    const el = $("#spectatorLine");
    if (!el) return;
    const names = Array.isArray(data && data.spectators)
      ? data.spectators.map(s => s && s.nickname).filter(Boolean)
      : [];
    const count = Math.max(0, Number(data && data.count) || names.length);
    el.classList.toggle("hidden", count === 0);
    el.textContent = count === 0 ? "" :
      `👁 관전 ${count}명${names.length ? ` · ${names.slice(0, 3).join(", ")}${names.length > 3 ? " 외" : ""}` : ""}`;
  }

  function renderTypingLine() {
    const el = $("#typingLine");
    if (!el) return;
    const names = [...typingUsers.keys()];
    el.classList.toggle("hidden", names.length === 0);
    el.textContent = names.length === 0 ? "" :
      `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` 외 ${names.length - 2}명` : ""} 님이 입력 중…`;
  }

  function showTyping(data) {
    const nickname = String((data && data.nickname) || "").trim();
    if (!nickname || nickname === deps.getNickname()) return;
    clearTimeout(typingUsers.get(nickname));
    typingUsers.set(nickname, setTimeout(() => {
      typingUsers.delete(nickname);
      renderTypingLine();
    }, TYPING_TTL_MS));
    renderTypingLine();
  }

  function showReactionBubble(data) {
    if (!data || !data.emoji) return;
    const layer = $("#reactionLayer");
    if (!layer) return;
    const bubble = document.createElement("div");
    bubble.className = "reaction-bubble";
    bubble.style.left = `${8 + Math.random() * 72}%`;
    const emoji = document.createElement("span");
    emoji.className = "reaction-emoji";
    emoji.textContent = String(data.emoji);
    const from = document.createElement("span");
    from.className = "reaction-from";
    from.textContent = String(data.from || "");
    bubble.append(emoji, from);
    layer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2600);
  }

  function sendReaction(emoji) {
    if (!deps.canEmit()) { deps.notify("서버에 연결 중입니다...", "waiting"); return; }
    deps.emit("game:react", { emoji });
  }

  function initReactionBar() {
    const bar = $("#reactionBar");
    if (!bar || bar.dataset.ready === "1") return;
    bar.dataset.ready = "1";
    for (const emoji of REACTION_EMOJIS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = emoji;
      btn.title = `${emoji} 리액션 보내기`;
      btn.setAttribute("aria-label", `${emoji} 리액션 보내기`);
      btn.addEventListener("click", () => sendReaction(emoji));
      bar.appendChild(btn);
    }
  }

  /* 채팅 입력창의 타이핑 이벤트를 초당 1회 이하로 보낸다. */
  function onChatInput() {
    if (!deps.canEmit()) return;
    const now = Date.now();
    if (now - lastTypingSentAt < TYPING_THROTTLE_MS) return;
    lastTypingSentAt = now;
    deps.emit("chat:typing");
  }

  function init(options) {
    deps = { ...deps, ...(options || {}) };
    initReactionBar();
  }

  window.LiveUI = {
    init,
    onChatInput,
    renderSpectatorLine,
    showTyping,
    showReactionBubble
  };
})();
