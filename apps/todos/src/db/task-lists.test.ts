import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTaskList, getTaskList, getTaskListBySlug, listTaskLists, updateTaskList, deleteTaskList, ensureTaskList } from "./task-lists.js";
import { createProject } from "./projects.js";
import { createTask } from "./tasks.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createTaskList", () => {
  it("should create a standalone task list with auto-slug", () => {
    const list = createTaskList({ name: "My Backlog" });
    expect(list.name).toBe("My Backlog");
    expect(list.slug).toBe("my-backlog");
    expect(list.project_id).toBeNull();
    expect(list.description).toBeNull();
    expect(list.metadata).toEqual({});
  });

  it("should create with explicit slug", () => {
    const list = createTaskList({ name: "Sprint 1", slug: "sprint-1" });
    expect(list.slug).toBe("sprint-1");
  });

  it("should create with project_id", () => {
    const project = createProject({ name: "Test", path: "/test" });
    const list = createTaskList({ name: "Bugs", project_id: project.id });
    expect(list.project_id).toBe(project.id);
  });

  it("should store description and metadata", () => {
    const list = createTaskList({
      name: "Features",
      description: "Feature requests",
      metadata: { color: "blue" },
    });
    expect(list.description).toBe("Feature requests");
    expect(list.metadata).toEqual({ color: "blue" });
  });

  it("should enforce slug uniqueness for standalone lists", () => {
    createTaskList({ name: "Backlog" });
    expect(() => createTaskList({ name: "Backlog" })).toThrow("already exists");
  });

  it("should enforce slug uniqueness within same project", () => {
    const project = createProject({ name: "P1", path: "/p1" });
    createTaskList({ name: "Bugs", project_id: project.id });
    expect(() => createTaskList({ name: "Bugs", project_id: project.id })).toThrow();
  });

  it("should allow same slug across different projects", () => {
    const p1 = createProject({ name: "P1", path: "/p1" });
    const p2 = createProject({ name: "P2", path: "/p2" });
    const list1 = createTaskList({ name: "Bugs", project_id: p1.id });
    const list2 = createTaskList({ name: "Bugs", project_id: p2.id });
    expect(list1.slug).toBe("bugs");
    expect(list2.slug).toBe("bugs");
    expect(list1.id).not.toBe(list2.id);
  });
});

describe("getTaskList", () => {
  it("should return task list by ID", () => {
    const created = createTaskList({ name: "Test List" });
    const found = getTaskList(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test List");
  });

  it("should return null for non-existent ID", () => {
    expect(getTaskList("nonexist")).toBeNull();
  });
});

describe("getTaskListBySlug", () => {
  it("should find standalone list by slug", () => {
    createTaskList({ name: "Sprint One", slug: "sprint-1" });
    const found = getTaskListBySlug("sprint-1");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Sprint One");
  });

  it("should find project-scoped list by slug", () => {
    const project = createProject({ name: "MyProject", path: "/my" });
    createTaskList({ name: "Bugs", project_id: project.id });
    const found = getTaskListBySlug("bugs", project.id);
    expect(found).not.toBeNull();
    expect(found!.project_id).toBe(project.id);
  });

  it("should return null for wrong project", () => {
    const project = createProject({ name: "P", path: "/p" });
    createTaskList({ name: "Bugs", project_id: project.id });
    expect(getTaskListBySlug("bugs")).toBeNull(); // standalone lookup won't find project-scoped
  });
});

describe("listTaskLists", () => {
  it("should list all task lists ordered by name", () => {
    createTaskList({ name: "Zebra" });
    createTaskList({ name: "Alpha" });
    const lists = listTaskLists();
    expect(lists).toHaveLength(2);
    expect(lists[0]!.name).toBe("Alpha");
    expect(lists[1]!.name).toBe("Zebra");
  });

  it("should filter by project", () => {
    const project = createProject({ name: "P1", path: "/p1" });
    createTaskList({ name: "In Project", project_id: project.id });
    createTaskList({ name: "Standalone" });
    const projectLists = listTaskLists(project.id);
    expect(projectLists).toHaveLength(1);
    expect(projectLists[0]!.name).toBe("In Project");
  });

  it("should return empty array when none exist", () => {
    expect(listTaskLists()).toEqual([]);
  });
});

describe("updateTaskList", () => {
  it("should update name and description", () => {
    const list = createTaskList({ name: "Old Name" });
    const updated = updateTaskList(list.id, { name: "New Name", description: "Updated" });
    expect(updated.name).toBe("New Name");
    expect(updated.description).toBe("Updated");
  });

  it("should throw TaskListNotFoundError for non-existent ID", () => {
    expect(() => updateTaskList("nonexist", { name: "X" })).toThrow("Task list not found");
  });
});

describe("deleteTaskList", () => {
  it("should delete existing task list", () => {
    const list = createTaskList({ name: "Doomed" });
    expect(deleteTaskList(list.id)).toBe(true);
    expect(getTaskList(list.id)).toBeNull();
  });

  it("should return false for non-existent", () => {
    expect(deleteTaskList("nonexist")).toBe(false);
  });

  it("should orphan tasks when deleted (set task_list_id to NULL)", () => {
    const list = createTaskList({ name: "Temp List" });
    const task = createTask({ title: "Task in list", task_list_id: list.id });
    expect(task.task_list_id).toBe(list.id);

    deleteTaskList(list.id);

    const db = getDatabase();
    const row = db.query("SELECT task_list_id FROM tasks WHERE id = ?").get(task.id) as { task_list_id: string | null };
    expect(row.task_list_id).toBeNull();
  });
});

describe("ensureTaskList", () => {
  it("should create if not exists", () => {
    const list = ensureTaskList("Backlog", "backlog");
    expect(list.name).toBe("Backlog");
    expect(list.slug).toBe("backlog");
  });

  it("should return existing if found", () => {
    const first = ensureTaskList("Backlog", "backlog");
    const second = ensureTaskList("Backlog", "backlog");
    expect(second.id).toBe(first.id);
  });
});
