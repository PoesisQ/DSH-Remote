import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashAuthToken, makeEnvelope, makeRelayCredentials, openEnvelope, sealEnvelope } from "../src/crypto.js";
import { VercelRelay } from "../src/vercel-relay.js";
import { createHealthHandler, createPullHandler, createPushHandler } from "../vercel/lib/handlers.js";
import { MemoryStreamStore } from "../vercel/lib/memory-store.js";

async function localRelay(pairing) {
  const store = new MemoryStreamStore();
  const env = {
    DSH_RELAY_CHANNEL: pairing.channel,
    DSH_RELAY_AUTH_SHA256: hashAuthToken(pairing.authToken),
    DSH_ALLOWED_ORIGINS: "https://client.example.test",
  };
  const routes = new Map([
    ["/api/push", createPushHandler({ store, env })],
    ["/api/pull", createPullHandler({ store, env })],
    ["/api/health", createHealthHandler({ store, env })],
  ]);
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const url = `http://${incoming.headers.host}${incoming.url}`;
    const handler = routes.get(new URL(url).pathname);
    const response = await handler(new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body: incoming.method === "GET" ? undefined : Buffer.concat(chunks),
      duplex: "half",
    }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, store, url: `http://127.0.0.1:${address.port}` };
}

async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition timed out");
}

test("presence traffic never activates fast polling or durable outbox", async (context) => {
  const seed = makeRelayCredentials("http://127.0.0.1:8787"), local = await localRelay(seed);
  context.after(() => new Promise(resolve => local.server.close(resolve)));
  const pairing = { ...seed, url: local.url }, relay = new VercelRelay(pairing);
  relay.started = true; relay.abort = new AbortController();
  const probe = makeEnvelope("presence", {});
  await local.store.push(pairing.channel, "to-pc", { id: probe.id, wire: sealEnvelope(pairing, probe, "to-pc") });
  await relay.pullOnce(); await relay.publishPresence({ protocol: 1, dsh: "ready" }, probe.id);
  assert.equal(relay.activeUntil, 0); assert.equal(relay.state.outbox.length, 0);
  const response = await local.store.pull(pairing.channel, "to-phone", "0-0", 10);
  assert.equal(openEnvelope(pairing, response[0].wire, "to-phone").r, probe.id);
  const usage = makeEnvelope("usage", {});
  await local.store.push(pairing.channel, "to-pc", { id: usage.id, wire: sealEnvelope(pairing, usage, "to-pc") });
  await relay.pullOnce(); await relay.publishTransient("usage", { protocol: 1, status: "not-configured" }, usage.id);
  assert.equal(relay.activeUntil, 0); assert.equal(relay.state.outbox.length, 0);
  relay.postWire = async () => { throw new Error("offline"); }; relay.logger = { warn() {} };
  await relay.publishPresence({ protocol: 1, dsh: "ready" }, probe.id);
  assert.equal(relay.state.outbox.length, 0); assert.equal(relay.activeUntil, 0);
  await relay.close();
});

test("PC relay receives phone mail and persists PC mail for later phone pull", async (context) => {
  const seed = makeRelayCredentials("http://127.0.0.1:8787");
  const local = await localRelay(seed);
  context.after(() => new Promise((resolve) => local.server.close(resolve)));
  const pairing = { ...seed, url: local.url };
  const received = [];
  const statePath = join(mkdtempSync(join(tmpdir(), "dsh-relay-e2e-")), "state.json");
  const relay = new VercelRelay(pairing, {
    statePath,
    idlePollMs: 1000,
    activePollMs: 500,
    onEnvelope: (envelope) => received.push(envelope),
    logger: { log() {}, warn() {}, error() {} },
  });
  context.after(() => relay.close());
  relay.start();

  const phoneEnvelope = makeEnvelope("msg", { text: "from phone" });
  const phoneWire = sealEnvelope(pairing, phoneEnvelope, "to-pc");
  const pushed = await fetch(`${pairing.url}/api/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${pairing.authToken}`, "content-type": "application/json" },
    body: JSON.stringify({ channel: pairing.channel, direction: "to-pc", id: phoneEnvelope.id, wire: phoneWire }),
  });
  assert.equal(pushed.status, 201);
  await waitFor(() => received.length === 1);
  assert.deepEqual(received[0], phoneEnvelope);

  relay.publish("chat", { text: "from pc" });
  await waitFor(() => relay.state.outbox.length === 0);
  const query = new URLSearchParams({ channel: pairing.channel, direction: "to-phone", after: "0-0", limit: "10" });
  const pulled = await fetch(`${pairing.url}/api/pull?${query}`, {
    headers: { authorization: `Bearer ${pairing.authToken}` },
  });
  const body = await pulled.json();
  assert.equal(body.messages.length, 1);
  assert.equal(openEnvelope(pairing, body.messages[0].wire, "to-phone").d.text, "from pc");
});

test("processed phone message IDs remain deduplicated across bridge restarts", async (context) => {
  const seed = makeRelayCredentials("http://127.0.0.1:8787");
  const local = await localRelay(seed);
  context.after(() => new Promise((resolve) => local.server.close(resolve)));
  const pairing = { ...seed, url: local.url };
  const statePath = join(mkdtempSync(join(tmpdir(), "dsh-relay-dedupe-")), "state.json");
  const envelope = makeEnvelope("msg", { text: "execute once" });
  const wire = sealEnvelope(pairing, envelope, "to-pc");
  const pushDuplicate = () => fetch(`${pairing.url}/api/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${pairing.authToken}`, "content-type": "application/json" },
    body: JSON.stringify({ channel: pairing.channel, direction: "to-pc", id: envelope.id, wire }),
  });

  const firstReceived = [];
  const first = new VercelRelay(pairing, {
    statePath, idlePollMs: 1000, activePollMs: 500,
    onEnvelope: (value) => firstReceived.push(value),
    logger: { log() {}, warn() {}, error() {} },
  });
  first.start();
  assert.equal((await pushDuplicate()).status, 201);
  await waitFor(() => firstReceived.length === 1);
  const firstCursor = first.state.cursorToPc;
  await first.close();

  assert.equal((await pushDuplicate()).status, 201);
  const secondReceived = [];
  const second = new VercelRelay(pairing, {
    statePath, idlePollMs: 1000, activePollMs: 500,
    onEnvelope: (value) => secondReceived.push(value),
    logger: { log() {}, warn() {}, error() {} },
  });
  context.after(() => second.close());
  second.start();
  await waitFor(() => second.state.cursorToPc !== firstCursor);
  assert.equal(secondReceived.length, 0);
  assert.ok(second.state.seenToPc.includes(envelope.id));
});
