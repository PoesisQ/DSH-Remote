import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import { makeRelayCredentials, makeEnvelope, sealEnvelope } from "../src/crypto.js";

function fixture(fetch = async () => new Response('{}')) {
  const storage = new Map(), elements = new Map();
  const element = () => ({ hidden: true, classList: { add() {}, remove() {}, contains() { return false; } }, dataset: {}, setAttribute(name, value) { this[name] = value; }, addEventListener() {}, textContent: "", value: "" });
  const context = vm.createContext({
    console, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, Response, crypto: webcrypto,
    btoa, atob, performance, fetch,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    document: { hidden: false, getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => [], addEventListener() {} },
    navigator: {}, location: { protocol: "http:" }, addEventListener() {},
  });
  context.window = context;
  vm.runInContext(readFileSync(new URL("../phone/connection.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../phone/usage.js", import.meta.url), "utf8"), context);
  const html = readFileSync(new URL("../phone/index.template.html", import.meta.url), "utf8");
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const pair = makeRelayCredentials("https://first.example.test");
  const setup = value => vm.runInContext(`pairing=${JSON.stringify(value)};session={pairing,keys:new Map(),abort:new AbortController(),pulling:false,pushing:null};state=freshState();`, context);
  setup(pair);
  return { context, storage, pair, setup, run: text => vm.runInContext(text, context) };
}

test("actual phone decryptor accepts Node ciphertext and rejects Base64 aliases", async () => {
  const f = fixture(), envelope = makeEnvelope("chat", { text: "mobile interoperability" });
  const wire = sealEnvelope(f.pair, envelope, "to-phone");
  const decoded = await f.run(`openWire(${JSON.stringify(wire)},"to-phone")`);
  assert.deepEqual(JSON.parse(JSON.stringify(decoded)), envelope);
  const parts = wire.split("."); parts[2] += "=";
  assert.equal(await f.run(`openWire(${JSON.stringify(parts.join("."))},"to-phone")`), null);
});

test("late pull after re-pairing cannot overwrite the new cursor or status", async () => {
  let respond; const f = fixture(() => new Promise(resolve => { respond = resolve; }));
  const pulling = f.run("pullOnce()"); await new Promise(resolve => setImmediate(resolve));
  f.run("disconnect()"); f.setup({ ...f.pair, url: "https://second.example.test" });
  respond(new Response(JSON.stringify({ ok: true, messages: [{ cursor: "20-0", wire: "bad" }] })));
  await pulling;
  assert.equal(f.run("state.cursorToPhone"), "0-0");
  assert.equal(f.run("connection.relay"), false);
});

test("old upload completion never removes a newly paired outbox item", async () => {
  let respond; const f = fixture(() => new Promise(resolve => { respond = resolve; }));
  f.run('state.outbox=[{id:"old-message",wire:"old"}]');
  const uploading = f.run("flushOutbox()");
  f.run("disconnect()"); f.setup({ ...f.pair, url: "https://second.example.test" });
  f.run('state.outbox=[{id:"new-message",wire:"new"}]');
  respond(new Response('{"ok":true}'));
  await assert.rejects(uploading, /连接已切换/);
  assert.equal(f.run("state.outbox[0].id"), "new-message");
});

test("phone never uploads or claims a durable queue when local storage fails", async () => {
  let uploads = 0; const f = fixture(async () => { uploads++; return new Response('{"ok":true}'); });
  f.context.localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
  await assert.rejects(f.run('push("msg",{text:"important"})'), /无法保存本地发送队列/);
  assert.equal(uploads, 0); assert.equal(f.run("state.outbox.length"), 0);
});

test("refresh is single-flight and re-pairing cancels the old follow-up hello", async () => {
  const f = fixture(); let release;
  f.context.waitForPull = () => new Promise(resolve => { release = resolve; });
  f.run('pullOnce=waitForPull;var helloCount=0;push=async()=>{helloCount++}');
  const refreshing = f.run("refreshRemote()");
  assert.equal(f.run('$("refresh").disabled'), true);
  await f.run("refreshRemote()");
  f.run("disconnect()"); f.setup({ ...f.pair, url: "https://second.example.test" });
  release(); await refreshing;
  assert.equal(f.run("helloCount"), 0);
  assert.equal(f.run('$("refresh").disabled'), false);
});

test("refresh always clears busy state after a failed request", async () => {
  const f = fixture();
  f.run('pullOnce=async()=>{};push=async()=>{throw new Error("offline")};renderNotice=()=>{}');
  await f.run("refreshRemote()");
  assert.equal(f.run('$("refresh")["aria-busy"]'), "false");
  assert.equal(f.run("session.refreshing"), false);
});

test("legacy phone history is migrated only to its first relay owner", () => {
  const f = fixture(), key = "dr-state-v2:" + f.pair.channel;
  f.storage.set(key, JSON.stringify({ cursorToPhone: "42-0", uiLog: [], outbox: [] }));
  f.run("loadState()"); assert.equal(f.run("state.cursorToPhone"), "42-0");
  f.setup({ ...f.pair, url: "https://second.example.test" });
  f.run("loadState()"); assert.equal(f.run("state.cursorToPhone"), "0-0");
  assert.equal(f.storage.has(key), true);
});

test("service worker upgrade leaves unrelated same-origin caches untouched", async () => {
  const handlers = {}, deleted = [];
  const context = vm.createContext({
    self: { addEventListener: (name, fn) => handlers[name] = fn, clients: { claim() {} } },
    caches: { keys: async () => ["notes-shell-v1", "dsh-remote-shell-v8", "dsh-remote-shell-v9", "dsh-remote-shell-v10"], delete: async key => deleted.push(key) },
  });
  vm.runInContext(readFileSync(new URL("../phone/sw.js", import.meta.url), "utf8"), context);
  let completed; handlers.activate({ waitUntil: promise => completed = promise }); await completed;
  assert.deepEqual(deleted, ["dsh-remote-shell-v8", "dsh-remote-shell-v9", "dsh-remote-shell-v10"]);
});
