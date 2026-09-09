import type { AppSettings, TopicRecipe } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { DEFAULT_TOPICS } from "./presets.js";

const KEYS = {
  topics: "topics",
  settings: "settings",
  token: "githubToken",
  cache: "cache",
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
  return get<TopicRecipe[]>(KEYS.topics, DEFAULT_TOPICS);
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
