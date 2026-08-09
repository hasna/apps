/**
 * REAL PostgreSQL coverage for the exact stale-lock handoff CAS.
 *
 * The mutation and task-history receipt must commit from one PostgreSQL
 * statement; application-side prechecks are not sufficient. Point
 * TODOS_TEST_PG_URL only at a disposable test database:
 *
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-stale-lock-handoff.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { StaleLockHandoffError, type Task, type TaskHistory } from "../types/index.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-stale-lock-handoff-${process.pid}-${Date.now()}`;
const HOLDER = "holder-a";
const NEW_HOLDER = "nausicaa";
const STALE_AFTER_SECONDS = 3600;

const STALE_TASK_ID = "d1000000-0000-4000-8000-000000000001";
const SIBLING_TASK_ID = "d1000000-0000-4000-8000-000000000002";
const LIVE_TASK_ID = "d1000000-0000-4000-8000-000000000003";
const HOLDER_MISMATCH_TASK_ID = "d1000000-0000-4000-8000-000000000004";
const VERSION_MISMATCH_TASK_ID = "d1000000-0000-4000-8000-000000000005";

function taskPayload(id: string, lockedAt: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    short_id: `PGCAS-${id.slice(-1)}`,
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    title: `PostgreSQL lock ${id}`,
    description: null,
    status: "in_progress",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: HOLDER,
    locked_at: lockedAt,
    created_at: lockedAt,
    updated_at: lockedAt,
    started_at: lockedAt,
    completed_at: null,
    due_at: null,
    estimated_minutes: null,
    actual_minutes: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    spawns_template_id: null,
    confidence: null,
    reason: null,
    spawned_from_session: null,
    assigned_by: null,
    created_by: null,
    assigned_from_project: null,
    task_type: null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 3,
    retry_after: null,
    sla_minutes: null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
    ...overrides,
  };
}

describe.skipIf(!PG_URL)("PostgreSQL exact stale-lock handoff", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  const seedTask = async (payload: Task) => {
    await client.query(
      `INSERT INTO todos_sync_records (
         service, object_type, object_id, payload, updated_at,
         deleted_at, source_machine_id, version
       )
       VALUES ($1, 'tasks', $2, $3::jsonb, $4::timestamptz, NULL, 'pg-test', $5)
       ON CONFLICT (service, object_type, object_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at,
         deleted_at = NULL,
         source_machine_id = EXCLUDED.source_machine_id,
         version = EXCLUDED.version`,
      [SERVICE, payload.id, payload, payload.updated_at, payload.version],
    );
  };

  const taskRecord = async (taskId: string) => {
    const result = await client.query<{
      payload_text: string;
      updated_at: string;
      version: number | null;
    }>(
      `SELECT payload::text AS payload_text, updated_at::text AS updated_at, version
       FROM todos_sync_records
       WHERE service = $1 AND object_type = 'tasks' AND object_id = $2
         AND deleted_at IS NULL`,
      [SERVICE, taskId],
    );
    return result.rows[0]!;
  };

  const taskAudit = async (taskId: string) => {
    const result = await client.query<{ payload: TaskHistory }>(
      `SELECT payload
       FROM todos_sync_records
       WHERE service = $1 AND object_type = 'audit_history'
         AND payload->>'task_id' = $2 AND deleted_at IS NULL
       ORDER BY payload->>'created_at', object_id`,
      [SERVICE, taskId],
    );
    return result.rows.map((row) => row.payload);
  };

  const handoff = (taskId: string, expectedLockVersion: string, expectedHolder = HOLDER) =>
    store.tasks.handoffStaleLock!({
      task_id: taskId,
      actor: NEW_HOLDER,
      expected_holder: expectedHolder,
      expected_lock_version: expectedLockVersion,
      stale_after_seconds: STALE_AFTER_SECONDS,
      new_holder: NEW_HOLDER,
      reason: "Recover an abandoned exact PostgreSQL lock",
    });

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

  test("transfers one stale exact lock and persists one readable receipt without touching its sibling", async () => {
    const staleVersion = new Date(Date.now() - 2 * STALE_AFTER_SECONDS * 1000).toISOString();
    await seedTask(taskPayload(STALE_TASK_ID, staleVersion));
    await seedTask(taskPayload(SIBLING_TASK_ID, staleVersion));
    const siblingBefore = await taskRecord(SIBLING_TASK_ID);

    const receipt = await handoff(STALE_TASK_ID, staleVersion);

    expect(receipt).toMatchObject({
      schema_version: "todos.stale-lock-handoff.v1",
      task_id: STALE_TASK_ID,
      actor: NEW_HOLDER,
      previous_holder: HOLDER,
      previous_lock_version: staleVersion,
      new_holder: NEW_HOLDER,
      stale_after_seconds: STALE_AFTER_SECONDS,
      reason: "Recover an abandoned exact PostgreSQL lock",
    });
    const updated = await store.tasks.get(STALE_TASK_ID);
    expect(updated).toMatchObject({
      id: STALE_TASK_ID,
      locked_by: NEW_HOLDER,
      locked_at: receipt.new_lock_version,
      version: 2,
    });
    expect(await taskRecord(SIBLING_TASK_ID)).toEqual(siblingBefore);

    const audit = await taskAudit(STALE_TASK_ID);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      id: receipt.receipt_id,
      task_id: STALE_TASK_ID,
      action: "stale_lock_handoff",
      field: "lock",
      agent_id: NEW_HOLDER,
    });
    expect(JSON.parse(audit[0]!.new_value!)).toEqual(receipt);

    const rowBeforeReplay = await taskRecord(STALE_TASK_ID);
    await expect(handoff(STALE_TASK_ID, staleVersion)).rejects.toMatchObject({
      code: "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
    });
    expect(await taskRecord(STALE_TASK_ID)).toEqual(rowBeforeReplay);
    expect(await taskAudit(STALE_TASK_ID)).toHaveLength(1);
  });

  test("a live current lock fails closed with unchanged task and audit population", async () => {
    const liveVersion = new Date(Date.now() - 30_000).toISOString();
    await seedTask(taskPayload(LIVE_TASK_ID, liveVersion));
    const rowBefore = await taskRecord(LIVE_TASK_ID);
    const auditBefore = await taskAudit(LIVE_TASK_ID);

    await expect(handoff(LIVE_TASK_ID, liveVersion)).rejects.toMatchObject({
      code: "STALE_LOCK_HANDOFF_NOT_STALE",
    });

    expect(await taskRecord(LIVE_TASK_ID)).toEqual(rowBefore);
    expect(await taskAudit(LIVE_TASK_ID)).toEqual(auditBefore);
  });

  test("holder and version mismatches fail closed with zero mutation", async () => {
    const staleVersion = new Date(Date.now() - 2 * STALE_AFTER_SECONDS * 1000).toISOString();
    const wrongVersion = new Date(Date.parse(staleVersion) - 1000).toISOString();
    await seedTask(taskPayload(HOLDER_MISMATCH_TASK_ID, staleVersion));
    await seedTask(taskPayload(VERSION_MISMATCH_TASK_ID, staleVersion));

    for (const control of [
      {
        taskId: HOLDER_MISMATCH_TASK_ID,
        expectedVersion: staleVersion,
        expectedHolder: "wrong-holder",
        code: "STALE_LOCK_HANDOFF_HOLDER_MISMATCH",
      },
      {
        taskId: VERSION_MISMATCH_TASK_ID,
        expectedVersion: wrongVersion,
        expectedHolder: HOLDER,
        code: "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
      },
    ] as const) {
      const rowBefore = await taskRecord(control.taskId);
      const auditBefore = await taskAudit(control.taskId);
      try {
        await handoff(control.taskId, control.expectedVersion, control.expectedHolder);
        throw new Error("expected PostgreSQL stale-lock handoff conflict");
      } catch (error) {
        expect(error).toBeInstanceOf(StaleLockHandoffError);
        expect(error).toMatchObject({ code: control.code });
      }
      expect(await taskRecord(control.taskId)).toEqual(rowBefore);
      expect(await taskAudit(control.taskId)).toEqual(auditBefore);
    }
  });
});
