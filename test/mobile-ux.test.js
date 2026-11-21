"use strict";

/* 모바일 UX 회귀 테스트 — 뒤로가기 / 키보드 / 미니 HUD.
   실제 client/script.js의 initMobileUx IIFE를 가짜 DOM에서 실행해
   사용자 동작(뒤로가기, 입력 포커스, 스크롤)의 결과만 검증한다.
   실제 브라우저 없이도 "동작이 사라지는" 회귀를 잡는 것이 목적이다. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clientSource = fs.readFileSync(path.join(__dirname, "../client/script.js"), "utf8");
const styleSource = fs.readFileSync(path.join(__dirname, "../client/style.css"), "utf8");

function mobileUxSource() {
  const start = clientSource.indexOf("(function initMobileUx() {");
  assert.ok(start >= 0, "initMobileUx IIFE를 찾지 못했습니다");
  const closing = "\n})();";
  const end = clientSource.indexOf(closing, start);
  assert.ok(end > start, "initMobileUx 종료 지점을 찾지 못했습니다");
  return clientSource.slice(start, end + closing.length);
}
const UX_SOURCE = mobileUxSource();

/* ---------------------------------------------------------
   최소 DOM — initMobileUx가 실제로 쓰는 선택자만 지원한다.
--------------------------------------------------------- */
const SELECTOR_TOKEN = /#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*\]|:not\(([^)]+)\)|(\*)/g;

function matchesCompound(element, compound) {
  SELECTOR_TOKEN.lastIndex = 0;
  let offset = 0;
  let match;
  while ((match = SELECTOR_TOKEN.exec(compound))) {
    if (match.index !== offset) return false;   /* 지원하지 않는 문법 */
    offset = SELECTOR_TOKEN.lastIndex;
    if (match[1] && element.id !== match[1]) return false;
    if (match[2] && !element.classes.has(match[2])) return false;
    if (match[3] && !element.hasAttribute(match[3])) return false;
    if (match[4]) {
      const nested = match[4].trim();
      if (nested.startsWith(".") && element.classes.has(nested.slice(1))) return false;
      if (nested.startsWith("#") && element.id === nested.slice(1)) return false;
    }
  }
  return offset === compound.length;
}

function matches(element, selector) {
  return selector.split(",").map((part) => part.trim()).filter(Boolean)
    .some((part) => matchesCompound(element, part));
}

function isInside(element, root) {
  for (let node = element; node; node = node.parentEl) {
    if (node === root) return true;
  }
  return false;
}

class ClassList {
  constructor(element) {
    this.element = element;
    this.set = element.classes;
  }
  contains(name) { return this.set.has(name); }
  add(...names) {
    let changed = false;
    for (const name of names) {
      if (this.set.has(name)) continue;
      this.set.add(name);
      changed = true;
    }
    if (changed) this.element.notify();
  }
  remove(...names) {
    let changed = false;
    for (const name of names) {
      if (!this.set.has(name)) continue;
      this.set.delete(name);
      changed = true;
    }
    if (changed) this.element.notify();
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

class Element {
  constructor(doc, options = {}) {
    this.doc = doc;
    this.id = options.id || "";
    this.tagName = options.tag || "DIV";
    this.classes = new Set(options.classes || []);
    this.attrs = { ...(options.attrs || {}) };
    this.dataset = { ...(options.dataset || {}) };
    this.textContent = options.text || "";
    this.disabled = !!options.disabled;
    this.display = options.display || "block";
    this.rect = options.rect || { top: 0, bottom: 0, left: 0, right: 0 };
    this.onClick = options.onClick || null;
    this.clicked = 0;
    this.scrolledIntoView = 0;
    this.parentEl = null;
    this.kids = [];
    this.classList = new ClassList(this);
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value),
      getPropertyValue: (name) => this.style.values.get(name) || "",
    };
  }
  get className() { return [...this.classes].join(" "); }
  append(child) { child.parentEl = this; this.kids.push(child); }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  notify() { this.doc.notify(this); }
  click() { this.clicked += 1; if (this.onClick) this.onClick(this); }
  scrollIntoView() { this.scrolledIntoView += 1; }
  getBoundingClientRect() { return this.rect; }
  querySelector(selector) { return this.doc.query(selector, this); }
  closest(selector) {
    for (let node = this; node; node = node.parentEl) {
      if (matches(node, selector)) return node;
    }
    return null;
  }
}

