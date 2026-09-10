// Core domain types for GitHub Topic Radar.

/** A topic is a reusable "search recipe" that narrows GitHub to one subject. */
export interface TopicRecipe {
  id: string;
  name: string;
  /** Free-text keywords, combined with OR. */
  include: string[];
  /** Keywords to exclude, to remove noise. */
  exclude: string[];
  /** Official GitHub `topic:` tags (highest precision signal). */
  githubTopics: string[];
  /** Minimum stars for repositories (stars:>N). */
  minStars: number;
  /** Only consider items pushed/updated within the last N days. */
  recentDays: number;
  /** Optional finer-grained sub-filters shown as chips within the topic. */
  subtopics?: Subtopic[];
  /** Whether this topic appears as a tab. Users toggle this in settings. */
  enabled?: boolean;
  /** True for built-in presets (still user-editable/removable). */
  isPreset: boolean;
}

/**
 * A sub-filter within a topic. When active, its githubTopics/include/exclude are
 * intersected with the parent topic to narrow results (e.g. MCP → Server).
 */
export interface Subtopic {
  id: string;
  name: string;
  /** Official topic tags that further narrow the parent topic. */
  githubTopics: string[];
  /** Extra exclusions applied client-side for this sub-filter. */
  exclude?: string[];
}

/** A normalized trending repository result. */
export interface RadarItem {
  id: string;
  title: string;
  /** owner/name. */
  repoFullName: string;
  url: string;
  description: string;
  stars: number;
  /** Fork count. */
  forks: number;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last activity (push or update). */
  updatedAt: string;
  /** GitHub official topic tags on the repo (when available). */
  topics: string[];
  /** Computed momentum score (higher = hotter). Set by the ranker. */
  score: number;
  /** Optional AI-generated one-line summary. */
  summary?: string;
  /** Optional AI relevance verdict. */
  relevant?: boolean;
}

export interface AppSettings {
  /** Cache time-to-live in minutes. */
  cacheTtlMinutes: number;
  /** Verify relevance + summarize top results with Chrome's built-in AI. */
  aiVerify: boolean;
  /** How many top items to verify/summarize with the built-in model. */
  aiVerifyTopN: number;
  /** Color theme: follow OS ("auto"), or force "dark"/"light". */
  theme: "auto" | "dark" | "light";
  /** Card grid density on the full page. */
  density: "comfortable" | "cozy" | "compact";
  /** Translate card descriptions to this language via Chrome's built-in
   *  Translator API. "off" disables translation; otherwise a BCP-47 code. */
  translateTo: string;
  /** Sort order for repository results. */
  sortBy: "momentum" | "stars" | "forks" | "updated";
}

export const DEFAULT_SETTINGS: AppSettings = {
  cacheTtlMinutes: 30,
  aiVerify: false,
  aiVerifyTopN: 15,
  theme: "auto",
  density: "comfortable",
  translateTo: "off",
  sortBy: "momentum",
};
