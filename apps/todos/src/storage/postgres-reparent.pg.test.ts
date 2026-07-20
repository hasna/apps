/**
 * REAL Postgres regression coverage for re-parenting a task through
 * `tasks.update` (the /v1 PATCH path).
 *
 * The cloud backend once merged `task_list_id: input.task_list_id ?? existing`,
 * so an explicit `null` (detach) coalesced back to the old list — a task could
 * never be detached and a cross-project move left a dangling reference to the
 * source project's list. This runs against a real Postgres and fails if that
 * coalesce regression returns. SQLite already handled null (v1.test.ts).
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-reparent.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-reparent-${process.pid}-${Date.now()}`;

const TASK_ID = "f0000000-0000-4000-8000-000000000001";
const PROJECT_A = "a0000000-0000-4000-8000-00000000000a";
const PROJECT_B = "b0000000-0000-4000-8000-00000000000b";
const LIST_A = "c0000000-0000-4000-8000-00000000000c";
const LIST_B = "d0000000-0000-4000-8000-00000000000d";

describe.skipIf(!PG_URL)("postgres tasks.update — re-parent semantics", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  const seedTask = async () => {
    const payload = {
      id: TASK_ID,
      short_id: "REPARENT-1",
      title: "Portable task",
      status: "pending",
      priority: "medium",
      parent_id: null,
      project_id: PROJECT_A,
      task_list_id: LIST_A,
      tags: [],
      metadata: {},
      version: 1,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
       VALUES ($1, 'tasks', $2, $3::jsonb, now(), NULL)
       ON CONFLICT (service, object_type, object_id)
         DO UPDATE SET payload = EXCLUDED.payload, deleted_at = NULL`,
      [SERVICE, TASK_ID, payload],
    );
  };

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

  test("moving to another project detaches the source project's list when task_list_id is null", async () => {
    await seedTask();
    const moved = await store.tasks.update(TASK_ID, { version: 1, project_id: PROJECT_B, task_list_id: null });
    expect(moved.id).toBe(TASK_ID);
    expect(moved.project_id).toBe(PROJECT_B);
    expect(moved.task_list_id).toBeNull();
    // Persisted, not just returned.
    const readBack = await store.tasks.get(TASK_ID);
    expect(readBack?.project_id).toBe(PROJECT_B);
    expect(readBack?.task_list_id).toBeNull();
  });

  test("moving with an explicit destination list sets task_list_id", async () => {
    await seedTask();
    const moved = await store.tasks.update(TASK_ID, { version: 1, project_id: PROJECT_B, task_list_id: LIST_B });
    expect(moved.project_id).toBe(PROJECT_B);
    expect(moved.task_list_id).toBe(LIST_B);
  });

  test("omitting task_list_id leaves the existing list untouched", async () => {
    await seedTask();
    const moved = await store.tasks.update(TASK_ID, { version: 1, project_id: PROJECT_B });
    expect(moved.project_id).toBe(PROJECT_B);
    expect(moved.task_list_id).toBe(LIST_A);
  });
});
