import { authorize } from "./auth.js";
import { corsOrigin, json, options } from "./http.js";

const CHANNEL_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CURSOR_RE = /^(?:0-0|[1-9][0-9]*-[0-9]+)$/;
const DIRECTIONS = new Set(["to-pc", "to-phone"]);
const MAX_BODY_BYTES = 96 * 1024;
const MAX_WIRE_CHARS = 80 * 1024;

function rejectOrigin(request, env) {
  const origin = corsOrigin(request, env);
  return origin === false ? { response: json({ ok: false, error: "origin-not-allowed" }, 403), origin } : { origin };
}

function validateRoute(channel, direction) {
  return CHANNEL_RE.test(channel ?? "") && DIRECTIONS.has(direction);
}

export function createPushHandler({ store, env = process.env }) {
  return async function push(request) {
    const cors = rejectOrigin(request, env);
    if (cors.response) return cors.response;
    if (request.method === "OPTIONS") return options(cors.origin);
    if (request.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405, cors.origin);
    const announced = Number(request.headers.get("content-length") ?? 0);
    if (announced > MAX_BODY_BYTES) return json({ ok: false, error: "payload-too-large" }, 413, cors.origin);

    let body;
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new RangeError("large");
      body = JSON.parse(raw);
    } catch (err) {
      const status = err instanceof RangeError ? 413 : 400;
      return json({ ok: false, error: status === 413 ? "payload-too-large" : "invalid-json" }, status, cors.origin);
    }
    if (!validateRoute(body?.channel, body?.direction) || !ID_RE.test(body?.id ?? "")) {
      return json({ ok: false, error: "invalid-message-metadata" }, 400, cors.origin);
    }
    if (typeof body.wire !== "string" || body.wire.length > MAX_WIRE_CHARS || !body.wire.startsWith(`v2.${body.id}.`)) {
      return json({ ok: false, error: "invalid-wire" }, 400, cors.origin);
    }
    const auth = authorize(request, env, body.channel);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors.origin);
    try {
      const cursor = await store.push(body.channel, body.direction, { id: body.id, wire: body.wire });
      return json({ ok: true, cursor }, 201, cors.origin);
    } catch (err) {
      console.error("relay push failed", err);
      return json({ ok: false, error: "storage-unavailable" }, 503, cors.origin);
    }
  };
}

export function createPullHandler({ store, env = process.env }) {
  return async function pull(request) {
    const cors = rejectOrigin(request, env);
    if (cors.response) return cors.response;
    if (request.method === "OPTIONS") return options(cors.origin);
    if (request.method !== "GET") return json({ ok: false, error: "method-not-allowed" }, 405, cors.origin);
    const url = new URL(request.url);
    const channel = url.searchParams.get("channel") ?? "";
    const direction = url.searchParams.get("direction") ?? "";
    const after = url.searchParams.get("after") ?? "0-0";
    const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    if (!validateRoute(channel, direction) || !CURSOR_RE.test(after)) {
      return json({ ok: false, error: "invalid-query" }, 400, cors.origin);
    }
    const auth = authorize(request, env, channel);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors.origin);
    try {
      const messages = await store.pull(channel, direction, after, limit);
      return json({ ok: true, messages, hasMore: messages.length === limit }, 200, cors.origin);
    } catch (err) {
      console.error("relay pull failed", err);
      return json({ ok: false, error: "storage-unavailable" }, 503, cors.origin);
    }
  };
}

export function createHealthHandler({ store, env = process.env }) {
  return async function health(request) {
    const cors = rejectOrigin(request, env);
    if (cors.response) return cors.response;
    if (request.method === "OPTIONS") return options(cors.origin);
    if (request.method !== "GET") return json({ ok: false, error: "method-not-allowed" }, 405, cors.origin);
    try {
      const storage = await store.ping();
      return json({ ok: true, protocol: 2, storage: storage === "PONG" ? "up" : "unknown" }, 200, cors.origin);
    } catch {
      return json({ ok: false, protocol: 2, storage: "down" }, 503, cors.origin);
    }
  };
}
