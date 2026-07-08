import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { listMachineLocalPaths, removeMachineLocalPath, setMachineLocalPath } from "../db/projects.js";
import { runMigrations } from "../db/schema.js";
import {
  addTaskRunArtifact,
  getTaskRunLedger,
  startTaskRun,
  verifyTaskRunArtifacts,
} from "../db/task-runs.js";
import { artifactStorePath } from "../lib/artifact-store.js";
import {
  CANONICAL_TODOS_RDS_CLUSTER,
  CANONICAL_TODOS_RDS_DATABASE,
  CANONICAL_TODOS_RDS_RUNTIME_PATH,
  STORAGE_TABLES,
  TODOS_STORAGE_ENV,
  TODOS_STORAGE_FALLBACK_ENV,
  buildS3ObjectKey,
  createHybridTodosStorageAdapter,
  createPostgresTodosSyncStore,
  createPostgresTodosStorageAdapter,
  createLocalSqliteTodosStorageAdapter,
  createTodosS3ArtifactStore,
  createTodosStorageAdapter,
  downloadRunArtifactsFromS3,
  getCanonicalTodosRdsConfig,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  loadTodosStorageConfig,
  loadStorageConfig,
  postgresTodosSyncSchemaSql,
  signAwsV4Request,
  uploadRunArtifactsToS3,
  type HybridTodosStorageAdapter,
  type TodosPostgresQueryClient,
  type TodosStorageAdapter,
  type TodosStorageSnapshot,
} from "../storage.js";
import { s3CredentialsFromEnv } from "../cli/commands/storage-commands.js";

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

