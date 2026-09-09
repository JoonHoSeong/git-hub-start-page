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

  // Discussion signal (issues/PRs). Repos usually have 0 here.
  const discussion = Math.log10(item.comments + item.reactions + 1) * 15;

  // Baseline popularity, dampened so it does not dominate velocity.
  const popularity = Math.log10(item.stars + 1) * 5;

  return velocityScore + freshness + topicScore + discussion + popularity;
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
