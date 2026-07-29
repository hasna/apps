import { TodosV1Client } from "../client.generated.js";
import { getTodosCloudEnvironment } from "../runtime-mode.js";
import { createTodosMcpServer } from "./server.js";

export function buildServer() {
  const config = getTodosCloudEnvironment();
  const api = new TodosV1Client({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
    fetch: (input, init) => fetch(input, { ...init, redirect: "manual" }),
  });
  return createTodosMcpServer({
    async create(input) { return api.createTask(input as never); },
    async list(input) { return api.listTasks(input); },
    async get(id) { return api.getTask(id); },
    async update(id, patch) { return api.updateTask(id, patch); },
    async delete(id) { return api.deleteTask(id); },
    async start(id) { return api.startTask(id); },
    async complete(id, input) { return api.completeTask(id, input); },
    async status() { return api.getStats(); },
  });
}
