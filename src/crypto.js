// dsh-remote v2 加密协议：配对码 + 方向隔离的 AES-256-GCM 信封。
// Vercel/Redis 只接触 wire 密文和随机 message id，永远不持有端到端密钥。
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const PAIRING_PREFIX = "DR2.";
export const WIRE_PREFIX = "v2";
export const DIRECTIONS = Object.freeze(["to-pc", "to-phone"]);
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const HKDF_SALT_PREFIX = "dsh-remote:";
const HKDF_INFO_PREFIX = "dsh-remote/v2:";
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function randomBase64Url(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function decode32(value, label) {
  if (typeof value !== "string" || !B64URL_RE.test(value)) throw new Error(`${label}格式错误`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32) throw new Error(`${label}长度错误`);
  return decoded;
}

function requireDirection(direction) {
  if (!DIRECTIONS.includes(direction)) throw new Error(`消息方向错误: ${direction}`);
  return direction;
}

function normalizeRelayUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("中继 URL 无效");
  }
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("中继 URL 必须使用 HTTPS（本机测试除外）");
  if (url.username || url.password || url.search || url.hash) throw new Error("中继 URL 不能包含账号、查询参数或片段");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function randomPairingKey() {
  return randomBase64Url(32);
}

export function randomAuthToken() {
  return randomBase64Url(32);
}

export function randomChannelId() {
  return randomBase64Url(16);
}

export function randomMessageId() {
  return randomBase64Url(16);
}

export function makeRelayCredentials(url) {
  return {
    url: normalizeRelayUrl(url),
    channel: randomChannelId(),
    authToken: randomAuthToken(),
    key: randomPairingKey(),
  };
}

/** DR2.<base64url(JSON{u,c,a,k})>。 */
export function makePairingCode({ url, channel, authToken, key }) {
  const relay = validatePairing({ url, channel, authToken, key });
  const payload = JSON.stringify({ u: relay.url, c: relay.channel, a: relay.authToken, k: relay.key });
  return PAIRING_PREFIX + Buffer.from(payload, "utf8").toString("base64url");
}

export function parsePairingCode(code) {
  if (typeof code !== "string" || !code.startsWith(PAIRING_PREFIX)) {
    if (typeof code === "string" && code.startsWith("DR1.")) {
      throw new Error("这是旧版 MQTT 配对码，请在电脑端生成 DR2 配对码");
    }
    throw new Error("配对码格式错误：应以 DR2. 开头");
  }
  let value;
  try {
    value = JSON.parse(Buffer.from(code.slice(PAIRING_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("配对码解码失败");
  }
  return validatePairing({ url: value?.u, channel: value?.c, authToken: value?.a, key: value?.k });
}

export function validatePairing(pairing) {
  const url = normalizeRelayUrl(pairing?.url);
  if (typeof pairing?.channel !== "string" || !B64URL_RE.test(pairing.channel) || pairing.channel.length < 16 || pairing.channel.length > 64) {
    throw new Error("信道 ID 格式错误");
  }
  decode32(pairing.authToken, "中继鉴权令牌");
  decode32(pairing.key, "端到端密钥");
  return { url, channel: pairing.channel, authToken: pairing.authToken, key: pairing.key };
}

/** 服务端只需保存这个哈希，无需保存中继令牌原文。 */
export function hashAuthToken(token) {
  decode32(token, "中继鉴权令牌");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenMatchesHash(token, expectedHex) {
  if (typeof expectedHex !== "string" || !/^[a-fA-F0-9]{64}$/.test(expectedHex)) return false;
  let actual;
  try {
    actual = Buffer.from(hashAuthToken(token), "hex");
  } catch {
    return false;
  }
  return timingSafeEqual(actual, Buffer.from(expectedHex, "hex"));
}

/** 电脑→手机和手机→电脑使用不同 AES 子密钥。 */
export function deriveEncKey(pairing, direction) {
  requireDirection(direction);
  const master = decode32(pairing.key, "端到端密钥");
  const salt = Buffer.from(HKDF_SALT_PREFIX + pairing.channel, "utf8");
  const info = Buffer.from(HKDF_INFO_PREFIX + direction, "utf8");
  return hkdfSync("sha256", master, salt, info, 32);
}

export function makeEnvelope(kind, data, ref, id = randomMessageId()) {
  if (typeof kind !== "string" || kind.length === 0) throw new Error("消息 kind 不能为空");
  if (typeof id !== "string" || !B64URL_RE.test(id)) throw new Error("消息 ID 格式错误");
  const env = { v: 2, id, k: kind, ts: Date.now(), d: data };
  if (ref !== undefined && ref !== null) env.r = ref;
  return env;
}

function makeAad(pairing, direction, id) {
  return Buffer.from(`dsh-remote/v2|${pairing.channel}|${direction}|${id}`, "utf8");
}

/** wire = v2.<messageId>.<iv>.<ciphertext+tag>。 */
export function sealEnvelope(pairing, env, direction) {
  requireDirection(direction);
  if (env?.v !== 2 || typeof env.id !== "string" || !B64URL_RE.test(env.id)) {
    throw new Error("信封格式错误");
  }
  const key = deriveEncKey(pairing, direction);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(makeAad(pairing, direction, env.id));
  const plaintext = Buffer.from(JSON.stringify(env), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return `${WIRE_PREFIX}.${env.id}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/** 解密、认证、校验方向/ID/时间并做进程内去重；失败返回 null。 */
export function openEnvelope(pairing, wire, direction, seen, { maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  requireDirection(direction);
  if (typeof wire !== "string") return null;
  const parts = wire.split(".");
  if (parts.length !== 4 || parts[0] !== WIRE_PREFIX || !B64URL_RE.test(parts[1])) return null;
  try {
    const [, id, ivRaw, blobRaw] = parts;
    const iv = Buffer.from(ivRaw, "base64url");
    const blob = Buffer.from(blobRaw, "base64url");
    if (iv.length !== 12 || blob.length < 17 || iv.toString("base64url") !== ivRaw || blob.toString("base64url") !== blobRaw) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveEncKey(pairing, direction), iv);
    decipher.setAAD(makeAad(pairing, direction, id));
    decipher.setAuthTag(blob.subarray(blob.length - 16));
    const plaintext = Buffer.concat([decipher.update(blob.subarray(0, -16)), decipher.final()]);
    const env = JSON.parse(plaintext.toString("utf8"));
    if (env?.v !== 2 || env.id !== id || typeof env.k !== "string" || !Number.isFinite(env.ts)) return null;
    const age = Date.now() - env.ts;
    if (age > maxAgeMs || age < -FUTURE_SKEW_MS) return null;
    if (seen?.has(id)) return null;
    seen?.add(id);
    return env;
  } catch {
    return null;
  }
}

export class SeenCache {
  constructor(max = 4096) {
    this.max = max;
    this.list = [];
    this.index = new Set();
  }
  has(id) {
    return this.index.has(id);
  }
  add(id) {
    if (this.index.has(id)) return;
    this.list.push(id);
    this.index.add(id);
    if (this.list.length > this.max) {
      const dropped = this.list.splice(0, Math.floor(this.max / 2));
      for (const value of dropped) this.index.delete(value);
    }
  }
}
