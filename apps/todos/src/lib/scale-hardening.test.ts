import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { addDependency, createTask } from "../db/tasks.js";
import { addTaskRunEvent, finishTaskRun, startTaskRun } from "../db/task-runs.js";
import {
  compactScaleStorage,
  createScalePerformanceReport,
  renderScalePerformanceReportMarkdown,
} from "./scale-hardening.js";

const OLD = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("scale hardening", () => {
  test("reports local performance archive readiness compaction and integrity", () => {
    const db = getDatabase();
    const project = createProject({ name: "Scale Project", path: "/tmp/scale-project" }, db);
    const blocker = createTask({ title: "Scale blocker", project_id: project.id, status: "pending" }, db);
    const active = createTask({ title: "Scale active work", project_id: project.id, status: "in_progress", priority: "high" }, db);
    const oldDone = createTask({ title: "Old completed task", project_id: project.id, status: "completed" }, db);
    const archived = createTask({ title: "Already archived task", project_id: project.id, status: "completed" }, db);
    addDependency(active.id, blocker.id, db);

    db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [OLD, oldDone.id]);
    db.run("UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?", [OLD, OLD, archived.id]);

    const run = startTaskRun({ task_id: active.id, agent_id: "codex", title: "scale run" }, db);
    addTaskRunEvent({ run_id: run.id, event_type: "progress", message: "indexed", agent_id: "codex" }, db);
    finishTaskRun({ run_id: run.id, status: "completed", agent_id: "codex" }, db);

    const report = createScalePerformanceReport({
      older_than_days: 30,
      generated_at: "2026-05-22T00:00:00.000Z",
    }, db);

    expect(report.local_only).toBe(true);
    expect(report.no_network).toBe(true);
    expect(report.counts.tasks).toBe(4);
    expect(report.counts.archived_tasks).toBe(1);
    expect(report.counts.dependencies).toBe(1);
    expect(report.counts.runs).toBe(1);
    expect(report.archive.older_terminal_unarchived_tasks).toBe(1);
    expect(report.archive.archived_tasks_visible_with_include_archived).toBe(true);
    expect(report.compaction.commands).toEqual(["PRAGMA optimize", "VACUUM"]);
    expect(report.integrity).toMatchObject({
      quick_check: "ok",
      foreign_key_violations: 0,
      missing_indexes: [],
      ok: true,
    });
    expect(report.benchmarks.every(item => item.ok)).toBe(true);

    const markdown = renderScalePerformanceReportMarkdown(report);
    expect(markdown).toContain("# todos scale hardening report");
    expect(markdown).toContain("## Benchmarks");
    expect(markdown).toContain("## Archive Readiness");
    expect(markdown).toContain("Missing indexes: none");
  });

  test("previews and applies local compaction without deleting evidence", () => {
    const db = getDatabase();
    const project = createProject({ name: "Compact Project", path: "/tmp/compact-project" }, db);
    const task = createTask({ title: "Keep evidence", project_id: project.id }, db);
    const dryRun = compactScaleStorage({}, db);

    expect(dryRun.dry_run).toBe(true);
    expect(dryRun.actions).toEqual(["PRAGMA optimize", "VACUUM"]);
    expect(dryRun.before).toEqual(dryRun.after);

    const applied = compactScaleStorage({ apply: true }, db);
    expect(applied.dry_run).toBe(false);
    expect(applied.actions).toEqual(["PRAGMA optimize", "VACUUM"]);
    expect(db.query("SELECT id FROM tasks WHERE id = ?").get(task.id)).toBeTruthy();
  });
});
