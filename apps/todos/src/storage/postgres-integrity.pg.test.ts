/**
 * REAL Postgres coverage for the referential-integrity report `todos doctor` uses.
 *
 * This is the half of the fix that a SQLite-only test cannot prove. The live
 * authority is Postgres, and Postgres mode is NOT relational: every entity is a
 * jsonb payload in one `todos_sync_records` table with NO foreign keys, so the
 * orphan classes SQLite forbids structurally are exactly the ones that accumulate
 * in production. A check implemented for one engine only reports healthy on the
 * other, and here the engine it would report healthy on is the one that actually
 * holds the rows. Neither plane is the reference implementation: both are asserted
 * against the shared condition spec, not against each other.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/todos_pg_test?sslmode=disable \
 *     bun test src/storage/postgres-integrity.pg.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { INTEGRITY_CONDITIONS } from "../lib/integrity.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-integrity-${process.pid}-${Date.now()}`;

const PROJECT_LIVE = "a0000000-0000-4000-8000-00000000000a";
const PROJECT_GHOST = "b0000000-0000-4000-8000-00000000000b";
const PROJECT_TOMBSTONED = "c0000000-0000-4000-8000-00000000000c";
const LIST_LIVE = "d0000000-0000-4000-8000-00000000000d";
const LIST_GHOST = "e0000000-0000-4000-8000-00000000000e";

describe.skipIf(!PG_URL)("postgres referential-integrity report", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  const insert = async (
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
    deleted = false,
  ): Promise<void> => {
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4::jsonb, now(), ${deleted ? "now()" : "NULL"})
       ON CONFLICT (service, object_type, object_id)
         DO UPDATE SET payload = EXCLUDED.payload, deleted_at = EXCLUDED.deleted_at`,
      [SERVICE, objectType, objectId, { id: objectId, ...payload }],
    );
  };

  const insertTask = (id: string, fields: Record<string, unknown>, deleted = false): Promise<void> =>
    insert("tasks", id, {
      short_id: `PG-${id.slice(0, 4)}`,
      title: "integrity fixture",
      status: "pending",
      priority: "medium",
      parent_id: null,
      project_id: null,
      task_list_id: null,
      tags: [],
      metadata: {},
      version: 1,
      created_at: "2026-07-27T00:00:00.000Z",
      updated_at: "2026-07-27T00:00:00.000Z",
      ...fields,
    }, deleted);

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });
  });

  afterAll(async () => {
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  beforeEach(async () => {
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
  });

  test("implements the integrity store (the Postgres half of the storage duality gate)", () => {
    expect(typeof store.integrity?.report).toBe("function");
  });

  test("reports every condition as zero on a clean dataset", async () => {
    await insert("projects", PROJECT_LIVE, { name: "Live", slug: "live", path: "/workspace/live" });
    await insert("task_lists", LIST_LIVE, { name: "Live list", slug: "live-list", project_id: PROJECT_LIVE });
    await insertTask("f0000000-0000-4000-8000-000000000001", { project_id: PROJECT_LIVE, task_list_id: LIST_LIVE });

    const report = await store.integrity!.report();
    expect(report.summary).toMatchObject({ ok: true, findings: 0, rows: 0, unverified: 0, complete: true });
    expect(report.conditions).toHaveLength(INTEGRITY_CONDITIONS.length);
    expect(report.conditions.every((condition) => condition.verified && condition.source === "postgres")).toBe(true);
  });

  test("counts all four live conditions with their open subtotals", async () => {
    await insert("projects", PROJECT_LIVE, { name: "Live", slug: "live", path: "/workspace/live" });
    await insert("task_lists", LIST_LIVE, { name: "Live list", slug: "live-list", project_id: PROJECT_LIVE });

    // Healthy control row.
    await insertTask("f0000000-0000-4000-8000-000000000001", { project_id: PROJECT_LIVE, task_list_id: LIST_LIVE });
    // Unrouted: one open, one completed — proves the open subtotal is a real filter.
    await insertTask("f0000000-0000-4000-8000-000000000002", { status: "pending" });
    await insertTask("f0000000-0000-4000-8000-000000000003", { status: "completed" });
    // Empty string must count as missing, exactly as on SQLite.
    await insertTask("f0000000-0000-4000-8000-000000000004", { project_id: "", task_list_id: "" });
    // Dangling references — impossible to create under a SQLite foreign key,
    // trivially possible here because Postgres mode has none.
    await insertTask("f0000000-0000-4000-8000-000000000005", { project_id: PROJECT_GHOST, task_list_id: LIST_GHOST });
    // Unbound list + a list pointing at a project that does not exist.
    await insert("task_lists", "d1000000-0000-4000-8000-00000000000d", { name: "Unbound", slug: "unbound", project_id: null });
    await insert("task_lists", "d2000000-0000-4000-8000-00000000000d", { name: "Ghost ref", slug: "ghost-ref", project_id: PROJECT_GHOST });

    const report = await store.integrity!.report();
    const byId = new Map(report.conditions.map((condition) => [condition.id, condition]));

    expect(byId.get("tasks_without_project")).toMatchObject({ count: 3, open_count: 2, severity: "error" });
    expect(byId.get("tasks_without_task_list")).toMatchObject({ count: 3, open_count: 2, severity: "error" });
    expect(byId.get("tasks_with_unregistered_project")).toMatchObject({ count: 1, open_count: 1, severity: "error" });
    expect(byId.get("tasks_with_unregistered_task_list")).toMatchObject({ count: 1, open_count: 1, severity: "error" });
    expect(byId.get("task_lists_without_project")).toMatchObject({ count: 1, severity: "warn" });
    expect(byId.get("task_lists_with_unregistered_project")).toMatchObject({ count: 1, severity: "error" });
    expect(report.summary).toMatchObject({ ok: false, findings: 6, rows: 10, unverified: 0, complete: true });
  });

  test("excludes tombstones on both sides: a deleted task is not an orphan, a deleted project IS a dangling target", async () => {
    await insert("projects", PROJECT_LIVE, { name: "Live", slug: "live", path: "/workspace/live" });
    await insert("task_lists", LIST_LIVE, { name: "Live list", slug: "live-list", project_id: PROJECT_LIVE });
    await insert("projects", PROJECT_TOMBSTONED, { name: "Gone", slug: "gone", path: "/workspace/gone" }, true);

    // A tombstoned unrouted task must NOT be reported as a live orphan.
    await insertTask("f0000000-0000-4000-8000-000000000010", { status: "pending" }, true);
    // A live task pointing at a tombstoned project IS dangling — the reference can
    // never resolve, which is the whole point of the condition.
    await insertTask("f0000000-0000-4000-8000-000000000011", { project_id: PROJECT_TOMBSTONED, task_list_id: LIST_LIVE });

    const report = await store.integrity!.report();
    const byId = new Map(report.conditions.map((condition) => [condition.id, condition]));
    expect(byId.get("tasks_without_project")).toMatchObject({ count: 0 });
    expect(byId.get("tasks_without_task_list")).toMatchObject({ count: 0 });
    expect(byId.get("tasks_with_unregistered_project")).toMatchObject({ count: 1 });
  });

  test("is scoped to its own service namespace", async () => {
    await insertTask("f0000000-0000-4000-8000-000000000020", { status: "pending" });
    const otherService = createPostgresTodosStorageAdapter({ client, service: `${SERVICE}-other` });
    const isolated = await otherService.integrity!.report();
    expect(isolated.summary).toMatchObject({ ok: true, findings: 0 });
    expect((await store.integrity!.report()).summary.findings).toBeGreaterThan(0);
  });

  test("READ-ONLY: the report never mutates a row", async () => {
    await insertTask("f0000000-0000-4000-8000-000000000030", { status: "pending" });
    const before = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM todos_sync_records WHERE service = $1", [SERVICE]);
    const snapshot = await client.query<{ payload: unknown; updated_at: string }>(
      "SELECT payload, updated_at FROM todos_sync_records WHERE service = $1 ORDER BY object_id", [SERVICE]);

    await store.integrity!.report();
    await store.integrity!.report();

    const after = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM todos_sync_records WHERE service = $1", [SERVICE]);
    const afterSnapshot = await client.query<{ payload: unknown; updated_at: string }>(
      "SELECT payload, updated_at FROM todos_sync_records WHERE service = $1 ORDER BY object_id", [SERVICE]);
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    expect(JSON.stringify(afterSnapshot.rows)).toBe(JSON.stringify(snapshot.rows));
  });
});
