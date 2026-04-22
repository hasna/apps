import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase, now } from "./database.js";
import { createTask, startTask, completeTask, updateTask } from "./tasks.js";
import { logTaskChange, getTaskHistory, getRecentActivity, getRecap } from "./audit.js";
import { createProject } from "./projects.js";
import { addDependency } from "./task-graph.js";
import { registerAgent } from "./agents.js";

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

describe("getRecap", () => {
  it("should return recap structure with empty data", () => {
    const recap = getRecap(8, undefined, db);
    expect(recap.hours).toBe(8);
    expect(recap.since).toBeDefined();
    expect(recap.completed).toEqual([]);
    expect(recap.created).toEqual([]);
    expect(recap.in_progress).toEqual([]);
    expect(recap.blocked).toEqual([]);
    expect(recap.stale).toEqual([]);
    expect(recap.agents).toEqual([]);
  });

  it("should include completed tasks within the time window", () => {
    const task = createTask({ title: "Completed" }, db);
    const ts = now();
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [ts, task.id]);

    const recap = getRecap(1, undefined, db);
    expect(recap.completed).toHaveLength(1);
    expect(recap.completed[0]!.title).toBe("Completed");
  });

  it("should include created tasks within the time window", () => {
    createTask({ title: "Fresh task" }, db);

    const recap = getRecap(1, undefined, db);
    expect(recap.created).toHaveLength(1);
    expect(recap.created[0]!.title).toBe("Fresh task");
  });

  it("should include in_progress tasks", () => {
    const task = createTask({ title: "In Progress" }, db);
    db.run("UPDATE tasks SET status = 'in_progress', started_at = ? WHERE id = ?", [now(), task.id]);

    const recap = getRecap(8, undefined, db);
    expect(recap.in_progress).toHaveLength(1);
    expect(recap.in_progress[0]!.title).toBe("In Progress");
  });

  it("should include blocked tasks", () => {
    const dep = createTask({ title: "Dependency" }, db);
    const blocked = createTask({ title: "Blocked" }, db);
    addDependency(blocked.id, dep.id, db);

    const recap = getRecap(8, undefined, db);
    expect(recap.blocked.length).toBeGreaterThanOrEqual(1);
    const blockedTask = recap.blocked.find(b => b.title === "Blocked");
    expect(blockedTask).toBeDefined();
  });

  it("should include stale tasks (not updated in 30 min)", () => {
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const task = createTask({ title: "Stale task" }, db);
    db.run("UPDATE tasks SET status = 'in_progress', updated_at = ?, started_at = ? WHERE id = ?", [staleTime, staleTime, task.id]);

    const recap = getRecap(8, undefined, db);
    expect(recap.stale.length).toBeGreaterThanOrEqual(1);
  });

  it("should include agent activity", () => {
    const agent = registerAgent({ name: "test-agent-" + Date.now(), role: "agent", status: "active" }, db);
    const task = createTask({ title: "Agent task", assigned_to: agent.id }, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [now(), task.id]);
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), agent.id]);

    const recap = getRecap(1, undefined, db);
    expect(recap.agents.length).toBeGreaterThanOrEqual(1);
  });

  it("should filter by project_id", () => {
    const project = createProject({ name: "Recap Project", path: "/recap/proj-" + Date.now() }, db);
    createTask({ title: "Project task", project_id: project.id }, db);
    createTask({ title: "No project" }, db);

    const recap = getRecap(1, project.id, db);
    expect(recap.created).toHaveLength(1);
    expect(recap.created[0]!.title).toBe("Project task");
  });

  it("should calculate duration_minutes for completed tasks with start/end times", () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const completedAt = now();
    const task = createTask({ title: "Timed task" }, db);
    db.run("UPDATE tasks SET status = 'completed', started_at = ?, completed_at = ? WHERE id = ?", [startedAt, completedAt, task.id]);

    const recap = getRecap(1, undefined, db);
    expect(recap.completed).toHaveLength(1);
    expect(recap.completed[0]!.duration_minutes).toBeGreaterThanOrEqual(29);
  });

  it("should return null duration_minutes when started_at is missing", () => {
    const task = createTask({ title: "No start" }, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [now(), task.id]);

    const recap = getRecap(1, undefined, db);
    expect(recap.completed).toHaveLength(1);
    expect(recap.completed[0]!.duration_minutes).toBeNull();
  });

  it("should exclude completed tasks outside the time window", () => {
    const oldTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const task = createTask({ title: "Old task" }, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [oldTime, task.id]);

    const recap = getRecap(1, undefined, db);
    expect(recap.completed).toHaveLength(0);
  });
});
