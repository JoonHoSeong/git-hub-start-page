import type { RadarItem, TopicRecipe } from "./types.js";
import { repoSearchUrl, buildTopicQueries } from "./query-builder.js";

const GITHUB_API = "https://api.github.com";

function headers(token?: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

interface RepoApi {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  created_at: string;
  pushed_at: string;
  topics?: string[];
}

function repoToItem(r: RepoApi): RadarItem {
  return {
    id: `repo:${r.id}`,
    title: r.full_name,
    repoFullName: r.full_name,
    url: r.html_url,
    description: r.description ?? "",
    stars: r.stargazers_count,
    forks: r.forks_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.pushed_at,
    topics: r.topics ?? [],
    score: 0,
  };
}

class GitHubApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/**
 * GET JSON from GitHub. If a token is provided and the server rejects it with
 * 401 (bad/expired credentials), retry once anonymously so read-only search
 * still works. Signals `authFailed` via the onAuthFail callback so the caller
 * can clear the dead token.
 */
async function getJson<T>(
  url: string,
  token?: string,
  onAuthFail?: () => void,
): Promise<T> {
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 401 && token) {
    // Dead token: drop it and retry anonymously.
    onAuthFail?.();
    const anon = await fetch(url, { headers: headers() });
    if (!anon.ok) {
      const body = await anon.text().catch(() => "");
      throw new GitHubApiError(anon.status, `GitHub API ${anon.status}: ${body.slice(0, 200)}`);
    }
    return (await anon.json()) as T;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GitHubApiError(res.status, `GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetch repositories for a topic.
 *
 * Runs the free-text query plus one query per official topic tag in parallel,
 * then merges and de-duplicates. This achieves OR-across-topics precision
 * without GitHub's multi-`topic:` AND collapsing results to zero.
 */
export async function searchRepos(
  topic: TopicRecipe,
  token?: string,
  perPage = 30,
  onAuthFail?: () => void,
): Promise<RadarItem[]> {
  const urls = new Set<string>();
  const topicQueries = buildTopicQueries(topic);

  if (topicQueries.length > 0) {
    // Primary path: official topic tags. Verified to give the best precision
    // and recall vs. free-text search against the live GitHub API.
    for (const q of topicQueries) {
      const params = new URLSearchParams({ q, sort: "stars", order: "desc", per_page: String(perPage) });
      urls.add(`${GITHUB_API}/search/repositories?${params.toString()}`);
    }
  } else {
    // Fallback: no official topics defined -> use the free-text query.
    urls.add(repoSearchUrl(topic, perPage));
  }

  const settled = await Promise.allSettled(
    [...urls].map((u) => getJson<{ items: RepoApi[] }>(u, token, onAuthFail)),
  );

  const byId = new Map<string, RadarItem>();
  let anyFulfilled = false;
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      continue;
    }
    anyFulfilled = true;
    for (const repo of r.value.items) {
      const item = repoToItem(repo);
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  // If every query failed (e.g. rate limit, auth), surface the error instead of
  // silently returning an empty list that looks like "no results".
  if (!anyFulfilled && errors.length > 0) {
    throw new Error(`GitHub repo search failed: ${errors[0]}`);
  }
  return [...byId.values()];
}

/** Fetch repository results for a topic. */
export async function fetchTopic(
  topic: TopicRecipe,
  token?: string,
  onAuthFail?: () => void,
): Promise<RadarItem[]> {
  return searchRepos(topic, token, 30, onAuthFail);
}

/** Check whether the authenticated user has starred a repo. */
export async function isStarred(repoFullName: string, token: string): Promise<boolean> {
  const res = await fetch(`${GITHUB_API}/user/starred/${repoFullName}`, {
    headers: headers(token),
  });
  return res.status === 204;
}

/** Star a repo for the authenticated user. */
export async function starRepo(repoFullName: string, token: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/user/starred/${repoFullName}`, {
    method: "PUT",
    headers: { ...headers(token), "Content-Length": "0" },
  });
  if (!res.ok && res.status !== 204) throw new Error(`star failed: ${res.status}`);
}

/** Unstar a repo for the authenticated user. */
export async function unstarRepo(repoFullName: string, token: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/user/starred/${repoFullName}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok && res.status !== 204) throw new Error(`unstar failed: ${res.status}`);
}

/** Fetch the current authenticated user's login (for UI + validation). */
export async function getViewer(token: string): Promise<{ login: string; avatar_url: string }> {
  return getJson(`${GITHUB_API}/user`, token);
}

/**
 * List the authenticated user's starred repositories (most recently starred
 * first). Used by the Favorites view. Returns up to `perPage` items.
 */
export async function listStarred(token: string, perPage = 100): Promise<RadarItem[]> {
  const params = new URLSearchParams({
    sort: "created",
    direction: "desc",
    per_page: String(perPage),
  });
  const data = await getJson<RepoApi[]>(`${GITHUB_API}/user/starred?${params.toString()}`, token);
  return data.map(repoToItem);
}
