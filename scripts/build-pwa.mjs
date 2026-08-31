// 以 phone/ 为唯一源码，同步浏览器、Vercel 静态站和 Android WebView 三个入口。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tplPath = join(root, "phone", "index.template.html");
const tpl = readFileSync(tplPath, "utf8");
const targets = [
  join(root, "phone", "index.html"),
  join(root, "vercel", "index.html"),
  join(root, "android", "app", "src", "main", "assets", "index.html"),
];
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, tpl);
}
for (const asset of ["manifest.webmanifest", "sw.js", "icon.svg", "markdown.js", "connection.js", "usage.js", "viewport.js"]) {
  copyFileSync(join(root, "phone", asset), join(root, "vercel", asset));
  copyFileSync(join(root, "phone", asset), join(root, "android", "app", "src", "main", "assets", asset));
}
console.log(`PWA 已同步到 phone / vercel / android（三端同源，${(tpl.length / 1024).toFixed(0)} KB）`);
