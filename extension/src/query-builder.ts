import type { TopicRecipe } from "./types.js";

/** Format a Date as GitHub search date qualifier YYYY-MM-DD. */
export function toGitHubDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compute the `pushed:>DATE` cutoff from recentDays relative to `now`. */
export function recentCutoff(recentDays: number, now: Date = new Date()): string {
  const cutoff = new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000);
  return toGitHubDate(cutoff);
}

/** Quote a phrase for GitHub search if it contains whitespace. */
function quoteIfPhrase(term: string): string {
  const t = term.trim();
  if (!t) return "";
  return /\s/.test(t) ? `"${t}"` : t;
}

/**
 * Build the repository search query string for a topic.
 *
 * IMPORTANT: GitHub ANDs multiple `topic:` qualifiers together, and there is no
 * OR syntax for them. Combining several topics AND-ed with text include terms
 * quickly yields zero results (verified against the live API). So we build a
 * single OR group over BOTH the free-text includes and the topic names
 * expressed as text, and keep at most ONE `topic:` qualifier as a soft precision
 * hint only when there are no free-text include terms. Topic precision is
 * otherwise rewarded by the ranker (topic-accuracy bonus), not by hard filtering.
 */
export function buildRepoQuery(topic: TopicRecipe, now: Date = new Date()): string {
  const parts: string[] = [];

  const orTerms: string[] = [];
  for (const inc of topic.include) {
    const q = quoteIfPhrase(inc);
    if (q) orTerms.push(q);
  }

  if (orTerms.length === 0 && topic.githubTopics.length > 0) {
    // No free text: use a single topic qualifier (precise, non-empty).
    parts.push(`topic:${topic.githubTopics[0].trim()}`);
  } else if (orTerms.length === 1) {
    parts.push(orTerms[0]);
  } else if (orTerms.length > 1) {
    parts.push(`(${orTerms.join(" OR ")})`);
  }

  // Exclusions to remove noise.
  for (const ex of topic.exclude) {
    const q = quoteIfPhrase(ex);
    if (q) parts.push(`-${q}`);
  }

  if (topic.minStars > 0) parts.push(`stars:>=${topic.minStars}`);
  if (topic.recentDays > 0) parts.push(`pushed:>${recentCutoff(topic.recentDays, now)}`);

  return parts.join(" ").trim();
}

/**
 * Build one query per official topic tag (each is precise and non-empty).
 * Callers can run these in parallel and merge, giving OR-across-topics behavior
 * without the zero-result AND problem.
 */
export function buildTopicQueries(topic: TopicRecipe, now: Date = new Date()): string[] {
  const tail: string[] = [];
  for (const ex of topic.exclude) {
    const q = quoteIfPhrase(ex);
    if (q) tail.push(`-${q}`);
  }
  if (topic.minStars > 0) tail.push(`stars:>=${topic.minStars}`);
  if (topic.recentDays > 0) tail.push(`pushed:>${recentCutoff(topic.recentDays, now)}`);
  const suffix = tail.length ? ` ${tail.join(" ")}` : "";
  return topic.githubTopics
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `topic:${t}${suffix}`);
}

/**
 * Build the issues/PR search query. GitHub uses /search/issues for both,
 * differentiated by `type:issue` or `type:pr`.
 */
export function buildIssueQuery(
  topic: TopicRecipe,
  kind: "issue" | "pr",
  now: Date = new Date(),
): string {
  const parts: string[] = [];

  const includes = topic.include.map(quoteIfPhrase).filter(Boolean);
  if (includes.length === 1) {
    parts.push(includes[0]);
  } else if (includes.length > 1) {
    parts.push(`(${includes.join(" OR ")})`);
  }
  // If there are no free-text terms, fall back to topic names as text.
  if (includes.length === 0 && topic.githubTopics.length > 0) {
    parts.push(`(${topic.githubTopics.map((t) => quoteIfPhrase(t.replace(/-/g, " "))).join(" OR ")})`);
  }

  for (const ex of topic.exclude) {
    const q = quoteIfPhrase(ex);
    if (q) parts.push(`-${q}`);
  }

  parts.push(`type:${kind}`);
  parts.push("state:open");
  if (topic.recentDays > 0) parts.push(`updated:>${recentCutoff(topic.recentDays, now)}`);

  return parts.join(" ").trim();
}

/** Full endpoint URL for a repository search. */
export function repoSearchUrl(topic: TopicRecipe, perPage = 30, now: Date = new Date()): string {
  const q = buildRepoQuery(topic, now);
  const params = new URLSearchParams({
    q,
    sort: "stars",
    order: "desc",
    per_page: String(perPage),
  });
  return `https://api.github.com/search/repositories?${params.toString()}`;
}

/** Full endpoint URL for an issue/PR search. */
export function issueSearchUrl(
  topic: TopicRecipe,
  kind: "issue" | "pr",
  perPage = 30,
  now: Date = new Date(),
): string {
  const q = buildIssueQuery(topic, kind, now);
  const params = new URLSearchParams({
    q,
    sort: "comments",
    order: "desc",
    per_page: String(perPage),
  });
  return `https://api.github.com/search/issues?${params.toString()}`;
}