class Doc {
  constructor() {
    this.elements = [];
    this.observers = [];
    this.activeElement = null;
    this.readyState = "complete";
    this.listeners = new Map();
    this.documentElement = this.addEl({ tag: "HTML" });
    this.body = this.addEl({ tag: "BODY" });
  }
  addEl(options, parent) {
    const element = new Element(this, options);
    this.elements.push(element);
    if (parent) parent.append(element);
    return element;
  }
  byId(id) { return this.elements.find((element) => element.id === id) || null; }
  queryAll(selector, root) {
    return this.elements.filter((element) => matches(element, selector)
      && (!root || isInside(element, root)));
  }
  query(selector, root) { return this.queryAll(selector, root)[0] || null; }
  querySelector(selector) { return this.query(selector); }
  querySelectorAll(selector) { return this.queryAll(selector); }
  notify(element) {
    for (const observer of this.observers) {
      if (observer.targets.has(element)) observer.callback([{ target: element }], observer);
    }
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
}

/* ---------------------------------------------------------
   initMobileUx 실행 환경
--------------------------------------------------------- */
const OVERLAYS = [
  { id: "roomListPanel", close: "roomListClose" },
  { id: "sideRank", close: "sideRankClose", closedBy: "closed" },
  { id: "friendsPanel", close: "friendsClose" },
  { id: "accountPanel", close: "accountClose" },
  { id: "chatPanel", close: "chatClose" },
  { id: "tutorialModal", close: "tutorClose" },
  { id: "wordDefModal", close: "wordDefClose" },
  { id: "bugModal", close: "bugClose" },
  { id: "adminModal", closeAttr: "data-admin-close" },
  { id: "howModal", closeAttr: "data-how-close" },
  { id: "replayModal", close: "replayClose" },
];

function createClient(options = {}) {
  const doc = new Doc();
  const windowListeners = new Map();
  const rafQueue = [];
  const timeouts = [];
  const state = {
    mobile: options.mobile !== false,
    innerHeight: options.innerHeight || 800,
    gameState: options.gameStarted === false ? null : { started: true, finished: false },
    currentMode: options.currentMode || "single",
  };

  const visualViewport = {
    height: state.innerHeight,
    offsetTop: 0,
    listeners: new Map(),
    addEventListener(type, handler) {
      const list = this.listeners.get(type) || [];
      list.push(handler);
      this.listeners.set(type, list);
    },
  };

  const win = {
    location: { href: "https://wordgame.test/" },
    innerHeight: state.innerHeight,
    visualViewport,
    matchMedia: () => ({ get matches() { return state.mobile; } }),
    addEventListener(type, handler) {
      const list = windowListeners.get(type) || [];
      list.push(handler);
      windowListeners.set(type, list);
    },
    dispatch(type, event = {}) {
      for (const handler of windowListeners.get(type) || []) handler(event);
    },
  };

  const history = {
    stack: [null],
    state: null,
    pushState(next) { this.stack.push(next); this.state = next; },
    back() {
      if (this.stack.length > 1) this.stack.pop();
      this.state = this.stack[this.stack.length - 1];
      win.dispatch("popstate");
    },
  };

  const panels = new Map();
  for (const spec of OVERLAYS) {
    const closedBy = spec.closedBy || "hidden";
    const panel = doc.addEl({ id: spec.id, classes: [closedBy] });
    panels.set(spec.id, panel);
    const hide = () => panel.classList.add(closedBy);
    if (spec.close) doc.addEl({ id: spec.close, tag: "BUTTON", onClick: hide }, panel);
    else doc.addEl({ tag: "BUTTON", attrs: { [spec.closeAttr]: "" }, onClick: hide }, panel);
  }

  const single = doc.addEl({ id: "single", classes: ["panel"] });
  const area = doc.addEl({ classes: ["single-input-area"] }, single);
  const input = doc.addEl({ id: "singleInput", tag: "INPUT" }, area);
  const timerBox = doc.addEl({ classes: ["timer-box"], rect: { top: 300, bottom: 400 } }, single);
  const last = doc.addEl({ id: "last", text: "드" }, single);
  const timer = doc.addEl({ id: "timer", text: "18" }, single);
  const turnIndicator = doc.addEl({ id: "turnIndicator", dataset: { turn: "mine" } }, single);

  const hud = doc.addEl({ id: "mobileHud", classes: ["mobile-hud", "hidden"] });
  const hudEls = {
    last: doc.addEl({ id: "mhLast" }, hud),
    timer: doc.addEl({ id: "mhTimer" }, hud),
    turn: doc.addEl({ id: "mhTurn" }, hud),
  };
  const modeEls = { last, timer, timerBox, turnIndicator };

  let hudTick = null;

  const context = {
    window: win,
    document: doc,
    history,
    location: win.location,
    getComputedStyle: (element) => ({ display: element.display }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); }
      observe(target) { this.targets.add(target); doc.observers.push(this); }
    },
    requestAnimationFrame: (callback) => { rafQueue.push(callback); return rafQueue.length; },
    setInterval: (callback) => { hudTick = callback; return 1; },
    setTimeout: (callback) => { timeouts.push(callback); return timeouts.length; },
    clearTimeout: (id) => { if (id > 0) timeouts[id - 1] = null; },
    currentMode: state.currentMode,
    gameState: state.gameState,
    modeGet: (name) => modeEls[name] || null,
  };
  vm.createContext(context);
  vm.runInContext(UX_SOURCE, context);

  const flushFrame = () => {
    /* apply()가 scrollIntoView용 rAF를 다시 예약하므로 빌 때까지 돌린다. */
    for (let guard = 0; guard < 20 && rafQueue.length; guard += 1) {
      const jobs = rafQueue.splice(0, rafQueue.length);
      for (const job of jobs) job();
    }
  };
  const flushTimers = () => {
    const jobs = timeouts.splice(0, timeouts.length);
    for (const job of jobs) if (job) job();
  };

  return {
    doc, win, history, panels, hud, hudEls, input, area, single, timerBox,
    last, timer, turnIndicator, state,
    panel: (id) => panels.get(id),
    open: (id) => panels.get(id).classList.remove(panels.get(id).classList.contains("closed") ? "closed" : "hidden"),
    isOpen: (id) => !panels.get(id).classList.contains("hidden") && !panels.get(id).classList.contains("closed"),
    focus: (element) => { doc.activeElement = element; doc.dispatch("focusin", { target: element }); },
    blur: () => { doc.activeElement = null; doc.dispatch("focusout", {}); },
    keyboard: (height) => { visualViewport.height = height; visualViewport.listeners.get("resize")?.forEach((fn) => fn()); },
    scroll: () => win.dispatch("scroll"),
    resize: () => win.dispatch("resize"),
    tickHud: () => { flushTimers(); flushFrame(); if (hudTick) hudTick(); },
    flushFrame, flushTimers,
    setMobile: (value) => { state.mobile = value; },
    offset: () => doc.documentElement.style.getPropertyValue("--kb-offset"),
    kbOpen: () => doc.body.classList.contains("kb-open"),
  };
}

