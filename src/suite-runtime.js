import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, chmodSync, unlinkSync, readdirSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { RemoteBridge } from "./bridge.js";
import { DshClient } from "./dsh-client.js";
import { UsageReader } from "./usage.js";

const entry = fileURLToPath(new URL("../bin/dsh-suite.js", import.meta.url));
export function legacyConfigPath(args, cwd) {
  const index = args.findIndex(arg => basename(arg) === "dsh-remote.js");
  if (index < 1 || args.slice(index + 1).some(arg => ["--init", "--help", "--show-pairing", "--show-vercel-env", "--rotate-pairing"].includes(arg))) return null;
  const flag = args.indexOf("--config", index + 1);
  return resolve(cwd, flag >= 0 ? args[flag + 1] || "config.json" : "config.json");
}
function assertNoLegacyBridge(configPath) {
  for (const pid of readdirSync("/proc").filter(value => /^\d+$/.test(value))) {
    if (Number(pid) === process.pid) continue;
    let detected;
    try {
      if (lstatSync("/proc/" + pid).uid !== process.getuid()) continue;
      detected = legacyConfigPath(readFileSync("/proc/" + pid + "/cmdline", "utf8").split("\0").filter(Boolean), readlinkSync("/proc/" + pid + "/cwd"));
    } catch { continue; }
    if (detected === resolve(configPath)) throw new Error("A standalone remote bridge is already using this config. Stop that bridge before starting the suite; no process was killed.");
  }
}
export function runtimePaths(configPath) {
  const key = createHash("sha256").update(resolve(configPath)).digest("hex").slice(0, 16);
  const dir = join(tmpdir(), `dsh-suite-${process.getuid?.() ?? "user"}-${key}`);
  return { dir, lock: join(dir, "owner.json"), socket: join(dir, "control.sock") };
}
export function processBirth(pid) {
  try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1).split(" ")[19]; } catch { return null; }
}
export function ownedProcess(owner, configPath) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 2 || owner.profile !== resolve(configPath) || owner.entry !== entry || !owner.birth || owner.birth !== processBirth(owner.pid)) return false;
  try {
    const args = readFileSync(`/proc/${owner.pid}/cmdline`, "utf8").split("\0");
    return args.includes("run") && args.includes(resolve(configPath)) && args.some(x => x === entry);
  } catch { return false; }
}
export function readOwner(configPath) { try { return JSON.parse(readFileSync(runtimePaths(configPath).lock, "utf8")); } catch { return null; } }
export function claimRuntime(configPath) {
  const paths = runtimePaths(configPath);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(paths.dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Error("Unsafe runtime directory");
  chmodSync(paths.dir, 0o700);
  if (existsSync(paths.lock)) {
    const owner = readOwner(configPath);
    if (!owner) throw new Error("Incomplete runtime lock; inspect before recovery");
    if (ownedProcess(owner, configPath)) throw new Error("This suite profile is already running");
    if (owner.profile !== resolve(configPath) || owner.entry !== entry) throw new Error("Unknown lock owner; not removed");
    unlinkSync(paths.lock);
  }
  const owner = { pid: process.pid, birth: processBirth(process.pid), entry, profile: resolve(configPath) };
  writeFileSync(paths.lock, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
  return paths;
}
export function callSuite(configPath, route = "/status") {
  return new Promise((resolveCall, reject) => {
    if (!ownedProcess(readOwner(configPath), configPath)) return reject(new Error("Suite is not running"));
    const req = http.get({ socketPath: runtimePaths(configPath).socket, path: route, timeout: 22000, agent: false }, res => {
      let value = "";
      res.on("data", chunk => { value += chunk; if (value.length > 20000) req.destroy(new Error("Oversize response")); });
      res.on("end", () => { try { if (res.statusCode !== 200) throw new Error("Suite request failed"); resolveCall(JSON.parse(value)); } catch (err) { reject(err); } });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Suite request timeout"))); req.on("error", reject);
  });
}
export async function stopSuite(configPath) {
  const owner = readOwner(configPath);
  if (!ownedProcess(owner, configPath)) return false;
  process.kill(owner.pid, "SIGTERM");
  for (let i = 0; i < 100 && ownedProcess(owner, configPath); i++) await delay(100);
  if (ownedProcess(owner, configPath)) throw new Error("Suite did not stop; no force-kill was issued");
  return true;
}

export async function runSuite(config, configPath) {
  if (process.platform !== "linux") throw new Error("Run the suite backend in Linux / WSL");
  const paths = claimRuntime(configPath), reader = new UsageReader(config.usageScript);
  let child = null, bridge = null, closed = false, childExited = false, operational = false, resolveExit;
  const finished = new Promise(resolveDone => { resolveExit = resolveDone; });
  const client = new DshClient(config.dsh.url);
  const healthy = async () => { try { const d = await client.rpc("host.describe", {}, { timeoutMs: 1200 }); return typeof d?.version === "string"; } catch { return false; } };
  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || !["/status", "/usage"].includes(req.url)) { res.writeHead(404); res.end(); return; }
    try {
      const result = req.url === "/usage" ? await reader.read() : { running: true, dsh: await healthy(), ownedDsh: !!child, remoteEnabled: !!bridge, relayReady: bridge?.relay?.ready ?? false };
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(result));
    } catch { res.writeHead(503); res.end('{}'); }
  });
  const stop = async () => {
    if (closed) return; closed = true;
    bridge?.stop(); reader.close(); server.close(); server.closeAllConnections();
    if (child && !childExited) {
      // Only the child created by this supervisor is signalled, never a port owner.
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      for (let i = 0; i < 40 && !childExited; i++) await delay(100);
      if (!childExited) try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
    for (const file of [paths.socket, paths.lock]) try { unlinkSync(file); } catch {}
    process.off("SIGTERM", stop); process.off("SIGINT", stop); resolveExit();
  };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  try {
    if (config.remoteConfig) assertNoLegacyBridge(config.remoteConfig);
    if (!(await healthy())) {
      if (closed) return;
      child = spawn(config.dsh.command, config.dsh.args, { cwd: config.dsh.cwd, stdio: ["ignore", "inherit", "inherit"], detached: true, shell: false });
      let spawnError = null;
      child.on("error", err => { spawnError = err; childExited = true; });
      child.on("exit", () => { childExited = true; if (operational) void stop(); });
      let ready = false;
      for (let i = 0; i < 120 && !closed; i++) {
        if (spawnError || childExited) throw new Error("DSH exited during startup; check the local log");
        if (await healthy()) { ready = true; break; }
        await delay(700);
      }
      if (!ready) throw new Error("DSH startup timed out");
    }
    if (closed) return;
    if (config.remoteConfig) {
      const loaded = loadConfig(config.remoteConfig);
      if (!loaded.config.relay) throw new Error("Remote pairing has not been configured");
      if (loaded.config.network?.httpsProxy) {
        process.env.HTTPS_PROXY = loaded.config.network.httpsProxy;
        process.env.HTTP_PROXY = loaded.config.network.httpsProxy;
        process.env.NO_PROXY = "localhost,127.0.0.1,::1";
        http.setGlobalProxyFromEnv();
      }
      loaded.config.dshUrl = config.dsh.url;
      bridge = new RemoteBridge({ config: loaded.config, statePath: join(dirname(config.remoteConfig), "state.json"), usageReader: reader });
      await bridge.start();
    }
    if (closed) return;
    if (existsSync(paths.socket)) unlinkSync(paths.socket);
    await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(paths.socket, resolveListen); });
    chmodSync(paths.socket, 0o600);
    operational = true;
    console.log("DSH Suite ready (private local control socket)");
    await finished;
  } catch (err) { await stop(); throw err; }
  finally { if (!closed) await stop(); }
}
