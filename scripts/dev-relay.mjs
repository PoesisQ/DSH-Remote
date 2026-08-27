#!/usr/bin/env node
// 无 Redis 的本地中继，供 PWA/模拟器联调；进程退出后消息清空。
import { createServer } from "node:http";
import { createHealthHandler, createPullHandler, createPushHandler } from "../vercel/lib/handlers.js";
import { MemoryStreamStore } from "../vercel/lib/memory-store.js";

const port = Number(process.env.PORT ?? 8787);
const env = {
  DSH_RELAY_CHANNEL: process.env.DSH_RELAY_CHANNEL,
  DSH_RELAY_AUTH_SHA256: process.env.DSH_RELAY_AUTH_SHA256,
  DSH_ALLOWED_ORIGINS: process.env.DSH_ALLOWED_ORIGINS ?? "http://localhost:8787,http://127.0.0.1:8787",
};
if (!env.DSH_RELAY_CHANNEL || !env.DSH_RELAY_AUTH_SHA256) {
  console.error("请先设置 DSH_RELAY_CHANNEL 与 DSH_RELAY_AUTH_SHA256（可由 --show-vercel-env 获取）");
  process.exit(2);
}

const store = new MemoryStreamStore();
const routes = new Map([
  ["/api/push", createPushHandler({ store, env })],
  ["/api/pull", createPullHandler({ store, env })],
  ["/api/health", createHealthHandler({ store, env })],
]);

createServer(async (incoming, outgoing) => {
  try {
    const body = [];
    for await (const chunk of incoming) body.push(chunk);
    const url = `http://${incoming.headers.host}${incoming.url}`;
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body: ["GET", "HEAD"].includes(incoming.method) ? undefined : Buffer.concat(body),
      duplex: "half",
    });
    const handler = routes.get(new URL(url).pathname);
    const response = handler ? await handler(request) : new Response("not found", { status: 404 });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "text/plain" });
    outgoing.end(error.stack ?? error.message);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`本地 DR2 中继: http://127.0.0.1:${port}`);
});
