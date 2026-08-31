(function (root) {
  "use strict";

  const KEYBOARD_THRESHOLD = 72;
  const MAX_VIEWPORT = 10000;

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isEditable(element) {
    const tag = String(element?.tagName || "").toUpperCase();
    return tag === "TEXTAREA" || tag === "INPUT" || element?.isContentEditable === true;
  }

  function calculateViewport(input = {}) {
    const visualHeight = finite(input.visualHeight);
    const innerHeight = finite(input.innerHeight);
    const clientHeight = finite(input.clientHeight);
    const height = clamp(visualHeight > 0 ? visualHeight : Math.max(innerHeight, clientHeight, 1), 1, MAX_VIEWPORT);
    const top = clamp(finite(input.offsetTop), 0, MAX_VIEWPORT);
    const layoutHeight = clamp(Math.max(innerHeight, clientHeight, height + top), 1, MAX_VIEWPORT);
    const baselineHeight = clamp(Math.max(finite(input.baselineHeight), layoutHeight), 1, MAX_VIEWPORT);
    const keyboardHeight = Math.max(0, Math.round(baselineHeight - (height + top)));
    return {
      height: Math.round(height),
      top: Math.round(top),
      keyboardHeight,
      keyboard: input.focused === true && keyboardHeight >= KEYBOARD_THRESHOLD,
    };
  }

  function createViewportController(options = {}) {
    const win = options.window || root.window || root;
    const doc = options.document || win.document;
    const docElement = doc?.documentElement;
    const body = doc?.body;
    if (!docElement?.style || !body?.dataset) return { update() {}, destroy() {}, snapshot() { return null; } };

    let baselineHeight = 0;
    let scheduled = false;
    let destroyed = false;
    let last = null;
    const timers = new Set();
    const listeners = [];
    const scheduleFrame = typeof win.requestAnimationFrame === "function"
      ? callback => win.requestAnimationFrame(callback)
      : callback => win.setTimeout(callback, 0);
    const delay = typeof win.setTimeout === "function" ? win.setTimeout.bind(win) : setTimeout;
    const cancelDelay = typeof win.clearTimeout === "function" ? win.clearTimeout.bind(win) : clearTimeout;

    function listen(target, name, handler) {
      if (typeof target?.addEventListener !== "function") return;
      target.addEventListener(name, handler, { passive: true });
      listeners.push(() => target.removeEventListener?.(name, handler));
    }

    function apply() {
      if (destroyed) return null;
      const viewport = win.visualViewport;
      const active = doc.activeElement;
      const focused = isEditable(active);
      const visualHeight = finite(viewport?.height, finite(win.innerHeight, finite(docElement.clientHeight, 1)));
      const offsetTop = finite(viewport?.offsetTop);
      const layoutHeight = Math.max(finite(win.innerHeight), finite(docElement.clientHeight), visualHeight + offsetTop, 1);
      if (!focused || baselineHeight <= 0) baselineHeight = layoutHeight;
      last = calculateViewport({ visualHeight, offsetTop, innerHeight: win.innerHeight, clientHeight: docElement.clientHeight, baselineHeight, focused });
      docElement.style.setProperty("--viewport-height", `${last.height}px`);
      docElement.style.setProperty("--viewport-top", `${last.top}px`);
      docElement.style.setProperty("--keyboard-height", `${last.keyboardHeight}px`);
      body.dataset.keyboard = String(last.keyboard);
      if (last.keyboard && active?.id !== "input" && typeof active?.scrollIntoView === "function") {
        try { active.scrollIntoView({ block: "nearest", inline: "nearest" }); }
        catch { active.scrollIntoView(false); }
      }
      options.onChange?.(last);
      return last;
    }

    function update() {
      if (destroyed || scheduled) return;
      scheduled = true;
      scheduleFrame(() => { scheduled = false; apply(); });
    }

    function settle() {
      for (const timer of timers) cancelDelay(timer);
      timers.clear();
      update();
      for (const milliseconds of [80, 260, 520]) {
        const timer = delay(() => { timers.delete(timer); update(); }, milliseconds);
        timers.add(timer);
      }
    }

    function resetBaseline() {
      baselineHeight = 0;
      settle();
    }

    listen(win, "resize", update);
    listen(win, "orientationchange", resetBaseline);
    listen(win.visualViewport, "resize", update);
    listen(win.visualViewport, "scroll", update);
    listen(doc, "focusin", settle);
    listen(doc, "focusout", settle);
    listen(doc, "visibilitychange", () => { if (!doc.hidden) resetBaseline(); });
    apply();

    return {
      update: settle,
      snapshot: () => last,
      destroy() {
        destroyed = true;
        for (const timer of timers) cancelDelay(timer);
        timers.clear();
        for (const remove of listeners.splice(0)) remove();
      },
    };
  }

  root.DshViewport = Object.freeze({ KEYBOARD_THRESHOLD, calculateViewport, createViewportController, isEditable });
})(typeof globalThis === "object" ? globalThis : this);
