import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("PWA inline application script parses and contains no MQTT runtime", () => {
  const html = readFileSync(new URL("../phone/index.template.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
  assert.doesNotMatch(html, /mqtt\.connect|broker\.emqx/i);
  assert.match(html, /dsh-remote\/v2:/);
  assert.match(html, /normalizePairingCode/);
  assert.doesNotMatch(html, /"cache-control":"no-store"/);
  assert.match(html, /\.\/markdown\.js/);
  assert.match(html, /\.\/viewport\.js/);
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(html, /--viewport-height/);
  assert.match(html, /createViewportController/);
  assert.match(html, /id="session-modal"/);
  assert.doesNotMatch(html, /<select\b/i);
  assert.match(html, /function cursorAfter/);
  assert.match(html, /pages<20/);
  assert.match(html, /x\.wire\.startsWith\(`v2\.\$\{x\.id\}\.\`\)/);

  const serviceWorker = readFileSync(new URL("../phone/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /dsh-remote-shell-v11/);
  assert.match(serviceWorker, /usage\.js/);
  assert.match(serviceWorker, /viewport\.js/);
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
});

test("PWA build inputs keep browser and Android keyboard handling aligned", () => {
  const html = readFileSync(new URL("../phone/index.template.html", import.meta.url), "utf8");
  const viewport = readFileSync(new URL("../phone/viewport.js", import.meta.url), "utf8");
  assert.equal(readFileSync(new URL("../vercel/viewport.js", import.meta.url), "utf8"), viewport);
  const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const activity = readFileSync(new URL("../android/app/src/main/java/com/poesis/dshremote/MainActivity.java", import.meta.url), "utf8");
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.match(activity, /SOFT_INPUT_ADJUST_RESIZE/);
  assert.match(activity, /OnGlobalLayoutListener/);
  assert.match(activity, /getWindowVisibleDisplayFrame/);
  assert.match(activity, /WindowInsets\.Type\.ime/);
  assert.match(activity, /visible\.isEmpty\(\)/);
  assert.match(activity, /minimumWebHeight/);
  assert.match(activity, /params\.bottomMargin = desiredMargin/);
  assert.match(activity, /return insets/);
  assert.match(html, /__dshViewportController/);
  assert.match(readFileSync(new URL("../scripts/build-pwa.mjs", import.meta.url), "utf8"), /"viewport\.js"/);
});
