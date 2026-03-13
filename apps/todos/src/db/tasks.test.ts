import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  countTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
  bulkUpdateTasks,
  bulkCreateTasks,
  cloneTask,
  getTaskStats,
  getTaskGraph,
  moveTask,
} from "./tasks.js";
import {
  VersionConflictError,
  TaskNotFoundError,
  LockError,
  DependencyCycleError,
} from "../types/index.js";
import { createTaskList, deleteTaskList } from "./task-lists.js";
import { createProject } from "./projects.js";
import { createPlan } from "./plans.js";

let db: Database;

beforeEach(() => {
  // Use in-memory database for tests
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createTask", () => {
  it("should create a task with defaults", () => {
    const task = createTask({ title: "Test task" }, db);
    expect(task.title).toBe("Test task");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe("medium");
    expect(task.version).toBe(1);
    expect(task.id).toBeTruthy();
  });

  it("should create a task with all fields", () => {
    const task = createTask(
      {
        title: "Full task",
        description: "A description",
        priority: "high",
        status: "in_progress",
        agent_id: "claude",
        assigned_to: "codex",
        tags: ["urgent", "bug"],
        metadata: { key: "value" },
      },
      db,
    );
    expect(task.description).toBe("A description");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("in_progress");
    expect(task.agent_id).toBe("claude");
    expect(task.assigned_to).toBe("codex");
    expect(task.tags).toEqual(["urgent", "bug"]);
    expect(task.metadata).toEqual({ key: "value" });
  });

  it("should create subtasks", () => {
    const parent = createTask({ title: "Parent" }, db);
    const child = createTask({ title: "Child", parent_id: parent.id }, db);
    expect(child.parent_id).toBe(parent.id);
  });
});

describe("getTask", () => {
  it("should return null for non-existent task", () => {
    expect(getTask("non-existent", db)).toBeNull();
  });

  it("should return a task by id", () => {
    const created = createTask({ title: "Test" }, db);
    const task = getTask(created.id, db);
    expect(task).not.toBeNull();
    expect(task!.title).toBe("Test");
  });
});

describe("getTaskWithRelations", () => {
  it("should include subtasks", () => {
    const parent = createTask({ title: "Parent" }, db);
    createTask({ title: "Child 1", parent_id: parent.id }, db);
    createTask({ title: "Child 2", parent_id: parent.id }, db);

    const full = getTaskWithRelations(parent.id, db);
    expect(full!.subtasks).toHaveLength(2);
  });

  it("should include dependencies and blocked_by", () => {
    const a = createTask({ title: "Task A" }, db);
    const b = createTask({ title: "Task B" }, db);
    addDependency(b.id, a.id, db); // B depends on A

    const fullB = getTaskWithRelations(b.id, db);
    expect(fullB!.dependencies).toHaveLength(1);
    expect(fullB!.dependencies[0]!.id).toBe(a.id);

    const fullA = getTaskWithRelations(a.id, db);
    expect(fullA!.blocked_by).toHaveLength(1);
    expect(fullA!.blocked_by[0]!.id).toBe(b.id);
  });
});

describe("listTasks", () => {
  it("should list all tasks", () => {
    createTask({ title: "Task 1" }, db);
    createTask({ title: "Task 2" }, db);
    const tasks = listTasks({}, db);
    expect(tasks).toHaveLength(2);
  });

  it("should filter by status", () => {
    createTask({ title: "Pending", status: "pending" }, db);
    createTask({ title: "Done", status: "completed" }, db);

    const pending = listTasks({ status: "pending" }, db);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.title).toBe("Pending");
  });

  it("should filter by priority", () => {
    createTask({ title: "Low", priority: "low" }, db);
    createTask({ title: "Critical", priority: "critical" }, db);

    const critical = listTasks({ priority: "critical" }, db);
    expect(critical).toHaveLength(1);
    expect(critical[0]!.title).toBe("Critical");
  });

  it("should filter by assigned_to", () => {
    createTask({ title: "Assigned", assigned_to: "claude" }, db);
    createTask({ title: "Unassigned" }, db);

    const tasks = listTasks({ assigned_to: "claude" }, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Assigned");
  });

  it("should filter by tags", () => {
    createTask({ title: "Tagged", tags: ["bug", "urgent"] }, db);
    createTask({ title: "Untagged" }, db);

    const tasks = listTasks({ tags: ["bug"] }, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Tagged");
  });

  it("should order by priority then created_at", () => {
    createTask({ title: "Low", priority: "low" }, db);
    createTask({ title: "Critical", priority: "critical" }, db);
    createTask({ title: "High", priority: "high" }, db);

    const tasks = listTasks({}, db);
    expect(tasks[0]!.priority).toBe("critical");
    expect(tasks[1]!.priority).toBe("high");
    expect(tasks[2]!.priority).toBe("low");
  });

  it("should limit results", () => {
    createTask({ title: "Task 1" }, db);
    createTask({ title: "Task 2" }, db);
    createTask({ title: "Task 3" }, db);

    const tasks = listTasks({ limit: 2 }, db);
    expect(tasks).toHaveLength(2);
  });

  it("should support limit with offset", () => {
    createTask({ title: "Task 1", priority: "critical" }, db);
    createTask({ title: "Task 2", priority: "high" }, db);
    createTask({ title: "Task 3", priority: "medium" }, db);
    createTask({ title: "Task 4", priority: "low" }, db);

    const page1 = listTasks({ limit: 2, offset: 0 }, db);
    const page2 = listTasks({ limit: 2, offset: 2 }, db);

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    // No overlap between pages
    const page1Ids = page1.map(t => t.id);
    const page2Ids = page2.map(t => t.id);
    expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false);
  });

  it("should return empty array when offset exceeds total", () => {
    createTask({ title: "Task 1" }, db);
    createTask({ title: "Task 2" }, db);

    const tasks = listTasks({ limit: 10, offset: 100 }, db);
    expect(tasks).toHaveLength(0);
  });
});

