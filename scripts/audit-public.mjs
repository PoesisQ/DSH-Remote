import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const privateValues = [];
if (existsSync("config.json")) {
  const config = JSON.parse(readFileSync("config.json", "utf8"));
  for (const value of Object.values(config.relay ?? {})) if (typeof value === "string" && value.length >= 12) privateValues.push(value);
}
const findings = new Set();
function inspect(name, text, scope) {
  const reason = privateValues.some(value => text.includes(value)) ? "local deployment data"
    : /DR2\.[A-Za-z0-9_-]{24,}/.test(text) ? "embedded pairing payload"
    : /\/home\/[a-zA-Z0-9_-]+\//.test(text) ? "machine-specific home path"
    : /[A-Z]:[\\/]Users[\\/][a-zA-Z0-9_-]+[\\/]/.test(text) ? "machine-specific Windows path"
    : /(?:^|\/)(?:desktop\.settings\.json|\.credentials\.yaml|\.env(?:\..+)?|\.runtime\.env|.*\.(?:exe|dll|zip|apk))$/.test(name) && !name.endsWith(".example") ? "private config or binary artifact"
    : /(?:^|\/)(?:config\.json|state\.json|\.runtime\.env|.*\.(?:jks|keystore|pem)|.*配对二维码.*)$/.test(name) ? "private file"
    : null;
  if (reason) findings.add(`${scope}: ${name} (${reason})`);
}
const files = [...new Set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean))];
for (const file of files) if (existsSync(file)) inspect(file, readFileSync(file).toString("utf8"), "working-tree");
if (process.argv.includes("--history")) {
  const revisions = git("rev-list", "--all").trim().split("\n").filter(Boolean);
  for (const revision of revisions) {
    for (const file of git("ls-tree", "-r", "--name-only", "-z", revision).split("\0").filter(Boolean)) {
      inspect(file, git("show", `${revision}:${file}`), "history");
    }
  }
  console.log(`Inspected ${revisions.length} reachable revisions (values redacted).`);
}
for (const finding of findings) console.log(finding);
console.log(`${files.length} public candidate files; ${findings.size} findings. This is not a complete secret scan.`);
process.exitCode = findings.size ? 1 : 0;
