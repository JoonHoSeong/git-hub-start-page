import type { RadarItem, TopicRecipe } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days between two ISO timestamps (>= 0). */
function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (to.getTime() - from) / DAY_MS);
}

/**
 * Momentum score. GitHub Search cannot sort by "stars gained recently", so we
 * approximate momentum from available signals:
 *  - star velocity: stars per day since creation (captures fast risers)
 *  - freshness: recent activity is worth more (exponential decay)
 *  - topic accuracy: repo carries the topic's official github topics
 *  - discussion: comments + reactions (mainly for issues/PRs)
 */
export function computeScore(
  item: RadarItem,
  topic: TopicRecipe,
  now: Date = new Date(),
): number {
  const ageDays = daysBetween(item.createdAt, now);
  const inactiveDays = daysBetween(item.updatedAt, now);

  // Star velocity: stars per day since creation. Newer hot repos score high.
  const velocity = item.stars / Math.max(ageDays, 1);
  const velocityScore = Math.log10(velocity + 1) * 40;

  // Freshness: exponential decay by days since last activity (half-life ~7d).
  const freshness = Math.exp(-inactiveDays / 7) * 25;

  // Topic accuracy: repo declares one of the topic's official tags.
  const wanted = new Set(topic.githubTopics.map((t) => t.toLowerCase()));
  const has = item.topics.some((t) => wanted.has(t.toLowerCase()));
  const topicScore = has ? 20 : 0;

  // Baseline popularity, dampened so it does not dominate velocity.
  const popularity = Math.log10(item.stars + 1) * 5;

  return velocityScore + freshness + topicScore + popularity;
}

/** Rank items in place by descending momentum score. Returns the array. */
export function rankItems(
  items: RadarItem[],
  topic: TopicRecipe,
  now: Date = new Date(),
): RadarItem[] {
  for (const item of items) {
    item.score = computeScore(item, topic, now);
  }
  items.sort((a, b) => b.score - a.score);
  return items;
}

export type SortBy = "momentum" | "stars" | "forks" | "updated";

/**
 * Sort items by the chosen criterion. "momentum" uses the precomputed score;
 * the others sort by the corresponding field (descending). Always computes the
 * momentum score first so the 🔥 badge stays meaningful regardless of sort.
 */
export function sortItems(
  items: RadarItem[],
  topic: TopicRecipe,
  sortBy: SortBy,
  now: Date = new Date(),
): RadarItem[] {
  for (const item of items) item.score = computeScore(item, topic, now);
  const cmp: Record<SortBy, (a: RadarItem, b: RadarItem) => number> = {
    momentum: (a, b) => b.score - a.score,
    stars: (a, b) => b.stars - a.stars,
    forks: (a, b) => b.forks - a.forks,
    updated: (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  };
  items.sort(cmp[sortBy]);
  return items;
}

/**
 * Drop items whose text matches any of the topic's exclusion terms.
 *
 * Exclusions are applied here (client-side) rather than in the GitHub query,
 * because a negated text term combined with a `topic:`-only query makes GitHub
 * return zero results. We match case-insensitively against the repo full name,
 * title, description, and topic tags.
 */
export function applyExclusions(items: RadarItem[], topic: TopicRecipe): RadarItem[] {
  const terms = topic.exclude
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const haystack = [
      item.repoFullName,
      item.title,
      item.description,
      item.topics.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return !terms.some((t) => haystack.includes(t));
  });
}
