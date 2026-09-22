const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CHANNEL_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /^[a-fA-F0-9]{64}$/;
const MAX_REGISTRY_BYTES = 48 * 1024;
const MAX_APPS = 32;
const MAX_ORIGINS = 16;
const RESERVED_APP_IDS = new Set(["default", "dsh", "legacy", "root"]);
const PROFILE_KEYS = new Set(["channel", "authSha256", "allowedOrigins", "disabled"]);

let cachedRaw;
let cachedRegistry;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length > 512) throw new Error("invalid-app-origin");
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid-app-origin"); }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("invalid-app-origin");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("invalid-app-origin");
  }
  return url.origin;
}

export function parseRelayApps(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return new Map();
  if (Buffer.byteLength(raw, "utf8") > MAX_REGISTRY_BYTES) throw new Error("app-registry-too-large");
  if (raw === cachedRaw && cachedRegistry) return new Map(cachedRegistry);

  let source;
  try { source = JSON.parse(raw); } catch { throw new Error("invalid-app-registry-json"); }
  if (!plainObject(source)) throw new Error("invalid-app-registry");
  const entries = Object.entries(source);
  if (entries.length > MAX_APPS) throw new Error("too-many-relay-apps");

  const registry = new Map();
  for (const [id, profile] of entries) {
    if (!APP_ID_RE.test(id) || RESERVED_APP_IDS.has(id) || !plainObject(profile)) throw new Error("invalid-relay-app");
    if (Object.keys(profile).some((key) => !PROFILE_KEYS.has(key))) throw new Error("unknown-relay-app-field");
    if (!CHANNEL_RE.test(profile.channel ?? "") || !HASH_RE.test(profile.authSha256 ?? "")) throw new Error("invalid-relay-app-credentials");
    if (profile.disabled !== undefined && typeof profile.disabled !== "boolean") throw new Error("invalid-relay-app-disabled");
    const rawOrigins = profile.allowedOrigins ?? [];
    if (!Array.isArray(rawOrigins) || rawOrigins.length > MAX_ORIGINS) throw new Error("invalid-relay-app-origins");
    const allowedOrigins = [...new Set(rawOrigins.map(normalizeOrigin))];
    registry.set(id, Object.freeze({
      id,
      channel: profile.channel,
      authSha256: profile.authSha256.toLowerCase(),
      allowedOrigins: Object.freeze(allowedOrigins),
      disabled: profile.disabled === true,
      namespace: `svc-${id}`,
    }));
  }
  cachedRaw = raw;
  cachedRegistry = registry;
  return new Map(registry);
}

export function resolveRelayApp(appId, env = process.env) {
  if (!APP_ID_RE.test(appId ?? "") || RESERVED_APP_IDS.has(appId)) return { ok: false, status: 404, error: "app-not-found" };
  let registry;
  try { registry = parseRelayApps(env.DSH_RELAY_APPS_JSON); }
  catch { return { ok: false, status: 503, error: "app-registry-unavailable" }; }
  const profile = registry.get(appId);
  if (!profile || profile.disabled) return { ok: false, status: 404, error: "app-not-found" };
  return {
    ok: true,
    profile,
    handlerEnv: {
      DSH_RELAY_CHANNEL: profile.channel,
      DSH_RELAY_AUTH_SHA256: profile.authSha256,
      DSH_ALLOWED_ORIGINS: profile.allowedOrigins.join(","),
    },
  };
}

export const relayAppLimits = Object.freeze({ MAX_APPS, MAX_ORIGINS, MAX_REGISTRY_BYTES });
