import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { setMachineLocalPath } from "../db/projects.js";
import {
  createLocalSqliteTodosStorageAdapter,
  type TodosPostgresQueryClient,
} from "../storage.js";
import { TodosShadowOutbox, createTodosShadowOutbox } from "./shadow-outbox.js";

interface MemoryRow {
  service: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
  deletedAt: string | null;
}

/**
 * Fake cloud client: records pushes into an in-memory map, and can be told to
 * fail a fixed number of the first push attempts to exercise retry/backoff.
 */
function createMemoryPostgresClient(options: {
  failFirst?: number;
  failForever?: boolean;
  onInsert?: () => void | Promise<void>;
} = {}) {
  const rows = new Map<string, MemoryRow>();
  let remainingFailures = options.failFirst ?? 0;
  const key = (s: unknown, t: unknown, i: unknown) => `${String(s)}:${String(t)}:${String(i)}`;
  const client: TodosPostgresQueryClient = {
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      if (sql.includes("INSERT INTO todos_sync_records")) {
        if (options.onInsert) await options.onInsert();
        if (options.failForever || remainingFailures > 0) {
          if (!options.failForever) remainingFailures -= 1;
          throw new Error("simulated mirror failure");
        }
        const [service, objectType, objectId, payload, , deletedAt] = values;
        const parsed = typeof payload === "string" ? JSON.parse(payload) : (payload as Record<string, unknown>);
        rows.set(key(service, objectType, objectId), {
          service: String(service),
          objectType: String(objectType),
          objectId: String(objectId),
          payload: parsed,
          deletedAt: deletedAt ? String(deletedAt) : null,
        });
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
  };
  return { client, rows };
}

function outboxRows(db: Database): Array<{ object_type: string; object_id: string; op: string; status: string; attempts: number }> {
  return db
    .query(`SELECT object_type, object_id, op, status, attempts FROM shadow_outbox ORDER BY seq`)
    .all() as Array<{ object_type: string; object_id: string; op: string; status: string; attempts: number }>;
}

describe("durable shadow outbox", () => {
  let db: Database;

  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env["TODOS_DB_PATH"];
  });

  test("triggers capture every local write path (raw SQL + adapter) into the outbox", async () => {
    createTodosShadowOutbox({ db, postgresClient: createMemoryPostgresClient().client });
    const local = createLocalSqliteTodosStorageAdapter({ db });

    const project = await local.projects.create({ name: "P", path: "/tmp/ob-p" });
    const task = await local.tasks.create({ title: "T", project_id: project.id });

    const rows = outboxRows(db);
    const captured = new Set(rows.map((r) => `${r.object_type}:${r.object_id}`));
    expect(captured.has(`projects:${project.id}`)).toBe(true);
    expect(captured.has(`tasks:${task.id}`)).toBe(true);
    expect(rows.every((r) => r.op === "upsert" && r.status === "pending")).toBe(true);
  });

  test("captures project machine paths alongside projects", async () => {
    const cloud = createMemoryPostgresClient();
    const outbox = createTodosShadowOutbox({ db, postgresClient: cloud.client });
    const local = createLocalSqliteTodosStorageAdapter({ db });
    const project = await local.projects.create({ name: "Machine path", path: "/tmp/ob-machine-path" });
    const machinePath = setMachineLocalPath(project.id, "/tmp/ob-machine-path", db);

    const rows = outboxRows(db);
    const captured = new Set(rows.map((r) => `${r.object_type}:${r.object_id}`));
    expect(captured.has(`project_machine_paths:${machinePath.id}`)).toBe(true);

    await outbox.flush();
    expect(cloud.rows.get(`todos:project_machine_paths:${machinePath.id}`)?.payload)
      .toMatchObject({ id: machinePath.id, project_id: project.id, path: "/tmp/ob-machine-path" });
  });

  test("coalesces repeated writes to one pending row per object", async () => {
    createTodosShadowOutbox({ db, postgresClient: createMemoryPostgresClient().client });
    const local = createLocalSqliteTodosStorageAdapter({ db });
    const task = await local.tasks.create({ title: "T" });
    const v1 = await local.tasks.update(task.id, { title: "T2", version: task.version });
    await local.tasks.update(task.id, { title: "T3", version: v1.version });
    const pendingForTask = outboxRows(db).filter((r) => r.object_type === "tasks" && r.object_id === task.id);
    expect(pendingForTask.length).toBe(1);
  });

  test("drains pending rows to cloud and removes them; reads stay local", async () => {
    const cloud = createMemoryPostgresClient();
    const outbox = createTodosShadowOutbox({ db, postgresClient: cloud.client });
    const local = createLocalSqliteTodosStorageAdapter({ db });
    const project = await local.projects.create({ name: "P", path: "/tmp/ob-drain" });
    const task = await local.tasks.create({ title: "Drain me", project_id: project.id });

    await outbox.flush();

    expect(cloud.rows.get(`todos:tasks:${task.id}`)?.payload).toMatchObject({ id: task.id, title: "Drain me" });
    expect(cloud.rows.get(`todos:projects:${project.id}`)?.payload).toMatchObject({ id: project.id });
    const stats = outbox.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.mirrored).toBeGreaterThanOrEqual(2);
    expect(stats.failed).toBe(0);
    // Local read still works.
    expect(await local.tasks.get(task.id)).toMatchObject({ id: task.id });
  });

  test("deletes are mirrored as tombstones", async () => {
    const cloud = createMemoryPostgresClient();
    const outbox = createTodosShadowOutbox({ db, postgresClient: cloud.client });
    const local = createLocalSqliteTodosStorageAdapter({ db });
    const task = await local.tasks.create({ title: "Doomed" });
    await outbox.flush();
    await local.tasks.delete(task.id);
    await outbox.flush();
    expect(cloud.rows.get(`todos:tasks:${task.id}`)?.deletedAt).toBeTruthy();
  });

  test("keeps a newer write pending when it lands during an in-flight drain", async () => {
    let releasePush!: () => void;
    let insertStarted!: () => void;
    const insertStartedPromise = new Promise<void>((resolve) => { insertStarted = resolve; });
    const releasePushPromise = new Promise<void>((resolve) => { releasePush = resolve; });
    let paused = false;
    const cloud = createMemoryPostgresClient({
      async onInsert() {
        if (paused) return;
        paused = true;
        insertStarted();
        await releasePushPromise;
      },
    });
    const outbox = createTodosShadowOutbox({ db, postgresClient: cloud.client });
    const local = createLocalSqliteTodosStorageAdapter({ db });
    const task = await local.tasks.create({ title: "Before drain" });

    const draining = outbox.drainOnce();
    await insertStartedPromise;
    const updated = await local.tasks.update(task.id, { title: "During drain", version: task.version });
    expect(updated?.title).toBe("During drain");
    releasePush();
    await draining;

    const pending = outboxRows(db).filter((row) => row.object_type === "tasks" && row.object_id === task.id);
    expect(pending.length).toBe(1);
    await outbox.flush();

    expect(cloud.rows.get(`todos:tasks:${task.id}`)?.payload).toMatchObject({
      id: task.id,
      title: "During drain",
    });
    expect(outbox.getStats().pending).toBe(0);
  });

  test("unreachable cloud DEFERS: rows stay pending with backoff, then park as failed", async () => {
    const cloud = createMemoryPostgresClient({ failForever: true });
    const outbox = new TodosShadowOutbox({ db, postgresClient: cloud.client, maxRetries: 2, retryBaseMs: 1 });
    outbox.install();
    const local = createLocalSqliteTodosStorageAdapter({ db });
    const task = await local.tasks.create({ title: "Deferred" });

    // First drain: push fails, row stays pending with attempts=1.
    await outbox.drainOnce();
    let row = outboxRows(db).find((r) => r.object_id === task.id);
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(1);

    // Force the backoff window open and keep draining until it parks.
    for (let i = 0; i < 5; i++) {
      db.run(`UPDATE shadow_outbox SET next_attempt_at = 0 WHERE object_id = ?`, [task.id]);
      await outbox.drainOnce();
    }
    row = outboxRows(db).find((r) => r.object_id === task.id);
    expect(row?.status).toBe("failed");
    expect(outbox.getStats().failed).toBe(1);
    // Nothing was dropped silently — it is a visible divergence row.
    expect(cloud.rows.size).toBe(0);
  });
});

