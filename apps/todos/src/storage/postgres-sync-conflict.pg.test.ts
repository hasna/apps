/**
 * REAL Postgres regression coverage for the sync push path's scoped-slug
 * unique-violation classification (ba6e4a19 duplicate-key retry storm).
 *
 * The push upsert arbiter is the table PRIMARY KEY
 * (migrations/0001_sync_tables.sql), but the deployed uniqueness invariants
 * are the partial expression indexes built by
 * postgresTodosScopedSlugUniqueIndexSql:
 *
 *   todos_sync_records_task_list_scope_slug_uidx   (service, COALESCE(payload->>'project_id',''), payload->>'slug')
 *     WHERE object_type='task_lists' AND deleted_at IS NULL ...
 *   todos_sync_records_project_task_list_slug_uidx (service, payload->>'task_list_id')
 *     WHERE object_type='projects' AND deleted_at IS NULL ...
 *
 * A slug collision on a DIFFERENT object_id therefore bypasses ON CONFLICT and
 * raises a raw 23505. The destination-conflict SELECT and the INSERT are
 * separate unguarded statements, so a concurrent pusher passes the preflight
 * and the second INSERT hits the index. This suite reproduces exactly that
 * race against the REAL index: a conflicting row is committed between the
 * preflight read and the INSERT (the preflight returns an empty destination),
 * and the typed ResourceConflictError must surface instead of the raw 23505 —
 * with no partial write of sibling records from the same snapshot.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-sync-conflict.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import {
  createPostgresTodosSyncStore,
  postgresTodosSyncSchemaSql,
  postgresTodosScopedSlugUniqueIndexSql,
  type TodosPostgresQueryClient,
} from "./postgres-sync.js";
import type { TodosStorageSnapshot } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-sync-conflict-${process.pid}-${Date.now()}`;

function taskListSnapshot(taskLists: unknown[]): TodosStorageSnapshot {
  return {
    exportedAt: "2026-07-15T00:00:00.000Z",
    source: "sqlite",
    tasks: [],
    projects: [],
    projectMachinePaths: [],
    plans: [],
    agents: [],
    taskLists: taskLists as TodosStorageSnapshot["taskLists"],
    templates: [],
    templateTasks: [],
    auditHistory: [],
    tombstones: [],
  };
}

function projectSnapshot(projects: unknown[]): TodosStorageSnapshot {
  return {
    exportedAt: "2026-07-15T00:00:00.000Z",
    source: "sqlite",
    tasks: [],
    projects: projects as TodosStorageSnapshot["projects"],
    projectMachinePaths: [],
    plans: [],
    agents: [],
    taskLists: [],
    templates: [],
    templateTasks: [],
    auditHistory: [],
    tombstones: [],
  };
}

function snapshotWithTaskAndTaskList(task: unknown, taskList: unknown): TodosStorageSnapshot {
  return {
    exportedAt: "2026-07-15T00:00:00.000Z",
    source: "sqlite",
    tasks: [task as TodosStorageSnapshot["tasks"][number]],
    projects: [],
    projectMachinePaths: [],
    plans: [],
    agents: [],
    taskLists: [taskList as TodosStorageSnapshot["taskLists"][number]],
    templates: [],
    templateTasks: [],
    auditHistory: [],
    tombstones: [],
  };
}

/**
 * Wrap the real client so the FIRST destination-preflight read races a
 * conflicting row in: the preflight sees an empty destination, and the push
 * INSERT then hits the real unique index with a genuine 23505. This is the
 * TOCTOU window the incident's concurrent pushers hit, made deterministic.
 */
function racingClient(
  real: TodosCloudQueryClient,
  raceInsert: { objectType: "task_lists" | "projects"; objectId: string; payload: Record<string, unknown> },
): TodosPostgresQueryClient {
  let injected = false;
  const inject = () => real.query(
    `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4::jsonb, now(), NULL)`,
    [SERVICE, raceInsert.objectType, raceInsert.objectId, raceInsert.payload],
  );
  return {
    async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
      if (!injected && sql.includes("object_type IN ($2, $3)") && sql.includes("deleted_at IS NULL")) {
        injected = true;
        await inject();
        return { rows: [] as T[] };
      }
      return real.query<T>(sql, values);
    },
    async transaction<T>(fn: (transaction: TodosPostgresQueryClient) => Promise<T>): Promise<T> {
      return real.transaction((transaction) => fn({
        query<R = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
          if (!injected && sql.includes("object_type IN ($2, $3)") && sql.includes("deleted_at IS NULL")) {
            injected = true;
            return inject().then(() => ({ rows: [] as R[] }));
          }
          return transaction.query<R>(sql, values);
        },
      }));
    },
  };
}

