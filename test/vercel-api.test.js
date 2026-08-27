import assert from "node:assert/strict";
import test from "node:test";
import { hashAuthToken, makeEnvelope, makeRelayCredentials, openEnvelope, sealEnvelope } from "../src/crypto.js";
import { createHealthHandler, createPullHandler, createPushHandler } from "../vercel/lib/handlers.js";
import { MemoryStreamStore } from "../vercel/lib/memory-store.js";
import { streamKey } from "../vercel/lib/namespace.js";

test("same-origin deployments need no hardcoded domain, foreign origins still fail", async () => {
  const { store, env } = fixture(); delete env.DSH_ALLOWED_ORIGINS;
  const health = createHealthHandler({ store, env });
  assert.equal((await health(new Request("https://new.example.test/api/health", { headers: { origin: "https://new.example.test" } }))).status, 200);
  assert.equal((await health(new Request("https://new.example.test/api/health", { headers: { origin: "https://evil.example.test" } }))).status, 403);
});

test("deployment namespaces isolate a shared store and keep legacy keys unchanged", async () => {
  const streams = new Map(), a = new MemoryStreamStore("notes", streams), b = new MemoryStreamStore("dsh", streams);
  const channel = "channel-12345678";
  assert.equal(streamKey(channel, "to-pc"), `dr:v2:${channel}:to-pc`);
  assert.throws(() => streamKey(channel, "to-pc", "../bad"), /namespace/);
  await a.push(channel, "to-pc", { id: "id", wire: "ciphertext" });
  assert.equal((await a.pull(channel, "to-pc", "0-0", 10)).length, 1);
  assert.equal((await b.pull(channel, "to-pc", "0-0", 10)).length, 0);
});

function fixture() {
  const pairing = makeRelayCredentials("https://relay.example.com");
  const env = {
    DSH_RELAY_CHANNEL: pairing.channel,
    DSH_RELAY_AUTH_SHA256: hashAuthToken(pairing.authToken),
    DSH_ALLOWED_ORIGINS: "https://client.example.com",
  };
  const store = new MemoryStreamStore();
  return { pairing, store, env };
}

test("push/pull stores only ciphertext and honors cursors", async () => {
  const { pairing, store, env } = fixture();
  const push = createPushHandler({ store, env });
  const pull = createPullHandler({ store, env });
  const envelope = makeEnvelope("msg", { text: "server cannot read this" });
  const wire = sealEnvelope(pairing, envelope, "to-pc");
  const pushed = await push(new Request("https://relay.example.com/api/push", {
    method: "POST",
    headers: { authorization: `Bearer ${pairing.authToken}`, "content-type": "application/json", origin: "https://client.example.com" },
    body: JSON.stringify({ channel: pairing.channel, direction: "to-pc", id: envelope.id, wire }),
  }));
  assert.equal(pushed.status, 201);
  const result = await pull(new Request(`https://relay.example.com/api/pull?channel=${pairing.channel}&direction=to-pc&after=0-0`, {
    headers: { authorization: `Bearer ${pairing.authToken}`, origin: "https://client.example.com" },
  }));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.messages.length, 1);
  assert.deepEqual(openEnvelope(pairing, body.messages[0].wire, "to-pc"), envelope);
  const empty = await pull(new Request(`https://relay.example.com/api/pull?channel=${pairing.channel}&direction=to-pc&after=${body.messages[0].cursor}`, {
    headers: { authorization: `Bearer ${pairing.authToken}` },
  }));
  assert.equal((await empty.json()).messages.length, 0);
});

test("API rejects wrong bearer, wrong origin and plaintext-shaped wires", async () => {
  const { pairing, store, env } = fixture();
  const push = createPushHandler({ store, env });
  const body = JSON.stringify({ channel: pairing.channel, direction: "to-pc", id: "abcdefghijklmnop", wire: "plaintext" });
  const wrongOrigin = await push(new Request("https://relay.example.com/api/push", {
    method: "POST", headers: { origin: "https://evil.example", authorization: `Bearer ${pairing.authToken}` }, body,
  }));
  assert.equal(wrongOrigin.status, 403);
  const malformed = await push(new Request("https://relay.example.com/api/push", {
    method: "POST", headers: { authorization: `Bearer ${pairing.authToken}` }, body,
  }));
  assert.equal(malformed.status, 400);
  const envelope = makeEnvelope("msg", {});
  const wire = sealEnvelope(pairing, envelope, "to-pc");
  const unauthorized = await push(new Request("https://relay.example.com/api/push", {
    method: "POST", headers: { authorization: "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    body: JSON.stringify({ channel: pairing.channel, direction: "to-pc", id: envelope.id, wire }),
  }));
  assert.equal(unauthorized.status, 401);
});

test("health reflects storage availability", async () => {
  const { store, env } = fixture();
  const response = await createHealthHandler({ store, env })(new Request("https://relay.example.com/api/health"));
  assert.deepEqual(await response.json(), { ok: true, protocol: 2, storage: "up" });
});

test("Android WebView origin passes CORS preflight", async () => {
  const { store, env } = fixture();
  env.DSH_ALLOWED_ORIGINS = "https://client.example.com,https://appassets.androidplatform.net";
  const response = await createPullHandler({ store, env })(new Request("https://relay.example.com/api/pull", {
    method: "OPTIONS",
    headers: {
      origin: "https://appassets.androidplatform.net",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization,cache-control",
    },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://appassets.androidplatform.net");
  assert.match(response.headers.get("access-control-allow-headers"), /authorization/);
  assert.match(response.headers.get("access-control-allow-headers"), /cache-control/);
});