describe("countTasks", () => {
  it("should count all tasks", () => {
    createTask({ title: "Task 1" }, db);
    createTask({ title: "Task 2" }, db);
    createTask({ title: "Task 3" }, db);

    expect(countTasks({}, db)).toBe(3);
  });

  it("should count with status filter", () => {
    createTask({ title: "Pending 1", status: "pending" }, db);
    createTask({ title: "Pending 2", status: "pending" }, db);
    createTask({ title: "Done", status: "completed" }, db);

    expect(countTasks({ status: "pending" }, db)).toBe(2);
    expect(countTasks({ status: "completed" }, db)).toBe(1);
  });

  it("should count with project filter", () => {
    const project = createProject({ name: "Test Project", path: "/test" }, db);
    createTask({ title: "In project", project_id: project.id }, db);
    createTask({ title: "No project" }, db);

    expect(countTasks({ project_id: project.id }, db)).toBe(1);
  });

  it("should return 0 for no matches", () => {
    createTask({ title: "Task 1" }, db);

    expect(countTasks({ status: "failed" }, db)).toBe(0);
  });

  it("should be consistent with listTasks count", () => {
    createTask({ title: "Task 1", priority: "high" }, db);
    createTask({ title: "Task 2", priority: "high" }, db);
    createTask({ title: "Task 3", priority: "low" }, db);

    const filter = { priority: "high" as const };
    const tasks = listTasks(filter, db);
    const count = countTasks(filter, db);
    expect(count).toBe(tasks.length);
    expect(count).toBe(2);
  });
});

describe("updateTask", () => {
  it("should update a task", () => {
    const task = createTask({ title: "Original" }, db);
    const updated = updateTask(
      task.id,
      { version: 1, title: "Updated", priority: "high" },
      db,
    );
    expect(updated.title).toBe("Updated");
    expect(updated.priority).toBe("high");
    expect(updated.version).toBe(2);
  });

  it("should throw VersionConflictError on version mismatch", () => {
    const task = createTask({ title: "Test" }, db);
    updateTask(task.id, { version: 1, title: "V2" }, db);

    expect(() =>
      updateTask(task.id, { version: 1, title: "Conflict" }, db),
    ).toThrow(VersionConflictError);
  });

  it("should throw TaskNotFoundError for non-existent task", () => {
    expect(() =>
      updateTask("non-existent", { version: 1, title: "Test" }, db),
    ).toThrow(TaskNotFoundError);
  });

  it("should set completed_at when status becomes completed", () => {
    const task = createTask({ title: "Test" }, db);
    const updated = updateTask(
      task.id,
      { version: 1, status: "completed" },
      db,
    );
    expect(updated.completed_at).toBeTruthy();
  });
});

describe("deleteTask", () => {
  it("should delete a task", () => {
    const task = createTask({ title: "To delete" }, db);
    expect(deleteTask(task.id, db)).toBe(true);
    expect(getTask(task.id, db)).toBeNull();
  });

  it("should return false for non-existent task", () => {
    expect(deleteTask("non-existent", db)).toBe(false);
  });

  it("should cascade delete subtasks", () => {
    const parent = createTask({ title: "Parent" }, db);
    const child = createTask({ title: "Child", parent_id: parent.id }, db);
    deleteTask(parent.id, db);
    expect(getTask(child.id, db)).toBeNull();
  });
});

