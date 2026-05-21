import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { logTaskChange } from "../db/audit.js";
import { addComment } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { addTaskRunCommand, addTaskRunEvent, addTaskRunArtifact, startTaskRun } from "../db/task-runs.js";
import { createTask } from "../db/tasks.js";
import { getLocalActivityTimeline } from "./activity-timeline.js";

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

describe("local activity timeline", () => {
  test("merges comments, audit events, and run evidence with redaction", () => {
    const project = createProject({ name: "Timeline", path: "/tmp/timeline" }, db);
    const plan = createPlan({ project_id: project.id, name: "Launch" }, db);
    const task = createTask({ title: "Ship timeline", project_id: project.id, plan_id: plan.id }, db);
    logTaskChange(task.id, "update", "status", "pending", "in_progress", "codex", db);
    addComment({ task_id: task.id, content: "Bearer abcdefghijklmnop should not leak", agent_id: "codex" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "Run Bearer bcdefghijklmnopq" }, db);
    addTaskRunEvent({ run_id: run.id, event_type: "progress", message: "Bearer cdefghijklmnopqr", agent_id: "codex" }, db);
    addTaskRunCommand({ run_id: run.id, command: "bun test", status: "passed", output_summary: "ok", agent_id: "codex" }, db);
    addTaskRunArtifact({ run_id: run.id, path: "logs/timeline.txt", description: "timeline log", store_content: false }, db);

    const timeline = getLocalActivityTimeline({ entity_type: "task", entity_id: task.id, order: "asc" }, db);

    expect(timeline.total).toBeGreaterThanOrEqual(6);
    expect(timeline.entries.map((entry) => entry.source)).toEqual(expect.arrayContaining([
      "task_history",
      "comment",
      "run_event",
      "run_command",
      "run_artifact",
    ]));
    expect(timeline.entries.every((entry) => entry.task_id === task.id)).toBe(true);
    expect(timeline.entries.every((entry) => entry.project_id === project.id)).toBe(true);
    expect(timeline.entries.every((entry) => entry.plan_id === plan.id)).toBe(true);
    expect(JSON.stringify(timeline.entries)).not.toContain("abcdefghijklmnop");
    expect(JSON.stringify(timeline.entries)).not.toContain("bcdefghijklmnopq");
  });

  test("filters by project plan and run with deterministic pagination", () => {
    const project = createProject({ name: "Timeline", path: "/tmp/timeline" }, db);
    const otherProject = createProject({ name: "Other", path: "/tmp/other" }, db);
    const plan = createPlan({ project_id: project.id, name: "Launch" }, db);
    const task = createTask({ title: "In scope", project_id: project.id, plan_id: plan.id }, db);
    const other = createTask({ title: "Out of scope", project_id: otherProject.id }, db);
    addComment({ task_id: task.id, content: "first", agent_id: "codex" }, db);
    addComment({ task_id: task.id, content: "second", agent_id: "codex" }, db);
    addComment({ task_id: other.id, content: "outside", agent_id: "codex" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "Scoped run" }, db);
    addTaskRunEvent({ run_id: run.id, event_type: "comment", message: "run comment", agent_id: "codex" }, db);

    const byProject = getLocalActivityTimeline({ entity_type: "project", entity_id: project.id, order: "asc" }, db);
    expect(byProject.entries.length).toBeGreaterThanOrEqual(4);
    expect(byProject.entries.every((entry) => entry.project_id === project.id)).toBe(true);
    expect(byProject.entries.some((entry) => entry.message === "outside")).toBe(false);

    const byPlan = getLocalActivityTimeline({ entity_type: "plan", entity_id: plan.id, order: "asc" }, db);
    expect(byPlan.entries.every((entry) => entry.plan_id === plan.id)).toBe(true);

    const byRun = getLocalActivityTimeline({ entity_type: "run", entity_id: run.id, order: "asc" }, db);
    expect(byRun.entries.length).toBeGreaterThanOrEqual(2);
    expect(byRun.entries.every((entry) => entry.run_id === run.id)).toBe(true);

    const firstPage = getLocalActivityTimeline({ entity_type: "project", entity_id: project.id, order: "asc", limit: 2 }, db);
    const secondPage = getLocalActivityTimeline({ entity_type: "project", entity_id: project.id, order: "asc", limit: 2, offset: 2 }, db);
    expect(firstPage.entries).toHaveLength(2);
    expect(secondPage.entries.length).toBeGreaterThan(0);
    expect(firstPage.entries.map((entry) => entry.id)).not.toContain(secondPage.entries[0]!.id);
  });
});
