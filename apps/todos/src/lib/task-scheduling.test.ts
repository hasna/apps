import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, startTask } from "../db/tasks.js";
import {
  TASK_SCHEDULING_SCHEMA,
  scheduleTask,
  listDelayedStartTasks,
  listReadyScheduledTasks,
  getAgentSafeQueue,
  getStaleTaskReport,
  getSchedulingSummary,
  previewNextRecurrence,
  getAgentLoopDocs,
} from "./task-scheduling.js";
import { parseRecurrenceRule, nextOccurrence } from "./recurrence.js";

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

describe("task scheduling", () => {
  it("schedules due date and delayed start", () => {
    const task = createTask({ title: "Scheduled" }, db);
    const due = "2026-06-01T12:00:00.000Z";
    const start = "2026-05-25T09:00:00.000Z";
    const updated = scheduleTask(task.id, { due_at: due, scheduled_start_at: start }, db);
    expect(updated.due_at).toBe(due);
  });

  it("separates delayed vs ready tasks", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 3600000).toISOString();
    createTask({ title: "Future start" }, db);
    const t2 = createTask({ title: "Ready" }, db);
    scheduleTask(t2.id, { scheduled_start_at: past }, db);
    scheduleTask(createTask({ title: "Delayed" }, db).id, { scheduled_start_at: future }, db);

    expect(listDelayedStartTasks(db).length).toBeGreaterThan(0);
    expect(listReadyScheduledTasks({}, db).some((t) => t.id === t2.id)).toBe(true);
  });

  it("orders agent-safe queue by priority and due urgency", () => {
    const overdue = new Date(Date.now() - 86400000).toISOString();
    const t1 = createTask({ title: "Low overdue", priority: "low" }, db);
    const t2 = createTask({ title: "Critical", priority: "critical" }, db);
    scheduleTask(t1.id, { due_at: overdue }, db);
    scheduleTask(t2.id, { due_at: overdue }, db);

    const queue = getAgentSafeQueue(undefined, { limit: 10 }, db);
    expect(queue.length).toBeGreaterThan(1);
    expect(queue[0]!.priority).toBe("critical");
  });

  it("reports stale tasks", () => {
    const task = createTask({ title: "Stale" }, db);
    startTask(task.id, "agent-1", db);
    db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [
      new Date(Date.now() - 60 * 60000).toISOString(),
      task.id,
    ]);
    const report = getStaleTaskReport(30, undefined, db);
    expect(report.schema_version).toBe(TASK_SCHEDULING_SCHEMA);
    expect(report.count).toBeGreaterThan(0);
  });

  it("summarizes scheduling state", () => {
    createTask({ title: "Recurring", recurrence_rule: "every day", due_at: new Date().toISOString() }, db);
    const summary = getSchedulingSummary(undefined, undefined, db);
    expect(summary.recurring).toBeGreaterThan(0);
    expect(summary.schema_version).toBe(TASK_SCHEDULING_SCHEMA);
  });

  it("previews next recurrence deterministically", () => {
    const task = createTask({
      title: "Daily",
      recurrence_rule: "every day",
      due_at: "2026-01-01T12:00:00.000Z",
    }, db);
    const preview = previewNextRecurrence(task.id, db)!;
    expect(preview.due_at).toBe(nextOccurrence("every day", new Date("2026-01-01T12:00:00.000Z")));
    expect(parseRecurrenceRule(preview.rule).type).toBe("interval");
  });

  it("documents agent loop without hosted deps", () => {
    const docs = getAgentLoopDocs();
    expect(docs).toContain("todos claim");
    expect(docs).not.toMatch(/platform-todos|stripe/i);
  });
});
