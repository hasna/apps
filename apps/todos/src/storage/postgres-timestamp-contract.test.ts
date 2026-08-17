/**
 * REGRESSION: the terminal-status timestamp contract on the Postgres (cloud
 * /v1) lane.
 *
 * Measured on the fleet 2026-08-17 (export of 63,603 rows from the hosted
 * store): 1,569 completed tasks carried a NULL `completed_at` and 123 failed
 * tasks carried NULL `started_at` AND NULL `completed_at`. Recency reads
 * (todos recap / standup) filter on `completed_at > since`, so those rows are
 * not datable and silently drop out of activity surfaces.
 *
 * The cloud adapter had three timestamp gaps:
 *
 *  1. `tasks.update` (the /v1 PATCH path) only stamped `completed_at` when the
 *     caller PUT one in the payload — PATCHing `{status: "completed"}` on a
 *     fresh row left the column NULL (SQLite stamps it).
 *  2. PATCHing `{status: "failed" | "cancelled"}` never stamped an end
 *     timestamp at all.
 *  3. PATCHing `{status: "in_progress"}` never stamped `started_at`.
 *     `tasks.fail` (the dedicated fail verb) also never wrote `completed_at`.
 *
 * Contract under test: reaching a TERMINAL status stamps the end timestamp
 * when none exists (never clobbering an existing one), and reaching
 * "in_progress" stamps `started_at` when none exists.
 */
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";
import type { Task } from "../types/index.js";

const SERVICE = "todos-timestamp-contract";

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: randomUUID(),
    short_id: "TS-1",
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    title: "Timestamp contract",
    description: null,
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    started_at: null,
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

interface FakeHarness {
  client: TodosPostgresQueryClient;
  records: Map<string, { service: string; objectType: string; objectId: string; payload: unknown; updatedAt: string; deletedAt: string | null; version: number | null }>;
  seedTask: (task: Task) => void;
  readTask: (id: string) => Task | null;
}

function createFake(): FakeHarness {
  const records = new Map<string, {
    service: string;
    objectType: string;
    objectId: string;
    payload: unknown;
    updatedAt: string;
    deletedAt: string | null;
    version: number | null;
  }>();
  const key = (objectType: unknown, objectId: unknown) => `${SERVICE}:${String(objectType)}:${String(objectId)}`;
  const clone = <T>(value: T): T => structuredClone(value);
  const decode = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : clone(value);
  const queryRow = (record: NonNullable<ReturnType<FakeHarness["records"] extends Map<string, infer R> ? R : never>>) => ({
    object_type: record.objectType,
    object_id: record.objectId,
    payload: clone(record.payload),
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt,
    version: record.version,
  });

  const client: TodosPostgresQueryClient = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      // store.get
      if (sql.includes("SELECT object_type, object_id, payload, updated_at")
        && sql.includes("WHERE service = $1 AND object_type = $2 AND object_id = $3")) {
        const record = records.get(key(values[1], values[2]));
        return { rows: (record && !record.deletedAt ? [queryRow(record)] : []) as T[] };
      }
      // list for a type
      if (sql.includes("SELECT object_type, object_id, payload, updated_at")
        && sql.includes("WHERE service = $1 AND object_type = $2")) {
        const objectType = values[1];
        const selected = [...records.values()].filter(
          (record) => record.service === values[0] && record.objectType === objectType && !record.deletedAt,
        );
        return { rows: selected.map(queryRow) as T[] };
      }
      // task-plan-membership / task-parent-integrity guard CTE
      if (sql.includes("task-plan-membership-guard")) {
        const service = values[0];
        const objectId = values[1];
        const nextPayload = decode(values[2]);
        const updatedAt = String(values[3]);
        const version = Number(values[5]);
        const parentGuard = Boolean(values[9]);
        const expectedVersion = values[11] === null || values[11] === undefined ? null : Number(values[11]);
        const existing = records.get(key("tasks", objectId));
        const taskFound = Boolean(existing && !existing.deletedAt);
        const versionMatches = !parentGuard || !taskFound || existing!.version === expectedVersion;
        if (taskFound && versionMatches) {
          records.set(key("tasks", objectId), {
            service: String(service),
            objectType: "tasks",
            objectId: String(objectId),
            payload: clone(nextPayload),
            updatedAt,
            deletedAt: null,
            version,
          });
        }
        return {
          rows: [{
            task_found: taskFound,
            version_matches: versionMatches,
            parent_found: true,
            parent_acyclic: true,
            all_plans_found: true,
            target_plan_found: true,
            project_conflict: false,
            payload: taskFound && versionMatches ? clone(nextPayload) : null,
            current_payload: taskFound ? existing!.payload : null,
          }] as T[],
        };
      }
      // plain upsert (audit_history etc.)
      if (sql.includes("INSERT INTO todos_sync_records")) {
        const [recordService, objectType, objectId, rawPayload, updatedAt] = values;
        records.set(key(objectType, objectId), {
          service: String(recordService),
          objectType: String(objectType),
          objectId: String(objectId),
          payload: decode(rawPayload),
          updatedAt: String(updatedAt),
          deletedAt: null,
          version: typeof values[6] === "number" ? values[6] as number : null,
        });
        return { rows: (sql.includes("RETURNING") ? [{ object_id: String(objectId) }] : []) as T[] };
      }
      return { rows: [] as T[] };
    },
    async transaction<T>(fn: (client: TodosPostgresQueryClient) => Promise<T>): Promise<T> {
      return fn(client);
    },
  };

  return {
    client,
    records,
    seedTask: (task: Task) => {
      records.set(key("tasks", task.id), {
        service: SERVICE,
        objectType: "tasks",
        objectId: task.id,
        payload: clone(task),
        updatedAt: task.updated_at,
        deletedAt: null,
        version: task.version,
      });
    },
    readTask: (id: string) => {
      const record = records.get(key("tasks", id));
      return record && !record.deletedAt ? clone(record.payload) as Task : null;
    },
  };
}