/* ---------------------------------------------------------
   뒤로가기 — 열린 패널을 먼저 닫고 히스토리를 남기지 않는다
--------------------------------------------------------- */
test("mobile back button closes an open panel and leaves history clean", () => {
  const c = createClient();
  assert.equal(c.history.stack.length, 1, "초기에는 히스토리 엔트리가 하나여야 합니다");

  c.open("chatPanel");
  assert.equal(c.history.stack.length, 2, "패널을 열면 뒤로가기용 엔트리가 쌓여야 합니다");
  assert.equal(c.history.state.kkOverlay, true);

  c.history.back();
  assert.equal(c.isOpen("chatPanel"), false, "뒤로가기로 채팅 패널이 닫혀야 합니다");
  assert.equal(c.history.stack.length, 1, "닫은 뒤에는 엔트리가 남지 않아야 합니다");
  assert.equal(c.history.state, null);
});

test("room list uses its real element id so back closes it", () => {
  const c = createClient();
  c.open("roomListPanel");
  assert.equal(c.history.stack.length, 2, "방 목록도 뒤로가기 엔트리를 쌓아야 합니다");
  c.history.back();
  assert.equal(c.isOpen("roomListPanel"), false, "방 목록 패널이 뒤로가기로 닫혀야 합니다");
  assert.equal(c.history.stack.length, 1);
});

