// Read-only local desktop adapter. Never pass script output/errors through wholesale.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const amount = v => (typeof v === "number" || typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) && Math.abs(Number(v)) < 1e12 ? Number(v) : null;
const nonnegative = v => { const n = amount(v); return n !== null && n >= 0 ? n : null; };
const code = v => typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : null;
const bucket = v => Object.fromEntries(["hit", "miss", "out", "cost"].map(k => [k, nonnegative(v?.[k])]));

export function sanitizeUsage(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || raw.error || !["off", "peak"].includes(raw.nowPeriod)) throw new Error("invalid status");
  const s = raw.schedule;
  const schedule = s?.timezone === "Asia/Shanghai" && s.utcOffsetMinutes === 480 && Number.isInteger(s.offStartMinute) && Number.isInteger(s.offEndMinute) && s.offStartMinute >= 0 && s.offEndMinute <= 1440 && s.offStartMinute < s.offEndMinute
    ? { timezone: s.timezone, utcOffsetMinutes: s.utcOffsetMinutes, offStartMinute: s.offStartMinute, offEndMinute: s.offEndMinute } : null;
  return {
    sampledAt: Number.isFinite(raw.sampledAt) && Math.abs(raw.sampledAt - now) < 300000 ? raw.sampledAt : now,
    model: typeof raw.model === "string" && /^[a-zA-Z0-9_./:-]{1,100}$/.test(raw.model) ? raw.model : null,
    nowPeriod: raw.nowPeriod, schedule, scope: "latest-active-session",
    sessionId: typeof raw.sessionId === "string" && /^session-[a-zA-Z0-9-]{1,80}$/.test(raw.sessionId) ? raw.sessionId : null,
    peak: bucket(raw.peak), offpeak: bucket(raw.offpeak), totalCost: nonnegative(raw.totalCost), totalTokens: nonnegative(raw.totalTokens),
    balance: amount(raw.balance), currency: code(raw.currency), costCurrency: code(raw.costCurrency) || "CNY",
    pricingDate: typeof raw.pricingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.pricingDate) ? raw.pricingDate : null,
  };
}

export async function runStatusScript(script, { timeoutMs = 18000, signal } = {}) {
  if (!isAbsolute(script)) throw new Error("absolute script path required");
  const temp = await mkdtemp(join(tmpdir(), "dsh-remote-usage-"));
  try {
    return await new Promise((resolve, reject) => {
      // A separate process group makes a timeout terminate curl/python as well.
      const child = spawn(script, [], { shell: false, detached: process.platform !== "win32", windowsHide: true,
        env: { ...process.env, TMPDIR: temp }, stdio: ["ignore", "pipe", "ignore"] });
      let output = "", size = 0, failed = false;
      const fail = () => { failed = true; try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {} };
      const onExit = () => { fail(); try { rmSync(temp, { recursive: true, force: true }); } catch {} };
      process.once("exit", onExit);
      signal?.addEventListener("abort", fail, { once: true });
      if (signal?.aborted) fail();
      const timer = setTimeout(fail, timeoutMs);
      child.stdout.on("data", chunk => { size += chunk.length; if (size > 16384) fail(); else output += chunk.toString("utf8"); });
      const cleanup = () => { clearTimeout(timer); process.off("exit", onExit); signal?.removeEventListener("abort", fail); };
      child.on("error", () => { cleanup(); reject(new Error("status script unavailable")); });
      child.on("close", status => { cleanup(); if (failed || status !== 0) reject(new Error("status script failed")); else resolve(output); });
    });
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export class UsageReader {
  constructor(script = null, { run = runStatusScript, now = Date.now } = {}) {
    this.script = script; this.run = run; this.now = now; this.pending = null; this.cached = null;
  }
  async read() {
    if (this.closed) return { protocol: 1, status: "unavailable", checkedAt: this.now() };
    if (!this.script) return { protocol: 1, status: "not-configured", checkedAt: this.now() };
    if (this.pending) return this.pending;
    if (this.cached && this.now() - this.cached.checkedAt < 60000) return this.cached;
    this.pending = (async () => {
      this.abort = new AbortController();
      let result;
      try { result = { status: "ok", snapshot: sanitizeUsage(JSON.parse(await this.run(this.script, { signal: this.abort.signal })), this.now()) }; }
      catch { result = { status: "unavailable" }; }
      return this.cached = { protocol: 1, ...result, checkedAt: this.now() };
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }
  close() { this.closed = true; this.abort?.abort(); }
}
