import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function loadViewport() {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(readFileSync(new URL("../phone/viewport.js", import.meta.url), "utf8"), context);
  return context.DshViewport;
}

function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign(extra, {
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    emit(name) { for (const handler of listeners.get(name) || []) handler(); },
  });
}

test("viewport calculation places the app exactly above an overlay keyboard", () => {
  const viewport = loadViewport();
  assert.deepEqual(
    JSON.parse(JSON.stringify(viewport.calculateViewport({ visualHeight: 480, innerHeight: 800, clientHeight: 800, baselineHeight: 800, focused: true }))),
    { height: 480, top: 0, keyboardHeight: 320, keyboard: true },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(viewport.calculateViewport({ visualHeight: 444, offsetTop: 36, innerHeight: 800, baselineHeight: 800, focused: true }))),
    { height: 444, top: 36, keyboardHeight: 320, keyboard: true },
  );
});

test("small browser chrome changes are not mistaken for a keyboard", () => {
  const viewport = loadViewport();
  const result = viewport.calculateViewport({ visualHeight: 750, innerHeight: 800, baselineHeight: 800, focused: true });
  assert.equal(result.height, 750);
  assert.equal(result.keyboardHeight, 50);
  assert.equal(result.keyboard, false);
  assert.equal(viewport.isEditable({ tagName: "textarea" }), true);
  assert.equal(viewport.isEditable({ tagName: "button" }), false);
});

test("controller tracks visual viewport resize, focus, close and orientation reset", () => {
  const viewport = loadViewport(), properties = new Map(), timerQueue = [];
  const visualViewport = eventTarget({ height: 800, offsetTop: 0 });
  const documentElement = { clientHeight: 800, style: { setProperty: (name, value) => properties.set(name, value) } };
  const body = { dataset: {} };
  const document = eventTarget({ activeElement: null, hidden: false, documentElement, body });
  const window = eventTarget({
    innerHeight: 800,
    visualViewport,
    document,
    requestAnimationFrame(callback) { callback(); return 1; },
    setTimeout(callback) { timerQueue.push(callback); return timerQueue.length; },
    clearTimeout() {},
  });
  const controller = viewport.createViewportController({ window, document });
  assert.equal(properties.get("--viewport-height"), "800px");
  assert.equal(body.dataset.keyboard, "false");

  document.activeElement = { tagName: "TEXTAREA" };
  document.emit("focusin");
  visualViewport.height = 470;
  visualViewport.emit("resize");
  assert.equal(properties.get("--viewport-height"), "470px");
  assert.equal(properties.get("--keyboard-height"), "330px");
  assert.equal(body.dataset.keyboard, "true");

  visualViewport.height = 800;
  document.activeElement = null;
  document.emit("focusout");
  while (timerQueue.length) timerQueue.shift()();
  assert.equal(properties.get("--viewport-height"), "800px");
  assert.equal(body.dataset.keyboard, "false");

  window.innerHeight = 420;
  documentElement.clientHeight = 420;
  visualViewport.height = 420;
  window.emit("orientationchange");
  while (timerQueue.length) timerQueue.shift()();
  assert.equal(controller.snapshot().height, 420);
  assert.equal(controller.snapshot().keyboard, false);
  controller.destroy();
});

test("invalid viewport metrics are bounded instead of producing NaN CSS", () => {
  const viewport = loadViewport();
  const result = viewport.calculateViewport({ visualHeight: Number.NaN, innerHeight: -10, clientHeight: 0, offsetTop: -5, baselineHeight: Infinity, focused: true });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { height: 1, top: 0, keyboardHeight: 0, keyboard: false });
});