describe("storage adapter contracts", () => {
  test("keeps pure storage interfaces independent of SQLite modules", () => {
    const source = readFileSync(new URL("./interfaces.ts", import.meta.url), "utf8");

    expect(source).not.toContain("bun:sqlite");
    expect(source).not.toContain("../db/");
    expect(source).toContain("interface TodosStorageAdapter");
    expect(source).toContain("interface TodosTaskStore");
    expect(source).toContain("interface TodosProjectStore");
    expect(source).toContain("interface TodosAgentStore");
    expect(source).toContain("interface TodosTemplateStore");
    expect(source).toContain("interface TodosAuditStore");
    expect(source).toContain("interface TodosSyncStore");
  });

  test("exposes the expected domain stores through the local SQLite adapter", () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });

    expect(adapter.kind).toBe("sqlite");
    expect(adapter.capabilities).toEqual({
      localPersistence: true,
      remotePersistence: false,
      transactions: true,
      auditLog: true,
      sync: true,
    });
    expectStore(adapter, "tasks", [
      "create",
      "get",
      "list",
      "count",
      "update",
      "delete",
      "start",
      "complete",
      "fail",
      "claimNext",
      "getNext",
      "getActiveWork",
      "getChangedSince",
    ]);
    expectStore(adapter, "projects", ["create", "get", "getByPath", "list", "update", "delete"]);
    expectStore(adapter, "plans", ["create", "get", "list", "update", "delete"]);
    expectStore(adapter, "agents", ["register", "get", "getByName", "list", "update"]);
    expectStore(adapter, "taskLists", ["create", "get", "getBySlug", "list", "update", "delete"]);
    expectStore(adapter, "templates", ["create", "get", "list", "update", "delete", "getWithTasks"]);
    expectStore(adapter, "audit", ["logTaskChange", "addComment", "getTaskHistory", "getRecentActivity"]);
    expectStore(adapter, "sync", ["getTasksChangedSince", "exportSnapshot", "importSnapshot"]);
  });

  test("delegates core task, project, plan, agent, template, audit, and sync operations", async () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });
    const project = await adapter.projects.create({
      name: "Storage Boundary",
      path: "/tmp/storage-boundary",
    });
    const taskList = await adapter.taskLists.create({
      name: "Storage List",
      slug: "storage-list",
      project_id: project.id,
    });
    const plan = await adapter.plans.create({
      name: "Storage Plan",
      project_id: project.id,
      task_list_id: taskList.id,
    });
    const agent = await adapter.agents.register({
      name: "storageagent",
      project_id: project.id,
      force: true,
    });
    if ("conflict" in agent) throw new Error(agent.message);

    const template = await adapter.templates.create({
      name: "Storage Template",
      title_pattern: "Template task",
      project_id: project.id,
      plan_id: plan.id,
      tasks: [{ title_pattern: "Template step", priority: "high" }],
    });
    const task = await adapter.tasks.create({
      title: "Use storage boundary",
      project_id: project.id,
      task_list_id: taskList.id,
      plan_id: plan.id,
      agent_id: agent.id,
      priority: "high",
      tags: ["storage"],
    });

    await adapter.audit.addComment({
      task_id: task.id,
      agent_id: agent.id,
      content: "Adapter comment",
    });
    await adapter.audit.logTaskChange(task.id, "test", "priority", "medium", "high", agent.id);
    const updated = await adapter.tasks.update(task.id, {
      version: task.version,
      priority: "critical",
    });

    expect(await adapter.projects.getByPath("/tmp/storage-boundary")).toMatchObject({ id: project.id });
    expect(await adapter.taskLists.getBySlug("storage-list", project.id)).toMatchObject({ id: taskList.id });
    expect(await adapter.plans.list(project.id)).toEqual([expect.objectContaining({ id: plan.id })]);
    expect(await adapter.agents.getByName("storageagent")).toMatchObject({ id: agent.id });
    expect(await adapter.templates.getWithTasks(template.id)).toMatchObject({
      id: template.id,
      tasks: [expect.objectContaining({ title_pattern: "Template step" })],
    });
    expect(updated.priority).toBe("critical");
    expect(await adapter.tasks.count({ project_id: project.id })).toBe(1);
    expect(await adapter.tasks.list({ tags: ["storage"] })).toEqual([
      expect.objectContaining({ id: task.id }),
    ]);
    expect(await adapter.audit.getTaskHistory(task.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "test" })]),
    );
    expect(await adapter.sync.getTasksChangedSince("1970-01-01T00:00:00.000Z", { project_id: project.id })).toEqual([
      expect.objectContaining({ id: task.id }),
    ]);
  });

  test("runs local adapter transactions against the same SQLite database", async () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });

    const task = await adapter.transaction!(async (storage) => {
      const project = await storage.projects.create({
        name: "Transactional Project",
        path: "/tmp/transactional-project",
      });
      return storage.tasks.create({
        title: "Created in transaction",
        project_id: project.id,
      });
    });

    expect(task.title).toBe("Created in transaction");
    expect(await adapter.tasks.get(task.id)).toMatchObject({ id: task.id });
  });

  test("exports and imports local SQLite snapshots through the storage adapter", async () => {
    const source = createLocalSqliteTodosStorageAdapter({ db });
    const project = await source.projects.create({ name: "Snapshot Project", path: "/tmp/snapshot-project" });
    const machinePath = setMachineLocalPath(project.id, "/machine/snapshot-project", db);
    const task = await source.tasks.create({
      title: "Snapshot task",
      project_id: project.id,
      tags: ["snapshot"],
      metadata: { source: "local" },
    });
    await source.audit.logTaskChange(task.id, "test", "status", "pending", "in_progress", "snapshot-agent");

    const snapshot = await source.sync.exportSnapshot!();
    const targetDb = new Database(":memory:");
    targetDb.run("PRAGMA foreign_keys = ON");
    runMigrations(targetDb);
    try {
      const target = createLocalSqliteTodosStorageAdapter({ db: targetDb });
      const imported = await target.sync.importSnapshot!(snapshot);

      expect(imported.errors).toEqual([]);
      expect(imported.inserted).toBeGreaterThanOrEqual(3);
      expect(await target.projects.get(project.id)).toMatchObject({ name: "Snapshot Project" });
      expect(listMachineLocalPaths(project.id, targetDb)).toEqual([
        expect.objectContaining({
          id: machinePath.id,
          path: "/machine/snapshot-project",
        }),
      ]);
      expect(await target.tasks.get(task.id)).toMatchObject({
        title: "Snapshot task",
        tags: ["snapshot"],
        metadata: { source: "local" },
      });
      expect(await target.audit.getTaskHistory(task.id)).toEqual([
        expect.objectContaining({ action: "test", agent_id: "snapshot-agent" }),
      ]);
    } finally {
      targetDb.close();
    }
  });

  test("propagates local hard deletes through explicit storage tombstones", async () => {
    const source = createLocalSqliteTodosStorageAdapter({ db });
    const project = await source.projects.create({ name: "Tombstone Project", path: "/tmp/tombstone-project" });
    const task = await source.tasks.create({
      title: "Delete me remotely",
      project_id: project.id,
      tags: ["tombstone"],
    });
    const initialSnapshot = await source.sync.exportSnapshot!();
    const targetDb = new Database(":memory:");
    targetDb.run("PRAGMA foreign_keys = ON");
    runMigrations(targetDb);
    try {
      const target = createLocalSqliteTodosStorageAdapter({ db: targetDb });
      await target.sync.importSnapshot!(initialSnapshot);
      expect(await target.tasks.get(task.id)).toMatchObject({ title: "Delete me remotely" });

      expect(await source.tasks.delete(task.id)).toBe(true);
      const deleteSnapshot = await source.sync.exportSnapshot!();
      expect(deleteSnapshot.tasks.map((item) => item.id)).not.toContain(task.id);
      expect(deleteSnapshot.tombstones).toEqual([
        expect.objectContaining({
          object_type: "tasks",
          object_id: task.id,
          payload: expect.objectContaining({ title: "Delete me remotely" }),
        }),
      ]);

      const imported = await target.sync.importSnapshot!(deleteSnapshot);
      expect(imported.errors).toEqual([]);
      expect(imported.deleted).toBe(1);
      expect(await target.tasks.get(task.id)).toBeNull();
    } finally {
      targetDb.close();
    }
  });

  test("does not resurrect locally deleted rows from stale SQLite snapshots", async () => {
    const source = createLocalSqliteTodosStorageAdapter({ db });
    const task = await source.tasks.create({ title: "Stale remote task" });
    const staleSnapshot = await source.sync.exportSnapshot!();
    const targetDb = new Database(":memory:");
    targetDb.run("PRAGMA foreign_keys = ON");
    runMigrations(targetDb);
    try {
      const target = createLocalSqliteTodosStorageAdapter({ db: targetDb });
      await target.sync.importSnapshot!(staleSnapshot);
      expect(await target.tasks.get(task.id)).toMatchObject({ title: "Stale remote task" });

      expect(await target.tasks.delete(task.id)).toBe(true);
      const imported = await target.sync.importSnapshot!(staleSnapshot);

      expect(imported.errors).toEqual([]);
      expect(imported.skipped).toBeGreaterThan(0);
      expect(await target.tasks.get(task.id)).toBeNull();
    } finally {
      targetDb.close();
    }
  });

  test("propagates non-task local hard deletes through explicit storage tombstones", async () => {
    const source = createLocalSqliteTodosStorageAdapter({ db });
    const project = await source.projects.create({ name: "Domain Tombstones", path: "/tmp/domain-tombstones" });
    const machinePath = setMachineLocalPath(project.id, "/machine/domain-tombstones", db);
    const taskList = await source.taskLists.create({ name: "Delete List", slug: "delete-list", project_id: project.id });
    const plan = await source.plans.create({ name: "Delete Plan", project_id: project.id, task_list_id: taskList.id });
    const template = await source.templates.create({ name: "Delete Template", title_pattern: "Delete task", project_id: project.id });
    const initialSnapshot = await source.sync.exportSnapshot!();
    const targetDb = new Database(":memory:");
    targetDb.run("PRAGMA foreign_keys = ON");
    runMigrations(targetDb);
    try {
      const target = createLocalSqliteTodosStorageAdapter({ db: targetDb });
      await target.sync.importSnapshot!(initialSnapshot);
      expect(await target.plans.get(plan.id)).toMatchObject({ name: "Delete Plan" });
      expect(await target.taskLists.get(taskList.id)).toMatchObject({ name: "Delete List" });
      expect(await target.templates.get(template.id)).toMatchObject({ name: "Delete Template" });
      expect(listMachineLocalPaths(project.id, targetDb)).toEqual([
        expect.objectContaining({ id: machinePath.id }),
      ]);

      expect(await source.plans.delete(plan.id)).toBe(true);
      expect(await source.taskLists.delete(taskList.id)).toBe(true);
      expect(await source.templates.delete(template.id)).toBe(true);
      expect(removeMachineLocalPath(project.id, machinePath.machine_id, db)).toBe(true);
      const deleteSnapshot = await source.sync.exportSnapshot!();
      expect(deleteSnapshot.tombstones?.map((tombstone) => tombstone.object_type)).toEqual(
        expect.arrayContaining(["plans", "task_lists", "templates", "project_machine_paths"]),
      );

      const imported = await target.sync.importSnapshot!(deleteSnapshot);
      expect(imported.errors).toEqual([]);
      expect(imported.deleted).toBeGreaterThanOrEqual(4);
      expect(await target.plans.get(plan.id)).toBeNull();
      expect(await target.taskLists.get(taskList.id)).toBeNull();
      expect(await target.templates.get(template.id)).toBeNull();
      expect(listMachineLocalPaths(project.id, targetDb)).toEqual([]);
    } finally {
      targetDb.close();
    }
  });

  test("loads local storage by default and ignores legacy hosted env names", () => {
    const config = loadTodosStorageConfig({
      TODOS_MODE: "remote",
      TODOS_API_URL: "https://todos.example.test/api",
      HASNA_TODOS_DATABASE_URL: "postgres://remote/ignored-until-mode-is-explicit",
    });

    expect(config.mode).toBe("local");
    expect(config.database?.url).toBe("postgres://remote/ignored-until-mode-is-explicit");
    expect(createTodosStorageAdapter({ config, local: { db } }).kind).toBe("sqlite");
  });

  test("parses explicit native remote RDS and S3 config", () => {
    const config = loadTodosStorageConfig({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
      HASNA_TODOS_DATABASE_SCHEMA: "todos_prod",
      HASNA_TODOS_S3_BUCKET: "hasna-xyz-opensource-todos-prod",
      HASNA_TODOS_S3_PREFIX: "todos/",
      HASNA_TODOS_AWS_REGION: "us-east-1",
      HASNA_TODOS_SYNC_BATCH_SIZE: "1000",
    });

    expect(config).toMatchObject({
      service: "todos",
      mode: "remote",
      database: {
        provider: "postgres",
        url: "postgres://todos@rds.example/todos",
        ssl: true,
        schema: "todos_prod",
      },
      objectStorage: {
        provider: "s3",
        bucket: "hasna-xyz-opensource-todos-prod",
        prefix: "todos/",
        region: "us-east-1",
        forcePathStyle: false,
      },
      sync: {
        batchSize: 1000,
        dryRun: false,
      },
    });
  });

  test("supports plain todos storage fallbacks while keeping canonical names", () => {
    const env = {
      TODOS_STORAGE_MODE: "hybrid",
      TODOS_DATABASE_URL: "postgres://todos@rds.example/fallback",
      TODOS_DATABASE_SCHEMA: "todos_fallback",
      TODOS_S3_BUCKET: "todos-artifacts",
      TODOS_S3_PREFIX: "fallback/todos/",
      TODOS_AWS_REGION: "eu-central-1",
      TODOS_SYNC_BATCH_SIZE: "250",
      TODOS_SYNC_DRY_RUN: "true",
    };
    const config = loadStorageConfig(env);

    expect(config).toMatchObject({
      service: "todos",
      mode: "hybrid",
      database: {
        provider: "postgres",
        url: "postgres://todos@rds.example/fallback",
        schema: "todos_fallback",
      },
      objectStorage: {
        bucket: "todos-artifacts",
        prefix: "fallback/todos/",
        region: "eu-central-1",
      },
      sync: {
        batchSize: 250,
        dryRun: true,
      },
    });
    expect(STORAGE_TABLES).toEqual(["todos_sync_records", "todos_sync_cursors"]);
    expect(TODOS_STORAGE_ENV.databaseUrl).toBe("HASNA_TODOS_DATABASE_URL");
    expect(TODOS_STORAGE_FALLBACK_ENV.databaseUrl).toBe("TODOS_DATABASE_URL");
    expect(getStorageMode(env)).toBe("hybrid");
    expect(getStorageDatabaseEnv(env)).toBe("TODOS_DATABASE_URL");
    expect(getStorageDatabaseUrl(env)).toBe("postgres://todos@rds.example/fallback");
  });

  test("documents the canonical Hasna XYZ RDS target", () => {
    expect(getCanonicalTodosRdsConfig()).toEqual({
      cluster: CANONICAL_TODOS_RDS_CLUSTER,
      database: CANONICAL_TODOS_RDS_DATABASE,
      runtimeSecretPath: CANONICAL_TODOS_RDS_RUNTIME_PATH,
      primaryEnv: TODOS_STORAGE_ENV.databaseUrl,
      fallbackEnv: TODOS_STORAGE_FALLBACK_ENV.databaseUrl,
    });
    expect(CANONICAL_TODOS_RDS_CLUSTER).toBe("hasna-xyz-infra-apps-prod-postgres");
    expect(CANONICAL_TODOS_RDS_DATABASE).toBe("todos");
    expect(CANONICAL_TODOS_RDS_RUNTIME_PATH).toBe("hasna/xyz/opensource/todos/prod/rds");
  });

  test("rejects remote mode when no remote adapter or Postgres client is supplied", () => {
    const config = loadTodosStorageConfig({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
    });

    expect(() => createTodosStorageAdapter({ config, local: { db } })).toThrow("remote storage requires");
    expect(createTodosStorageAdapter({ config, remoteAdapter: fakeRemoteAdapter() }).kind).toBe("postgres");
  });

  test("builds a pure remote Postgres adapter from native config and caller-provided client", async () => {
    const postgres = createMemoryPostgresClient();
    const config = loadTodosStorageConfig({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
    });
    const adapter = createTodosStorageAdapter({
      config,
      local: { db },
      postgresClient: postgres.client,
      hybrid: { sourceMachineId: "apple06" },
    });

    const project = await adapter.projects.create(
      { name: "Remote Project", path: "/tmp/remote-project" },
      { requestId: "apple06" },
    );
    const task = await adapter.tasks.create(
      {
        title: "Remote storage task",
        project_id: project.id,
        tags: ["remote"],
      },
      { requestId: "apple06" },
    );
    const updated = await adapter.tasks.update(task.id, {
      version: task.version,
      priority: "high",
      metadata: { source: "postgres" },
    });
    const started = await adapter.tasks.start(task.id, "remote-agent");
    const active = await adapter.tasks.getActiveWork({ project_id: project.id });
    const completed = await adapter.tasks.complete(task.id, "remote-agent", {
      confidence: 0.92,
      completed_at: "2026-06-08T12:00:00.000Z",
    });
    await adapter.audit.addComment({
      task_id: task.id,
      content: "Remote adapter comment",
      agent_id: "remote-agent",
    });
    const snapshot = await adapter.sync.exportSnapshot!();

    expect(adapter.kind).toBe("postgres");
    expect(adapter.capabilities).toEqual({
      localPersistence: false,
      remotePersistence: true,
      transactions: false,
      auditLog: true,
      sync: true,
    });
    expect(project.task_prefix).toBe("RP");
    expect(task.short_id).toBe("RP-00001");
    expect(await adapter.projects.getByPath("/tmp/remote-project")).toMatchObject({ id: project.id });
    expect(await adapter.tasks.count({ project_id: project.id })).toBe(1);
    expect(await adapter.tasks.list({ tags: ["remote"] })).toEqual([
      expect.objectContaining({ id: task.id }),
    ]);
    expect(updated).toMatchObject({ priority: "high", metadata: { source: "postgres" } });
    expect(started.status).toBe("in_progress");
    expect(active).toEqual([expect.objectContaining({ id: task.id, locked_by: "remote-agent" })]);
    expect(completed).toMatchObject({
      status: "completed",
      completed_at: "2026-06-08T12:00:00.000Z",
      confidence: 0.92,
    });
    expect(snapshot).toMatchObject({
      source: "postgres",
      tasks: [expect.objectContaining({ id: task.id, status: "completed" })],
      projects: [expect.objectContaining({ id: project.id })],
    });
    expect(await adapter.audit.getRecentActivity(5)).toEqual(
      expect.arrayContaining([expect.objectContaining({ task_id: task.id })]),
    );
    expect(postgres.calls.some((call) => call.sql.includes("ON CONFLICT (service, object_type, object_id)"))).toBe(true);
    expect(postgres.calls.some((call) => call.values?.includes("apple06"))).toBe(true);
  });

  test("exposes the direct pure remote Postgres adapter factory", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const project = await adapter.projects.create({ name: "Direct Remote", path: "/tmp/direct-remote" });
    const taskList = await adapter.taskLists.create({ name: "Direct Remote List", slug: "direct-remote", project_id: project.id });
    const task = await adapter.tasks.create({ title: "Direct remote task", project_id: project.id, task_list_id: taskList.id });
    const plan = await adapter.plans.create({ name: "Direct Remote Plan", project_id: project.id, task_list_id: taskList.id });
    const agent = await adapter.agents.register({ name: "direct-remote-agent", project_id: project.id });
    if ("conflict" in agent) throw new Error(agent.message);
    const template = await adapter.templates.create({ name: "Direct Remote Template", title_pattern: "Direct ${name}" });
    await adapter.audit.logTaskChange(task.id, "updated", "status", "pending", "in_progress", agent.id);
    const snapshot = await adapter.sync.exportSnapshot!();

    expect(adapter.kind).toBe("postgres");
    expect(await adapter.tasks.get(task.id)).toMatchObject({
      title: "Direct remote task",
      short_id: "DR-00001",
    });
    expect(snapshot.projects).toEqual([expect.objectContaining({ id: project.id, machine_id: "spark01" })]);
    expect(snapshot.taskLists).toEqual([expect.objectContaining({ id: taskList.id, machine_id: "spark01" })]);
    expect(snapshot.tasks).toEqual([expect.objectContaining({ id: task.id, machine_id: "spark01" })]);
    expect(snapshot.plans).toEqual([expect.objectContaining({ id: plan.id, machine_id: "spark01" })]);
    expect(snapshot.agents).toEqual([expect.objectContaining({ id: agent.id, machine_id: "spark01" })]);
    expect(snapshot.templates).toEqual([expect.objectContaining({ id: template.id, machine_id: "spark01" })]);
    expect(snapshot.auditHistory).toEqual([
      expect.objectContaining({ task_id: task.id, machine_id: "spark01" }),
      expect.objectContaining({ task_id: task.id, machine_id: "spark01" }),
    ]);
    expect(postgres.calls.some((call) => call.values?.includes("spark01"))).toBe(true);
  });

  test("cloud adapter supports lock/unlock, dependencies and verifications on the shared dataset", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "spark01" });
    const project = await adapter.projects.create({ name: "Coord", path: "/tmp/coord" });
    const a = await adapter.tasks.create({ title: "Task A", project_id: project.id });
    const b = await adapter.tasks.create({ title: "Task B", project_id: project.id });

    // lock / unlock (task-field coordination)
    const lock = await adapter.tasks.lock!(a.id, "seneca");
    expect(lock).toMatchObject({ success: true, locked_by: "seneca" });
    expect(await adapter.tasks.get(a.id)).toMatchObject({ locked_by: "seneca" });
    // a different agent cannot steal a live lock
    const contested = await adapter.tasks.lock!(a.id, "brutus");
    expect(contested).toMatchObject({ success: false, locked_by: "seneca" });
    // wrong-agent unlock is rejected
    await expect(Promise.resolve(adapter.tasks.unlock!(a.id, "brutus"))).rejects.toBeDefined();
    expect(await adapter.tasks.unlock!(a.id, "seneca")).toBe(true);
    expect(await adapter.tasks.get(a.id)).toMatchObject({ locked_by: null });
    // completed tasks cannot be locked
    await adapter.tasks.complete(b.id, "seneca");
    expect(await adapter.tasks.lock!(b.id, "seneca")).toMatchObject({ success: false });

    // dependencies (A depends on B)
    const dep = await adapter.dependencies!.add(a.id, b.id);
    expect(dep).toEqual({ task_id: a.id, depends_on: b.id });
    const edges = await adapter.dependencies!.list(a.id);
    expect(edges.dependencies).toEqual([{ task_id: a.id, depends_on: b.id }]);
    expect((await adapter.dependencies!.list(b.id)).blocked_by).toEqual([{ task_id: a.id, depends_on: b.id }]);
    // cycle guard: B depends on A would close a loop
    await expect(Promise.resolve(adapter.dependencies!.add(b.id, a.id))).rejects.toThrow(/cycle/);
    // missing task rejected
    await expect(Promise.resolve(adapter.dependencies!.add(a.id, "nope"))).rejects.toThrow(/not found/);
    expect(await adapter.dependencies!.remove(a.id, b.id)).toBe(true);
    expect(await adapter.dependencies!.remove(a.id, b.id)).toBe(false);

    // verifications (attached to a real cloud task)
    const v = await adapter.verifications!.add({ task_id: a.id, command: "bun test", status: "passed", agent_id: "seneca" });
    expect(v).toMatchObject({ task_id: a.id, command: "bun test", status: "passed" });
    expect(await adapter.verifications!.list(a.id)).toEqual([expect.objectContaining({ id: v.id })]);
    // verification on a missing task fails loudly (parity with the local FK)
    await expect(Promise.resolve(adapter.verifications!.add({ task_id: "nope", command: "x" }))).rejects.toThrow(/not found/);
  });

  test("cloud adapter supports agent heartbeat/release and commit/ref links on the shared dataset", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "spark01" });
    const project = await adapter.projects.create({ name: "Ident", path: "/tmp/ident" });
    const task = await adapter.tasks.create({ title: "Linkable", project_id: project.id });
    const agent = await adapter.agents.register({ name: "cato", project_id: project.id, session_id: "sess-1" });
    if ("conflict" in agent) throw new Error(agent.message);

    // heartbeat resolves by id AND by name, refreshing last_seen_at
    const before = agent.last_seen_at;
    await new Promise((r) => setTimeout(r, 2));
    const beat = await adapter.agents.heartbeat!(agent.id);
    expect(beat?.id).toBe(agent.id);
    expect(beat!.last_seen_at >= before).toBe(true);
    expect((await adapter.agents.heartbeat!("cato"))?.id).toBe(agent.id);
    expect(await adapter.agents.heartbeat!("ghost")).toBeNull();

    // release with a mismatched session is denied; a matching one clears the binding
    expect(await adapter.agents.release!(agent.id, "wrong")).toMatchObject({ released: false });
    const released = await adapter.agents.release!("cato", "sess-1");
    expect(released).toMatchObject({ released: true });
    expect(released!.agent.session_id).toBeNull();
    expect(await adapter.agents.release!("ghost")).toBeNull();

    // commit links attach to the REAL cloud task (parity with the local FK)
    const commit = await adapter.commits!.add({ task_id: task.id, sha: "abc1234def", message: "fix: thing", author: "cato" });
    expect(commit).toMatchObject({ task_id: task.id, sha: "abc1234def" });
    expect(await adapter.commits!.list(task.id)).toEqual([expect.objectContaining({ id: commit.id })]);
    expect((await adapter.commits!.find("abc1234"))?.id).toBe(commit.id);
    await expect(Promise.resolve(adapter.commits!.add({ task_id: "nope", sha: "x" }))).rejects.toThrow(/not found/);

    // ref links (branch/PR) attach to the real task and are findable by name
    const ref = await adapter.gitRefs!.add({ task_id: task.id, ref_type: "pull_request", name: "PR-7", url: "https://example/pr/7" });
    expect(ref).toMatchObject({ task_id: task.id, ref_type: "pull_request", name: "PR-7" });
    expect(await adapter.gitRefs!.list(task.id)).toEqual([expect.objectContaining({ id: ref.id })]);
    expect((await adapter.gitRefs!.find("PR-7")).map((r) => r.id)).toEqual([ref.id]);
    await expect(Promise.resolve(adapter.gitRefs!.add({ task_id: "nope", ref_type: "branch", name: "b" }))).rejects.toThrow(/not found/);
  });

  test("pushes task filtering, count and pagination down to SQL (no whole-table load)", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const project = await adapter.projects.create({ name: "Paginate", path: "/tmp/paginate" });
    // Seed a mix of statuses and priorities.
    for (let n = 0; n < 6; n++) {
      await adapter.tasks.create({
        title: `task-${n}`,
        project_id: project.id,
        status: n % 2 === 0 ? "pending" : "completed",
        priority: n < 2 ? "critical" : "low",
      });
    }

    // count() must issue a SQL COUNT(*) — never materialize the table in JS.
    postgres.calls.length = 0;
    expect(await adapter.tasks.count({ project_id: project.id })).toBe(6);
    expect(await adapter.tasks.count({ project_id: project.id, status: "pending" })).toBe(3);
    expect(postgres.calls.every((c) => !c.sql.includes("todos:list-tasks"))).toBe(true);
    expect(postgres.calls.some((c) => c.sql.includes("todos:count-tasks") && c.sql.includes("COUNT(*)"))).toBe(true);

    // Filter by status via SQL.
    const pending = await adapter.tasks.list({ project_id: project.id, status: "pending" });
    expect(pending).toHaveLength(3);
    expect(pending.every((t) => t.status === "pending")).toBe(true);

    // Priority-then-created_at ordering preserved (critical first).
    const ordered = await adapter.tasks.list({ project_id: project.id });
    expect(ordered.slice(0, 2).every((t) => t.priority === "critical")).toBe(true);

    // LIMIT/OFFSET pagination via SQL.
    const page1 = await adapter.tasks.list({ project_id: project.id, limit: 2, offset: 0 });
    const page2 = await adapter.tasks.list({ project_id: project.id, limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1.map((t) => t.id)).not.toEqual(page2.map((t) => t.id));
    expect(postgres.calls.some((c) => c.sql.includes("todos:list-tasks") && /LIMIT \$\d+/.test(c.sql))).toBe(true);
    // offset:0 omits OFFSET; the offset:2 page must emit an OFFSET placeholder.
    expect(postgres.calls.some((c) => c.sql.includes("todos:list-tasks") && /OFFSET \$\d+/.test(c.sql))).toBe(true);
  });

  test("filters by id set including subtasks (POST /v1/tasks/exists parity check)", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const project = await adapter.projects.create({ name: "Exists", path: "/tmp/exists" });
    const parent = await adapter.tasks.create({ title: "parent", project_id: project.id });
    const child = await adapter.tasks.create({ title: "child", project_id: project.id, parent_id: parent.id });

    // Default list EXCLUDES subtasks — a naive parity check would miss the child.
    const topLevel = await adapter.tasks.list({ project_id: project.id });
    expect(topLevel.map((t) => t.id)).toEqual([parent.id]);

    // The exists query: id set + include_subtasks must return BOTH rows, so the
    // subtask is provably present in cloud (not a false "missing").
    const found = await adapter.tasks.list({
      ids: [parent.id, child.id, "missing-id-xyz"],
      include_subtasks: true,
      limit: 3,
    });
    const foundIds = new Set(found.map((t) => t.id));
    expect(foundIds.has(parent.id)).toBe(true);
    expect(foundIds.has(child.id)).toBe(true);
    expect(foundIds.has("missing-id-xyz")).toBe(false);

    // tasks_all counterpart: count with include_subtasks sees every row.
    expect(await adapter.tasks.count({ project_id: project.id })).toBe(1);
    expect(await adapter.tasks.count({ project_id: project.id, include_subtasks: true })).toBe(2);
  });

  test("matches SQLite plan slug semantics in the direct Postgres adapter", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const project = await adapter.projects.create({ name: "Remote Slugs", path: "/tmp/remote-slugs" });
    const otherProject = await adapter.projects.create({ name: "Other Remote Slugs", path: "/tmp/other-remote-slugs" });

    const explicit = await adapter.plans.create({
      name: "Remote Explicit",
      slug: "Remote Explicit!",
      project_id: project.id,
    });
    const firstDuplicate = await adapter.plans.create({ name: "Remote Duplicate", project_id: project.id });
    const secondDuplicate = await adapter.plans.create({ name: "Remote Duplicate", project_id: project.id });
    const crossProject = await adapter.plans.create({
      name: "Remote Explicit",
      slug: "remote-explicit",
      project_id: otherProject.id,
    });

    expect(explicit.slug).toBe("remote-explicit");
    expect(firstDuplicate.slug).toBe("remote-duplicate");
    expect(secondDuplicate.slug).toBe("remote-duplicate-2");
    expect(crossProject.slug).toBe("remote-explicit");
    await expect(adapter.plans.create({
      name: "Conflicting Explicit",
      slug: "remote explicit",
      project_id: project.id,
    })).rejects.toThrow("Plan slug already exists in this scope: remote-explicit");
  });

  test("preserves direct Postgres tombstone clocks and rejects stale import records", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const task = await adapter.tasks.create({ title: "Protected remote task" }, { requestId: "spark01" });
    const updated = await adapter.tasks.update(task.id, {
      version: task.version,
      title: "Protected remote task updated",
    });
    const staleSnapshot: TodosStorageSnapshot = {
      exportedAt: "2026-06-08T00:00:00.000Z",
      source: "sqlite",
      tasks: [],
      projects: [],
      plans: [],
      agents: [],
      taskLists: [],
      templates: [],
      auditHistory: [],
      tombstones: [{
        object_type: "tasks",
        object_id: task.id,
        deleted_at: "2000-01-01T00:00:00.000Z",
        updated_at: "2000-01-01T00:00:00.000Z",
        payload: { id: task.id, title: "stale delete" },
      }],
    };

    const staleDelete = await adapter.sync.importSnapshot!(staleSnapshot);
    expect(staleDelete.skipped).toBe(1);
    expect(await adapter.tasks.get(task.id)).toMatchObject({
      id: task.id,
      title: "Protected remote task updated",
    });

    const deleteSnapshot: TodosStorageSnapshot = {
      exportedAt: "2030-01-01T00:00:00.000Z",
      source: "sqlite",
      tasks: [],
      projects: [],
      plans: [],
      agents: [],
      taskLists: [],
      templates: [],
      auditHistory: [],
      tombstones: [{
        object_type: "tasks",
        object_id: "deleted-remote-task",
        deleted_at: "2030-01-01T00:00:00.000Z",
        updated_at: "2030-01-01T00:00:00.000Z",
        payload: { id: "deleted-remote-task", title: "deleted remotely" },
      }],
    };
    const deleteImport = await adapter.sync.importSnapshot!(deleteSnapshot);
    expect(deleteImport.deleted).toBe(1);

    const staleLiveSnapshot: TodosStorageSnapshot = {
      exportedAt: "2020-01-01T00:00:00.000Z",
      source: "sqlite",
      tasks: [{
        id: "deleted-remote-task",
        title: "stale live row",
        status: "pending",
        priority: "medium",
        tags: [],
        metadata: {},
        version: 1,
        created_at: "2020-01-01T00:00:00.000Z",
        updated_at: "2020-01-01T00:00:00.000Z",
      } as TodosStorageSnapshot["tasks"][number]],
      projects: [],
      plans: [],
      agents: [],
      taskLists: [],
      templates: [],
      auditHistory: [],
    };
    await adapter.sync.importSnapshot!(staleLiveSnapshot);
    const exported = await adapter.sync.exportSnapshot!();

    expect(await adapter.tasks.get("deleted-remote-task")).toBeNull();
    expect(exported.tombstones).toEqual([
      expect.objectContaining({
        object_type: "tasks",
        object_id: "deleted-remote-task",
        deleted_at: "2030-01-01T00:00:00.000Z",
      }),
    ]);
    expect(updated.version).toBe(task.version + 1);
  });

  test("builds a hybrid local plus Postgres sync adapter from native config", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client = {
      async query(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        if (sql.includes("SELECT object_type")) {
          return {
            rows: [
              {
                object_type: "tasks",
                payload: {
                  id: "remote-task-1",
                  title: "Pulled remote task",
                  status: "pending",
                  priority: "medium",
                  tags: ["remote"],
                  metadata: { source: "postgres" },
                  version: 1,
                  requires_approval: false,
                  created_at: "2026-06-08T00:00:00.000Z",
                  updated_at: "2026-06-08T00:00:00.000Z",
                },
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const config = loadTodosStorageConfig({
      HASNA_TODOS_STORAGE_MODE: "hybrid",
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
    });
    const adapter = createTodosStorageAdapter({
      config,
      local: { db },
      postgresClient: client,
      hybrid: { sourceMachineId: "apple06" },
    }) as HybridTodosStorageAdapter;

    await adapter.tasks.create({
      title: "Local hybrid task",
      tags: ["hybrid"],
    });
    const pushed = await adapter.remote.pushSnapshot();
    const pulled = await adapter.remote.pullSnapshot({ objectTypes: ["tasks"] });

    expect(adapter.kind).toBe("hybrid");
    expect(adapter.capabilities).toMatchObject({ localPersistence: true, remotePersistence: true });
    expect(pushed.objectTypes.tasks).toBe(1);
    expect(pulled.errors).toEqual([]);
    expect(await adapter.tasks.get("remote-task-1")).toMatchObject({
      title: "Pulled remote task",
      tags: ["remote"],
    });
    expect(calls.some((call) => call.sql.includes("ON CONFLICT (service, object_type, object_id)"))).toBe(true);
    expect(calls.some((call) => call.values?.includes("apple06"))).toBe(true);
  });

  test("rejects remote mode without the required Postgres database URL", () => {
    const config = loadTodosStorageConfig({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_S3_BUCKET: "hasna-xyz-opensource-todos-prod",
    });

    expect(() => createTodosStorageAdapter({ config, local: { db } })).toThrow("HASNA_TODOS_DATABASE_URL is required");
  });

  test("defines RDS-friendly Postgres sync schema without unsafe identifiers", () => {
    const schema = postgresTodosSyncSchemaSql();

    expect(schema.join("\n")).toContain("CREATE TABLE IF NOT EXISTS todos_sync_records");
    expect(schema.join("\n")).toContain("payload jsonb NOT NULL");
    expect(schema.join("\n")).toContain("CREATE TABLE IF NOT EXISTS todos_sync_cursors");
    expect(() => postgresTodosSyncSchemaSql("todos;drop")).toThrow("Unsafe Postgres identifier");
  });

  test("pushes and pulls snapshots through a caller-provided Postgres client", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const rows = [
      {
        object_type: "tasks",
        payload: {
          id: "task-1",
          title: "Remote task",
          status: "pending",
          priority: "medium",
          tags: [],
          metadata: {},
          created_at: "2026-06-08T00:00:00.000Z",
          updated_at: "2026-06-08T00:00:00.000Z",
        },
      },
    ];
    const client = {
      async query(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        return { rows: sql.includes("SELECT object_type") ? rows : [] };
      },
    };
    const store = createPostgresTodosSyncStore(client, { sourceMachineId: "apple06" });
    const snapshot: TodosStorageSnapshot = {
      exportedAt: "2026-06-08T00:00:01.000Z",
      source: "sqlite",
      tasks: [
        {
          id: "task-1",
          title: "Remote task",
          status: "pending",
          priority: "medium",
          tags: [],
          metadata: {},
          version: 3,
          created_at: "2026-06-08T00:00:00.000Z",
          updated_at: "2026-06-08T00:00:00.000Z",
        } as TodosStorageSnapshot["tasks"][number],
      ],
      projects: [],
      projectMachinePaths: [],
      plans: [],
      agents: [],
      taskLists: [],
      templates: [],
      auditHistory: [],
      tombstones: [],
    };

    await store.ensureSchema();
    const pushed = await store.pushSnapshot(snapshot);
    const pulled = await store.pullSnapshot({ since: "2026-06-07T00:00:00.000Z", objectTypes: ["tasks"] });
    await store.setCursor("pull", "2026-06-08T00:00:01.000Z");

    expect(pushed).toEqual({ records: 1, objectTypes: { tasks: 1 } });
    expect(calls.some((call) => call.sql.includes("ON CONFLICT (service, object_type, object_id)"))).toBe(true);
    expect(calls.some((call) => call.values?.includes("apple06"))).toBe(true);
    expect(pulled.tasks).toEqual([expect.objectContaining({ id: "task-1", title: "Remote task" })]);
    expect(calls.some((call) => call.sql.includes("object_type = ANY"))).toBe(true);
  });

  test("round-trips Postgres tombstones instead of filtering deletes out of pulls", async () => {
    const postgres = createMemoryPostgresClient();
    const local = createHybridTodosStorageAdapter({
      local: { db },
      postgresClient: postgres.client,
      sourceMachineId: "apple06",
    });
    const task = await local.tasks.create({ title: "Remote tombstone task" });

    await local.remote.pushSnapshot();
    expect(await local.tasks.delete(task.id)).toBe(true);
    await local.remote.pushSnapshot();

    const remote = createPostgresTodosSyncStore(postgres.client, { sourceMachineId: "spark01" });
    const snapshot = await remote.pullSnapshot({ objectTypes: ["tasks"] });

    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.tombstones).toEqual([
      expect.objectContaining({
        object_type: "tasks",
        object_id: task.id,
        payload: expect.objectContaining({ title: "Remote tombstone task" }),
      }),
    ]);
  });

  test("creates a hybrid adapter directly with a Postgres sync store", async () => {
    const calls: string[] = [];
    const syncStore = createPostgresTodosSyncStore({
      async query(sql: string) {
        calls.push(sql);
        return { rows: [] };
      },
    });
    const hybrid = createHybridTodosStorageAdapter({
      local: { db },
      syncStore,
    });

    await hybrid.remote.ensureSchema();

    expect(hybrid.kind).toBe("hybrid");
    expect(hybrid.capabilities.remotePersistence).toBe(true);
    expect(calls.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS todos_sync_records"))).toBe(true);
  });

  test("builds and signs S3 artifact requests without an SDK dependency", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const config = {
      provider: "s3" as const,
      bucket: "hasna-xyz-opensource-todos-prod",
      prefix: "todos/",
      region: "us-east-1",
      endpoint: "https://s3.example.test",
      forcePathStyle: true,
    };
    const store = createTodosS3ArtifactStore({
      config,
      credentials: {
        accessKeyId: "test-access",
        secretAccessKey: "test-secret",
      },
      now: () => new Date("2026-06-08T12:00:00.000Z"),
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: url.toString(), init });
        return new Response("", { status: 200, headers: { etag: "\"etag\"" } });
      }) as typeof fetch,
    });

    const ref = await store.putObject({
      key: "exports/report.json",
      body: "{}",
      contentType: "application/json",
      metadata: { run: "run-1" },
    });

    expect(buildS3ObjectKey(config, "exports/report.json")).toBe("todos/exports/report.json");
    expect(ref).toMatchObject({
      bucket: "hasna-xyz-opensource-todos-prod",
      key: "todos/exports/report.json",
      etag: "\"etag\"",
    });
    expect(requests[0]?.url).toBe("https://s3.example.test/hasna-xyz-opensource-todos-prod/todos/exports/report.json");
    expect((requests[0]?.init?.headers as Record<string, string>).authorization).toContain("AWS4-HMAC-SHA256");
    expect((requests[0]?.init?.headers as Record<string, string>)["x-amz-meta-run"]).toBe("run-1");
  });

  test("creates deterministic SigV4 headers for S3 requests", () => {
    const signed = signAwsV4Request({
      method: "GET",
      url: new URL("https://bucket.s3.us-east-1.amazonaws.com/todos/report.json"),
      region: "us-east-1",
      service: "s3",
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "secret",
      },
      now: new Date("2026-06-08T12:00:00.000Z"),
    });

    expect(signed.headers.authorization).toContain("Credential=AKIDEXAMPLE/20260608/us-east-1/s3/aws4_request");
    expect(signed.headers["x-amz-date"]).toBe("20260608T120000Z");
    expect(signed.canonicalRequest).toContain("/todos/report.json");
  });

  test("uploads and restores run artifact content through S3 artifact sync", async () => {
    const previousArtifactsDir = process.env["HASNA_TODOS_ARTIFACTS_DIR"];
    const artifactRoot = mkdtempSync(join(tmpdir(), "todos-storage-s3-artifacts-"));
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = artifactRoot;
    try {
      const adapter = createLocalSqliteTodosStorageAdapter({ db });
      const task = await adapter.tasks.create({ title: "Artifact sync task" });
      const run = startTaskRun({ task_id: task.id, title: "artifact sync" }, db);
      const sourcePath = join(artifactRoot, "evidence.log");
      writeFileSync(sourcePath, "s3 artifact ok\nTOKEN=secret-token-value\n");
      const artifact = addTaskRunArtifact({
        run_id: run.id,
        path: sourcePath,
        artifact_type: "log",
        store_content: true,
      }, db);
      const localStore = artifact.metadata["artifact_store"] as Record<string, unknown>;
      const storedPath = artifactStorePath(localStore["relative_path"] as string);
      expect(existsSync(storedPath)).toBe(true);

      const objects = new Map<string, Uint8Array>();
      const s3 = createTodosS3ArtifactStore({
        config: {
          provider: "s3",
          bucket: "hasna-xyz-opensource-todos-prod",
          prefix: "todos/",
          region: "us-east-1",
          endpoint: "https://s3.example.test",
          forcePathStyle: true,
        },
        credentials: {
          accessKeyId: "test-access",
          secretAccessKey: "test-secret",
        },
        now: () => new Date("2026-06-08T12:00:00.000Z"),
        fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
          const href = url.toString();
          if (init?.method === "PUT") {
            objects.set(href, init.body instanceof Uint8Array ? init.body : Buffer.from(String(init?.body ?? "")));
            return new Response("", { status: 200, headers: { etag: "\"etag\"" } });
          }
          if (init?.method === "GET" && objects.has(href)) {
            return new Response(objects.get(href), { status: 200 });
          }
          return new Response("", { status: 404 });
        }) as typeof fetch,
      });

      const uploaded = await uploadRunArtifactsToS3({
        store: s3,
        db,
        filter: { runId: run.id },
        now: () => new Date("2026-06-08T12:01:00.000Z"),
      });
      const remote = getTaskRunLedger(run.id, db).artifacts[0]!.metadata["remote_artifact_store"] as Record<string, unknown>;

      expect(uploaded).toMatchObject({ uploaded: 1, downloaded: 0, skipped: 0, errors: [] });
      expect(remote).toMatchObject({
        provider: "s3",
        bucket: "hasna-xyz-opensource-todos-prod",
        relative_path: localStore["relative_path"],
        sha256: artifact.sha256,
      });

      rmSync(storedPath);
      expect(verifyTaskRunArtifacts(run.id, db)[0]!.status).toBe("missing");

      const downloaded = await downloadRunArtifactsFromS3({
        store: s3,
        db,
        filter: { runId: run.id },
        now: () => new Date("2026-06-08T12:02:00.000Z"),
      });

      expect(downloaded).toMatchObject({ uploaded: 0, downloaded: 1, skipped: 0, errors: [] });
      expect(verifyTaskRunArtifacts(run.id, db)[0]!.status).toBe("ok");
      expect(readFileSync(storedPath, "utf8")).toContain("s3 artifact ok");
      expect(readFileSync(storedPath, "utf8")).not.toContain("secret-token-value");
    } finally {
      if (previousArtifactsDir === undefined) delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
      else process.env["HASNA_TODOS_ARTIFACTS_DIR"] = previousArtifactsDir;
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  });

  test("accepts fallback S3 credential env names for CLI apply mode", () => {
    expect(s3CredentialsFromEnv({
      TODOS_S3_ACCESS_KEY_ID: "fallback-access",
      TODOS_S3_SECRET_ACCESS_KEY: "fallback-secret",
      TODOS_S3_SESSION_TOKEN: "fallback-session",
    })).toEqual({
      accessKeyId: "fallback-access",
      secretAccessKey: "fallback-secret",
      sessionToken: "fallback-session",
    });
  });
});

