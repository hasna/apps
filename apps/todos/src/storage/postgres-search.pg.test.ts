/**
 * REAL Postgres regression coverage for cloud/self-hosted full-text search.
 *
 * ROOT CAUSE guarded here: `searchTasks` (src/lib/search.ts) queries the local
 * bun:sqlite FTS5 index, which is EMPTY on a Postgres deployment — so cloud
 * search returned nothing. Search now runs through the storage abstraction
 * (`store.tasks.list({ query })`), which emits a weighted tsvector
 * `websearch_to_tsquery` predicate with a pg_trgm word-similarity fuzzy fallback
 * and ranks by `ts_rank_cd` (migrations/0006 + postgresTodosSyncSchemaSql).
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://user@127.0.0.1:5432/todos_search_test \
 *     bun test src/storage/postgres-search.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-searchtest-${process.pid}-${Date.now()}`;

describe.skipIf(!PG_URL)("postgres full-text search parity", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  const insert = async (
    id: string,
    title: string,
    description: string | null,
    tags: string[] = [],
    extra: Record<string, unknown> = {},
  ) => {
    const payload = {
      id,
      short_id: id.toUpperCase().slice(0, 8),
      title,
      description,
      tags,
      status: "pending",
      priority: "medium",
      parent_id: null,
      project_id: null,
      version: 1,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
      ...extra,
    };
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
       VALUES ($1, 'tasks', $2, $3::jsonb, now(), NULL)
       ON CONFLICT (service, object_type, object_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [SERVICE, id, payload],
    );
  };

  const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id).sort();

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });

    await insert("aaaa0001-0000-4000-8000-000000000001", "Fix login authentication bug", "users cannot log in", ["urgent", "auth"]);
    await insert("aaaa0002-0000-4000-8000-000000000002", "Add dashboard", "authentication metrics panel", []);
    await insert("aaaa0003-0000-4000-8000-000000000003", "Café menu redesign", "naive résumé polish", ["design"]);
    await insert("aaaa0004-0000-4000-8000-000000000004", "Unrelated chore", "cleanup the garage", ["home"]);
    await insert("aaaa0005-0000-4000-8000-000000000005", "Login rate limiting", "throttle brute force on login", ["auth"]);
    await client.query("ANALYZE todos_sync_records");
  });

  afterAll(async () => {
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  test("full-text query returns ONLY matching tasks (not empty, not all)", async () => {
    const results = await store.tasks.list({ query: "authentication" });
    expect(ids(results)).toEqual([
      "aaaa0001-0000-4000-8000-000000000001",
      "aaaa0002-0000-4000-8000-000000000002",
    ]);
  });

  test("ranks a title hit above a description-only hit (ts_rank_cd + weights)", async () => {
    const results = await store.tasks.list({ query: "authentication" });
    // Title match (weight A) must outrank the description-only match (weight B).
    expect(results[0]!.id).toBe("aaaa0001-0000-4000-8000-000000000001");
  });

  test("diacritics-insensitive: 'cafe' matches 'Café', 'resume' matches 'résumé'", async () => {
    expect(ids(await store.tasks.list({ query: "cafe" }))).toEqual(["aaaa0003-0000-4000-8000-000000000003"]);
    expect(ids(await store.tasks.list({ query: "resume" }))).toEqual(["aaaa0003-0000-4000-8000-000000000003"]);
  });

  test("typo/fuzzy via pg_trgm word-similarity fallback", async () => {
    const results = await store.tasks.list({ query: "authentcation" });
    expect(ids(results)).toContain("aaaa0001-0000-4000-8000-000000000001");
    expect(ids(results)).toContain("aaaa0002-0000-4000-8000-000000000002");
  });

  test("matches on tags (weight C)", async () => {
    expect(ids(await store.tasks.list({ query: "urgent" }))).toEqual(["aaaa0001-0000-4000-8000-000000000001"]);
  });

  test("multi-term query is AND by default (websearch semantics)", async () => {
    // Only task 1 has BOTH 'login' and 'authentication'.
    expect(ids(await store.tasks.list({ query: "login authentication" }))).toEqual([
      "aaaa0001-0000-4000-8000-000000000001",
    ]);
  });

  test("quoted phrase query", async () => {
    expect(ids(await store.tasks.list({ query: '"rate limiting"' }))).toEqual([
      "aaaa0005-0000-4000-8000-000000000005",
    ]);
  });

  test("punctuation-bearing query does not error and still matches", async () => {
    // websearch_to_tsquery tolerates punctuation instead of rejecting the query.
    const results = await store.tasks.list({ query: "log-in!" });
    expect(ids(results)).toContain("aaaa0001-0000-4000-8000-000000000001");
  });

  test("limit is honored", async () => {
    const results = await store.tasks.list({ query: "login", limit: 1 });
    expect(results).toHaveLength(1);
  });

  test("'*' sentinel is filter-only (returns all, does not error)", async () => {
    const results = await store.tasks.list({ query: "*" });
    expect(results.length).toBeGreaterThanOrEqual(5);
  });
});
