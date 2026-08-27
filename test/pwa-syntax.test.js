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
  assert.match(html, /id="session-modal"/);
  assert.doesNotMatch(html, /<select\b/i);
  assert.match(html, /function cursorAfter/);
  assert.match(html, /pages<20/);
  assert.match(html, /x\.wire\.startsWith\(`v2\.\$\{x\.id\}\.\`\)/);

  const serviceWorker = readFileSync(new URL("../phone/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /dsh-remote-shell-v9/);
  assert.match(serviceWorker, /usage\.js/);
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
});
