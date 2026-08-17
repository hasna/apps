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

  it("rejects empty explicit and derived slugs", () => {
    expect(() => createTaskList({ name: "---" })).toThrow("non-empty kebab-case");
    expect(() => createTaskList({ name: "Inbox", slug: "" })).toThrow("non-empty kebab-case");
    expect(() => createTaskList({ name: "Inbox", slug: "---" })).toThrow("non-empty kebab-case");
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

  it("normalizes a changed slug and preserves project scope", () => {
    const project = createProject({ name: "P1", path: "/p1" });
    const list = createTaskList({ name: "Old", slug: "old", project_id: project.id });
    const updated = updateTaskList(list.id, { slug: "Release Queue" });
    expect(updated.slug).toBe("release-queue");
    expect(updated.project_id).toBe(project.id);
  });

  it("rejects a changed slug that conflicts within the same project", () => {
    const project = createProject({ name: "P1", path: "/p1" });
    createTaskList({ name: "Existing", slug: "release", project_id: project.id });
    const list = createTaskList({ name: "Old", slug: "old", project_id: project.id });
    expect(() => updateTaskList(list.id, { slug: "release" })).toThrow();
  });

  it("rejects a changed slug that conflicts between standalone lists", () => {
    createTaskList({ name: "Existing", slug: "release" });
    const list = createTaskList({ name: "Old", slug: "old" });
    expect(() => updateTaskList(list.id, { slug: "release" })).toThrow("already exists");
  });

  // Regression: the production task-list layer held 46 lists with project_id
  // null (doctor task_lists_without_project) and 1 with a filesystem path as
  // its project_id (task_lists_with_unregistered_project), and the CLI had NO
  // supported path to rebind a list to its registry project — the repair had
  // to be hand-edited or left undone.
  it("rebinds a standalone list to an existing project", () => {
    const project = createProject({ name: "Rebind Target", path: "/rebind" });
    const list = createTaskList({ name: "Unbound", slug: "unbound" });
    expect(list.project_id).toBeNull();

    const updated = updateTaskList(list.id, { project_id: project.id });
    expect(updated.project_id).toBe(project.id);
    // The list must remain resolvable through its slug in the new scope.
    expect(getTaskListBySlug("unbound", project.id)?.id).toBe(list.id);
    expect(getTaskListBySlug("unbound")).toBeNull();
  });

  it("unbinds a project-bound list when project_id is null or empty", () => {
    const project = createProject({ name: "P", path: "/p" });
    const list = createTaskList({ name: "Bound", slug: "bound", project_id: project.id });
    expect(updateTaskList(list.id, { project_id: null }).project_id).toBeNull();
    const rebound = updateTaskList(list.id, { project_id: project.id });
    expect(rebound.project_id).toBe(project.id);
    expect(updateTaskList(list.id, { project_id: "" }).project_id).toBeNull();
  });

  it("throws ProjectNotFoundError when rebinding to a project that does not exist", () => {
    const list = createTaskList({ name: "Unbound", slug: "unbound" });
    expect(() => updateTaskList(list.id, { project_id: "no-such-project" }))
      .toThrow("Project not found: no-such-project");
  });

  it("rejects a rebind whose slug is already taken in the target project scope", () => {
    const projectA = createProject({ name: "A", path: "/a" });
    const projectB = createProject({ name: "B", path: "/b" });
    // The same slug in two different scopes is legal today — that is what
    // makes the rebind the dangerous step: moving one into the other's scope
    // must collide, not silently shadow it.
    createTaskList({ name: "Taken", slug: "taken", project_id: projectB.id });
    const moving = createTaskList({ name: "Moving", slug: "taken", project_id: projectA.id });
    expect(() => updateTaskList(moving.id, { project_id: projectB.id })).toThrow("already exists");
    // Unchanged by the rejected rebind.
    expect(getTaskList(moving.id)?.project_id).toBe(projectA.id);
  });

  it("rejects a rebind to a project whose scope holds the same slug in the slug-claim registry", () => {
    const project = createProject({ name: "P", path: "/p" });
    createTaskList({ name: "Existing", slug: "shared", project_id: project.id });
    const legacy = createTaskList({ name: "Legacy", slug: "shared" });
    expect(() => updateTaskList(legacy.id, { project_id: project.id })).toThrow("already exists");
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

  it("should create with unique slug and return it", () => {
    const slug = "ensure-test-" + Date.now();
    const list = ensureTaskList("Ensure Test", slug);
    expect(list.slug).toBe(slug);
    expect(list.name).toBe("Ensure Test");
  });

  it("should return existing task list if slug matches (idempotent)", () => {
    const slug = "ensure-idem-" + Date.now();
    const first = ensureTaskList("First", slug);
    const second = ensureTaskList("Second", slug);
    expect(second.id).toBe(first.id);
  });
});

describe("getTaskListBySlug - additional", () => {
  it("should return null for non-existent slug", () => {
    const found = getTaskListBySlug("nonexistent-slug-xyz");
    expect(found).toBeNull();
  });
});
