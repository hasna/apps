import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { setMachineLocalPath } from "../db/projects.js";
import { createLocalSqliteTodosStorageAdapter } from "./local-sqlite.js";
import { createTodosStorageAdapter } from "./factory.js";
import { loadTodosStorageConfig } from "./config.js";
import { createShadowTodosStorageAdapter } from "./shadow.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";
import { getTodosShadowStatus } from "../lib/shadow-status.js";

let db: Database;
const LOCAL_TEST_ENV = { HASNA_TODOS_STORAGE_MODE: "local" } as const;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase(undefined, LOCAL_TEST_ENV);
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

interface MemoryRow {
  service: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
  updatedAt: string;
  deletedAt: string | null;
}

function createMemoryPostgresClient(options: { failFirst?: number } = {}) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const rows = new Map<string, MemoryRow>();
  let remainingFailures = options.failFirst ?? 0;
  const key = (s: unknown, t: unknown, i: unknown) => `${String(s)}:${String(t)}:${String(i)}`;

  const client: TodosPostgresQueryClient = {
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });

      if (sql.includes("INSERT INTO todos_sync_records")) {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error("simulated mirror failure");
        }
        const [service, objectType, objectId, payload, updatedAt, deletedAt] = values;
        const parsed = typeof payload === "string" ? JSON.parse(payload) : (payload as Record<string, unknown>);
        rows.set(key(service, objectType, objectId), {
          service: String(service),
          objectType: String(objectType),
          objectId: String(objectId),
          payload: parsed,
          updatedAt: String(updatedAt),
          deletedAt: deletedAt ? String(deletedAt) : null,
        });
        return { rows: [] as T[] };
      }

      if (sql.includes("GROUP BY object_type")) {
        const agg = new Map<string, { live: number; tombstones: number; last: string }>();
        for (const row of rows.values()) {
          if (row.service !== values[0]) continue;
          const entry = agg.get(row.objectType) ?? { live: 0, tombstones: 0, last: "" };
          if (row.deletedAt) entry.tombstones += 1;
          else entry.live += 1;
          if (row.updatedAt > entry.last) entry.last = row.updatedAt;
          agg.set(row.objectType, entry);
        }
        return {
          rows: [...agg.entries()].map(([object_type, e]) => ({
            object_type,
            live: e.live,
            tombstones: e.tombstones,
            last_updated: e.last,
          })) as unknown as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };
  return { client, calls, rows };
}

