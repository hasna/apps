import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase, resolvePartialId } from "../db/database.js";
import { createTask, getTask, listTasks, completeTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { addComment, listComments } from "../db/comments.js";
import { searchTasks } from "../lib/search.js";
import type { Task } from "../types/index.js";
import { registerTaskCrudTools } from "./tools/task-crud.js";
import { registerTaskProjectTools } from "./tools/task-project-tools.js";
import { registerTaskWorkflowTools } from "./tools/task-workflow-tools.js";
import { registerTaskRelTools } from "./tools/task-rel-tools.js";
import { registerTaskAdvTools } from "./tools/task-adv-tools.js";
import { registerTaskAutoTools } from "./tools/task-auto-tools.js";
import { registerAgentTools } from "./tools/agents.js";

// These tests verify the core operations that the MCP server wraps.
// The MCP server itself uses stdio transport which is harder to test in unit tests.
// These validate the underlying data operations are correct.

let db: ReturnType<typeof getDatabase>;

type CapturedTool = {
  description: string;
  schema: Record<string, any>;
  handler: (params: Record<string, any>) => unknown | Promise<unknown>;
};

function captureTools(register: (server: any, ctx: any) => void): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    tool(name: string, description: string, schemaOrHandler: Record<string, any> | CapturedTool["handler"], maybeHandler?: CapturedTool["handler"]) {
      const schema = typeof schemaOrHandler === "function" ? {} : schemaOrHandler;
      const handler = typeof schemaOrHandler === "function" ? schemaOrHandler : maybeHandler!;
      tools.set(name, { description, schema, handler });
    },
  };
  const ctx = {
    shouldRegisterTool: () => true,
    resolveId: (partialId: string, table = "tasks") => {
      const id = resolvePartialId(getDatabase(), table, partialId);
      if (!id) throw new Error(`Could not resolve ID: ${partialId}`);
      return id;
    },
    formatError: (error: unknown) => {
      if (error instanceof Error) return JSON.stringify({ code: "TEST_ERROR", message: error.message });
      return JSON.stringify({ code: "TEST_ERROR", message: String(error) });
    },
    formatTask: (task: Task) => `${task.id.slice(0, 8)} ${task.status} ${task.priority} ${task.title}`,
    formatTaskDetail: (task: Task) => `${task.id} ${task.title}`,
    getAgentFocus: () => undefined,
    agentFocusMap: new Map(),
  };
  register(server, ctx);
  return tools;
}

async function callCapturedTool(tools: Map<string, CapturedTool>, name: string, params: Record<string, any>) {
  const tool = tools.get(name);
  expect(tool).toBeDefined();
  const result = await tool!.handler(params) as { isError?: boolean; content: { text: string }[] };
  expect(result.isError).not.toBe(true);
  return result;
}

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

