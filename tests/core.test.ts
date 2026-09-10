import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRepoQuery,
  buildTopicQueries,
  recentCutoff,
  repoSearchUrl,
} from "../extension/src/query-builder.ts";
import { computeScore, rankItems, applyExclusions, sortItems } from "../extension/src/ranking.ts";
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

test("buildTopicQueries yields one precise query per topic tag with qualifiers only", () => {
  const queries = buildTopicQueries(mcp, NOW);
  assert.equal(queries.length, 2, "one per githubTopic");
  assert.ok(queries[0].startsWith("topic:mcp"), "first topic");
  assert.ok(queries.every((q) => q.includes("stars:>=5")), "carries min stars");
  // Text exclusions must NOT be in the query (they zero out topic-only search).
  assert.ok(queries.every((q) => !q.includes("-minecraft")), "no text exclusions in query");
});

test("recentCutoff computes date N days before now", () => {
  assert.equal(recentCutoff(30, NOW), "2026-08-10");
  assert.equal(recentCutoff(1, NOW), "2026-09-08");
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
    title: "t",
    repoFullName: "o/r",
    url: "https://github.com/o/r",
    description: "",
    stars: 0,
    forks: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
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

test("computeScore rewards a measured recent trend", () => {
  const base = {
    stars: 500,
    createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    updatedAt: NOW.toISOString(),
    topics: ["mcp"],
  };
  const rising = item({ ...base, id: "rising", trend: 80 }); // +80 stars/day measured
  const flat = item({ ...base, id: "flat" }); // no trend observed
  assert.ok(
    computeScore(rising, mcp, NOW) > computeScore(flat, mcp, NOW),
    "measured trend should rank a repo higher than an identical one without trend",
  );
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

test("applyExclusions drops items matching exclude terms across name/desc/topics", () => {
  const items = [
    item({ id: "keep", repoFullName: "acme/mcp-gateway", description: "an MCP server" }),
    item({ id: "drop-name", repoFullName: "mojang/minecraft-mcp", description: "bridge" }),
    item({ id: "drop-desc", repoFullName: "acme/thing", description: "a Minecraft mod using mcp" }),
  ];
  const out = applyExclusions(items, mcp); // mcp.exclude includes "minecraft"
  const ids = out.map((i) => i.id);
  assert.deepEqual(ids, ["keep"], `only non-excluded kept, got: ${ids.join(",")}`);
});

test("applyExclusions is a no-op when there are no exclude terms", () => {
  const noExclude: TopicRecipe = { ...mcp, exclude: [] };
  const items = [item({ id: "a" }), item({ id: "b" })];
  const out = applyExclusions(items, noExclude);
  assert.equal(out.length, 2);
});

test("sortItems orders by stars, forks, and updated (descending)", () => {
  const a = item({ id: "a", stars: 100, forks: 5, updatedAt: "2026-01-01T00:00:00Z" });
  const b = item({ id: "b", stars: 50, forks: 40, updatedAt: "2026-09-01T00:00:00Z" });
  const c = item({ id: "c", stars: 200, forks: 10, updatedAt: "2026-05-01T00:00:00Z" });

  const byStars = sortItems([...[a, b, c]], mcp, "stars", NOW).map((i) => i.id);
  assert.deepEqual(byStars, ["c", "a", "b"], "stars desc");

  const byForks = sortItems([...[a, b, c]], mcp, "forks", NOW).map((i) => i.id);
  assert.deepEqual(byForks, ["b", "c", "a"], "forks desc");

  const byUpdated = sortItems([...[a, b, c]], mcp, "updated", NOW).map((i) => i.id);
  assert.deepEqual(byUpdated, ["b", "c", "a"], "most recently updated first");
});
