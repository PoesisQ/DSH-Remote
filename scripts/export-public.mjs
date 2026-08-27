// Export the audited working tree without Git history, local credentials or build output.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
execFileSync(process.execPath, ["scripts/audit-public.mjs"], { stdio: "inherit" });
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(file => file && existsSync(file)))];
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
mkdirSync("dist", { recursive: true });
const target = resolve(`dist/dsh-suite-v${version}-source.tar.gz`);
execFileSync("tar", ["-czf", target, "--null", "-T", "-"], { input: Buffer.from(files.join("\0") + "\0") });
console.log(`Exported ${files.length} files without Git history: ${target}`);
