/**
 * MON-V2-09 — Knowledge native adapter regression tests.
 *
 * Gate: tests use `client.search` and `client.items`; query and creation are
 * separately represented; no direct database or HTTP path exists.
 *
 * The adapter is exercised with a mock `KnowledgeClient` whose `search`,
 * `items.get`, `items.update` and `items.create` are the surfaces the adapter
 * is allowed to touch, plus a global `fetch` spy that must never fire —
 * proving the adapter reaches the knowledge corpus only through the
 * package-owned SDK client, never through direct HTTP or a database import.
 *
 * Remediation regression coverage (codewith sol review, PR #484):
 * - failure classification: every failed outcome carries `last_error_class`
 *   from `not_found | timeout | execution_error | invalid_input | unknown`;
 * - stable-effect-id idempotency: `create({ id })` looks the id up first and
 *   updates the existing item instead of duplicating (the local transport's
 *   `items.create` appends without an existing-id lookup);
 * - bounded records: title/content/tags/metadata and failure messages are
 *   bounded, and credential-prefix values plus sensitive metadata keys are
 *   redacted before they can persist.
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

function item(overrides: Partial<{ id: string; title: string; content: string; tags: string[]; metadata: Record<string, unknown> }> = {}) {
  return {
    id: overrides.id ?? "k_item_new",
    title: overrides.title ?? "Monitor finding",
    content: overrides.content ?? "content",
    tags: overrides.tags ?? ["monitor"],
    metadata: overrides.metadata ?? {},
  };
}

interface Harness {
  client: KnowledgeClient;
  adapter: KnowledgeAdapter;
  searchCalls: { options: { query: string; limit?: number; offset?: number } }[];
  getCalls: string[];
  updateCalls: { idOrShort: string; patch: { title: string; content: string; tags: string[]; metadata: Record<string, unknown> } }[];
  createCalls: { input: { id?: string; title: string; content: string; tags: string[]; metadata: Record<string, unknown> } }[];
  /** Set the item `items.get` returns (null = not found). */
  setExisting: (existing: ReturnType<typeof item> | null) => void;
  /** Set `items.update` to return null (simulated get/update race). */
  setUpdateMisses: (miss: boolean) => void;
}

