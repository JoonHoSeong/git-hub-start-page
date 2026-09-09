import type { LlmSettings, RadarItem, TopicRecipe } from "./types.js";

interface ChatResponse {
  choices: { message: { content: string } }[];
}

/**
 * Verify relevance and produce a one-line Korean summary for the top-N items,
 * using any OpenAI-compatible endpoint (OpenAI, Ollama, Groq, etc.).
 * Returns items enriched with `summary` and `relevant`. On error, returns the
 * input unchanged so the free tier still works.
 */
export async function enrichWithLlm(
  items: RadarItem[],
  topic: TopicRecipe,
  settings: LlmSettings,
  topN: number,
): Promise<RadarItem[]> {
  if (!settings.apiKey && !isLocal(settings.baseUrl)) return items;
  const targets = items.slice(0, topN);
  if (targets.length === 0) return items;

  const prompt = buildPrompt(targets, topic);

  try {
    const res = await fetch(`${trimSlash(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a precise curator of GitHub projects. Judge whether each item truly belongs to the given topic, and write a concise one-line Korean summary. Respond ONLY with JSON.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return items;
    const data = (await res.json()) as ChatResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    applyVerdicts(targets, content);
  } catch {
    // Network/CORS/provider error -> keep free-tier results untouched.
    return items;
  }
  return items;
}

function isLocal(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1/.test(baseUrl);
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function buildPrompt(items: RadarItem[], topic: TopicRecipe): string {
  const list = items
    .map(
      (it, idx) =>
        `${idx}. [${it.kind}] ${it.repoFullName} — ${it.title}\n   desc: ${it.description.slice(0, 200)}`,
    )
    .join("\n");
  return [
    `Topic: "${topic.name}" (keywords: ${[...topic.include, ...topic.githubTopics].join(", ")})`,
    "",
    "Items:",
    list,
    "",
    'Return JSON: {"results":[{"index":0,"relevant":true,"summary":"한 줄 한국어 요약"}, ...]}',
  ].join("\n");
}

function applyVerdicts(items: RadarItem[], content: string): void {
  const json = extractJson(content);
  if (!json) return;
  try {
    const parsed = JSON.parse(json) as {
      results?: { index: number; relevant?: boolean; summary?: string }[];
    };
    for (const r of parsed.results ?? []) {
      const target = items[r.index];
      if (!target) continue;
      if (typeof r.relevant === "boolean") target.relevant = r.relevant;
      if (typeof r.summary === "string") target.summary = r.summary;
    }
  } catch {
    // Ignore malformed JSON; leave items as-is.
  }
}

/** Extract the first JSON object from a possibly fenced/prefixed string. */
function extractJson(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  return null;
}
