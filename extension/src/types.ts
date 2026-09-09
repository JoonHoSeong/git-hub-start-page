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
  /** True for built-in presets (still user-editable/removable). */
  isPreset: boolean;
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

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppSettings {
  llm: LlmSettings;
  /** Default sources applied to newly created topics. */
  defaultSources: TopicSources;
  /** Cache time-to-live in minutes. */
  cacheTtlMinutes: number;
  /** How many top items to send through the LLM tier. */
  llmTopN: number;
  /** Open the full page automatically when the browser starts. */
  openOnStartup: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" },
  defaultSources: { repositories: true, issues: false, pullRequests: false },
  cacheTtlMinutes: 30,
  llmTopN: 15,
  openOnStartup: true,
};