test("stacked panels close one per back press, topmost first", () => {
  const c = createClient();
  c.open("accountPanel");
  c.open("howModal");
  assert.equal(c.history.stack.length, 3);

  c.history.back();
  assert.equal(c.isOpen("howModal"), false, "가장 위 패널이 먼저 닫혀야 합니다");
  assert.equal(c.isOpen("accountPanel"), true, "아래 패널은 남아 있어야 합니다");

  c.history.back();
  assert.equal(c.isOpen("accountPanel"), false, "두 번째 뒤로가기로 아래 패널도 닫혀야 합니다");
  assert.equal(c.history.stack.length, 1);
});

test("closing a panel with its own close button pops the extra history entry", () => {
  const c = createClient();
  c.open("chatPanel");
  const close = c.panel("chatPanel").querySelector("#chatClose");
  assert.ok(close, "닫기 버튼을 찾지 못했습니다");

  close.click();
  assert.equal(c.isOpen("chatPanel"), false);
  assert.equal(c.history.stack.length, 1, "버튼으로 닫으면 쌓인 엔트리를 스스로 정리해야 합니다");
  assert.equal(c.history.state, null);
});

test("desktop viewport does not intercept the back button or add history", () => {
  const c = createClient({ mobile: false });
  c.open("chatPanel");
  assert.equal(c.history.stack.length, 1, "데스크톱에서는 히스토리를 건드리지 않습니다");

  c.history.back();
  assert.equal(c.isOpen("chatPanel"), true, "데스크톱 뒤로가기는 패널을 닫지 않습니다");
});

/* ---------------------------------------------------------
   키보드 — visualViewport 차이로 내비를 숨기고 입력 공간을 확보
--------------------------------------------------------- */
test("on-screen keyboard hides the bottom nav and sets the offset", () => {
  const c = createClient();
  c.focus(c.input);
  c.keyboard(500);
  c.flushFrame();

  assert.equal(c.kbOpen(), true, "키보드가 올라오면 kb-open이 켜져야 합니다");
  assert.equal(c.doc.documentElement.classList.contains("kb-open"), true);
  assert.equal(c.offset(), "300px", "키보드 높이만큼 --kb-offset이 설정되어야 합니다");
  assert.ok(c.area.scrolledIntoView >= 1, "입력 영역이 화면 안으로 스크롤되어야 합니다");
});

test("closing the keyboard restores the nav and clears the offset", () => {
  const c = createClient();
  c.focus(c.input);
  c.keyboard(500);
  c.flushFrame();
  assert.equal(c.kbOpen(), true);

  c.blur();
  c.keyboard(800);
  c.flushFrame();
  c.flushTimers();
  c.flushFrame();

  assert.equal(c.kbOpen(), false, "키보드가 내려가면 내비게이션이 돌아와야 합니다");
  assert.equal(c.offset(), "0px");
});

test("a small viewport change is not mistaken for a keyboard", () => {
  const c = createClient();
  c.focus(c.input);
  c.keyboard(740);       /* 60px — 주소창 변화 수준 */
  c.flushFrame();
  assert.equal(c.kbOpen(), false);
  assert.equal(c.offset(), "0px");
});

test("desktop keeps the layout untouched when the viewport resizes", () => {
  const c = createClient({ mobile: false });
  c.focus(c.input);
  c.keyboard(400);
  c.flushFrame();
  assert.equal(c.kbOpen(), false, "데스크톱에서는 키보드 보정을 하지 않습니다");
  assert.equal(c.offset(), "0px");
});

