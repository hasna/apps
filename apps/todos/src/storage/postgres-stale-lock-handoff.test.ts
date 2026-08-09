import { describe, expect, test } from "bun:test";
import { StaleLockHandoffError, type Task } from "../types/index.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

const TASK_ID = "c1000000-0000-4000-8000-000000000001";
const LOCK_VERSION = "2026-08-09T08:00:00.000Z";

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
