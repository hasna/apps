import { describe, it, expect } from "bun:test";
import { TodosClient, TodosError } from "./client.js";
import { todosTools } from "./schemas.js";

describe("TodosClient", () => {
  it("should create with default options", () => {
    const client = new TodosClient();
    expect(client).toBeDefined();
  });

  it("should create with custom baseUrl", () => {
    const client = new TodosClient({ baseUrl: "http://localhost:3000" });
    expect(client).toBeDefined();
  });

  it("should create with agent name", () => {
    const client = new TodosClient({ agentName: "test-agent" });
    expect(client).toBeDefined();
  });

  it("should throw if init called without name", async () => {
    const client = new TodosClient();
    expect(client.init()).rejects.toThrow("Agent name required");
  });

  it("should throw if me called before init", async () => {
    const client = new TodosClient();
    expect(client.me()).rejects.toThrow("Call init() first");
  });

  it("should throw if myQueue called before init", async () => {
    const client = new TodosClient();
    expect(client.myQueue()).rejects.toThrow("Call init() first");
  });
});

describe("TodosError", () => {
  it("should create with message and status", () => {
    const err = new TodosError("Not found", 404);
    expect(err.message).toBe("Not found");
    expect(err.status).toBe(404);
    expect(err.name).toBe("TodosError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("todosTools", () => {
  it("should export tool schemas", () => {
    expect(todosTools.length).toBeGreaterThan(10);
  });

  it("should have valid tool format", () => {
    for (const tool of todosTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("should include core tools", () => {
    const names = todosTools.map(t => t.name);
    expect(names).toContain("todos_create_task");
    expect(names).toContain("todos_list_tasks");
    expect(names).toContain("todos_start_task");
    expect(names).toContain("todos_complete_task");
    expect(names).toContain("todos_claim_task");
    expect(names).toContain("todos_get_queue");
    expect(names).toContain("todos_get_stats");
    expect(names).toContain("todos_approve_task");
    expect(names).toContain("todos_get_history");
  });

  it("should have required fields on create_task", () => {
    const createTask = todosTools.find(t => t.name === "todos_create_task");
    expect(createTask).toBeDefined();
    expect(createTask!.parameters.required).toContain("title");
  });
});
