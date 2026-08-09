import { describe, expect, test } from "bun:test";
import { StaleLockHandoffError, type Task, type TaskHistory } from "../types/index.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { TodosStorageSnapshot } from "./interfaces.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

const TASK_ID = "c1000000-0000-4000-8000-000000000001";
const CONTROL_TASK_ID = "c1000000-0000-4000-8000-000000000002";
const RECEIPT_ID = "c1000000-0000-4000-8000-000000000003";
const LOCK_VERSION = "2026-08-09T08:00:00.000Z";
const HANDOFF_VERSION = "2026-08-09T10:00:00.000Z";

function lockedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    short_id: "PGCAS-1",
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    title: "Atomic stale-lock handoff",
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
    locked_by: "holder-a",
    locked_at: LOCK_VERSION,
    created_at: LOCK_VERSION,
    updated_at: LOCK_VERSION,
    started_at: LOCK_VERSION,
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

function receiptHistory(): TaskHistory {
  return {
    id: RECEIPT_ID,
    task_id: TASK_ID,
    action: "stale_lock_handoff",
    field: "locked_by",
    old_value: "holder-a",
    new_value: JSON.stringify({
      schema_version: "todos.stale-lock-handoff.v1",
      receipt_id: RECEIPT_ID,
      task_id: TASK_ID,
      actor: "nausicaa",
      previous_holder: "holder-a",
      previous_lock_version: LOCK_VERSION,
      new_holder: "nausicaa",
      new_lock_version: HANDOFF_VERSION,
    }),
    agent_id: "nausicaa",
    created_at: HANDOFF_VERSION,
    machine_id: null,
  };
}

function emptySnapshot(overrides: Record<string, unknown> = {}): TodosStorageSnapshot {
  return {
    exportedAt: "2026-08-09T12:00:00.000Z",
    source: "postgres",
    tasks: [],
    projects: [],
    projectMachinePaths: [],
    plans: [],
    agents: [],
    taskLists: [],
    templates: [],
    templateTasks: [],
    auditHistory: [],
    tombstones: [],
    ...overrides,
  } as TodosStorageSnapshot;
}