describe("postgres tasks.update — terminal-status timestamp contract", () => {
  test("status -> failed stamps completed_at when none exists", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const task = baseTask({ id: randomUUID() });
    harness.seedTask(task);

    const updated = await adapter.tasks.update(task.id, { status: "failed", version: task.version });

    expect(updated.status).toBe("failed");
    expect(updated.completed_at).toBeTruthy();
    expect(harness.readTask(task.id)?.completed_at).toBeTruthy();
  });

  test("status -> cancelled stamps completed_at when none exists", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const task = baseTask({ id: randomUUID() });
    harness.seedTask(task);

    const updated = await adapter.tasks.update(task.id, { status: "cancelled", version: task.version });

    expect(updated.status).toBe("cancelled");
    expect(updated.completed_at).toBeTruthy();
    expect(harness.readTask(task.id)?.completed_at).toBeTruthy();
  });

  test("status -> completed with NO completed_at in the payload stamps it (the PATCH gap)", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const task = baseTask({ id: randomUUID() });
    harness.seedTask(task);

    const updated = await adapter.tasks.update(task.id, { status: "completed", version: task.version });

    expect(updated.status).toBe("completed");
    expect(updated.completed_at).toBeTruthy();
    expect(harness.readTask(task.id)?.completed_at).toBeTruthy();
  });

  test("does NOT clobber an existing completed_at on a failed transition", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const completedAt = "2026-08-02T10:00:00.000Z";
    const task = baseTask({ id: randomUUID(), status: "in_progress", completed_at: completedAt, version: 2 });
    harness.seedTask(task);

    const updated = await adapter.tasks.update(task.id, { status: "failed", version: task.version });

    expect(updated.completed_at).toBe(completedAt);
    expect(harness.readTask(task.id)?.completed_at).toBe(completedAt);
  });

  test("status -> in_progress stamps started_at when none exists", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const task = baseTask({ id: randomUUID() });
    harness.seedTask(task);

    const updated = await adapter.tasks.update(task.id, { status: "in_progress", version: task.version });

    expect(updated.status).toBe("in_progress");
    expect(updated.started_at).toBeTruthy();
    expect(harness.readTask(task.id)?.started_at).toBeTruthy();
  });

  test("does NOT clobber an existing started_at on a later in_progress update", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const startedAt = "2026-08-02T08:00:00.000Z";
    const task = baseTask({ id: randomUUID(), status: "in_progress", started_at: startedAt, version: 2 });
    harness.seedTask(task);

    const updated = await adapter.tasks.update(task.id, { status: "in_progress", version: task.version });

    expect(updated.started_at).toBe(startedAt);
    expect(harness.readTask(task.id)?.started_at).toBe(startedAt);
  });

  test("assignment-only update does NOT stamp started_at (delegation semantics)", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const task = baseTask({ id: randomUUID() });
    harness.seedTask(task);

    await adapter.tasks.update(task.id, { assigned_to: "worker-alpha", version: task.version });

    expect(harness.readTask(task.id)?.started_at).toBeNull();
    expect(harness.readTask(task.id)?.completed_at).toBeNull();
  });

  test("non-terminal status change leaves completed_at NULL (negative control)", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const task = baseTask({ id: randomUUID() });
    harness.seedTask(task);

    const updated = await adapter.tasks.update(task.id, { status: "pending", priority: "high", version: task.version });

    expect(updated.completed_at).toBeNull();
    expect(harness.readTask(task.id)?.completed_at).toBeNull();
  });
});

describe("postgres tasks.fail — terminal-status timestamp contract", () => {
  test("fail stamps completed_at when none exists", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const task = baseTask({ id: randomUUID() });
    harness.seedTask(task);

    const result = await adapter.tasks.fail(task.id, "agent-1", "boom", {});

    expect(result.task.status).toBe("failed");
    expect(result.task.completed_at).toBeTruthy();
    expect(harness.readTask(task.id)?.completed_at).toBeTruthy();
  });

  test("fail does NOT clobber an existing completed_at", async () => {
    const harness = createFake();
    const adapter = createPostgresTodosStorageAdapter({ client: harness.client, service: SERVICE });
    const completedAt = "2026-08-02T10:00:00.000Z";
    const task = baseTask({ id: randomUUID(), status: "in_progress", completed_at: completedAt, version: 2 });
    harness.seedTask(task);

    const result = await adapter.tasks.fail(task.id, "agent-1", "boom", {});

    expect(result.task.completed_at).toBe(completedAt);
    expect(harness.readTask(task.id)?.completed_at).toBe(completedAt);
  });
});
