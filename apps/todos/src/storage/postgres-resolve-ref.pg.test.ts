/**
 * REAL Postgres regression coverage for `resolveTaskRef` id-prefix collation.
 *
 * The unit suite exercises resolution on SQLite (v1.test.ts) and an in-memory
 * mock (storage.test.ts) — neither reproduces Postgres locale collation, where
 * the id-prefix RANGE must be byte-ordered (COLLATE "C"). Under the RDS-default
 * `en_US.utf8`, ':' sorts before '9', so a naive `object_id < prefix++` range
 * silently dropped every reference ending in '9' (and hyphen boundaries). This
 * test runs against a real Postgres and fails if that regression returns.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it; the
 * DB-backed testbox lane (and local runs) point it at an en_US.utf8 database:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest bun test src/storage/postgres-resolve-ref.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import {
  postgresTodosSyncSchemaSql,
  postgresTodosTaskShortIdIndexSql,
  postgresTodosTaskObjectIdIndexSql,
} from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-reftest-${process.pid}-${Date.now()}`;

describe.skipIf(!PG_URL)("postgres resolveTaskRef — real en_US.utf8 collation", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  const insert = async (objectId: string, shortId: string | null, extra: Record<string, unknown> = {}) => {
    const payload = {
      id: objectId,
      short_id: shortId,
      title: `task ${objectId}`,
      status: "pending",
      priority: "medium",
      parent_id: null,
      project_id: null,
      tags: [],
      metadata: {},
      version: 1,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
      ...extra,
    };
    // Pass the OBJECT (not JSON.stringify) so Bun.SQL stores a real jsonb object,
    // exactly like the adapter's jsonbParam — a stringified value becomes a jsonb
    // STRING scalar and every payload->>'field' filter silently misses.
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
       VALUES ($1, 'tasks', $2, $3::jsonb, now(), $4)
       ON CONFLICT (service, object_type, object_id) DO UPDATE SET payload = EXCLUDED.payload, deleted_at = EXCLUDED.deleted_at`,
      [SERVICE, objectId, payload, (extra as { _deleted?: boolean })._deleted ? new Date().toISOString() : null],
    );
  };

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    await client.query(postgresTodosTaskShortIdIndexSql());
    await client.query(postgresTodosTaskObjectIdIndexSql());
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });

    // Prefix ending in '9' — the exact case the naive locale range dropped.
    await insert("12345679-1111-4111-8111-111111111111", "PROJ-0009");
    // Hyphen boundary prefix.
    await insert("abcd0000-2222-4222-8222-222222222222", "PROJ-0002");
    // Legacy upper-case short_id with a non-hex leading char.
    await insert("cccccccc-3333-4333-8333-333333333333", "OPE2-00125");
    // Ambiguous prefix pair.
    await insert("dddddddd-0000-4000-8000-000000000001", "AMB-0001");
    await insert("dddddddd-0000-4000-8000-000000000002", "AMB-0002");
    // Tombstoned row must never resolve.
    await insert("eeeeeeee-0000-4000-8000-000000000009", "GONE-0009", { _deleted: true });

    // Seed enough rows (with real jsonb objects, server-side) that the planner
    // deterministically prefers the index for a selective range. With only a
    // handful of rows Postgres correctly chooses a seq scan, which made the plan
    // assertion flap. 'b'-prefixed ids/short_ids never collide with any test ref.
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at)
       SELECT $1, 'tasks',
              'b' || lpad(gs::text, 7, '0') || '-0000-4000-8000-000000000000',
              jsonb_build_object(
                'id', 'b' || lpad(gs::text, 7, '0') || '-0000-4000-8000-000000000000',
                'short_id', 'BULK-' || gs,
                'status', 'pending', 'parent_id', NULL, 'tags', '[]'::jsonb, 'version', 1
              ),
              now()
       FROM generate_series(1, 5000) AS gs`,
      [SERVICE],
    );
    await client.query("ANALYZE todos_sync_records");
  });

  afterAll(async () => {
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  test("resolves an id-prefix ending in '9' (the locale-collation regression)", async () => {
    const task = await store.tasks.resolveRef!("12345679");
    expect(task?.id).toBe("12345679-1111-4111-8111-111111111111");
  });

  test("resolves a single-char '9' prefix by byte order too", async () => {
    // Only one live task id starts with '1' here, so '1' is unambiguous.
    const task = await store.tasks.resolveRef!("1");
    expect(task?.id).toBe("12345679-1111-4111-8111-111111111111");
  });

  test("resolves a hyphen-boundary prefix", async () => {
    const task = await store.tasks.resolveRef!("abcd0000-");
    expect(task?.id).toBe("abcd0000-2222-4222-8222-222222222222");
  });

  test("resolves an exact full UUID via the range", async () => {
    const task = await store.tasks.resolveRef!("cccccccc-3333-4333-8333-333333333333");
    expect(task?.short_id).toBe("OPE2-00125");
  });

  test("resolves an upper-case short_id case-insensitively", async () => {
    expect((await store.tasks.resolveRef!("OPE2-00125"))?.id).toBe("cccccccc-3333-4333-8333-333333333333");
    expect((await store.tasks.resolveRef!("ope2-00125"))?.id).toBe("cccccccc-3333-4333-8333-333333333333");
  });

  test("throws on an ambiguous id-prefix", async () => {
    await expect(store.tasks.resolveRef!("dddddddd")).rejects.toThrow("ambiguous");
  });

  test("returns null for an unknown reference", async () => {
    expect(await store.tasks.resolveRef!("nope-99999")).toBeNull();
    expect(await store.tasks.resolveRef!("99999999")).toBeNull();
  });

  test("a pathological U+FFFF-terminated ref returns null, not a Postgres error", async () => {
    // Without the overflow guard the incremented upper bound wraps to U+0000 (a NUL
    // byte), which Postgres rejects in a text parameter — a 500 instead of a miss.
    expect(await store.tasks.resolveRef!("nope￿")).toBeNull();
  });

  test("never resolves a tombstoned task (by prefix or short_id)", async () => {
    expect(await store.tasks.resolveRef!("eeeeeeee")).toBeNull();
    expect(await store.tasks.resolveRef!("GONE-0009")).toBeNull();
  });

  test("the id-prefix range uses the COLLATE \"C\" index (stays bounded)", async () => {
    const plan = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT payload FROM todos_sync_records
        WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
          AND object_id COLLATE "C" >= $2 AND object_id COLLATE "C" < $3
        LIMIT 2`,
      [SERVICE, "12345679", "1234567:"],
    );
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(text.toLowerCase()).toContain("index");
    expect(text.toLowerCase()).not.toContain("seq scan");
  });
});
