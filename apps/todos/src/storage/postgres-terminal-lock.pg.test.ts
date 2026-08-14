/**
 * REAL Postgres regression coverage for lock release on a TERMINAL status
 * transition through `tasks.update` (the /v1 PATCH path, and what the CLI's
 * `todos update --status ...` calls on the cloud route).
 *
 * The cloud backend's updateTask spread `...definedPatch(input)` and never
 * touched locked_by/locked_at for ANY status, so completing, failing or
 * cancelling a task through the generic patch path left its holder in place.
 * A terminal row is not startable — startTask rejects anything that is not
 * pending/in_progress — so that lock could never be re-acquired and never
 * expired into anyone else's hands: it was permanent, and repair-on-
 * reacquisition could never reach it.
 *
 * Measured on the fleet 2026-08-02 before the fix: 2,597 locked rows, 2,205 of
 * them on terminal tasks (completed 1,425 / failed 532 / cancelled 248), and
 * 100% of the completed+locked rows were completed AFTER the lock was taken.
 *
 * SQLite covers the same contract in src/db/task-lifecycle.test.ts.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-terminal-lock.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-terminal-lock-${process.pid}-${Date.now()}`;

const HOLDER = "holder-a";
const LOCKED_AT = "2026-07-20T00:00:00.000Z";

describe.skipIf(!PG_URL)("postgres tasks.update — terminal status releases the lock", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  const seedLockedTask = async (id: string, status = "in_progress") => {
    const payload = {
      id,
      short_id: "TERMLOCK-1",
      title: "Held task",
      status,
      priority: "medium",
      parent_id: null,
      project_id: null,
      task_list_id: null,
      tags: [],
      metadata: {},
      version: 1,
      locked_by: HOLDER,
      locked_at: LOCKED_AT,
      created_at: LOCKED_AT,
      updated_at: LOCKED_AT,
    };
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
       VALUES ($1, 'tasks', $2, $3::jsonb, now(), NULL)
       ON CONFLICT (service, object_type, object_id)
         DO UPDATE SET payload = EXCLUDED.payload, deleted_at = NULL`,
      [SERVICE, id, payload],
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

  for (const status of ["completed", "failed", "cancelled"] as const) {
    test(`clears locked_by/locked_at when status becomes ${status}`, async () => {
      const id = `e0000000-0000-4000-8000-0000000000${status.length.toString().padStart(2, "0")}`;
      await seedLockedTask(id);

      const out = await store.tasks.update(id, { version: 1, status });
      expect(out.status).toBe(status);
      expect(out.locked_by).toBeNull();
      expect(out.locked_at).toBeNull();

      // Persisted, not just returned — the SQLite side once wrote the row
      // correctly while still handing the caller a stale held-lock object.
      const readBack = await store.tasks.get(id);
      expect(readBack?.locked_by).toBeNull();
      expect(readBack?.locked_at).toBeNull();
    });
  }

  test("leaves the lock alone on a NON-terminal status change (negative control)", async () => {
    // The fix must not degrade into "any update drops the lock": an in-flight
    // holder editing a row, or re-opening a completed one, keeps its claim.
    const id = "e0000000-0000-4000-8000-0000000000ff";
    await seedLockedTask(id, "pending");
    const out = await store.tasks.update(id, { version: 1, status: "in_progress" });
    expect(out.status).toBe("in_progress");
    expect(out.locked_by).toBe(HOLDER);
    expect(out.locked_at).toBe(LOCKED_AT);
  });

  test("leaves the lock alone when the patch carries no status at all (negative control)", async () => {
    const id = "e0000000-0000-4000-8000-0000000000fe";
    await seedLockedTask(id);
    const out = await store.tasks.update(id, { version: 1, title: "renamed" });
    expect(out.title).toBe("renamed");
    expect(out.locked_by).toBe(HOLDER);
    expect(out.locked_at).toBe(LOCKED_AT);
  });
});
