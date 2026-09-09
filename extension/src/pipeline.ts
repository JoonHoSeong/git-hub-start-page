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
  opts: { forceRefresh?: boolean } = {},
): Promise<RunResult> {
  if (!opts.forceRefresh) {
    const cached = await getCache<RadarItem[]>(topic.id, settings.cacheTtlMinutes);
    if (cached) return { items: cached, fromCache: true, llmApplied: false };
  }

  const raw = await fetchTopic(topic, token);
  const filtered = applyExclusions(dedupe(raw), topic);
  const ranked = rankItems(filtered, topic);

  const hasLlm = Boolean(settings.llm.apiKey) || /localhost|127\.0\.0\.1/.test(settings.llm.baseUrl);
  let llmApplied = false;
  if (hasLlm) {
    await enrichWithLlm(ranked, topic, settings.llm, settings.llmTopN);
    llmApplied = true;
    // Drop items the LLM judged irrelevant (only within the checked top-N).
    const relevant = ranked.filter((it) => it.relevant !== false);
    await setCache(topic.id, relevant);
    return { items: relevant, fromCache: false, llmApplied };
  }

  await setCache(topic.id, ranked);
  return { items: ranked, fromCache: false, llmApplied };
}
