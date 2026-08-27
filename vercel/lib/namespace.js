// Namespace is deployment-owned, never accepted from an untrusted request.
export function streamKey(channel, direction, namespace = "") {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(channel) || !["to-pc", "to-phone"].includes(direction)) throw new Error("invalid-stream-route");
  if (typeof namespace !== "string" || (namespace && !/^[A-Za-z0-9_-]{1,48}$/.test(namespace))) throw new Error("invalid-relay-namespace");
  return namespace ? `dr:v2:app:${namespace}:${channel}:${direction}` : `dr:v2:${channel}:${direction}`;
}