describe.skipIf(!PG_URL)("postgres sync — scoped-slug unique violations classify as typed conflicts", () => {
  let client: TodosCloudQueryClient;

  const rowsForService = async () => {
    const result = await client.query<{ object_type: string; object_id: string }>(
      `SELECT object_type, object_id FROM todos_sync_records WHERE service = $1`,
      [SERVICE],
    );
    return result.rows;
  };

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    // The unique indexes are the deployed invariants this fix classifies
    // against; build them directly (ensurePostgresScopedSlugUniqueIndexes
    // audits the WHOLE table and would refuse pre-existing duplicates).
    for (const sql of postgresTodosScopedSlugUniqueIndexSql()) await client.query(sql);
  });

  afterAll(async () => {
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  test("TOCTOU slug collision surfaces as TASK_LIST_SLUG_CONFLICT with no partial sibling write", async () => {
    const racing = createPostgresTodosSyncStore(
      racingClient(client, {
        objectType: "task_lists",
        objectId: "tl-accounting",
        payload: { id: "tl-accounting", slug: "accounting", project_id: null, name: "Accounting" },
      }),
      { service: SERVICE },
    );

    const snapshot = snapshotWithTaskAndTaskList(
      { id: "task-sibling", title: "Sibling task", status: "pending", priority: "medium" },
      { id: "tl-accounting-b", slug: "accounting", project_id: null, name: "Colliding" },
    );
    await expect(racing.pushSnapshot(snapshot))
      .rejects.toMatchObject({ name: "ResourceConflictError", code: "TASK_LIST_SLUG_CONFLICT" });

    // The snapshot's own inserts were atomic: the sibling task and the
    // colliding task list did not partially land; only the raced-in conflict
    // row exists.
    const ids = (await rowsForService()).map((row) => `${row.object_type}:${row.object_id}`);
    expect(ids).toContain("task_lists:tl-accounting");
    expect(ids).not.toContain("task_lists:tl-accounting-b");
    expect(ids).not.toContain("tasks:task-sibling");
  });

  test("project task_list_id collision surfaces as PROJECT_SLUG_CONFLICT", async () => {
    const racing = createPostgresTodosSyncStore(
      racingClient(client, {
        objectType: "projects",
        objectId: "project-finance",
        payload: { id: "project-finance", name: "Finance", path: "/tmp/finance", task_list_id: "finance" },
      }),
      { service: SERVICE },
    );

    const snapshot = projectSnapshot([
      { id: "project-finance-b", name: "Finance B", path: "/tmp/finance-b", task_list_id: "finance" },
    ]);
    await expect(racing.pushSnapshot(snapshot))
      .rejects.toMatchObject({ name: "ResourceConflictError", code: "PROJECT_SLUG_CONFLICT" });

    const ids = (await rowsForService()).map((row) => `${row.object_type}:${row.object_id}`);
    expect(ids).toContain("projects:project-finance");
    expect(ids).not.toContain("projects:project-finance-b");
  });

  test("same slug under two different project scopes pushes cleanly (both rows land)", async () => {
    const store = createPostgresTodosSyncStore(client, { service: SERVICE });
    const snapshot = taskListSnapshot([
      { id: "tl-scoped-x", slug: "accounting", project_id: "proj-x", name: "Scoped X" },
      { id: "tl-scoped-y", slug: "accounting", project_id: "proj-y", name: "Scoped Y" },
    ]);
    await expect(store.pushSnapshot(snapshot)).resolves.toMatchObject({ records: 2 });

    const ids = (await rowsForService()).map((row) => `${row.object_type}:${row.object_id}`);
    expect(ids).toContain("task_lists:tl-scoped-x");
    expect(ids).toContain("task_lists:tl-scoped-y");
  });

  test("distinct slugs in the same scope push cleanly", async () => {
    const store = createPostgresTodosSyncStore(client, { service: SERVICE });
    // Slugs chosen to avoid the race-injected rows left by the earlier tests.
    const snapshot = taskListSnapshot([
      { id: "tl-distinct-a", slug: "research", project_id: null, name: "A" },
      { id: "tl-distinct-b", slug: "inbox", project_id: null, name: "B" },
    ]);
    await expect(store.pushSnapshot(snapshot)).resolves.toMatchObject({ records: 2 });

    const ids = (await rowsForService()).map((row) => `${row.object_type}:${row.object_id}`);
    expect(ids).toContain("task_lists:tl-distinct-a");
    expect(ids).toContain("task_lists:tl-distinct-b");
  });
});
