import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
for (const dir of ["bin", "src", "phone", "scripts", "vercel/api", "vercel/lib", "test", "test/fixtures", "desktop/windows"]) {
  for (const name of readdirSync(dir).filter(name => /\.m?js$/.test(name))) {
    const result = spawnSync(process.execPath, ["--check", `${dir}/${name}`], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log("All JavaScript sources parse.");
