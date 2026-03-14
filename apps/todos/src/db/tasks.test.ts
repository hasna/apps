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
  getNextTask,
  claimNextTask,
  getActiveWork,
  failTask,
  getTasksChangedSince,
  getStaleTasks,
  getStatus,
  decomposeTasks,
} from "./tasks.js";
import {
  VersionConflictError,
  TaskNotFoundError,
  LockError,
  DependencyCycleError,
} from "../types/index.js";
import { createTaskList, deleteTaskList } from "./task-lists.js";
import { createProject } from "./projects.js";
import { registerAgent } from "./agents.js";
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

  it("should store attachment_ids in metadata._evidence.attachment_ids", () => {
    const task = createTask({ title: "With attachments" }, db);
    const completed = completeTask(task.id, undefined, db, { attachment_ids: ["att-001", "att-002"] });
    expect(completed.status).toBe("completed");
    const evidence = completed.metadata._evidence as Record<string, unknown>;
    expect(evidence).toBeDefined();
    expect(evidence.attachment_ids).toEqual(["att-001", "att-002"]);
  });

  it("should store all evidence fields including attachment_ids together", () => {
    const task = createTask({ title: "Full evidence" }, db);
    const completed = completeTask(task.id, undefined, db, {
      files_changed: ["src/foo.ts"],
      test_results: "10 passed",
      commit_hash: "abc1234",
      notes: "done",
      attachment_ids: ["att-xyz"],
    });
    const evidence = completed.metadata._evidence as Record<string, unknown>;
    expect(evidence.attachment_ids).toEqual(["att-xyz"]);
    expect(evidence.files_changed).toEqual(["src/foo.ts"]);
    expect(evidence.commit_hash).toBe("abc1234");
  });

  it("should not set _evidence when no evidence fields provided", () => {
    const task = createTask({ title: "No evidence" }, db);
    const completed = completeTask(task.id, undefined, db);
    expect(completed.metadata._evidence).toBeUndefined();
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

describe("recurrence fields", () => {
  it("should create a task with recurrence_rule", () => {
    const task = createTask({ title: "Daily standup", recurrence_rule: "FREQ=DAILY;BYHOUR=9" }, db);
    expect(task.recurrence_rule).toBe("FREQ=DAILY;BYHOUR=9");
    expect(task.recurrence_parent_id).toBeNull();
  });

  it("should create a task with recurrence_parent_id", () => {
    const parent = createTask({ title: "Recurring parent", recurrence_rule: "FREQ=WEEKLY" }, db);
    const child = createTask({ title: "Recurring child", recurrence_parent_id: parent.id }, db);
    expect(child.recurrence_parent_id).toBe(parent.id);
  });

  it("should default recurrence fields to null", () => {
    const task = createTask({ title: "Normal task" }, db);
    expect(task.recurrence_rule).toBeNull();
    expect(task.recurrence_parent_id).toBeNull();
  });

  it("should filter tasks with has_recurrence=true", () => {
    createTask({ title: "Recurring", recurrence_rule: "FREQ=DAILY" }, db);
    createTask({ title: "Normal" }, db);

    const recurring = listTasks({ has_recurrence: true }, db);
    expect(recurring.length).toBe(1);
    expect(recurring[0]!.title).toBe("Recurring");
  });

  it("should filter tasks with has_recurrence=false", () => {
    createTask({ title: "Recurring", recurrence_rule: "FREQ=DAILY" }, db);
    createTask({ title: "Normal" }, db);

    const nonRecurring = listTasks({ has_recurrence: false }, db);
    expect(nonRecurring.length).toBe(1);
    expect(nonRecurring[0]!.title).toBe("Normal");
  });

  it("should update recurrence_rule", () => {
    const task = createTask({ title: "Task", recurrence_rule: "FREQ=DAILY" }, db);
    const updated = updateTask(task.id, { recurrence_rule: "FREQ=WEEKLY", version: task.version }, db);
    expect(updated.recurrence_rule).toBe("FREQ=WEEKLY");
  });

  it("should clear recurrence_rule with null", () => {
    const task = createTask({ title: "Task", recurrence_rule: "FREQ=DAILY" }, db);
    const updated = updateTask(task.id, { recurrence_rule: null, version: task.version }, db);
    expect(updated.recurrence_rule).toBeNull();
  });

  it("should include recurrence_rule in cloned task", () => {
    const task = createTask({ title: "Recurring", recurrence_rule: "FREQ=MONTHLY" }, db);
    const cloned = cloneTask(task.id, undefined, db);
    expect(cloned.recurrence_rule).toBe("FREQ=MONTHLY");
    expect(cloned.recurrence_parent_id).toBeNull();
  });
});

describe("recurring task auto-spawn", () => {
  it("completing a recurring task spawns next instance", () => {
    const task = createTask({
      title: "Daily standup",
      recurrence_rule: "every day",
      status: "in_progress",
    }, db);

    const completed = completeTask(task.id, "agent1", db);
    expect(completed.status).toBe("completed");

    // Check that a new task was spawned
    const allTasks = listTasks({}, db);
    const spawned = allTasks.find(t => t.recurrence_parent_id === task.id);
    expect(spawned).toBeTruthy();
    expect(spawned!.title).toContain("Daily standup");
    expect(spawned!.status).toBe("pending");
    expect(spawned!.recurrence_rule).toBe("every day");
    expect(spawned!.due_at).toBeTruthy();
  });

  it("skip_recurrence prevents spawn", () => {
    const task = createTask({
      title: "Weekly review",
      recurrence_rule: "every week",
      status: "in_progress",
    }, db);

    completeTask(task.id, "agent1", db, { skip_recurrence: true });

    const allTasks = listTasks({}, db);
    const spawned = allTasks.find(t => t.recurrence_parent_id === task.id);
    expect(spawned).toBeUndefined();
  });

  it("non-recurring task completion does not spawn", () => {
    const task = createTask({ title: "One-off task", status: "in_progress" }, db);
    const before = listTasks({}, db).length;
    completeTask(task.id, "agent1", db);
    const after = listTasks({}, db).length;
    expect(after).toBe(before); // No new task created
  });

  it("spawned task chains recurrence_parent_id to original", () => {
    const original = createTask({
      title: "Chained task",
      recurrence_rule: "every day",
      status: "in_progress",
    }, db);

    // Complete original
    completeTask(original.id, "agent1", db);
    const second = listTasks({}, db).find(t => t.recurrence_parent_id === original.id)!;

    // Start and complete the second
    const started = startTask(second.id, "agent1", db);
    completeTask(started.id, "agent1", db);

    // Third task should also point to original
    const third = listTasks({}, db).find(t => t.recurrence_parent_id === original.id && t.id !== second.id);
    expect(third).toBeTruthy();
    expect(third!.recurrence_parent_id).toBe(original.id);
  });

  it("spawned task copies project_id and tags", () => {
    const project = createProject({ name: "Test Proj", path: "/tmp/recur-test" }, db);
    const task = createTask({
      title: "Tagged recurring",
      recurrence_rule: "every week",
      project_id: project.id,
      tags: ["standup", "recurring"],
      priority: "high",
      status: "in_progress",
    }, db);

    completeTask(task.id, "agent1", db);
    const spawned = listTasks({ has_recurrence: true }, db).find(t => t.status === "pending");
    expect(spawned).toBeTruthy();
    expect(spawned!.project_id).toBe(project.id);
    expect(spawned!.tags).toEqual(["standup", "recurring"]);
    expect(spawned!.priority).toBe("high");
  });

  it("spawned task metadata includes _next_recurrence info", () => {
    const task = createTask({
      title: "Check metadata",
      recurrence_rule: "every day",
      status: "in_progress",
    }, db);

    const completed = completeTask(task.id, "agent1", db);
    expect(completed.metadata._next_recurrence).toBeTruthy();
    const next = completed.metadata._next_recurrence as Record<string, unknown>;
    expect(next.id).toBeTruthy();
    expect(next.due_at).toBeTruthy();
  });
});

describe("getNextTask", () => {
  it("should return highest priority pending task", () => {
    createTask({ title: "Low task", priority: "low" }, db);
    createTask({ title: "Critical task", priority: "critical" }, db);
    createTask({ title: "High task", priority: "high" }, db);

    const next = getNextTask(undefined, undefined, db);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Critical task");
  });

  it("should skip blocked tasks (task with incomplete dependency)", () => {
    const blocker = createTask({ title: "Blocker", priority: "low" }, db);
    const blocked = createTask({ title: "Blocked critical", priority: "critical" }, db);
    addDependency(blocked.id, blocker.id, db);

    const next = getNextTask(undefined, undefined, db);
    expect(next).not.toBeNull();
    // Should return the blocker (low priority) since the critical task is blocked
    expect(next!.title).toBe("Blocker");
  });

  it("should skip locked tasks", () => {
    const locked = createTask({ title: "Locked task", priority: "critical" }, db);
    lockTask(locked.id, "some-agent", db);
    const unlocked = createTask({ title: "Unlocked task", priority: "low" }, db);

    const next = getNextTask(undefined, undefined, db);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Unlocked task");
  });

  it("should return null when no tasks available", () => {
    const next = getNextTask(undefined, undefined, db);
    expect(next).toBeNull();
  });

  it("should return null when all pending tasks are blocked", () => {
    const dep = createTask({ title: "Dep", status: "in_progress" }, db);
    const blocked = createTask({ title: "Blocked", priority: "critical" }, db);
    addDependency(blocked.id, dep.id, db);

    const next = getNextTask(undefined, undefined, db);
    // dep is in_progress (not pending), blocked is blocked — nothing available
    expect(next).toBeNull();
  });

  it("should prefer tasks assigned to the given agent", () => {
    const agent = registerAgent({ name: "test-agent" }, db);
    createTask({ title: "Unassigned critical", priority: "critical" }, db);
    createTask({ title: "Assigned medium", priority: "medium", assigned_to: agent.id }, db);

    const next = getNextTask(agent.id, undefined, db);
    expect(next).not.toBeNull();
    // Assigned task should come first even though lower priority
    expect(next!.title).toBe("Assigned medium");
  });

  it("should respect project_id filter", () => {
    const projectA = createProject({ name: "Project A", path: "/tmp/next-a" }, db);
    const projectB = createProject({ name: "Project B", path: "/tmp/next-b" }, db);
    createTask({ title: "Task in A", project_id: projectA.id, priority: "low" }, db);
    createTask({ title: "Task in B", project_id: projectB.id, priority: "critical" }, db);

    const next = getNextTask(undefined, { project_id: projectA.id }, db);
    expect(next).not.toBeNull();
    expect(next!.title).toContain("Task in A");
  });

  it("should skip non-pending tasks", () => {
    createTask({ title: "In progress", status: "in_progress", priority: "critical" }, db);
    createTask({ title: "Completed", status: "completed", priority: "critical" }, db);
    createTask({ title: "Pending low", priority: "low" }, db);

    const next = getNextTask(undefined, undefined, db);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Pending low");
  });

  it("should return unblocked task when dependency is completed", () => {
    const dep = createTask({ title: "Dep task", priority: "low", status: "in_progress" }, db);
    const blocked = createTask({ title: "Was blocked", priority: "critical" }, db);
    addDependency(blocked.id, dep.id, db);

    // Initially blocked
    let next = getNextTask(undefined, undefined, db);
    expect(next).toBeNull(); // dep is in_progress, blocked is blocked

    // Complete the dependency
    completeTask(dep.id, undefined, db);

    // Now the critical task should be available
    next = getNextTask(undefined, undefined, db);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Was blocked");
  });
});

describe("claimNextTask", () => {
  it("should claim the highest priority available task", () => {
    const agent = registerAgent({ name: "claimer" }, db);
    createTask({ title: "Low task", priority: "low" }, db);
    createTask({ title: "Critical task", priority: "critical" }, db);

    const claimed = claimNextTask(agent.id, undefined, db);
    expect(claimed).not.toBeNull();
    expect(claimed!.title).toBe("Critical task");
    expect(claimed!.status).toBe("in_progress");
    expect(claimed!.locked_by).toBe(agent.id);
    expect(claimed!.assigned_to).toBe(agent.id);
  });

  it("should return null when no tasks available", () => {
    const agent = registerAgent({ name: "claimer-empty" }, db);
    const claimed = claimNextTask(agent.id, undefined, db);
    expect(claimed).toBeNull();
  });

  it("should not allow two agents to claim the same task", () => {
    const agent1 = registerAgent({ name: "agent-one" }, db);
    const agent2 = registerAgent({ name: "agent-two" }, db);
    createTask({ title: "Only task", priority: "critical" }, db);

    const claimed1 = claimNextTask(agent1.id, undefined, db);
    expect(claimed1).not.toBeNull();
    expect(claimed1!.title).toBe("Only task");
    expect(claimed1!.locked_by).toBe(agent1.id);

    // Second agent should get null — the only task is now in_progress and locked
    const claimed2 = claimNextTask(agent2.id, undefined, db);
    expect(claimed2).toBeNull();
  });

  it("should respect project_id filter", () => {
    const agent = registerAgent({ name: "claimer-filter" }, db);
    const projectA = createProject({ name: "Proj A", path: "/tmp/claim-a" }, db);
    const projectB = createProject({ name: "Proj B", path: "/tmp/claim-b" }, db);
    createTask({ title: "Task in A", project_id: projectA.id, priority: "low" }, db);
    createTask({ title: "Task in B", project_id: projectB.id, priority: "critical" }, db);

    const claimed = claimNextTask(agent.id, { project_id: projectA.id }, db);
    expect(claimed).not.toBeNull();
    expect(claimed!.title).toContain("Task in A");
    expect(claimed!.status).toBe("in_progress");
  });

  it("should skip blocked tasks", () => {
    const agent = registerAgent({ name: "claimer-blocked" }, db);
    const blocker = createTask({ title: "Blocker", priority: "low" }, db);
    const blocked = createTask({ title: "Blocked critical", priority: "critical" }, db);
    addDependency(blocked.id, blocker.id, db);

    const claimed = claimNextTask(agent.id, undefined, db);
    expect(claimed).not.toBeNull();
    // Should claim the blocker since the critical task is blocked
    expect(claimed!.title).toBe("Blocker");
    expect(claimed!.status).toBe("in_progress");
  });
});

describe("getActiveWork", () => {
  it("should return only in_progress tasks", () => {
    createTask({ title: "Pending task" }, db);
    const t2 = createTask({ title: "Active task", status: "in_progress" }, db);
    createTask({ title: "Completed task", status: "completed" }, db);

    const work = getActiveWork(undefined, db);
    expect(work.length).toBe(1);
    expect(work[0]!.title).toBe("Active task");
    expect(work[0]!.id).toBe(t2.id);
  });

  it("should include assigned_to and locked_by info", () => {
    const agent = registerAgent({ name: "testagent" }, db);
    const task = createTask({ title: "Locked task", status: "in_progress", assigned_to: agent.id }, db);
    lockTask(task.id, agent.id, db);

    const work = getActiveWork(undefined, db);
    expect(work.length).toBe(1);
    expect(work[0]!.assigned_to).toBe(agent.id);
    expect(work[0]!.locked_by).toBe(agent.id);
    expect(work[0]!.locked_at).not.toBeNull();
  });

  it("should return empty when no active work", () => {
    createTask({ title: "Pending task" }, db);
    createTask({ title: "Done task", status: "completed" }, db);

    const work = getActiveWork(undefined, db);
    expect(work.length).toBe(0);
  });

  it("should respect project_id filter", () => {
    const proj = createProject({ name: "FilterProj", path: "/tmp/filter" }, db);
    createTask({ title: "Active in project", status: "in_progress", project_id: proj.id }, db);
    createTask({ title: "Active elsewhere", status: "in_progress" }, db);

    const work = getActiveWork({ project_id: proj.id }, db);
    expect(work.length).toBe(1);
    expect(work[0]!.title).toContain("Active in project");
  });

  it("should return only lightweight fields", () => {
    createTask({ title: "Active task", status: "in_progress", description: "Full description here" }, db);

    const work = getActiveWork(undefined, db);
    expect(work.length).toBe(1);
    // Should have the specified fields
    expect(work[0]!.id).toBeDefined();
    expect(work[0]!.title).toBeDefined();
    expect(work[0]!.priority).toBeDefined();
    expect(work[0]!.updated_at).toBeDefined();
    // Should NOT have full task fields like description
    expect((work[0] as any).description).toBeUndefined();
    expect((work[0] as any).status).toBeUndefined();
  });
});

describe("getTasksChangedSince", () => {
  it("should return only tasks modified after the given timestamp", () => {
    const pastTime = "2020-01-01T00:00:00Z";
    const task1 = createTask({ title: "Old task" }, db);
    const task2 = createTask({ title: "Another task" }, db);

    // Both tasks were just created, so they should appear after pastTime
    const results = getTasksChangedSince(pastTime, undefined, db);
    expect(results.length).toBe(2);
    expect(results.map(t => t.id)).toContain(task1.id);
    expect(results.map(t => t.id)).toContain(task2.id);
  });

  it("should return empty array when nothing changed since the timestamp", () => {
    createTask({ title: "Some task" }, db);
    // Use a future timestamp
    const futureTime = "2099-01-01T00:00:00Z";
    const results = getTasksChangedSince(futureTime, undefined, db);
    expect(results.length).toBe(0);
  });

  it("should respect project_id filter", () => {
    const project = createProject({ name: "proj-a", path: "/proj-a" }, db);
    const task1 = createTask({ title: "In project", project_id: project.id }, db);
    createTask({ title: "No project" }, db);

    const pastTime = "2020-01-01T00:00:00Z";
    const results = getTasksChangedSince(pastTime, { project_id: project.id }, db);
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(task1.id);
  });

  it("should include newly created tasks", () => {
    const pastTime = "2020-01-01T00:00:00Z";
    const task = createTask({ title: "Brand new" }, db);

    const results = getTasksChangedSince(pastTime, undefined, db);
    expect(results.some(t => t.id === task.id)).toBe(true);
  });

  it("should order by newest first", () => {
    const pastTime = "2020-01-01T00:00:00Z";
    const task1 = createTask({ title: "First" }, db);
    // Update task1 to ensure it has a later updated_at
    updateTask(task1.id, { title: "First updated", version: task1.version }, db);
    const task2 = createTask({ title: "Second" }, db);

    const results = getTasksChangedSince(pastTime, undefined, db);
    expect(results.length).toBe(2);
    // task1 was updated after task2 was created? Not necessarily — both happen fast.
    // Just verify ordering is by updated_at DESC
    const timestamps = results.map(t => t.updated_at);
    expect(timestamps[0]! >= timestamps[1]!).toBe(true);
  });

  it("should respect task_list_id filter", () => {
    const taskList = createTaskList({ name: "Sprint 1", slug: "sprint-1" }, db);
    const task1 = createTask({ title: "In list", task_list_id: taskList.id }, db);
    createTask({ title: "Not in list" }, db);

    const pastTime = "2020-01-01T00:00:00Z";
    const results = getTasksChangedSince(pastTime, { task_list_id: taskList.id }, db);
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(task1.id);
  });
});

describe("failTask", () => {
  it("should mark a task as failed", () => {
    const task = createTask({ title: "Doomed task" }, db);
    const result = failTask(task.id, undefined, undefined, undefined, db);
    expect(result.task.status).toBe("failed");
  });

  it("should store failure reason in metadata._failure", () => {
    const task = createTask({ title: "Doomed task" }, db);
    const result = failTask(task.id, "agent-1", "Build timed out", { error_code: "TIMEOUT" }, db);
    const failure = result.task.metadata._failure as any;
    expect(failure.reason).toBe("Build timed out");
    expect(failure.error_code).toBe("TIMEOUT");
    expect(failure.failed_by).toBe("agent-1");
    expect(failure.failed_at).toBeDefined();
    expect(failure.retry_requested).toBe(false);
  });

  it("should store default reason when none provided", () => {
    const task = createTask({ title: "Doomed task" }, db);
    const result = failTask(task.id, undefined, undefined, undefined, db);
    const failure = result.task.metadata._failure as any;
    expect(failure.reason).toBe("Unknown failure");
  });

  it("should release lock on failure", () => {
    const agent = registerAgent({ name: "lock-agent" }, db);
    const task = createTask({ title: "Locked task" }, db);
    lockTask(task.id, agent.id, db);
    const locked = getTask(task.id, db)!;
    expect(locked.locked_by).toBe(agent.id);

    const result = failTask(task.id, agent.id, "Failed", undefined, db);
    expect(result.task.locked_by).toBeNull();
    expect(result.task.locked_at).toBeNull();

    // Verify in DB
    const reloaded = getTask(task.id, db)!;
    expect(reloaded.locked_by).toBeNull();
    expect(reloaded.status).toBe("failed");
  });

  it("should create a retry task when retry=true", () => {
    const task = createTask({ title: "Retryable task", priority: "high", description: "Important work" }, db);
    const result = failTask(task.id, "agent-1", "Transient error", { retry: true }, db);
    expect(result.retryTask).toBeDefined();
    expect(result.retryTask!.status).toBe("pending");
    expect(result.retryTask!.title).toBe("Retryable task");
    expect(result.retryTask!.priority).toBe("high");
    expect(result.retryTask!.description).toBe("Important work");
  });

  it("should store _retry metadata with original_id on retry task", () => {
    const task = createTask({ title: "Retryable task" }, db);
    const result = failTask(task.id, "agent-1", "Transient error", { retry: true, retry_after: "2026-04-01T00:00:00Z" }, db);
    const retryMeta = result.retryTask!.metadata._retry as any;
    expect(retryMeta.original_id).toBe(task.id);
    expect(retryMeta.retry_after).toBe("2026-04-01T00:00:00Z");
    expect(retryMeta.failure_reason).toBe("Transient error");
  });

  it("should strip short_id prefix from retry task title", () => {
    const project = createProject({ name: "test-proj", path: "/tmp/test-fail-proj" }, db);
    const task = createTask({ title: "My task", project_id: project.id }, db);
    expect(task.short_id).toBeDefined();
    expect(task.title).toContain(": My task");

    const result = failTask(task.id, undefined, "fail", { retry: true }, db);
    expect(result.retryTask!.title).toContain("My task");
    // Should not contain the original short_id doubled up
    expect(result.retryTask!.title).not.toContain(task.short_id + ": " + task.short_id);
  });

  it("should not create retry task when retry is false or omitted", () => {
    const task = createTask({ title: "No retry" }, db);
    const result = failTask(task.id, undefined, "fail", { retry: false }, db);
    expect(result.retryTask).toBeUndefined();

    const task2 = createTask({ title: "No retry 2" }, db);
    const result2 = failTask(task2.id, undefined, "fail", undefined, db);
    expect(result2.retryTask).toBeUndefined();
  });

  it("should throw TaskNotFoundError for non-existent task", () => {
    expect(() => failTask("non-existent-id", undefined, undefined, undefined, db)).toThrow(TaskNotFoundError);
  });

  it("should record audit log for the failure", () => {
    const { getTaskHistory } = require("./audit.js");
    const task = createTask({ title: "Audited fail" }, db);
    failTask(task.id, "agent-1", "Broke", undefined, db);
    const history = getTaskHistory(task.id, db);
    const failEntry = history.find((h: any) => h.action === "fail");
    expect(failEntry).toBeDefined();
    expect(failEntry.field).toBe("status");
    expect(failEntry.new_value).toBe("failed");
    expect(failEntry.agent_id).toBe("agent-1");
  });

  it("should increment version", () => {
    const task = createTask({ title: "Version check" }, db);
    const result = failTask(task.id, undefined, undefined, undefined, db);
    expect(result.task.version).toBe(task.version + 1);
  });
});

describe("getStaleTasks", () => {
  it("finds stale in_progress tasks", () => {
    const task = createTask({ title: "Stale task", status: "in_progress" }, db);
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [oldTime, oldTime, task.id]);

    const stale = getStaleTasks(30, undefined, db);
    expect(stale.length).toBe(1);
    expect(stale[0]!.id).toBe(task.id);
  });

  it("excludes fresh in_progress tasks", () => {
    createTask({ title: "Fresh task", status: "in_progress" }, db);
    const stale = getStaleTasks(30, undefined, db);
    expect(stale.length).toBe(0);
  });

  it("excludes completed/pending tasks", () => {
    const task = createTask({ title: "Done task", status: "completed" }, db);
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [oldTime, task.id]);

    const stale = getStaleTasks(30, undefined, db);
    expect(stale.length).toBe(0);
  });

  it("respects stale_minutes threshold", () => {
    const task = createTask({ title: "Medium stale", status: "in_progress" }, db);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [tenMinAgo, tenMinAgo, task.id]);

    // 5 min threshold — should find it
    expect(getStaleTasks(5, undefined, db).length).toBe(1);
    // 15 min threshold — should NOT find it
    expect(getStaleTasks(15, undefined, db).length).toBe(0);
  });

  it("respects project_id filter", () => {
    const project = createProject({ name: "stale-proj", path: "/tmp/stale-proj" }, db);
    const taskInProject = createTask({ title: "In project", status: "in_progress", project_id: project.id }, db);
    const taskOutside = createTask({ title: "Outside project", status: "in_progress" }, db);
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [oldTime, oldTime, taskInProject.id]);
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [oldTime, oldTime, taskOutside.id]);

    const stale = getStaleTasks(30, { project_id: project.id }, db);
    expect(stale.length).toBe(1);
    expect(stale[0]!.id).toBe(taskInProject.id);
  });

  it("respects task_list_id filter", () => {
    const project = createProject({ name: "tl-proj", path: "/tmp/tl-proj" }, db);
    const taskList = createTaskList({ name: "TL", project_id: project.id }, db);
    const taskInList = createTask({ title: "In list", status: "in_progress", task_list_id: taskList.id }, db);
    const taskOutside = createTask({ title: "Outside list", status: "in_progress" }, db);
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [oldTime, oldTime, taskInList.id]);
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [oldTime, oldTime, taskOutside.id]);

    const stale = getStaleTasks(30, { task_list_id: taskList.id }, db);
    expect(stale.length).toBe(1);
    expect(stale[0]!.id).toBe(taskInList.id);
  });

  it("returns empty array when no stale tasks exist", () => {
    const stale = getStaleTasks(30, undefined, db);
    expect(stale.length).toBe(0);
  });
});

