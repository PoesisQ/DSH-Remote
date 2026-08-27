// Explicit opt-in, non-destructive encrypted presence probe; no chat/approval commands.
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config.js";
import { makeEnvelope, sealEnvelope, openEnvelope } from "../src/crypto.js";
import { UsageReader } from "../src/usage.js";
const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/check-live.mjs <config.json> [--probe]");
const { config } = loadConfig(path), p = config.relay;
if (!p) throw new Error("No relay configured");
if (config.network?.httpsProxy) {
  process.env.HTTPS_PROXY = config.network.httpsProxy;
  process.env.HTTP_PROXY = config.network.httpsProxy;
  process.env.NO_PROXY = "localhost,127.0.0.1,::1";
  http.setGlobalProxyFromEnv();
}
const request = async (route, options = {}) => {
  const res = await fetch(p.url + route, { ...options, signal: AbortSignal.timeout(12000), headers: { authorization: `Bearer ${p.authToken}`, "content-type": "application/json", ...options.headers } });
  if (!res.ok) throw new Error(`Relay HTTP ${res.status}`);
  return res.json();
};
const health = await request("/api/health");
console.log(JSON.stringify({ cloud: health.ok, storage: health.storage }));
if (process.argv.includes("--usage-local")) {
  const result = await new UsageReader(config.usage?.script).read();
  console.log(JSON.stringify({ localUsage: result.status, balanceAvailable: result.snapshot?.balance !== null && result.snapshot?.balance !== undefined, scheduleAvailable: !!result.snapshot?.schedule }));
}
if (process.argv.includes("--probe") || process.argv.includes("--usage")) {
  const kind = process.argv.includes("--usage") ? "usage" : "presence";
  const probe = makeEnvelope(kind, {}), wire = sealEnvelope(p, probe, "to-pc");
  let cursor = `${Date.now() - 60000}-0`;
  await request("/api/push", { method: "POST", body: JSON.stringify({ channel: p.channel, direction: "to-pc", id: probe.id, wire }) });
  const deadline = Date.now() + 45000;
  let found = false;
  while (Date.now() < deadline && !found) {
    const body = await request("/api/pull?" + new URLSearchParams({ channel: p.channel, direction: "to-phone", after: cursor, limit: "100" }));
    for (const item of body.messages ?? []) {
      cursor = item.cursor;
      const env = openEnvelope(p, item.wire, "to-phone");
      if (env?.k === kind && env.r === probe.id) {
        console.log(JSON.stringify(kind === "usage" ? { computer: "responded", usage: env.d.status, balanceAvailable: env.d.snapshot?.balance !== null && env.d.snapshot?.balance !== undefined, scheduleAvailable: !!env.d.snapshot?.schedule } : { computer: "responded", dsh: env.d.dsh, protocol: env.d.protocol })); found = true; break;
      }
    }
    if (!found && !body.hasMore) await delay(2000);
  }
  if (!found) { console.error("Computer did not confirm this probe within 45 seconds."); process.exitCode = 1; }
}
