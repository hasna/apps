import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { addDependency, completeTask, createTask, startTask } from "../db/tasks.js";
import { addTaskRunCommand, finishTaskRun, startTaskRun } from "../db/task-runs.js";
import {
  createLocalReport,
  listLocalReportTypes,
  renderLocalReportMarkdown,
} from "./local-reports.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local reports", () => {
  test("builds ready blocked overdue plan run verification and agent summaries from local evidence", () => {
    const db = getDatabase();
    const project = createProject({ name: "Reports Project", path: "/tmp/reports-project" }, db);
    const plan = createPlan({ name: "Reports Plan", project_id: project.id, agent_id: "codex" }, db);
    const blocker = createTask({ title: "Finish blocker", project_id: project.id, plan_id: plan.id, assigned_to: "codex" }, db);
    const blocked = createTask({ title: "Blocked task", project_id: project.id, plan_id: plan.id, assigned_to: "codex" }, db);
    const ready = createTask({ title: "Ready task", project_id: project.id, plan_id: plan.id, assigned_to: "codex", priority: "high" }, db);
    const overdue = createTask({
      title: "Overdue task",
      project_id: project.id,
      plan_id: plan.id,
      assigned_to: "codex",
      due_at: "2026-01-01T00:00:00.000Z",
    }, db);
    const done = createTask({ title: "Completed task", project_id: project.id, plan_id: plan.id, assigned_to: "codex" }, db);
    addDependency(blocked.id, blocker.id, db);
    startTask(done.id, "codex", db);
    completeTask(done.id, "codex", db);

    const run = startTaskRun({
      task_id: ready.id,
      agent_id: "codex",
      title: "Report run",
      started_at: "2026-01-02T03:00:00.000Z",
    }, db);
    addTaskRunCommand({
      run_id: run.id,
      command: "bun test src/lib/local-reports.test.ts",
      status: "failed",
      output_summary: "1 failed",
      agent_id: "codex",
    }, db);
    finishTaskRun({ run_id: run.id, status: "failed", summary: "Needs fix", agent_id: "codex" }, db);

    const report = createLocalReport({
      project_id: project.id,
      agent_id: "codex",
      generated_at: "2026-05-22T00:00:00.000Z",
      now: "2026-05-22T00:00:00.000Z",
      limit: 10,
    }, db);

    expect(report.local_only).toBe(true);
    expect(report.no_network).toBe(true);
    expect(report.scope).toMatchObject({ project_id: project.id, agent_id: "codex", plan_id: null });
    expect(report.views.ready.items.map((task) => task.id)).toContain(ready.id);
    expect(report.views.ready.items.map((task) => task.id)).not.toContain(blocked.id);
    expect(report.views.blocked.items).toEqual([
      expect.objectContaining({
        id: blocked.id,
        blocked_by: [expect.objectContaining({ id: blocker.id, title: "Finish blocker" })],
      }),
    ]);
    expect(report.views.overdue.items.map((task) => task.id)).toContain(overdue.id);
    expect(report.plans[0]).toMatchObject({
      id: plan.id,
      counts: {
        total: 5,
        pending: 4,
        in_progress: 0,
        completed: 1,
        failed: 0,
        cancelled: 0,
        blocked: 1,
        overdue: 1,
      },
    });
    expect(report.runs.outcomes).toMatchObject({ failed: 1, completed: 0 });
    expect(report.verification.outcomes).toMatchObject({ failed: 1, passed: 0 });
    expect(report.agents).toEqual([
      expect.objectContaining({
        agent_id: "codex",
        task_counts: expect.objectContaining({ total: 5, completed: 1, overdue: 1 }),
        run_outcomes: expect.objectContaining({ failed: 1 }),
        verification_outcomes: expect.objectContaining({ failed: 1 }),
      }),
    ]);

    const markdown = renderLocalReportMarkdown(report);
    expect(markdown).toContain("# Local Agent Report");
    expect(markdown).toContain("Ready task");
    expect(markdown).toContain("Blocked task");
    expect(markdown).toContain("failed: 1");
    expect(JSON.stringify(report)).not.toContain("hosted");
  });

  test("lists stable local report types", () => {
    expect(listLocalReportTypes()).toEqual([
      "ready",
      "blocked",
      "overdue",
      "standup",
      "sprint",
      "progress",
      "run_outcomes",
      "verification_evidence",
      "agent_summary",
    ]);
  });
});
