import type { RadarItem } from "../../extension/src/types.js";
import { OAUTH } from "./oauth.js";

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