describe("startTask", () => {
  it("should start and lock a task", () => {
    const task = createTask({ title: "To start" }, db);
    const started = startTask(task.id, "claude", db);
    expect(started.status).toBe("in_progress");
    expect(started.locked_by).toBe("claude");
    expect(started.assigned_to).toBe("claude");
  });

  it("should throw LockError if locked by another agent", () => {
    const task = createTask({ title: "Locked" }, db);
    startTask(task.id, "claude", db);
    expect(() => startTask(task.id, "codex", db)).toThrow(LockError);
  });

  it("should throw TaskNotFoundError for non-existent task", () => {
    expect(() => startTask("non-existent", "claude", db)).toThrow(
      TaskNotFoundError,
    );
  });
});

describe("completeTask", () => {
  it("should complete and unlock a task", () => {
    const task = createTask({ title: "To complete" }, db);
    startTask(task.id, "claude", db);
    const completed = completeTask(task.id, "claude", db);
    expect(completed.status).toBe("completed");
    expect(completed.locked_by).toBeNull();
    expect(completed.completed_at).toBeTruthy();
  });

  it("should throw LockError if completed by wrong agent", () => {
    const task = createTask({ title: "Locked" }, db);
    startTask(task.id, "claude", db);
    expect(() => completeTask(task.id, "codex", db)).toThrow(LockError);
  });
});

describe("lockTask / unlockTask", () => {
  it("should acquire and release a lock", () => {
    const task = createTask({ title: "To lock" }, db);
    const lockResult = lockTask(task.id, "claude", db);
    expect(lockResult.success).toBe(true);

    unlockTask(task.id, "claude", db);
    const unlocked = getTask(task.id, db);
    expect(unlocked!.locked_by).toBeNull();
  });

  it("should fail to lock if already locked by another", () => {
    const task = createTask({ title: "Locked" }, db);
    lockTask(task.id, "claude", db);
    const result = lockTask(task.id, "codex", db);
    expect(result.success).toBe(false);
  });

  it("should succeed if same agent re-locks", () => {
    const task = createTask({ title: "Re-lock" }, db);
    lockTask(task.id, "claude", db);
    const result = lockTask(task.id, "claude", db);
    expect(result.success).toBe(true);
  });

  it("should throw LockError when wrong agent unlocks", () => {
    const task = createTask({ title: "Locked" }, db);
    lockTask(task.id, "claude", db);
    expect(() => unlockTask(task.id, "codex", db)).toThrow(LockError);
  });
});

describe("dependencies", () => {
  it("should add and remove dependencies", () => {
    const a = createTask({ title: "A" }, db);
    const b = createTask({ title: "B" }, db);
    addDependency(b.id, a.id, db);

    const full = getTaskWithRelations(b.id, db);
    expect(full!.dependencies).toHaveLength(1);

    removeDependency(b.id, a.id, db);
    const after = getTaskWithRelations(b.id, db);
    expect(after!.dependencies).toHaveLength(0);
  });

  it("should detect cycles", () => {
    const a = createTask({ title: "A" }, db);
    const b = createTask({ title: "B" }, db);
    const c = createTask({ title: "C" }, db);

    addDependency(b.id, a.id, db); // B depends on A
    addDependency(c.id, b.id, db); // C depends on B

    // A -> B -> C -> A would be a cycle
    expect(() => addDependency(a.id, c.id, db)).toThrow(DependencyCycleError);
  });

  it("should throw TaskNotFoundError for non-existent tasks", () => {
    const a = createTask({ title: "A" }, db);
    expect(() => addDependency(a.id, "non-existent", db)).toThrow(
      TaskNotFoundError,
    );
  });
});

