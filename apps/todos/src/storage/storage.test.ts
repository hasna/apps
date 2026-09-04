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
import { INTEGRITY_CONDITIONS } from "../lib/integrity.js";
import { applyPlanProjectLink, planPlanProjectLink } from "../lib/plan-project-link.js";
import {
  CANONICAL_TODOS_RDS_CLUSTER_ENV,
  CANONICAL_TODOS_RDS_DATABASE,
  CANONICAL_TODOS_RDS_RUNTIME_PATH_ENV,
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
  getTodosStorageBackend,
  loadTodosStorageConfig,
  loadStorageConfig,
  ensurePostgresScopedSlugUniqueIndexes,
  postgresTodosCommentCursorIndexSql,
  postgresTodosScopedSlugIndexStatusSql,
  postgresTodosScopedSlugPreflightSql,
  postgresTodosScopedSlugUniqueIndexSql,
  postgresTodosSyncSchemaSql,
  signAwsV4Request,
  uploadRunArtifactsToS3,
  uploadRunArtifactAtCreation,
  remoteArtifactKey,
  type HybridTodosStorageAdapter,
  type TodosAuditStore,
  type TodosPostgresQueryClient,
  type TodosStorageAdapter,
  type TodosStorageContext,
  type TodosStorageSnapshot,
} from "../storage.js";
import { s3CredentialsFromEnv } from "../cli/commands/storage-commands.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import type { ApiKeyVerifier } from "@hasna/contracts/auth";
import { LockError, TaskNotFoundError, TaskNotStartableError, type Task, type TaskComment } from "../types/index.js";

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
  test("keeps legacy getComments implementations assignable", () => {
    class LegacyAuditStore implements Pick<TodosAuditStore, "getComments"> {
      getComments(_taskId: string, _context?: TodosStorageContext): TaskComment[] {
        return [];
      }
    }
    const legacy = new LegacyAuditStore();

    expect(legacy.getComments("task", { requestId: "legacy" })).toEqual([]);
  });

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
    expectStore(adapter, "integrity", ["report"]);
  });

  test("exposes the referential-integrity store on BOTH storage engines", async () => {
    // Storage duality gate. `todos doctor` reported healthy on a Postgres-backed
    // authority full of orphans; a diagnostic implemented for one engine only
    // reproduces exactly that. Postgres mode has no foreign keys at all, so it is
    // the engine where these rows actually accumulate — it must never be the one
    // without the check.
    const sqlite = createLocalSqliteTodosStorageAdapter({ db });
    const postgres = createPostgresTodosStorageAdapter({ client: createMemoryPostgresClient().client });
    expectStore(sqlite, "integrity", ["report"]);
    expectStore(postgres, "integrity", ["report"]);

    // The SQLite report must cover every declared condition, verified, with counts.
    const report = await sqlite.integrity!.report();
    expect(report.conditions.map((condition) => condition.id)).toEqual(INTEGRITY_CONDITIONS.map((spec) => spec.id));
    expect(report.conditions.every((condition) => condition.verified)).toBe(true);
  });

  test("derives bare unprefixed project task-list slugs on BOTH storage engines", async () => {
    // Fleet convention (binding 2026-09-04): a project's task-list slug is the
    // bare sanitized repo name (`apps`, `internal-apps`), never an auto
    // `todos-` prefixed variant (`todos-apps`). Explicit user-supplied
    // `todos-*` slugs stay verbatim, and legacy prefixed ids keep resolving.
    for (const [engine, adapter] of [
      ["sqlite", createLocalSqliteTodosStorageAdapter({ db })],
      ["postgres", createPostgresTodosStorageAdapter({ client: createMemoryPostgresClient().client })],
    ] as const) {
      const derived = await adapter.projects.create({ name: "Open Emails", path: `/tmp/${engine}-no-prefix-open-emails` });
      expect(derived.task_list_id, `${engine}: name-derived project slug must not carry a todos- prefix`).toBe("open-emails");

      const explicit = await adapter.projects.create({
        name: "Legacy Explicit",
        path: `/tmp/${engine}-no-prefix-legacy-explicit`,
        task_list_id: "todos-legacy-explicit",
      });
      expect(explicit.task_list_id, `${engine}: explicit todos- slug must stay verbatim`).toBe("todos-legacy-explicit");

      const list = await adapter.taskLists.create({ name: "Legacy List", slug: "todos-legacy-explicit", project_id: explicit.id });
      expect(
        await adapter.taskLists.getBySlug("todos-legacy-explicit", explicit.id),
        `${engine}: legacy prefixed task-list slug must still resolve`,
      ).toMatchObject({ id: list.id });
    }
  });

  test("REGRESSION: postgres sync changed-since compares the cursor as an INSTANT, not raw text", async () => {
    // Release-review P1 (0.15.44 review): getChangedSince filtered
    // `task.updated_at > since` as raw text. Space (0x20) sorts before 'T'
    // (0x54), so a space-form stamp ("2026-08-20 23:00:00", the DDL default
    // datetime('now') / snapshot import) that is genuinely NEWER than an ISO
    // cursor was silently excluded from the changed-since feed.
    const { client } = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client, service: "changed-since-instant-test" });
    const service = "changed-since-instant-test";
    const rows: Array<[string, string]> = [
      ["t-space", "2026-08-20 23:00:00"], // space-form, NEWER than the cursor
      ["t-iso", "2026-08-20T22:00:00.000Z"], // ISO, newer than the cursor
      ["t-old", "2026-08-19T21:00:00.000Z"], // older
      ["t-unparseable", "not-a-timestamp"], // cannot read -> KEPT, not older
    ];
    for (const [id, stamp] of rows) {
      await client.query(
        `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at, version) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [service, "tasks", id, JSON.stringify({ id, updated_at: stamp, status: "pending", title: id }), stamp, null, 1],
      );
    }
    const changed = await adapter.sync.getTasksChangedSince("2026-08-20T21:00:00.000Z", {});
    expect(changed.map((t) => t.id).sort()).toEqual(["t-iso", "t-space", "t-unparseable"]);
  });

  test("resolves agent names case-insensitively on BOTH storage engines", async () => {
    // Regression: todos task 0bf5d979. The Postgres/cloud roster compared agent
    // names with `===`, so registering a case-variant of an existing name minted
    // a SECOND record instead of heartbeating the first. Measured on station01
    // 2026-07-31: `fabricius` (01d4cc12, fresh) and `Fabricius` (4d77b218, 24h
    // stale) were two rows for one agent, and BOTH lookups returned rc=0.
    //
    // Why that is not cosmetic: a coordinator deciding whether to REPLACE a
    // dispatched agent reads last_seen_at. Landing on the stale twin shows 24h of
    // silence — far past the ~30min replace threshold — so the rule-following
    // action becomes killing a live agent and discarding its context.
    //
    // SQLite already normalised (validateAgentName lowercases, getAgentByName
    // uses LOWER(name)). Behaviour must be identical on both backends, so this
    // asserts the contract on each engine rather than on the one that was broken.
    for (const [engine, adapter] of [
      ["sqlite", createLocalSqliteTodosStorageAdapter({ db })],
      ["postgres", createPostgresTodosStorageAdapter({ client: createMemoryPostgresClient().client })],
    ] as const) {
      const first = await adapter.agents.register({ name: "fabricius", force: true });
      if ("conflict" in first) throw new Error(`${engine}: ${first.message}`);

      // Lookup must not care about case.
      expect(await adapter.agents.getByName("Fabricius"), `${engine}: getByName("Fabricius")`).toMatchObject({ id: first.id });
      expect(await adapter.agents.getByName("FABRICIUS"), `${engine}: getByName("FABRICIUS")`).toMatchObject({ id: first.id });
      expect(await adapter.agents.getByName("fabricius"), `${engine}: getByName("fabricius")`).toMatchObject({ id: first.id });

      // Registering a case-variant must reuse the record, never mint a second identity.
      const again = await adapter.agents.register({ name: "Fabricius", force: true });
      if ("conflict" in again) throw new Error(`${engine}: ${again.message}`);
      expect(again.id, `${engine}: case-variant register must reuse the existing id`).toBe(first.id);

      const roster = (await adapter.agents.list()).filter(
        (agent) => agent.name.toLowerCase() === "fabricius",
      );
      expect(roster.length, `${engine}: one agent must occupy exactly one roster row`).toBe(1);

      // The canonical stored form is lowercase, so the roster cannot drift back
      // into two spellings of one identity.
      expect(roster[0]!.name, `${engine}: stored name is normalised`).toBe("fabricius");
    }
  });

  test("heartbeat and release resolve agent names case-insensitively on the Postgres roster", async () => {
    // Regression: todos task c543377c, following up 0bf5d979.
    //
    // 0bf5d979 was about last_seen_at DIVERGENCE, and the test above pins only
    // the READ path (`getByName`). But `heartbeat` IS THE WRITE PATH for
    // last_seen_at, and `release` is the write path for the session binding —
    // they are what actually produces the divergence a coordinator later reads.
    // Nothing asserted that they resolve a name the same way, so a refactor that
    // stopped routing them through `resolveAgent` would restore the original bug
    // with the read-path test still green.
    //
    // Scoped to Postgres deliberately. `heartbeat`/`release` are OPTIONAL on
    // TodosAgentStore and only the Postgres adapter implements them — a SQLite
    // server answers /v1/agents/:id/heartbeat with 501. Postgres is also the
    // engine behind the hosted authority, so it is the one that produces the
    // shared roster every coordinator reads.
    const adapter = createPostgresTodosStorageAdapter({ client: createMemoryPostgresClient().client });

    // Assert the capability EXISTS before exercising it. Without this the whole
    // test would pass vacuously the moment either verb was dropped from the
    // adapter — which is exactly the regression it is here to catch.
    expect(typeof adapter.agents.heartbeat, "postgres must implement agents.heartbeat").toBe("function");
    expect(typeof adapter.agents.release, "postgres must implement agents.release").toBe("function");
    const heartbeat = adapter.agents.heartbeat!.bind(adapter.agents);
    const release = adapter.agents.release!.bind(adapter.agents);

    const live = await adapter.agents.register({ name: "fabricius", force: true });
    if ("conflict" in live) throw new Error(live.message);
    // A DISTINCT agent, so the resolver has more than one name to choose between.
    const other = await adapter.agents.register({ name: "hermes", force: true });
    if ("conflict" in other) throw new Error(other.message);

    // Every casing must beat the SAME record — this is the divergence fix.
    for (const spelling of ["fabricius", "Fabricius", "FABRICIUS", "  FaBrIcIuS  "]) {
      const beat = await heartbeat(spelling);
      expect(beat, `heartbeat(${JSON.stringify(spelling)}) must resolve`).not.toBeNull();
      expect(beat!.id, `heartbeat(${JSON.stringify(spelling)}) must hit the one record`).toBe(live.id);
    }

    // CONTROL — a distinct agent still beats its OWN record, so the resolver
    // cannot be "return the freshest row" with the name ignored.
    //
    // Stated precisely, because the obvious phrasing overstates it (found by
    // adversarial review of this PR): by the time this line runs, the loop above
    // has heartbeaten `fabricius` four times, so `fabricius` — not `hermes` — is
    // usually the freshest row. A name-ignoring resolver therefore dies in the
    // LOOP, at the assertion above, and only reaches this line in the
    // same-millisecond registration tie where the timestamps are equal. So this
    // is a genuine backstop for that tie rather than the primary trap, and the
    // mutant is caught either way.
    expect((await heartbeat("Hermes"))?.id, "a distinct agent must beat its own record").toBe(other.id);
    expect((await heartbeat("fabricius"))?.id, "and must not have displaced the other agent").toBe(live.id);

    // CONTROL — a genuinely nonexistent name must STILL fail. The fix must not
    // work by making every reference resolve to something.
    expect(await heartbeat("nosuchagent"), "unknown name must not resolve").toBeNull();
    expect(await release("nosuchagent"), "unknown name must not release").toBeNull();

    // Heartbeating a case-variant must not mint a second row, which is the shape
    // the original divergence took.
    const roster = (await adapter.agents.list()).filter((agent) => agent.name.toLowerCase() === "fabricius");
    expect(roster.length, "heartbeat must not create a case-variant twin").toBe(1);

    // Release shares the resolver and therefore the same contract.
    const released = await release("FABRICIUS");
    expect(released?.released, "release must resolve a case-variant").toBe(true);
    expect(released?.agent.id, "release must clear the LIVE row, not a twin").toBe(live.id);
    expect(
      (await adapter.agents.getByName("fabricius"))?.session_id ?? null,
      "the live row's session binding must be cleared",
    ).toBeNull();
  });

  test("tasks.list/count route a free-text query through FTS on the local adapter", async () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });
    await adapter.tasks.create({ title: "Fix login authentication bug" });
    await adapter.tasks.create({ title: "Add dashboard widget" });

    const hits = await adapter.tasks.list({ query: "authentication" });
    expect(hits.map((t) => t.title)).toEqual(["Fix login authentication bug"]);
    expect(await adapter.tasks.count({ query: "authentication" })).toBe(1);

    await adapter.tasks.create({ title: "authentication retry path" });
    expect(await adapter.tasks.list({ query: "authentication", limit: 1 })).toHaveLength(1);
  });

  test("tags on a query-bearing list/count match ANY tag, parity with the plain list path", async () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });
    await adapter.tasks.create({ title: "login both task", tags: ["a", "b"] });
    await adapter.tasks.create({ title: "login page task", tags: ["b"] });
    await adapter.tasks.create({ title: "login flow task", tags: ["a"] });
    await adapter.tasks.create({ title: "unrelated task", tags: ["c"] });

    const byTags = await adapter.tasks.list({ tags: ["a", "b"] });
    expect(byTags.map((t) => t.title).sort()).toEqual([
      "login both task",
      "login flow task",
      "login page task",
    ]);
    expect(await adapter.tasks.count({ tags: ["a", "b"] })).toBe(3);

    // A free-text query must not flip multi-tag matching to ALL-of: the same
    // tags filter narrowed by q returns every task carrying ANY of a/b.
    const byQueryAndTags = await adapter.tasks.list({ query: "login", tags: ["a", "b"] });
    expect(byQueryAndTags.map((t) => t.title).sort()).toEqual([
      "login both task",
      "login flow task",
      "login page task",
    ]);
    expect(await adapter.tasks.count({ query: "login", tags: ["a", "b"] })).toBe(3);
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

    // Re-parent to another project and detach the source list. An explicit
    // `task_list_id: null` must clear the list (guards the cross-project move +
    // the postgres `?? existing` coalesce regression) while preserving the id.
    const projectB = await adapter.projects.create({ name: "Storage Boundary B", path: "/tmp/storage-boundary-b" });
    const reparented = await adapter.tasks.update(task.id, {
      version: updated.version,
      project_id: projectB.id,
      plan_id: null,
      task_list_id: null,
    });
    expect(reparented.id).toBe(task.id);
    expect(reparented.project_id).toBe(projectB.id);
    expect(reparented.task_list_id).toBeNull();
    expect((await adapter.tasks.list({ project_id: project.id })).map((t) => t.id)).not.toContain(task.id);
    expect((await adapter.tasks.list({ project_id: projectB.id })).map((t) => t.id)).toContain(task.id);
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

  test("local comment cursors use portable timestamp/id order without changing default insertion order", async () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });
    const task = await adapter.tasks.create({ title: "Local comment cursor" });
    const timestamp = "2026-07-10T00:00:00.000Z";
    for (const id of ["same-c", "same-b", "same-a"]) {
      db.run(
        `INSERT INTO task_comments (id, task_id, content, type, created_at)
         VALUES (?, ?, ?, 'comment', ?)`,
        [id, task.id, id, timestamp],
      );
    }

    expect((await adapter.audit.getComments(task.id)).map((comment) => comment.id))
      .toEqual(["same-c", "same-b", "same-a"]);
    expect((await adapter.audit.getComments(task.id, { requestId: "legacy-context" })).map((comment) => comment.id))
      .toEqual(["same-c", "same-b", "same-a"]);
    expect((await adapter.audit.getCommentsPage!(task.id, { limit: 2 })).map((comment) => comment.id))
      .toEqual(["same-b", "same-c"]);
    expect((await adapter.audit.getCommentsPage!(task.id, {
      limit: 2,
      before: { created_at: timestamp, id: "same-b" },
    })).map((comment) => comment.id)).toEqual(["same-a"]);
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

  test("fails closed before importing malformed SQLite project and task-list slugs", async () => {
    const source = createLocalSqliteTodosStorageAdapter({ db });
    const project = await source.projects.create({ name: "Import Guard", path: "/tmp/import-guard" });
    const list = await source.taskLists.create({ name: "Import Guard", slug: "import-guard", project_id: project.id });
    const task = await source.tasks.create({ title: "Must not partially import", project_id: project.id });
    const snapshot = await source.sync.exportSnapshot!();
    snapshot.projects[0] = { ...snapshot.projects[0]!, task_list_id: "Bad Project Slug !!" };
    snapshot.taskLists[0] = { ...snapshot.taskLists[0]!, slug: "Bad List Slug !!" };

    const targetDb = new Database(":memory:");
    targetDb.run("PRAGMA foreign_keys = ON");
    runMigrations(targetDb);
    try {
      const target = createLocalSqliteTodosStorageAdapter({ db: targetDb });
      const imported = await target.sync.importSnapshot!(snapshot);
      expect(imported).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
      expect(imported.errors).toHaveLength(2);
      expect(imported.errors.join("\n")).toMatch(/canonical kebab-case/);
      expect(await target.projects.get(project.id)).toBeNull();
      expect(await target.taskLists.get(list.id)).toBeNull();
      expect(await target.tasks.get(task.id)).toBeNull();
    } finally {
      targetDb.close();
    }

    const postgres = createMemoryPostgresClient();
    const postgresAdapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    const postgresImport = await postgresAdapter.sync.importSnapshot!(snapshot);
    expect(postgresImport).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
    expect(postgresImport.errors).toHaveLength(2);
    expect(postgres.calls.some((call) => call.sql.includes("INSERT INTO todos_sync_records"))).toBe(false);

    const syncCalls: string[] = [];
    const syncStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(sql: string) {
        syncCalls.push(sql);
        return { rows: [] as T[] };
      },
    });
    await expect(syncStore.pushSnapshot(snapshot)).rejects.toThrow("Invalid snapshot routing metadata");
    expect(syncCalls).toEqual([]);
  });

  test("Postgres sync routing preflight uses Bun.SQL-safe scalar parameters", async () => {
    const snapshot = await createLocalSqliteTodosStorageAdapter({ db }).sync.exportSnapshot!();
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const syncStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        return { rows: [] as T[] };
      },
    });

    await expect(syncStore.pushSnapshot(snapshot)).resolves.toMatchObject({ records: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("object_type IN ($2, $3)");
    expect(calls[0]!.sql).not.toContain("ANY(");
    expect(calls[0]!.values).toEqual(["todos", "projects", "task_lists"]);
    expect(calls[0]!.values!.some(Array.isArray)).toBe(false);
  });

  test("fails closed on duplicate snapshot routing slugs across SQLite and Postgres imports", async () => {
    const source = createLocalSqliteTodosStorageAdapter({ db });
    const firstProject = await source.projects.create({ name: "Duplicate One", path: "/tmp/duplicate-one" });
    const secondProject = await source.projects.create({ name: "Duplicate Two", path: "/tmp/duplicate-two" });
    const firstList = await source.taskLists.create({ name: "First Inbox", slug: "inbox", project_id: firstProject.id });
    const secondList = await source.taskLists.create({ name: "Second Inbox", slug: "inbox", project_id: secondProject.id });
    const task = await source.tasks.create({ title: "Must remain unimported", project_id: firstProject.id });
    const snapshot = await source.sync.exportSnapshot!();
    snapshot.projects = snapshot.projects.map((project) => project.id === secondProject.id
      ? { ...project, task_list_id: firstProject.task_list_id }
      : project);
    snapshot.taskLists = snapshot.taskLists.map((list) => ({ ...list, project_id: null }));

    const targetDb = new Database(":memory:");
    targetDb.run("PRAGMA foreign_keys = ON");
    runMigrations(targetDb);
    try {
      const target = createLocalSqliteTodosStorageAdapter({ db: targetDb });
      const imported = await target.sync.importSnapshot!(snapshot);
      expect(imported).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
      expect(imported.errors.join("\n")).toContain("task_list_id duplicates project");
      expect(imported.errors.join("\n")).toContain("slug duplicates task list");
      expect(await target.projects.get(firstProject.id)).toBeNull();
      expect(await target.projects.get(secondProject.id)).toBeNull();
      expect(await target.taskLists.get(firstList.id)).toBeNull();
      expect(await target.taskLists.get(secondList.id)).toBeNull();
      expect(await target.tasks.get(task.id)).toBeNull();
    } finally {
      targetDb.close();
    }

    const postgres = createMemoryPostgresClient();
    const postgresAdapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    const postgresImport = await postgresAdapter.sync.importSnapshot!(snapshot);
    expect(postgresImport).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
    expect(postgresImport.errors.join("\n")).toContain("task_list_id duplicates project");
    expect(postgresImport.errors.join("\n")).toContain("slug duplicates task list");
    expect(postgres.calls.some((call) => call.sql.includes("INSERT INTO todos_sync_records"))).toBe(false);

    const syncCalls: string[] = [];
    const syncStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(sql: string) {
        syncCalls.push(sql);
        return { rows: [] as T[] };
      },
    });
    await expect(syncStore.pushSnapshot(snapshot)).rejects.toThrow("duplicates");
    expect(syncCalls).toEqual([]);
  });

  test("SQLite import preflights later destination routing conflicts before prefix writes", async () => {
    const source = createLocalSqliteTodosStorageAdapter({ db });
    const sourceProject = await source.projects.create({
      name: "Incoming Occupied",
      path: "/tmp/incoming-occupied",
      task_list_id: "occupied-project",
    });
    const sourceList = await source.taskLists.create({ name: "Incoming List", slug: "occupied-list" });
    const sourceTask = await source.tasks.create({ title: "Valid prefix row must not import" });
    const snapshot = await source.sync.exportSnapshot!();

    const targetDb = new Database(":memory:");
    targetDb.run("PRAGMA foreign_keys = ON");
    runMigrations(targetDb);
    try {
      const target = createLocalSqliteTodosStorageAdapter({ db: targetDb });
      await target.projects.create({
        name: "Existing Occupied",
        path: "/tmp/existing-occupied",
        task_list_id: "occupied-project",
      });
      await target.taskLists.create({ name: "Existing List", slug: "occupied-list" });

      const imported = await target.sync.importSnapshot!(snapshot);
      expect(imported).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
      expect(imported.errors.join("\n")).toContain("conflicts with existing project");
      expect(imported.errors.join("\n")).toContain("conflicts with existing task list");
      expect(await target.projects.get(sourceProject.id)).toBeNull();
      expect(await target.taskLists.get(sourceList.id)).toBeNull();
      expect(await target.tasks.get(sourceTask.id)).toBeNull();
    } finally {
      targetDb.close();
    }

    const postgres = createMemoryPostgresClient();
    const postgresAdapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    await postgresAdapter.projects.create({
      name: "Existing PG Occupied",
      path: "/tmp/existing-pg-occupied",
      task_list_id: "occupied-project",
    });
    await postgresAdapter.taskLists.create({ name: "Existing PG List", slug: "occupied-list" });
    const insertsBeforeImport = postgres.calls.filter((call) => call.sql.includes("INSERT INTO todos_sync_records")).length;
    const postgresImport = await postgresAdapter.sync.importSnapshot!(snapshot);
    expect(postgresImport).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
    expect(postgresImport.errors.join("\n")).toContain("conflicts with existing project");
    expect(postgresImport.errors.join("\n")).toContain("conflicts with existing task list");
    expect(postgres.calls.filter((call) => call.sql.includes("INSERT INTO todos_sync_records"))).toHaveLength(insertsBeforeImport);

    const syncStore = createPostgresTodosSyncStore(postgres.client);
    // The destination preflight must throw a TYPED ResourceConflictError (not a
    // generic Error): the mirror/outbox retry machinery only parks
    // ResourceConflictError and retries everything else as transient, so the
    // generic path would feed the duplicate-key retry storm this release
    // removes. Assert the typed class and code, not just the message.
    await expect(syncStore.pushSnapshot(snapshot)).rejects.toMatchObject({
      name: "ResourceConflictError",
      code: "SNAPSHOT_DESTINATION_CONFLICT",
      message: expect.stringContaining("conflicts with destination"),
    });
    expect(postgres.calls.filter((call) => call.sql.includes("INSERT INTO todos_sync_records"))).toHaveLength(insertsBeforeImport);
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

  test("derives the postgresql backend from HASNA_TODOS_DATABASE_URL alone", () => {
    const config = loadTodosStorageConfig({
      HASNA_TODOS_DATABASE_URL: "postgres://remote/backend-selected-by-dsn",
    });

    expect(config.mode).toBe("postgres");
    expect(config.database?.url).toBe("postgres://remote/backend-selected-by-dsn");
    expect(() => createTodosStorageAdapter({ config, local: { db } })).toThrow("postgres storage requires");
  });

  test("parses explicit native remote RDS and S3 config", () => {
    const config = loadTodosStorageConfig({
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
      HASNA_TODOS_DATABASE_SCHEMA: "todos_prod",
      HASNA_TODOS_S3_BUCKET: "todos-artifacts-test",
      HASNA_TODOS_S3_PREFIX: "todos/",
      HASNA_TODOS_AWS_REGION: "us-east-1",
      HASNA_TODOS_SYNC_BATCH_SIZE: "1000",
    });

    expect(config).toMatchObject({
      service: "todos",
      mode: "postgres",
      database: {
        provider: "postgres",
        url: "postgres://todos@rds.example/todos",
        ssl: true,
        schema: "todos_prod",
      },
      objectStorage: {
        provider: "s3",
        bucket: "todos-artifacts-test",
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
      mode: "postgres",
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
    expect(getTodosStorageBackend(env)).toBe("postgres");
    expect(getStorageDatabaseEnv(env)).toBe("TODOS_DATABASE_URL");
    expect(getStorageDatabaseUrl(env)).toBe("postgres://todos@rds.example/fallback");
  });

  test("reads the canonical RDS target from env with no baked-in infra defaults", () => {
    // No real cluster name or secrets-manager path ships in the package: with the
    // hosting env vars unset, these fields resolve to null.
    expect(getCanonicalTodosRdsConfig({})).toEqual({
      cluster: null,
      database: CANONICAL_TODOS_RDS_DATABASE,
      runtimeSecretPath: null,
      primaryEnv: TODOS_STORAGE_ENV.databaseUrl,
      fallbackEnv: TODOS_STORAGE_FALLBACK_ENV.databaseUrl,
    });
    expect(CANONICAL_TODOS_RDS_DATABASE).toBe("todos");

    // When the private hosting wrapper supplies the identifiers, they pass through.
    const withEnv = getCanonicalTodosRdsConfig({
      [CANONICAL_TODOS_RDS_CLUSTER_ENV]: "example-cluster",
      [CANONICAL_TODOS_RDS_RUNTIME_PATH_ENV]: "example/todos/prod/rds",
    });
    expect(withEnv.cluster).toBe("example-cluster");
    expect(withEnv.runtimeSecretPath).toBe("example/todos/prod/rds");
  });

  test("rejects remote mode when no remote adapter or Postgres client is supplied", () => {
    const config = loadTodosStorageConfig({
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
    });

    expect(() => createTodosStorageAdapter({ config, local: { db } })).toThrow("postgres storage requires");
    expect(createTodosStorageAdapter({ config, remoteAdapter: fakeRemoteAdapter() }).kind).toBe("postgres");
  });

  test("builds a pure remote Postgres adapter from native config and caller-provided client", async () => {
    const postgres = createMemoryPostgresClient();
    const config = loadTodosStorageConfig({
      HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
    });
    const adapter = createTodosStorageAdapter({
      config,
      local: { db },
      postgresClient: postgres.client,
      sourceMachineId: "apple06",
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
    const startedHistory = await adapter.audit.getTaskHistory(task.id);
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
    expect(startedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        task_id: task.id,
        action: "start",
        field: "status",
        old_value: "pending",
        new_value: "in_progress",
        agent_id: "remote-agent",
      }),
    ]));
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

  test("Postgres start rejects failed tasks with the typed pending-reset transition and still starts pending tasks", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    const failed = await adapter.tasks.create({ title: "failed remote start", status: "failed" });

    await expect(Promise.resolve(adapter.tasks.start(failed.id, "silvanus"))).rejects.toBeInstanceOf(TaskNotStartableError);
    await expect(Promise.resolve(adapter.tasks.start(failed.id, "silvanus"))).rejects.toThrow("reset the task status to pending");
    expect(await adapter.tasks.get(failed.id)).toMatchObject({ status: "failed", locked_by: null });

    const pending = await adapter.tasks.create({ title: "pending remote start" });
    await expect(Promise.resolve(adapter.tasks.start(pending.id, "silvanus"))).resolves.toMatchObject({
      status: "in_progress",
      locked_by: "silvanus",
    });
  });

  test("Postgres task create requires an existing parent and persists a valid parent_id", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });

    await expect(Promise.resolve(adapter.tasks.create({
      title: "dangling child",
      parent_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    }))).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(await adapter.tasks.count({ include_subtasks: true })).toBe(0);

    const parent = await adapter.tasks.create({ title: "stored parent" });
    const child = await adapter.tasks.create({ title: "stored child", parent_id: parent.id });
    expect(child.parent_id).toBe(parent.id);
    expect(await adapter.tasks.get(child.id)).toMatchObject({
      id: child.id,
      parent_id: parent.id,
    });
    expect(await adapter.tasks.count({ include_subtasks: true })).toBe(2);
  });

  test("Postgres upsert never returns an unwritten input object as a successful create", async () => {
    const postgres = createMemoryPostgresClient({ rejectWritesForObjectType: "tasks" });
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });

    await expect(Promise.resolve(adapter.tasks.create({ title: "rejected create" })))
      .rejects.toThrow("POSTGRES_WRITE_PERSISTENCE_UNVERIFIED");
    expect(await adapter.tasks.count({ include_subtasks: true })).toBe(0);
    expect(postgres.calls.filter((call) =>
      call.sql.includes("INSERT INTO todos_sync_records")
      && call.values?.[1] === "tasks"
    )).toHaveLength(1);
  });

  test("Postgres completion atomically merges evidence and completion metadata without dropping omitted keys", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    const task = await adapter.tasks.create({
      title: "Preserve completion metadata",
      metadata: {
        source: "fixture",
        _evidence: { attachment_ids: ["existing-attachment"], notes: "existing notes" },
        _completion: { reviewer: "first-reviewer", confidence: 0.4 },
      },
    });

    postgres.calls.length = 0;
    const historicalCompletion = "2020-01-02T03:04:05.000Z";
    const completed = await adapter.tasks.complete(task.id, "finisher", {
      files_changed: ["src/changed.ts"],
      confidence: 0.9,
      completed_at: historicalCompletion,
    });

    expect(completed.metadata).toEqual({
      source: "fixture",
      _evidence: {
        attachment_ids: ["existing-attachment"],
        notes: "existing notes",
        files_changed: ["src/changed.ts"],
      },
      _completion: { reviewer: "first-reviewer", confidence: 0.9 },
    });
    expect(completed.completed_at).toBe(historicalCompletion);
    expect(completed.updated_at).not.toBe(historicalCompletion);
    expect(Date.parse(completed.updated_at)).toBeGreaterThan(Date.parse(historicalCompletion));
    expect(postgres.calls).toHaveLength(1);
    expect(postgres.calls[0]?.sql).toContain("todos:complete-task-atomic");
    expect(postgres.calls[0]?.sql).toContain("payload->'metadata'->'_evidence'");
    expect(postgres.calls[0]?.sql).toContain("payload->'metadata'->'_completion'");

    const defaultTimestampTask = await adapter.tasks.create({ title: "One completion clock" });
    postgres.calls.length = 0;
    const defaultTimestampCompletion = await adapter.tasks.complete(defaultTimestampTask.id, "finisher");
    expect(defaultTimestampCompletion.completed_at).toBe(defaultTimestampCompletion.updated_at);
    expect(postgres.calls).toHaveLength(1);
  });

  test("Postgres completion refuses no identity and preserves the live lock", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });

    const task = await adapter.tasks.create({ title: "cloud anonymous completion" });
    await adapter.tasks.lock!(task.id, "holder-a");
    expect(await adapter.tasks.get(task.id)).toMatchObject({ status: "pending", locked_by: "holder-a" });

    await expect(Promise.resolve(adapter.tasks.complete(task.id))).rejects.toBeInstanceOf(LockError);
    expect(await adapter.tasks.get(task.id)).toMatchObject({ status: "pending", locked_by: "holder-a" });

    expect(await adapter.tasks.delete(task.id)).toBe(true);
    expect(await adapter.tasks.get(task.id)).toBeNull();
  });

  test("Postgres completion by the legitimate holder releases the live lock", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });

    const task = await adapter.tasks.create({ title: "cloud holder completion" });
    await adapter.tasks.lock!(task.id, "holder-a");
    expect(await adapter.tasks.get(task.id)).toMatchObject({ status: "pending", locked_by: "holder-a" });

    expect(await adapter.tasks.complete(task.id, "holder-a")).toMatchObject({ status: "completed" });
    expect(await adapter.tasks.get(task.id)).toMatchObject({ status: "completed", locked_by: null, locked_at: null });

    expect(await adapter.tasks.delete(task.id)).toBe(true);
    expect(await adapter.tasks.get(task.id)).toBeNull();
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

  test("preserves ordered checklist steps in the direct pure remote Postgres template store", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    const template = await adapter.templates.create({
      name: "Monthly accounting",
      title_pattern: "Monthly accounting {month}",
      tasks: [
        { title_pattern: "Collect statements {month}" },
        { title_pattern: "Reconcile {month}", depends_on: [0] },
      ],
    });

    expect(await adapter.templates.getWithTasks(template.id)).toMatchObject({
      id: template.id,
      tasks: [
        { position: 0, depends_on_positions: [] },
        { position: 1, depends_on_positions: [0] },
      ],
    });
    expect(await adapter.templates.delete(template.id)).toBe(true);
    expect(await adapter.templates.getWithTasks(template.id)).toBeNull();
    expect(postgres.calls.some((call) => call.values?.includes("template_tasks"))).toBe(true);
  });

  test("round-trips remote template checklist steps through snapshots", async () => {
    const sourcePostgres = createMemoryPostgresClient();
    const source = createPostgresTodosStorageAdapter({ client: sourcePostgres.client });
    const template = await source.templates.create({
      name: "Snapshot checklist",
      title_pattern: "Monthly accounting {month}",
      tasks: [
        { title_pattern: "Collect statements {month}" },
        { title_pattern: "Reconcile {month}", depends_on: [0] },
      ],
    });
    const snapshot = await source.sync.exportSnapshot!();
    expect(snapshot.templateTasks).toHaveLength(2);
    expect(snapshot.templateTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ template_id: template.id, position: 0, depends_on_positions: [] }),
      expect.objectContaining({ template_id: template.id, position: 1, depends_on_positions: [0] }),
    ]));

    const targetPostgres = createMemoryPostgresClient();
    const target = createPostgresTodosStorageAdapter({ client: targetPostgres.client });
    expect((await target.sync.importSnapshot!(snapshot)).errors).toEqual([]);
    expect(await target.templates.getWithTasks(template.id)).toMatchObject({
      id: template.id,
      tasks: [
        { position: 0, depends_on_positions: [] },
        { position: 1, depends_on_positions: [0] },
      ],
    });
  });

  test("does not leave a parent template behind when an atomic checklist insert fails", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: {
        async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
          if (sql.includes("todos:create-template-with-tasks-atomic")) throw new Error("injected template batch failure");
          return postgres.client.query<T>(sql, values);
        },
      },
    });
    await expect(adapter.templates.create({
      name: "Failure-safe checklist",
      title_pattern: "Failure-safe {month}",
      tasks: [{ title_pattern: "step" }],
    })).rejects.toThrow("injected template batch failure");
    expect(await adapter.templates.list()).toEqual([]);
  });

  test("renames a Postgres project and canonical list with one atomic idempotent statement", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "spark01" });
    const project = await adapter.projects.create({ name: "Open Emails", path: "/tmp/open-emails", task_list_id: "emails" });
    const taskList = await adapter.taskLists.create({ name: "Open Emails", slug: "emails", project_id: project.id });

    for (const taskListId of ["emails-next", "Not Canonical !!"]) {
      await expect(adapter.projects.update(project.id, { task_list_id: taskListId } as never))
        .rejects.toThrow("use renameProject");
    }
    expect(await adapter.projects.get(project.id)).toMatchObject({ task_list_id: "emails" });
    expect(await adapter.taskLists.get(taskList.id)).toMatchObject({ slug: "emails" });

    const first = await adapter.projects.rename(project.id, { new_slug: "emails-next", name: "Emails Next" });
    await Bun.sleep(2);
    const retry = await adapter.projects.rename(project.id, { new_slug: "emails-next", name: "Emails Next" });

    expect(first).toMatchObject({ project: { name: "Emails Next", task_list_id: "emails-next" }, task_lists_updated: 1 });
    expect(retry).toMatchObject({
      project: { name: "Emails Next", task_list_id: "emails-next", updated_at: first.project.updated_at },
      task_lists_updated: 0,
    });
    expect(await adapter.taskLists.get(taskList.id)).toMatchObject({ name: "Emails Next", slug: "emails-next" });
    expect(postgres.calls.filter((call) => call.sql.includes("todos:rename-project-atomic"))).toHaveLength(2);
  });

  test("maps the Postgres concurrent task-list unique violation to a stable conflict", async () => {
    const postgres = createMemoryPostgresClient();
    let inserted = false;
    const adapter = createPostgresTodosStorageAdapter({
      client: {
        async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
          if (sql.includes("INSERT INTO todos_sync_records") && values?.[1] === "task_lists") {
            if (inserted) {
              const conflict = Object.assign(new Error("unique violation"), {
                code: "ERR_POSTGRES_SERVER_ERROR",
                errno: "23505",
              });
              throw conflict;
            }
            inserted = true;
          }
          return postgres.client.query<T>(sql, values);
        },
      },
    });
    await adapter.taskLists.create({ name: "Inbox", slug: "inbox", project_id: "project-1" });

    await expect(adapter.taskLists.create({ name: "Duplicate", slug: "inbox", project_id: "project-1" }))
      .rejects.toMatchObject({ code: "TASK_LIST_SLUG_CONFLICT" });
  });

  test("does not map non-unique Bun Postgres server errors to a slug conflict", async () => {
    const adapter = createPostgresTodosStorageAdapter({
      client: {
        async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
          if (sql.includes("INSERT INTO todos_sync_records") && values?.[1] === "projects") {
            throw Object.assign(new Error("foreign key violation"), {
              code: "ERR_POSTGRES_SERVER_ERROR",
              errno: "23503",
            });
          }
          return { rows: [] as T[] };
        },
      },
    });

    await expect(adapter.projects.create({ name: "Unrelated", path: "/tmp/unrelated" }))
      .rejects.toMatchObject({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "23503" });
  });

  test("rejects empty explicit and derived slugs consistently in Postgres storage", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });

    await expect(adapter.projects.create({ name: "---", path: "/tmp/invalid" }))
      .rejects.toThrow("must be non-empty");
    await expect(adapter.taskLists.create({ name: "---" }))
      .rejects.toThrow("must be non-empty");
    await expect(adapter.taskLists.create({ name: "Inbox", slug: "" }))
      .rejects.toThrow("must be non-empty");
    await expect(adapter.taskLists.create({ name: "Inbox", slug: "---" }))
      .rejects.toThrow("must be non-empty");

    const invalidSnapshot = {
      exportedAt: "2026-07-15T00:00:00.000Z",
      source: "sqlite",
      tasks: [],
      projects: [{
        id: "invalid-project",
        name: "Invalid",
        path: "/tmp/invalid-import",
        task_list_id: "",
        task_prefix: "INV",
        task_counter: 0,
        created_at: "2026-07-15T00:00:00.000Z",
        updated_at: "2026-07-15T00:00:00.000Z",
      }],
      plans: [],
      agents: [],
      taskLists: [],
      templates: [],
      auditHistory: [],
    } as TodosStorageSnapshot;
    const imported = await adapter.sync.importSnapshot!(invalidSnapshot);
    expect(imported).toMatchObject({ inserted: 0, errors: [expect.stringContaining("non-empty canonical")] });

    const syncCalls: string[] = [];
    const syncStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(sql: string) {
        syncCalls.push(sql);
        return { rows: [] as T[] };
      },
    });
    await expect(syncStore.pushSnapshot(invalidSnapshot)).rejects.toThrow("non-empty canonical");
    expect(syncCalls).toEqual([]);
  });

  test("rejects malformed Postgres task-list project scopes before direct or sync writes", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    const malformedScopes: unknown[] = ["", "   ", 1, true, { id: "project-1" }, ["project-1"]];

    for (const [index, projectId] of malformedScopes.entries()) {
      await expect(adapter.taskLists.create({
        name: `Invalid Scope ${index}`,
        slug: `invalid-scope-${index}`,
        project_id: projectId,
      } as never)).rejects.toThrow("project_id must be null, missing, or a non-empty string");
    }
    expect(postgres.calls.some((call) => call.sql.includes("INSERT INTO todos_sync_records"))).toBe(false);

    const missing = await adapter.taskLists.create({ name: "Missing Scope", slug: "missing-scope" });
    const standalone = await adapter.taskLists.create({ name: "Null Scope", slug: "null-scope", project_id: null } as never);
    const scoped = await adapter.taskLists.create({ name: "String Scope", slug: "string-scope", project_id: "project-1" });
    expect([missing.project_id, standalone.project_id, scoped.project_id]).toEqual([null, null, "project-1"]);

    const syncCalls: Array<readonly unknown[] | undefined> = [];
    const syncStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(_sql: string, values?: readonly unknown[]) {
        syncCalls.push(values);
        return { rows: [] as T[] };
      },
    });
    const scopeSnapshot = (projectId: unknown, includeProjectId = true) => ({
      exportedAt: "2026-07-15T00:00:00.000Z",
      source: "sqlite",
      tasks: [],
      projects: [],
      projectMachinePaths: [],
      plans: [],
      agents: [],
      taskLists: [{
        id: `sync-${String(projectId)}`,
        ...(includeProjectId ? { project_id: projectId } : {}),
        slug: "sync-scope",
        name: "Sync Scope",
        description: null,
        metadata: null,
        created_at: "2026-07-15T00:00:00.000Z",
        updated_at: "2026-07-15T00:00:00.000Z",
      }],
      templates: [],
      auditHistory: [],
      tombstones: [],
    } as unknown as TodosStorageSnapshot);

    for (const projectId of malformedScopes) {
      await expect(syncStore.pushSnapshot(scopeSnapshot(projectId)))
        .rejects.toThrow("project_id must be null, missing, or a non-empty string");
    }
    expect(syncCalls).toHaveLength(0);
    await expect(syncStore.pushSnapshot(scopeSnapshot(undefined, false))).resolves.toMatchObject({ records: 1 });
    await expect(syncStore.pushSnapshot(scopeSnapshot(null))).resolves.toMatchObject({ records: 1 });
    await expect(syncStore.pushSnapshot(scopeSnapshot("project-1"))).resolves.toMatchObject({ records: 1 });
    expect(syncCalls).toHaveLength(6);
  });

  test("maps task-list update preflight and project unique violations to stable conflicts", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client });
    const project = await adapter.projects.create({ name: "Open Emails", path: "/tmp/open-emails" });
    const first = await adapter.taskLists.create({ name: "Inbox", slug: "inbox", project_id: project.id });
    const second = await adapter.taskLists.create({ name: "Archive", slug: "archive", project_id: project.id });
    await expect(adapter.taskLists.update(second.id, { slug: first.slug }))
      .rejects.toMatchObject({ code: "TASK_LIST_SLUG_CONFLICT" });

    let projectWrites = 0;
    const concurrent = createPostgresTodosStorageAdapter({
      client: {
        async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
          if (sql.includes("INSERT INTO todos_sync_records") && values?.[1] === "projects") {
            projectWrites += 1;
            if (projectWrites > 1) {
              throw Object.assign(new Error("unique violation"), {
                code: "ERR_POSTGRES_SERVER_ERROR",
                cause: {
                  sqlState: "23505",
                  constraint: "todos_sync_records_project_task_list_slug_uidx",
                },
              });
            }
          }
          return postgres.client.query<T>(sql, values);
        },
      },
    });
    await concurrent.projects.create({ name: "Shared", path: "/tmp/shared-a" });
    await expect(concurrent.projects.create({ name: "Shared", path: "/tmp/shared-b" }))
      .rejects.toMatchObject({ code: "PROJECT_SLUG_CONFLICT" });

    const renameRace = createPostgresTodosStorageAdapter({
      client: {
        async query<T = Record<string, unknown>>(sql: string) {
          if (sql.includes("todos:rename-project-atomic")) {
            throw Object.assign(new Error("unique violation"), {
              code: "23505",
              constraint: "todos_sync_records_project_task_list_slug_uidx",
            });
          }
          return { rows: [] as T[] };
        },
      },
    });
    await expect(renameRace.projects.rename("project-b", { new_slug: "shared" }))
      .rejects.toMatchObject({ code: "PROJECT_SLUG_CONFLICT" });

    const metadataLessRenameRace = createPostgresTodosStorageAdapter({
      client: {
        async query<T = Record<string, unknown>>(sql: string) {
          if (sql.includes("todos:rename-project-atomic")) {
            throw Object.assign(new Error("unique violation"), { code: "23505" });
          }
          if (sql.includes("todos:classify-project-rename-conflict")) {
            return { rows: [{ project_conflict: true }] as T[] };
          }
          return { rows: [] as T[] };
        },
      },
    });
    await expect(metadataLessRenameRace.projects.rename("project-b", { new_slug: "shared" }))
      .rejects.toMatchObject({ code: "PROJECT_SLUG_CONFLICT" });
  });

  test("pushSnapshot maps scoped-slug unique violations to typed sync conflicts", async () => {
    // The upsert arbiter is the table PRIMARY KEY, but the deployed uniqueness
    // invariants are the partial expression indexes
    // todos_sync_records_task_list_scope_slug_uidx / _project_task_list_slug_uidx.
    // A slug collision on a DIFFERENT object_id therefore bypasses ON CONFLICT and
    // raises a raw 23505 (ba6e4a19 duplicate-key retry storm). The destination
    // preflight SELECT and the INSERT are separate statements (TOCTOU), so a
    // concurrent pusher can pass the preflight and still hit the index — which is
    // what this mock simulates: the preflight SELECT is blind, the INSERT raises.
    let taskListWrites = 0;
    const taskListStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
        if (sql.includes("INSERT INTO todos_sync_records") && values?.[1] === "task_lists") {
          taskListWrites += 1;
          if (taskListWrites > 1) {
            throw Object.assign(new Error("duplicate key value violates unique constraint"), {
              code: "ERR_POSTGRES_SERVER_ERROR",
              cause: {
                sqlState: "23505",
                constraint: "todos_sync_records_task_list_scope_slug_uidx",
              },
            });
          }
        }
        return { rows: [] as T[] };
      },
    });
    const taskListSnapshot = (id: string) => ({
      exportedAt: "2026-07-15T00:00:00.000Z",
      source: "sqlite",
      tasks: [],
      projects: [],
      projectMachinePaths: [],
      plans: [],
      agents: [],
      taskLists: [{
        id,
        project_id: null,
        slug: "accounting",
        name: "Accounting",
        created_at: "2026-07-15T00:00:00.000Z",
        updated_at: "2026-07-15T00:00:00.000Z",
      }],
      templates: [],
      auditHistory: [],
      tombstones: [],
    } as unknown as TodosStorageSnapshot);
    await expect(taskListStore.pushSnapshot(taskListSnapshot("tl-accounting-a"))).resolves.toMatchObject({ records: 1 });
    // Same scope (project_id null -> ''), same slug, DIFFERENT object_id: the
    // PK arbiter cannot see the collision, the unique index can.
    await expect(taskListStore.pushSnapshot(taskListSnapshot("tl-accounting-b")))
      .rejects.toMatchObject({ name: "ResourceConflictError", code: "TASK_LIST_SLUG_CONFLICT" });

    // Project index variant maps to PROJECT_SLUG_CONFLICT.
    let projectWrites = 0;
    const projectStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
        if (sql.includes("INSERT INTO todos_sync_records") && values?.[1] === "projects") {
          projectWrites += 1;
          if (projectWrites > 1) {
            throw Object.assign(new Error("duplicate key value violates unique constraint"), {
              code: "ERR_POSTGRES_SERVER_ERROR",
              cause: {
                sqlState: "23505",
                constraint: "todos_sync_records_project_task_list_slug_uidx",
              },
            });
          }
        }
        return { rows: [] as T[] };
      },
    });
    const projectSnapshot = (id: string) => ({
      exportedAt: "2026-07-15T00:00:00.000Z",
      source: "sqlite",
      tasks: [],
      projects: [{
        id,
        name: "Finance",
        path: `/tmp/${id}`,
        task_list_id: "finance",
        created_at: "2026-07-15T00:00:00.000Z",
        updated_at: "2026-07-15T00:00:00.000Z",
      }],
      projectMachinePaths: [],
      plans: [],
      agents: [],
      taskLists: [],
      templates: [],
      auditHistory: [],
      tombstones: [],
    } as unknown as TodosStorageSnapshot);
    await expect(projectStore.pushSnapshot(projectSnapshot("project-finance-a"))).resolves.toMatchObject({ records: 1 });
    await expect(projectStore.pushSnapshot(projectSnapshot("project-finance-b")))
      .rejects.toMatchObject({ name: "ResourceConflictError", code: "PROJECT_SLUG_CONFLICT" });

    // Metadata-less client (some drivers omit the constraint name): the
    // fallback re-read classifies deterministically, mirroring
    // renameProjectAtomic's post-failure re-read.
    const metadataLessStore = createPostgresTodosSyncStore({
      async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
        if (sql.includes("INSERT INTO todos_sync_records") && values?.[1] === "task_lists") {
          throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
        }
        if (sql.includes("todos:classify-sync-task-list-conflict")) {
          return { rows: [{ conflict: true }] as T[] };
        }
        return { rows: [] as T[] };
      },
    });
    await expect(metadataLessStore.pushSnapshot(taskListSnapshot("tl-accounting-c")))
      .rejects.toMatchObject({ name: "ResourceConflictError", code: "TASK_LIST_SLUG_CONFLICT" });
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
    const incoming = await adapter.dependencies!.list(b.id);
    expect(incoming.blocks).toEqual([{ task_id: a.id, depends_on: b.id }]);
    // Legacy wire alias for pre-0.13.2 clients: same contents as `blocks`.
    expect(incoming.blocked_by).toEqual(incoming.blocks);
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

  test("v1 start treats an empty assignee like null without rewriting task identity or dependencies", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "spark01" });
    const project = await adapter.projects.create({ name: "Start normalization", path: "/tmp/start-normalization" });
    const prerequisite = await adapter.tasks.create({ title: "Completed prerequisite", project_id: project.id });
    await adapter.tasks.complete(prerequisite.id, "finisher");

    const emptyAssignee = await adapter.tasks.create({
      title: "Legacy empty assignee",
      project_id: project.id,
      priority: "high",
      assigned_to: "",
      assigned_by: "dispatcher",
      agent_id: "origin-agent",
      tags: ["start-normalization"],
      metadata: { sentinel: "preserve-me" },
    });
    const nullAssignee = await adapter.tasks.create({
      title: "Canonical null assignee",
      project_id: project.id,
      assigned_to: null,
      agent_id: "origin-agent",
    });
    await adapter.dependencies!.add(emptyAssignee.id, prerequisite.id);

    const verifier: ApiKeyVerifier = {
      app: "todos",
      authenticate: async () => ({
        ok: true as const,
        status: 200 as const,
        principal: {
          kid: "test-key-id",
          app: "todos",
          scopes: ["todos:*"],
          agent: "claimer",
          claims: { v: 1, kid: "test-key-id", app: "todos", scopes: ["todos:*"], iat: 0, exp: null },
        },
      }),
    };
    const request = async (method: string, path: string, body?: Record<string, unknown>) => {
      const url = new URL(`https://todos.test${path}`);
      const response = await handleV1Request(
        new Request(url, {
          method,
          headers: { "content-type": "application/json", authorization: "Bearer [REDACTED_SECRET]" },
          body: body ? JSON.stringify(body) : undefined,
        }),
        url,
        {
          getVerifier: () => verifier,
          ensureSchema: async () => {},
          getStorageAdapter: () => adapter,
        },
      );
      if (!response) throw new Error(`Expected ${path} to be handled by v1`);
      return response;
    };

    for (const task of [emptyAssignee, nullAssignee]) {
      const started = await request("POST", `/v1/tasks/${task.id}/start`, { agent_id: "claimer" });
      expect(started.status).toBe(200);
    }

    const nullRead = await request("GET", `/v1/tasks/${nullAssignee.id}`);
    expect((await nullRead.json() as { task: typeof nullAssignee }).task).toMatchObject({
      assigned_to: "claimer",
      agent_id: "origin-agent",
      locked_by: "claimer",
      status: "in_progress",
    });

    expect(await adapter.dependencies!.list(emptyAssignee.id)).toMatchObject({
      dependencies: [{ task_id: emptyAssignee.id, depends_on: prerequisite.id }],
    });

    const emptyRead = await request("GET", `/v1/tasks/${emptyAssignee.id}`);
    const emptyTask = (await emptyRead.json() as { task: typeof emptyAssignee }).task;
    expect(emptyTask).toMatchObject({
      assigned_to: "claimer",
      assigned_by: "dispatcher",
      agent_id: "origin-agent",
      locked_by: "claimer",
      status: "in_progress",
      project_id: project.id,
      priority: "high",
      tags: ["start-normalization"],
      metadata: { sentinel: "preserve-me" },
    });
    expect(emptyTask.locked_at).toBeTruthy();
    expect(emptyTask.started_at).toBeTruthy();
  });

  test("v1 Postgres reopen clears completed_at and permits a fresh completion", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "spark01" });
    const verifier: ApiKeyVerifier = {
      app: "todos",
      authenticate: async () => ({
        ok: true as const,
        status: 200 as const,
        principal: {
          kid: "test-key-id",
          app: "todos",
          scopes: ["todos:*"],
          agent: "lifecycle-agent",
          claims: { v: 1, kid: "test-key-id", app: "todos", scopes: ["todos:*"], iat: 0, exp: null },
        },
      }),
    };
    const request = async (method: string, path: string, body?: Record<string, unknown>) => {
      const url = new URL(`https://todos.test${path}`);
      const response = await handleV1Request(
        new Request(url, {
          method,
          headers: { "content-type": "application/json", authorization: "Bearer [REDACTED_SECRET]" },
          body: body ? JSON.stringify(body) : undefined,
        }),
        url,
        {
          getVerifier: () => verifier,
          ensureSchema: async () => {},
          getStorageAdapter: () => adapter,
        },
      );
      if (!response) throw new Error(`Expected ${path} to be handled by v1`);
      return response;
    };

    const createdResponse = await request("POST", "/v1/tasks", {
      title: "Postgres lifecycle task",
      metadata: {
        _evidence: { test_results: "first completion passed" },
        _completion: { reviewer: "first reviewer" },
      },
    });
    const created = (await createdResponse.json() as { task: Task }).task;

    const startedResponse = await request("POST", `/v1/tasks/${created.id}/start`, { agent_id: "lifecycle-agent" });
    expect(startedResponse.status).toBe(200);

    const firstCompletionResponse = await request("POST", `/v1/tasks/${created.id}/complete`, {
      agent_id: "lifecycle-agent",
      notes: "first completion",
    });
    expect(firstCompletionResponse.status).toBe(200);
    const firstCompletion = (await firstCompletionResponse.json() as { task: Task }).task;
    expect(firstCompletion.completed_at).toBeTruthy();

    const reopenResponse = await request("PATCH", `/v1/tasks/${created.id}`, {
      status: "in_progress",
      version: firstCompletion.version,
    });
    expect(reopenResponse.status).toBe(200);
    const reopened = (await reopenResponse.json() as { task: Task }).task;
    expect(reopened).toMatchObject({
      status: "in_progress",
      completed_at: null,
      metadata: {
        _evidence: { test_results: "first completion passed", notes: "first completion" },
        _completion: { reviewer: "first reviewer" },
      },
    });
    expect(await adapter.tasks.get(created.id)).toEqual(reopened);

    const secondCompletionResponse = await request("POST", `/v1/tasks/${created.id}/complete`, {
      agent_id: "lifecycle-agent",
      notes: "second completion",
    });
    expect(secondCompletionResponse.status).toBe(200);
    const secondCompletion = (await secondCompletionResponse.json() as { task: Task }).task;
    expect(secondCompletion.status).toBe("completed");
    expect(secondCompletion.completed_at).toBeTruthy();
  });

  test("v1 comments persist through a reopened Postgres adapter and redact new and historical content", async () => {
    const { client, calls } = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client, service: "todos" });
    const task = await adapter.tasks.create({ title: "V1 comment persistence" });
    const verifier: ApiKeyVerifier = {
      app: "todos",
      authenticate: async () => ({
        ok: true as const,
        status: 200 as const,
        principal: {
          kid: "test-key-id",
          app: "todos",
          scopes: ["todos:*"],
          agent: "test-agent",
          claims: { v: 1, kid: "test-key-id", app: "todos", scopes: ["todos:*"], iat: 0, exp: null },
        },
      }),
    };
    const dependencies = (storage: TodosStorageAdapter): V1RequestDependencies => ({
      getVerifier: () => verifier,
      ensureSchema: async () => {},
      getStorageAdapter: () => storage,
    });
    const request = async (method: string, path: string, body?: Record<string, unknown>, storage = adapter) => {
      const url = new URL(`https://todos.test${path}`);
      const response = await handleV1Request(
        new Request(url, {
          method,
          headers: { "content-type": "application/json", authorization: "Bearer synthetic-test-key" },
          body: body ? JSON.stringify(body) : undefined,
        }),
        url,
        dependencies(storage),
      );
      if (!response) throw new Error(`Expected ${path} to be handled by v1`);
      return response;
    };

    const first = await request("POST", `/v1/tasks/${task.id}/comments`, { content: "first safe comment" });
    expect(first.status).toBe(201);
    const firstComment = (await first.json() as { comment: { id: string; content: string } }).comment;
    await Bun.sleep(2);
    const second = await request("POST", `/v1/tasks/${task.id}/comments`, {
      content: "Bearer abcdefghijklmnop should redact",
    });
    expect(second.status).toBe(201);
    const secondComment = (await second.json() as { comment: { id: string; content: string } }).comment;
    expect(secondComment.content).toContain("[REDACTED]");

    const commentWrites = calls.filter((call) => call.sql.includes("INSERT INTO todos_sync_records") && call.values?.[1] === "comments");
    expect(commentWrites).toHaveLength(2);
    expect((commentWrites[1]!.values?.[3] as { content: string }).content).toContain("[REDACTED]");
    expect((commentWrites[1]!.values?.[3] as { content: string }).content).not.toContain("abcdefghijklmnop");

    const reopened = createPostgresTodosStorageAdapter({ client, service: "todos" });
    const persisted = await request("GET", `/v1/tasks/${task.id}/comments`, undefined, reopened);
    expect(persisted.status).toBe(200);
    const persistedBody = await persisted.json() as { comments: Array<{ content: string }>; count: number };
    expect(persistedBody.count).toBe(2);
    expect(persistedBody.comments.map((comment) => comment.content)).toEqual([
      "first safe comment",
      "Bearer [REDACTED] should redact",
    ]);

    const historical = {
      id: "historical-comment",
      task_id: task.id,
      agent_id: null,
      session_id: null,
      content: "Bearer abcdefghijklmnop historical",
      type: "comment",
      progress_pct: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    await client.query(
      "INSERT INTO todos_sync_records RETURNING object_id",
      ["todos", "comments", historical.id, historical, historical.created_at, null, null],
    );
    const historicalRead = await request("GET", `/v1/tasks/${task.id}/comments`, undefined, reopened);
    const historicalBody = await historicalRead.json() as {
      comments: Array<{ id: string; content: string }>;
      count: number;
      has_more?: boolean;
    };
    expect(historicalBody).toMatchObject({ count: 3 });
    expect(historicalBody.has_more).toBe(false);
    const safeHistorical = historicalBody.comments.find((comment) => comment.id === historical.id);
    expect(safeHistorical?.content).toContain("[REDACTED]");
    expect(safeHistorical?.content).not.toContain("abcdefghijklmnop");

    const firstPageResponse = await request("GET", `/v1/tasks/${task.id}/comments?limit=2`, undefined, reopened);
    const firstPage = await firstPageResponse.json() as {
      comments: Array<{ id: string }>;
      count: number;
      has_more: boolean;
      next_cursor: string | null;
    };
    expect(firstPage).toMatchObject({ count: 2, has_more: true });
    expect(firstPage.comments.map((comment) => comment.id)).toEqual([firstComment.id, secondComment.id]);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const secondPageResponse = await request(
      "GET",
      `/v1/tasks/${task.id}/comments?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor!)}`,
      undefined,
      reopened,
    );
    const secondPage = await secondPageResponse.json() as {
      comments: Array<{ id: string }>;
      count: number;
      has_more: boolean;
      next_cursor: string | null;
    };
    expect(secondPage.comments.map((comment) => comment.id)).toContain(historical.id);
    expect(secondPage).toMatchObject({ count: 1, has_more: false, next_cursor: null });
    expect(new Set([...firstPage.comments, ...secondPage.comments].map((comment) => comment.id)).size)
      .toBe(firstPage.comments.length + secondPage.comments.length);

    for (const query of [
      "limit=0",
      "limit=501",
      "limit=1.5",
      "limit=not-a-number",
      "cursor=not-a-cursor",
      `cursor=${"a".repeat(1_025)}`,
    ]) {
      const invalid = await request("GET", `/v1/tasks/${task.id}/comments?${query}`, undefined, reopened);
      expect(invalid.status).toBe(400);
    }

    const predecessorAdapter: TodosStorageAdapter = {
      ...reopened,
      audit: {
        ...reopened.audit,
        getComments: () => Array.from({ length: 501 }, (_, index): TaskComment => ({
          id: `legacy-${index}`,
          task_id: task.id,
          agent_id: null,
          session_id: null,
          content: "safe",
          type: "comment",
          progress_pct: null,
          created_at: "2026-07-10T00:00:00.000Z",
        })),
        getCommentsPage: undefined,
      },
    };
    const upgradeRequired = await request("GET", `/v1/tasks/${task.id}/comments`, undefined, predecessorAdapter);
    expect(upgradeRequired.status).toBe(426);
    expect(await upgradeRequired.json()).toMatchObject({ error: expect.stringMatching(/upgrade/i) });
    const adapterUpgradeRequired = await request(
      "GET",
      `/v1/tasks/${task.id}/comments?limit=2`,
      undefined,
      predecessorAdapter,
    );
    expect(adapterUpgradeRequired.status).toBe(426);
    expect(await adapterUpgradeRequired.json()).toMatchObject({ error: expect.stringMatching(/adapter.*upgrade/i) });

    calls.length = 0;
    await reopened.audit.getCommentsPage!(task.id, { limit: 2 });
    const listCall = calls.find((call) => call.sql.includes("todos:list-comments"));
    expect(listCall?.sql).toContain("payload->>'task_id'");
    expect(listCall?.sql).toContain("ORDER BY payload->>'created_at' DESC, object_id DESC");
    expect(listCall?.sql).toContain("LIMIT");
  });

  test("Postgres comment reads use a task-scoped bounded query with deterministic timestamp/id ordering", async () => {
    const { client, calls } = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client, service: "todos" });
    const task = await adapter.tasks.create({ title: "Bounded comments" });
    const timestamp = "2026-07-10T00:00:00.000Z";
    for (const [id, taskId] of [["same-b", task.id], ["same-a", task.id], ["unrelated", "another-task"]] as const) {
      const comment = {
        id,
        task_id: taskId,
        agent_id: null,
        session_id: null,
        content: "safe",
        type: "comment",
        progress_pct: null,
        created_at: timestamp,
      };
      await client.query(
        "INSERT INTO todos_sync_records RETURNING object_id",
        ["todos", "comments", id, comment, timestamp, null, null],
      );
    }
    for (let index = 0; index < 1_000; index += 1) {
      const id = `unrelated-${String(index).padStart(4, "0")}`;
      await client.query(
        "INSERT INTO todos_sync_records RETURNING object_id",
        ["todos", "comments", id, {
          id,
          task_id: "another-task",
          agent_id: null,
          session_id: null,
          content: "safe",
          type: "comment",
          progress_pct: null,
          created_at: timestamp,
        }, timestamp, null, null],
      );
    }

    calls.length = 0;
    const comments = await adapter.audit.getCommentsPage!(task.id, { limit: 2 });
    expect(comments.map((comment) => comment.id)).toEqual(["same-a", "same-b"]);
    const listCall = calls.find((call) => call.sql.includes("todos:list-comments"));
    expect(listCall?.sql).toContain("payload->>'task_id'");
    expect(listCall?.sql).toContain("ORDER BY payload->>'created_at' DESC, object_id DESC");
    expect(listCall?.sql).toContain("LIMIT");
    expect(listCall?.values).toContain(task.id);
  });

  test("legacy Postgres getComments remains complete through bounded task-scoped pages", async () => {
    const { client, calls } = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client, service: "todos" });
    const task = await adapter.tasks.create({ title: "Legacy complete comments" });
    const start = Date.parse("2026-07-10T00:00:00.000Z");
    for (let index = 0; index < 1_001; index += 1) {
      const id = `legacy-page-${String(index).padStart(4, "0")}`;
      const createdAt = new Date(start + index).toISOString();
      await client.query(
        "INSERT INTO todos_sync_records RETURNING object_id",
        ["todos", "comments", id, {
          id,
          task_id: task.id,
          agent_id: null,
          session_id: null,
          content: "safe",
          type: "comment",
          progress_pct: null,
          created_at: createdAt,
        }, createdAt, null, null],
      );
    }

    calls.length = 0;
    const comments = await adapter.audit.getComments(task.id, { requestId: "legacy-reader" });
    expect(comments).toHaveLength(1_001);
    expect(comments[0]?.id).toBe("legacy-page-0000");
    expect(comments.at(-1)?.id).toBe("legacy-page-1000");
    const listCalls = calls.filter((call) => call.sql.includes("todos:list-comments"));
    expect(listCalls).toHaveLength(2);
    expect(listCalls.every((call) => call.values.includes(task.id))).toBe(true);
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

  test("REGRESSION: cloud git refs upsert the stable task+type+name key in place", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "station02" });
    const task = await adapter.tasks.create({ title: "Stable cloud ref" });
    const otherTask = await adapter.tasks.create({ title: "Distinct cloud ref task" });

    const original = await adapter.gitRefs!.add({
      task_id: task.id,
      ref_type: "pull_request",
      name: "hasna/codewith#488",
      url: "https://github.com/hasna/codewith/pull/488",
      provider: "github",
      metadata: { state: "open" },
    });
    const updated = await adapter.gitRefs!.add({
      task_id: task.id,
      ref_type: "pull_request",
      name: "hasna/codewith#488",
      metadata: { state: "merged", merged_at: "2026-08-10T00:00:00.000Z" },
    });

    expect(updated).toMatchObject({
      id: original.id,
      created_at: original.created_at,
      url: "https://github.com/hasna/codewith/pull/488",
      provider: "github",
      metadata: { state: "merged", merged_at: "2026-08-10T00:00:00.000Z" },
    });
    expect(await adapter.gitRefs!.list(task.id)).toEqual([expect.objectContaining({ id: original.id })]);
    expect(await adapter.gitRefs!.find("hasna/codewith#488")).toEqual([
      expect.objectContaining({ id: original.id, task_id: task.id }),
    ]);

    const otherName = await adapter.gitRefs!.add({
      task_id: task.id,
      ref_type: "pull_request",
      name: "hasna/codewith#489",
    });
    const otherType = await adapter.gitRefs!.add({
      task_id: task.id,
      ref_type: "branch",
      name: "hasna/codewith#488",
    });
    const otherTaskRef = await adapter.gitRefs!.add({
      task_id: otherTask.id,
      ref_type: "pull_request",
      name: "hasna/codewith#488",
    });

    expect(new Set([original.id, otherName.id, otherType.id, otherTaskRef.id]).size).toBe(4);
    expect(await adapter.gitRefs!.list(task.id)).toHaveLength(3);
    expect(await adapter.gitRefs!.list(otherTask.id)).toEqual([expect.objectContaining({ id: otherTaskRef.id })]);
  });

  test("REGRESSION: concurrent cloud git ref upserts converge on one stable record", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "station02" });
    const task = await adapter.tasks.create({ title: "Concurrent stable cloud ref" });
    const input = {
      task_id: task.id,
      ref_type: "pull_request" as const,
      name: "hasna/codewith#488",
      url: "https://github.com/hasna/codewith/pull/488",
      provider: "github",
      metadata: { state: "merged" },
    };

    const [left, right] = await Promise.all([
      adapter.gitRefs!.add(input),
      adapter.gitRefs!.add(input),
    ]);
    const persisted = await adapter.gitRefs!.list(task.id);

    expect(left.id).toBe(right.id);
    expect(persisted).toEqual([
      expect.objectContaining({
        id: left.id,
        task_id: task.id,
        ref_type: input.ref_type,
        name: input.name,
      }),
    ]);
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

  test("--assigned resolves an agent's id/name aliases so a filter by either finds rows stored under the other (task 8f07bc15)", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "spark01" });
    const project = await adapter.projects.create({ name: "Alias filter", path: "/tmp/alias-filter" });
    const agent = await adapter.agents.register({ name: "fabricius", project_id: project.id });
    if ("conflict" in agent) throw new Error(agent.message);

    // Reproduces the real split: `add --agent <id>` writes the id, `update
    // --assign <name>` writes the resolved name, into the SAME field.
    const byId = await adapter.tasks.create({ title: "stored under id", project_id: project.id, assigned_to: agent.id });
    const byName = await adapter.tasks.create({ title: "stored under name", project_id: project.id, assigned_to: agent.name });

    // Direction 1: querying by the id finds the row stored under the NAME.
    const foundById = await adapter.tasks.list({ project_id: project.id, assigned_to: agent.id });
    expect(foundById.map((t) => t.id).sort()).toEqual([byId.id, byName.id].sort());

    // Direction 2: querying by the name finds the row stored under the ID.
    const foundByName = await adapter.tasks.list({ project_id: project.id, assigned_to: agent.name });
    expect(foundByName.map((t) => t.id).sort()).toEqual([byId.id, byName.id].sort());

    // count() must agree with list() on both directions (same resolver).
    expect(await adapter.tasks.count({ project_id: project.id, assigned_to: agent.id })).toBe(2);
    expect(await adapter.tasks.count({ project_id: project.id, assigned_to: agent.name })).toBe(2);

    // Direction 3: case-insensitive — a differently-cased query string, and a
    // row whose assigned_to was itself written in the wrong case, both match.
    const byUpperName = await adapter.tasks.create({ title: "stored uppercase", project_id: project.id, assigned_to: "FABRICIUS" });
    const foundByMixedCaseQuery = await adapter.tasks.list({ project_id: project.id, assigned_to: "Fabricius" });
    expect(foundByMixedCaseQuery.map((t) => t.id).sort()).toEqual([byId.id, byName.id, byUpperName.id].sort());

    // Direction 4: a genuinely unknown agent still returns zero, and does not
    // widen to match every row that merely resolved no agent (i.e. the
    // literal-fallback path stays an exact, single-value match).
    const stray = await adapter.tasks.create({ title: "unrelated literal assignee", project_id: project.id, assigned_to: "not-a-registered-agent" });
    expect(await adapter.tasks.list({ project_id: project.id, assigned_to: "zzz-no-such-agent" })).toEqual([]);
    expect((await adapter.tasks.list({ project_id: project.id, assigned_to: "not-a-registered-agent" })).map((t) => t.id))
      .toEqual([stray.id]);
  });

  test("--assigned resolves the SAME way on sqlite and postgres when the name is genuinely ambiguous (task 8f07bc15 remediation, PR #160 finding 1)", async () => {
    // Reproduces the live fleet state cited by 0bf5d979/8f07bc15: two agent
    // rows answering to the same name in different case, registered
    // independently. `adapter.agents.register` now dedupes case-variants
    // (see "resolves agent names case-insensitively on BOTH storage
    // engines" above), so it cannot reproduce the historical split — seed
    // the raw rows directly, exactly as the real duplicate rows exist today
    // (no shared identity_id/reports_to; see resolveAssignedToAliases' doc
    // comment).
    async function seedAgentRow(
      client: TodosPostgresQueryClient,
      agent: { id: string; name: string; lastSeenAt: string },
    ): Promise<void> {
      await client.query(
        `INSERT INTO todos_sync_records (
          service, object_type, object_id, payload, updated_at,
          deleted_at, source_machine_id, version
        ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, NULL, $6, $7)
        ON CONFLICT (service, object_type, object_id) DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at,
          deleted_at = NULL,
          source_machine_id = EXCLUDED.source_machine_id,
          version = EXCLUDED.version
        WHERE todos_sync_records.updated_at IS NULL
           OR todos_sync_records.updated_at < EXCLUDED.updated_at
           OR (todos_sync_records.updated_at = EXCLUDED.updated_at
               AND COALESCE(todos_sync_records.version, 0) <= COALESCE(EXCLUDED.version, 0))
        RETURNING object_id`,
        [
          "todos",
          "agents",
          agent.id,
          {
            id: agent.id,
            name: agent.name,
            status: "active",
            permissions: [],
            capabilities: [],
            metadata: {},
            created_at: agent.lastSeenAt,
            last_seen_at: agent.lastSeenAt,
          },
          agent.lastSeenAt,
          "spark01",
          1,
        ],
      );
    }

    const sqliteTimestamp = new Date().toISOString();
    db.run(
      "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      ["01d4cc12", "fabricius", sqliteTimestamp, sqliteTimestamp, "4d77b218", "Fabricius", sqliteTimestamp, sqliteTimestamp],
    );
    const sqlite = createLocalSqliteTodosStorageAdapter({ db });
    const sqliteProject = await sqlite.projects.create({ name: "Alias ambiguity sqlite", path: "/tmp/alias-ambiguity-sqlite" });

    const postgres = createMemoryPostgresClient();
    const pg = createPostgresTodosStorageAdapter({ client: postgres.client, sourceMachineId: "spark01" });
    const pgProject = await pg.projects.create({ name: "Alias ambiguity postgres", path: "/tmp/alias-ambiguity-postgres" });
    await seedAgentRow(postgres.client, { id: "01d4cc12", name: "fabricius", lastSeenAt: sqliteTimestamp });
    await seedAgentRow(postgres.client, { id: "4d77b218", name: "Fabricius", lastSeenAt: sqliteTimestamp });

    for (const [engine, adapter, project] of [
      ["sqlite", sqlite, sqliteProject],
      ["postgres", pg, pgProject],
    ] as const) {
      const byLiveId = await adapter.tasks.create({ title: "id-stored, live duplicate", project_id: project.id, assigned_to: "01d4cc12" });
      const byStaleId = await adapter.tasks.create({ title: "id-stored, stale duplicate", project_id: project.id, assigned_to: "4d77b218" });
      const byLiteralName = await adapter.tasks.create({ title: "name-stored, ambiguous literal", project_id: project.id, assigned_to: "fabricius" });

      // Must not throw (pre-remediation: sqlite crashed with
      // IdentityAliasAmbiguousError; postgres silently narrowed to the
      // freshest of the two rows instead — neither engine may do that here).
      // If either call below rejects, the test fails right there with the
      // thrown error rather than at a later assertion.

      // Same observable outcome on both engines: an ambiguous name falls
      // back to literal-only matching (identical to a ref matching zero
      // agents), so it finds only the row stored under that literal string
      // — never the id-stored rows of either candidate, and never just one
      // of them via a freshest/first tie-break.
      const foundByAmbiguousName = await adapter.tasks.list({ project_id: project.id, assigned_to: "fabricius" });
      expect(foundByAmbiguousName.map((t) => t.id), `${engine}: ambiguous-name query`).toEqual([byLiteralName.id]);
      expect(await adapter.tasks.count({ project_id: project.id, assigned_to: "fabricius" }), `${engine}: ambiguous-name count`).toBe(1);

      // Querying by either agent's OWN id is unambiguous (id lookup, not the
      // name lookup that collides) and is unaffected: it resolves to exactly
      // that one row and widens to its registered name alias, so it also
      // picks up the literal-"fabricius" task the SAME way on both engines.
      const foundByLiveId = await adapter.tasks.list({ project_id: project.id, assigned_to: "01d4cc12" });
      expect(foundByLiveId.map((t) => t.id).sort(), `${engine}: live-id query`).toEqual([byLiveId.id, byLiteralName.id].sort());
      const foundByStaleId = await adapter.tasks.list({ project_id: project.id, assigned_to: "4d77b218" });
      expect(foundByStaleId.map((t) => t.id).sort(), `${engine}: stale-id query`).toEqual([byStaleId.id, byLiteralName.id].sort());
    }
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

  test("resolves a task by metadata fingerprint (POST /v1/tasks/upsert dedupe)", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const project = await adapter.projects.create({ name: "Fingerprint", path: "/tmp/fp" });
    const created = await adapter.tasks.create({
      title: "fp task",
      project_id: project.id,
      metadata: { fingerprint: "loop:abc:123" },
    });

    // getByFingerprint resolves the SAME row so upsert updates instead of duplicating.
    const found = await adapter.tasks.getByFingerprint!("loop:abc:123");
    expect(found?.id).toBe(created.id);

    // A fingerprint nobody carries resolves to null (→ upsert creates a fresh task).
    expect(await adapter.tasks.getByFingerprint!("loop:none")).toBeNull();

    // The lookup is SQL-side against the shared dataset, never an in-JS scan.
    expect(postgres.calls.some((c) => c.sql.includes("todos:task-by-fingerprint"))).toBe(true);
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

  test("atomically detaches linked tasks when deleting a Postgres plan", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const plan = await adapter.plans.create({ name: "Delete safely" });
    const linked = await adapter.tasks.create({ title: "Linked task", plan_id: plan.id });
    const linkedVersion = linked.version;
    const unrelated = await adapter.tasks.create({ title: "Unrelated task" });

    expect(await adapter.plans.delete(plan.id)).toBe(true);
    expect(await adapter.plans.get(plan.id)).toBeNull();
    expect(await adapter.tasks.get(linked.id)).toMatchObject({ plan_id: null, version: linkedVersion + 1 });
    expect(await adapter.tasks.get(unrelated.id)).toMatchObject({ plan_id: null });
    expect(postgres.calls.some((call) => call.sql.includes("todos:delete-plan-atomic"))).toBe(true);
    expect(await adapter.plans.delete(plan.id)).toBe(false);
  });

  test("Postgres linkage and membership writes share the plan-row lock and receipt exact membership", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const project = await adapter.projects.create({ name: "Guarded project", path: "/guarded-project" });
    const plan = await adapter.plans.create({ name: "Guarded existing plan" });
    const first = await adapter.tasks.create({ title: "First member", plan_id: plan.id });
    const second = await adapter.tasks.create({ title: "Second member", plan_id: plan.id });
    const planned = await planPlanProjectLink(adapter, plan.id, project.id);
    const applied = await applyPlanProjectLink(adapter, plan.id, project.id, {
      expected_plan_revision: planned.plan.updated_at,
      expected_project_revision: planned.project.updated_at,
      idempotency_key: "postgres-lock-membership-fixture",
    });

    expect(applied.receipt).toMatchObject({
      task_ids: [first.id, second.id].sort(),
      task_count: 2,
    });
    expect(applied.tasks.map((task) => task.project_id)).toEqual([project.id, project.id]);
    const future = await adapter.tasks.create({ title: "Future member", plan_id: plan.id });
    expect(future.project_id).toBe(project.id);
    expect(await adapter.tasks.get(future.id)).toMatchObject({
      id: future.id,
      plan_id: plan.id,
      project_id: project.id,
    });
    await expect(adapter.tasks.create({
      title: "Conflicting member",
      plan_id: plan.id,
      project_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    })).rejects.toMatchObject({ code: "PLAN_PROJECT_LINK_CONFLICT" });

    const membershipGuardsBeforeStart = postgres.calls.filter((call) =>
      call.sql.includes("todos:task-plan-membership-guard")
    ).length;
    const started = await adapter.tasks.start(future.id, "guarded-agent");
    expect(started.project_id).toBe(project.id);
    expect(postgres.calls.filter((call) =>
      call.sql.includes("todos:task-plan-membership-guard")
    ).length).toBe(membershipGuardsBeforeStart + 1);

    const runtimeOnlyOverwrite = { name: "Guarded existing plan renamed", project_id: null };
    const renamed = await adapter.plans.update(plan.id, runtimeOnlyOverwrite);
    expect(renamed.project_id).toBe(project.id);
    expect(await adapter.plans.get(plan.id)).toMatchObject({
      name: "Guarded existing plan renamed",
      project_id: project.id,
    });

    const linkSql = postgres.calls.find((call) => call.sql.includes("todos:plan-project-link-atomic"))?.sql;
    const membershipSql = postgres.calls.find((call) => call.sql.includes("todos:task-plan-membership-guard"))?.sql;
    const planUpdateSql = postgres.calls.find((call) => call.sql.includes("todos:plan-update-project-link-guard"))?.sql;
    expect(linkSql).toContain("target_plan AS MATERIALIZED");
    expect(linkSql).toContain("EXISTS (SELECT 1 FROM target_plan)");
    expect(membershipSql).toContain("locked_plans AS MATERIALIZED");
    expect(membershipSql).toContain("FOR UPDATE");
    expect(membershipSql).toContain("todos:task-parent-integrity-guard");
    expect(membershipSql).not.toContain("pg_advisory_xact_lock");
    expect(membershipSql).toContain("parent_chain");
    expect(planUpdateSql).toContain("locked_plan AS MATERIALIZED");
    expect(planUpdateSql).toContain("FOR UPDATE");
  });

  test("guards Postgres parent repair and clear while preserving cross-project routing", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const childProject = await adapter.projects.create({
      name: "Guarded child project",
      path: "/guarded-child-project",
    });
    const parentProject = await adapter.projects.create({
      name: "Guarded parent project",
      path: "/guarded-parent-project",
    });
    const originalParent = await adapter.tasks.create({
      title: "Guarded original parent",
      project_id: childProject.id,
    });
    const crossProjectParent = await adapter.tasks.create({
      title: "Guarded cross-project parent",
      project_id: parentProject.id,
    });
    const child = await adapter.tasks.create({
      title: "Guarded repairable child",
      project_id: childProject.id,
      parent_id: originalParent.id,
    });

    const repaired = await adapter.tasks.update(child.id, {
      version: child.version,
      parent_id: crossProjectParent.id,
    });
    expect(repaired).toMatchObject({
      id: child.id,
      created_at: child.created_at,
      project_id: childProject.id,
      parent_id: crossProjectParent.id,
    });
    expect(await adapter.tasks.get(child.id)).toMatchObject({
      project_id: childProject.id,
      parent_id: crossProjectParent.id,
    });

    await expect(adapter.tasks.update(crossProjectParent.id, {
      version: crossProjectParent.version,
      parent_id: child.id,
    })).rejects.toMatchObject({ code: "TASK_PARENT_CYCLE" });
    await expect(adapter.tasks.update(child.id, {
      version: repaired.version,
      parent_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    })).rejects.toBeInstanceOf(TaskNotFoundError);

    const cleared = await adapter.tasks.update(child.id, {
      version: repaired.version,
      parent_id: null,
    });
    expect(cleared.parent_id).toBeNull();
    expect((await adapter.tasks.get(child.id))?.parent_id).toBeNull();

    const descendant = await adapter.tasks.create({
      title: "Guarded descendant",
      parent_id: child.id,
    });
    expect(await adapter.tasks.delete(child.id)).toBe(true);
    expect(await adapter.tasks.get(child.id)).toBeNull();
    expect(await adapter.tasks.get(descendant.id)).toBeNull();
    await expect(adapter.tasks.create({
      title: "Guarded late child",
      parent_id: child.id,
    })).rejects.toBeInstanceOf(TaskNotFoundError);

    const parentSql = postgres.calls.find((call) =>
      call.sql.includes("todos:task-parent-integrity-guard") && call.values?.[9] === true
    )?.sql;
    expect(parentSql).toContain("WITH RECURSIVE");
    expect(parentSql).toContain("parent_chain");
    const deleteSql = postgres.calls.find((call) =>
      call.sql.includes("todos:task-parent-integrity-delete")
    )?.sql;
    expect(deleteSql).toContain("WITH RECURSIVE");
    expect(deleteSql).toContain("task_tree");
    expect(deleteSql).toContain("related.object_type = 'dependencies'");
    expect(deleteSql).toContain("related.payload->>'depends_on'");
    expect(deleteSql).toContain("related.object_type IN ('comments', 'verifications', 'commits', 'refs')");
    const firstLock = postgres.calls.findIndex((call) =>
      call.sql.includes("todos:task-parent-integrity-lock")
    );
    const firstParentWrite = postgres.calls.findIndex((call) =>
      call.sql.includes("todos:task-parent-integrity-guard") && call.values?.[9] === true
    );
    const firstDelete = postgres.calls.findIndex((call) =>
      call.sql.includes("todos:task-parent-integrity-delete")
    );
    expect(firstLock).toBeGreaterThanOrEqual(0);
    expect(firstParentWrite).toBeGreaterThan(firstLock);
    expect(firstDelete).toBeGreaterThan(firstLock);
    expect(postgres.calls[firstLock]!.sql).toContain("pg_advisory_xact_lock");
    expect(parentSql).not.toContain("pg_advisory_xact_lock");
    expect(deleteSql).not.toContain("pg_advisory_xact_lock");
  });

  test("cascades Postgres hierarchy deletion to task-owned records", async () => {
    const postgres = createMemoryPostgresClient();
    const adapter = createPostgresTodosStorageAdapter({
      client: postgres.client,
      sourceMachineId: "spark01",
    });
    const parent = await adapter.tasks.create({ title: "Related parent" });
    const child = await adapter.tasks.create({
      title: "Related child",
      parent_id: parent.id,
    });
    const dependent = await adapter.tasks.create({ title: "Related dependent" });
    const externalBlocker = await adapter.tasks.create({ title: "Related external blocker" });
    const commitSha = "b".repeat(40);
    const refName = `related-${child.id}`;

    await adapter.dependencies!.add(dependent.id, child.id);
    await adapter.dependencies!.add(child.id, externalBlocker.id);
    await adapter.audit.addComment({ task_id: child.id, content: "Related comment" });
    await adapter.verifications!.add({
      task_id: child.id,
      command: "bun run test",
      status: "passed",
    });
    await adapter.commits!.add({ task_id: child.id, sha: commitSha });
    await adapter.gitRefs!.add({ task_id: child.id, ref_type: "branch", name: refName });

    expect(await adapter.tasks.delete(parent.id)).toBe(true);
    expect(await adapter.dependencies!.list(dependent.id)).toEqual({
      dependencies: [],
      blocks: [],
      blocked_by: [],
    });
    expect(await adapter.audit.getComments(child.id)).toEqual([]);
    expect(await adapter.verifications!.list(child.id)).toEqual([]);
    expect(await adapter.commits!.list(child.id)).toEqual([]);
    expect(await adapter.commits!.find(commitSha)).toBeNull();
    expect(await adapter.gitRefs!.list(child.id)).toEqual([]);
    expect(await adapter.gitRefs!.find(refName)).toEqual([]);
  });

  test("fails parent mutations closed when the Postgres client cannot pin a transaction", async () => {
    const postgres = createMemoryPostgresClient();
    const queryOnlyClient: TodosPostgresQueryClient = {
      query: postgres.client.query.bind(postgres.client),
    };
    const adapter = createPostgresTodosStorageAdapter({
      client: queryOnlyClient,
      sourceMachineId: "spark01",
    });
    const parent = await adapter.tasks.create({ title: "Query-only parent" });

    await expect(adapter.tasks.create({
      title: "Query-only child",
      parent_id: parent.id,
    })).rejects.toThrow("TASK_PARENT_ATOMICITY_UNAVAILABLE");
    await expect(adapter.tasks.delete(parent.id)).rejects.toThrow(
      "TASK_PARENT_ATOMICITY_UNAVAILABLE",
    );
    await expect(adapter.tasks.update(parent.id, {
      version: parent.version,
      title: "Query-only update",
    })).rejects.toThrow("TASK_PARENT_ATOMICITY_UNAVAILABLE");
    expect(await adapter.tasks.get(parent.id)).toMatchObject({ id: parent.id });
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

  test("builds a hybrid local plus Postgres sync adapter through its explicit constructor", async () => {
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
    // The hybrid dual-write adapter is migration machinery, reachable only
    // through this explicit constructor — the data-backend switch has exactly
    // two arms (sqlite | postgres) and never returns it.
    const adapter: HybridTodosStorageAdapter = createHybridTodosStorageAdapter({
      local: { db },
      postgresClient: client,
      sourceMachineId: "apple06",
    });

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

  test("retired storage-mode variables are inert: the DSN alone selects the backend", () => {
    expect(loadTodosStorageConfig({ HASNA_TODOS_STORAGE_MODE: "remote" }).mode).toBe("sqlite");
    expect(
      loadTodosStorageConfig({
        TODOS_STORAGE_MODE: "postgres",
        HASNA_TODOS_DATABASE_URL: "postgres://todos@rds.example/todos",
      }).mode,
    ).toBe("postgres");
  });

  test("defines RDS-friendly Postgres sync schema without unsafe identifiers", () => {
    const schema = postgresTodosSyncSchemaSql();

    expect(schema.join("\n")).toContain("CREATE TABLE IF NOT EXISTS todos_sync_records");
    expect(schema.join("\n")).toContain("payload jsonb NOT NULL");
    expect(schema.join("\n")).not.toContain("task_list_scope_slug_uidx");
    expect(schema.join("\n")).not.toContain("project_task_list_slug_uidx");
    expect(schema.join("\n")).toContain("CREATE TABLE IF NOT EXISTS todos_sync_cursors");
    expect(schema.join("\n")).not.toContain("comment_task_created_idx");
    expect(postgresTodosCommentCursorIndexSql()).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(postgresTodosCommentCursorIndexSql()).toContain("comment_task_created_idx");
    expect(() => postgresTodosSyncSchemaSql("todos;drop")).toThrow("Unsafe Postgres identifier");
    expect(() => postgresTodosCommentCursorIndexSql("todos;drop")).toThrow("Unsafe Postgres identifier");
    expect(() => postgresTodosScopedSlugIndexStatusSql("todos;drop")).toThrow("Unsafe Postgres identifier");
  });

  test("audits scoped slug duplicates before building predeploy unique indexes", async () => {
    const preflight = postgresTodosScopedSlugPreflightSql();
    const indexes = postgresTodosScopedSlugUniqueIndexSql();
    const statusSql = postgresTodosScopedSlugIndexStatusSql();
    expect(preflight).toContain("todos:scoped-slug-duplicate-audit");
    expect(preflight).toContain("array_agg(object_id ORDER BY object_id)");
    expect(preflight).toContain("regexp_replace(lower(COALESCE(slug, ''))");
    expect(preflight).toContain("jsonb_typeof(payload->'slug') AS slug_type");
    expect(preflight).toContain("jsonb_typeof(payload->'task_list_id') AS slug_type");
    expect(preflight).toContain("jsonb_typeof(payload->'project_id') AS scope_type");
    expect(preflight).toContain("NULL::text AS scope_type");
    expect(preflight).toContain("slug_type IS DISTINCT FROM 'string'");
    expect(preflight).toContain("scope_type IS NOT NULL AND scope_type NOT IN ('string', 'null')");
    expect(preflight).toContain("scope_type = 'string' AND btrim(scope) = ''");
    expect(preflight).toContain("'invalid'::text AS issue");
    expect(indexes).toHaveLength(2);
    expect(indexes.every((sql) => sql.includes("CREATE UNIQUE INDEX CONCURRENTLY"))).toBe(true);
    expect(indexes.join("\n")).toContain("task_list_scope_slug_uidx");
    expect(indexes.join("\n")).toContain("project_task_list_slug_uidx");
    expect(statusSql).toContain("todos:scoped-slug-index-status");
    expect(statusSql).toContain("index_meta.indrelid = to_regclass('todos_sync_records')");
    expect(statusSql).not.toContain("table_class.relname");

    const calls: string[] = [];
    const conflictClient: TodosPostgresQueryClient = {
      async query<T = Record<string, unknown>>(sql: string) {
        calls.push(sql);
        return { rows: [{
          service: "todos",
          object_type: "task_lists",
          scope: "project-1",
          slug: "inbox",
          object_ids: ["list-a", "list-b"],
          duplicate_count: 2,
          issue: "duplicate",
        }] as T[] };
      },
    };
    try {
      await ensurePostgresScopedSlugUniqueIndexes(conflictClient);
      throw new Error("expected duplicate audit to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: "PostgresScopedSlugMigrationConflictError",
        conflicts: [expect.objectContaining({ slug: "inbox", object_ids: ["list-a", "list-b"] })],
      });
    }
    expect(calls).toHaveLength(1);

    const invalidCalls: string[] = [];
    await expect(ensurePostgresScopedSlugUniqueIndexes({
      async query<T = Record<string, unknown>>(sql: string) {
        invalidCalls.push(sql);
        return { rows: [{
          service: "todos",
          object_type: "projects",
          scope: "",
          slug: "<null>",
          object_ids: ["project-a"],
          duplicate_count: 1,
          issue: "invalid",
        }] as T[] };
      },
    })).rejects.toMatchObject({
      name: "PostgresScopedSlugMigrationConflictError",
      conflicts: [expect.objectContaining({ issue: "invalid", object_ids: ["project-a"] })],
    });
    expect(invalidCalls).toEqual([preflight]);

    const cleanCalls: string[] = [];
    await ensurePostgresScopedSlugUniqueIndexes({
      async query<T = Record<string, unknown>>(sql: string) {
        cleanCalls.push(sql);
        return { rows: (sql.includes("todos:scoped-slug-index-status") ? [
          { index_name: "todos_sync_records_task_list_scope_slug_uidx", is_valid: true, is_ready: true },
          { index_name: "todos_sync_records_project_task_list_slug_uidx", is_valid: true, is_ready: true },
        ] : []) as T[] };
      },
    });
    expect(cleanCalls).toEqual([preflight, ...indexes, statusSql]);

    let migrationCall = 0;
    await expect(ensurePostgresScopedSlugUniqueIndexes({
      async query<T = Record<string, unknown>>() {
        migrationCall += 1;
        if (migrationCall === 2) throw Object.assign(new Error("concurrent duplicate"), { code: "23505" });
        return { rows: [] as T[] };
      },
    })).rejects.toMatchObject({
      name: "PostgresScopedSlugIndexBuildError",
      index_name: "todos_sync_records_task_list_scope_slug_uidx",
    });

    await expect(ensurePostgresScopedSlugUniqueIndexes({
      async query<T = Record<string, unknown>>(sql: string) {
        if (!sql.includes("todos:scoped-slug-index-status")) return { rows: [] as T[] };
        return { rows: [{
          index_name: "todos_sync_records_task_list_scope_slug_uidx",
          is_valid: false,
          is_ready: false,
        }] as T[] };
      },
    })).rejects.toMatchObject({
      name: "PostgresScopedSlugIndexBuildError",
      index_name: "todos_sync_records_task_list_scope_slug_uidx",
    });
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
      bucket: "todos-artifacts-test",
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
      bucket: "todos-artifacts-test",
      key: "todos/exports/report.json",
      etag: "\"etag\"",
    });
    expect(requests[0]?.url).toBe("https://s3.example.test/todos-artifacts-test/todos/exports/report.json");
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
          bucket: "todos-artifacts-test",
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
        bucket: "todos-artifacts-test",
        relative_path: `artifacts/${task.id}/${artifact.sha256}`,
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

  test("uploads a run artifact to S3 at creation when a bucket is configured", async () => {
    const previousArtifactsDir = process.env["HASNA_TODOS_ARTIFACTS_DIR"];
    const artifactRoot = mkdtempSync(join(tmpdir(), "todos-creation-upload-"));
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = artifactRoot;
    try {
      const adapter = createLocalSqliteTodosStorageAdapter({ db });
      const task = await adapter.tasks.create({ title: "Creation upload task" });
      const run = startTaskRun({ task_id: task.id, title: "creation upload" }, db);
      const sourcePath = join(artifactRoot, "evidence.log");
      writeFileSync(sourcePath, "created then uploaded\nTOKEN=secret-token-value\n");
      const artifact = addTaskRunArtifact({
        run_id: run.id,
        path: sourcePath,
        artifact_type: "log",
        store_content: true,
      }, db);
      expect(artifact.metadata["remote_artifact_store"]).toBeUndefined();

      const objects = new Map<string, Uint8Array>();
      const s3 = createTodosS3ArtifactStore({
        config: {
          provider: "s3",
          bucket: "todos-artifacts-test",
          prefix: "prod/artifacts/",
          region: "us-east-1",
          endpoint: "https://s3.example.test",
          forcePathStyle: true,
        },
        credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
        now: () => new Date("2026-06-08T12:00:00.000Z"),
        fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
          const href = url.toString();
          if (init?.method === "PUT") {
            objects.set(href, init.body instanceof Uint8Array ? init.body : Buffer.from(String(init?.body ?? "")));
            return new Response("", { status: 200, headers: { etag: "\"etag\"" } });
          }
          return new Response("", { status: 404 });
        }) as typeof fetch,
      });

      const report = await uploadRunArtifactAtCreation({
        artifactId: artifact.id,
        db,
        store: s3,
        now: () => new Date("2026-06-08T12:01:00.000Z"),
      });

      expect(report).toMatchObject({ uploaded: true, reason: "uploaded" });
      const relativePath = `artifacts/${task.id}/${artifact.sha256}`;
      expect(report.ref).toMatchObject({
        provider: "s3",
        bucket: "todos-artifacts-test",
        relative_path: relativePath,
        sha256: artifact.sha256,
        size_bytes: artifact.size_bytes,
      });
      const store = artifact.metadata["artifact_store"] as Record<string, unknown>;
      expect(report.ref?.key).toBe(`prod/artifacts/${relativePath}`);

      const remote = getTaskRunLedger(run.id, db).artifacts[0]!.metadata["remote_artifact_store"] as Record<string, unknown>;
      expect(remote.relative_path).toBe(relativePath);
      expect(remote.uploaded_at).toBe("2026-06-08T12:01:00.000Z");

      // The object digest equals the recorded content hash (acceptance).
      const objectUrl = `https://s3.example.test/todos-artifacts-test/prod/artifacts/${relativePath}`;
      const object = objects.get(objectUrl);
      expect(object).toBeDefined();
      expect(remote.sha256).toBe(artifact.sha256);
      expect(Buffer.from(object!).toString("utf8")).toContain("created then uploaded");
      expect(Buffer.from(object!).toString("utf8")).not.toContain("secret-token-value");

      // A second call is idempotent: content already remote, nothing re-uploaded.
      const before = objects.size;
      const again = await uploadRunArtifactAtCreation({
        artifactId: artifact.id,
        db,
        store: s3,
        now: () => new Date("2026-06-08T12:02:00.000Z"),
      });
      expect(again).toMatchObject({ uploaded: true, reason: "already_remote" });
      expect(objects.size).toBe(before);
    } finally {
      if (previousArtifactsDir === undefined) delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
      else process.env["HASNA_TODOS_ARTIFACTS_DIR"] = previousArtifactsDir;
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  });

  test("keeps run artifacts local-only when no bucket is configured and fails softly without credentials", async () => {
    const previousArtifactsDir = process.env["HASNA_TODOS_ARTIFACTS_DIR"];
    const artifactRoot = mkdtempSync(join(tmpdir(), "todos-creation-local-"));
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = artifactRoot;
    try {
      const adapter = createLocalSqliteTodosStorageAdapter({ db });
      const task = await adapter.tasks.create({ title: "Local fallback task" });
      const run = startTaskRun({ task_id: task.id, title: "local fallback" }, db);
      const sourcePath = join(artifactRoot, "evidence.log");
      writeFileSync(sourcePath, "stays local\n");
      const artifact = addTaskRunArtifact({ run_id: run.id, path: sourcePath, store_content: true }, db);

      // No bucket configured -> local-only fallback, no error.
      const noBucket = await uploadRunArtifactAtCreation({
        artifactId: artifact.id,
        db,
        env: {},
      });
      expect(noBucket).toMatchObject({ uploaded: false, reason: "s3_not_configured" });

      // Bucket configured but credentials missing -> fail-soft, no throw.
      const noCreds = await uploadRunArtifactAtCreation({
        artifactId: artifact.id,
        db,
        env: { HASNA_TODOS_S3_BUCKET: "todos-artifacts-test" },
      });
      expect(noCreds).toMatchObject({ uploaded: false, reason: "s3_credentials_missing" });

      // An unknown artifact id is reported, never thrown.
      const missing = await uploadRunArtifactAtCreation({ artifactId: "no-such-artifact", db });
      expect(missing).toMatchObject({ uploaded: false, reason: "artifact_not_found" });

      // With a bucket configured, an injected store uploads under the remote
      // key even when the artifact was created without env credentials.
      const fallbackStore = createTodosS3ArtifactStore({
        config: {
          provider: "s3",
          bucket: "todos-artifacts-test",
          prefix: "todos/",
          forcePathStyle: false,
          endpoint: "https://s3.example.test",
        },
        credentials: { accessKeyId: "fb-access", secretAccessKey: "fb-secret" },
        now: () => new Date("2026-06-08T12:00:00.000Z"),
        fetch: (async () => new Response("", { status: 200, headers: { etag: "\"e\"" } })) as typeof fetch,
      });
      const viaStore = await uploadRunArtifactAtCreation({
        artifactId: artifact.id,
        db,
        env: {}, // no credentials in env: the injected store is the source
        store: fallbackStore,
      });
      expect(viaStore).toMatchObject({ uploaded: true, reason: "uploaded" });

      const remote = getTaskRunLedger(run.id, db).artifacts[0]!.metadata["remote_artifact_store"] as Record<string, unknown>;
      expect(remote.relative_path).toBe(remoteArtifactKey(task.id, artifact.sha256!));
    } finally {
      if (previousArtifactsDir === undefined) delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
      else process.env["HASNA_TODOS_ARTIFACTS_DIR"] = previousArtifactsDir;
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  });

  test("keeps the artifact row intact when the creation upload fails", async () => {
    const previousArtifactsDir = process.env["HASNA_TODOS_ARTIFACTS_DIR"];
    const artifactRoot = mkdtempSync(join(tmpdir(), "todos-creation-fail-"));
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = artifactRoot;
    try {
      const adapter = createLocalSqliteTodosStorageAdapter({ db });
      const task = await adapter.tasks.create({ title: "Fail soft task" });
      const run = startTaskRun({ task_id: task.id, title: "fail soft" }, db);
      const sourcePath = join(artifactRoot, "evidence.log");
      writeFileSync(sourcePath, "kept anyway\n");
      const artifact = addTaskRunArtifact({ run_id: run.id, path: sourcePath, store_content: true }, db);

      const s3 = createTodosS3ArtifactStore({
        config: {
          provider: "s3",
          bucket: "todos-artifacts-test",
          prefix: "todos/",
          forcePathStyle: false,
          endpoint: "https://s3.example.test",
        },
        credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
        now: () => new Date("2026-06-08T12:00:00.000Z"),
        fetch: (async () => new Response("", { status: 500 })) as typeof fetch,
      });

      const report = await uploadRunArtifactAtCreation({ artifactId: artifact.id, db, store: s3 });
      expect(report).toMatchObject({ uploaded: false, reason: "upload_error" });
      expect(report.error).toContain("S3 put failed");
      // The artifact row still exists and carries no remote reference.
      const ledger = getTaskRunLedger(run.id, db).artifacts[0]!;
      expect(ledger.metadata["remote_artifact_store"]).toBeUndefined();
      expect(ledger.id).toBe(artifact.id);

      // Metadata-only artifacts (store_content: false) are never uploaded.
      const metadataOnly = addTaskRunArtifact({
        run_id: run.id,
        path: join(artifactRoot, "missing.log"),
        store_content: false,
      }, db);
      const skipped = await uploadRunArtifactAtCreation({ artifactId: metadataOnly.id, db, store: s3 });
      expect(skipped).toMatchObject({ uploaded: false, reason: "no_local_content" });
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

  test("reads creation-time S3 credentials from canonical and fallback env names", () => {
    const { creationCredentialsFromEnv } = require("../storage/run-artifact-creation-upload.js") as typeof import("../storage/run-artifact-creation-upload.js");
    expect(creationCredentialsFromEnv({
      HASNA_TODOS_S3_ACCESS_KEY_ID: "canonical-access",
      HASNA_TODOS_S3_SECRET_ACCESS_KEY: "canonical-secret",
      HASNA_TODOS_S3_SESSION_TOKEN: "canonical-session",
    })).toEqual({
      accessKeyId: "canonical-access",
      secretAccessKey: "canonical-secret",
      sessionToken: "canonical-session",
    });
    expect(creationCredentialsFromEnv({
      TODOS_S3_ACCESS_KEY_ID: "fallback-access",
      TODOS_S3_SECRET_ACCESS_KEY: "fallback-secret",
    })).toEqual({
      accessKeyId: "fallback-access",
      secretAccessKey: "fallback-secret",
    });
    expect(creationCredentialsFromEnv({})).toBeNull();
    expect(creationCredentialsFromEnv({ HASNA_TODOS_S3_ACCESS_KEY_ID: "only-a-key" })).toBeNull();
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

function createMemoryPostgresClient(options: { rejectWritesForObjectType?: string } = {}): {
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
    sourceMachineId?: string | null;
    version: number | null;
  }

  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const rows = new Map<string, Row>();
  const cursors = new Map<string, string>();
  const recordKey = (service: unknown, objectType: unknown, objectId: unknown) =>
    `${String(service)}:${String(objectType)}:${String(objectId)}`;

  const client: TodosPostgresQueryClient = {
    async transaction<T>(fn: (transaction: TodosPostgresQueryClient) => Promise<T>): Promise<T> {
      return fn(client);
    },
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });

      if (sql.includes("todos:complete-task-atomic")) {
        const [service, taskId, agentId, completedAt, hasEvidence, rawEvidence, hasConfidence, confidence, operationTimestamp, lockExpiryCutoff] = values;
        const row = rows.get(recordKey(service, "tasks", taskId));
        if (!row || row.deletedAt) return { rows: [] as T[] };
        const payload = structuredClone(row.payload) as Record<string, unknown>;
        if (sql.includes("todos:complete-task-lock-guard")) {
          const lockedBy = typeof payload["locked_by"] === "string" ? payload["locked_by"] as string : null;
          const lockedAt = typeof payload["locked_at"] === "string" ? payload["locked_at"] as string : null;
          const live = Boolean(
            lockedBy && lockedAt && typeof lockExpiryCutoff === "string" &&
            Date.parse(lockedAt) >= Date.parse(lockExpiryCutoff),
          );
          const sameHolder = Boolean(
            lockedBy && typeof agentId === "string" &&
            lockedBy.trim().toLowerCase() === agentId.trim().toLowerCase(),
          );
          if (live && !sameHolder) return { rows: [] as T[] };
        }
        const metadata = payload["metadata"] && typeof payload["metadata"] === "object" && !Array.isArray(payload["metadata"])
          ? payload["metadata"] as Record<string, unknown>
          : {};
        const existingEvidence = metadata["_evidence"] && typeof metadata["_evidence"] === "object" && !Array.isArray(metadata["_evidence"])
          ? metadata["_evidence"] as Record<string, unknown>
          : {};
        const existingCompletion = metadata["_completion"] && typeof metadata["_completion"] === "object" && !Array.isArray(metadata["_completion"])
          ? metadata["_completion"] as Record<string, unknown>
          : {};
        const nextMetadata = {
          ...metadata,
          ...(hasEvidence ? { _evidence: { ...existingEvidence, ...parseJsonb(rawEvidence) as Record<string, unknown> } } : {}),
          ...(hasConfidence ? { _completion: { ...existingCompletion, confidence } } : {}),
        };
        payload["status"] = "completed";
        payload["assigned_to"] ??= agentId ?? null;
        payload["completed_at"] = completedAt;
        payload["updated_at"] = operationTimestamp;
        payload["version"] = Number(payload["version"] ?? 0) + 1;
        payload["metadata"] = nextMetadata;
        if (sql.includes("todos:complete-task-clears-lock")) {
          payload["locked_by"] = null;
          payload["locked_at"] = null;
        }
        if (hasConfidence) payload["confidence"] = confidence;
        row.payload = payload;
        row.updatedAt = String(operationTimestamp);
        row.version = (row.version ?? 0) + 1;
        return { rows: [{ payload }] as T[] };
      }

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
        // assigned_to is matched as a case-insensitive alias SET, not a scalar
        // equality — see buildTaskFilterSql/resolveAssignedToAliases (task
        // 8f07bc15). The IN list is already lower-cased by the real code.
        if (sql.includes("LOWER(payload->>'assigned_to') IN (")) {
          const lowered = grabIn("LOWER(payload->>'assigned_to') IN (")!;
          preds.push((t) => lowered.includes(String(t["assigned_to"] ?? "").toLowerCase()));
        }
        if (sql.includes("payload->>'agent_id' = $")) {
          const v = grabScalar("payload->>'agent_id' = ");
          preds.push((t) => (t["agent_id"] ?? null) === v);
        }
        if (sql.includes("payload->>'session_id' = $")) {
          const v = grabScalar("payload->>'session_id' = ");
          preds.push((t) => (t["session_id"] ?? null) === v);
        }
        if (sql.includes("jsonb_array_elements_text(COALESCE(payload->'tags'")) {
          const tags = grabIn("task_tags.tag IN (")!;
          preds.push((t) => Array.isArray(t["tags"]) && (t["tags"] as string[]).some((x) => tags.includes(x)));
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

      if (sql.includes("todos:task-by-fingerprint")) {
        const [service, , fingerprint] = values;
        const matches = [...rows.values()]
          .filter((row) => row.service === service && row.objectType === "tasks" && !row.deletedAt)
          .map((row) => row.payload as Record<string, unknown>)
          .filter((payload) => {
            const meta = payload["metadata"] as Record<string, unknown> | undefined;
            return meta?.["fingerprint"] === fingerprint;
          })
          .sort((a, b) => String(a["created_at"]).localeCompare(String(b["created_at"])));
        return { rows: (matches[0] ? [{ payload: matches[0] }] : []) as T[] };
      }

      if (sql.includes("todos:delete-plan-atomic")) {
        const [service, planId, updatedAt] = values;
        const planRow = rows.get(recordKey(service, "plans", planId));
        if (!planRow || planRow.deletedAt) {
          return { rows: [{ found: false, tasks_updated: 0 }] as T[] };
        }
        let tasksUpdated = 0;
        for (const row of rows.values()) {
          const payload = row.payload as Record<string, unknown>;
          if (row.service === service && row.objectType === "tasks" && !row.deletedAt && payload["plan_id"] === planId) {
            payload["plan_id"] = null;
            payload["updated_at"] = updatedAt;
            payload["version"] = Number(payload["version"] ?? 0) + 1;
            row.updatedAt = String(updatedAt);
            row.version = (row.version ?? 0) + 1;
            tasksUpdated += 1;
          }
        }
        planRow.deletedAt = String(updatedAt);
        planRow.updatedAt = String(updatedAt);
        planRow.version = (planRow.version ?? 0) + 1;
        return { rows: [{ found: true, tasks_updated: tasksUpdated }] as T[] };
      }

      if (sql.includes("todos:list-comments")) {
        const service = values[0];
        const taskId = values[1];
        const hasBefore = sql.includes("(payload->>'created_at', object_id) <");
        const beforeCreatedAt = hasBefore ? String(values[2]) : null;
        const beforeId = hasBefore ? String(values[3]) : null;
        const limit = Number(values[hasBefore ? 4 : 2]);
        const selected = [...rows.values()]
          .filter((row) => row.service === service && row.objectType === "comments" && !row.deletedAt)
          .filter((row) => (row.payload as Record<string, unknown>)["task_id"] === taskId)
          .filter((row) => {
            if (!hasBefore) return true;
            const createdAt = String((row.payload as Record<string, unknown>)["created_at"]);
            return createdAt < beforeCreatedAt! || (createdAt === beforeCreatedAt && row.objectId < beforeId!);
          })
          .sort((left, right) => {
            const leftCreatedAt = String((left.payload as Record<string, unknown>)["created_at"]);
            const rightCreatedAt = String((right.payload as Record<string, unknown>)["created_at"]);
            return rightCreatedAt.localeCompare(leftCreatedAt) || right.objectId.localeCompare(left.objectId);
          })
          .slice(0, limit);
        return { rows: selected.map((row) => ({ payload: row.payload })) as T[] };
      }

      if (sql.includes("todos:rename-project-atomic")) {
        const [service, projectId, newSlug, name, updatedAt] = values;
        const projectRow = rows.get(recordKey(service, "projects", projectId));
        if (!projectRow || projectRow.deletedAt) {
          return { rows: [{ found: false, project_conflict: false, task_list_conflict: false, project: null, task_lists_updated: 0 }] as T[] };
        }
        const project = projectRow.payload as Record<string, unknown>;
        const oldSlug = project["task_list_id"];
        const projectConflict = [...rows.values()].some((row) =>
          row.service === service && row.objectType === "projects" && row.objectId !== projectId && !row.deletedAt &&
          (row.payload as Record<string, unknown>)["task_list_id"] === newSlug
        );
        const listConflict = [...rows.values()].some((row) =>
          row.service === service && row.objectType === "task_lists" && !row.deletedAt &&
          (row.payload as Record<string, unknown>)["project_id"] === projectId &&
          (row.payload as Record<string, unknown>)["slug"] === newSlug && newSlug !== oldSlug
        );
        if (projectConflict || listConflict) {
          return { rows: [{ found: true, project_conflict: projectConflict, task_list_conflict: listConflict, project: null, task_lists_updated: 0 }] as T[] };
        }
        let updated = 0;
        const projectChanged = oldSlug !== newSlug || (name !== null && project["name"] !== name);
        for (const row of rows.values()) {
          const payload = row.payload as Record<string, unknown>;
          if (row.service === service && row.objectType === "task_lists" && !row.deletedAt &&
              payload["project_id"] === projectId && payload["slug"] === oldSlug &&
              (oldSlug !== newSlug || (name !== null && payload["name"] !== name))) {
            payload["slug"] = newSlug;
            if (name !== null) payload["name"] = name;
            payload["updated_at"] = updatedAt;
            row.updatedAt = String(updatedAt);
            row.version = (row.version ?? 0) + 1;
            updated += 1;
          }
        }
        if (projectChanged) {
          project["task_list_id"] = newSlug;
          if (name !== null) project["name"] = name;
          project["updated_at"] = updatedAt;
          projectRow.updatedAt = String(updatedAt);
          projectRow.version = (projectRow.version ?? 0) + 1;
        }
        return { rows: [{ found: true, project_conflict: false, task_list_conflict: false, project, task_lists_updated: updated }] as T[] };
      }

      if (sql.includes("todos:create-template-with-tasks-atomic")) {
        const [service, rawRecords] = values;
        const input = parseJsonb(rawRecords) as Array<{ object_type: string; object_id: string; payload: unknown; updated_at: string; version: number }>;
        for (const record of input) {
          rows.set(recordKey(service, record.object_type, record.object_id), {
            service: String(service),
            objectType: record.object_type,
            objectId: record.object_id,
            payload: record.payload,
            updatedAt: record.updated_at,
            deletedAt: null,
            version: record.version,
          });
        }
        return { rows: input.map((record) => ({ object_type: record.object_type, object_id: record.object_id })) as T[] };
      }

      if (sql.includes("todos:delete-template-with-tasks-atomic")) {
        const [service, templateId, timestamp] = values;
        const template = rows.get(recordKey(service, "templates", templateId));
        if (!template || template.deletedAt) return { rows: [] as T[] };
        const deleted: Array<{ object_type: string }> = [];
        for (const row of rows.values()) {
          const payload = row.payload as Record<string, unknown>;
          const target = row.service === service && !row.deletedAt && (
            (row.objectType === "templates" && row.objectId === templateId) ||
            (row.objectType === "template_tasks" && payload["template_id"] === templateId)
          );
          if (!target) continue;
          row.deletedAt = String(timestamp);
          row.updatedAt = String(timestamp);
          row.version = (row.version ?? 0) + 1;
          deleted.push({ object_type: row.objectType });
        }
        return { rows: deleted as T[] };
      }

      if (sql.includes("todos:plan-project-link-atomic")) {
        const [service, planId, projectId, expectedPlanRevision, expectedProjectRevision,
          receiptId, rawReceipt, rawTaskProjects, rawTaskIds, updatedAt] = values;
        const planRow = rows.get(recordKey(service, "plans", planId));
        const projectRow = rows.get(recordKey(service, "projects", projectId));
        const receiptRow = rows.get(recordKey(service, "plan_project_link_receipts", receiptId));
        const plan = planRow?.payload as Record<string, unknown> | undefined;
        const project = projectRow?.payload as Record<string, unknown> | undefined;
        const tasks = [...rows.values()]
          .filter((row) => row.service === service && row.objectType === "tasks" && !row.deletedAt)
          .filter((row) => (row.payload as Record<string, unknown>)["plan_id"] === planId)
          .sort((left, right) => left.objectId.localeCompare(right.objectId));
        const currentTaskIds = tasks.map((row) => row.objectId);
        const currentTaskProjects = Object.fromEntries(tasks.map((row) => [
          row.objectId,
          (row.payload as Record<string, unknown>)["project_id"] ?? null,
        ]));
        const expectedTaskIds = parseJsonb(rawTaskIds) as string[];
        const expectedTaskProjects = parseJsonb(rawTaskProjects) as Record<string, unknown>;
        const collision = Boolean(plan && [...rows.values()].some((row) => {
          const candidate = row.payload as Record<string, unknown>;
          return row.service === service && row.objectType === "plans" && !row.deletedAt &&
            row.objectId !== planId && candidate["project_id"] === projectId &&
            candidate["slug"] === plan["slug"] && plan["slug"] !== null;
        }));
        const flags = {
          plan_found: Boolean(planRow && !planRow.deletedAt),
          project_found: Boolean(projectRow && !projectRow.deletedAt),
          plan_revision_ok: plan?.["updated_at"] === expectedPlanRevision,
          project_revision_ok: project?.["updated_at"] === expectedProjectRevision,
          membership_ok: JSON.stringify(currentTaskIds) === JSON.stringify(expectedTaskIds) &&
            JSON.stringify(currentTaskProjects) === JSON.stringify(expectedTaskProjects),
          collision,
        };
        let insertedReceipt: unknown | null = null;
        if (flags.plan_found && flags.project_found && flags.plan_revision_ok &&
            flags.project_revision_ok && flags.membership_ok && !flags.collision && !receiptRow) {
          plan!["project_id"] = projectId;
          plan!["updated_at"] = updatedAt;
          planRow!.updatedAt = String(updatedAt);
          planRow!.version = (planRow!.version ?? 0) + 1;
          for (const row of tasks) {
            const task = row.payload as Record<string, unknown>;
            if (task["project_id"] === projectId) continue;
            task["project_id"] = projectId;
            task["updated_at"] = updatedAt;
            task["version"] = Number(task["version"] ?? 0) + 1;
            row.updatedAt = String(updatedAt);
            row.version = (row.version ?? 0) + 1;
          }
          insertedReceipt = parseJsonb(rawReceipt);
          rows.set(recordKey(service, "plan_project_link_receipts", receiptId), {
            service: String(service),
            objectType: "plan_project_link_receipts",
            objectId: String(receiptId),
            payload: insertedReceipt,
            updatedAt: String(updatedAt),
            deletedAt: null,
            version: 1,
          });
        }
        return { rows: [{
          ...flags,
          existing_receipt: receiptRow?.payload ?? null,
          inserted_receipt: insertedReceipt,
        }] as T[] };
      }

      if (sql.includes("todos:task-plan-membership-guard")) {
        const [
          service,
          taskId,
          rawPayload,
          updatedAt,
          ,
          version,
          rawPlanIds,
          targetPlanId,
          explicitProject,
          guardParent,
          parentId,
          expectedVersion,
          requireExistingTask,
        ] = values;
        const planIds = parseJsonb(rawPlanIds) as string[];
        const task = parseJsonb(rawPayload) as Record<string, unknown>;
        const existingTaskRow = rows.get(recordKey(service, "tasks", taskId));
        const existingTask = existingTaskRow && !existingTaskRow.deletedAt
          ? existingTaskRow.payload as Record<string, unknown>
          : null;
        const plans = planIds.map((planId) => rows.get(recordKey(service, "plans", planId)))
          .filter((row): row is Row => Boolean(row && !row.deletedAt));
        const targetPlan = targetPlanId ? rows.get(recordKey(service, "plans", targetPlanId)) : null;
        const targetProjectId = targetPlan && !targetPlan.deletedAt
          ? (targetPlan.payload as Record<string, unknown>)["project_id"] ?? null
          : null;
        // Mirrors the guarded SQL: existence is required only for the
        // membership this write ESTABLISHES. Leaving (or merely keeping) a
        // plan that is already missing is the dangling-reference repair.
        const membershipChanged = String(existingTask?.["plan_id"] ?? "")
          !== String(task["plan_id"] ?? "");
        const targetPlanFound = !membershipChanged
          || !targetPlanId
          || Boolean(targetPlan && !targetPlan.deletedAt);
        const projectConflict = Boolean(
          explicitProject && targetProjectId && (task["project_id"] ?? null) !== targetProjectId,
        );
        const taskFound = !guardParent || !requireExistingTask || Boolean(existingTask);
        const versionMatches = !guardParent
          || !requireExistingTask
          || Number(existingTask?.["version"] ?? -1) === Number(expectedVersion);
        const parentRow = parentId === null || parentId === undefined
          ? null
          : rows.get(recordKey(service, "tasks", parentId));
        const parentFound = !guardParent || parentId === null || parentId === undefined
          || Boolean(parentRow && !parentRow.deletedAt);
        let parentAcyclic = true;
        if (guardParent && parentId !== null && parentId !== undefined && parentFound) {
          const visited = new Set<string>();
          let cursor: string | null = String(parentId);
          while (cursor) {
            if (cursor === String(taskId) || visited.has(cursor)) {
              parentAcyclic = false;
              break;
            }
            visited.add(cursor);
            const ancestorRow = rows.get(recordKey(service, "tasks", cursor));
            if (!ancestorRow || ancestorRow.deletedAt) break;
            const ancestor = ancestorRow.payload as Record<string, unknown>;
            cursor = typeof ancestor["parent_id"] === "string" ? ancestor["parent_id"] : null;
          }
        }
        if (targetProjectId) task["project_id"] = targetProjectId;
        const canStore = taskFound
          && versionMatches
          && parentFound
          && parentAcyclic
          && targetPlanFound
          && !projectConflict;
        if (canStore) {
          rows.set(recordKey(service, "tasks", taskId), {
            service: String(service),
            objectType: "tasks",
            objectId: String(taskId),
            payload: task,
            updatedAt: String(updatedAt),
            deletedAt: null,
            version: nullableNumber(version),
          });
        }
        return { rows: [{
          task_found: taskFound,
          version_matches: versionMatches,
          parent_found: parentFound,
          parent_acyclic: parentAcyclic,
          membership_changed: membershipChanged,
          target_plan_found: targetPlanFound,
          project_conflict: projectConflict,
          payload: canStore ? task : null,
        }] as T[] };
      }

      if (sql.includes("todos:task-parent-integrity-delete")) {
        const [service, taskId, deletedAt, sourceMachineId] = values;
        const root = rows.get(recordKey(service, "tasks", taskId));
        if (!root || root.deletedAt) {
          return { rows: [{ found: false, deleted_count: 0 }] as T[] };
        }
        const pending = [String(taskId)];
        const selected = new Set<string>();
        while (pending.length > 0) {
          const current = pending.shift()!;
          if (selected.has(current)) continue;
          selected.add(current);
          for (const row of rows.values()) {
            if (row.service !== service || row.objectType !== "tasks" || row.deletedAt) continue;
            const payload = row.payload as Record<string, unknown>;
            if (payload["parent_id"] === current && !selected.has(row.objectId)) {
              pending.push(row.objectId);
            }
          }
        }
        for (const objectId of selected) {
          const row = rows.get(recordKey(service, "tasks", objectId));
          if (!row || row.deletedAt) continue;
          row.deletedAt = String(deletedAt);
          row.updatedAt = String(deletedAt);
        }
        let relatedDeletedCount = 0;
        for (const row of rows.values()) {
          if (row.service !== service || row.deletedAt) continue;
          const payload = row.payload as Record<string, unknown>;
          const related = row.objectType === "dependencies"
            ? selected.has(String(payload["task_id"])) || selected.has(String(payload["depends_on"]))
            : ["comments", "verifications", "commits", "refs"].includes(row.objectType)
              && selected.has(String(payload["task_id"]));
          if (!related) continue;
          row.deletedAt = String(deletedAt);
          row.updatedAt = String(deletedAt);
          row.sourceMachineId = sourceMachineId === null || sourceMachineId === undefined
            ? null
            : String(sourceMachineId);
          relatedDeletedCount++;
        }
        return {
          rows: [{
            found: true,
            deleted_count: selected.size,
            related_deleted_count: relatedDeletedCount,
          }] as T[],
        };
      }

      if (sql.includes("todos:plan-update-project-link-guard")) {
        const [service, planId, rawPayload, updatedAt] = values;
        const planRow = rows.get(recordKey(service, "plans", planId));
        if (!planRow || planRow.deletedAt) {
          return { rows: [{ plan_found: false, payload: null }] as T[] };
        }
        const current = planRow.payload as Record<string, unknown>;
        const updated = parseJsonb(rawPayload) as Record<string, unknown>;
        updated["project_id"] = current["project_id"] ?? null;
        updated["updated_at"] = updatedAt;
        planRow.payload = updated;
        planRow.updatedAt = String(updatedAt);
        planRow.version = (planRow.version ?? 0) + 1;
        return { rows: [{ plan_found: true, payload: updated }] as T[] };
      }

      if (sql.includes("INSERT INTO todos_sync_records")) {
        const [service, objectType, objectId, payload, updatedAt] = values;
        if (String(objectType) === options.rejectWritesForObjectType) {
          return { rows: [] as T[] };
        }
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
