const DEFAULT_ORIGINS = ["https://appassets.androidplatform.net"];

function allowedOrigins(env) {
  return String(env.DSH_ALLOWED_ORIGINS ?? DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function corsOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  // Same-origin deployments work without embedding the owner's domain in source.
  // Request.url is the platform URL, never assembled from x-forwarded-host here.
  if (origin === new URL(request.url).origin) return origin;
  return allowedOrigins(env).includes(origin) ? origin : false;
}

export function json(body, status = 200, origin = null) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function options(origin) {
  if (origin === false) return json({ ok: false, error: "origin-not-allowed" }, 403);
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,cache-control",
    "access-control-max-age": "600",
    "cache-control": "no-store",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return new Response(null, { status: 204, headers });
}
