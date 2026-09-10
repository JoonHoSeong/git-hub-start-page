import type { AppSettings, RadarItem, TopicRecipe } from "../../extension/src/types.js";
import { DEFAULT_SETTINGS } from "../../extension/src/types.js";
import { DEFAULT_TOPICS } from "../../extension/src/presets.js";

// Web port of extension/src/storage.ts. Same public API and semantics, but
// backed by localStorage instead of chrome.storage (no cross-device sync;
// data lives in this browser only, same as the extension's local storage).

const KEYS = {
  topics: "gtr.topics",
  settings: "gtr.settings",
  token: "gtr.githubToken",
  cache: "gtr.cache",
  bookmarks: "gtr.bookmarks",
  starHistory: "gtr.starHistory",
  seen: "gtr.seen",
} as const;

interface CacheEntry {
  items: unknown;
  fetchedAt: number;
}

function get<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function set(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function remove(key: string): void {
  localStorage.removeItem(key);
}

export async function loadTopics(): Promise<TopicRecipe[]> {
  const stored = get<TopicRecipe[] | null>(KEYS.topics, null);
  if (!stored) return DEFAULT_TOPICS;

  const latest = new Map(DEFAULT_TOPICS.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const merged: TopicRecipe[] = [];
  for (const t of stored) {
    if (t.isPreset && latest.has(t.id)) {
      merged.push({ ...latest.get(t.id)!, enabled: t.enabled });
      seen.add(t.id);
    } else {
      merged.push(t);
    }
  }
  for (const preset of DEFAULT_TOPICS) {
    if (!seen.has(preset.id) && !stored.some((s) => s.id === preset.id)) {
      merged.push(preset);
    }
  }
  return merged;
}

export async function saveTopics(topics: TopicRecipe[]): Promise<void> {
  set(KEYS.topics, topics);
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = get<Partial<AppSettings>>(KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  set(KEYS.settings, settings);
}

export async function loadToken(): Promise<string | null> {
  return get<string | null>(KEYS.token, null);
}

export async function saveToken(token: string | null): Promise<void> {
  if (token) set(KEYS.token, token);
  else remove(KEYS.token);
}

export async function getCache<T>(topicId: string, ttlMinutes: number): Promise<T | null> {
  const all = get<Record<string, CacheEntry>>(KEYS.cache, {});
  const entry = all[topicId];
  if (!entry) return null;
  const ageMin = (Date.now() - entry.fetchedAt) / 60000;
  if (ageMin > ttlMinutes) return null;
  return entry.items as T;
}

export async function setCache(topicId: string, items: unknown): Promise<void> {
  const all = get<Record<string, CacheEntry>>(KEYS.cache, {});
  all[topicId] = { items, fetchedAt: Date.now() };
  set(KEYS.cache, all);
}

// ---- Local bookmarks (app-only, not GitHub stars) ----
// Web version: localStorage only, no cross-device sync (unlike the
// extension's chrome.storage.sync). Same cap to avoid unbounded growth.

const BOOKMARK_LIMIT = 300;

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
  return get<Bookmark[]>(KEYS.bookmarks, []);
}

export async function isBookmarked(id: string): Promise<boolean> {
  const list = await loadBookmarks();
  return list.some((b) => b.id === id);
}

export async function addBookmark(item: RadarItem): Promise<void> {
  const list = await loadBookmarks();
  if (list.some((b) => b.id === item.id)) return;
  const next = [toBookmark(item), ...list].slice(0, BOOKMARK_LIMIT);
  set(KEYS.bookmarks, next);
}

export async function removeBookmark(id: string): Promise<void> {
  const list = await loadBookmarks();
  set(KEYS.bookmarks, list.filter((b) => b.id !== id));
}

// ---- Star observation history (for real trend = stars gained between visits) ----

interface StarObs {
  stars: number;
  at: number;
}
const STAR_HISTORY_LIMIT = 2000;
const MIN_TREND_HOURS = 1;

function loadStarHistory(): Record<string, StarObs> {
  return get<Record<string, StarObs>>(KEYS.starHistory, {});
}

export async function applyAndUpdateTrend(items: RadarItem[]): Promise<void> {
  const history = loadStarHistory();
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
    history[item.id] = { stars: item.stars, at: now };
  }

  const entries = Object.entries(history);
  if (entries.length > STAR_HISTORY_LIMIT) {
    entries.sort((a, b) => b[1].at - a[1].at);
    set(KEYS.starHistory, Object.fromEntries(entries.slice(0, STAR_HISTORY_LIMIT)));
  } else {
    set(KEYS.starHistory, history);
  }
}

// ---- "Seen" repos (for NEW badges) ----

const SEEN_LIMIT = 5000;

export async function filterNewIds(ids: string[]): Promise<Set<string>> {
  const seen = get<Record<string, number>>(KEYS.seen, {});
  return new Set(ids.filter((id) => !(id in seen)));
}

export async function markSeen(ids: string[]): Promise<void> {
  const seen = get<Record<string, number>>(KEYS.seen, {});
  const now = Date.now();
  for (const id of ids) seen[id] = now;
  const entries = Object.entries(seen);
  if (entries.length > SEEN_LIMIT) {
    entries.sort((a, b) => b[1] - a[1]);
    set(KEYS.seen, Object.fromEntries(entries.slice(0, SEEN_LIMIT)));
  } else {
    set(KEYS.seen, seen);
  }
}