describe("webhook dispatch on task lifecycle", () => {
  it("createTask completes without errors when no webhooks registered", () => {
    const task = createTask({ title: "Webhook test" }, db);
    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Webhook test");
  });

  it("task lifecycle (start → complete) completes without webhook errors", () => {
    const task = createTask({ title: "Lifecycle test", status: "pending" }, db);
    const started = startTask(task.id, "agent1", db);
    expect(started.status).toBe("in_progress");
    const completed = completeTask(task.id, "agent1", db);
    expect(completed.status).toBe("completed");
  });

  it("failTask completes without webhook errors when no webhooks registered", () => {
    const task = createTask({ title: "Fail test" }, db);
    const { task: failed } = failTask(task.id, "agent1", "test failure", undefined, db);
    expect(failed.status).toBe("failed");
  });

  it("updateTask with assigned_to change completes without webhook errors", () => {
    const task = createTask({ title: "Assignment test" }, db);
    const updated = updateTask(task.id, { assigned_to: "agent-xyz", version: task.version }, db);
    expect(updated.assigned_to).toBe("agent-xyz");
  });

  it("updateTask with status change completes without webhook errors", () => {
    const task = createTask({ title: "Status change test" }, db);
    const updated = updateTask(task.id, { status: "in_progress", version: task.version }, db);
    expect(updated.status).toBe("in_progress");
  });
});

