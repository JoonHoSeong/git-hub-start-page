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
  /** Which GitHub content sources to include for this topic. */
  sources: TopicSources;
  /** Optional finer-grained sub-filters shown as chips within the topic. */
  subtopics?: Subtopic[];
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

export interface TopicSources {
  repositories: boolean;
  issues: boolean;
  pullRequests: boolean;
}

export type SourceKind = "repository" | "issue" | "pull_request";

/** A normalized result item, unified across repos / issues / PRs. */
export interface RadarItem {
  id: string;
  kind: SourceKind;
  title: string;
  /** owner/name for repos, or repo full name for issues/PRs. */
  repoFullName: string;
  url: string;
  description: string;
  stars: number;
  /** Fork count (0 for issues/PRs). */
  forks: number;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last activity (push or update). */
  updatedAt: string;
  /** Issue/PR discussion signals (0 for repos). */
  comments: number;
  reactions: number;
  /** GitHub official topic tags on the repo (when available). */
  topics: string[];
  /** Computed momentum score (higher = hotter). Set by the ranker. */
  score: number;
  /** Optional LLM-generated one-line summary (high-quality tier). */
  summary?: string;
  /** Optional LLM relevance verdict (high-quality tier). */
  relevant?: boolean;
}

export interface AppSettings {
  /** Default sources applied to newly created topics. */
  defaultSources: TopicSources;
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
  defaultSources: { repositories: true, issues: false, pullRequests: false },
  cacheTtlMinutes: 30,
  aiVerify: false,
  aiVerifyTopN: 15,
  theme: "auto",
  density: "comfortable",
  translateTo: "off",
  sortBy: "momentum",
};
