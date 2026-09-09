import type { AppSettings, RadarItem, TopicRecipe } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { DEFAULT_TOPICS } from "./presets.js";

const KEYS = {
  topics: "topics",
  settings: "settings",
  token: "githubToken",
  cache: "cache",
  bookmarks: "bookmarks",
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
      // source toggles (they may have enabled issues/PRs for this topic).
      merged.push({ ...latest.get(t.id)!, sources: t.sources });
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
    llm: { ...DEFAULT_SETTINGS.llm, ...stored.llm },
    defaultSources: { ...DEFAULT_SETTINGS.defaultSources, ...stored.defaultSources },
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
  kind: RadarItem["kind"];
  title: string;
  repoFullName: string;
  url: string;
  description: string;
  addedAt: number;
}

function toBookmark(item: RadarItem): Bookmark {
  return {
    id: item.id,
    kind: item.kind,
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
