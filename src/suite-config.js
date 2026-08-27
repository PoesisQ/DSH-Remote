import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const suiteConfigPath = () => process.env.DSH_SUITE_CONFIG || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "dsh-suite", "config.json");
export function validateSuiteConfig(raw) {
  if (raw?.version !== 1 || !raw.dsh) throw new Error("Unsupported suite configuration");
  const u = new URL(raw.dsh.url);
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error("DSH must use a loopback HTTP origin");
  if (typeof raw.dsh.command !== "string" || !raw.dsh.command.trim() || /[\r\n\0]/.test(raw.dsh.command)) throw new Error("Invalid DSH executable");
  if (!Array.isArray(raw.dsh.args) || raw.dsh.args.length > 32 || raw.dsh.args.some(x => typeof x !== "string" || x.includes("\0"))) throw new Error("Invalid DSH arguments");
  if (!isAbsolute(raw.dsh.cwd || "")) throw new Error("DSH workspace must be an absolute path");
  for (const name of ["remoteConfig", "usageScript"]) if (raw[name] != null && (typeof raw[name] !== "string" || !isAbsolute(raw[name]))) throw new Error(`${name} must be null or an absolute path`);
  return { version: 1, dsh: { url: u.origin, command: raw.dsh.command, args: raw.dsh.args, cwd: raw.dsh.cwd }, remoteConfig: raw.remoteConfig || null, usageScript: raw.usageScript || null };
}
export function loadSuiteConfig(path = suiteConfigPath()) { return validateSuiteConfig(JSON.parse(readFileSync(path, "utf8"))); }
export function initializeSuite(path, { cwd = homedir(), command = "dsh", remoteConfig = null, usageScript = null } = {}) {
  path = resolve(path);
  if (existsSync(path)) throw new Error("Configuration already exists; it was not overwritten");
  const config = validateSuiteConfig({ version: 1, dsh: { url: "http://127.0.0.1:3080", command, args: ["web", "--no-open"], cwd: resolve(cwd) }, remoteConfig, usageScript });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Exclusive creation is important: never replace an existing user's pairing/config.
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return config;
}