describe("task_list_id support", () => {
  it("should create task with task_list_id", () => {
    const taskList = createTaskList({ name: "Dev Tasks", slug: "dev-tasks" }, db);
    const task = createTask({ title: "Task in list", task_list_id: taskList.id }, db);
    expect(task.task_list_id).toBe(taskList.id);
  });

  it("should create task without task_list_id (default null)", () => {
    const task = createTask({ title: "Task without list" }, db);
    expect(task.task_list_id).toBeNull();
  });

  it("should filter tasks by task_list_id", () => {
    const list1 = createTaskList({ name: "List One", slug: "list-one" }, db);
    const list2 = createTaskList({ name: "List Two", slug: "list-two" }, db);
    createTask({ title: "Task in list 1", task_list_id: list1.id }, db);
    createTask({ title: "Task in list 2", task_list_id: list2.id }, db);
    createTask({ title: "Task with no list" }, db);

    const list1Tasks = listTasks({ task_list_id: list1.id }, db);
    expect(list1Tasks).toHaveLength(1);
    expect(list1Tasks[0]!.title).toBe("Task in list 1");

    const list2Tasks = listTasks({ task_list_id: list2.id }, db);
    expect(list2Tasks).toHaveLength(1);
    expect(list2Tasks[0]!.title).toBe("Task in list 2");
  });

  it("should update task_list_id", () => {
    const task = createTask({ title: "Task to assign" }, db);
    expect(task.task_list_id).toBeNull();

    const taskList = createTaskList({ name: "Target List", slug: "target-list" }, db);
    const updated = updateTask(task.id, { version: task.version, task_list_id: taskList.id }, db);
    expect(updated.task_list_id).toBe(taskList.id);
  });

  it("should move task between task lists", () => {
    const list1 = createTaskList({ name: "List A", slug: "list-a" }, db);
    const list2 = createTaskList({ name: "List B", slug: "list-b" }, db);
    const task = createTask({ title: "Movable task", task_list_id: list1.id }, db);
    expect(task.task_list_id).toBe(list1.id);

    const moved = updateTask(task.id, { version: task.version, task_list_id: list2.id }, db);
    expect(moved.task_list_id).toBe(list2.id);

    // Verify it no longer appears in list1
    const list1Tasks = listTasks({ task_list_id: list1.id }, db);
    expect(list1Tasks).toHaveLength(0);

    // Verify it appears in list2
    const list2Tasks = listTasks({ task_list_id: list2.id }, db);
    expect(list2Tasks).toHaveLength(1);
    expect(list2Tasks[0]!.id).toBe(task.id);
  });

  it("should set task_list_id to null when task list is deleted", () => {
    const taskList = createTaskList({ name: "Doomed List", slug: "doomed-list" }, db);
    const task = createTask({ title: "Orphaned task", task_list_id: taskList.id }, db);
    expect(task.task_list_id).toBe(taskList.id);

    deleteTaskList(taskList.id, db);
    const orphaned = getTask(task.id, db);
    expect(orphaned).not.toBeNull();
    expect(orphaned!.task_list_id).toBeNull();
  });

  it("should remove task from list by setting task_list_id to null", () => {
    const taskList = createTaskList({ name: "Removable List", slug: "removable-list" }, db);
    const task = createTask({ title: "Removable task", task_list_id: taskList.id }, db);
    expect(task.task_list_id).toBe(taskList.id);

    const updated = updateTask(task.id, { version: task.version, task_list_id: null as unknown as string }, db);
    expect(updated.task_list_id).toBeNull();

    const listTasks_ = listTasks({ task_list_id: taskList.id }, db);
    expect(listTasks_).toHaveLength(0);
  });
});

describe("short_id and task prefix", () => {
  it("should generate short_id from project prefix", () => {
    const project = createProject({ name: "Alpha Project", path: "/alpha" }, db);
    const task = createTask({ title: "Fix login bug", project_id: project.id }, db);
    expect(task.short_id).not.toBeNull();
    expect(task.short_id).toMatch(/^[A-Z]+-\d{5}$/);
    expect(task.title).toContain("Fix login bug");
    expect(task.title).toStartWith(task.short_id!);
  });

  it("should increment counter for each task", () => {
    const project = createProject({ name: "Beta", path: "/beta" }, db);
    const t1 = createTask({ title: "Task 1", project_id: project.id }, db);
    const t2 = createTask({ title: "Task 2", project_id: project.id }, db);
    const t3 = createTask({ title: "Task 3", project_id: project.id }, db);
    expect(t1.short_id).toMatch(/-00001$/);
    expect(t2.short_id).toMatch(/-00002$/);
    expect(t3.short_id).toMatch(/-00003$/);
  });

  it("should have null short_id for tasks without project", () => {
    const task = createTask({ title: "Standalone task" }, db);
    expect(task.short_id).toBeNull();
    expect(task.title).toBe("Standalone task");
  });

  it("should use custom prefix if provided", () => {
    const project = createProject({ name: "My App", path: "/app", task_prefix: "APP" }, db);
    const task = createTask({ title: "Build UI", project_id: project.id }, db);
    expect(task.short_id).toBe("APP-00001");
    expect(task.title).toBe("APP-00001: Build UI");
  });

  it("should auto-generate unique prefix from project name", () => {
    const p1 = createProject({ name: "Alpha Beta", path: "/ab1" }, db);
    const p2 = createProject({ name: "Alpha Bravo", path: "/ab2" }, db);
    expect(p1.task_prefix).toBeTruthy();
    expect(p2.task_prefix).toBeTruthy();
    expect(p1.task_prefix).not.toBe(p2.task_prefix);
  });

  it("should prepend short_id to title", () => {
    const project = createProject({ name: "Test", path: "/test", task_prefix: "TST" }, db);
    const task = createTask({ title: "Original title", project_id: project.id }, db);
    expect(task.title).toBe("TST-00001: Original title");
  });
});

