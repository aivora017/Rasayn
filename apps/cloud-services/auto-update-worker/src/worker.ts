// PharmaCare Pro — auto-update manifest worker (Cloudflare Workers + R2)
//
// Serves https://updates.pharmacare.in/manifest.json?channel={stable|beta|pilot}
// Reads R2 object key `manifest-{channel}.json` and returns it as JSON with a
// 5-minute Cache-Control. The manifest itself is signed (ed25519) by the
// founder-side promote-manifest.ts script; this worker only proxies + caches.
//
// S27.F — pre-pilot v0.1.0 -> v0.1.1 patching. See:
//   docs/runbooks/auto-update-release-flow.md
//   packages/auto-update/src/index.ts (manifest schema)

export interface Env {
  // R2 binding declared in wrangler.toml as `MANIFESTS`.
  MANIFESTS: R2Bucket;
}

const ALLOWED_CHANNELS = new Set(["stable", "beta", "pilot"]);
const DEFAULT_CHANNEL = "stable";
const CACHE_SECONDS = 300; // 5 min

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

function errorResponse(code: string, status: number, detail?: string): Response {
  return jsonResponse({ error: code, detail: detail ?? null }, status, {
    "cache-control": "no-store",
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse("METHOD_NOT_ALLOWED", 405);
    }

    // We only serve the manifest endpoint. Anything else 404s.
    if (url.pathname !== "/manifest.json" && url.pathname !== "/") {
      return errorResponse("NOT_FOUND", 404, `path ${url.pathname} not served`);
    }

    const channelRaw = (url.searchParams.get("channel") ?? DEFAULT_CHANNEL).toLowerCase();
    if (!ALLOWED_CHANNELS.has(channelRaw)) {
      return errorResponse(
        "INVALID_CHANNEL",
        400,
        `channel must be one of ${[...ALLOWED_CHANNELS].join(", ")}`,
      );
    }

    const key = `manifest-${channelRaw}.json`;
    const obj = await env.MANIFESTS.get(key);
    if (!obj) {
      return errorResponse(
        "MANIFEST_NOT_FOUND",
        404,
        `no manifest published for channel "${channelRaw}" yet`,
      );
    }

    // Stream R2 body straight through with the same cache headers.
    // R2 set httpEtag on the object — pass it for conditional GETs.
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "access-control-allow-origin": "*",
      "x-pharmacare-channel": channelRaw,
    };
    if (obj.httpEtag) headers["etag"] = obj.httpEtag;

    return new Response(request.method === "HEAD" ? null : obj.body, {
      status: 200,
      headers,
    });
  },
};
