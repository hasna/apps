import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { addComment } from "../db/comments.js";
import { searchTasks } from "../lib/search.js";

// These tests verify the core operations that the MCP server wraps.
// The MCP server itself uses stdio transport which is harder to test in unit tests.
// These validate the underlying data operations are correct.

let db: ReturnType<typeof getDatabase>;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("MCP tool operations", () => {
  it("create_task equivalent", () => {
    const task = createTask(
      {
        title: "MCP task",
        description: "Created via MCP",
        priority: "high",
        tags: ["mcp"],
      },
      db,
    );
    expect(task.title).toBe("MCP task");
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual(["mcp"]);
  });

  it("list_tasks with filters", () => {
    createTask({ title: "Pending", status: "pending" }, db);
    createTask({ title: "In progress", status: "in_progress" }, db);
    createTask({ title: "Completed", status: "completed" }, db);

    const { listTasks } = require("./../../src/db/tasks.js");
    const active = listTasks({ status: ["pending", "in_progress"] }, db);
    expect(active).toHaveLength(2);
  });

  it("search_tasks", () => {
    createTask({ title: "Fix authentication bug" }, db);
    createTask({ title: "Add dark mode" }, db);

    const results = searchTasks("auth", undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Fix authentication bug");
  });

  it("add_comment", () => {
    const task = createTask({ title: "Commentable" }, db);
    const comment = addComment(
      { task_id: task.id, content: "Test comment", agent_id: "claude" },
      db,
    );
    expect(comment.content).toBe("Test comment");
    expect(comment.agent_id).toBe("claude");
  });

  it("create_project", () => {
    const project = createProject(
      { name: "MCP Project", path: "/tmp/mcp-test" },
      db,
    );
    expect(project.name).toBe("MCP Project");
  });

  it("version-based optimistic locking via update_task", () => {
    const task = createTask({ title: "Lockable" }, db);
    const { updateTask } = require("./../../src/db/tasks.js");

    // First update succeeds
    const updated = updateTask(task.id, { version: 1, title: "Updated" }, db);
    expect(updated.version).toBe(2);

    // Second update with stale version fails
    expect(() => updateTask(task.id, { version: 1, title: "Stale" }, db)).toThrow();
  });
});
