import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask, startTask, completeTask, updateTask } from "./tasks.js";
import { logTaskChange, getTaskHistory, getRecentActivity } from "./audit.js";

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

describe("logTaskChange", () => {
  it("should log a task change", () => {
    const task = createTask({ title: "Test" }, db);
    const entry = logTaskChange(task.id, "update", "status", "pending", "in_progress", "agent1", db);
    expect(entry.task_id).toBe(task.id);
    expect(entry.action).toBe("update");
    expect(entry.field).toBe("status");
    expect(entry.old_value).toBe("pending");
    expect(entry.new_value).toBe("in_progress");
    expect(entry.agent_id).toBe("agent1");
  });

  it("should log without field or agent", () => {
    const task = createTask({ title: "Test" }, db);
    const entry = logTaskChange(task.id, "create", undefined, undefined, undefined, undefined, db);
    expect(entry.action).toBe("create");
    expect(entry.field).toBeNull();
    expect(entry.agent_id).toBeNull();
  });

  it("should generate a unique id for each entry", () => {
    const task = createTask({ title: "Test" }, db);
    const e1 = logTaskChange(task.id, "create", undefined, undefined, undefined, undefined, db);
    const e2 = logTaskChange(task.id, "update", "status", "pending", "in_progress", undefined, db);
    expect(e1.id).not.toBe(e2.id);
  });

  it("should set created_at timestamp", () => {
    const task = createTask({ title: "Test" }, db);
    const entry = logTaskChange(task.id, "create", undefined, undefined, undefined, undefined, db);
    expect(entry.created_at).toBeTruthy();
  });

  it("should store null for undefined old_value and new_value", () => {
    const task = createTask({ title: "Test" }, db);
    const entry = logTaskChange(task.id, "create", undefined, undefined, undefined, undefined, db);
    expect(entry.old_value).toBeNull();
    expect(entry.new_value).toBeNull();
  });
});

describe("getTaskHistory", () => {
  it("should return history for a task", () => {
    const task = createTask({ title: "Test" }, db);
    logTaskChange(task.id, "create", undefined, undefined, undefined, undefined, db);
    logTaskChange(task.id, "update", "status", "pending", "in_progress", "a1", db);
    const history = getTaskHistory(task.id, db);
    expect(history.length).toBe(2);
  });

  it("should return all entries for the task", () => {
    const task = createTask({ title: "Test" }, db);
    logTaskChange(task.id, "create", undefined, undefined, undefined, undefined, db);
    logTaskChange(task.id, "update", "status", "pending", "in_progress", "a1", db);
    const history = getTaskHistory(task.id, db);
    expect(history.length).toBe(2);
    const actions = history.map(h => h.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");
  });

  it("should return empty for task with no history", () => {
    const task = createTask({ title: "Test" }, db);
    expect(getTaskHistory(task.id, db)).toEqual([]);
  });

  it("should not return history from other tasks", () => {
    const t1 = createTask({ title: "T1" }, db);
    const t2 = createTask({ title: "T2" }, db);
    logTaskChange(t1.id, "create", undefined, undefined, undefined, undefined, db);
    logTaskChange(t2.id, "update", "status", "pending", "done", undefined, db);
    const history = getTaskHistory(t1.id, db);
    expect(history.length).toBe(1);
    expect(history[0]!.task_id).toBe(t1.id);
  });
});

describe("getRecentActivity", () => {
  it("should return recent activity across tasks", () => {
    const t1 = createTask({ title: "T1" }, db);
    const t2 = createTask({ title: "T2" }, db);
    logTaskChange(t1.id, "create", undefined, undefined, undefined, undefined, db);
    logTaskChange(t2.id, "create", undefined, undefined, undefined, undefined, db);
    const activity = getRecentActivity(10, db);
    expect(activity.length).toBe(2);
  });

  it("should respect limit", () => {
    const task = createTask({ title: "T" }, db);
    for (let i = 0; i < 5; i++) {
      logTaskChange(task.id, `action-${i}`, undefined, undefined, undefined, undefined, db);
    }
    expect(getRecentActivity(3, db).length).toBe(3);
  });

  it("should return all entries", () => {
    const task = createTask({ title: "T" }, db);
    logTaskChange(task.id, "first", undefined, undefined, undefined, undefined, db);
    logTaskChange(task.id, "second", undefined, undefined, undefined, undefined, db);
    const activity = getRecentActivity(10, db);
    expect(activity.length).toBe(2);
    const actions = activity.map(a => a.action);
    expect(actions).toContain("first");
    expect(actions).toContain("second");
  });

  it("should return empty when no activity exists", () => {
    expect(getRecentActivity(10, db)).toEqual([]);
  });
});

describe("auto-audit in task mutations", () => {
  it("should log when startTask is called", () => {
    const task = createTask({ title: "Start test" }, db);
    startTask(task.id, "agent1", db);
    const history = getTaskHistory(task.id, db);
    expect(history.some(h => h.action === "start" && h.new_value === "in_progress")).toBe(true);
  });

  it("should log when completeTask is called", () => {
    const task = createTask({ title: "Complete test", status: "in_progress" }, db);
    completeTask(task.id, undefined, db);
    const history = getTaskHistory(task.id, db);
    expect(history.some(h => h.action === "complete" && h.new_value === "completed")).toBe(true);
  });

  it("should log when updateTask changes status", () => {
    const task = createTask({ title: "Update test" }, db);
    updateTask(task.id, { status: "cancelled", version: task.version }, db);
    const history = getTaskHistory(task.id, db);
    expect(history.some(h => h.action === "update" && h.field === "status" && h.new_value === "cancelled")).toBe(true);
  });

  it("should log when updateTask changes priority", () => {
    const task = createTask({ title: "Priority test" }, db);
    updateTask(task.id, { priority: "critical", version: task.version }, db);
    const history = getTaskHistory(task.id, db);
    expect(history.some(h => h.field === "priority" && h.new_value === "critical")).toBe(true);
  });

  it("should log approval", () => {
    const task = createTask({ title: "Approval test", requires_approval: true }, db);
    updateTask(task.id, { approved_by: "admin", version: task.version }, db);
    const history = getTaskHistory(task.id, db);
    expect(history.some(h => h.action === "approve")).toBe(true);
  });

  it("should log agent_id from startTask", () => {
    const task = createTask({ title: "Agent test" }, db);
    startTask(task.id, "myagent", db);
    const history = getTaskHistory(task.id, db);
    expect(history.some(h => h.agent_id === "myagent")).toBe(true);
  });

  it("should log old and new status values", () => {
    const task = createTask({ title: "Status values test" }, db);
    updateTask(task.id, { status: "in_progress", version: task.version }, db);
    const history = getTaskHistory(task.id, db);
    const statusChange = history.find(h => h.field === "status");
    expect(statusChange).toBeTruthy();
    expect(statusChange!.old_value).toBe("pending");
    expect(statusChange!.new_value).toBe("in_progress");
  });

  it("should not log when status is unchanged", () => {
    const task = createTask({ title: "No change test" }, db);
    updateTask(task.id, { title: "Renamed", version: task.version }, db);
    const history = getTaskHistory(task.id, db);
    expect(history.some(h => h.field === "status")).toBe(false);
  });
});
