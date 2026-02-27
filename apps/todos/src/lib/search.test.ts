import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { searchTasks } from "./search.js";
import { createTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
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

describe("searchTasks", () => {
  it("should match by title", () => {
    createTask({ title: "Fix login bug" }, db);
    createTask({ title: "Add dashboard feature" }, db);

    const results = searchTasks("login", undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Fix login bug");
  });

  it("should match by description", () => {
    createTask({ title: "Task A", description: "The authentication module needs refactoring" }, db);
    createTask({ title: "Task B", description: "Update the README" }, db);

    const results = searchTasks("authentication", undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Task A");
  });

  it("should match by tags", () => {
    createTask({ title: "Tagged task", tags: ["urgent", "frontend"] }, db);
    createTask({ title: "Untagged task" }, db);

    const results = searchTasks("frontend", undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Tagged task");
  });

  it("should return empty array for no matches", () => {
    createTask({ title: "Some task" }, db);

    const results = searchTasks("nonexistent-query-xyz", undefined, undefined, db);
    expect(results).toHaveLength(0);
  });

  it("should filter by projectId", () => {
    const project1 = createProject({ name: "Project A", path: "/path/a" }, db);
    const project2 = createProject({ name: "Project B", path: "/path/b" }, db);

    createTask({ title: "Build feature alpha", project_id: project1.id }, db);
    createTask({ title: "Build feature beta", project_id: project2.id }, db);

    const results = searchTasks("Build feature", project1.id, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Build feature alpha");
  });

  it("should filter by taskListId", () => {
    const list1 = createTaskList({ name: "Dev List", slug: "dev-list" }, db);
    const list2 = createTaskList({ name: "QA List", slug: "qa-list" }, db);

    createTask({ title: "Implement search", task_list_id: list1.id }, db);
    createTask({ title: "Implement filter", task_list_id: list2.id }, db);

    const results = searchTasks("Implement", undefined, list1.id, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Implement search");
  });

  it("should filter by both projectId and taskListId", () => {
    const project = createProject({ name: "MyProject", path: "/path/proj" }, db);
    const list = createTaskList({ name: "Dev List", slug: "dev" }, db);

    createTask({ title: "Fix bug A", project_id: project.id, task_list_id: list.id }, db);
    createTask({ title: "Fix bug B", project_id: project.id }, db);
    createTask({ title: "Fix bug C", task_list_id: list.id }, db);
    createTask({ title: "Fix bug D" }, db);

    const results = searchTasks("Fix bug", project.id, list.id, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Fix bug A");
  });

  it("should be case-insensitive", () => {
    createTask({ title: "UPPERCASE TITLE" }, db);
    createTask({ title: "lowercase title" }, db);

    const upperSearch = searchTasks("uppercase", undefined, undefined, db);
    expect(upperSearch).toHaveLength(1);
    expect(upperSearch[0]!.title).toBe("UPPERCASE TITLE");

    const lowerSearch = searchTasks("LOWERCASE", undefined, undefined, db);
    expect(lowerSearch).toHaveLength(1);
    expect(lowerSearch[0]!.title).toBe("lowercase title");
  });

  it("should order results by priority then created_at DESC", () => {
    // Create tasks with different priorities (with small delay to ensure ordering)
    createTask({ title: "Search low", priority: "low" }, db);
    createTask({ title: "Search critical", priority: "critical" }, db);
    createTask({ title: "Search high", priority: "high" }, db);
    createTask({ title: "Search medium", priority: "medium" }, db);

    const results = searchTasks("Search", undefined, undefined, db);
    expect(results).toHaveLength(4);
    expect(results[0]!.priority).toBe("critical");
    expect(results[1]!.priority).toBe("high");
    expect(results[2]!.priority).toBe("medium");
    expect(results[3]!.priority).toBe("low");
  });
});
