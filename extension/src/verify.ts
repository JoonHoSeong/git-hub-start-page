/**
 * On-device relevance filtering + one-line summaries using Chrome's built-in
 * Prompt API (LanguageModel / Gemini Nano, Chrome desktop 138+ in extensions).
 * No API key, no server, no per-card network calls — runs locally.
 *
 * Docs: https://developer.chrome.com/docs/ai/prompt-api
 */

import type { RadarItem, TopicRecipe } from "./types.js";

// Minimal typings for the built-in LanguageModel global.
interface AiMonitor {
  addEventListener(type: "downloadprogress", cb: (e: { loaded: number }) => void): void;
}
interface AiSession {
  prompt(input: string, opts?: { responseConstraint?: unknown }): Promise<string>;
  destroy(): void;
}
interface LanguageModelFactory {
  availability(): Promise<string>;
  create(opts?: { monitor?: (m: AiMonitor) => void }): Promise<AiSession>;
}

function getLanguageModel(): LanguageModelFactory | null {
  return "LanguageModel" in self
    ? ((self as unknown as { LanguageModel: LanguageModelFactory }).LanguageModel)
    : null;
}

/** True if Chrome's built-in Prompt API is present. */
export function isBuiltinAiSupported(): boolean {
  return getLanguageModel() !== null;
}

/** JSON schema constraining the model to a relevance verdict + short summary. */
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["relevant", "summary"],
} as const;

let sessionPromise: Promise<AiSession | null> | null = null;

async function getSession(): Promise<AiSession | null> {
  const factory = getLanguageModel();
  if (!factory) return null;
  if (!sessionPromise) {
    sessionPromise = (async () => {
      try {
        const avail = await factory.availability();
        if (avail === "unavailable") return null;
        return await factory.create();
      } catch {
        return null;
      }
    })();
  }
  return sessionPromise;
}

/**
 * Verify + summarize the top-N items with the built-in model. Mutates items:
 * sets `relevant` and `summary`. Items beyond topN are left untouched.
 * Silently no-ops when the built-in model is unavailable.
 */
export async function verifyWithBuiltinAi(
  items: RadarItem[],
  topic: TopicRecipe,
  topN: number,
): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const targets = items.slice(0, topN);
  const keywords = [...topic.include, ...topic.githubTopics].join(", ");

  // Process sequentially (the model runs one prompt at a time). Callers render
  // originals first and let this fill in verdicts/summaries progressively.
  for (const item of targets) {
    const prompt =
      `Topic: "${topic.name}" (keywords: ${keywords}).\n` +
      `Repository: ${item.repoFullName}\n` +
      `Description: ${item.description || "(none)"}\n\n` +
      `Is this repository genuinely about the topic above? ` +
      `Reply with JSON: {"relevant": boolean, "summary": "one short sentence in Korean"}.`;
    try {
      const raw = await session.prompt(prompt, { responseConstraint: RESULT_SCHEMA });
      const parsed = JSON.parse(raw) as { relevant?: boolean; summary?: string };
      if (typeof parsed.relevant === "boolean") item.relevant = parsed.relevant;
      if (typeof parsed.summary === "string") item.summary = parsed.summary;
    } catch {
      // Leave this item unverified on any failure.
    }
  }
}
