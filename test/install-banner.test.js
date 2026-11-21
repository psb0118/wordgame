"use strict";

/* 홈 화면 추가(PWA) 배너 회귀 테스트 — 실제 client/script.js의
   initInstallBanner IIFE를 가짜 DOM에서 실행해 플랫폼별 안내 문구,
   설치 버튼, 닫기 스누즈 기간을 검증한다. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const clientSource = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const styleSource = fs.readFileSync(path.join(root, "client/style.css"), "utf8");

function bannerSource() {
  const start = clientSource.indexOf("(function initInstallBanner() {");
  assert.ok(start >= 0, "initInstallBanner IIFE를 찾지 못했습니다");
  const closing = "\n})();";
  const end = clientSource.indexOf(closing, start);
  assert.ok(end > start, "initInstallBanner 종료 지점을 찾지 못했습니다");
  return clientSource.slice(start, end + closing.length);
}
const BANNER_SOURCE = bannerSource();

const SNOOZE_DAYS = Number(/const SNOOZE_DAYS = (\d+);/.exec(BANNER_SOURCE)?.[1]);
assert.ok(Number.isFinite(SNOOZE_DAYS), "SNOOZE_DAYS 상수를 읽지 못했습니다");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 21, 9);
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/* ---------------------------------------------------------
   최소 DOM — initInstallBanner가 실제로 쓰는 API만 지원한다.
--------------------------------------------------------- */
class ClassList {
  constructor(classes = []) {
    this.set = new Set(classes);
  }
  contains(name) { return this.set.has(name); }
  add(...names) { for (const name of names) this.set.add(name); }
  remove(...names) { for (const name of names) this.set.delete(name); }
}

