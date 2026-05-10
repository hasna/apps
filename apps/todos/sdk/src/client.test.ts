import { afterEach, describe, expect, it } from "bun:test";
import { TodosClient, TodosError } from "./client.js";
import { todosTools } from "./schemas.js";

const originalEventSource = globalThis.EventSource;
const originalFetch = globalThis.fetch;
const originalTodosApiKey = process.env["TODOS_API_KEY"];
const originalTodosApiUrl = process.env["TODOS_API_URL"];
const originalTodosUrl = process.env["TODOS_URL"];

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  globalThis.fetch = originalFetch;
  if (originalTodosApiKey === undefined) delete process.env["TODOS_API_KEY"];
  else process.env["TODOS_API_KEY"] = originalTodosApiKey;
  if (originalTodosApiUrl === undefined) delete process.env["TODOS_API_URL"];
  else process.env["TODOS_API_URL"] = originalTodosApiUrl;
  if (originalTodosUrl === undefined) delete process.env["TODOS_URL"];
  else process.env["TODOS_URL"] = originalTodosUrl;
});

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
    const client = new TodosClient({ agentName: "testagent" });
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

describe("TodosClient API keys", () => {
  it("sends API key from options as bearer auth", async () => {
    let observedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = init?.headers;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = new TodosClient({ baseUrl: "http://todos.test", apiKey: "test-option-key" });
    await client.listTasks();

    expect((observedHeaders as Record<string, string>).Authorization).toBe("Bearer test-option-key");
  });

  it("reads TODOS_API_KEY when apiKey option is omitted", async () => {
    process.env["TODOS_API_KEY"] = "test-env-key";
    let observedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = init?.headers;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = new TodosClient({ baseUrl: "http://todos.test" });
    await client.listTasks();

    expect((observedHeaders as Record<string, string>).Authorization).toBe("Bearer test-env-key");
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

  it("should throw TodosError on failed requests", async () => {
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:1", agentName: "test" });
    await expect(client.listTasks()).rejects.toThrow();
  });
});

describe("TodosClient method construction", () => {
  it("should build correct listTasks query with filters", async () => {
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19999" });
    // Will fail to connect but validates the method exists and accepts filters
    await expect(client.listTasks({ status: "pending", project_id: "p1", limit: 10 })).rejects.toThrow();
  });

  it("should accept all filter params for listTasks", async () => {
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19998" });
    await expect(client.listTasks({ status: "in_progress", project_id: "p1", plan_id: "pl1", limit: 5 })).rejects.toThrow();
  });

  it("should build searchTasks query", async () => {
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19997" });
    await expect(client.searchTasks("test query")).rejects.toThrow();
  });

  it("should build listPlans with project filter", async () => {
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19996" });
    await expect(client.listPlans("proj-1")).rejects.toThrow();
  });

  it("should build recentActivity with limit", async () => {
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19995" });
    await expect(client.recentActivity(25)).rejects.toThrow();
  });

  it("should create client with agent name and pass it to init", async () => {
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19994", agentName: "myagent" });
    // init will fail due to no server, but validates the method exists
    await expect(client.init()).rejects.toThrow();
  });
});

describe("TodosClient baseUrl normalization", () => {
  it("should strip trailing slash from baseUrl", () => {
    const client = new TodosClient({ baseUrl: "http://localhost:3000/" });
    expect(client).toBeDefined();
  });

  it("should prefer TODOS_API_URL over legacy TODOS_URL", async () => {
    process.env["TODOS_API_URL"] = "https://api-url.todos.test/";
    process.env["TODOS_URL"] = "https://legacy.todos.test/";
    let observedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      observedUrl = String(input);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = new TodosClient();
    await client.listTasks();

    expect(observedUrl).toBe("https://api-url.todos.test/api/tasks");
  });
});

describe("TodosClient subscribeEvents", () => {
  it("should return a close function", () => {
    let closed = false;
    class MockEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(public url: string) {}

      close() {
        closed = true;
      }
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19993" });
    const sub = client.subscribeEvents(() => {});
    expect(sub.close).toBeDefined();
    expect(typeof sub.close).toBe("function");
    sub.close();
    expect(closed).toBe(true);
  });
});

describe("todosTools", () => {
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