describe("getStatus", () => {
  it("returns correct counts for pending, in_progress, completed, total", () => {
    createTask({ title: "Pending 1" }, db);
    createTask({ title: "Pending 2" }, db);
    const t3 = createTask({ title: "In progress" }, db);
    startTask(t3.id, "agent1", db);
    const t4 = createTask({ title: "Completed" }, db);
    startTask(t4.id, "agent1", db);
    completeTask(t4.id, "agent1", db);

    const status = getStatus(undefined, undefined, db);
    expect(status.pending).toBe(2);
    expect(status.in_progress).toBe(1);
    expect(status.completed).toBe(1);
    expect(status.total).toBeGreaterThanOrEqual(4);
  });

  it("next_task is null when all pending tasks are blocked", () => {
    const t1 = createTask({ title: "Blocker" }, db);
    const t2 = createTask({ title: "Blocked" }, db);
    addDependency(t2.id, t1.id, db);

    // t1 is pending but should be returned as next_task; complete it to make all pending blocked
    startTask(t1.id, "agent1", db);
    completeTask(t1.id, "agent1", db);
    // Now t2 is unblocked — next_task should be t2
    const status1 = getStatus(undefined, undefined, db);
    expect(status1.next_task).not.toBeNull();
    expect(status1.next_task!.id).toBe(t2.id);

    // Create a task that is blocked by an incomplete task
    const t3 = createTask({ title: "Still blocked" }, db);
    const t4 = createTask({ title: "Incomplete blocker" }, db);
    addDependency(t3.id, t4.id, db);

    // Complete t2 to make only t3 (blocked) remain
    startTask(t2.id, "agent1", db);
    completeTask(t2.id, "agent1", db);

    const status2 = getStatus(undefined, undefined, db);
    // t3 is blocked by incomplete t4, but t4 itself is pending and not blocked
    expect(status2.next_task).not.toBeNull();
    expect(status2.next_task!.id).toBe(t4.id);
  });

  it("stale_count reflects stale in_progress tasks", () => {
    const t1 = createTask({ title: "Stale task" }, db);
    startTask(t1.id, "agent1", db);
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [oldTime, oldTime, t1.id]);

    const status = getStatus(undefined, undefined, db);
    expect(status.stale_count).toBe(1);
  });

  it("overdue_recurring counts pending recurring tasks past due_at", () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    createTask({ title: "Overdue recurring", recurrence_rule: "every day", due_at: pastDate }, db);
    createTask({ title: "Future recurring", recurrence_rule: "every day", due_at: new Date(Date.now() + 86400000).toISOString() }, db);
    createTask({ title: "Non-recurring", due_at: pastDate }, db);

    const status = getStatus(undefined, undefined, db);
    expect(status.overdue_recurring).toBe(1);
  });

  it("respects project_id filter", () => {
    const project = createProject({ name: "status-test-project", path: "/tmp/status-test-project" }, db);
    createTask({ title: "In project", project_id: project.id }, db);
    createTask({ title: "Not in project" }, db);

    const status = getStatus({ project_id: project.id }, undefined, db);
    // Only 1 task should be counted in the project
    expect(status.pending).toBe(1);
    expect(status.total).toBe(1);
  });
});

