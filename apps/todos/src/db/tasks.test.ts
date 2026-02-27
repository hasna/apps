import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
} from "./tasks.js";
import {
  VersionConflictError,
  TaskNotFoundError,
  LockError,
  DependencyCycleError,
} from "../types/index.js";
import { createTaskList, deleteTaskList } from "./task-lists.js";

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