function createAuditImportPostgresClient() {
  interface StoredRecord {
    service: string;
    objectType: string;
    objectId: string;
    payload: unknown;
    updatedAt: string;
    deletedAt: string | null;
    version: number | null;
  }

  const service = "pg-audit-import";
  const records = new Map<string, StoredRecord>();
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const key = (objectType: unknown, objectId: unknown) => `${service}:${String(objectType)}:${String(objectId)}`;
  const clone = <T>(value: T): T => structuredClone(value);
  const decode = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : clone(value);
  const queryRow = (record: StoredRecord) => ({
    object_type: record.objectType,
    object_id: record.objectId,
    payload: clone(record.payload),
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt,
    version: record.version,
  });
  const seed = (objectType: string, objectId: string, payload: unknown, updatedAt: string, version: number | null = null) => {
    records.set(key(objectType, objectId), {
      service,
      objectType,
      objectId,
      payload: clone(payload),
      updatedAt,
      deletedAt: null,
      version,
    });
  };

  seed("tasks", TASK_ID, lockedTask({
    locked_by: "nausicaa",
    locked_at: HANDOFF_VERSION,
    updated_at: HANDOFF_VERSION,
    version: 2,
  }), HANDOFF_VERSION, 2);
  seed("tasks", CONTROL_TASK_ID, lockedTask({
    id: CONTROL_TASK_ID,
    short_id: "PGCAS-2",
    title: "Unrelated PostgreSQL import control",
  }), LOCK_VERSION, 1);
  seed("audit_history", RECEIPT_ID, receiptHistory(), HANDOFF_VERSION);

  const client: TodosPostgresQueryClient = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });

      if (
        sql.includes("SELECT object_type, object_id, payload, updated_at")
        && sql.includes("WHERE service = $1 AND object_type = $2")
      ) {
        const objectType = values[1];
        const objectId = values[2];
        const selected = objectId === undefined
          ? [...records.values()].filter((record) =>
            record.service === values[0] && record.objectType === objectType && !record.deletedAt
          )
          : [...records.values()].filter((record) =>
            record.service === values[0]
            && record.objectType === objectType
            && record.objectId === objectId
            && !record.deletedAt
          );
        return { rows: selected.map(queryRow) as T[] };
      }

      if (
        sql.includes("SELECT object_type, object_id, updated_at, deleted_at")
        && sql.includes("WHERE service = $1 AND object_type = $2 AND object_id = $3")
      ) {
        const record = records.get(key(values[1], values[2]));
        return { rows: (record ? [queryRow(record)] : []) as T[] };
      }

      if (sql.includes("INSERT INTO todos_sync_records")) {
        const [recordService, objectType, objectId, rawPayload, updatedAt] = values;
        const tombstoneWrite = sql.includes("deleted_at = EXCLUDED.deleted_at");
        const stored: StoredRecord = {
          service: String(recordService),
          objectType: String(objectType),
          objectId: String(objectId),
          payload: decode(rawPayload),
          updatedAt: String(updatedAt),
          deletedAt: tombstoneWrite ? String(values[5]) : null,
          version: typeof values[tombstoneWrite ? 7 : 6] === "number"
            ? values[tombstoneWrite ? 7 : 6] as number
            : null,
        };
        records.set(key(objectType, objectId), stored);
        return { rows: (sql.includes("RETURNING") ? [{ object_id: String(objectId) }] : []) as T[] };
      }

      return { rows: [] as T[] };
    },
  };

  return {
    client,
    calls,
    service,
    audit: () => clone(records.get(key("audit_history", RECEIPT_ID))?.payload as TaskHistory),
    protectedBytes: () => JSON.stringify(
      [...records.values()]
        .filter((record) =>
          (record.objectType === "tasks" && (record.objectId === TASK_ID || record.objectId === CONTROL_TASK_ID))
          || (record.objectType === "audit_history" && record.objectId === RECEIPT_ID)
        )
        .sort((left, right) => key(left.objectType, left.objectId).localeCompare(key(right.objectType, right.objectId)))
        .map((record) => ({
          objectType: record.objectType,
          objectId: record.objectId,
          payload: record.payload,
          updatedAt: record.updatedAt,
          deletedAt: record.deletedAt,
          version: record.version,
        })),
    ),
  };
}

