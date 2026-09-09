import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRepoQuery,
  buildIssueQuery,
  buildTopicQueries,
  recentCutoff,
  repoSearchUrl,
} from "../extension/src/query-builder.ts";
import { computeScore, rankItems } from "../extension/src/ranking.ts";
import type { RadarItem, TopicRecipe } from "../extension/src/types.ts";

const NOW = new Date("2026-09-09T00:00:00Z");

const mcp: TopicRecipe = {
  id: "preset-mcp",
  name: "MCP",
  include: ["model context protocol", "mcp server"],
  exclude: ["minecraft"],
  githubTopics: ["mcp", "model-context-protocol"],
  minStars: 5,
  recentDays: 90,
  sources: { repositories: true, issues: true, pullRequests: true },
  isPreset: true,
};

test("buildRepoQuery uses OR-ed text terms and does NOT AND multiple topics (avoids zero results)", () => {
  const q = buildRepoQuery(mcp, NOW);
  // Text include terms are the main matcher, OR-ed together.
  assert.ok(q.includes('("model context protocol" OR "mcp server")'), "OR-ed quoted phrases");
  // Must not AND multiple topic: qualifiers (that collapses to 0 results).
  const topicCount = (q.match(/topic:/g) ?? []).length;
  assert.ok(topicCount === 0, `no hard topic filter when text present, got: ${q}`);
  assert.ok(q.includes("-minecraft"), "excludes minecraft");
  assert.ok(q.includes("stars:>=5"), "min stars");
  assert.ok(q.includes("pushed:>2026-06-11"), `recent cutoff, got: ${q}`);
});

test("buildRepoQuery falls back to a single topic when no include text", () => {
  const noText: TopicRecipe = { ...mcp, include: [] };
  const q = buildRepoQuery(noText, NOW);
  const topicCount = (q.match(/topic:/g) ?? []).length;
  assert.equal(topicCount, 1, `exactly one topic qualifier, got: ${q}`);
  assert.ok(q.includes("topic:mcp"), "uses first topic");
});

test("buildTopicQueries yields one precise query per topic tag with filters", () => {
  const queries = buildTopicQueries(mcp, NOW);
  assert.equal(queries.length, 2, "one per githubTopic");
  assert.ok(queries[0].startsWith("topic:mcp"), "first topic");
  assert.ok(queries.every((q) => q.includes("stars:>=5")), "carries min stars");
  assert.ok(queries.every((q) => q.includes("-minecraft")), "carries exclusions");
});

test("recentCutoff computes date N days before now", () => {
  assert.equal(recentCutoff(30, NOW), "2026-08-10");
  assert.equal(recentCutoff(1, NOW), "2026-09-08");
});

test("buildIssueQuery adds type and state qualifiers", () => {
  const issueQ = buildIssueQuery(mcp, "issue", NOW);
  assert.ok(issueQ.includes("type:issue"), "issue type");
  assert.ok(issueQ.includes("state:open"), "open state");
  assert.ok(issueQ.includes("updated:>2026-06-11"), "updated cutoff");

  const prQ = buildIssueQuery(mcp, "pr", NOW);
  assert.ok(prQ.includes("type:pr"), "pr type");
});

test("buildIssueQuery falls back to github topics when no include terms", () => {
  const noInclude: TopicRecipe = { ...mcp, include: [] };
  const q = buildIssueQuery(noInclude, "issue", NOW);
  assert.ok(q.includes("mcp") || q.includes("model context protocol"), `fallback text, got: ${q}`);
});

test("repoSearchUrl builds a valid encoded api.github.com URL", () => {
  const url = repoSearchUrl(mcp, 30, NOW);
  assert.ok(url.startsWith("https://api.github.com/search/repositories?"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("sort"), "stars");
  assert.equal(parsed.searchParams.get("per_page"), "30");
  assert.ok((parsed.searchParams.get("q") ?? "").includes("model context protocol"));
});

function item(partial: Partial<RadarItem>): RadarItem {
  return {
    id: "x",
    kind: "repository",
    title: "t",
    repoFullName: "o/r",
    url: "https://github.com/o/r",
    description: "",
    stars: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    comments: 0,
    reactions: 0,
    topics: [],
    score: 0,
    ...partial,
  };
}

test("computeScore rewards fast star velocity over old popular repos", () => {
  // Young repo, 300 stars in 10 days -> high velocity.
  const young = item({
    stars: 300,
    createdAt: new Date("2026-08-30T00:00:00Z").toISOString(),
    updatedAt: NOW.toISOString(),
    topics: ["mcp"],
  });
  // Old repo, 5000 stars over 5 years -> low velocity.
  const old = item({
    stars: 5000,
    createdAt: new Date("2021-09-09T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-06-01T00:00:00Z").toISOString(),
    topics: [],
  });
  const youngScore = computeScore(young, mcp, NOW);
  const oldScore = computeScore(old, mcp, NOW);
  assert.ok(youngScore > oldScore, `young(${youngScore.toFixed(1)}) > old(${oldScore.toFixed(1)})`);
});

test("computeScore gives a topic-accuracy bonus", () => {
  const withTopic = item({ stars: 100, topics: ["mcp"] });
  const withoutTopic = item({ stars: 100, topics: ["unrelated"] });
  assert.ok(computeScore(withTopic, mcp, NOW) > computeScore(withoutTopic, mcp, NOW));
});

test("rankItems sorts by descending score", () => {
  const items = [
    item({ id: "a", stars: 10, createdAt: new Date("2020-01-01").toISOString() }),
    item({ id: "b", stars: 500, createdAt: new Date("2026-09-01T00:00:00Z").toISOString(), topics: ["mcp"] }),
    item({ id: "c", stars: 50, createdAt: new Date("2026-08-01T00:00:00Z").toISOString() }),
  ];
  const ranked = rankItems(items, mcp, NOW);
  assert.equal(ranked[0].id, "b", "hottest first");
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, "monotonic descending");
  }
});
