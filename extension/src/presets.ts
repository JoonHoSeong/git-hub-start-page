import type { TopicRecipe } from "./types.js";

/**
 * Built-in tuned presets. Users can edit or delete these.
 * githubTopics carry the strongest precision; include/exclude refine text search.
 */
export const DEFAULT_TOPICS: TopicRecipe[] = [
  {
    id: "preset-llm",
    name: "LLM",
    include: ["llm", "large language model"],
    exclude: ["course", "tutorial-list", "awesome-list"],
    githubTopics: ["llm", "large-language-models"],
    minStars: 10,
    recentDays: 90,
    sources: { repositories: true, issues: false, pullRequests: false },
    isPreset: true,
  },
  {
    id: "preset-mcp",
    name: "MCP",
    include: ["model context protocol", "mcp server", "mcp client"],
    exclude: ["minecraft", "minecraft-mod", "management control panel"],
    githubTopics: ["model-context-protocol", "mcp-server", "mcp"],
    minStars: 5,
    recentDays: 90,
    sources: { repositories: true, issues: false, pullRequests: false },
    isPreset: true,
  },
  {
    id: "preset-skills",
    name: "Skills",
    include: ["agent skills", "ai agent skills", "claude skills"],
    exclude: ["resume", "game", "soft skills", "interview"],
    githubTopics: ["agent-skills", "claude-skills"],
    minStars: 5,
    recentDays: 90,
    sources: { repositories: true, issues: false, pullRequests: false },
    isPreset: true,
  },
];
