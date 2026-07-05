import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addComment } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan, resolvePlanRef } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { linkTaskGitRef, linkTaskToCommit } from "../db/task-commits.js";
import { addDependency, createCalendarItem, createTask, createTaskBoard, getTask, listCalendarItems, listTaskBoards, listTasks } from "../db/tasks.js";
import { addTaskRunArtifact, addTaskRunCommand, addTaskRunFile, finishTaskRun, startTaskRun, verifyTaskRunArtifacts } from "../db/task-runs.js";
import { resetConfig, saveConfig } from "./config.js";
import {
  TODOS_LOCAL_BRIDGE_KIND,
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  validateLocalBridgeBundle,
} from "./local-bridge.js";
import { getSearchView, saveSearchView } from "./saved-search-views.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  process.env["HASNA_TODOS_ARTIFACTS_DIR"] = mkdtempSync(join(tmpdir(), "todos-bridge-artifacts-"));
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  rmSync(process.env["HASNA_TODOS_ARTIFACTS_DIR"] || "", { recursive: true, force: true });
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
  resetConfig();
});

describe("local bridge import/export", () => {
  test("exports a versioned local-only bundle with tasks, plans, runs, and evidence", () => {
    const db = getDatabase();
    const project = createProject({ name: "Bridge", path: "/tmp/bridge" }, db);
    const taskList = createTaskList({ name: "Bridge List", slug: "bridge", project_id: project.id }, db);
    const plan = createPlan({ name: "Bridge Plan", project_id: project.id, task_list_id: taskList.id }, db);
    const first = createTask({
      title: "Prepare export",
      project_id: project.id,
      task_list_id: taskList.id,
      plan_id: plan.id,
      tags: ["bridge"],
      metadata: { fixture: true },
    }, db);
    const second = createTask({
      title: "Import export",
      project_id: project.id,
      task_list_id: taskList.id,
      plan_id: plan.id,
      tags: ["bridge"],
    }, db);
    addDependency(second.id, first.id, db);
    addComment({ task_id: first.id, content: "ready", type: "progress", progress_pct: 50 }, db);
    const run = startTaskRun({ task_id: first.id, agent_id: "agent", title: "bridge run" }, db);
    addTaskRunCommand({ run_id: run.id, command: "bun test", status: "passed", output_summary: "ok" }, db);
    addTaskRunFile({ run_id: run.id, path: "src/lib/local-bridge.ts" }, db);
    const artifactPath = join(process.env["HASNA_TODOS_ARTIFACTS_DIR"]!, "bridge.log");
    writeFileSync(artifactPath, "bridge ok\n");
    addTaskRunArtifact({ run_id: run.id, path: artifactPath, artifact_type: "log", store_content: true }, db);
    finishTaskRun({ run_id: run.id, status: "completed", summary: "done" }, db);
    linkTaskToCommit({ task_id: first.id, sha: "abcdef123456", message: "feat: bridge" }, db);
    linkTaskGitRef({ task_id: first.id, ref_type: "branch", name: "task/bridge" }, db);
    saveSearchView({
      name: "bridge-view",
      scope: "tasks",
      filters: { project_id: project.id, tags: ["bridge"] },
    }, db);
    createTaskBoard({
      name: "bridge-board",
      project_id: project.id,
      lanes: [
        { id: "ready", name: "Ready", statuses: ["pending"], wip_limit: null, position: 0 },
        { id: "doing", name: "Doing", statuses: ["in_progress"], wip_limit: 2, position: 1 },
      ],
    }, db);
    createCalendarItem({
      title: "Bridge milestone",
      kind: "milestone",
      starts_at: "2026-06-01T09:00:00.000Z",
      project_id: project.id,
      task_id: first.id,
    }, db);

    const bundle = createLocalBridgeBundle({
      project_id: project.id,
      generatedAt: "2026-01-02T03:04:05.000Z",
      version: "1.2.3",
    }, db);

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      kind: TODOS_LOCAL_BRIDGE_KIND,
      exportedAt: "2026-01-02T03:04:05.000Z",
      package: { packageName: "@hasna/todos", repository: "hasna/todos", version: "1.2.3" },
      source: { project_id: project.id, project_path: "/tmp/bridge" },
    });
    expect(bundle.stats).toMatchObject({
      projects: 1,
      task_lists: 1,
      plans: 1,
      tasks: 2,
      task_dependencies: 1,
      comments: 1,
      runs: 1,
      run_commands: 1,
      task_files: 1,
      task_commits: 1,
      task_git_refs: 1,
      task_verifications: 1,
      saved_views: 1,
      task_boards: 1,
      local_calendar_items: 1,
    });
    expect(bundle.artifact_contents).toHaveLength(1);
    expect(validateLocalBridgeBundle(bundle).ok).toBe(true);
  });

  test("redacts configured secret patterns from bridge exports", () => {
    saveConfig({
      secret_safety: {
        redaction_patterns: ["INTERNAL-[0-9]{4}"],
        redaction_keys: ["license"],
      },
    });
    const db = getDatabase();
    const project = createProject({ name: "Bridge", path: "/tmp/bridge" }, db);
    const task = createTask({
      title: "Export safely",
      project_id: project.id,
      description: "contains INTERNAL-1234",
      metadata: { license: "commercial-secret", note: "INTERNAL-5678" },
    }, db);
    db.run("INSERT INTO task_comments (id, task_id, content, type, created_at) VALUES (?, ?, ?, ?, ?)", [
      "raw-comment",
      task.id,
      "legacy INTERNAL-9999",
      "comment",
      "2026-01-02T03:04:05.000Z",
    ]);

    const bundle = createLocalBridgeBundle({ project_id: project.id }, db);
    const exported = JSON.stringify(bundle);

    expect(exported).not.toContain("INTERNAL-");
    expect(exported).not.toContain("commercial-secret");
    expect(bundle.data.comments[0]!.content).toBe("legacy [REDACTED]");
    expect(bundle.data.tasks[0]!.metadata.license).toBe("[REDACTED]");
  });

  test("previews conflicts without mutation and imports missing records when applied", () => {
    const sourceDb = getDatabase();
    const project = createProject({ name: "Bridge", path: "/tmp/bridge" }, sourceDb);
    const task = createTask({
      title: "Portable task",
      project_id: project.id,
      tags: ["portable"],
      metadata: { source: "test" },
    }, sourceDb);
    createTaskBoard({ name: "portable-board", project_id: project.id }, sourceDb);
    createCalendarItem({
      title: "Portable milestone",
      kind: "milestone",
      starts_at: "2026-06-01T09:00:00.000Z",
      project_id: project.id,
    }, sourceDb);
    const bundle = createLocalBridgeBundle({ project_id: project.id }, sourceDb);

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    const targetDb = getDatabase();

    const preview = importLocalBridgeBundle(bundle, { dryRun: true }, targetDb);
    expect(preview.dry_run).toBe(true);
    expect(preview.conflicts).toEqual([]);
    expect(preview.inserted.tasks).toBe(1);
    expect(listTasks({}, targetDb)).toHaveLength(0);

    const applied = importLocalBridgeBundle(bundle, { dryRun: false }, targetDb);
    expect(applied.dry_run).toBe(false);
    expect(applied.inserted.projects).toBe(1);
    expect(applied.inserted.tasks).toBe(1);
    expect(applied.inserted.task_boards).toBe(1);
    expect(applied.inserted.local_calendar_items).toBe(1);
    expect(applied.inserted.saved_views).toBe(0);
    expect(listTaskBoards({}, targetDb).map((board) => board.name)).toContain("portable-board");
    expect(listCalendarItems({}, targetDb).map((item) => item.title)).toContain("Portable milestone");
    expect(getTask(task.id, targetDb)).toMatchObject({
      id: task.id,
      title: "Portable task",
      tags: ["portable"],
      metadata: { source: "test" },
    });

    const secondPreview = importLocalBridgeBundle(bundle, { dryRun: true }, targetDb);
    expect(secondPreview.inserted.tasks).toBe(0);
    expect(secondPreview.skipped.tasks).toBe(1);
    expect(secondPreview.conflicts).toContainEqual({
      table: "tasks",
      id: task.id,
      reason: "already_exists",
    });
  });

  test("backfills readable plan slugs when importing legacy bridge bundles", () => {
    const sourceDb = getDatabase();
    const project = createProject({ name: "Bridge legacy plans", path: "/tmp/bridge-legacy-plans" }, sourceDb);
    const first = createPlan({ name: "Legacy Bridge Plan", project_id: project.id }, sourceDb);
    const second = createPlan({ name: "Legacy Bridge Plan", project_id: project.id }, sourceDb);
    const bundle = createLocalBridgeBundle({ project_id: project.id }, sourceDb);
    for (const plan of bundle.data.plans as unknown as Array<Record<string, unknown>>) {
      delete plan.slug;
    }

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    const targetDb = getDatabase();

    const applied = importLocalBridgeBundle(bundle, { dryRun: false }, targetDb);
    expect(applied.ok).toBe(true);
    expect(applied.inserted.plans).toBe(2);

    const rows = targetDb.query("SELECT id, slug FROM plans ORDER BY slug").all() as Array<{ id: string; slug: string | null }>;
    expect(rows.map((row) => row.slug)).toEqual(["legacy-bridge-plan", "legacy-bridge-plan-2"]);
    expect([resolvePlanRef("legacy-bridge-plan", targetDb, project.id), resolvePlanRef("legacy-bridge-plan-2", targetDb, project.id)].sort()).toEqual([
      first.id,
      second.id,
    ].sort());
  });

  test("exports and imports local saved search views", () => {
    const sourceDb = getDatabase();
    const project = createProject({ name: "Bridge views", path: "/tmp/bridge-views" }, sourceDb);
    createTask({ title: "View task", project_id: project.id, tags: ["view"] }, sourceDb);
    const view = saveSearchView({
      name: "project-view",
      description: "Local project task view",
      scope: "tasks",
      filters: { project_id: project.id, tags: ["view"] },
    }, sourceDb);
    const bundle = createLocalBridgeBundle({ project_id: project.id }, sourceDb);
    expect(bundle.stats.saved_views).toBe(1);

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    const targetDb = getDatabase();

    const applied = importLocalBridgeBundle(bundle, { dryRun: false }, targetDb);
    expect(applied.inserted.saved_views).toBe(1);
    expect(getSearchView(view.name, targetDb)).toMatchObject({
      name: "project-view",
      description: "Local project task view",
      scope: "tasks",
      filters: { project_id: project.id, tags: ["view"] },
    });
  });

  test("safely merges divergent task imports without overwriting local edits", () => {
    const sourceDb = getDatabase();
    const project = createProject({ name: "Bridge conflict", path: "/tmp/bridge-conflict" }, sourceDb);
    const task = createTask({
      title: "Shared task",
      description: "incoming description",
      project_id: project.id,
      tags: ["incoming"],
      metadata: { incoming_only: true, shared: "incoming" },
      due_at: "2026-02-03T04:05:06.000Z",
    }, sourceDb);
    const bundle = createLocalBridgeBundle({ project_id: project.id }, sourceDb);

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    const targetDb = getDatabase();
    const targetProject = createProject({ name: "Bridge conflict", path: "/tmp/bridge-conflict" }, targetDb);
    targetDb.run("UPDATE projects SET id = ? WHERE id = ?", [project.id, targetProject.id]);
    targetDb.run(
      `INSERT INTO tasks (id, project_id, title, description, status, priority, tags, metadata, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 'medium', ?, ?, 1, '2026-01-01T00:00:00.000Z', '2026-01-05T00:00:00.000Z')`,
      [
        task.id,
        project.id,
        "Local title",
        null,
        JSON.stringify(["local"]),
        JSON.stringify({ local_only: true, shared: "local" }),
      ],
    );

    const preview = importLocalBridgeBundle(bundle, { dryRun: true, conflictStrategy: "safe_merge" }, targetDb);
    expect(preview.dry_run).toBe(true);
    expect(preview.merged.tasks).toBe(1);
    expect(getTask(task.id, targetDb)).toMatchObject({
      title: "Local title",
      description: null,
      tags: ["local"],
      metadata: { local_only: true, shared: "local" },
    });

    const applied = importLocalBridgeBundle(bundle, { dryRun: false, conflictStrategy: "safe_merge" }, targetDb);
    expect(applied.ok).toBe(true);
    expect(applied.merged.tasks).toBe(1);
    expect(applied.conflicts).toContainEqual({
      table: "tasks",
      id: task.id,
      reason: "diverged",
      fields: ["title", "metadata.shared"],
      resolution: "manual_required",
    });
    expect(getTask(task.id, targetDb)).toMatchObject({
      title: "Local title",
      description: "incoming description",
      tags: ["local", "incoming"],
      due_at: "2026-02-03T04:05:06.000Z",
      metadata: {
        local_only: true,
        incoming_only: true,
        shared: "local",
      },
    });
    const merged = getTask(task.id, targetDb)!;
    expect(Array.isArray(merged.metadata.sync_conflicts)).toBe(true);
    expect(merged.metadata.sync_conflicts).toHaveLength(1);
  });

  test("imports exported local artifact store content", () => {
    const sourceDb = getDatabase();
    const project = createProject({ name: "Bridge artifacts", path: "/tmp/bridge-artifacts" }, sourceDb);
    const task = createTask({ title: "Portable artifact", project_id: project.id }, sourceDb);
    const run = startTaskRun({ task_id: task.id, agent_id: "agent" }, sourceDb);
    const sourceFile = join(process.env["HASNA_TODOS_ARTIFACTS_DIR"]!, "portable.log");
    writeFileSync(sourceFile, "portable artifact\nTOKEN=secret-token-value\n");
    addTaskRunArtifact({ run_id: run.id, path: sourceFile, artifact_type: "log", store_content: true }, sourceDb);
    const bundle = createLocalBridgeBundle({ project_id: project.id }, sourceDb);
    expect(bundle.artifact_contents).toHaveLength(1);

    closeDatabase();
    rmSync(process.env["HASNA_TODOS_ARTIFACTS_DIR"]!, { recursive: true, force: true });
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = mkdtempSync(join(tmpdir(), "todos-bridge-import-artifacts-"));
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    const targetDb = getDatabase();

    const applied = importLocalBridgeBundle(bundle, { dryRun: false }, targetDb);
    expect(applied.ok).toBe(true);
    expect(verifyTaskRunArtifacts(run.id, targetDb)[0]).toMatchObject({ status: "ok" });
  });

  test("rejects malformed or incompatible bridge bundles", () => {
    expect(validateLocalBridgeBundle(null)).toEqual({
      ok: false,
      issues: ["bundle must be an object"],
    });
    expect(validateLocalBridgeBundle({
      schemaVersion: 999,
      kind: "other",
      data: { tasks: [] },
    }).issues).toEqual(expect.arrayContaining([
      "kind must be hasna.todos.local-bridge",
      "schemaVersion must be 1",
      "data.projects must be an array",
    ]));
  });
});