function expectStore(
  adapter: TodosStorageAdapter,
  key: keyof Omit<TodosStorageAdapter, "kind" | "capabilities" | "transaction">,
  methods: string[],
) {
  const store = adapter[key] as Record<string, unknown>;
  for (const method of methods) {
    expect(typeof store[method]).toBe("function");
  }
}

function fakeRemoteAdapter(): TodosStorageAdapter {
  const local = createLocalSqliteTodosStorageAdapter({ db });
  return {
    ...local,
    kind: "postgres",
    capabilities: {
      ...local.capabilities,
      localPersistence: false,
      remotePersistence: true,
    },
  };
}

function createMemoryPostgresClient(): {
  client: TodosPostgresQueryClient;
  calls: Array<{ sql: string; values?: readonly unknown[] }>;
} {
  interface Row {
    service: string;
    objectType: string;
    objectId: string;
    payload: unknown;
    updatedAt: string;
    deletedAt: string | null;
    version: number | null;
  }

  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const rows = new Map<string, Row>();
  const cursors = new Map<string, string>();
  const recordKey = (service: unknown, objectType: unknown, objectId: unknown) =>
    `${String(service)}:${String(objectType)}:${String(objectId)}`;

  const client: TodosPostgresQueryClient = {
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });

      // SQL-side task list/count (buildTaskFilterSql). Resolve each predicate's
      // bound value(s) by the explicit `$N` placeholder index found in the SQL,
      // then filter/sort/paginate the in-memory rows. KEEP IN SYNC with
      // buildTaskFilterSql (jsonb operators + scalar IN expansion).
      if (sql.includes("todos:list-tasks") || sql.includes("todos:count-tasks")) {
        const service = values[0];
        // marker → the exact SQL text immediately preceding a `$N` placeholder.
        const grabScalar = (marker: string): unknown => {
          const idx = sql.indexOf(marker);
          if (idx < 0) return undefined;
          const m = sql.slice(idx + marker.length).match(/^\$(\d+)/);
          return m ? values[Number(m[1]) - 1] : undefined;
        };
        // colMarker → `<col> IN (`; returns the array of bound values in the list.
        const grabIn = (colMarker: string): unknown[] | undefined => {
          const idx = sql.indexOf(colMarker);
          if (idx < 0) return undefined;
          const rest = sql.slice(idx + colMarker.length);
          const group = rest.slice(0, rest.indexOf(")"));
          return [...group.matchAll(/\$(\d+)/g)].map((m) => values[Number(m[1]) - 1]);
        };
        const preds: Array<(t: Record<string, unknown>) => boolean> = [];
        if (sql.includes("payload->>'id' IN (")) {
          const ids = grabIn("payload->>'id' IN (")!;
          preds.push((t) => ids.includes(t["id"]));
        }
        if (sql.includes("payload->>'project_id' = $")) {
          const v = grabScalar("payload->>'project_id' = ");
          preds.push((t) => (t["project_id"] ?? null) === v);
        }
        if (sql.includes("payload->>'parent_id' IS NOT DISTINCT FROM")) {
          const v = grabScalar("payload->>'parent_id' IS NOT DISTINCT FROM ") ?? null;
          preds.push((t) => (t["parent_id"] ?? null) === v);
        }
        if (sql.includes("payload->>'plan_id' = $")) {
          const v = grabScalar("payload->>'plan_id' = ");
          preds.push((t) => (t["plan_id"] ?? null) === v);
        }
        if (sql.includes("payload->>'task_list_id' = $")) {
          const v = grabScalar("payload->>'task_list_id' = ");
          preds.push((t) => (t["task_list_id"] ?? null) === v);
        }
        if (sql.includes("payload->>'status' IN (")) {
          const arr = grabIn("payload->>'status' IN (")!;
          preds.push((t) => arr.includes(t["status"]));
        }
        if (sql.includes("payload->>'priority' IN (")) {
          const arr = grabIn("payload->>'priority' IN (")!;
          preds.push((t) => arr.includes(t["priority"]));
        }
        if (sql.includes("payload->>'assigned_to' = $")) {
          const v = grabScalar("payload->>'assigned_to' = ");
          preds.push((t) => (t["assigned_to"] ?? null) === v);
        }
        if (sql.includes("payload->>'agent_id' = $")) {
          const v = grabScalar("payload->>'agent_id' = ");
          preds.push((t) => (t["agent_id"] ?? null) === v);
        }
        if (sql.includes("payload->>'session_id' = $")) {
          const v = grabScalar("payload->>'session_id' = ");
          preds.push((t) => (t["session_id"] ?? null) === v);
        }
        if (sql.includes("payload->'tags' @>")) {
          const tags = grabScalar("payload->'tags' @> ") as string[];
          preds.push((t) => Array.isArray(t["tags"]) && tags.every((x) => (t["tags"] as string[]).includes(x)));
        }
        if (sql.includes("<> '') = $")) {
          const v = grabScalar("<> '') = ");
          preds.push((t) => Boolean(t["recurrence_rule"]) === v);
        }
        if (sql.includes("COALESCE(payload->>'task_type', '') IN (")) {
          const arr = grabIn("COALESCE(payload->>'task_type', '') IN (")!;
          preds.push((t) => arr.includes(t["task_type"] ?? ""));
        }
        if (sql.includes("payload->>'parent_id' IS NULL OR payload->>'parent_id' = ''")) {
          preds.push((t) => !t["parent_id"]);
        }
        let selected = [...rows.values()]
          .filter((row) => row.service === service && row.objectType === "tasks" && !row.deletedAt)
          .map((row) => row.payload as Record<string, unknown>)
          .filter((payload) => preds.every((pred) => pred(payload)));
        if (sql.includes("todos:count-tasks")) {
          return { rows: [{ count: selected.length }] as T[] };
        }
        const rank = (p: unknown) => ({ critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>)[String(p)] ?? 4;
        selected = selected.sort((a, b) =>
          rank(a["priority"]) - rank(b["priority"]) ||
          String(a["created_at"]).localeCompare(String(b["created_at"])));
        const limit = sql.includes("LIMIT $") ? Number(grabScalar("LIMIT ")) : undefined;
        const offset = sql.includes("OFFSET $") ? Number(grabScalar("OFFSET ")) : 0;
        const page = selected.slice(offset, limit === undefined ? undefined : offset + limit);
        return { rows: page.map((payload) => ({ payload })) as T[] };
      }

      if (sql.includes("INSERT INTO todos_sync_records")) {
        const [service, objectType, objectId, payload, updatedAt] = values;
        const syncStoreInsert = sql.includes("$6::timestamptz");
        const key = recordKey(service, objectType, objectId);
        const existing = rows.get(key);
        const nextUpdatedAt = String(updatedAt);
        const nextVersion = nullableNumber(syncStoreInsert ? values[7] : values[6]);
        // Conflict guard now resolves by (updated_at, version); detect it by the
        // EXCLUDED.updated_at reference which both the adapter upsert and the
        // sync push share.
        const guarded = sql.includes("EXCLUDED.updated_at");
        const versionAware = guarded && sql.includes("version");
        const returning = sql.includes("RETURNING");
        if (existing && guarded) {
          const clockCmp = compareIsoClock(existing.updatedAt, nextUpdatedAt);
          const rejected = clockCmp > 0
            || (clockCmp === 0 && versionAware && (existing.version ?? 0) > (nextVersion ?? 0));
          if (rejected) return { rows: [] as T[] };
        }
        rows.set(key, {
          service: String(service),
          objectType: String(objectType),
          objectId: String(objectId),
          payload: parseJsonb(payload),
          updatedAt: nextUpdatedAt,
          deletedAt: nullableString(syncStoreInsert ? values[5] : null),
          version: nextVersion,
        });
        // Emulate RETURNING object_id so the adapter can detect a written row.
        return { rows: (returning ? [{ object_id: String(objectId) }] : []) as T[] };
      }

      if (sql.includes("jsonb_set(payload, '{task_counter}'")) {
        // Atomic short-id counter increment (nextTaskShortId).
        const [service, projectId, updatedAt] = values;
        const row = rows.get(recordKey(service, "projects", projectId));
        if (!row) return { rows: [] as T[] };
        const payload = row.payload as Record<string, unknown>;
        const next = Number(payload["task_counter"] ?? 0) + 1;
        payload["task_counter"] = next;
        row.updatedAt = String(updatedAt);
        row.version = (row.version ?? 0) + 1;
        return { rows: [{ counter: String(next) }] as T[] };
      }

      if (sql.includes("UPDATE todos_sync_records")) {
        const [service, objectType, objectId, deletedAt] = values;
        const row = rows.get(recordKey(service, objectType, objectId));
        if (row) {
          row.deletedAt = String(deletedAt);
          row.updatedAt = String(deletedAt);
        }
        return { rows: [] as T[] };
      }

      if (sql.includes("WHERE service = $1 AND object_type = $2") && sql.includes("object_id = $3") && !sql.includes("deleted_at IS NULL")) {
        const [service, objectType, objectId] = values;
        const row = rows.get(recordKey(service, objectType, objectId));
        return { rows: (row ? [toQueryRow(row)] : []) as T[] };
      }

      if (sql.includes("WHERE service = $1 AND object_type = $2")) {
        const [service, objectType, objectId] = values;
        const selected = objectId === undefined
          ? [...rows.values()].filter((row) => row.service === service && row.objectType === objectType && !row.deletedAt)
          : [...rows.values()].filter((row) =>
            row.service === service &&
            row.objectType === objectType &&
            row.objectId === objectId &&
            !row.deletedAt
          );
        selected.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.objectId.localeCompare(b.objectId));
        return { rows: selected.map(toQueryRow) as T[] };
      }

      if (sql.includes("SELECT object_type, object_id, payload, updated_at")) {
        const [service] = values;
        let index = 1;
        const since = sql.includes("updated_at >") ? values[index++] : null;
        const objectTypes = sql.includes("object_type = ANY") ? values[index] : null;
        const allowed = Array.isArray(objectTypes) ? new Set(objectTypes.map(String)) : null;
        const selected = [...rows.values()]
          .filter((row) => row.service === service)
          .filter((row) => !since || row.updatedAt > String(since))
          .filter((row) => !allowed || allowed.has(row.objectType))
          .filter((row) => sql.includes("deleted_at IS NOT NULL") ? Boolean(row.deletedAt) : true);
        selected.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.objectType.localeCompare(b.objectType) || a.objectId.localeCompare(b.objectId));
        return { rows: selected.map(toQueryRow) as T[] };
      }

      if (sql.includes("INSERT INTO todos_sync_cursors")) {
        cursors.set(`${String(values[0])}:${String(values[1])}`, String(values[2]));
        return { rows: [] as T[] };
      }

      if (sql.includes("SELECT value FROM todos_sync_cursors")) {
        const value = cursors.get(`${String(values[0])}:${String(values[1])}`);
        return { rows: (value ? [{ value }] : []) as T[] };
      }

      return { rows: [] as T[] };
    },
  };

  return { client, calls };
}

function toQueryRow(row: {
  objectType: string;
  objectId: string;
  payload: unknown;
  updatedAt: string;
  deletedAt: string | null;
  version: number | null;
}) {
  return {
    object_type: row.objectType,
    object_id: row.objectId,
    payload: row.payload,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    version: row.version,
  };
}

function parseJsonb(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function compareIsoClock(left: string, right: string): number {
  const leftClock = Date.parse(left);
  const rightClock = Date.parse(right);
  if (Number.isNaN(leftClock) || Number.isNaN(rightClock)) return left.localeCompare(right);
  return leftClock - rightClock;
}
