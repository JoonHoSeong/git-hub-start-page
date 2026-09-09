import type { AppSettings, RadarItem, TopicRecipe } from "./types.js";
import { fetchTopic } from "./github.js";
import { rankItems, applyExclusions } from "./ranking.js";
import { enrichWithLlm } from "./llm.js";
import { getCache, setCache } from "./storage.js";

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
  opts: { forceRefresh?: boolean; subtopicId?: string } = {},
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
    if (cached) return { items: cached, fromCache: true, llmApplied: false };
  }

  const raw = await fetchTopic(effectiveTopic, token);
  const filtered = applyExclusions(dedupe(raw), effectiveTopic);
  const ranked = rankItems(filtered, effectiveTopic);

  const hasLlm = Boolean(settings.llm.apiKey) || /localhost|127\.0\.0\.1/.test(settings.llm.baseUrl);
  let llmApplied = false;
  if (hasLlm) {
    await enrichWithLlm(ranked, effectiveTopic, settings.llm, settings.llmTopN);
    llmApplied = true;
    const relevant = ranked.filter((it) => it.relevant !== false);
    await setCache(cacheKey, relevant);
    return { items: relevant, fromCache: false, llmApplied };
  }

  await setCache(cacheKey, ranked);
  return { items: ranked, fromCache: false, llmApplied };
}
