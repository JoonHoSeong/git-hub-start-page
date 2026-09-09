import type { RadarItem, TopicRecipe } from "./types.js";
import { repoSearchUrl, issueSearchUrl, buildTopicQueries } from "./query-builder.js";

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
  created_at: string;
  pushed_at: string;
  topics?: string[];
}

interface IssueApi {
  id: number;
  title: string;
  html_url: string;
  body: string | null;
  comments: number;
  created_at: string;
  updated_at: string;
  reactions?: { total_count: number };
  repository_url: string;
  pull_request?: unknown;
}

function repoToItem(r: RepoApi): RadarItem {
  return {
    id: `repo:${r.id}`,
    kind: "repository",
    title: r.full_name,
    repoFullName: r.full_name,
    url: r.html_url,
    description: r.description ?? "",
    stars: r.stargazers_count,
    createdAt: r.created_at,
    updatedAt: r.pushed_at,
    comments: 0,
    reactions: 0,
    topics: r.topics ?? [],
    score: 0,
  };
}

function issueToItem(i: IssueApi): RadarItem {
  const repoFullName = i.repository_url.replace(`${GITHUB_API}/repos/`, "");
  return {
    id: `issue:${i.id}`,
    kind: i.pull_request ? "pull_request" : "issue",
    title: i.title,
    repoFullName,
    url: i.html_url,
    description: (i.body ?? "").slice(0, 280),
    stars: 0,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    comments: i.comments,
    reactions: i.reactions?.total_count ?? 0,
    topics: [],
    score: 0,
  };
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
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
    [...urls].map((u) => getJson<{ items: RepoApi[] }>(u, token)),
  );

  const byId = new Map<string, RadarItem>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const repo of r.value.items) {
      const item = repoToItem(repo);
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

/** Fetch issues or PRs for a topic. */
export async function searchIssues(
  topic: TopicRecipe,
  kind: "issue" | "pr",
  token?: string,
  perPage = 30,
): Promise<RadarItem[]> {
  const url = issueSearchUrl(topic, kind, perPage);
  const data = await getJson<{ items: IssueApi[] }>(url, token);
  return data.items.map(issueToItem);
}

/** Gather all enabled sources for a topic into one list. */
export async function fetchTopic(topic: TopicRecipe, token?: string): Promise<RadarItem[]> {
  const jobs: Promise<RadarItem[]>[] = [];
  if (topic.sources.repositories) jobs.push(searchRepos(topic, token));
  if (topic.sources.issues) jobs.push(searchIssues(topic, "issue", token));
  if (topic.sources.pullRequests) jobs.push(searchIssues(topic, "pr", token));
  const results = await Promise.all(jobs);
  return results.flat();
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