describe("cloneTask", () => {
  it("should clone a task with no overrides", () => {
    const source = createTask({
      title: "Original",
      description: "A description",
      priority: "high",
      assigned_to: "claude",
      tags: ["bug", "urgent"],
      metadata: { key: "value" },
    }, db);

    const clone = cloneTask(source.id, undefined, db);
    expect(clone.id).not.toBe(source.id);
    expect(clone.title).toBe("Original");
    expect(clone.description).toBe("A description");
    expect(clone.priority).toBe("high");
    expect(clone.assigned_to).toBe("claude");
    expect(clone.tags).toEqual(["bug", "urgent"]);
    expect(clone.metadata).toEqual({ key: "value" });
    expect(clone.status).toBe("pending");
    expect(clone.version).toBe(1);
  });

  it("should clone with title override", () => {
    const source = createTask({ title: "Original" }, db);
    const clone = cloneTask(source.id, { title: "Cloned title" }, db);
    expect(clone.title).toBe("Cloned title");
  });

  it("should clone with priority override", () => {
    const source = createTask({ title: "Task", priority: "low" }, db);
    const clone = cloneTask(source.id, { priority: "critical" }, db);
    expect(clone.priority).toBe("critical");
  });

  it("should clone with project_id override", () => {
    const p1 = createProject({ name: "Project A", path: "/pa" }, db);
    const p2 = createProject({ name: "Project B", path: "/pb" }, db);
    const source = createTask({ title: "Task", project_id: p1.id }, db);
    const clone = cloneTask(source.id, { project_id: p2.id }, db);
    expect(clone.project_id).toBe(p2.id);
  });

  it("should throw TaskNotFoundError for non-existent task", () => {
    expect(() => cloneTask("non-existent", undefined, db)).toThrow(TaskNotFoundError);
  });

  it("should reset status to pending by default", () => {
    const source = createTask({ title: "Task", status: "in_progress" }, db);
    const clone = cloneTask(source.id, undefined, db);
    expect(clone.status).toBe("pending");
  });

  it("should create an independent copy with new ID", () => {
    const source = createTask({ title: "Original" }, db);
    const clone = cloneTask(source.id, undefined, db);
    expect(clone.id).not.toBe(source.id);

    // Deleting the clone should not affect the source
    deleteTask(clone.id, db);
    const original = getTask(source.id, db);
    expect(original).not.toBeNull();
    expect(original!.title).toBe("Original");
  });
});

