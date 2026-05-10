import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { logTaskChange } from "../db/audit.js";
import { addComment } from "../db/comments.js";
import { upsertCheckpoint } from "../db/checkpoints.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createDispatch } from "../db/dispatches.js";
import { registerAgent } from "../db/agents.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { createTask } from "../db/task-crud.js";
import { createTemplate } from "../db/templates.js";
import { addTaskFile } from "../db/task-files.js";
import { linkTaskToCommit } from "../db/task-commits.js";
import {
  LOCAL_TO_CLOUD_TABLES,
  createLocalCloudExport,
  pushLocalCloudExport,
} from "./cloud-migration.js";

const originalTodosApiUrl = process.env["TODOS_API_URL"];
const originalTodosApiKey = process.env["TODOS_API_KEY"];

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  delete process.env["TODOS_API_URL"];
  delete process.env["TODOS_API_KEY"];
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  if (originalTodosApiUrl === undefined) delete process.env["TODOS_API_URL"];
  else process.env["TODOS_API_URL"] = originalTodosApiUrl;
  if (originalTodosApiKey === undefined) delete process.env["TODOS_API_KEY"];
  else process.env["TODOS_API_KEY"] = originalTodosApiKey;
});

function seedLocalData() {
  const db = getDatabase();
  const project = createProject({ name: "Migration Project", path: "/tmp/migration" }, db);
  const taskList = createTaskList({ name: "Migration List", project_id: project.id }, db);
  const plan = createPlan({ name: "Migration Plan", project_id: project.id, task_list_id: taskList.id }, db);
  const task = createTask({
    title: "Migrate this task",
    project_id: project.id,
    task_list_id: taskList.id,
    plan_id: plan.id,
    tags: ["migration"],
  }, db);
  const agent = registerAgent({ name: "migrationagent" }, db);
  createTemplate({
    name: "Migration Template",
    title_pattern: "Migrate {thing}",
    tags: ["migration"],
    project_id: project.id,
  }, db);
  addComment({ task_id: task.id, content: "Keep this comment", agent_id: "migrationagent" }, db);
  logTaskChange(task.id, "update", "status", "pending", "in_progress", "migrationagent", db);
  upsertCheckpoint(task.id, "copy", { status: "completed", agent_id: typeof agent === "object" ? agent.id : undefined }, db);
  createDispatch({ title: "Migration dispatch", target_window: "main:1", task_ids: [task.id] }, db);
  addTaskFile({ task_id: task.id, path: "src/example.ts", status: "modified" }, db);
  linkTaskToCommit({ task_id: task.id, sha: "abcdef1234567890", message: "test commit" }, db);
  return { project, taskList, plan, task };
}

describe("local-to-cloud migration export", () => {
  test("creates a copy-only manifest covering core local tables", () => {
    seedLocalData();
    const manifest = createLocalCloudExport({
      generatedAt: "2026-01-02T03:04:05.000Z",
      includeEmptyTables: true,
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: "hasna.todos.local-sqlite.export",
      generatedAt: "2026-01-02T03:04:05.000Z",
      mode: "copy-only",
      safety: {
        deletesLocalData: false,
        mutatesLocalData: false,
        localRemainsSource: true,
      },
    });
    for (const table of LOCAL_TO_CLOUD_TABLES) {
      expect(manifest.counts).toHaveProperty(table);
    }
    expect(manifest.counts["projects"]).toBe(1);
    expect(manifest.counts["task_lists"]).toBe(1);
    expect(manifest.counts["plans"]).toBe(1);
    expect(manifest.counts["tasks"]).toBe(1);
    expect(manifest.counts["task_comments"]).toBe(1);
    expect(manifest.counts["task_history"]).toBe(1);
    expect(manifest.counts["dispatches"]).toBe(1);
    expect(manifest.counts["task_checkpoints"]).toBe(1);
    expect(manifest.counts["task_files"]).toBe(1);
    expect(manifest.counts["task_commits"]).toBe(1);
    expect(manifest.totals.rows).toBeGreaterThanOrEqual(10);
  });

  test("dry-run does not call the remote API or mutate local rows", async () => {
    seedLocalData();
    let called = false;
    const before = getDatabase().query("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    const result = await pushLocalCloudExport({
      dryRun: true,
      fetchImpl: (async () => {
        called = true;
        return Response.json({});
      }) as typeof fetch,
    });
    const after = getDatabase().query("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };

    expect(called).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.response).toBeNull();
    expect(after.count).toBe(before.count);
  });

  test("posts copy-only manifest with auth and idempotency key when confirmed", async () => {
    seedLocalData();
    let observedUrl = "";
    let observedHeaders: HeadersInit | undefined;
    let observedBody: any;
    const result = await pushLocalCloudExport({
      dryRun: false,
      apiUrl: "https://todos.example/",
      apiKey: "api-key",
      idempotencyKey: "migration-key",
      conflictStrategy: "upsert",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        observedUrl = String(input);
        observedHeaders = init?.headers;
        observedBody = JSON.parse(String(init?.body));
        return Response.json({ import_id: "import-1", accepted: true });
      }) as typeof fetch,
    });

    expect(observedUrl).toBe("https://todos.example/api/imports/local-sqlite");
    expect((observedHeaders as Record<string, string>)["x-api-key"]).toBe("api-key");
    expect((observedHeaders as Record<string, string>)["Idempotency-Key"]).toBe("migration-key");
    expect(observedBody.mode).toBe("copy-only");
    expect(observedBody.conflictStrategy).toBe("upsert");
    expect(observedBody.manifest.safety.deletesLocalData).toBe(false);
    expect(result.response).toEqual({ import_id: "import-1", accepted: true });
  });

  test("rejects unknown conflict strategies before posting", async () => {
    seedLocalData();
    let called = false;
    await expect(pushLocalCloudExport({
      dryRun: false,
      apiUrl: "https://todos.example",
      conflictStrategy: "replace" as any,
      fetchImpl: (async () => {
        called = true;
        return Response.json({});
      }) as typeof fetch,
    })).rejects.toThrow("Conflict strategy must be one of: skip, upsert, fail.");
    expect(called).toBe(false);
  });
});
