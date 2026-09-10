import type { RadarItem } from "./types.js";
import { OAUTH } from "./oauth.js";

/**
 * Fetch shared trend data (stars/day gained) from the Worker's /trend endpoint
 * and set item.trend for the given items. Used for built-in preset topics so
 * every user sees the same 급상승 ranking, independent of local cache.
 *
 * Returns true if the server provided any trend, false otherwise (caller can
 * fall back to local observation history).
 */
export async function applyServerTrend(items: RadarItem[]): Promise<boolean> {
  if (items.length === 0) return false;
  const ids = items.map((i) => i.id).join(",");
  try {
    const res = await fetch(`${OAUTH.workerBaseUrl}/trend?ids=${encodeURIComponent(ids)}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { trends?: Record<string, number> };
    const trends = data.trends ?? {};
    let any = false;
    for (const item of items) {
      const t = trends[item.id];
      if (typeof t === "number") {
        item.trend = t;
        any = true;
      }
    }
    return any;
  } catch {
    return false;
  }
}