describe("durable shadow outbox: kill-and-restart", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "todos-outbox-"));
    dbPath = join(dir, "todos.db");
    process.env["TODOS_DB_PATH"] = dbPath;
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env["TODOS_DB_PATH"];
    rmSync(dir, { recursive: true, force: true });
  });

  test("pending outbox survives a process kill and drains after restart", async () => {
    // Guard for the deferred-backoff wait window.

    // --- Process 1: writes accumulate durably, then the process "crashes"
    // before any drain loop gets a chance to run.
    const db1 = getDatabase(dbPath);
    const outbox1 = createTodosShadowOutbox({ db: db1, postgresClient: createMemoryPostgresClient().client });
    const local1 = createLocalSqliteTodosStorageAdapter({ db: db1 });
    const project = await local1.projects.create({ name: "Persisted", path: "/tmp/ob-restart" });
    const t1 = await local1.tasks.create({ title: "Survivor 1", project_id: project.id });
    const t2 = await local1.tasks.create({ title: "Survivor 2", project_id: project.id });
    expect(outbox1.getStats().pending).toBeGreaterThanOrEqual(3);

    // Simulate an abrupt kill: drop the singleton + handle without draining.
    closeDatabase();

    // --- Process 2: fresh DB handle on the SAME file, cloud is back UP. ---
    resetDatabase();
    const db2 = getDatabase(dbPath);
    // The durable queue persisted across the "restart".
    const persisted = outboxRows(db2);
    const ids = new Set(persisted.map((r) => r.object_id));
    expect(ids.has(t1.id)).toBe(true);
    expect(ids.has(t2.id)).toBe(true);
    expect(ids.has(project.id)).toBe(true);

    const up = createMemoryPostgresClient();
    const outbox2 = createTodosShadowOutbox({ db: db2, postgresClient: up.client });
    await outbox2.flush(3_000);

    expect(up.rows.get(`todos:tasks:${t1.id}`)?.payload).toMatchObject({ id: t1.id });
    expect(up.rows.get(`todos:tasks:${t2.id}`)?.payload).toMatchObject({ id: t2.id });
    expect(up.rows.get(`todos:projects:${project.id}`)?.payload).toMatchObject({ id: project.id });
    expect(outbox2.getStats().pending).toBe(0);
  }, 15_000);
});
