import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_PLATFORM__ = "browser";

const registeredEvents = [];
const testDocument = {
  body: { classList: { contains: () => false } },
  contains: () => true,
  addEventListener(type, handler, capture) {
    registeredEvents.push({ type, handler, capture });
  }
};

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", {
  configurable: true,
  writable: true,
  value: testDocument
});

const { Platform } = await import("../../platform/index.js");
Platform.current = null;
const { Router } = await import("./router.js");
const { FocusEngine } = await import("./focusEngine.js");

function makeKeyboardEvent(key, target = {}) {
  const calls = { preventDefault: 0, stopPropagation: 0, stopImmediatePropagation: 0 };
  return {
    key,
    keyCode: 0,
    which: 0,
    target,
    preventDefault() {
      calls.preventDefault += 1;
    },
    stopPropagation() {
      calls.stopPropagation += 1;
    },
    stopImmediatePropagation() {
      calls.stopImmediatePropagation += 1;
    },
    calls
  };
}

function installScreen(screen) {
  const original = Router.getCurrentScreen;
  Router.getCurrentScreen = () => screen;
  return () => {
    Router.getCurrentScreen = original;
  };
}

test("browser document keyboard flow normalizes standard keys once before reaching the screen", async () => {
  const received = [];
  const restore = installScreen({ onKeyDown: (event) => received.push(event) });
  try {
    FocusEngine.activeKeyDownStartedAt.clear();
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Tab", " "]) {
      FocusEngine.handleKey(makeKeyboardEvent(key));
    }

    assert.deepEqual(
      received.map((event) => ({ key: event.key, keyCode: event.keyCode })),
      [
        { key: "ArrowLeft", keyCode: 37 },
        { key: "ArrowRight", keyCode: 39 },
        { key: "ArrowUp", keyCode: 38 },
        { key: "ArrowDown", keyCode: 40 },
        { key: "Enter", keyCode: 13 },
        { key: "Tab", keyCode: 9 },
        { key: " ", keyCode: 32 }
      ]
    );
    assert.equal(received.length, 7);
  } finally {
    restore();
  }
});

test("Escape uses the existing browser back path while editable Backspace remains text editing", () => {
  const originalBack = Router.back;
  const received = [];
  let backCalls = 0;
  const restore = installScreen({ onKeyDown: (event) => received.push(event) });
  Router.back = () => {
    backCalls += 1;
  };
  try {
    FocusEngine.lastBackHandledAt = 0;
    const escape = makeKeyboardEvent("Escape");
    FocusEngine.handleKey(escape);
    assert.equal(backCalls, 1);
    assert.equal(escape.calls.preventDefault, 1);

    const input = { tagName: "INPUT" };
    const backspace = makeKeyboardEvent("Backspace", input);
    FocusEngine.handleKey(backspace);
    assert.equal(backCalls, 1);
    assert.equal(backspace.calls.preventDefault, 0);
    assert.equal(received.at(-1)?.key, "Backspace");
  } finally {
    Router.back = originalBack;
    restore();
  }
});

test("legacy non-browser aliases and back codes no longer become browser actions", () => {
  const received = [];
  const restore = installScreen({ onKeyDown: (event) => received.push(event) });
  try {
    const legacyBack = makeKeyboardEvent("");
    legacyBack.keyName = "Back";
    legacyBack.keyCode = 10009;
    FocusEngine.handleKey(legacyBack);

    const dpadSelect = makeKeyboardEvent("");
    dpadSelect.keyCode = 23;
    FocusEngine.handleKey(dpadSelect);

    assert.deepEqual(
      received.map((event) => ({ key: event.key, keyCode: event.keyCode, keyName: event.keyName })),
      [
        { key: "", keyCode: 10009, keyName: "" },
        { key: "", keyCode: 23, keyName: "" }
      ]
    );
  } finally {
    restore();
  }
});

test("FocusEngine switches focus indicators between keyboard and pointer input", () => {
  const classes = new Set();
  testDocument.documentElement = { classList: {
    add: name => classes.add(name), remove: name => classes.delete(name)
  } };
  registeredEvents.length = 0;
  FocusEngine.init();
  assert.deepEqual(
    registeredEvents.map(({ type, capture }) => ({ type, capture })),
    [
      { type: "keydown", capture: true },
      { type: "keyup", capture: true },
      { type: "pointerdown", capture: true }
    ]
  );
  const restore = installScreen({});
  try {
    FocusEngine.handleKey(makeKeyboardEvent("Tab"));
    assert.equal(classes.has("keyboard-navigation"), true);
    registeredEvents.find(event => event.type === "pointerdown").handler();
    assert.equal(classes.has("keyboard-navigation"), false);
    FocusEngine.handleKey(makeKeyboardEvent("ArrowDown"));
    assert.equal(classes.has("keyboard-navigation"), true);
  } finally { restore(); delete testDocument.documentElement; }
});

test.after(() => {
  if (originalDocument) {
    Object.defineProperty(globalThis, "document", originalDocument);
  } else {
    delete globalThis.document;
  }
  delete globalThis.__NUVIO_PLATFORM__;
});