class Element {
  constructor(id = "", classes = []) {
    this.id = id;
    this.textContent = "";
    this.classList = new ClassList(classes);
    this.listeners = new Map();
    this.clicked = 0;
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  click() {
    this.clicked += 1;
    for (const handler of this.listeners.get("click") || []) handler({ target: this });
  }
}

class Doc {
  constructor() {
    this.elements = new Map();
  }
  add(id, classes = []) {
    const element = new Element(id, classes);
    this.elements.set(id, element);
    return element;
  }
  getElementById(id) { return this.elements.get(id) || null; }
}

function createBanner(options = {}) {
  const doc = new Doc();
  const banner = doc.add("installBanner", ["install-banner", "hidden"]);
  const title = doc.add("installTitle");
  const hint = doc.add("installHint");
  const action = doc.add("installAction", ["install-banner-action", "hidden"]);
  const close = doc.add("installClose", ["install-banner-close"]);

  const values = new Map(Object.entries(options.storage || {}));
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
  const navigator = {
    userAgent: options.ua || ANDROID_UA,
    maxTouchPoints: options.maxTouchPoints || 0,
  };
  if (options.navigatorStandalone) navigator.standalone = true;

  const windowListeners = new Map();
  const win = {
    matchMedia: () => ({ matches: !!options.displayStandalone }),
    addEventListener(type, handler) {
      const list = windowListeners.get(type) || [];
      list.push(handler);
      windowListeners.set(type, list);
    },
    dispatch(type, event) {
      for (const handler of windowListeners.get(type) || []) handler(event);
    },
  };

  const FakeDate = class extends Date {};
  FakeDate.now = () => (options.now === undefined ? NOW : options.now);

  const context = { window: win, document: doc, navigator, localStorage: storage, Date: FakeDate };
  vm.createContext(context);
  vm.runInContext(BANNER_SOURCE, context);

  return {
    banner, title, hint, action, close, values, win,
    isShown: () => !banner.classList.contains("hidden"),
    installEvent() {
      let prevented = 0;
      let prompted = 0;
      const event = {
        preventDefault() { prevented += 1; },
        prompt() { prompted += 1; },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      };
      win.dispatch("beforeinstallprompt", event);
      return {
        get prevented() { return prevented; },
        get prompted() { return prompted; },
      };
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/* ---------------------------------------------------------
   플랫폼별 안내 — 안드로이드는 설치 버튼, iOS는 공유 시트
--------------------------------------------------------- */
test("Android offers the native install prompt", async () => {
  const c = createBanner();
  assert.equal(c.isShown(), true, "안드로이드에서는 설치 안내를 띄웁니다");
  assert.match(c.hint.textContent, /홈 화면에 추가/);
  assert.equal(c.action.classList.contains("hidden"), true, "설치 이벤트 전에는 버튼을 숨깁니다");

  const install = c.installEvent();
  assert.equal(install.prevented, 1, "브라우저 기본 배너 대신 앱 배너를 씁니다");
  assert.equal(c.action.classList.contains("hidden"), false, "설치 준비가 되면 버튼을 보여야 합니다");

  c.action.click();
  await flush();
  assert.equal(install.prompted, 1, "버튼은 브라우저 설치 창을 열어야 합니다");
  assert.equal(c.isShown(), false);
  assert.equal(Number(c.values.get("kkInstallDismissedAt")), NOW);
});

test("iOS explains the Safari share sheet instead of a fake install button", () => {
  const c = createBanner({ ua: IPHONE_UA });
  assert.equal(c.isShown(), true);
  assert.match(c.hint.textContent, /공유/);
  assert.match(c.hint.textContent, /홈 화면에 추가/);
  assert.equal(c.action.classList.contains("hidden"), true, "iOS에는 설치 프롬프트가 없습니다");
});

test("iPadOS reported as Macintosh still gets the iOS guidance", () => {
  const c = createBanner({ ua: DESKTOP_UA, maxTouchPoints: 5 });
  assert.equal(c.isShown(), true);
  assert.match(c.hint.textContent, /공유/);
});

/* ---------------------------------------------------------
   닫기 — 일정 기간 동안 다시 띄우지 않는다
--------------------------------------------------------- */
test("closing hides the banner for the snooze period and then returns", () => {
  const first = createBanner();
  first.close.click();
  assert.equal(first.isShown(), false);
  assert.equal(Number(first.values.get("kkInstallDismissedAt")), NOW);

  const saved = Object.fromEntries(first.values);
  const soon = createBanner({ storage: saved, now: NOW + (SNOOZE_DAYS - 1) * DAY });
  assert.equal(soon.isShown(), false, "닫은 뒤 기간 안에는 다시 띄우지 않습니다");

  const later = createBanner({ storage: saved, now: NOW + (SNOOZE_DAYS + 1) * DAY });
  assert.equal(later.isShown(), true, "기간이 지나면 다시 안내합니다");
});

test("an already installed app or a desktop browser stays quiet", () => {
  const standalone = createBanner({ displayStandalone: true });
  assert.equal(standalone.isShown(), false);

  const iosStandalone = createBanner({ ua: IPHONE_UA, navigatorStandalone: true });
  assert.equal(iosStandalone.isShown(), false);

  const desktop = createBanner({ ua: DESKTOP_UA });
  assert.equal(desktop.isShown(), false);
  desktop.installEvent();
  assert.equal(desktop.isShown(), false, "데스크톱은 설치 배너 대상이 아닙니다");
});

test("finishing the install hides the banner", () => {
  const c = createBanner();
  c.win.dispatch("appinstalled", {});
  assert.equal(c.isShown(), false);
  assert.equal(Number(c.values.get("kkInstallDismissedAt")), NOW);
});

/* ---------------------------------------------------------
   마크업/스타일 계약 — 배너가 통째로 사라지지 않게 한다
--------------------------------------------------------- */
test("banner markup and styles stay wired", () => {
  for (const id of ["installBanner", "installTitle", "installHint", "installAction", "installClose"]) {
    assert.match(indexSource, new RegExp(`id="${id}"`), `${id} 마크업이 필요합니다`);
  }
  assert.ok(indexSource.indexOf('id="installBanner"') < indexSource.indexOf('class="app-grid"'),
    "배너는 헤더 아래 본문 앞에 놓여야 합니다");
  assert.match(styleSource, /\.install-banner \{ display: none; \}/,
    "데스크톱에서는 배너를 숨깁니다");
  assert.match(styleSource, /@media \(max-width: 860px\) \{\s*\.install-banner:not\(\.hidden\) \{[\s\S]*?display: flex/,
    "모바일에서는 배너를 보여야 합니다");
  assert.doesNotMatch(styleSource, /\.install-banner:not\(\.hidden\) \{[^}]*position: fixed/,
    "배너는 하단 내비게이션과 겹치지 않도록 인라인이어야 합니다");
});
