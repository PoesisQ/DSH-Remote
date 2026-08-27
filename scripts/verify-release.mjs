// Verify exactly the source artifact in a disposable directory, without live configuration.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const archive = resolve(process.argv[2] || `dist/dsh-suite-v${version}-source.tar.gz`);
const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
if (files.some(file => file.startsWith("/") || file.split("/").includes("..") || /(^|\/)(\.git|node_modules|config\.json|state\.json|desktop\.settings\.json)(\/|$)/.test(file))) throw new Error("Unsafe or private release content");
const dir = mkdtempSync(join(tmpdir(), "dsh-suite-release-"));
execFileSync("tar", ["-xzf", archive, "-C", dir]);
for (const path of ["suite.manifest.json", "desktop/windows/Program.cs", "desktop/linux/dsh-status.sh", "modules/novatab/src/entrypoints/newtab/App.vue"]) {
  if (!existsSync(join(dir, path))) throw new Error("Incomplete suite artifact: " + path);
}
execFileSync(process.execPath, ["scripts/build-pwa.mjs"], { cwd: dir, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/check.mjs"], { cwd: dir, stdio: "inherit" });
const tests = files.filter(file => /^test\/[^/]+\.test\.js$/.test(file));
execFileSync(process.execPath, ["--test", ...tests], { cwd: dir, stdio: "inherit" });
console.log(`Clean source artifact verified: ${files.length} files. Isolated test directory retained: ${dir}`);
