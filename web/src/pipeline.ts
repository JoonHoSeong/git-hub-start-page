import type { AppSettings, RadarItem, TopicRecipe } from "../../extension/src/types.js";
import { fetchTopic } from "../../extension/src/github.js";
import { applyExclusions, sortItems } from "../../extension/src/ranking.js";
import { applyServerTrend } from "./trend-server.js";
import { getCache, setCache, applyAndUpdateTrend } from "./storage.js";

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
}

export async function runTopic(
  topic: TopicRecipe,
  settings: AppSettings,
  token?: string,
  opts: { forceRefresh?: boolean; subtopicIds?: string[]; onAuthFail?: () => void } = {},
): Promise<RunResult> {
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
      const sorted = sortItems(cached, effectiveTopic, settings.sortBy);
      return { items: sorted, fromCache: true };
    }
  }

  const raw = await fetchTopic(effectiveTopic, token, opts.onAuthFail);
  const filtered = applyExclusions(dedupe(raw), effectiveTopic);

  let usedServerTrend = false;
  if (topic.isPreset) {
    usedServerTrend = await applyServerTrend(filtered);
  }
  if (!usedServerTrend) {
    await applyAndUpdateTrend(filtered);
  }

  const ranked = sortItems(filtered, effectiveTopic, settings.sortBy);

  await setCache(cacheKey, ranked);
  return { items: ranked, fromCache: false };
}