describe("PostgreSQL stale-lock handoff SQL", () => {
  test("executes one exact-row CAS statement that updates the lock and inserts task history", async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const before = lockedTask();
    const client: TodosPostgresQueryClient = {
      async query<T>(sql: string, values: readonly unknown[] = []) {
        calls.push({ sql, values });
        if (!sql.includes("todos:stale-lock-handoff-atomic")) {
          return { rows: [] as T[] };
        }
        return {
          rows: [{
            current_payload: before,
            updated_payload: {
              ...before,
              locked_by: "nausicaa",
              locked_at: "2026-08-09T10:00:00.000Z",
              version: 2,
            },
            audit_payload: { action: "stale_lock_handoff" },
          }] as T[],
        };
      },
    };
    const adapter = createPostgresTodosStorageAdapter({ client, service: "pg-cas-shape" });

    expect(typeof adapter.tasks.handoffStaleLock).toBe("function");
    const receipt = await adapter.tasks.handoffStaleLock!({
      task_id: TASK_ID,
      actor: "nausicaa",
      expected_holder: "holder-a",
      expected_lock_version: LOCK_VERSION,
      stale_after_seconds: 3600,
      new_holder: "nausicaa",
      reason: "Recover abandoned exact lock",
    });

    const mutationCalls = calls.filter((call) =>
      call.sql.includes("todos:stale-lock-handoff-atomic")
    );
    expect(mutationCalls).toHaveLength(1);
    const sql = mutationCalls[0]!.sql;
    expect(sql.match(/\bUPDATE todos_sync_records\b/g)).toHaveLength(1);
    expect(sql.match(/\bINSERT INTO todos_sync_records\b/g)).toHaveLength(1);
    expect(sql).toContain("object_id = $2");
    expect(sql).toContain("target.payload->>'locked_by' = $3");
    expect(sql).toContain("target.payload->>'locked_at' = $4");
    expect(sql).toContain("todos_try_timestamptz(target.payload->>'locked_at') < $5::timestamptz");
    expect(sql).toContain("to_jsonb($6::text)");
    expect(sql).toContain("FROM updated");
    expect(sql).not.toContain("DELETE FROM");
    expect(sql.toLowerCase()).not.toContain("unlock");
    expect(mutationCalls[0]!.values.slice(0, 6)).toEqual([
      "pg-cas-shape",
      TASK_ID,
      "holder-a",
      LOCK_VERSION,
      receipt.stale_cutoff,
      "nausicaa",
    ]);
  });

  test("classifies a failed CAS from the locked snapshot and returns no receipt", async () => {
    const before = lockedTask({ locked_by: "different-holder" });
    const client: TodosPostgresQueryClient = {
      async query<T>(sql: string) {
        if (!sql.includes("todos:stale-lock-handoff-atomic")) {
          return { rows: [] as T[] };
        }
        return {
          rows: [{
            current_payload: before,
            updated_payload: null,
            audit_payload: null,
          }] as T[],
        };
      },
    };
    const adapter = createPostgresTodosStorageAdapter({ client, service: "pg-cas-conflict" });

    try {
      await adapter.tasks.handoffStaleLock!({
        task_id: TASK_ID,
        actor: "nausicaa",
        expected_holder: "holder-a",
        expected_lock_version: LOCK_VERSION,
        stale_after_seconds: 3600,
        new_holder: "nausicaa",
        reason: "Recover abandoned exact lock",
      });
      throw new Error("expected stale-lock handoff to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StaleLockHandoffError);
      expect(error).toMatchObject({
        code: "STALE_LOCK_HANDOFF_HOLDER_MISMATCH",
      });
    }
  });
});

describe("PostgreSQL adapter snapshot import — immutable stale-lock handoff receipts", () => {
  test("rejects a divergent same-ID audit row before any adapter mutation", async () => {
    const state = createAuditImportPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: state.client, service: state.service });
    const before = state.protectedBytes();
    const divergent: TaskHistory = {
      ...state.audit(),
      new_value: `${state.audit().new_value ?? ""}\nATTACK_OVERWRITE`,
    };

    const result = await adapter.sync.importSnapshot!(emptySnapshot({
      auditHistory: [divergent],
    }));

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [
        `AUDIT_HISTORY_DIVERGENT_REPLAY: immutable audit_history row ${RECEIPT_ID} differs from stored row`,
      ],
    });
    expect(state.protectedBytes()).toBe(before);
  });

  test("rejects every audit_history tombstone before any adapter mutation", async () => {
    const state = createAuditImportPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: state.client, service: state.service });
    const before = state.protectedBytes();

    const result = await adapter.sync.importSnapshot!(emptySnapshot({
      tombstones: [{
        object_type: "audit_history",
        object_id: RECEIPT_ID,
        deleted_at: "2026-08-09T12:01:00.000Z",
        updated_at: "2026-08-09T12:01:00.000Z",
      }],
    }));

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [
        `AUDIT_HISTORY_TOMBSTONE_FORBIDDEN: audit_history tombstone ${RECEIPT_ID} is not allowed`,
      ],
    });
    expect(state.protectedBytes()).toBe(before);
  });

  test("treats a field-identical audit row replay as an idempotent skip", async () => {
    const state = createAuditImportPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: state.client, service: state.service });
    const before = state.protectedBytes();

    const result = await adapter.sync.importSnapshot!(emptySnapshot({
      auditHistory: [state.audit()],
    }));

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 1,
      errors: [],
    });
    expect(state.protectedBytes()).toBe(before);
  });
});
