import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hashAuthToken, makeRelayCredentials } from "../src/crypto.js";
import { createAppGateway } from "../vercel/lib/app-gateway.js";
import { parseRelayApps, relayAppLimits, resolveRelayApp } from "../vercel/lib/apps.js";
import { MemoryStreamStore } from "../vercel/lib/memory-store.js";

function registryFixture() {
  const alpha = makeRelayCredentials("https://relay.example.test");
  const beta = makeRelayCredentials("https://relay.example.test");
  // Reusing a channel by mistake must still not merge application streams.
  beta.channel = alpha.channel;
  const env = {
    DSH_RELAY_APPS_JSON: JSON.stringify({
      alpha: {
        channel: alpha.channel,
        authSha256: hashAuthToken(alpha.authToken),
        allowedOrigins: ["https://alpha.example.test"],
      },
      beta: {
        channel: beta.channel,
        authSha256: hashAuthToken(beta.authToken),
        allowedOrigins: ["https://beta.example.test"],
      },
    }),
  };
  const streams = new Map();
  const gateway = createAppGateway({ env, storeFactory: (namespace) => new MemoryStreamStore(namespace, streams) });
  return { alpha, beta, env, gateway };
}

function appUrl(appId, action, query = {}) {
  const url = new URL("https://relay.example.test/api/app");
  url.searchParams.set("__relay_app", appId);
  url.searchParams.set("__relay_action", action);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

test("multi-app registry is strict, bounded and never accepts raw client secrets", () => {
  const credentials = makeRelayCredentials("https://relay.example.test");
  const good = JSON.stringify({ notes: { channel: credentials.channel, authSha256: hashAuthToken(credentials.authToken), allowedOrigins: ["https://notes.example.test/"] } });
  const parsed = parseRelayApps(good);
  assert.equal(parsed.get("notes").namespace, "svc-notes");
  assert.deepEqual(parsed.get("notes").allowedOrigins, ["https://notes.example.test"]);
  assert.throws(() => parseRelayApps(JSON.stringify({ dsh: JSON.parse(good).notes })), /relay-app/);
  assert.throws(() => parseRelayApps(JSON.stringify({ notes: { ...JSON.parse(good).notes, authToken: credentials.authToken } })), /unknown-relay-app-field/);
  assert.throws(() => parseRelayApps(JSON.stringify({ notes: { ...JSON.parse(good).notes, allowedOrigins: ["http://public.example.test"] } })), /origin/);
  assert.equal(relayAppLimits.MAX_APPS, 32);
});

test("malformed registries fail closed without exposing configuration details", () => {
  assert.deepEqual(resolveRelayApp("notes", { DSH_RELAY_APPS_JSON: "{" }), { ok: false, status: 503, error: "app-registry-unavailable" });
  assert.deepEqual(resolveRelayApp("missing", { DSH_RELAY_APPS_JSON: "{}" }), { ok: false, status: 404, error: "app-not-found" });
  assert.deepEqual(resolveRelayApp("../bad", { DSH_RELAY_APPS_JSON: "{}" }), { ok: false, status: 404, error: "app-not-found" });
});

test("application paths isolate streams and credentials even when channels collide", async () => {
  const { alpha, beta, gateway } = registryFixture();
  const id = "messageid12345678";
  const wire = `v2.${id}.ciphertext`;
  const pushed = await gateway(new Request(appUrl("alpha", "push"), {
    method: "POST",
    headers: { authorization: `Bearer ${alpha.authToken}`, "content-type": "application/json", origin: "https://alpha.example.test" },
    body: JSON.stringify({ channel: alpha.channel, direction: "to-pc", id, wire }),
  }));
  assert.equal(pushed.status, 201);

  const alphaPull = await gateway(new Request(appUrl("alpha", "pull", { channel: alpha.channel, direction: "to-pc", after: "0-0" }), {
    headers: { authorization: `Bearer ${alpha.authToken}`, origin: "https://alpha.example.test" },
  }));
  assert.equal((await alphaPull.json()).messages.length, 1);

  const betaPull = await gateway(new Request(appUrl("beta", "pull", { channel: beta.channel, direction: "to-pc", after: "0-0" }), {
    headers: { authorization: `Bearer ${beta.authToken}`, origin: "https://beta.example.test" },
  }));
  assert.equal((await betaPull.json()).messages.length, 0);

  const crossed = await gateway(new Request(appUrl("beta", "pull", { channel: beta.channel, direction: "to-pc", after: "0-0" }), {
    headers: { authorization: `Bearer ${alpha.authToken}`, origin: "https://beta.example.test" },
  }));
  assert.equal(crossed.status, 401);
});

test("each app has its own CORS allowlist and disabled or unknown apps stay closed", async () => {
  const { alpha, env, gateway } = registryFixture();
  const denied = await gateway(new Request(appUrl("alpha", "health"), { headers: { origin: "https://beta.example.test" } }));
  assert.equal(denied.status, 403);
  const allowed = await gateway(new Request(appUrl("alpha", "health"), { headers: { origin: "https://alpha.example.test" } }));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://alpha.example.test");
  assert.equal((await gateway(new Request(appUrl("missing", "health")))).status, 404);

  const source = JSON.parse(env.DSH_RELAY_APPS_JSON);
  source.alpha.disabled = true;
  const disabled = createAppGateway({ env: { DSH_RELAY_APPS_JSON: JSON.stringify(source) }, storeFactory: () => new MemoryStreamStore() });
  assert.equal((await disabled(new Request(appUrl("alpha", "health")))).status, 404);
  assert.equal(alpha.channel, source.alpha.channel);
});

test("Vercel routing exposes friendly app paths while preserving legacy endpoints", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel/vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.rewrites, [{
    source: "/api/apps/:appId/:action",
    destination: "/api/app?__relay_app=:appId&__relay_action=:action",
  }]);
  for (const file of ["push.js", "pull.js", "health.js", "app.js"]) {
    assert.doesNotThrow(() => readFileSync(new URL(`../vercel/api/${file}`, import.meta.url), "utf8"));
  }
});