describe("dual-write shadow adapter", () => {
  test("mirrors successful local writes to the remote sync store; reads stay local", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createShadowTodosStorageAdapter({
      local: { db },
      postgresClient: postgres.client,
      sourceMachineId: "spark01",
      ensureSchema: true,
    });

    const project = await adapter.projects.create({ name: "Shadow Project", path: "/tmp/shadow-project" });
    const task = await adapter.tasks.create({ title: "Shadow task", project_id: project.id });

    // Local reads work without touching Postgres beyond mirroring.
    expect(await adapter.tasks.get(task.id)).toMatchObject({ id: task.id });
    expect(adapter.capabilities.remotePersistence).toBe(false);

    await adapter.shadow.flush();

    // The mirrored task landed in the remote store via the shared upsert.
    const mirroredTask = postgres.rows.get(`todos:tasks:${task.id}`);
    expect(mirroredTask?.payload).toMatchObject({ id: task.id, title: "Shadow task" });
    expect(postgres.rows.get(`todos:projects:${project.id}`)?.payload).toMatchObject({ id: project.id });
    // source_machine_id (index 6) carries the machine id.
    const insert = postgres.calls.find((c) => c.sql.includes("INSERT INTO todos_sync_records"));
    expect(insert?.values?.[6]).toBe("spark01");

    const metrics = adapter.shadow.getMetrics();
    expect(metrics.mirrored).toBeGreaterThanOrEqual(2);
    expect(metrics.failed).toBe(0);
    expect(metrics.divergence).toBe(0);
    expect(metrics.lastMirrorAt).not.toBeNull();
  });

  test("delete emits a tombstone to the remote store", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createShadowTodosStorageAdapter({ local: { db }, postgresClient: postgres.client });
    const task = await adapter.tasks.create({ title: "Doomed task" });
    await adapter.tasks.delete(task.id);
    await adapter.shadow.flush();

    const row = postgres.rows.get(`todos:tasks:${task.id}`);
    expect(row?.deletedAt).not.toBeNull();
  });

  test("project rename mirrors the cascaded canonical task-list record", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createShadowTodosStorageAdapter({ local: { db }, postgresClient: postgres.client });
    const project = await adapter.projects.create({
      name: "Shadow Emails",
      path: "/tmp/shadow-emails",
      task_list_id: "shadow-emails",
    });
    const list = await adapter.taskLists.create({
      name: "Shadow Emails",
      slug: "shadow-emails",
      project_id: project.id,
    });
    await adapter.shadow.flush();

    const renamed = await adapter.projects.rename(project.id, {
      new_slug: "shadow-emails-next",
      name: "Shadow Emails Next",
    });
    await adapter.shadow.flush();

    expect(renamed.task_lists_updated).toBe(1);
    expect(postgres.rows.get(`todos:projects:${project.id}`)?.payload)
      .toMatchObject({ task_list_id: "shadow-emails-next", name: "Shadow Emails Next" });
    expect(postgres.rows.get(`todos:task_lists:${list.id}`)?.payload)
      .toMatchObject({ slug: "shadow-emails-next", name: "Shadow Emails Next" });
  });

  test("local write succeeds even when the mirror push fails, incrementing divergence", async () => {
    // Fail every push attempt so retries are exhausted.
    const postgres = createMemoryPostgresClient({ failFirst: Number.MAX_SAFE_INTEGER });
    const adapter = createShadowTodosStorageAdapter({
      local: { db },
      postgresClient: postgres.client,
      maxRetries: 1,
      retryBaseMs: 1,
      ensureSchema: false,
    });

    const task = await adapter.tasks.create({ title: "Resilient local write" });
    // Local write is durable regardless of mirror health.
    expect(await adapter.tasks.get(task.id)).toMatchObject({ id: task.id });

    await adapter.shadow.flush();
    const metrics = adapter.shadow.getMetrics();
    expect(metrics.failed).toBe(1);
    expect(metrics.divergence).toBeGreaterThanOrEqual(1);
    expect(metrics.lastError).toContain("simulated mirror failure");
  });

  test("shadow-status reports local vs cloud divergence and mirror lag", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createShadowTodosStorageAdapter({ local: { db }, postgresClient: postgres.client });
    const project = await adapter.projects.create({ name: "Divergence", path: "/tmp/divergence" });
    const machinePath = setMachineLocalPath(project.id, "/tmp/divergence", db);
    await adapter.tasks.create({ title: "T1", project_id: project.id });
    await adapter.tasks.create({ title: "T2", project_id: project.id });
    await adapter.shadow.flush();
    postgres.rows.set(`todos:project_machine_paths:${machinePath.id}`, {
      service: "todos",
      objectType: "project_machine_paths",
      objectId: machinePath.id,
      payload: machinePath as unknown as Record<string, unknown>,
      updatedAt: machinePath.updated_at,
      deletedAt: null,
    });

    const local = createLocalSqliteTodosStorageAdapter({ db });
    const report = await getTodosShadowStatus({ local, cloud: postgres.client });

    expect(report.cloud_reachable).toBe(true);
    const tasks = report.objects.find((o) => o.object_type === "tasks");
    expect(tasks).toMatchObject({ local: 2, cloud: 2, diff: 0 });
    const projectMachinePaths = report.objects.find((o) => o.object_type === "project_machine_paths");
    expect(projectMachinePaths).toMatchObject({ local: 1, cloud: 1, diff: 0 });
    expect(postgres.rows.get(`todos:project_machine_paths:${machinePath.id}`)?.payload)
      .toMatchObject({ id: machinePath.id, project_id: project.id });
    expect(report.in_sync).toBe(true);
    expect(report.last_mirror_at).not.toBeNull();
    expect(report.last_mirror_lag_ms).not.toBeNull();
  });

  test("shadow-status surfaces an unreachable cloud without throwing", async () => {
    const cloud: TodosPostgresQueryClient = {
      async query() {
        throw new Error("connection refused");
      },
    };
    const local = createLocalSqliteTodosStorageAdapter({ db });
    const report = await getTodosShadowStatus({ local, cloud });
    expect(report.cloud_reachable).toBe(false);
    expect(report.error).toContain("connection refused");
  });

  test("Stage-A convenience factory preserves local SQLite without constructing shadow remote", async () => {
    const postgres = createMemoryPostgresClient();
    const config = loadTodosStorageConfig({
      HASNA_TODOS_STORAGE_MODE: "local",
      HASNA_TODOS_SHADOW: "1",
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
    });
    const adapter = createTodosStorageAdapter({
      config,
      env: {
        HASNA_TODOS_STORAGE_MODE: "local",
        HASNA_TODOS_SHADOW: "1",
        HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
      },
      local: { db },
      postgresClient: postgres.client,
    });
    expect(adapter.kind).toBe("sqlite");
    expect(adapter.capabilities.remotePersistence).toBe(false);
    expect(postgres.calls).toEqual([]);
  });

  test("Stage-A convenience factory does not require a shadow DSN", () => {
    const config = loadTodosStorageConfig({
      HASNA_TODOS_STORAGE_MODE: "local",
      HASNA_TODOS_SHADOW: "1",
    });
    expect(createTodosStorageAdapter({
      config,
      env: { HASNA_TODOS_STORAGE_MODE: "local", HASNA_TODOS_SHADOW: "1" },
      local: { db },
    }).kind).toBe("sqlite");
  });
});
