// Isolated UI preview: random in-memory credentials, no real DSH or cloud access.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { makeRelayCredentials, makePairingCode, hashAuthToken, makeEnvelope, sealEnvelope, openEnvelope } from "../src/crypto.js";
import { MemoryStreamStore } from "../vercel/lib/memory-store.js";
import { createPushHandler, createPullHandler } from "../vercel/lib/handlers.js";
const port = Number(process.env.PORT || 8788), origin = `http://127.0.0.1:${port}`;
const pairing = makeRelayCredentials(origin), store = new MemoryStreamStore();
const env = { DSH_RELAY_CHANNEL: pairing.channel, DSH_RELAY_AUTH_SHA256: hashAuthToken(pairing.authToken), DSH_ALLOWED_ORIGINS: origin };
const push = createPushHandler({ store, env }), pull = createPullHandler({ store, env });
let peer = "ready", count = 0;
const mail = async (kind, data, ref) => {
  const message = makeEnvelope(kind, data, ref);
  await store.push(pairing.channel, "to-phone", { id: message.id, wire: sealEnvelope(pairing, message, "to-phone") });
};
const snapshot = () => ({ host: { version: "preview", cwd: "本地隔离预览 · 不连接真实电脑" }, sessions: [
  { short: "c731a200", title: "跨浏览器统一新标签页设计：一段很长的标题用于检验省略与换行", current: true },
  { short: "b172d921", title: "Vercel 多应用互联与配置隔离", running: true },
  ...Array.from({ length: count }, (_, i) => ({ short: `new0000${i}`, title: "新建对话 " + (i + 1) })),
] });
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      const files = { "/": "index.template.html", "/icon.svg": "icon.svg", "/markdown.js": "markdown.js", "/connection.js": "connection.js", "/usage.js": "usage.js", "/manifest.webmanifest": "manifest.webmanifest" };
      const name = files[url.pathname]; if (!name) { res.writeHead(404); res.end(); return; }
      let text = readFileSync(new URL(`../phone/${name}`, import.meta.url), "utf8");
      if (name.endsWith("html")) text = text.replace('<script src="./markdown.js">', `<script>document.getElementById("pair-code").value=${JSON.stringify(makePairingCode(pairing))};</script><script src="./markdown.js">`);
      res.writeHead(200, { "content-type": name.endsWith("html") ? "text/html; charset=utf-8" : name.endsWith("svg") ? "image/svg+xml" : name.endsWith("js") ? "text/javascript" : "application/json", "cache-control": "no-store" }); res.end(text); return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (url.pathname === "/api/demo-state" && req.method === "POST") {
      const value = JSON.parse(body).peer; if (!["ready", "unavailable", "offline"].includes(value)) throw new Error("invalid peer");
      peer = value; res.writeHead(200); res.end("ok"); return;
    }
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body });
    const result = url.pathname === "/api/pull" ? await pull(request) : await push(request);
    if (result.status === 201 && peer !== "offline") {
      const incoming = openEnvelope(pairing, JSON.parse(body).wire, "to-pc");
      if (incoming?.k === "presence") await mail("presence", { protocol: 1, dsh: peer }, incoming.id);
      if (incoming?.k === "usage") await mail("usage", { protocol: 1, status: peer === "ready" ? "ok" : "unavailable", snapshot: { sampledAt: Date.now(), nowPeriod: "peak", balance: 53.35, currency: "CNY", costCurrency: "CNY", totalCost: 1.2467, totalTokens: 126000, peak: { cost: 1.1 }, offpeak: { cost: .1467 }, model: "deepseek-v4-pro", pricingDate: "2026-08-17", schedule: { timezone: "Asia/Shanghai", utcOffsetMinutes: 480, offStartMinute: 30, offEndMinute: 510 } } }, incoming.id);
      if (incoming?.k === "hello") {
        await mail("hello", snapshot());
        await mail("chat", { role: "assistant", text: "## 项目进度\n\n已完成 **连接状态修复** 与配置隔离。\n\n- 新建对话收进列表\n- 图标使用统一圆角轮廓\n\n> 本地预览不访问真实中继。\n\n```js\nconst connected = relay && computer && dsh;\n```" });
      }
      if (incoming?.k === "msg" && incoming.d.text === "/new") { count++; await mail("hello", snapshot()); }
    }
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer()));
  } catch { res.writeHead(500); res.end("preview error"); }
}).listen(port, "127.0.0.1", () => console.log(`Isolated UI preview: ${origin} (pairing field prefilled with disposable test data)`));
