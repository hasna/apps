import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createPlan, updatePlan } from "./plans.js";
import { createProject } from "./projects.js";
import { addTaskVerification } from "./task-commits.js";
import { addDependency } from "./task-graph.js";
import { createTask } from "./tasks.js";
import {
  createRetrospective,
  createRetrospectiveExport,
  listRetrospectives,
  renderRetrospectiveMarkdown,
} from "./retrospectives.js";

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

describe("local retrospectives", () => {
  it("summarizes missed estimates, recurring blockers, failed verifications, lessons, and follow-ups", () => {
    const project = createProject({ name: "Retro", path: "/tmp/retro" }, db);
    const plan = createPlan({ name: "Retro plan", project_id: project.id }, db);
    updatePlan(plan.id, { status: "completed" }, db);
    const blocker = createTask({ title: "Shared prerequisite", project_id: project.id, plan_id: plan.id }, db);
    const overrun = createTask({ title: "Overran estimate", project_id: project.id, plan_id: plan.id, estimated_minutes: 30 }, db);
    const blockedA = createTask({ title: "Blocked A", project_id: project.id, plan_id: plan.id }, db);
    const blockedB = createTask({ title: "Blocked B", project_id: project.id, plan_id: plan.id, status: "failed" }, db);
    db.run("UPDATE tasks SET status = 'completed', actual_minutes = 75 WHERE id = ?", [overrun.id]);
    addDependency(blockedA.id, blocker.id, db);
    addDependency(blockedB.id, blocker.id, db);
    addTaskVerification({ task_id: blockedB.id, command: "bun test", status: "failed" }, db);

    const record = createRetrospective({ plan_id: plan.id.slice(0, 8), title: "Release retro", agent_id: "codex" }, db);
    expect(record.report.local_only).toBe(true);
    expect(record.report.no_network).toBe(true);
    expect(record.report.summary.completed_plans).toBe(1);
    expect(record.report.summary.missed_estimates).toBe(1);
    expect(record.report.summary.recurring_blockers).toBe(1);
    expect(record.report.summary.failed_verifications).toBe(1);
    expect(record.report.lessons.join(" ")).toContain("exceeded their estimate");
    expect(record.report.follow_up_tasks.map((task) => task.reason)).toEqual(expect.arrayContaining([
      "missed_estimates",
      "recurring_blockers",
      "failed_verifications",
    ]));

    const listed = listRetrospectives({ plan_id: plan.id }, db);
    expect(listed.map((item) => item.id)).toEqual([record.id]);

    const exported = createRetrospectiveExport({ plan_id: plan.id }, db);
    expect(exported.count).toBe(1);
    expect(renderRetrospectiveMarkdown(record)).toContain("## Lessons");
  });

  it("can create suggested follow-up tasks locally when requested", () => {
    const project = createProject({ name: "Retro followups", path: "/tmp/retro-followups" }, db);
    const plan = createPlan({ name: "Followup plan", project_id: project.id }, db);
    const task = createTask({ title: "Slow task", project_id: project.id, plan_id: plan.id, estimated_minutes: 10 }, db);
    db.run("UPDATE tasks SET status = 'completed', actual_minutes = 45 WHERE id = ?", [task.id]);

    const record = createRetrospective({ plan_id: plan.id, create_followups: true }, db);
    expect(record.report.follow_up_tasks).toHaveLength(1);
    expect(record.report.follow_up_tasks[0]!.created_task_id).toBeTruthy();
    const createdId = record.report.follow_up_tasks[0]!.created_task_id!;
    const created = db.query("SELECT title, plan_id FROM tasks WHERE id = ?").get(createdId) as { title: string; plan_id: string };
    expect(created.title).toContain("Review estimates");
    expect(created.plan_id).toBe(plan.id);
  });
});
