import { createHash, timingSafeEqual } from "node:crypto";

const HEX_32 = /^[a-fA-F0-9]{64}$/;

export function authorize(request, env, channel) {
  const expectedChannel = env.DSH_RELAY_CHANNEL;
  const expectedHash = env.DSH_RELAY_AUTH_SHA256;
  if (!expectedChannel || !HEX_32.test(expectedHash ?? "")) {
    return { ok: false, status: 503, error: "relay-not-configured" };
  }
  if (channel !== expectedChannel) return { ok: false, status: 403, error: "forbidden" };
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const actual = createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(expectedHash, "hex");
  if (!timingSafeEqual(actual, expected)) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}
