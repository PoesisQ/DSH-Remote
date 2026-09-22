import { resolveRelayApp } from "./apps.js";
import { createHealthHandler, createPullHandler, createPushHandler } from "./handlers.js";
import { json } from "./http.js";

const ACTIONS = new Set(["push", "pull", "health"]);

function oneParam(url, name) {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0] : null;
}

export function createAppGateway({ env = process.env, storeFactory } = {}) {
  if (typeof storeFactory !== "function") throw new TypeError("storeFactory is required");
  const stores = new Map();
  return async function appGateway(request) {
    const url = new URL(request.url);
    const appId = oneParam(url, "__relay_app");
    const action = oneParam(url, "__relay_action");
    if (!appId || !ACTIONS.has(action)) return json({ ok: false, error: "app-route-not-found" }, 404);

    const resolved = resolveRelayApp(appId, env);
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, resolved.status);
    let store = stores.get(resolved.profile.namespace);
    if (!store) {
      store = storeFactory(resolved.profile.namespace);
      stores.set(resolved.profile.namespace, store);
    }
    if (action === "push") return createPushHandler({ store, env: resolved.handlerEnv })(request);
    if (action === "pull") return createPullHandler({ store, env: resolved.handlerEnv })(request);
    return createHealthHandler({ store, env: resolved.handlerEnv })(request);
  };
}
