import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { searchTasks } from "./search.js";
import type { SearchOptions } from "./search.js";
import { createTask, updateTask, addDependency } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { registerAgent } from "../db/agents.js";
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
    expect(results[0]!.title).toContain("Build feature alpha");
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
    expect(results[0]!.title).toContain("Fix bug A");
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

  it("should filter by status (single value)", () => {
    createTask({ title: "Filter task A", status: "pending" }, db);
    createTask({ title: "Filter task B", status: "completed" }, db);
    createTask({ title: "Filter task C", status: "in_progress" }, db);

    const results = searchTasks({ query: "Filter task", status: "pending" }, undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Filter task A");
  });

  it("should filter by status (array)", () => {
    createTask({ title: "Filter task A", status: "pending" }, db);
    createTask({ title: "Filter task B", status: "completed" }, db);
    createTask({ title: "Filter task C", status: "in_progress" }, db);

    const results = searchTasks({ query: "Filter task", status: ["pending", "in_progress"] }, undefined, undefined, db);
    expect(results).toHaveLength(2);
    const titles = results.map(r => r.title);
    expect(titles).toContain("Filter task A");
    expect(titles).toContain("Filter task C");
  });

  it("should filter by priority (single value)", () => {
    createTask({ title: "Prio task A", priority: "high" }, db);
    createTask({ title: "Prio task B", priority: "low" }, db);
    createTask({ title: "Prio task C", priority: "critical" }, db);

    const results = searchTasks({ query: "Prio task", priority: "high" }, undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Prio task A");
  });

  it("should filter by priority (array)", () => {
    createTask({ title: "Prio task A", priority: "high" }, db);
    createTask({ title: "Prio task B", priority: "low" }, db);
    createTask({ title: "Prio task C", priority: "critical" }, db);

    const results = searchTasks({ query: "Prio task", priority: ["high", "critical"] }, undefined, undefined, db);
    expect(results).toHaveLength(2);
    expect(results[0]!.priority).toBe("critical");
    expect(results[1]!.priority).toBe("high");
  });

  it("should filter by assigned_to", () => {
    const agent = registerAgent({ name: "testagent" }, db);
    const t1 = createTask({ title: "Assign task A", assigned_to: agent.id }, db);
    createTask({ title: "Assign task B" }, db);

    const results = searchTasks({ query: "Assign task", assigned_to: agent.id }, undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(t1.id);
  });

  it("should filter by agent_id", () => {
    const agent = registerAgent({ name: "creator" }, db);
    const t1 = createTask({ title: "Agent task A", agent_id: agent.id }, db);
    createTask({ title: "Agent task B" }, db);

    const results = searchTasks({ query: "Agent task", agent_id: agent.id }, undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(t1.id);
  });

  it("should filter by created_after", () => {
    const pastDate = "2020-01-01T00:00:00.000Z";
    createTask({ title: "Date task A" }, db);
    createTask({ title: "Date task B" }, db);

    const results = searchTasks({ query: "Date task", created_after: pastDate }, undefined, undefined, db);
    expect(results).toHaveLength(2);

    // Future date should return nothing
    const futureResults = searchTasks({ query: "Date task", created_after: "2099-01-01T00:00:00.000Z" }, undefined, undefined, db);
    expect(futureResults).toHaveLength(0);
  });

  it("should filter by updated_after", () => {
    createTask({ title: "Update task A" }, db);

    const results = searchTasks({ query: "Update task", updated_after: "2020-01-01T00:00:00.000Z" }, undefined, undefined, db);
    expect(results).toHaveLength(1);

    const futureResults = searchTasks({ query: "Update task", updated_after: "2099-01-01T00:00:00.000Z" }, undefined, undefined, db);
    expect(futureResults).toHaveLength(0);
  });

  it("should filter by has_dependencies", () => {
    const t1 = createTask({ title: "Dep task A" }, db);
    const t2 = createTask({ title: "Dep task B" }, db);
    addDependency(t1.id, t2.id, db);

    const withDeps = searchTasks({ query: "Dep task", has_dependencies: true }, undefined, undefined, db);
    expect(withDeps).toHaveLength(1);
    expect(withDeps[0]!.id).toBe(t1.id);

    const withoutDeps = searchTasks({ query: "Dep task", has_dependencies: false }, undefined, undefined, db);
    expect(withoutDeps).toHaveLength(1);
    expect(withoutDeps[0]!.id).toBe(t2.id);
  });

  it("should filter by is_blocked", () => {
    const blocker = createTask({ title: "Block task A", status: "pending" }, db);
    const blocked = createTask({ title: "Block task B" }, db);
    const free = createTask({ title: "Block task C" }, db);
    addDependency(blocked.id, blocker.id, db);

    const blockedResults = searchTasks({ query: "Block task", is_blocked: true }, undefined, undefined, db);
    expect(blockedResults).toHaveLength(1);
    expect(blockedResults[0]!.id).toBe(blocked.id);

    const unblockedResults = searchTasks({ query: "Block task", is_blocked: false }, undefined, undefined, db);
    expect(unblockedResults).toHaveLength(2);
    const ids = unblockedResults.map(r => r.id);
    expect(ids).toContain(blocker.id);
    expect(ids).toContain(free.id);
  });

  it("should work with multiple filters combined", () => {
    createTask({ title: "Multi filter A", status: "pending", priority: "high" }, db);
    createTask({ title: "Multi filter B", status: "pending", priority: "low" }, db);
    createTask({ title: "Multi filter C", status: "completed", priority: "high" }, db);

    const results = searchTasks({
      query: "Multi filter",
      status: "pending",
      priority: "high",
    }, undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Multi filter A");
  });

  it("should maintain backward compatibility with old 3-arg signature", () => {
    const project = createProject({ name: "BackCompat", path: "/path/backcompat" }, db);
    createTask({ title: "Compat task A", project_id: project.id }, db);
    createTask({ title: "Compat task B" }, db);

    // Old signature: searchTasks(query, projectId, taskListId, db)
    const results = searchTasks("Compat task", project.id, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toContain("Compat task A");
  });

  it("should work with SearchOptions object including project_id", () => {
    const project = createProject({ name: "ObjProject", path: "/path/objproj" }, db);
    createTask({ title: "Obj task A", project_id: project.id }, db);
    createTask({ title: "Obj task B" }, db);

    const results = searchTasks({ query: "Obj task", project_id: project.id }, undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toContain("Obj task A");
  });
});