describe("bulkUpdateTasks", () => {
  it("should bulk update status on multiple tasks", () => {
    const t1 = createTask({ title: "Task 1" }, db);
    const t2 = createTask({ title: "Task 2" }, db);
    const t3 = createTask({ title: "Task 3" }, db);

    const result = bulkUpdateTasks([t1.id, t2.id, t3.id], { status: "in_progress" }, db);
    expect(result.updated).toBe(3);
    expect(result.failed).toHaveLength(0);

    expect(getTask(t1.id, db)!.status).toBe("in_progress");
    expect(getTask(t2.id, db)!.status).toBe("in_progress");
    expect(getTask(t3.id, db)!.status).toBe("in_progress");
  });

  it("should handle partial failure with invalid IDs", () => {
    const t1 = createTask({ title: "Task 1" }, db);
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const result = bulkUpdateTasks([t1.id, fakeId], { status: "completed" }, db);
    expect(result.updated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.id).toBe(fakeId);
    expect(result.failed[0]!.error).toBe("Task not found");

    expect(getTask(t1.id, db)!.status).toBe("completed");
  });

  it("should return zero updated for empty array", () => {
    const result = bulkUpdateTasks([], { status: "in_progress" }, db);
    expect(result.updated).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it("should bulk update priority", () => {
    const t1 = createTask({ title: "Task 1" }, db);
    const t2 = createTask({ title: "Task 2" }, db);

    const result = bulkUpdateTasks([t1.id, t2.id], { priority: "critical" }, db);
    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(0);

    expect(getTask(t1.id, db)!.priority).toBe("critical");
    expect(getTask(t2.id, db)!.priority).toBe("critical");
  });

  it("should bulk update tags", () => {
    const t1 = createTask({ title: "Task 1" }, db);
    const t2 = createTask({ title: "Task 2" }, db);

    const result = bulkUpdateTasks([t1.id, t2.id], { tags: ["urgent", "backend"] }, db);
    expect(result.updated).toBe(2);

    expect(getTask(t1.id, db)!.tags).toEqual(["urgent", "backend"]);
    expect(getTask(t2.id, db)!.tags).toEqual(["urgent", "backend"]);
  });

  it("should bulk update assigned_to", () => {
    const t1 = createTask({ title: "Task 1" }, db);
    const t2 = createTask({ title: "Task 2" }, db);

    const result = bulkUpdateTasks([t1.id, t2.id], { assigned_to: "agent-123" }, db);
    expect(result.updated).toBe(2);

    expect(getTask(t1.id, db)!.assigned_to).toBe("agent-123");
    expect(getTask(t2.id, db)!.assigned_to).toBe("agent-123");
  });
});

describe("getTaskStats", () => {
  it("should return all zeros with no tasks", () => {
    const stats = getTaskStats(undefined, db);
    expect(stats.total).toBe(0);
    expect(stats.by_status).toEqual({});
    expect(stats.by_priority).toEqual({});
    expect(stats.by_agent).toEqual({});
    expect(stats.completion_rate).toBe(0);
  });

  it("should return correct counts with mixed statuses", () => {
    createTask({ title: "Task 1" }, db); // pending by default
    createTask({ title: "Task 2" }, db);
    const t3 = createTask({ title: "Task 3" }, db);
    updateTask(t3.id, { status: "in_progress", version: t3.version }, db);
    const t4 = createTask({ title: "Task 4" }, db);
    updateTask(t4.id, { status: "completed", version: t4.version }, db);

    const stats = getTaskStats(undefined, db);
    expect(stats.total).toBe(4);
    expect(stats.by_status["pending"]).toBe(2);
    expect(stats.by_status["in_progress"]).toBe(1);
    expect(stats.by_status["completed"]).toBe(1);
  });

  it("should filter by project_id", () => {
    const proj = createProject({ name: "Test Project", path: "/tmp/test-stats" }, db);
    createTask({ title: "In project", project_id: proj.id }, db);
    createTask({ title: "No project" }, db);

    const stats = getTaskStats({ project_id: proj.id }, db);
    expect(stats.total).toBe(1);
    expect(stats.by_status["pending"]).toBe(1);
  });

  it("should calculate completion rate correctly", () => {
    const t1 = createTask({ title: "Task 1" }, db);
    updateTask(t1.id, { status: "completed", version: t1.version }, db);
    const t2 = createTask({ title: "Task 2" }, db);
    updateTask(t2.id, { status: "completed", version: t2.version }, db);
    createTask({ title: "Task 3" }, db); // pending
    createTask({ title: "Task 4" }, db); // pending

    const stats = getTaskStats(undefined, db);
    expect(stats.total).toBe(4);
    expect(stats.completion_rate).toBe(50);
  });

  it("should count by priority", () => {
    createTask({ title: "Low", priority: "low" }, db);
    createTask({ title: "High 1", priority: "high" }, db);
    createTask({ title: "High 2", priority: "high" }, db);
    createTask({ title: "Critical", priority: "critical" }, db);

    const stats = getTaskStats(undefined, db);
    expect(stats.by_priority["low"]).toBe(1);
    expect(stats.by_priority["high"]).toBe(2);
    expect(stats.by_priority["critical"]).toBe(1);
  });

  it("should count by agent", () => {
    createTask({ title: "Agent A task", assigned_to: "agent-a" }, db);
    createTask({ title: "Agent A task 2", assigned_to: "agent-a" }, db);
    createTask({ title: "Agent B task", assigned_to: "agent-b" }, db);
    createTask({ title: "Unassigned" }, db);

    const stats = getTaskStats(undefined, db);
    expect(stats.by_agent["agent-a"]).toBe(2);
    expect(stats.by_agent["agent-b"]).toBe(1);
  });
});

describe("getTaskGraph", () => {
  it("should return empty arrays for task with no dependencies", () => {
    const task = createTask({ title: "Standalone" }, db);
    const graph = getTaskGraph(task.id, "both", db);

    expect(graph.task.id).toBe(task.id);
    expect(graph.task.title).toBe("Standalone");
    expect(graph.depends_on).toEqual([]);
    expect(graph.blocks).toEqual([]);
  });

  it("should return one level of dependencies", () => {
    const dep = createTask({ title: "Dependency" }, db);
    const task = createTask({ title: "Main task" }, db);
    addDependency(task.id, dep.id, db);

    const graph = getTaskGraph(task.id, "both", db);

    expect(graph.depends_on).toHaveLength(1);
    expect(graph.depends_on[0]!.task.id).toBe(dep.id);
    expect(graph.depends_on[0]!.task.title).toBe("Dependency");
    expect(graph.blocks).toEqual([]);
  });

  it("should return multi-level chain (A depends on B depends on C)", () => {
    const c = createTask({ title: "Task C" }, db);
    const b = createTask({ title: "Task B" }, db);
    const a = createTask({ title: "Task A" }, db);
    addDependency(a.id, b.id, db);
    addDependency(b.id, c.id, db);

    const graph = getTaskGraph(a.id, "both", db);

    expect(graph.depends_on).toHaveLength(1);
    expect(graph.depends_on[0]!.task.id).toBe(b.id);
    expect(graph.depends_on[0]!.depends_on).toHaveLength(1);
    expect(graph.depends_on[0]!.depends_on[0]!.task.id).toBe(c.id);
  });

  it("should set is_blocked true when dependency is not completed", () => {
    const dep = createTask({ title: "Blocker" }, db);
    const task = createTask({ title: "Blocked task" }, db);
    addDependency(task.id, dep.id, db);

    const graph = getTaskGraph(task.id, "both", db);

    expect(graph.task.is_blocked).toBe(true);
    expect(graph.depends_on[0]!.task.is_blocked).toBe(false);
  });

  it("should set is_blocked false when all dependencies are completed", () => {
    const dep = createTask({ title: "Done dep" }, db);
    updateTask(dep.id, { status: "completed", version: dep.version }, db);
    const task = createTask({ title: "Unblocked task" }, db);
    addDependency(task.id, dep.id, db);

    const graph = getTaskGraph(task.id, "both", db);

    expect(graph.task.is_blocked).toBe(false);
  });

  it("should only return depends_on when direction is 'up'", () => {
    const dep = createTask({ title: "Upstream" }, db);
    const task = createTask({ title: "Middle" }, db);
    const blocker = createTask({ title: "Downstream" }, db);
    addDependency(task.id, dep.id, db);
    addDependency(blocker.id, task.id, db);

    const graph = getTaskGraph(task.id, "up", db);

    expect(graph.depends_on).toHaveLength(1);
    expect(graph.depends_on[0]!.task.id).toBe(dep.id);
    expect(graph.blocks).toEqual([]);
  });

  it("should only return blocks when direction is 'down'", () => {
    const dep = createTask({ title: "Upstream" }, db);
    const task = createTask({ title: "Middle" }, db);
    const blocker = createTask({ title: "Downstream" }, db);
    addDependency(task.id, dep.id, db);
    addDependency(blocker.id, task.id, db);

    const graph = getTaskGraph(task.id, "down", db);

    expect(graph.depends_on).toEqual([]);
    expect(graph.blocks).toHaveLength(1);
    expect(graph.blocks[0]!.task.id).toBe(blocker.id);
  });
});

describe("bulkCreateTasks", () => {
  it("should create multiple tasks at once", () => {
    const result = bulkCreateTasks([
      { title: "Task A" },
      { title: "Task B" },
      { title: "Task C" },
    ], db);

    expect(result.created).toHaveLength(3);
    expect(result.created[0]!.title).toBe("Task A");
    expect(result.created[1]!.title).toBe("Task B");
    expect(result.created[2]!.title).toBe("Task C");

    // Verify tasks exist in database
    const tasks = listTasks({}, db);
    expect(tasks).toHaveLength(3);
  });

  it("should wire up dependencies via temp_ids", () => {
    const result = bulkCreateTasks([
      { temp_id: "t1", title: "Foundation" },
      { temp_id: "t2", title: "Walls", depends_on_temp_ids: ["t1"] },
      { temp_id: "t3", title: "Roof", depends_on_temp_ids: ["t2"] },
    ], db);

    expect(result.created).toHaveLength(3);

    // Verify dependency chain: t3 depends on t2, t2 depends on t1
    const wallsRelations = getTaskWithRelations(result.created[1]!.id, db)!;
    expect(wallsRelations.dependencies).toHaveLength(1);
    expect(wallsRelations.dependencies[0]!.id).toBe(result.created[0]!.id);

    const roofRelations = getTaskWithRelations(result.created[2]!.id, db)!;
    expect(roofRelations.dependencies).toHaveLength(1);
    expect(roofRelations.dependencies[0]!.id).toBe(result.created[1]!.id);
  });

  it("should apply shared project_id to all tasks", () => {
    const project = createProject({ name: "Bulk Project", path: "/tmp/bulk" }, db);

    const result = bulkCreateTasks([
      { title: "Task A", project_id: project.id },
      { title: "Task B", project_id: project.id },
    ], db);

    expect(result.created).toHaveLength(2);
    // All tasks should have the project and short_ids
    expect(result.created[0]!.short_id).not.toBeNull();
    expect(result.created[1]!.short_id).not.toBeNull();

    const taskA = getTask(result.created[0]!.id, db)!;
    const taskB = getTask(result.created[1]!.id, db)!;
    expect(taskA.project_id).toBe(project.id);
    expect(taskB.project_id).toBe(project.id);
  });

  it("should return empty array for empty input", () => {
    const result = bulkCreateTasks([], db);
    expect(result.created).toHaveLength(0);
  });

  it("should return temp_id mappings in created results", () => {
    const result = bulkCreateTasks([
      { temp_id: "a", title: "Alpha" },
      { title: "Beta" },
      { temp_id: "c", title: "Gamma" },
    ], db);

    expect(result.created[0]!.temp_id).toBe("a");
    expect(result.created[1]!.temp_id).toBeNull();
    expect(result.created[2]!.temp_id).toBe("c");
  });

  it("should be atomic — roll back all on failure from cyclic deps", () => {
    // Cyclic dependencies should cause the transaction to throw and roll back all task creations
    expect(() => {
      bulkCreateTasks([
        { temp_id: "t1", title: "Task 1", depends_on_temp_ids: ["t2"] },
        { temp_id: "t2", title: "Task 2", depends_on_temp_ids: ["t1"] },
      ], db);
    }).toThrow();

    // All tasks should be rolled back — none should exist
    const tasks = listTasks({}, db);
    expect(tasks).toHaveLength(0);
  });
});

describe("moveTask", () => {
  it("should move task to a different task_list", () => {
    const list1 = createTaskList({ name: "List A", slug: "list-a" }, db);
    const list2 = createTaskList({ name: "List B", slug: "list-b" }, db);
    const task = createTask({ title: "Movable", task_list_id: list1.id }, db);

    const moved = moveTask(task.id, { task_list_id: list2.id }, db);
    expect(moved.task_list_id).toBe(list2.id);

    const list1Tasks = listTasks({ task_list_id: list1.id }, db);
    expect(list1Tasks).toHaveLength(0);
    const list2Tasks = listTasks({ task_list_id: list2.id }, db);
    expect(list2Tasks).toHaveLength(1);
  });

  it("should move task to a different project", () => {
    const p1 = createProject({ name: "Project A", path: "/pa" }, db);
    const p2 = createProject({ name: "Project B", path: "/pb" }, db);
    const task = createTask({ title: "Task", project_id: p1.id }, db);

    const moved = moveTask(task.id, { project_id: p2.id }, db);
    expect(moved.project_id).toBe(p2.id);
  });

  it("should move task to a different plan", () => {
    const plan1 = createPlan({ name: "Plan A" }, db);
    const plan2 = createPlan({ name: "Plan B" }, db);
    const task = createTask({ title: "Task", plan_id: plan1.id }, db);

    const moved = moveTask(task.id, { plan_id: plan2.id }, db);
    expect(moved.plan_id).toBe(plan2.id);
  });

  it("should throw TaskNotFoundError for non-existent task", () => {
    expect(() => moveTask("non-existent", { task_list_id: "some-id" }, db)).toThrow(TaskNotFoundError);
  });

  it("should unset project_id with null", () => {
    const project = createProject({ name: "Test", path: "/test-move" }, db);
    const task = createTask({ title: "Task", project_id: project.id }, db);

    const moved = moveTask(task.id, { project_id: null }, db);
    expect(moved.project_id).toBeNull();
  });

  it("should increment version after move", () => {
    const list = createTaskList({ name: "Target", slug: "target" }, db);
    const task = createTask({ title: "Task" }, db);
    expect(task.version).toBe(1);

    const moved = moveTask(task.id, { task_list_id: list.id }, db);
    expect(moved.version).toBe(2);
  });
});
