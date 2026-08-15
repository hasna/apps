import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask, getTask } from "./tasks.js";
import { setTaskStatus, setTaskPriority, decomposeTasks, getTaskStats } from "./task-status.js";
import type { Database } from "bun:sqlite";

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

function setupProject() {
  const projId = "proj-" + Math.random().toString(36).slice(2, 10);
  db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
  return projId;
}

describe("setTaskStatus", () => {
  it("should change a task's status", () => {
    const projId = setupProject();
    const task = createTask({ title: "Test", project_id: projId }, db);
    const updated = setTaskStatus(task.id, "in_progress");
    expect(updated.status).toBe("in_progress");
  });

  it("should be a no-op if status is already set", () => {
    const projId = setupProject();
    const task = createTask({ title: "Test", project_id: projId, status: "in_progress" }, db);
    const updated = setTaskStatus(task.id, "in_progress");
    expect(updated.status).toBe("in_progress");
  });

  it("should throw TaskNotFoundError for non-existent task", () => {
    expect(() => setTaskStatus("nonexistent", "completed")).toThrow("Task not found");
  });
});

describe("setTaskPriority", () => {
  it("should change a task's priority", () => {
    const projId = setupProject();
    const task = createTask({ title: "Test", project_id: projId }, db);
    const updated = setTaskPriority(task.id, "critical");
    expect(updated.priority).toBe("critical");
  });

  it("should be a no-op if priority is already set", () => {
    const projId = setupProject();
    const task = createTask({ title: "Test", project_id: projId, priority: "high" }, db);
    const updated = setTaskPriority(task.id, "high");
    expect(updated.priority).toBe("high");
  });
});

describe("decomposeTasks", () => {
  it("should create subtasks for a parent task", () => {
    const projId = setupProject();
    const parent = createTask({ title: "Parent", project_id: projId }, db);
    const result = decomposeTasks(parent.id, [
      { title: "Sub 1" },
      { title: "Sub 2" },
      { title: "Sub 3" },
    ]);
    expect(result.parent.id).toBe(parent.id);
    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks[0].title).toBe("Sub 1");
  });

  it("should inherit parent's project_id", () => {
    const projId = setupProject();
    const parent = createTask({ title: "Parent", project_id: projId }, db);
    const result = decomposeTasks(parent.id, [{ title: "Sub" }]);
    expect(result.subtasks[0].project_id).toBe(projId);
  });

  it("should chain dependencies when depends_on_prev is set", () => {
    const projId = setupProject();
    const parent = createTask({ title: "Parent", project_id: projId }, db);
    const result = decomposeTasks(parent.id, [
      { title: "Step 1" },
      { title: "Step 2" },
      { title: "Step 3" },
    ], { depends_on_prev: true });
    // Check that Step 2 depends on Step 1, and Step 3 depends on Step 2
    const deps2 = db.query("SELECT * FROM task_dependencies WHERE task_id = ?").all(result.subtasks[1].id) as any[];
    const deps3 = db.query("SELECT * FROM task_dependencies WHERE task_id = ?").all(result.subtasks[2].id) as any[];
    expect(deps2).toHaveLength(1);
    expect(deps2[0].depends_on).toBe(result.subtasks[0].id);
    expect(deps3).toHaveLength(1);
    expect(deps3[0].depends_on).toBe(result.subtasks[1].id);
  });

  it("should throw TaskNotFoundError for non-existent parent", () => {
    expect(() => decomposeTasks("nonexistent", [{ title: "Sub" }])).toThrow("Task not found");
  });
});

describe("getTaskStats", () => {
  it("should return zero stats for no tasks", () => {
    const stats = getTaskStats();
    expect(stats.total).toBe(0);
    expect(stats.completion_rate).toBe(0);
    expect(stats.by_status).toEqual({});
  });

  it("should count tasks by status and priority", () => {
    const projId = setupProject();
    createTask({ title: "T1", project_id: projId, status: "completed", priority: "high" }, db);
    createTask({ title: "T2", project_id: projId, status: "in_progress", priority: "medium" }, db);
    createTask({ title: "T3", project_id: projId, status: "pending", priority: "low" }, db);
    const stats = getTaskStats({ project_id: projId });
    expect(stats.total).toBe(3);
    expect(stats.by_status["completed"]).toBe(1);
    expect(stats.by_status["in_progress"]).toBe(1);
    expect(stats.by_status["pending"]).toBe(1);
    expect(stats.by_priority["high"]).toBe(1);
    expect(stats.by_priority["medium"]).toBe(1);
    expect(stats.by_priority["low"]).toBe(1);
    expect(stats.completion_rate).toBe(33);
  });

  it("should filter by agent_id", () => {
    const projId = setupProject();
    createTask({ title: "A1", project_id: projId, assigned_to: "agent-1" }, db);
    createTask({ title: "A2", project_id: projId, agent_id: "agent-1" }, db);
    createTask({ title: "B1", project_id: projId, assigned_to: "agent-2" }, db);
    const stats = getTaskStats({ agent_id: "agent-1" });
    expect(stats.total).toBe(2);
  });
});
