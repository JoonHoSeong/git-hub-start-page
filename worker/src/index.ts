/**
 * Cloudflare Worker for GitHub Topic Radar.
 *
 * Two jobs:
 *  1) OAuth token exchange (POST /exchange) — GitHub's token endpoint needs the
 *     client_secret and lacks CORS, so the extension delegates that here.
 *  2) Shared trend backend — a Cron Trigger periodically records star counts of
 *     top repos for the built-in preset topics into KV, and GET /trend serves
 *     each repo's recent star gain (stars/day). This makes the "급상승순" the
 *     same for every user and independent of local cache.
 *
 * Secrets (wrangler secret put):
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 *   GITHUB_PAT   (optional; raises Search API rate limit for the collector)
 * Bindings (wrangler.toml):
 *   TREND        KV namespace
 * Vars:
 *   ALLOWED_ORIGIN
 */

interface KVNamespace {
  get(key: string, type?: "text" | "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_PAT?: string;
  ALLOWED_ORIGIN?: string;
  TREND: KVNamespace;
}

// Preset topics the collector tracks (must mirror the extension's presets).
const TRACKED_TOPICS = [
  "llm",
  "large-language-models",
  "model-context-protocol",
  "mcp-server",
  "mcp",
  "agent-skills",
  "claude-skills",
  "ai-agents",
  "rag",
  "vector-database",
  "prompt-engineering",
  "diffusion-models",
  "fine-tuning",
  "speech-to-text",
  "frontend",
  "react",
  "vue",
  "backend",
  "api",
  "mobile",
  "flutter",
  "react-native",
  "devops",
  "kubernetes",
  "docker",
  "security",
  "cybersecurity",
];

interface StarSnapshot {
  stars: number;
  at: number;
  prevStars?: number;
  prevAt?: number;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env.ALLOWED_ORIGIN ?? "*");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/exchange") {
      return handleExchange(request, env, cors);
    }
    if (request.method === "GET" && url.pathname === "/trend") {
      return handleTrend(url, env, cors);
    }
    return json({ error: "not_found" }, 404, cors);
  },

  // Cron Trigger: record current star counts for tracked topics.
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<void> {
    ctx.waitUntil(collectTrends(env));
  },
};

async function handleExchange(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
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
  const data = (await ghRes.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    return json({ error: data.error ?? "exchange_failed", detail: data.error_description }, 400, cors);
  }
  return json({ access_token: data.access_token }, 200, cors);
}

/**
 * GET /trend?ids=repo:123,repo:456
 * Returns { trends: { "repo:123": <stars/day>, ... } } for repos we track,
 * computed from the two most recent snapshots.
 */
async function handleTrend(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const idsParam = url.searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 300);
  const trends: Record<string, number> = {};
  await Promise.all(
    ids.map(async (id) => {
      const snap = (await env.TREND.get(`snap:${id}`, "json")) as StarSnapshot | null;
      if (snap && snap.prevStars !== undefined && snap.prevAt !== undefined) {
        const days = (snap.at - snap.prevAt) / 86_400_000;
        if (days > 0) trends[id] = (snap.stars - snap.prevStars) / days;
      }
    }),
  );
  return json({ trends }, 200, cors);
}

/** Fetch top repos per tracked topic and record star snapshots in KV. */
async function collectTrends(env: Env): Promise<void> {
  const now = Date.now();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "github-topic-radar-worker",
  };
  if (env.GITHUB_PAT) headers.Authorization = `Bearer ${env.GITHUB_PAT}`;

  const seen = new Set<string>();
  for (const topic of TRACKED_TOPICS) {
    const q = encodeURIComponent(`topic:${topic} stars:>=10`);
    const u = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=50`;
    try {
      const res = await fetch(u, { headers });
      if (!res.ok) continue;
      const data = (await res.json()) as { items: { id: number; stargazers_count: number }[] };
      for (const repo of data.items) {
        const id = `repo:${repo.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const prev = (await env.TREND.get(`snap:${id}`, "json")) as StarSnapshot | null;
        const snap: StarSnapshot = {
          stars: repo.stargazers_count,
          at: now,
          prevStars: prev?.stars,
          prevAt: prev?.at,
        };
        // Keep for 30 days; refreshed each run.
        await env.TREND.put(`snap:${id}`, JSON.stringify(snap), { expirationTtl: 60 * 60 * 24 * 30 });
      }
    } catch {
      // Skip this topic on error; other topics still get collected.
    }
  }
}

function json(obj: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
