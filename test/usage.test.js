import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { sanitizeUsage, UsageReader, runStatusScript } from "../src/usage.js";

const sample = (now = Date.now()) => ({ sampledAt: now, nowPeriod: "peak", model: "deepseek-v4-pro", balance: "53.35", currency: "CNY", totalCost: 1.2, totalTokens: 200,
  schedule: { timezone: "Asia/Shanghai", utcOffsetMinutes: 480, weekdaysOnly: true, peakWindows: [[540, 720], [840, 1080]] }, peak: { cost: 1 }, offpeak: { cost: 0.2 } });
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../phone/usage.js", import.meta.url), "utf8"), context);
const { UsageState } = context.DRUsage;

test("desktop snapshot allowlist strips secrets and preserves unavailable balances", () => {
  const value = sanitizeUsage({ ...sample(), apiKey: "private", nested: { secret: "private" }, balance: null, totalTokens: NaN, totalCost: -1 });
  assert.equal(value.balance, null); assert.equal(value.totalTokens, null); assert.equal(value.totalCost, null);
  assert.doesNotMatch(JSON.stringify(value), /private|apiKey|nested/);
  assert.equal(sanitizeUsage({ ...sample(), balance: "0" }).balance, 0);
  assert.equal(sanitizeUsage({ ...sample(), balance: "-0.10" }).balance, -0.1);
  assert.throws(() => sanitizeUsage({ error: "secret error" }));
});

test("usage reader coalesces concurrent calls and caches success and failures", async () => {
  let now = Date.now(), calls = 0, fail = false;
  const reader = new UsageReader("/local/status.sh", { now: () => now, run: async () => { calls++; if (fail) throw new Error("private key/path"); return JSON.stringify(sample(now)); } });
  const [a, b] = await Promise.all([reader.read(), reader.read()]);
  assert.equal(calls, 1); assert.equal(a, b); await reader.read(); assert.equal(calls, 1);
  now += 61000; fail = true;
  const error = await reader.read(); assert.equal(error.status, "unavailable"); assert.doesNotMatch(JSON.stringify(error), /private/);
  await reader.read(); assert.equal(calls, 2);
  assert.equal((await new UsageReader().read()).status, "not-configured");
});

test("script runner rejects missing scripts and non-absolute paths safely", async () => {
  await assert.rejects(runStatusScript("relative.sh"));
  await assert.rejects(runStatusScript("/nonexistent-status-script"), /unavailable/);
});

test("closing the usage reader cancels pending work and blocks new invocations", async () => {
  let calls = 0;
  const reader = new UsageReader("/local/status.sh", { run: (_script, { signal }) => new Promise((_resolve, reject) => {
    calls++; signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }) });
  const pending = reader.read(); reader.close();
  assert.equal((await pending).status, "unavailable");
  assert.equal((await reader.read()).status, "unavailable");
  assert.equal(calls, 1);
});

test("phone validates request references, keeps old snapshots labelled stale, resets on pairing", () => {
  let now = Date.now(); const u = new UsageState(() => now), packet = { protocol: 1, status: "ok", snapshot: sanitizeUsage(sample(now), now) };
  u.request("one"); assert.equal(u.accept("old", packet), false); assert.equal(u.accept("one", packet), true);
  assert.equal(u.view().stale, false); assert.equal(u.due(), false);
  now += 121000; assert.equal(u.due(), true); u.request("two");
  u.accept("two", { protocol: 1, status: "unavailable" });
  assert.equal(u.view().stale, true); assert.equal(u.view().balance, "¥53.35");
  now += 400000; u.reset(u.record); assert.equal(u.view().stale, true);
  u.reset(); assert.equal(u.view().balance, "—"); assert.equal(u.accept("two", packet), false);
});

test("phone derives peak windows from desktop schedule in Beijing time (weekdays only)", () => {
  for (const [iso, expected] of [
    ["2026-08-27T08:59:59+08:00", "off"], ["2026-08-27T09:00:00+08:00", "peak"],   // 周四
    ["2026-08-27T11:59:59+08:00", "peak"], ["2026-08-27T12:00:00+08:00", "off"],  // 午休
    ["2026-08-27T13:59:59+08:00", "off"], ["2026-08-27T14:00:00+08:00", "peak"],
    ["2026-08-27T17:59:59+08:00", "peak"], ["2026-08-27T18:00:00+08:00", "off"],
    ["2026-08-27T23:59:59+08:00", "off"],
    ["2026-08-29T10:00:00+08:00", "off"],  // 周六全天空闲
    ["2026-08-30T15:00:00+08:00", "off"],  // 周日全天空闲
    ["2026-08-31T09:30:00+08:00", "peak"], // 周一
  ]) {
    const now = Date.parse(iso), u = new UsageState(() => now); u.request("r");
    u.accept("r", { protocol: 1, status: "ok", snapshot: sanitizeUsage(sample(now), now) });
    assert.equal(u.view().period, expected);
  }
});

test("null balance never renders zero; expired replies cannot revive snapshots", () => {
  let now = Date.now(); const u = new UsageState(() => now);
  u.request("r"); u.accept("r", { protocol: 1, status: "ok", snapshot: sanitizeUsage({ ...sample(now), balance: null }, now) });
  assert.equal(u.view().balance, "—"); assert.match(u.view().status, /余额查询暂不可用/);
  u.request("late"); now += 61000; assert.equal(u.accept("late", { protocol: 1, status: "not-configured" }), false);
});
