import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask, listTasks, completeTask } from "../db/tasks.js";
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

    const results = searchTasks("auth", undefined, undefined, db);
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

describe("Recurring task operations", () => {
  it("create_task with recurrence_rule", () => {
    const task = createTask(
      { title: "Daily standup", recurrence_rule: "every weekday" },
      db,
    );
    expect(task.title).toBe("Daily standup");
    expect(task.recurrence_rule).toBe("every weekday");
  });

  it("complete recurring task spawns next instance", () => {
    const task = createTask(
      { title: "Weekly review", recurrence_rule: "every week" },
      db,
    );
    const completed = completeTask(task.id, undefined, db);
    expect(completed.status).toBe("completed");
    expect(completed.metadata._next_recurrence).toBeDefined();

    const next = completed.metadata._next_recurrence as { id: string; due_at: string };
    const spawned = getTask(next.id, db);
    expect(spawned).not.toBeNull();
    expect(spawned!.recurrence_rule).toBe("every week");
    expect(spawned!.recurrence_parent_id).toBe(task.id);
    expect(spawned!.due_at).toBeTruthy();
  });

  it("complete with skip_recurrence prevents next instance", () => {
    const task = createTask(
      { title: "Skippable", recurrence_rule: "every day" },
      db,
    );
    const completed = completeTask(task.id, undefined, db, { skip_recurrence: true });
    expect(completed.status).toBe("completed");
    expect(completed.metadata._next_recurrence).toBeUndefined();

    // Only the original task should exist (now completed)
    const all = listTasks({}, db);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(task.id);
  });

  it("list with has_recurrence filter", () => {
    createTask({ title: "Recurring", recurrence_rule: "every day" }, db);
    createTask({ title: "One-off" }, db);

    const recurring = listTasks({ has_recurrence: true }, db);
    expect(recurring).toHaveLength(1);
    expect(recurring[0]!.title).toBe("Recurring");

    const nonRecurring = listTasks({ has_recurrence: false }, db);
    expect(nonRecurring).toHaveLength(1);
    expect(nonRecurring[0]!.title).toBe("One-off");
  });

  it("create_handoff equivalent", () => {
    const { createHandoff } = require("../db/handoffs.js") as any;
    const h = createHandoff({ agent_id: "brutus", summary: "MCP handoff test", completed: ["task1"], next_steps: ["task2"] }, db);
    expect(h.agent_id).toBe("brutus");
    expect(h.summary).toBe("MCP handoff test");
    expect(h.completed).toEqual(["task1"]);
    expect(h.next_steps).toEqual(["task2"]);
  });

  it("get_latest_handoff equivalent", () => {
    const { createHandoff, getLatestHandoff } = require("../db/handoffs.js") as any;
    createHandoff({ agent_id: "brutus", summary: "First" }, db);
    createHandoff({ agent_id: "brutus", summary: "Second" }, db);
    createHandoff({ agent_id: "maximus", summary: "Other agent" }, db);
    const latest = getLatestHandoff("brutus", undefined, db);
    expect(latest).not.toBeNull();
    expect(latest.summary).toBe("Second");
  });
});
