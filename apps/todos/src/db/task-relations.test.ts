import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import {
  bulkCreateTasks,
  bulkUpdateTasks,
  archiveTasks,
  unarchiveTask,
  getOverdueTasks,
  logTime,
  getTimeLogs,
  getTimeReport,
  watchTask,
  unwatchTask,
  getTaskWatchers,
  notifyWatchers,
  logCost,
} from "./task-relations.js";
import { createProject } from "./projects.js";
import { createTaskList } from "./task-lists.js";

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

describe("bulkCreateTasks", () => {
  it("should create multiple tasks", () => {
    const result = bulkCreateTasks([
      { title: "Task A" },
      { title: "Task B" },
      { title: "Task C" },
    ], db);

    expect(result.created).toHaveLength(3);
    expect(result.created.map(c => c.title)).toContain("Task A");
    expect(result.created.map(c => c.title)).toContain("Task B");
    expect(result.created.map(c => c.title)).toContain("Task C");
  });

  it("should map temp_ids to real ids", () => {
    const result = bulkCreateTasks([
      { temp_id: "tmp-1", title: "First" },
      { temp_id: "tmp-2", title: "Second" },
    ], db);

    expect(result.created[0]!.temp_id).toBe("tmp-1");
    expect(result.created[1]!.temp_id).toBe("tmp-2");
    expect(result.created[0]!.id).toBeDefined();
  });

  it("should wire up dependencies via temp_ids", () => {
    const result = bulkCreateTasks([
      { temp_id: "t1", title: "Dependency" },
      { temp_id: "t2", title: "Dependent", depends_on_temp_ids: ["t1"] },
    ], db);

    // Verify dependency was created by checking the task_dependencies table
    const dep = db.query("SELECT * FROM task_dependencies WHERE task_id = ?").get(result.created[1]!.id);
    expect(dep).toBeDefined();
  });

  it("should handle missing temp_id gracefully", () => {
    const result = bulkCreateTasks([
      { title: "No temp id" },
      { temp_id: "t2", title: "Has temp id", depends_on_temp_ids: ["nonexistent"] },
    ], db);

    expect(result.created).toHaveLength(2);
  });

  it("should skip wiring deps for task without temp_id", () => {
    const result = bulkCreateTasks([
      { temp_id: "t1", title: "Parent" },
      { title: "Child without temp", depends_on_temp_ids: ["t1"] },
    ], db);

    // No crash, child created without dependency wiring
    expect(result.created).toHaveLength(2);
  });
});

describe("bulkUpdateTasks", () => {
  it("should update multiple tasks", () => {
    const t1 = createTask({ title: "T1" }, db);
    const t2 = createTask({ title: "T2" }, db);

    const result = bulkUpdateTasks([t1.id, t2.id], { status: "cancelled" }, db);
    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(0);
  });

  it("should report failed tasks", () => {
    const result = bulkUpdateTasks(["nonexistent-id"], { status: "completed" }, db);
    expect(result.updated).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.id).toBe("nonexistent-id");
  });

  it("should partially succeed with mixed ids", () => {
    const t1 = createTask({ title: "Mixed" }, db);
    const result = bulkUpdateTasks([t1.id, "nonexistent"], { priority: "critical" }, db);
    expect(result.updated).toBe(1);
    expect(result.failed).toHaveLength(1);
  });
});

