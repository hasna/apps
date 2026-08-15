import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { addComment } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { addTaskVerification, linkTaskGitRef, linkTaskToCommit } from "../db/task-commits.js";
import { addDependency, createTask } from "../db/tasks.js";
import { addTaskRunArtifact, addTaskRunCommand, addTaskRunEvent, addTaskRunFile, startTaskRun } from "../db/task-runs.js";
import { getLocalSnapshot, listLocalSnapshotResources, pollLocalSnapshots, renderLocalSnapshotMarkdown } from "./local-snapshots.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

function seedSnapshotFixture() {
  const db = getDatabase();
  const project = createProject({ name: "Snapshots", path: "/tmp/snapshots" }, db);
  const taskList = createTaskList({ name: "Snapshot List", slug: "snapshots", project_id: project.id }, db);
  const plan = createPlan({ name: "Snapshot Plan", project_id: project.id, task_list_id: taskList.id, agent_id: "codex" }, db);
  const first = createTask({
    title: "Prepare snapshots",
    project_id: project.id,
    task_list_id: taskList.id,
    plan_id: plan.id,
    tags: ["snapshots"],
  }, db);
  const second = createTask({
    title: "Read snapshots",
    project_id: project.id,
    task_list_id: taskList.id,
    plan_id: plan.id,
    priority: "high",
    tags: ["snapshots"],
  }, db);
  addDependency(second.id, first.id, db);
  addComment({ task_id: first.id, content: "Bearer abcdefghijklmnop", type: "progress" }, db);
  addTaskVerification({ task_id: first.id, command: "bun test", status: "passed", output_summary: "ok" }, db);
  linkTaskToCommit({ task_id: first.id, sha: "abcdef123456", message: "feat: snapshots" }, db);
  linkTaskGitRef({ task_id: first.id, ref_type: "branch", name: "task/snapshots" }, db);
  const run = startTaskRun({ task_id: first.id, agent_id: "codex", title: "snapshot run" }, db);
  addTaskRunEvent({ run_id: run.id, event_type: "progress", message: "Bearer cdefghijklmnopqr", agent_id: "codex" }, db);
  addTaskRunCommand({ run_id: run.id, command: "bun test", status: "passed", output_summary: "ok" }, db);
  addTaskRunFile({ run_id: run.id, path: "src/lib/local-snapshots.ts" }, db);
  addTaskRunArtifact({ run_id: run.id, path: "evidence/snapshot.json", artifact_type: "json", description: "snapshot evidence" }, db);
  return { db, project, first, second, plan, run };
}

describe("local snapshots", () => {
  test("lists stable snapshot resources", () => {
    const resources = listLocalSnapshotResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      "todos://snapshots/projects",
      "todos://snapshots/tasks",
      "todos://snapshots/plans",
      "todos://snapshots/runs",
      "todos://snapshots/dependencies",
      "todos://snapshots/events",
      "todos://snapshots/evidence",
    ]);
  });

  test("builds redacted deterministic snapshots for local state", () => {
    const { db, project, second } = seedSnapshotFixture();
    const tasks = getLocalSnapshot({
      type: "tasks",
      project_id: project.id,
      generatedAt: "2026-01-02T03:04:05.000Z",
    }, db);
    expect(tasks.local_only).toBe(true);
    expect(tasks.no_network).toBe(true);
    expect(tasks.items).toHaveLength(2);
    expect(tasks.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(tasks.items).toContainEqual(expect.objectContaining({
      id: second.id,
      blocked_by: expect.any(Array),
      counts: expect.objectContaining({ dependencies: 1 }),
    }));

    const events = getLocalSnapshot({
      type: "events",
      project_id: project.id,
      generatedAt: "2026-01-02T03:04:05.000Z",
    }, db);
    expect(JSON.stringify(events.items)).not.toContain("abcdefghijklmnop");
    expect(JSON.stringify(events.items)).toContain("[REDACTED]");
  });

  test("polls changed snapshots and renders Markdown", () => {
    const { db, project } = seedSnapshotFixture();
    const result = pollLocalSnapshots({
      types: ["tasks", "evidence"],
      project_id: project.id,
      generatedAt: "2026-01-02T03:04:05.000Z",
    }, db);
    expect(result.changed).toBe(true);
    expect(result.snapshots.map((snapshot) => snapshot.type)).toEqual(["tasks", "evidence"]);

    const unchanged = pollLocalSnapshots({
      types: ["tasks"],
      project_id: project.id,
      since: result.cursor,
      generatedAt: "2026-01-02T03:04:05.000Z",
    }, db);
    expect(unchanged.changed).toBe(false);

    const markdown = renderLocalSnapshotMarkdown(result.snapshots[0]!);
    expect(markdown).toContain("# tasks snapshot");
    expect(markdown).toContain("fingerprint:");
  });
});