describe("MCP tool wrappers", () => {
  it("accepts the same status and priority values as the database", () => {
    const tools = captureTools(registerTaskCrudTools);
    const createTaskTool = tools.get("create_task")!;
    createTaskTool.schema.priority.parse("critical");
    createTaskTool.schema.status.parse("failed");

    const listTasksTool = tools.get("list_tasks")!;
    listTasksTool.schema.priority.parse("critical");
    listTasksTool.schema.status.parse("failed");
  });

  it("create_task maps MCP aliases to persisted task fields", async () => {
    const tools = captureTools(registerTaskCrudTools);
    await callCapturedTool(tools, "create_task", {
      title: "Wrapper create",
      priority: "critical",
      deadline: "2026-05-07T00:00:00.000Z",
      estimate: 45,
      confidence: 0.8,
      retry_count: 5,
      tags: ["mcp"],
    });

    const task = listTasks({ tags: ["mcp"] }, db)[0]!;
    expect(task.priority).toBe("critical");
    expect(task.due_at).toBe("2026-05-07T00:00:00.000Z");
    expect(task.estimated_minutes).toBe(45);
    expect(task.confidence).toBe(0.8);
    expect(task.max_retries).toBe(5);
  });

  it("start_task works without forcing callers to pass the current version", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Start via MCP" }, db);

    await callCapturedTool(tools, "start_task", { task_id: task.id });

    const updated = getTask(task.id, db)!;
    expect(updated.status).toBe("in_progress");
    expect(updated.locked_by).toBe("mcp");
  });

  it("update_task fetches the current version and maps deadline/estimate aliases", async () => {
    const tools = captureTools(registerTaskCrudTools);
    const task = createTask({ title: "Update via MCP" }, db);

    await callCapturedTool(tools, "update_task", {
      task_id: task.id,
      title: "Updated via MCP",
      deadline: "2026-05-08T00:00:00.000Z",
      estimate: 60,
      actual_minutes: 70,
      confidence: 0.7,
    });

    const updated = getTask(task.id, db)!;
    expect(updated.title).toBe("Updated via MCP");
    expect(updated.due_at).toBe("2026-05-08T00:00:00.000Z");
    expect(updated.estimated_minutes).toBe(60);
    expect(updated.actual_minutes).toBe(70);
    expect(updated.confidence).toBe(0.7);
  });

  it("complete_task uses task lifecycle behavior and supports confidence/backdating", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Complete via MCP" }, db);

    await callCapturedTool(tools, "complete_task", {
      task_id: task.id,
      confidence: 0.9,
      completed_at: "2026-05-06T10:00:00.000Z",
    });

    const completed = getTask(task.id, db)!;
    expect(completed.status).toBe("completed");
    expect(completed.confidence).toBe(0.9);
    expect(completed.completed_at).toBe("2026-05-06T10:00:00.000Z");
  });

  it("fail_task delegates to the lifecycle failure path", async () => {
    const tools = captureTools(registerTaskWorkflowTools);
    const task = createTask({ title: "Fail via MCP" }, db);

    await callCapturedTool(tools, "fail_task", {
      task_id: task.id,
      agent_id: "mcp",
      reason: "regression test",
    });

    const failed = getTask(task.id, db)!;
    expect(failed.status).toBe("failed");
    expect((failed.metadata._failure as { reason: string }).reason).toBe("regression test");
  });

  it("relationship tools resolve their database imports from the tools directory", async () => {
    const tools = captureTools(registerTaskRelTools);

    await callCapturedTool(tools, "create_handoff", {
      agent_id: "mcp",
      summary: "Wrapper handoff",
      completed: ["one"],
      next_steps: ["two"],
    });
  });

  it("comment wrappers persist and read the real comment fields", async () => {
    const projectTools = captureTools(registerTaskProjectTools);
    const advTools = captureTools(registerTaskAdvTools);
    const task = createTask({ title: "Comment via MCP" }, db);

    await callCapturedTool(projectTools, "create_comment", {
      task_id: task.id,
      body: "Project comment body",
    });
    await callCapturedTool(advTools, "add_comment", {
      task_id: task.id,
      body: "Alias comment body",
    });

    const comments = listComments(task.id, db);
    expect(comments.map(comment => comment.content)).toEqual([
      "Project comment body",
      "Alias comment body",
    ]);

    const result = await callCapturedTool(advTools, "get_comments", { task_id: task.id });
    expect(result.content[0]!.text).toContain("Alias comment body");
  });

  it("search_tasks wrapper calls the search library", async () => {
    const tools = captureTools(registerTaskProjectTools);
    createTask({ title: "Needle wrapper task" }, db);

    const result = await callCapturedTool(tools, "search_tasks", {
      query: "Needle",
    });

    expect(result.content[0]!.text).toContain("Needle wrapper task");
  });

  it("auto tools report deadlines and health without dead imports", async () => {
    const tools = captureTools(registerTaskAutoTools);
    createTask({
      title: "Due soon via MCP",
      due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, db);

    const deadlines = await callCapturedTool(tools, "notify_upcoming_deadlines", { hours: 2 });
    expect(deadlines.content[0]!.text).toContain("Due soon via MCP");

    const health = await callCapturedTool(tools, "get_health", {});
    expect(health.content[0]!.text).toContain("Tasks:");
  });

  it("workflow queue tools expose next, claim, changed, status, and context", async () => {
    const workflowTools = captureTools(registerTaskWorkflowTools);
    const advTools = captureTools(registerTaskAdvTools);
    const task = createTask({ title: "Queue via MCP", priority: "high" }, db);

    const status = await callCapturedTool(advTools, "get_status", {});
    expect(JSON.parse(status.content[0]!.text).pending).toBeGreaterThanOrEqual(1);

    const next = await callCapturedTool(workflowTools, "get_next_task", { agent_id: "mcp" });
    expect(next.content[0]!.text).toContain("Queue via MCP");

    const changed = await callCapturedTool(workflowTools, "get_tasks_changed_since", {
      since: "2000-01-01T00:00:00.000Z",
    });
    expect(changed.content[0]!.text).toContain("Queue via MCP");

    const context = await callCapturedTool(workflowTools, "get_context", { agent_id: "mcp" });
    expect(JSON.parse(context.content[0]!.text).next_task.title).toBe("Queue via MCP");

    await callCapturedTool(workflowTools, "claim_next_task", { agent_id: "mcp" });
    expect(getTask(task.id, db)!.status).toBe("in_progress");
  });

  it("agent tools register heartbeat and release agents", async () => {
    const tools = captureTools(registerAgentTools);

    const registered = await callCapturedTool(tools, "register_agent", {
      name: "McpAgent",
      role: "agent",
      capabilities: ["testing"],
    });
    expect(registered.content[0]!.text).toContain("Agent registered");

    const heartbeat = await callCapturedTool(tools, "heartbeat", { agent_id: "mcpagent" });
    expect(heartbeat.content[0]!.text).toContain("Heartbeat");

    const released = await callCapturedTool(tools, "release_agent", { agent_id: "mcpagent" });
    expect(released.content[0]!.text).toContain("Agent released");
  });

  it("agent tools reject generated generic names", async () => {
    const tools = captureTools(registerAgentTools);
    const tool = tools.get("register_agent");
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      name: "agent-1",
    }) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Invalid agent name");
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
