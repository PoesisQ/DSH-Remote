import { Redis } from "@upstash/redis";
import { streamKey } from "./namespace.js";

let client;

function redis() {
  if (!client) {
    const url = process.env.UPSTASH_REDIS_REST_URL
      ?? process.env.UPSTASH_REDIS_REST_KV_REST_API_URL
      ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
      ?? process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN
      ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error("missing Upstash Redis environment variables");
    client = new Redis({ url, token, enableTelemetry: false });
  }
  return client;
}

function key(channel, direction) {
  return streamKey(channel, direction, process.env.DSH_RELAY_NAMESPACE ?? "");
}

export const redisStore = {
  async push(channel, direction, message) {
    return redis().xadd(key(channel, direction), "*", message, {
      trim: { type: "MAXLEN", comparison: "~", threshold: 2000 },
    });
  },

  async pull(channel, direction, after, limit) {
    const start = after === "0-0" ? "-" : `(${after}`;
    const entries = await redis().xrange(key(channel, direction), start, "+", limit);
    return Object.entries(entries ?? {}).map(([cursor, fields]) => ({
      cursor,
      id: String(fields.id ?? ""),
      wire: String(fields.wire ?? ""),
    }));
  },

  async ping() {
    return redis().ping();
  },
};
