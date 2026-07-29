import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPackageVersion } from "../lib/package-version.js";

export interface TaskOperations {
  create(input: Record<string, unknown>): Promise<unknown>;
  list(input: Record<string, unknown>): Promise<unknown>;
  get(id: string): Promise<unknown>;
  update(id: string, patch: Record<string, unknown>): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  start(id: string, agent?: string): Promise<unknown>;
  complete(id: string, input: Record<string, unknown>): Promise<unknown>;
  status(): Promise<unknown>;
  claim?(agent: string, projectId?: string): Promise<unknown>;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function createTodosMcpServer(operations: TaskOperations): McpServer {
  const server = new McpServer({ name: "todos", version: getPackageVersion() });

  server.tool("create_task", "Create a task", {
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    project_id: z.string().optional(),
    assigned_to: z.string().optional(),
  }, async (input) => result(await operations.create(input)));

  server.tool("list_tasks", "List tasks", {
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    project_id: z.string().optional(),
    assigned_to: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
  }, async (input) => result(await operations.list(input)));

  server.tool("get_task", "Get one task", { task_id: z.string().min(1) },
    async ({ task_id }) => result(await operations.get(task_id)));

  server.tool("update_task", "Update one task", {
    task_id: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    assigned_to: z.string().optional(),
  }, async ({ task_id, ...patch }) => result(await operations.update(task_id, patch)));

  server.tool("delete_task", "Delete one task", { task_id: z.string().min(1) },
    async ({ task_id }) => result(await operations.delete(task_id)));

  server.tool("start_task", "Start one task", {
    task_id: z.string().min(1),
    agent_id: z.string().min(1).optional(),
  }, async ({ task_id, agent_id }) => result(await operations.start(task_id, agent_id)));

  server.tool("complete_task", "Complete one task", {
    task_id: z.string().min(1),
    agent_id: z.string().min(1).optional(),
    notes: z.string().optional(),
    commit_hash: z.string().optional(),
    test_results: z.string().optional(),
    files_changed: z.array(z.string()).optional(),
  }, async ({ task_id, ...input }) => result(await operations.complete(task_id, input)));

  server.tool("get_status", "Get task counts", {}, async () => result(await operations.status()));

  if (operations.claim) {
    server.tool("claim_next_task", "Atomically claim the next task", {
      agent_id: z.string().min(1),
      project_id: z.string().optional(),
    }, async ({ agent_id, project_id }) => result(await operations.claim!(agent_id, project_id)));
  }

  return server;
}
