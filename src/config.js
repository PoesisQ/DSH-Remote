import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { makeRelayCredentials, validatePairing } from "./crypto.js";

export const DEFAULT_CONFIG_PATH = process.env.DSH_REMOTE_CONFIG
  ?? join(homedir(), ".config", "dsh-remote", "config.json");

export const DEFAULTS = Object.freeze({
  dshUrl: "http://127.0.0.1:3080",
  relayUrl: process.env.DSH_REMOTE_RELAY_URL,
  httpsProxy: process.env.DSH_REMOTE_HTTPS_PROXY ?? null,
  idlePollMs: 15_000,
  activePollMs: 1_500,
});

function boundedInterval(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function makeDefaultConfig(relayUrl = DEFAULTS.relayUrl) {
  if (!relayUrl) throw new Error("首次初始化需要 --relay-url <你的中继 HTTPS 地址> 或 DSH_REMOTE_RELAY_URL；不会连接任何默认公共服务");
  return {
    version: 2,
    dshUrl: DEFAULTS.dshUrl,
    network: { httpsProxy: DEFAULTS.httpsProxy },
    relay: {
      ...makeRelayCredentials(relayUrl),
      idlePollMs: DEFAULTS.idlePollMs,
      activePollMs: DEFAULTS.activePollMs,
    },
    push: { otherSessions: false },
  };
}

export function loadConfig(path) {
  let raw = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new Error(`配置文件解析失败 ${path}: ${err.message}`);
    }
  }
  let relay = null;
  if (raw.relay) {
    relay = {
      url: raw.relay.url,
      channel: raw.relay.channel,
      authToken: raw.relay.authToken,
      key: raw.relay.key,
      idlePollMs: boundedInterval(raw.relay.idlePollMs, DEFAULTS.idlePollMs, 1_000, 300_000),
      activePollMs: boundedInterval(raw.relay.activePollMs, DEFAULTS.activePollMs, 500, 60_000),
    };
    validatePairing(relay);
  }
  return {
    config: {
      version: 2,
      dshUrl: process.env.DSH_REMOTE_DSH_URL ?? raw.dshUrl ?? DEFAULTS.dshUrl,
      network: {
        httpsProxy: process.env.DSH_REMOTE_HTTPS_PROXY ?? raw.network?.httpsProxy ?? DEFAULTS.httpsProxy,
      },
      relay,
      usage: { script: process.env.DSH_REMOTE_USAGE_SCRIPT ?? raw.usage?.script ?? null },
      push: { otherSessions: raw.push?.otherSessions === true },
    },
    path,
    needsRelay: relay === null,
    legacyMqtt: raw.mqtt ?? null,
  };
}

export function saveConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function ensureConfig(path, { quiet = false, relayUrl = DEFAULTS.relayUrl } = {}) {
  const created = !existsSync(path);
  const loaded = loadConfig(path);
  let config = loaded.config;
  let migrated = false;
  if (created || loaded.needsRelay) {
    const fresh = makeDefaultConfig(relayUrl);
    config = {
      ...fresh,
      dshUrl: config.dshUrl,
      network: config.network,
      push: config.push,
      usage: config.usage,
    };
    saveConfig(path, config);
    migrated = !created && loaded.legacyMqtt !== null;
  }
  if (!quiet) {
    if (created) console.log(`已生成 DR2 配置: ${path}`);
    else if (migrated) console.log(`已将旧 MQTT 配置迁移为 DR2 Vercel 配置: ${path}`);
  }
  return {
    config,
    path,
    created,
    migrated,
    statePath: join(dirname(path), "state.json"),
  };
}
