import { createTodosMcpServer } from "./server.js";
import { getDatabase, resolvePartialId } from "../db/database.js";
import {
  claimNextTask,
  completeTask,
  createTask,
  deleteTask,
  getStatus,
  getTask,
  listTasks,
  startTask,
  updateTask,
} from "../db/tasks.js";
import type { CreateTaskInput, TaskFilter, UpdateTaskInput } from "../types/index.js";

function resolveTask(id: string): string {
  const resolved = resolvePartialId(getDatabase(), "tasks", id);
  if (!resolved) throw new Error(`Task not found: ${id}`);
  return resolved;
}

export function buildServer() {
  return createTodosMcpServer({
    async create(input) { return createTask(input as unknown as CreateTaskInput); },
    async list(input) { return listTasks(input as unknown as TaskFilter); },
    async get(id) { return getTask(resolveTask(id)); },
    async update(id, patch) {
      const resolved = resolveTask(id);
      const current = getTask(resolved)!;
      return updateTask(resolved, { ...patch, version: current.version } as unknown as UpdateTaskInput);
    },
    async delete(id) { return { deleted: deleteTask(resolveTask(id)) }; },
    async start(id, agent) { return startTask(resolveTask(id), agent ?? "mcp"); },
    async complete(id, input) {
      return completeTask(resolveTask(id), input.agent_id as string | undefined, undefined, input);
    },
    async status() { return getStatus(); },
    async claim(agent, projectId) { return claimNextTask(agent, { project_id: projectId }); },
  });
}
