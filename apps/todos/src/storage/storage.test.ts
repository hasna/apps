import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
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
    const task = await adapter.tasks.create({ title: "Direct remote task", project_id: project.id });

    expect(adapter.kind).toBe("postgres");
    expect(await adapter.tasks.get(task.id)).toMatchObject({
      title: "Direct remote task",
      short_id: "DR-00001",
    });
    expect(postgres.calls.some((call) => call.values?.includes("spark01"))).toBe(true);
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
      plans: [],
      agents: [],
      taskLists: [],
      templates: [],
      auditHistory: [],
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

      if (sql.includes("INSERT INTO todos_sync_records")) {
        const [service, objectType, objectId, payload, updatedAt] = values;
        const syncStoreInsert = sql.includes("$6::timestamptz");
        rows.set(recordKey(service, objectType, objectId), {
          service: String(service),
          objectType: String(objectType),
          objectId: String(objectId),
          payload: parseJsonb(payload),
          updatedAt: String(updatedAt),
          deletedAt: nullableString(syncStoreInsert ? values[5] : null),
          version: nullableNumber(syncStoreInsert ? values[7] : values[6]),
        });
        return { rows: [] as T[] };
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

      if (sql.includes("SELECT object_type, object_id, payload, updated_at")) {
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

      if (sql.includes("SELECT object_type, payload FROM todos_sync_records")) {
        const [service, since, objectTypes] = values;
        const allowed = Array.isArray(objectTypes) ? new Set(objectTypes.map(String)) : null;
        const selected = [...rows.values()]
          .filter((row) => row.service === service && !row.deletedAt)
          .filter((row) => !since || row.updatedAt > String(since))
          .filter((row) => !allowed || allowed.has(row.objectType));
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
