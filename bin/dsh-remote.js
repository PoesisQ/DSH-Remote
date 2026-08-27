#!/usr/bin/env node
import http from "node:http";
import { readFileSync } from "node:fs";
import { hashAuthToken, makePairingCode, makeRelayCredentials, parsePairingCode } from "../src/crypto.js";
import { DEFAULT_CONFIG_PATH, ensureConfig, loadConfig, saveConfig } from "../src/config.js";
import { RemoteBridge } from "../src/bridge.js";

const APP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function usage() {
  console.log(`dsh-remote ${APP_VERSION} — DSH 手机远程互联（Vercel 加密信箱）

用法: dsh-remote [选项]

  --config <path>       配置文件（默认 ${DEFAULT_CONFIG_PATH}）
  --relay-url <url>     初始化时使用的 Vercel 地址
  --init                生成/迁移配置，打印 DR2 配对码和 Vercel 环境变量
  --show-pairing        显式打印当前 DR2 配对码
  --show-vercel-env     打印可安全粘贴到 Vercel 的 channel/token 哈希
  --pairing <code>      导入 DR2 配对码到本机配置
  --rotate-pairing      生成全新信道、令牌和端到端密钥
  --help                显示帮助

普通启动不会打印配对码，避免密钥进入后台日志。`);
}

function printPairing(config) {
  const code = makePairingCode(config.relay);
  console.log("\n手机端配对码（等同远程控制权限，请勿外传）：\n");
  console.log(code);
  console.log("");
}

function printVercelEnv(config) {
  console.log("Vercel 环境变量（不含端到端解密密钥）：");
  console.log(`DSH_RELAY_CHANNEL=${config.relay.channel}`);
  console.log(`DSH_RELAY_AUTH_SHA256=${hashAuthToken(config.relay.authToken)}`);
  console.log(`DSH_ALLOWED_ORIGINS=${new URL(config.relay.url).origin},https://appassets.androidplatform.net`);
}

function enableNetworkProxy(config) {
  const value = config.network?.httpsProxy;
  if (!value) return;
  const proxy = new URL(value);
  if (!/^https?:$/.test(proxy.protocol)) throw new Error("network.httpsProxy 只支持 http:// 或 https:// URL");
  process.env.HTTPS_PROXY ??= value;
  process.env.HTTP_PROXY ??= value;
  // Local DSH RPC and WebSocket must not be sent through the cloud proxy.
  const bypass = ["localhost", "127.0.0.1", "::1", process.env.NO_PROXY || process.env.no_proxy || ""].filter(Boolean).join(",");
  process.env.NO_PROXY = bypass;
  process.env.no_proxy = bypass;
  if (typeof http.setGlobalProxyFromEnv !== "function") {
    throw new Error("当前 Node.js 不支持内置代理，请升级到 Node.js 22.21+ 或 24.5+");
  }
  http.setGlobalProxyFromEnv();
  const port = proxy.port ? `:${proxy.port}` : "";
  console.log(`已启用中继代理: ${proxy.protocol}//${proxy.hostname}${port}`);
}

function parseArgs(argv) {
  const result = { configPath: DEFAULT_CONFIG_PATH, relayUrl: undefined, action: "run", pairingCode: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--config") result.configPath = argv[++i];
    else if (value === "--relay-url") {
      result.relayUrl = argv[++i];
      if (!result.relayUrl || result.relayUrl.startsWith("--")) throw new Error("--relay-url 缺少地址");
    }
    else if (value === "--init") result.action = "init";
    else if (value === "--show-pairing") result.action = "show-pairing";
    else if (value === "--show-vercel-env") result.action = "show-vercel-env";
    else if (value === "--rotate-pairing") result.action = "rotate-pairing";
    else if (value === "--pairing") {
      result.action = "pairing";
      result.pairingCode = argv[++i];
    } else if (value === "--help" || value === "-h") result.action = "help";
    else throw new Error(`未知参数: ${value}`);
  }
  if (!result.configPath) throw new Error("--config 缺少路径");
  if (result.action === "pairing" && !result.pairingCode) throw new Error("--pairing 缺少配对码");
  return result;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    usage();
    process.exit(2);
  }
  if (args.action === "help") return usage();

  if (args.action === "pairing") {
    const relay = parsePairingCode(args.pairingCode);
    const loaded = loadConfig(args.configPath);
    const config = { ...loaded.config, relay };
    saveConfig(args.configPath, config);
    console.log(`已导入 DR2 配对配置 → ${args.configPath}`);
    return;
  }

  const ensured = ensureConfig(args.configPath, { relayUrl: args.relayUrl });
  const { config } = ensured;

  if (args.action === "rotate-pairing") {
    config.relay = {
      ...makeRelayCredentials(args.relayUrl ?? config.relay.url),
      idlePollMs: config.relay.idlePollMs,
      activePollMs: config.relay.activePollMs,
    };
    saveConfig(args.configPath, config);
    console.log("已轮换信道、鉴权令牌和端到端密钥。旧手机将立即失效。");
    printPairing(config);
    printVercelEnv(config);
    return;
  }
  if (args.action === "init") {
    printPairing(config);
    printVercelEnv(config);
    return;
  }
  if (args.action === "show-pairing") return printPairing(config);
  if (args.action === "show-vercel-env") return printVercelEnv(config);

  enableNetworkProxy(config);
  console.log(`DSH 地址: ${config.dshUrl}`);
  console.log(`Vercel 中继: ${config.relay.url}`);
  console.log("按 Ctrl+C 停止；配对码仅在 --show-pairing 时显示。");
  const bridge = new RemoteBridge({ config, statePath: ensured.statePath });
  const shutdown = () => {
    bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await bridge.start();
}

main().catch((err) => {
  console.error(`dsh-remote 启动失败: ${err?.stack ?? err}`);
  process.exit(1);
});
