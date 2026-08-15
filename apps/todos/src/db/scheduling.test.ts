import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import {
  completeTask,
  createTask,
  getEscalatedTasks,
  getOverdueTasks,
  getTask,
  updateTask,
} from "./tasks.js";

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

describe("local scheduling metadata", () => {
  it("persists SLA minutes on create and update", () => {
    const task = createTask({
      title: "SLA task",
      due_at: "2026-05-20T10:00:00.000Z",
      sla_minutes: 90,
    }, db);

    expect(task.sla_minutes).toBe(90);

    const updated = updateTask(task.id, {
      version: task.version,
      sla_minutes: 45,
      due_at: null,
    }, db);

    expect(updated.sla_minutes).toBe(45);
    expect(updated.due_at).toBeNull();
  });

  it("reports overdue and SLA-breached tasks without archived or terminal records", () => {
    const overdue = createTask({
      title: "Past due",
      due_at: "2026-05-20T10:00:00.000Z",
    }, db);
    const breached = createTask({
      title: "SLA breached",
      sla_minutes: 30,
    }, db);
    const future = createTask({
      title: "Future due",
      due_at: "2026-05-22T10:00:00.000Z",
      sla_minutes: 60 * 48,
    }, db);
    const completed = createTask({
      title: "Completed old",
      due_at: "2026-05-20T10:00:00.000Z",
      sla_minutes: 1,
      status: "completed",
    }, db);

    db.run("UPDATE tasks SET created_at = ?, archived_at = ? WHERE id = ?", [
      "2026-05-20T10:00:00.000Z",
      "2026-05-20T11:00:00.000Z",
      overdue.id,
    ]);
    db.run("UPDATE tasks SET created_at = ? WHERE id = ?", ["2026-05-20T10:00:00.000Z", breached.id]);
    db.run("UPDATE tasks SET created_at = ? WHERE id = ?", ["2026-05-21T18:00:00.000Z", future.id]);
    db.run("UPDATE tasks SET created_at = ? WHERE id = ?", ["2026-05-20T10:00:00.000Z", completed.id]);

    const overdueTasks = getOverdueTasks(undefined, db, new Date("2026-05-21T18:00:00.000Z"));
    expect(overdueTasks.map((task) => task.id)).not.toContain(overdue.id);
    expect(overdueTasks.map((task) => task.id)).not.toContain(completed.id);

    const escalated = getEscalatedTasks({}, db, new Date("2026-05-21T18:00:00.000Z"));
    expect(escalated.map((item) => item.task.id)).toEqual([breached.id]);
    expect(escalated[0]!.reasons).toEqual(["sla_breached"]);
    expect(escalated.map((item) => item.task.id)).not.toContain(future.id);
  });

  it("spawns recurring tasks from the scheduled due date and preserves SLA metadata", () => {
    const task = createTask({
      title: "Weekly review",
      due_at: "2026-03-13T10:00:00.000Z",
      recurrence_rule: "every week",
      sla_minutes: 120,
    }, db);

    const completed = completeTask(task.id, undefined, db, {
      completed_at: "2026-03-20T12:00:00.000Z",
    });
    const next = completed.metadata._next_recurrence as { id: string; due_at: string };
    const spawned = getTask(next.id, db)!;

    expect(next.due_at).toBe("2026-03-20T10:00:00.000Z");
    expect(spawned.due_at).toBe("2026-03-20T10:00:00.000Z");
    expect(spawned.sla_minutes).toBe(120);
    expect(spawned.recurrence_parent_id).toBe(task.id);
  });
});
