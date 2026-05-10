import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TodosClient } from "./client.js";
import { resetConfig, updateConfig } from "../lib/config.js";

const originalHome = process.env["HOME"];
const originalTodosApiUrl = process.env["TODOS_API_URL"];
const originalTodosUrl = process.env["TODOS_URL"];
const originalTodosMode = process.env["TODOS_MODE"];
const originalTodosApiKey = process.env["TODOS_API_KEY"];
const originalFetch = globalThis.fetch;

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "todos-sdk-remote-"));
  process.env["HOME"] = fakeHome;
  delete process.env["TODOS_API_URL"];
  delete process.env["TODOS_URL"];
  delete process.env["TODOS_MODE"];
  delete process.env["TODOS_API_KEY"];
  resetConfig();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalTodosApiUrl === undefined) delete process.env["TODOS_API_URL"];
  else process.env["TODOS_API_URL"] = originalTodosApiUrl;
  if (originalTodosUrl === undefined) delete process.env["TODOS_URL"];
  else process.env["TODOS_URL"] = originalTodosUrl;
  if (originalTodosMode === undefined) delete process.env["TODOS_MODE"];
  else process.env["TODOS_MODE"] = originalTodosMode;
  if (originalTodosApiKey === undefined) delete process.env["TODOS_API_KEY"];
  else process.env["TODOS_API_KEY"] = originalTodosApiKey;
  resetConfig();
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("TodosClient remote API config", () => {
  test("uses local server URL by default", () => {
    const client = new TodosClient();
    expect(client.baseUrl).toBe("http://localhost:19427");
    expect(client.apiKey).toBeNull();
  });

  test("uses TODOS_API_URL and TODOS_API_KEY for remote mode", async () => {
    process.env["TODOS_API_URL"] = "https://todos.example/api/";
    process.env["TODOS_API_KEY"] = "env-token";
    let observedUrl = "";
    let observedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input);
      observedHeaders = init?.headers;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const client = new TodosClient();
    await client.tasks.list();

    expect(client.baseUrl).toBe("https://todos.example/api");
    expect(client.apiKey).toBe("env-token");
    expect(observedUrl).toBe("https://todos.example/api/api/tasks");
    expect((observedHeaders as Record<string, string>)["x-api-key"]).toBe("env-token");
  });

  test("uses config apiUrl and apiKey when env is absent", async () => {
    updateConfig({ apiUrl: "https://config.todos.example/", apiKey: "config-token" });
    let observedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = init?.headers;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const client = new TodosClient();
    await client.tasks.list();

    expect(client.baseUrl).toBe("https://config.todos.example");
    expect(client.apiKey).toBe("config-token");
    expect((observedHeaders as Record<string, string>)["x-api-key"]).toBe("config-token");
  });

  test("constructor options override remote env/config", () => {
    process.env["TODOS_API_URL"] = "https://env.todos.example";
    process.env["TODOS_API_KEY"] = "env-token";
    const client = new TodosClient({ baseUrl: "https://option.todos.example/", apiKey: "option-token" });
    expect(client.baseUrl).toBe("https://option.todos.example");
    expect(client.apiKey).toBe("option-token");
  });
});
