import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureConfig, loadConfig } from "../src/config.js";
import { makeRelayCredentials } from "../src/crypto.js";
import { cursorIsAfter, JsonStateStore } from "../src/state.js";

test("first initialization requires explicit relay, existing config keeps its endpoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-explicit-config-")), path = join(dir, "config.json");
  assert.throws(() => ensureConfig(path, { quiet: true, relayUrl: "" }), /relay-url/);
  const first = ensureConfig(path, { quiet: true, relayUrl: "https://first.example.test" });
  const second = ensureConfig(path, { quiet: true, relayUrl: "https://second.example.test" });
  assert.deepEqual(second.config.relay, first.config.relay);
});

test("state binds legacy queues to a relay and refuses cross-relay reuse", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-state-binding-")), store = new JsonStateStore(join(dir, "state.json"));
  const legacy = store.fresh("channel-one-1234"); legacy.cursorToPc = "22-0"; store.save(legacy);
  const migrated = store.load(legacy.channel, "https://one.example.test");
  assert.equal(migrated.cursorToPc, "22-0"); store.save(migrated);
  assert.throws(() => store.load(legacy.channel, "https://two.example.test"), /另一个中继/);
  assert.equal(store.load(legacy.channel, "https://one.example.test").cursorToPc, "22-0");
});

test("legacy MQTT config migrates without reusing the old key", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-remote-config-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ dshUrl: "http://127.0.0.1:9999", mqtt: { key: "secret" } }));
  const result = ensureConfig(path, { quiet: true, relayUrl: "https://example.vercel.app" });
  assert.equal(result.migrated, true);
  assert.equal(result.config.dshUrl, "http://127.0.0.1:9999");
  assert.equal(result.config.relay.url, "https://example.vercel.app");
  assert.equal("mqtt" in JSON.parse(readFileSync(path, "utf8")), false);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(loadConfig(path).needsRelay, false);
});

test("state is isolated when pairing channel rotates", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-remote-state-"));
  const store = new JsonStateStore(join(dir, "state.json"));
  const first = store.fresh("channel-one-1234");
  first.cursorToPc = "10-1";
  first.outbox.push({ id: "message-id-123456", wire: "v2.message-id-123456.iv.blob" });
  store.save(first);
  assert.equal(store.load("channel-one-1234").outbox.length, 1);
  assert.deepEqual(store.load("channel-two-1234"), store.fresh("channel-two-1234"));
});

test("corrupted cursor and queue entries are sanitized without blocking startup", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-remote-state-corrupt-"));
  const path = join(dir, "state.json");
  const warnings = [];
  writeFileSync(path, JSON.stringify({
    version: 1,
    channel: "channel-one-1234",
    cursorToPc: "not-a-cursor",
    outbox: [
      { id: "bad", wire: "plaintext" },
      { id: "message-id-123456", wire: "v2.message-id-123456.iv.blob" },
    ],
    seenToPc: ["message-id-123456", "bad", "message-id-123456"],
  }));
  const state = new JsonStateStore(path, { logger: { warn: (value) => warnings.push(value) } }).load("channel-one-1234");
  assert.equal(state.cursorToPc, "0-0");
  assert.deepEqual(state.outbox, [{ id: "message-id-123456", wire: "v2.message-id-123456.iv.blob" }]);
  assert.deepEqual(state.seenToPc, ["message-id-123456"]);
  assert.equal(warnings.length, 1);
});

test("stream cursor comparison remains exact beyond Number safe integer range", () => {
  assert.equal(cursorIsAfter("999999999999999999999-2", "999999999999999999999-1"), true);
  assert.equal(cursorIsAfter("999999999999999999998-9", "999999999999999999999-1"), false);
  assert.equal(cursorIsAfter("bad", "0-0"), false);
});

test("poll intervals are finite and clamped to safe limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-remote-config-polls-"));
  const path = join(dir, "config.json");
  const relay = makeRelayCredentials("https://example.vercel.app");
  writeFileSync(path, JSON.stringify({ relay: { ...relay, idlePollMs: "Infinity", activePollMs: -1 } }));
  let loaded = loadConfig(path).config.relay;
  assert.equal(loaded.idlePollMs, 15_000);
  assert.equal(loaded.activePollMs, 500);
  writeFileSync(path, JSON.stringify({ relay: { ...relay, idlePollMs: 9_999_999, activePollMs: 9_999_999 } }));
  loaded = loadConfig(path).config.relay;
  assert.equal(loaded.idlePollMs, 300_000);
  assert.equal(loaded.activePollMs, 60_000);
});
