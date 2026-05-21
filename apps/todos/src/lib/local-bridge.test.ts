import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addComment } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { linkTaskGitRef, linkTaskToCommit } from "../db/task-commits.js";
import { addDependency, createTask, getTask, listTasks } from "../db/tasks.js";
import { addTaskRunArtifact, addTaskRunCommand, addTaskRunFile, finishTaskRun, startTaskRun, verifyTaskRunArtifacts } from "../db/task-runs.js";
import {
  TODOS_LOCAL_BRIDGE_KIND,
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  validateLocalBridgeBundle,
} from "./local-bridge.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  process.env["HASNA_TODOS_ARTIFACTS_DIR"] = mkdtempSync(join(tmpdir(), "todos-bridge-artifacts-"));
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  rmSync(process.env["HASNA_TODOS_ARTIFACTS_DIR"] || "", { recursive: true, force: true });
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
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
    });
    expect(bundle.artifact_contents).toHaveLength(1);
    expect(validateLocalBridgeBundle(bundle).ok).toBe(true);
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
