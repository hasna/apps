import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase, resolvePartialId } from "../db/database.js";
import { addDependency, createTask, getTask, listTasks, completeTask, startTask } from "../db/tasks.js";
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
import { registerTaskResources } from "./tools/task-resources.js";

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
    resource() {
      // Resource handlers are not needed for these tool-wrapper tests.
    },
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

  it("bootstrap_project wrapper creates project state", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "todos-mcp-bootstrap-"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "@hasna/mcp-bootstrap" }, null, 2)}\n`);

    try {
      const tools = captureTools(registerTaskProjectTools);
      const result = await callCapturedTool(tools, "bootstrap_project", { path: root });
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.discovery.projectName).toBe("mcp-bootstrap");
      expect(payload.project.name).toBe("mcp-bootstrap");
      expect(payload.taskList.slug).toBe("todos-mcp-bootstrap");
      expect(payload.created.project).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it("task lock tools acquire renew check and release local leases", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Lock via MCP" }, db);

    const locked = await callCapturedTool(tools, "lock_task", { task_id: task.id, agent_id: "mcp-agent" });
    const lockJson = JSON.parse(locked.content[0]!.text);
    expect(lockJson.success).toBe(true);
    expect(lockJson.expires_at).toBeTruthy();

    const checked = await callCapturedTool(tools, "check_task_lock", { task_id: task.id });
    expect(JSON.parse(checked.content[0]!.text).locked_by).toBe("mcp-agent");

    const released = await callCapturedTool(tools, "unlock_task", { task_id: task.id, agent_id: "mcp-agent" });
    expect(JSON.parse(released.content[0]!.text).success).toBe(true);
    expect(getTask(task.id, db)!.locked_by).toBeNull();
  });

  it("get_task_dependencies returns the transitive dependency tree for agent planning", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const taskA = createTask({ title: "Task A" }, db);
    const taskB = createTask({ title: "Task B" }, db);
    const taskC = createTask({ title: "Task C" }, db);
    addDependency(taskA.id, taskB.id, db);
    addDependency(taskB.id, taskC.id, db);

    const result = await callCapturedTool(tools, "get_task_dependencies", {
      task_id: taskA.id,
      direction: "upstream",
    });

    expect(result.content[0]!.text).toContain("Task B");
    expect(result.content[0]!.text).toContain("Task C");
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

  it("git traceability tools link refs, commits, and verification evidence", async () => {
    const tools = captureTools(registerTaskResources);
    const task = createTask({ title: "Traceable via MCP" }, db);

    await callCapturedTool(tools, "link_task_to_commit", {
      task_id: task.id,
      sha: "abcdef1234567890",
      message: "Implement trace tools",
      files_changed: ["src/db/task-commits.ts"],
    });
    await callCapturedTool(tools, "link_task_git_ref", {
      task_id: task.id,
      ref_type: "pull_request",
      name: "42",
      url: "https://github.com/hasna/todos/pull/42",
      provider: "github",
    });
    await callCapturedTool(tools, "add_task_verification", {
      task_id: task.id,
      command: "bun test src/db/task-commits.test.ts",
      status: "passed",
      output_summary: "traceability tests passed",
    });

    const traceResult = await callCapturedTool(tools, "get_task_traceability", { task_id: task.id });
    const trace = JSON.parse(traceResult.content[0]!.text);
    expect(trace.commits[0].sha).toBe("abcdef1234567890");
    expect(trace.git_refs[0].name).toBe("42");
    expect(trace.verifications[0].status).toBe("passed");

    const refResult = await callCapturedTool(tools, "find_tasks_by_git_ref", { ref: "pull/42" });
    const refs = JSON.parse(refResult.content[0]!.text);
    expect(refs[0].task_id).toBe(task.id);
  });

  it("run ledger tools capture local run evidence without hosted calls", async () => {
    const tools = captureTools(registerTaskResources);
    const task = createTask({ title: "Run via MCP" }, db);

    const startResult = await callCapturedTool(tools, "start_task_run", {
      task_id: task.id,
      agent_id: "mcp",
      title: "MCP local run",
      claim: true,
      metadata: { source: "local" },
    });
    const run = JSON.parse(startResult.content[0]!.text);
    expect(run.status).toBe("running");

    await callCapturedTool(tools, "add_task_run_event", {
      run_id: run.id,
      event_type: "comment",
      message: "progress update",
      agent_id: "mcp",
    });
    await callCapturedTool(tools, "add_task_run_command", {
      run_id: run.id,
      command: "bun test src/db/task-runs.test.ts",
      status: "passed",
      exit_code: 0,
      output_summary: "passed",
      artifact_path: "logs/mcp-run.txt",
    });
    await callCapturedTool(tools, "add_task_run_file", {
      run_id: run.id,
      path: "src/db/task-runs.ts",
      status: "modified",
    });
    await callCapturedTool(tools, "add_task_run_artifact", {
      run_id: run.id,
      path: "logs/mcp-run.txt",
      artifact_type: "log",
      description: "local log",
      store_content: false,
    });
    const artifactReportResult = await callCapturedTool(tools, "verify_task_run_artifacts", { run_id: run.id });
    const artifactReports = JSON.parse(artifactReportResult.content[0]!.text);
    expect(artifactReports[0].status).toBe("metadata_only");
    await callCapturedTool(tools, "finish_task_run", {
      run_id: run.id,
      status: "completed",
      summary: "done",
    });

    const ledgerResult = await callCapturedTool(tools, "get_task_run_ledger", { run_id: run.id });
    const ledger = JSON.parse(ledgerResult.content[0]!.text);
    expect(ledger.run.status).toBe("completed");
    expect(ledger.events.map((event: { event_type: string }) => event.event_type)).toContain("comment");
    expect(ledger.commands[0].status).toBe("passed");
    expect(ledger.files[0].path).toBe("src/db/task-runs.ts");
    expect(ledger.artifacts[0].path).toBe("logs/mcp-run.txt");

    const listResult = await callCapturedTool(tools, "list_task_runs", { task_id: task.id });
    const runs = JSON.parse(listResult.content[0]!.text);
    expect(runs[0].id).toBe(run.id);
  });

  it("inbox tools capture and dedupe local failure intake", async () => {
    const tools = captureTools(registerTaskResources);

    const createdResult = await callCapturedTool(tools, "create_inbox_item", {
      body: "GitHub Actions failed\nTOKEN=secret-token-value",
      source_type: "ci_log",
      metadata: { secret: "hidden" },
    });
    const created = JSON.parse(createdResult.content[0]!.text);
    expect(created.item.source_type).toBe("ci_log");
    expect(created.item.body).not.toContain("secret-token-value");
    expect(created.item.metadata.secret).toBe("[REDACTED]");
    expect(created.task.tags).toContain("ci_log");

    const duplicateResult = await callCapturedTool(tools, "create_inbox_item", {
      body: "GitHub Actions failed\nTOKEN=secret-token-value",
      source_type: "ci_log",
    });
    const duplicate = JSON.parse(duplicateResult.content[0]!.text);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.item.id).toBe(created.item.id);

    const listResult = await callCapturedTool(tools, "list_inbox_items", { source_type: "ci_log" });
    const items = JSON.parse(listResult.content[0]!.text);
    expect(items).toHaveLength(1);

    const itemResult = await callCapturedTool(tools, "get_inbox_item", { id: created.item.id.slice(0, 8) });
    const item = JSON.parse(itemResult.content[0]!.text);
    expect(item.id).toBe(created.item.id);
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

  it("auto get_stale_tasks accepts MCP hour and minute parameters", async () => {
    const tools = captureTools(registerTaskAutoTools);
    const task = createTask({ title: "Stale wrapper task", status: "in_progress" }, db);
    const staleTime = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [staleTime, staleTime, task.id]);

    const result = await callCapturedTool(tools, "get_stale_tasks", { minutes: 30 });
    expect(result.content[0]!.text).toContain("Stale wrapper task");
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

  it("workflow claim_next_task can steal stale local work when requested", async () => {
    const workflowTools = captureTools(registerTaskWorkflowTools);
    const task = createTask({ title: "Steal via MCP" }, db);
    startTask(task.id, "old-agent", db);
    const staleTime = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [staleTime, staleTime, task.id]);

    const result = await callCapturedTool(workflowTools, "claim_next_task", {
      agent_id: "new-agent",
      steal_stale: true,
      stale_minutes: 30,
    });

    expect(result.content[0]!.text).toContain("Stolen");
    expect(getTask(task.id, db)!.locked_by).toBe("new-agent");
  });

  it("task detail tools are compact by default and expand on request", async () => {
    const crudTools = captureTools(registerTaskCrudTools);
    const advTools = captureTools(registerTaskAdvTools);
    const task = createTask({
      title: "Compact task via MCP",
      description: "Long context ".repeat(40),
    }, db);
    addComment({ task_id: task.id, content: "Progress note ".repeat(30), type: "progress" }, db);

    const compact = await callCapturedTool(crudTools, "get_task", { task_id: task.id, max_description_chars: 40 });
    const compactPayload = JSON.parse(compact.content[0]!.text);
    expect(compactPayload.title).toBe("Compact task via MCP");
    expect(compactPayload.description.length).toBeLessThanOrEqual(40);

    const full = await callCapturedTool(crudTools, "get_task", { task_id: task.id, detail: "full" });
    expect(full.content[0]!.text).toContain("Long context");

    const context = await callCapturedTool(advTools, "task_context", { task_id: task.id });
    const contextPayload = JSON.parse(context.content[0]!.text);
    expect(contextPayload.comments.count).toBe(1);
    expect(contextPayload.comments.recent[0].content.length).toBeLessThan(180);
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
