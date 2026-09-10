import type { AppSettings, RadarItem, TopicRecipe } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { DEFAULT_TOPICS } from "./presets.js";

const KEYS = {
  topics: "topics",
  settings: "settings",
  token: "githubToken",
  cache: "cache",
  bookmarks: "bookmarks",
  starHistory: "starHistory",
} as const;

interface CacheEntry {
  items: unknown;
  fetchedAt: number;
}

async function get<T>(key: string, fallback: T): Promise<T> {
  const obj = await chrome.storage.local.get(key);
  return (obj[key] as T) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function loadTopics(): Promise<TopicRecipe[]> {
  const stored = await get<TopicRecipe[] | null>(KEYS.topics, null);
  if (!stored) return DEFAULT_TOPICS;

  // Migration: refresh built-in presets to their latest definitions (e.g.
  // improved topic tags) while preserving user-created custom topics and the
  // user's current tab order. Preset identity is the stable `preset-*` id.
  const latest = new Map(DEFAULT_TOPICS.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const merged: TopicRecipe[] = [];
  for (const t of stored) {
    if (t.isPreset && latest.has(t.id)) {
      // Replace the preset with the latest definition but keep the user's
      // enable/disable choice for this tab.
      merged.push({ ...latest.get(t.id)!, enabled: t.enabled });
      seen.add(t.id);
    } else {
      merged.push(t);
    }
  }
  // Add any newly introduced presets the user has never seen.
  for (const preset of DEFAULT_TOPICS) {
    if (!seen.has(preset.id) && !stored.some((s) => s.id === preset.id)) {
      merged.push(preset);
    }
  }
  return merged;
}

export async function saveTopics(topics: TopicRecipe[]): Promise<void> {
  await set(KEYS.topics, topics);
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await get<Partial<AppSettings>>(KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await set(KEYS.settings, settings);
}

export async function loadToken(): Promise<string | null> {
  return get<string | null>(KEYS.token, null);
}

export async function saveToken(token: string | null): Promise<void> {
  if (token) await set(KEYS.token, token);
  else await chrome.storage.local.remove(KEYS.token);
}

export async function getCache<T>(topicId: string, ttlMinutes: number): Promise<T | null> {
  const all = await get<Record<string, CacheEntry>>(KEYS.cache, {});
  const entry = all[topicId];
  if (!entry) return null;
  const ageMin = (Date.now() - entry.fetchedAt) / 60000;
  if (ageMin > ttlMinutes) return null;
  return entry.items as T;
}

export async function setCache(topicId: string, items: unknown): Promise<void> {
  const all = await get<Record<string, CacheEntry>>(KEYS.cache, {});
  all[topicId] = { items, fetchedAt: Date.now() };
  await set(KEYS.cache, all);
}

// ---- Local bookmarks (option 1: app-only, not GitHub stars) ----
// Stored in chrome.storage.sync so they follow the user's Chrome account
// across devices. Sync has quota limits, so we cap the list and keep only the
// fields the Favorites view needs.

const BOOKMARK_LIMIT = 300;

async function syncGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const obj = await chrome.storage.sync.get(key);
    return (obj[key] as T) ?? fallback;
  } catch {
    const obj = await chrome.storage.local.get(key);
    return (obj[key] as T) ?? fallback;
  }
}

async function syncSet(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.sync.set({ [key]: value });
  } catch {
    await chrome.storage.local.set({ [key]: value });
  }
}

/** Compact form of a bookmarked item kept in sync storage. */
export interface Bookmark {
  id: string;
  title: string;
  repoFullName: string;
  url: string;
  description: string;
  addedAt: number;
}

function toBookmark(item: RadarItem): Bookmark {
  return {
    id: item.id,
    title: item.title,
    repoFullName: item.repoFullName,
    url: item.url,
    description: item.description.slice(0, 200),
    addedAt: Date.now(),
  };
}

export async function loadBookmarks(): Promise<Bookmark[]> {
  return syncGet<Bookmark[]>(KEYS.bookmarks, []);
}

export async function isBookmarked(id: string): Promise<boolean> {
  const list = await loadBookmarks();
  return list.some((b) => b.id === id);
}

/** Add a bookmark (most recent first). No-op if already present. */
export async function addBookmark(item: RadarItem): Promise<void> {
  const list = await loadBookmarks();
  if (list.some((b) => b.id === item.id)) return;
  const next = [toBookmark(item), ...list].slice(0, BOOKMARK_LIMIT);
  await syncSet(KEYS.bookmarks, next);
}

export async function removeBookmark(id: string): Promise<void> {
  const list = await loadBookmarks();
  await syncSet(KEYS.bookmarks, list.filter((b) => b.id !== id));
}

// ---- Star observation history (for real trend = stars gained between visits) ----
// Stored in chrome.storage.local as { [repoId]: { stars, at } }. Capped to
// avoid unbounded growth. We keep the most recently observed entries.

interface StarObs {
  stars: number;
  at: number;
}
const STAR_HISTORY_LIMIT = 2000;
const MIN_TREND_HOURS = 1; // ignore deltas measured over a very short interval

async function loadStarHistory(): Promise<Record<string, StarObs>> {
  return get<Record<string, StarObs>>(KEYS.starHistory, {});
}

/**
 * Given freshly fetched items, compute each item's `trend` (stars gained per
 * day since the last observation) and then record the current observation.
 * On the first observation for a repo, `trend` stays undefined.
 */
export async function applyAndUpdateTrend(items: RadarItem[]): Promise<void> {
  const history = await loadStarHistory();
  const now = Date.now();

  for (const item of items) {
    const prev = history[item.id];
    if (prev) {
      const hours = (now - prev.at) / 3_600_000;
      if (hours >= MIN_TREND_HOURS) {
        const days = hours / 24;
        item.trend = (item.stars - prev.stars) / days;
      }
    }
    // Record the current observation (overwrites the previous one).
    history[item.id] = { stars: item.stars, at: now };
  }

  // Cap history size: keep the most recently observed entries.
  const entries = Object.entries(history);
  if (entries.length > STAR_HISTORY_LIMIT) {
    entries.sort((a, b) => b[1].at - a[1].at);
    const trimmed = Object.fromEntries(entries.slice(0, STAR_HISTORY_LIMIT));
    await set(KEYS.starHistory, trimmed);
  } else {
    await set(KEYS.starHistory, history);
  }
}
