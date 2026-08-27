import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { initializeSuite, loadSuiteConfig, validateSuiteConfig } from "../src/suite-config.js";
import { callSuite, stopSuite, ownedProcess, processBirth, runtimePaths, legacyConfigPath } from "../src/suite-runtime.js";
import { JsonStateStore } from "../src/state.js";

test("suite init is portable, private and never overwrites existing configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "suite-config-")), path = join(dir, "config.json");
  initializeSuite(path, { cwd: dir }); assert.equal(loadSuiteConfig(path).remoteConfig, null);
  assert.throws(() => initializeSuite(path), /already exists/); assert.equal(statSync(path).mode & 0o777, 0o600);
  const config = loadSuiteConfig(path);
  for (const url of ["https://example.com", "http://127.0.0.1.evil.test", "http://user@localhost", "http://localhost/?key=secret"]) assert.throws(() => validateSuiteConfig({ ...config, dsh: { ...config.dsh, url } }));
});

test("suite rejects PID reuse / wrong owner and isolates profile sockets", () => {
  const profile = join(tmpdir(), "suite-one.json");
  assert.equal(ownedProcess({ pid: process.pid, birth: "wrong", profile }, profile), false);
  assert.equal(ownedProcess({ pid: process.pid, birth: processBirth(process.pid), profile, entry: "/another/app.js" }, profile), false);
  assert.notEqual(runtimePaths(profile).socket, runtimePaths(profile + "two").socket);
});

test("legacy bridge detection resolves the config, ignoring read-only CLI actions", () => {
  assert.equal(legacyConfigPath(["node", "bin/dsh-remote.js"], "/workspace"), "/workspace/config.json");
  assert.equal(legacyConfigPath(["node", "/app/bin/dsh-remote.js", "--config", "../private/config.json"], "/workspace"), "/private/config.json");
  assert.equal(legacyConfigPath(["node", "bin/dsh-remote.js", "--show-pairing"], "/workspace"), null);
  assert.equal(legacyConfigPath(["node", "bin/dsh-suite.js", "run"], "/workspace"), null);
});

test("unreadable state is preserved instead of replaying old commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "suite-state-")), path = join(dir, "state.json");
  writeFileSync(path, "broken-json");
  assert.throws(() => new JsonStateStore(path).load("channel"), { code: "STATE_UNREADABLE" });
  assert.equal(readFileSync(path, "utf8"), "broken-json");
});

test("suite reuses an external DSH but stopping it never kills that server", { skip: process.platform !== "linux" }, async t => {
  const server = createServer(async (req, res) => {
    for await (const _ of req) {}
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ type: "server-response", result: { ok: true, value: { version: "test" } } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = mkdtempSync(join(tmpdir(), "suite-borrow-")), path = join(dir, "config.json");
  const config = initializeSuite(path, { cwd: dir, command: "/must/not/start" });
  config.dsh.url = `http://127.0.0.1:${server.address().port}`; writeFileSync(path, JSON.stringify(config));
  const entry = fileURLToPath(new URL("../bin/dsh-suite.js", import.meta.url));
  const child = spawn(process.execPath, [entry, "run", "--config", path], { stdio: "ignore" });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let status;
  for (let i = 0; i < 100; i++) { try { status = await callSuite(path); break; } catch { await delay(30); } }
  assert.equal(status?.running, true); assert.equal(status.ownedDsh, false);
  const usage = await callSuite(path, "/usage"); assert.equal(usage.status, "not-configured");
  assert.equal(await stopSuite(path), true);
  assert.equal((await fetch(config.dsh.url)).status, 200);
  assert.equal(await stopSuite(path), false);
});

test("suite launches and stops its own DSH child and rejects duplicate supervisors", { skip: process.platform !== "linux" }, async t => {
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const dir = mkdtempSync(join(tmpdir(), "suite-owned-")), path = join(dir, "config.json");
  const config = initializeSuite(path, { cwd: dir, command: process.execPath });
  config.dsh.url = `http://127.0.0.1:${port}`; config.dsh.args = [fileURLToPath(new URL("./fixtures/fake-dsh.mjs", import.meta.url)), String(port)];
  writeFileSync(path, JSON.stringify(config));
  const entry = fileURLToPath(new URL("../bin/dsh-suite.js", import.meta.url));
  const child = spawn(process.execPath, [entry, "run", "--config", path], { stdio: "ignore" });
  t.after(async () => { await stopSuite(path); if (child.exitCode === null) child.kill("SIGTERM"); });
  let status; for (let i = 0; i < 150; i++) { try { status = await callSuite(path); break; } catch { await delay(30); } }
  assert.equal(status?.ownedDsh, true);
  const duplicate = spawn(process.execPath, [entry, "run", "--config", path], { stdio: "ignore" });
  assert.equal(await new Promise(resolve => duplicate.once("exit", resolve)), 1);
  await stopSuite(path); await assert.rejects(fetch(config.dsh.url));
});