/* ---------------------------------------------------------
   미니 HUD — 게임 정보가 화면 밖일 때만, 방해 요소가 없을 때만
--------------------------------------------------------- */
test("mini HUD appears only when the game timer is off screen", () => {
  const c = createClient();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), true, "타이머가 보이면 HUD는 숨습니다");

  c.timerBox.rect = { top: -220, bottom: -120 };
  c.scroll();
  c.tickHud();

  assert.equal(c.hud.classList.contains("hidden"), false, "타이머가 화면 밖이면 HUD가 보여야 합니다");
  assert.equal(c.hudEls.last.textContent, "드");
  assert.equal(c.hudEls.timer.textContent, "18");
  assert.equal(c.hudEls.turn.textContent, "내 턴");
  assert.equal(c.hud.classList.contains("mine"), true, "내 턴이면 강조 표시되어야 합니다");
});

test("mini HUD disappears when the timer scrolls back into view", () => {
  const c = createClient();
  c.timerBox.rect = { top: -220, bottom: -120 };
  c.scroll();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), false);

  c.timerBox.rect = { top: 300, bottom: 400 };
  c.resize();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), true);
});

test("mini HUD hides while the keyboard or a panel is open", () => {
  const c = createClient();
  c.timerBox.rect = { top: -220, bottom: -120 };
  c.scroll();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), false);

  c.focus(c.input);
  c.keyboard(500);
  c.flushFrame();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), true, "키보드가 올라오면 HUD는 숨습니다");

  c.blur();
  c.keyboard(800);
  c.flushFrame();
  c.flushTimers();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), false, "키보드가 내려가면 다시 보여야 합니다");

  c.open("roomListPanel");
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), true, "방 목록이 열리면 HUD는 숨습니다");

  c.history.back();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), false, "패널을 닫으면 다시 보여야 합니다");
});

test("mini HUD stays hidden before the game starts or outside play panels", () => {
  const idle = createClient({ gameStarted: false });
  idle.timerBox.rect = { top: -220, bottom: -120 };
  idle.scroll();
  idle.tickHud();
  assert.equal(idle.hud.classList.contains("hidden"), true, "게임이 시작되지 않으면 HUD는 없습니다");

  const other = createClient({ currentMode: "wordbook" });
  other.timerBox.rect = { top: -220, bottom: -120 };
  other.scroll();
  other.tickHud();
  assert.equal(other.hud.classList.contains("hidden"), true, "게임 탭이 아니면 HUD는 없습니다");
});

test("mini HUD mirrors the urgent timer state", () => {
  const c = createClient();
  c.timerBox.rect = { top: -220, bottom: -120 };
  c.timerBox.dataset.urgent = "true";
  c.turnIndicator.dataset.turn = "ai";
  c.scroll();
  c.tickHud();
  assert.equal(c.hud.classList.contains("urgent"), true);
  assert.equal(c.hud.classList.contains("mine"), false);
  assert.equal(c.hudEls.turn.textContent, "AI 턴");
});

test("mini HUD ignores a desktop viewport", () => {
  const c = createClient({ mobile: false });
  c.timerBox.rect = { top: -220, bottom: -120 };
  c.scroll();
  c.tickHud();
  assert.equal(c.hud.classList.contains("hidden"), true);
});

/* ---------------------------------------------------------
   스타일 계약 — 모바일 규칙이 통째로 사라지지 않게 한다
--------------------------------------------------------- */
test("mobile stylesheet keeps the HUD, keyboard and nav rules", () => {
  assert.match(styleSource, /@media \(max-width: 860px\)[\s\S]*\.mobile-hud:not\(\.hidden\)/,
    "모바일 HUD 스타일이 필요합니다");
  assert.match(styleSource, /body\.kb-open \.nav-shell \{[\s\S]*?transform: translateY/,
    "키보드가 열리면 하단 내비를 숨겨야 합니다");
  assert.match(styleSource, /body\.kb-open \.chat-wrap:has\(\.chat-panel:not\(\.hidden\)\) \{[\s\S]*?bottom: calc\(var\(--kb-offset/,
    "채팅 패널은 키보드 위로 올라와야 합니다");
  assert.match(styleSource, /body\.kb-open \.mobile-hud \{ display: none !important; \}/,
    "키보드가 열린 동안 HUD는 겹치지 않아야 합니다");
  assert.match(styleSource, /html\.kb-open \{ scroll-padding-bottom: calc\(var\(--kb-offset/,
    "키보드 오프셋이 스크롤 여백에 반영되어야 합니다");
});
