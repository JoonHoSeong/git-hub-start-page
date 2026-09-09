/**
 * Cloudflare Worker: GitHub OAuth token exchange (the ONLY server component).
 *
 * The extension cannot exchange the OAuth `code` itself because GitHub's token
 * endpoint (a) requires the client_secret and (b) does not send CORS headers.
 * This worker holds the secret and adds CORS so the extension can call it.
 *
 * Secrets (set via `wrangler secret put`):
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 *
 * Optional var (wrangler.toml [vars]):
 *   ALLOWED_ORIGIN  e.g. "chrome-extension://<your-extension-id>"
 */

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_ORIGIN?: string;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowOrigin = env.ALLOWED_ORIGIN ?? "*";
    const cors = corsHeaders(allowOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/exchange") {
      return json({ error: "not_found" }, 404, cors);
    }

    let body: { code?: string; redirect_uri?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }
    if (!body.code) return json({ error: "missing_code" }, 400, cors);

    const ghRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: body.code,
        redirect_uri: body.redirect_uri,
      }),
    });

    const data = (await ghRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!data.access_token) {
      return json({ error: data.error ?? "exchange_failed", detail: data.error_description }, 400, cors);
    }
    // Return only the access token; never leak the secret.
    return json({ access_token: data.access_token }, 200, cors);
  },
};

function json(obj: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
