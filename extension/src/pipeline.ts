import type { AppSettings, RadarItem, TopicRecipe } from "./types.js";
import { fetchTopic } from "./github.js";
import { applyExclusions, sortItems } from "./ranking.js";
import { getCache, setCache, applyAndUpdateTrend } from "./storage.js";
import { applyServerTrend } from "./trend-server.js";

/** Deduplicate items by id, keeping the first occurrence. */
function dedupe(items: RadarItem[]): RadarItem[] {
  const seen = new Set<string>();
  const out: RadarItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

export interface RunResult {
  items: RadarItem[];
  fromCache: boolean;
  llmApplied: boolean;
}

/**
 * Full pipeline for one topic:
 *  1. cache check
 *  2. fetch enabled sources
 *  3. dedupe + momentum rank
 *  4. optional LLM verify/summarize on top-N (high-quality tier)
 */
export async function runTopic(
  topic: TopicRecipe,
  settings: AppSettings,
  token?: string,
  opts: { forceRefresh?: boolean; subtopicIds?: string[]; onAuthFail?: () => void } = {},
): Promise<RunResult> {
  // If one or more subtopics are active, narrow to the union of their topic
  // tags and add their extra exclusions. A separate cache key keeps each
  // combination cached independently of the parent topic.
  const activeSubs = (opts.subtopicIds ?? [])
    .map((id) => topic.subtopics?.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s);

  const effectiveTopic: TopicRecipe =
    activeSubs.length > 0
      ? {
          ...topic,
          githubTopics: [...new Set(activeSubs.flatMap((s) => s.githubTopics))],
          exclude: [...topic.exclude, ...activeSubs.flatMap((s) => s.exclude ?? [])],
        }
      : topic;
  const cacheKey =
    activeSubs.length > 0
      ? `${topic.id}::${activeSubs.map((s) => s.id).sort().join("+")}`
      : topic.id;

  if (!opts.forceRefresh) {
    const cached = await getCache<RadarItem[]>(cacheKey, settings.cacheTtlMinutes);
    if (cached) {
      // Re-sort cached items so a sort-order change applies without refetching.
      const sorted = sortItems(cached, effectiveTopic, settings.sortBy);
      return { items: sorted, fromCache: true, llmApplied: false };
    }
  }

  const raw = await fetchTopic(effectiveTopic, token, opts.onAuthFail);
  const filtered = applyExclusions(dedupe(raw), effectiveTopic);

  // Trend source: built-in presets use the shared server trend (same for all
  // users, cache-independent). Custom topics — which the server does not track
  // — fall back to local observation history. If the server has no data yet,
  // also fall back to local.
  let usedServerTrend = false;
  if (topic.isPreset) {
    usedServerTrend = await applyServerTrend(filtered);
  }
  if (!usedServerTrend) {
    await applyAndUpdateTrend(filtered);
  }

  const ranked = sortItems(filtered, effectiveTopic, settings.sortBy);

  await setCache(cacheKey, ranked);
  return { items: ranked, fromCache: false, llmApplied: false };
}
