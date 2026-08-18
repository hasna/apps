/**
 * MON-V2-09 — Knowledge native adapter regression tests.
 *
 * Gate: tests use `client.search` and `client.items.create`; query and
 * creation are separately represented; no direct database or HTTP path exists.
 *
 * The adapter is exercised with a mock `KnowledgeClient` whose `search` and
 * `items.create` are the only surfaces available, plus a global `fetch` spy
 * that must never fire — proving the adapter reaches the knowledge corpus only
 * through the package-owned SDK client, never through direct HTTP or a
 * database import.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import type { KnowledgeClient } from "@hasna/knowledge/sdk";
import {
  createKnowledgeAdapter,
  type KnowledgeAdapter,
  type KnowledgeIntegrationConfig,
} from "./knowledge.js";

function searchEntry(overrides: Partial<{ id: string; title: string; text: string; kind: string; score: number }> = {}) {
  return {
    kind: overrides.kind ?? "knowledge_index",
    id: overrides.id ?? "k_item_1",
    title: overrides.title ?? "Found item",
    text: overrides.text ?? "excerpt",
    score: overrides.score ?? 0.9,
    scores: { keyword: 0.9 },
    source: { uri: null, ref: null, kind: null, revision: null },
  };
}

function searchResult(entries = [searchEntry()]) {
  return {
    query: "healthcheck",
    limit: 5,
    offset: 0,
    mode: { keyword: true, catalog: true, semantic: false },
    semantic_provider: null,
    semantic_model: null,
    semantic_dimensions: null,
    counts: {
      keyword_results: entries.length,
      catalog_results: 0,
      semantic_results: 0,
      merged_results: entries.length,
    },
    warnings: [],
    results: entries,
  };
}

function createdItem(overrides: Partial<{ id: string; title: string }> = {}) {
  return {
    id: overrides.id ?? "k_item_new",
    title: overrides.title ?? "Monitor finding",
    content: "content",
    tags: ["monitor"],
  };
}

interface Harness {
  client: KnowledgeClient;
  adapter: KnowledgeAdapter;
  searchCalls: { options: { query: string; limit?: number; offset?: number } }[];
  createCalls: { input: { id?: string; title: string; content: string; tags?: string[]; metadata?: Record<string, unknown> } }[];
}

function makeHarness(config: KnowledgeIntegrationConfig = {}): Harness {
  const searchCalls: Harness["searchCalls"] = [];
  const createCalls: Harness["createCalls"] = [];
  const search = mock(async (options: { query: string; limit?: number; offset?: number }) => {
    searchCalls.push({ options });
    return searchResult();
  });
  const create = mock(async (input: { id?: string; title: string; content: string; tags?: string[]; metadata?: Record<string, unknown> }) => {
    createCalls.push({ input });
    return createdItem({ id: input.id ?? "k_item_new", title: input.title });
  });
  const client = {
    search,
    items: { create },
  } as unknown as KnowledgeClient;
  return { client, adapter: createKnowledgeAdapter(client, config), searchCalls, createCalls };
}

describe("knowledge adapter", () => {
  test("query calls client.search and maps the result", async () => {
    const { adapter, searchCalls } = makeHarness();
    const outcome = await adapter.query({ query: "healthcheck", limit: 5 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]?.options.query).toBe("healthcheck");
    expect(searchCalls[0]?.options.limit).toBe(5);
    expect(outcome.value.query).toBe("healthcheck");
    expect(outcome.value.count).toBe(1);
    expect(outcome.value.results[0]).toEqual({
      id: "k_item_1",
      title: "Found item",
      text: "excerpt",
      kind: "knowledge_index",
      score: 0.9,
    });
  });

  test("query does not create anything", async () => {
    const { adapter, createCalls } = makeHarness();
    await adapter.query({ query: "healthcheck" });
    expect(createCalls).toHaveLength(0);
  });

  test("create calls client.items.create with the payload", async () => {
    const { adapter, createCalls } = makeHarness();
    const outcome = await adapter.create({
      title: "Monitor finding",
      content: "observed value exceeded threshold",
      tags: ["monitor", "drift"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.input.title).toBe("Monitor finding");
    expect(createCalls[0]?.input.content).toBe("observed value exceeded threshold");
    expect(createCalls[0]?.input.tags).toEqual(["monitor", "drift"]);
    expect(outcome.value).toEqual({ id: "k_item_new", title: "Monitor finding" });
  });

  test("create does not run a search", async () => {
    const { adapter, searchCalls } = makeHarness();
    await adapter.create({ title: "Monitor finding", content: "body" });
    expect(searchCalls).toHaveLength(0);
  });

  test("config tags are merged onto created items", async () => {
    const { adapter, createCalls } = makeHarness({ tags: ["config-tag"] });
    const outcome = await adapter.create({ title: "Monitor finding", content: "body", tags: ["run-tag"] });
    expect(outcome.ok).toBe(true);
    expect(createCalls[0]?.input.tags).toEqual(["config-tag", "run-tag"]);
  });

  test("config collectionId is carried on created item metadata", async () => {
    const { adapter, createCalls } = makeHarness({ collectionId: "col_monitor" });
    const outcome = await adapter.create({ title: "Monitor finding", content: "body" });
    expect(outcome.ok).toBe(true);
    expect(createCalls[0]?.input.metadata).toEqual({ collectionId: "col_monitor" });
  });

  test("a stable caller-supplied id is passed through for idempotent upsert", async () => {
    const { adapter, createCalls } = makeHarness();
    const outcome = await adapter.create({
      id: "eff_knowledge_abc123",
      title: "Monitor finding",
      content: "body",
    });
    expect(outcome.ok).toBe(true);
    expect(createCalls[0]?.input.id).toBe("eff_knowledge_abc123");
  });

  test("non-fatal: a search failure returns a failed outcome instead of throwing", async () => {
    const { client, adapter } = makeHarness();
    (client.search as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error("search unavailable");
    });
    const outcome = await adapter.query({ query: "healthcheck" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("search unavailable");
  });

  test("non-fatal: a create failure returns a failed outcome instead of throwing", async () => {
    const { client, adapter } = makeHarness();
    (client.items.create as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error("creation rejected");
    });
    const outcome = await adapter.create({ title: "Monitor finding", content: "body" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("creation rejected");
  });

  test("no direct HTTP path: global fetch is never invoked by the adapter", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new Error("direct HTTP must not be used");
    }) as unknown as typeof fetch);
    try {
      const { adapter } = makeHarness();
      await adapter.query({ query: "healthcheck" });
      await adapter.create({ title: "Monitor finding", content: "body" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