function makeHarness(config: KnowledgeIntegrationConfig = {}): Harness {
  const searchCalls: Harness["searchCalls"] = [];
  const getCalls: Harness["getCalls"] = [];
  const updateCalls: Harness["updateCalls"] = [];
  const createCalls: Harness["createCalls"] = [];

  let existing: ReturnType<typeof item> | null = null;
  let updateMisses = false;

  const search = mock(async (options: { query: string; limit?: number; offset?: number }) => {
    searchCalls.push({ options });
    return searchResult();
  });
  const get = mock(async (idOrShort: string) => {
    getCalls.push(idOrShort);
    return existing;
  });
  const update = mock(async (idOrShort: string, patch: { title: string; content: string; tags: string[]; metadata: Record<string, unknown> }) => {
    updateCalls.push({ idOrShort, patch });
    return updateMisses ? null : item({ id: idOrShort, ...patch });
  });
  const create = mock(async (input: { id?: string; title: string; content: string; tags: string[]; metadata: Record<string, unknown> }) => {
    createCalls.push({ input });
    return item({ id: input.id ?? "k_item_new", title: input.title });
  });
  const client = {
    search,
    items: { create, get, update },
  } as unknown as KnowledgeClient;
  return {
    client,
    adapter: createKnowledgeAdapter(client, config),
    searchCalls,
    getCalls,
    updateCalls,
    createCalls,
    setExisting: (next) => {
      existing = next;
    },
    setUpdateMisses: (miss) => {
      updateMisses = miss;
    },
  };
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

  test("create calls client.items.create with the bounded payload", async () => {
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

  // -------------------------------------------------------------------------
  // Stable-effect-id idempotency (P1): the local transport's items.create
  // appends without an existing-id lookup, so the adapter must deduplicate.
  // -------------------------------------------------------------------------

  test("create with a stable id and no existing item looks up, then creates with the id", async () => {
    const { adapter, getCalls, createCalls, updateCalls } = makeHarness();
    const outcome = await adapter.create({
      id: "eff_knowledge_abc123",
      title: "Monitor finding",
      content: "body",
    });
    expect(outcome.ok).toBe(true);
    expect(getCalls).toEqual(["eff_knowledge_abc123"]);
    expect(updateCalls).toHaveLength(0);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.input.id).toBe("eff_knowledge_abc123");
  });

  test("create with a stable id and an existing item updates it instead of duplicating", async () => {
    const { adapter, setExisting, getCalls, updateCalls, createCalls } = makeHarness();
    setExisting(item({ id: "eff_knowledge_abc123", title: "Monitor finding (previous)" }));
    const outcome = await adapter.create({
      id: "eff_knowledge_abc123",
      title: "Monitor finding",
      content: "body",
      tags: ["run-tag"],
      metadata: { run_id: 7 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(getCalls).toEqual(["eff_knowledge_abc123"]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.idOrShort).toBe("eff_knowledge_abc123");
    expect(updateCalls[0]?.patch.title).toBe("Monitor finding");
    expect(updateCalls[0]?.patch.content).toBe("body");
    expect(updateCalls[0]?.patch.tags).toEqual(["run-tag"]);
    expect(updateCalls[0]?.patch.metadata).toEqual({ run_id: 7 });
    expect(createCalls).toHaveLength(0);
    expect(outcome.value.id).toBe("eff_knowledge_abc123");
  });

  test("create without a stable id never consults the SDK id lookup", async () => {
    const { adapter, getCalls } = makeHarness();
    await adapter.create({ title: "Monitor finding", content: "body" });
    expect(getCalls).toHaveLength(0);
  });

  test("an item deleted between get and update is recreated, not lost", async () => {
    const { adapter, setExisting, setUpdateMisses, getCalls, updateCalls, createCalls } = makeHarness();
    setExisting(item({ id: "eff_knowledge_abc123" }));
    setUpdateMisses(true);
    const outcome = await adapter.create({
      id: "eff_knowledge_abc123",
      title: "Monitor finding",
      content: "body",
    });
    expect(outcome.ok).toBe(true);
    expect(getCalls).toEqual(["eff_knowledge_abc123"]);
    expect(updateCalls).toHaveLength(1);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.input.id).toBe("eff_knowledge_abc123");
  });

  // -------------------------------------------------------------------------
  // Failure classification (P1): every failed outcome carries last_error_class.
  // -------------------------------------------------------------------------

  test("non-fatal: a search failure returns a failed outcome with execution_error", async () => {
    const { client, adapter } = makeHarness();
    (client.search as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error("search unavailable");
    });
    const outcome = await adapter.query({ query: "healthcheck" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("search unavailable");
    expect(outcome.last_error_class).toBe("execution_error");
  });

  test("non-fatal: a create failure returns a failed outcome with execution_error", async () => {
    const { client, adapter } = makeHarness();
    (client.items.create as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error("creation rejected");
    });
    const outcome = await adapter.create({ title: "Monitor finding", content: "body" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("creation rejected");
    expect(outcome.last_error_class).toBe("execution_error");
  });

  test("a not-found failure is classified not_found", async () => {
    const { client, adapter } = makeHarness();
    (client.items.create as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error("knowledge item not found: k_missing");
    });
    const outcome = await adapter.create({ title: "Monitor finding", content: "body" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.last_error_class).toBe("not_found");
  });

  test("a timeout failure is classified timeout", async () => {
    const { client, adapter } = makeHarness();
    (client.search as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    const outcome = await adapter.query({ query: "healthcheck" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.last_error_class).toBe("timeout");
  });

  test("an invalid-input failure is classified invalid_input", async () => {
    const { client, adapter } = makeHarness();
    (client.items.create as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      const err = new Error("Expected string, received number");
      err.name = "ZodError";
      throw err;
    });
    const outcome = await adapter.create({ title: "Monitor finding", content: "body" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.last_error_class).toBe("invalid_input");
  });

  test("a non-Error throwable is classified unknown", async () => {
    const { client, adapter } = makeHarness();
    (client.search as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      // eslint-disable-next-line no-throw-literal
      throw "raw string failure";
    });
    const outcome = await adapter.query({ query: "healthcheck" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.last_error_class).toBe("unknown");
  });

  test("failure messages are bounded", async () => {
    const { client, adapter } = makeHarness();
    (client.search as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error("x".repeat(5000));
    });
    const outcome = await adapter.query({ query: "healthcheck" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.length).toBeLessThanOrEqual(2000);
  });

  // -------------------------------------------------------------------------
  // Bounded records (P1): no raw or unbounded payload reaches persistence.
  // -------------------------------------------------------------------------

  test("oversized content is truncated to the byte bound", async () => {
    const { adapter, createCalls } = makeHarness();
    const oversized = "a".repeat(70_000);
    const outcome = await adapter.create({ title: "Monitor finding", content: oversized });
    expect(outcome.ok).toBe(true);
    expect(Buffer.byteLength(createCalls[0]?.input.content ?? "", "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(createCalls[0]?.input.content).not.toBe(oversized);
  });

  test("credential-prefix values are redacted from content and metadata strings", async () => {
    const { adapter, createCalls } = makeHarness();
    // Assembled at runtime so no literal token shape is committed (the staged
    // secrets scan flags literal shapes in fixtures — measured); the redactor
    // under test must still catch the assembled value.
    const antKey = ["sk", "-ant-api03-", "abcdefghijklm1234567890"].join("");
    const projKey = ["sk", "-proj-", "ABCDEFGHIJKLMNOPQRST1234567890"].join("");
    const outcome = await adapter.create({
      title: "Monitor finding",
      content: `saw ${antKey} in output`,
      metadata: { provider_key: projKey, run_id: 3 },
    });
    expect(outcome.ok).toBe(true);
    expect(createCalls[0]?.input.content).toContain("[REDACTED]");
    expect(createCalls[0]?.input.content).not.toContain("sk-ant-");
    expect(createCalls[0]?.input.metadata.provider_key).toBe("[REDACTED]");
  });

  test("sensitive metadata keys are redacted regardless of value", async () => {
    const { adapter, createCalls } = makeHarness();
    // Assembled at runtime — see the note in the credential-prefix test.
    const npmToken = ["npm_", "0123456789ABCDEFGHIJKLMNOP"].join("");
    await adapter.create({
      title: "Monitor finding",
      content: "body",
      metadata: { token: npmToken, password: "hunter2", run_id: 3 },
    });
    expect(createCalls[0]?.input.metadata.token).toBe("[REDACTED]");
    expect(createCalls[0]?.input.metadata.password).toBe("[REDACTED]");
    expect(createCalls[0]?.input.metadata.run_id).toBe(3);
  });

  test("metadata is allowlisted to primitives, bounded in count and length", async () => {
    const { adapter, createCalls } = makeHarness();
    const metadata: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) metadata[`key_${i}`] = "v";
    metadata.nested = { deep: true };
    metadata.long = "y".repeat(2000);
    await adapter.create({ title: "Monitor finding", content: "body", metadata });
    const persisted = createCalls[0]?.input.metadata ?? {};
    expect(Object.keys(persisted).length).toBeLessThanOrEqual(32);
    expect(persisted.nested).toBeUndefined();
    expect(String(persisted.long).length).toBeLessThanOrEqual(512);
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
