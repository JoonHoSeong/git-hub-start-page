import type { AppSettings, RadarItem, TopicRecipe } from "./types.js";
import { fetchTopic } from "./github.js";
import { applyExclusions, sortItems } from "./ranking.js";
import { getCache, setCache, applyAndUpdateTrend } from "./storage.js";

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
  opts: { forceRefresh?: boolean; subtopicId?: string; onAuthFail?: () => void } = {},
): Promise<RunResult> {
  // If a subtopic is active, narrow the search to its topic tags and add any
  // extra exclusions. Uses a separate cache key so subtopic results are cached
  // independently of the parent topic.
  const sub = opts.subtopicId
    ? topic.subtopics?.find((s) => s.id === opts.subtopicId)
    : undefined;
  const effectiveTopic: TopicRecipe = sub
    ? {
        ...topic,
        githubTopics: sub.githubTopics,
        exclude: [...topic.exclude, ...(sub.exclude ?? [])],
      }
    : topic;
  const cacheKey = sub ? `${topic.id}::${sub.id}` : topic.id;

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
  // Measure real trend (stars gained since last visit) and record the current
  // observation, before scoring/sorting so momentum reflects it.
  await applyAndUpdateTrend(filtered);
  const ranked = sortItems(filtered, effectiveTopic, settings.sortBy);

  // Relevance verification + summaries run on the document side (popup/newtab)
  // via Chrome's built-in Prompt API, which is not available in service
  // workers. The pipeline just fetches, filters, and sorts.
  await setCache(cacheKey, ranked);
  return { items: ranked, fromCache: false, llmApplied: false };
}
