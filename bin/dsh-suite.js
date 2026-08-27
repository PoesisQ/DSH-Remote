#!/usr/bin/env node
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { suiteConfigPath, initializeSuite, loadSuiteConfig } from "../src/suite-config.js";
import { callSuite, runSuite, stopSuite } from "../src/suite-runtime.js";
import { UsageReader } from "../src/usage.js";
import { loadConfig } from "../src/config.js";
import { makePairingCode } from "../src/crypto.js";

async function main() {
  const [action = "help", ...args] = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--config", "--workspace", "--dsh-command", "--remote-config"].includes(args[i]) || !args[i + 1]) throw new Error("Invalid command arguments");
    options[args[i].slice(2)] = args[i + 1];
  }
  const path = resolve(options.config || suiteConfigPath());
  if (action === "init") {
    initializeSuite(path, { cwd: options.workspace, command: options["dsh-command"], remoteConfig: options["remote-config"] ? resolve(options["remote-config"]) : null, usageScript: fileURLToPath(new URL("../desktop/linux/dsh-status.sh", import.meta.url)) });
    console.log("Suite profile created. No existing config or pairing was changed."); return;
  }
  if (action === "help") { console.log("dsh-suite init|run|stop|status|usage|pairing|doctor [--config PATH]\ninit: [--workspace PATH] [--dsh-command EXECUTABLE] [--remote-config PATH]\nRemote is optional. Pairing explicitly prints a private DR2 capability: never share it."); return; }
  const config = loadSuiteConfig(path);
  if (action === "run") return runSuite(config, path);
  if (action === "stop") { console.log(JSON.stringify({ stopped: await stopSuite(path) })); return; }
  if (action === "status") { console.log(JSON.stringify(await callSuite(path))); return; }
  if (action === "doctor") {
    console.log(JSON.stringify({ nodeSupported: Number(process.versions.node.split(".")[0]) >= 24, linux: process.platform === "linux", workspaceExists: existsSync(config.dsh.cwd), usageScriptExists: !!config.usageScript && existsSync(config.usageScript), remoteConfigured: !!config.remoteConfig && existsSync(config.remoteConfig) })); return;
  }
  if (action === "usage") {
    let data;
    try { data = await callSuite(path, "/usage"); } catch { data = await new UsageReader(config.usageScript).read(); }
    console.log(JSON.stringify(data.status === "ok" ? data.snapshot : { error: data.status })); return;
  }
  if (action === "pairing") {
    if (!config.remoteConfig) throw new Error("Remote control is disabled in this profile");
    const { config: remote } = loadConfig(config.remoteConfig);
    if (!remote.relay) throw new Error("Pairing is not initialized");
    console.log(makePairingCode(remote.relay)); return;
  }
  throw new Error("Unknown suite command");
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
