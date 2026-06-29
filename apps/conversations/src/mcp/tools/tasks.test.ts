import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTaskTools } from "./tasks";
import { closeDb, getDb } from "../../lib/db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-task-tools-${Date.now()}.db`);

describe("task MCP tools", () => {
  let client: Client;

  beforeAll(async () => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    closeDb();

    // Ensure tables exist
    const db = getDb();
    closeDb();

    const server = new McpServer({ name: "test-tasks", version: "0.0.1" });
    registerTaskTools(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    closeDb();
    await client.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
  });

  function parseText(result: { content: unknown[] }): string {
    return (result.content[0] as { type: string; text: string }).text;
  }

  function parseJSON(result: { content: unknown[] }): any {
    return JSON.parse(parseText(result));
  }

  describe("create_task", () => {
    test("creates a task with subject and reporter", async () => {
      const result = await client.callTool({
        name: "create_task",
        arguments: { subject: "Test task", reporter: "test-agent" },
      });
      const task = parseJSON(result as any);
      expect(task.subject).toBe("Test task");
      expect(task.reporter).toBe("test-agent");
      expect(task.status).toBe("pending");
      expect(task.uuid).toBeTruthy();
    });

    test("defaults priority to medium", async () => {
      const result = await client.callTool({
        name: "create_task",
        arguments: { subject: "Priority check", reporter: "test-agent" },
      });
      const task = parseJSON(result as any);
      expect(task.priority).toBe("medium");
    });
  });

  describe("get_task", () => {
    test("returns task by id", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Lookup task", reporter: "test-agent" },
      });
      const createdTask = parseJSON(created as any);

      const result = await client.callTool({
        name: "get_task",
        arguments: { id: createdTask.id },
      });
      const task = parseJSON(result as any);
      expect(task.subject).toBe("Lookup task");
    });

    test("returns error for nonexistent task", async () => {
      const result = await client.callTool({
        name: "get_task",
        arguments: { id: 99999 },
      });
      const text = parseText(result as any);
      expect(text).toContain("not found");
    });

    test("returns error when no id or uuid provided", async () => {
      const result = await client.callTool({
        name: "get_task",
        arguments: {},
      });
      const text = parseText(result as any);
      expect(text).toContain("required");
    });
  });

  describe("list_tasks", () => {
    test("lists tasks with count", async () => {
      await client.callTool({
        name: "create_task",
        arguments: { subject: "Task A", reporter: "test-agent" },
      });
      await client.callTool({
        name: "create_task",
        arguments: { subject: "Task B", reporter: "test-agent" },
      });

      const result = await client.callTool({
        name: "list_tasks",
        arguments: {},
      });
      const data = parseJSON(result as any);
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.count).toBeGreaterThanOrEqual(2);
    });

    test("filters by status", async () => {
      const result = await client.callTool({
        name: "list_tasks",
        arguments: { status: "pending" },
      });
      const data = parseJSON(result as any);
      expect(data.tasks.every((t: any) => t.status === "pending")).toBe(true);
    });
  });

  describe("start_task", () => {
    test("starts a pending task", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Start me", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      const result = await client.callTool({
        name: "start_task",
        arguments: { id, agent: "test-agent" },
      });
      const task = parseJSON(result as any);
      expect(task.status).toBe("in_progress");
    });
  });

  describe("complete_task", () => {
    test("completes an in_progress task", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Complete me", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      await client.callTool({
        name: "start_task",
        arguments: { id, agent: "test-agent" },
      });

      const result = await client.callTool({
        name: "complete_task",
        arguments: { id, agent: "test-agent" },
      });
      const task = parseJSON(result as any);
      expect(task.status).toBe("completed");
    });
  });

  describe("cancel_task", () => {
    test("cancels a task", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Cancel me", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      const result = await client.callTool({
        name: "cancel_task",
        arguments: { id, agent: "test-agent", reason: "no longer needed" },
      });
      const task = parseJSON(result as any);
      expect(task.status).toBe("cancelled");
    });
  });

  describe("block_task / unblock_task", () => {
    test("blocks and unblocks a task", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Block me", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      const blocked = await client.callTool({
        name: "block_task",
        arguments: { id, agent: "test-agent" },
      });
      expect(parseJSON(blocked as any).status).toBe("blocked");

      const unblocked = await client.callTool({
        name: "unblock_task",
        arguments: { id, agent: "test-agent" },
      });
      expect(parseJSON(unblocked as any).status).toBe("pending");
    });
  });

  describe("reopen_task", () => {
    test("reopens a completed task", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Reopen me", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      await client.callTool({ name: "start_task", arguments: { id, agent: "test-agent" } });
      await client.callTool({ name: "complete_task", arguments: { id, agent: "test-agent" } });

      const result = await client.callTool({
        name: "reopen_task",
        arguments: { id, agent: "test-agent" },
      });
      expect(parseJSON(result as any).status).toBe("pending");
    });
  });

  describe("assign_task", () => {
    test("assigns a task to an agent", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Assign me", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      const result = await client.callTool({
        name: "assign_task",
        arguments: { id, assignee: "new-assignee", agent: "test-agent" },
      });
      expect(parseJSON(result as any).assignee).toBe("new-assignee");
    });
  });

  describe("set_task_priority", () => {
    test("changes task priority", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Priority", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      const result = await client.callTool({
        name: "set_task_priority",
        arguments: { id, priority: "critical", agent: "test-agent" },
      });
      expect(parseJSON(result as any).priority).toBe("critical");
    });
  });

  describe("delete_task", () => {
    test("deletes a task with no subtasks", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Delete me", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      const result = await client.callTool({
        name: "delete_task",
        arguments: { id, agent: "test-agent" },
      });
      const data = parseJSON(result as any);
      expect(data.deleted).toBe(true);
    });
  });

  describe("comments", () => {
    test("adds and retrieves comments", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Comment test", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      await client.callTool({
        name: "add_comment",
        arguments: { task_id: id, content: "First comment", agent: "test-agent" },
      });

      const result = await client.callTool({
        name: "get_comments",
        arguments: { task_id: id },
      });
      const data = parseJSON(result as any);
      expect(data.count).toBe(1);
      expect(data.compact).toBe(true);
      expect(data.comments[0].preview).toBe("First comment");

      const verbose = await client.callTool({
        name: "get_comments",
        arguments: { task_id: id, verbose: true },
      });
      expect(parseJSON(verbose as any).comments[0].content).toBe("First comment");
    });
  });

  describe("subtasks", () => {
    test("gets subtasks of a parent", async () => {
      const parent = await client.callTool({
        name: "create_task",
        arguments: { subject: "Parent", reporter: "test-agent" },
      });
      const parentTask = parseJSON(parent as any);

      await client.callTool({
        name: "create_task",
        arguments: { subject: "Child", reporter: "test-agent", parent_id: parentTask.id },
      });

      const result = await client.callTool({
        name: "get_subtasks",
        arguments: { parent_id: parentTask.id },
      });
      const data = parseJSON(result as any);
      expect(data.count).toBe(1);
    });

    test("builds a task tree", async () => {
      const root = await client.callTool({
        name: "create_task",
        arguments: { subject: "Root", reporter: "test-agent" },
      });
      const rootTask = parseJSON(root as any);

      await client.callTool({
        name: "create_task",
        arguments: { subject: "Child", reporter: "test-agent", parent_id: rootTask.id },
      });

      const result = await client.callTool({
        name: "get_task_tree",
        arguments: { parent_id: rootTask.id },
      });
      const tree = parseJSON(result as any).tree;
      expect(tree.subject).toBe("Root");
      expect(tree.children).toHaveLength(1);
    });
  });

  describe("dependencies", () => {
    test("adds and retrieves dependencies", async () => {
      const dep = await client.callTool({
        name: "create_task",
        arguments: { subject: "Dep", reporter: "test-agent" },
      });
      const task = await client.callTool({
        name: "create_task",
        arguments: { subject: "Task", reporter: "test-agent" },
      });
      const depTask = parseJSON(dep as any);
      const mainTask = parseJSON(task as any);

      await client.callTool({
        name: "add_dependency",
        arguments: { task_id: mainTask.id, depends_on_id: depTask.id },
      });

      const deps = await client.callTool({
        name: "get_dependencies",
        arguments: { task_id: mainTask.id },
      });
      const depsData = parseJSON(deps as any);
      expect(depsData.count).toBe(1);
    });

    test("blocked task has dependents visible", async () => {
      const dep = await client.callTool({
        name: "create_task",
        arguments: { subject: "Dep", reporter: "test-agent" },
      });
      const task = await client.callTool({
        name: "create_task",
        arguments: { subject: "Dependent", reporter: "test-agent" },
      });
      const depTask = parseJSON(dep as any);
      const mainTask = parseJSON(task as any);

      await client.callTool({
        name: "add_dependency",
        arguments: { task_id: mainTask.id, depends_on_id: depTask.id },
      });

      const dependents = await client.callTool({
        name: "get_dependents",
        arguments: { task_id: depTask.id },
      });
      const dependentsData = parseJSON(dependents as any);
      expect(dependentsData.count).toBe(1);
    });

    test("removes a dependency", async () => {
      const dep = await client.callTool({
        name: "create_task",
        arguments: { subject: "Dep", reporter: "test-agent" },
      });
      const task = await client.callTool({
        name: "create_task",
        arguments: { subject: "Task", reporter: "test-agent" },
      });
      const depTask = parseJSON(dep as any);
      const mainTask = parseJSON(task as any);

      await client.callTool({
        name: "add_dependency",
        arguments: { task_id: mainTask.id, depends_on_id: depTask.id },
      });
      await client.callTool({
        name: "remove_dependency",
        arguments: { task_id: mainTask.id, depends_on_id: depTask.id },
      });

      const deps = await client.callTool({
        name: "get_dependencies",
        arguments: { task_id: mainTask.id },
      });
      expect(parseJSON(deps as any).count).toBe(0);
    });
  });

  describe("activity", () => {
    test("logs activity on task operations", async () => {
      const created = await client.callTool({
        name: "create_task",
        arguments: { subject: "Activity task", reporter: "test-agent" },
      });
      const { id } = parseJSON(created as any);

      const activity = await client.callTool({
        name: "get_task_activity",
        arguments: { task_id: id },
      });
      const data = parseJSON(activity as any);
      expect(data.activity).toHaveLength(1);
      expect(data.activity[0].action).toBe("created");
    });
  });
});