describe("archiveTasks", () => {
  it("should archive completed tasks older than N days", () => {
    const oldTime = new Date(Date.now() - 10 * 86400000).toISOString();
    const task = createTask({ title: "Old completed", status: "completed" }, db);
    db.run("UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?", [oldTime, oldTime, task.id]);

    const result = archiveTasks({ older_than_days: 7 }, db);
    expect(result.archived).toBe(1);

    const updated = db.query("SELECT archived_at FROM tasks WHERE id = ?").get(task.id) as any;
    expect(updated.archived_at).toBeDefined();
  });

  it("should not archive recent tasks", () => {
    const task = createTask({ title: "Recent completed", status: "completed" }, db);

    const result = archiveTasks({ older_than_days: 7 }, db);
    expect(result.archived).toBe(0);
  });

  it("should filter by project_id", () => {
    const proj = createProject({ name: "Archive Test", path: "/tmp/archive-test" }, db);
    const t1 = createTask({ title: "Project task", status: "completed", project_id: proj.id }, db);
    const t2 = createTask({ title: "Other task", status: "completed" }, db);
    const oldTime = new Date(Date.now() - 10 * 86400000).toISOString();
    db.run("UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id IN (?, ?)", [oldTime, oldTime, t1.id, t2.id]);

    const result = archiveTasks({ project_id: proj.id, older_than_days: 7 }, db);
    expect(result.archived).toBe(1);
  });

  it("should filter by task_list_id", () => {
    const list = createTaskList({ name: "Archive List" }, db);
    const task = createTask({ title: "List task", status: "completed", task_list_id: list.id }, db);
    const oldTime = new Date(Date.now() - 10 * 86400000).toISOString();
    db.run("UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?", [oldTime, oldTime, task.id]);

    const result = archiveTasks({ task_list_id: list.id, older_than_days: 7 }, db);
    expect(result.archived).toBe(1);
  });

  it("should filter by custom statuses", () => {
    const task = createTask({ title: "Failed task", status: "failed" }, db);
    const oldTime = new Date(Date.now() - 10 * 86400000).toISOString();
    db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [oldTime, task.id]);

    const result = archiveTasks({ older_than_days: 7, status: ["failed"] }, db);
    expect(result.archived).toBe(1);
  });

  it("should archive all completed/failed/cancelled by default regardless of age", () => {
    const t1 = createTask({ title: "Completed", status: "completed" }, db);
    const t2 = createTask({ title: "Failed", status: "failed" }, db);
    const t3 = createTask({ title: "Cancelled", status: "cancelled" }, db);

    const result = archiveTasks({}, db);
    expect(result.archived).toBe(3);
  });

  it("should not archive already archived tasks", () => {
    const task = createTask({ title: "Already archived", status: "completed" }, db);
    const oldTime = new Date(Date.now() - 10 * 86400000).toISOString();
    db.run("UPDATE tasks SET archived_at = ?, completed_at = ?, updated_at = ? WHERE id = ?", [oldTime, oldTime, oldTime, task.id]);

    const result = archiveTasks({ older_than_days: 7 }, db);
    expect(result.archived).toBe(0);
  });
});

describe("unarchiveTask", () => {
  it("should restore an archived task", () => {
    const task = createTask({ title: "Restore me" }, db);
    db.run("UPDATE tasks SET archived_at = ? WHERE id = ?", [new Date().toISOString(), task.id]);

    const restored = unarchiveTask(task.id, db);
    expect(restored).not.toBeNull();

    const row = db.query("SELECT archived_at FROM tasks WHERE id = ?").get(task.id) as any;
    expect(row.archived_at).toBeNull();
  });

  it("should return null for non-existent task", () => {
    expect(unarchiveTask("nonexistent", db)).toBeNull();
  });
});

describe("getOverdueTasks", () => {
  it("should return tasks past due date", () => {
    const pastDue = new Date(Date.now() - 86400000).toISOString();
    const task = createTask({ title: "Overdue" }, db);
    db.run("UPDATE tasks SET due_at = ? WHERE id = ?", [pastDue, task.id]);

    const overdue = getOverdueTasks(undefined, db);
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    const found = overdue.find(t => t.title === "Overdue");
    expect(found).toBeDefined();
  });

  it("should not return completed overdue tasks", () => {
    const pastDue = new Date(Date.now() - 86400000).toISOString();
    const task = createTask({ title: "Done but late", status: "completed" }, db);
    db.run("UPDATE tasks SET due_at = ? WHERE id = ?", [pastDue, task.id]);

    const overdue = getOverdueTasks(undefined, db);
    expect(overdue.find(t => t.title === "Done but late")).toBeUndefined();
  });

  it("should filter by project_id", () => {
    const proj = createProject({ name: "Overdue Test", path: "/tmp/overdue-test" }, db);
    const pastDue = new Date(Date.now() - 86400000).toISOString();
    createTask({ title: "Project overdue", project_id: proj.id }, db);
    createTask({ title: "Other overdue" }, db);
    db.run("UPDATE tasks SET due_at = ? WHERE project_id = ?", [pastDue, proj.id]);

    const overdue = getOverdueTasks(proj.id, db);
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(overdue[0]!.project_id).toBe(proj.id);
  });
});

describe("logTime", () => {
  it("should create a time log entry", () => {
    const task = createTask({ title: "Time task" }, db);
    const log = logTime({ task_id: task.id, agent_id: "a1", minutes: 45 }, db);

    expect(log.task_id).toBe(task.id);
    expect(log.agent_id).toBe("a1");
    expect(log.minutes).toBe(45);
    expect(log.created_at).toBeDefined();
  });

  it("should handle optional fields", () => {
    const task = createTask({ title: "Simple time" }, db);
    const log = logTime({ task_id: task.id, minutes: 30 }, db);

    expect(log.agent_id).toBeNull();
    expect(log.started_at).toBeNull();
    expect(log.ended_at).toBeNull();
    expect(log.notes).toBeNull();
  });

  it("should store started_at and ended_at", () => {
    const task = createTask({ title: "Range task" }, db);
    const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ended = new Date().toISOString();
    const log = logTime({ task_id: task.id, minutes: 60, started_at: started, ended_at: ended, notes: "worked hard" }, db);

    expect(log.started_at).toBe(started);
    expect(log.ended_at).toBe(ended);
    expect(log.notes).toBe("worked hard");
  });
});

