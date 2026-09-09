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
    subtopics: [
      { id: "inference", name: "추론·서빙", githubTopics: ["llm-inference", "inference", "llm-serving"] },
      { id: "rag", name: "RAG", githubTopics: ["rag", "retrieval-augmented-generation"] },
      { id: "finetune", name: "파인튜닝", githubTopics: ["fine-tuning", "llm-training", "lora"] },
      { id: "agent", name: "에이전트", githubTopics: ["llm-agent", "ai-agent", "agents"] },
      { id: "app", name: "앱·챗", githubTopics: ["chatbot", "llm-app", "chatgpt"] },
    ],
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
    subtopics: [
      { id: "server", name: "서버", githubTopics: ["mcp-server", "mcp-servers"] },
      { id: "client", name: "클라이언트", githubTopics: ["mcp-client"] },
      { id: "framework", name: "프레임워크·SDK", githubTopics: ["mcp-framework", "mcp-sdk"] },
      { id: "registry", name: "레지스트리·목록", githubTopics: ["mcp-registry", "awesome-mcp"] },
    ],
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
    subtopics: [
      { id: "claude", name: "Claude Skills", githubTopics: ["claude-skills"] },
      { id: "agent", name: "에이전트 스킬", githubTopics: ["agent-skills"] },
      { id: "tools", name: "툴·플러그인", githubTopics: ["ai-tools", "agent-tools", "llm-tools"] },
    ],
    isPreset: true,
  },
];