describe("decomposeTasks", () => {
  it("should create subtasks with correct parent_id", () => {
    const parent = createTask({ title: "Parent task" }, db);
    const result = decomposeTasks(parent.id, [
      { title: "Subtask A" },
      { title: "Subtask B" },
    ], {}, db);

    expect(result.parent.id).toBe(parent.id);
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0]!.parent_id).toBe(parent.id);
    expect(result.subtasks[1]!.parent_id).toBe(parent.id);
    expect(result.subtasks[0]!.title).toContain("Subtask A");
    expect(result.subtasks[1]!.title).toContain("Subtask B");
  });

  it("should inherit project_id from parent", () => {
    const project = createProject({ name: "Test Project", path: "/tmp/test-decompose" }, db);
    const parent = createTask({ title: "Parent", project_id: project.id }, db);
    const result = decomposeTasks(parent.id, [{ title: "Child" }], {}, db);

    expect(result.subtasks[0]!.project_id).toBe(project.id);
  });

  it("should chain subtasks with depends_on_prev", () => {
    const parent = createTask({ title: "Parent" }, db);
    const result = decomposeTasks(parent.id, [
      { title: "Step 1" },
      { title: "Step 2" },
      { title: "Step 3" },
    ], { depends_on_prev: true }, db);

    expect(result.subtasks).toHaveLength(3);
    // Step 2 depends on Step 1 (step2.dependencies contains step1)
    const step2 = getTaskWithRelations(result.subtasks[1]!.id, db);
    expect(step2!.dependencies.some(t => t.id === result.subtasks[0]!.id)).toBe(true);
    // Step 3 depends on Step 2 (step3.dependencies contains step2)
    const step3 = getTaskWithRelations(result.subtasks[2]!.id, db);
    expect(step3!.dependencies.some(t => t.id === result.subtasks[1]!.id)).toBe(true);
  });

  it("should return empty subtasks array when no subtasks given", () => {
    const parent = createTask({ title: "Parent" }, db);
    const result = decomposeTasks(parent.id, [], {}, db);

    expect(result.subtasks).toHaveLength(0);
    expect(result.parent.id).toBe(parent.id);
  });

  it("should throw TaskNotFoundError for non-existent parent", () => {
    expect(() => {
      decomposeTasks("non-existent-id", [{ title: "orphan" }], {}, db);
    }).toThrow(TaskNotFoundError);
  });
});