describe("getTimeLogs", () => {
  it("should return time logs for a task", () => {
    const task = createTask({ title: "Log task" }, db);
    logTime({ task_id: task.id, minutes: 30 }, db);
    logTime({ task_id: task.id, minutes: 45 }, db);

    const logs = getTimeLogs(task.id, db);
    expect(logs).toHaveLength(2);
  });

  it("should return empty for task with no logs", () => {
    const task = createTask({ title: "Empty log" }, db);
    expect(getTimeLogs(task.id, db)).toEqual([]);
  });
});

describe("getTimeReport", () => {
  it("should return time report for completed tasks", () => {
    const task = createTask({ title: "Report task", status: "completed", estimated_minutes: 60 }, db);
    logTime({ task_id: task.id, minutes: 45 }, db);

    const report = getTimeReport(undefined, db);
    const entry = report.find(r => r.task_id === task.id);
    expect(entry).toBeDefined();
    expect(entry!.time_logs).toHaveLength(1);
  });

  it("should filter by project_id", () => {
    const proj = createProject({ name: "Time Report Test", path: "/tmp/time-report" }, db);
    const task = createTask({ title: "Proj report", status: "completed", project_id: proj.id }, db);
    logTime({ task_id: task.id, minutes: 15 }, db);

    const report = getTimeReport({ project_id: proj.id }, db);
    expect(report).toHaveLength(1);
  });

  it("should filter by agent_id", () => {
    const task = createTask({ title: "Agent report", status: "completed", assigned_to: "dev-1" }, db);
    logTime({ task_id: task.id, minutes: 20 }, db);

    const report = getTimeReport({ agent_id: "dev-1" }, db);
    expect(report).toHaveLength(1);
  });

  it("should filter by since date", () => {
    const recent = createTask({ title: "Recent", status: "completed" }, db);
    const nowStr = new Date().toISOString();
    db.run("UPDATE tasks SET completed_at = ? WHERE id = ?", [nowStr, recent.id]);
    logTime({ task_id: recent.id, minutes: 10 }, db);

    const oldCutoff = new Date(Date.now() - 86400000).toISOString();
    const report = getTimeReport({ since: oldCutoff }, db);
    expect(report.length).toBeGreaterThanOrEqual(1);
  });
});

describe("watchTask", () => {
  it("should create a watcher entry", () => {
    const task = createTask({ title: "Watch me" }, db);
    const watcher = watchTask(task.id, "agent-w1", db);

    expect(watcher.task_id).toBe(task.id);
    expect(watcher.agent_id).toBe("agent-w1");
  });

  it("should be idempotent (INSERT OR IGNORE)", () => {
    const task = createTask({ title: "Double watch" }, db);
    watchTask(task.id, "agent-w2", db);
    watchTask(task.id, "agent-w2", db);

    const watchers = getTaskWatchers(task.id, db);
    expect(watchers).toHaveLength(1);
  });
});

describe("unwatchTask", () => {
  it("should remove a watcher", () => {
    const task = createTask({ title: "Unwatch me" }, db);
    watchTask(task.id, "agent-w3", db);

    expect(unwatchTask(task.id, "agent-w3", db)).toBe(true);
    expect(getTaskWatchers(task.id, db)).toEqual([]);
  });

  it("should return false for non-existent watcher", () => {
    const task = createTask({ title: "Never watched" }, db);
    expect(unwatchTask(task.id, "nobody", db)).toBe(false);
  });
});

describe("getTaskWatchers", () => {
  it("should return all watchers", () => {
    const task = createTask({ title: "Multi watch" }, db);
    watchTask(task.id, "agent-a", db);
    watchTask(task.id, "agent-b", db);

    const watchers = getTaskWatchers(task.id, db);
    expect(watchers).toHaveLength(2);
  });
});

describe("notifyWatchers", () => {
  it("should not throw when dispatching to no watchers", () => {
    const task = createTask({ title: "No watchers" }, db);
    expect(() => notifyWatchers(task.id, "status_changed", { status: "done" }, db)).not.toThrow();
  });
});

describe("logCost", () => {
  it("should accumulate tokens and usd", () => {
    const task = createTask({ title: "Cost task" }, db);
    logCost(task.id, 1000, 0.01, db);
    logCost(task.id, 2000, 0.02, db);

    const row = db.query("SELECT cost_tokens, cost_usd FROM tasks WHERE id = ?").get(task.id) as any;
    expect(row.cost_tokens).toBe(3000);
    expect(row.cost_usd).toBe(0.03);
  });

  it("should start from zero for new tasks", () => {
    const task = createTask({ title: "Zero cost" }, db);
    logCost(task.id, 500, 0.005, db);

    const row = db.query("SELECT cost_tokens, cost_usd FROM tasks WHERE id = ?").get(task.id) as any;
    expect(row.cost_tokens).toBe(500);
    expect(row.cost_usd).toBe(0.005);
  });
});
