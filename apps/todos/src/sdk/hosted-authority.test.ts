import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodosClient } from "./client.js";
import { TodosAPIError } from "./types.js";
import { resetConfig, updateConfig } from "../lib/config.js";

const originalFetch = globalThis.fetch;
const originalPrimaryMode = process.env.HASNA_TODOS_STORAGE_MODE;
const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
const originalHome = process.env.HOME;
const originalTodosUrl = process.env.TODOS_URL;
const originalHostedApiUrl = process.env.HASNA_TODOS_API_URL;
const originalHostedApiKey = process.env.HASNA_TODOS_API_KEY;

function setStorageMode(primary: string, fallback = primary): void {
  process.env.HASNA_TODOS_STORAGE_MODE = primary;
  process.env.TODOS_STORAGE_MODE = fallback;
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restore("HASNA_TODOS_STORAGE_MODE", originalPrimaryMode);
  restore("TODOS_STORAGE_MODE", originalFallbackMode);
  restore("HOME", originalHome);
  restore("TODOS_URL", originalTodosUrl);
  restore("HASNA_TODOS_API_URL", originalHostedApiUrl);
  restore("HASNA_TODOS_API_KEY", originalHostedApiKey);
  resetConfig();
});

function expectHostedUnavailable(error: unknown): void {
  expect(error).toBeInstanceOf(TodosAPIError);
  expect(error).toMatchObject({
    status: 503,
    statusText: "Service Unavailable",
    body: { code: "HOSTED_AUTHORITY_UNAVAILABLE" },
  });
}

describe("Todos SDK hosted authority containment", () => {
  test("hosted construction reaches the process floor before hostile option getters", () => {
    setStorageMode("remote");
    let optionReads = 0;
    const options = new Proxy({}, {
      get() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_SDK_OPTION_GETTER_MARKER");
      },
      ownKeys() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_SDK_OPTION_OWN_KEYS_MARKER");
      },
    });

    let caught: unknown;
    try {
      new TodosClient(options);
    } catch (error) {
      caught = error;
    }

    expectHostedUnavailable(caught);
    expect(optionReads).toBe(0);
  });

  test("local construction translates hostile option values without coercion or side effects", () => {
    setStorageMode("local");
    let coercions = 0;
    const hostileBaseUrl = new Proxy({}, {
      get() {
        coercions += 1;
        throw new Error("FAKE_ONLY_SDK_VALUE_COERCION_MARKER");
      },
      ownKeys() {
        coercions += 1;
        throw new Error("FAKE_ONLY_SDK_VALUE_KEYS_MARKER");
      },
    });
    let caught: unknown;
    try {
      new TodosClient({ baseUrl: hostileBaseUrl } as unknown as ConstructorParameters<typeof TodosClient>[0]);
    } catch (error) {
      caught = error;
    }
    expectHostedUnavailable(caught);
    expect((caught as TodosAPIError).body).toMatchObject({ reason: "invalid_options" });
    expect((caught as Error).message).not.toContain("FAKE_ONLY");
    expect(coercions).toBe(0);
  });

  test("a remote base URL stops before every later option getter", () => {
    setStorageMode("local");
    const reads: PropertyKey[] = [];
    const options = new Proxy({}, {
      get(_target, key) {
        reads.push(key);
        if (key === "baseUrl") return "https://remote.example.test";
        throw new Error("FAKE_ONLY_LATE_SDK_OPTION_GETTER_MARKER");
      },
      ownKeys() {
        throw new Error("FAKE_ONLY_SDK_OPTION_OWN_KEYS_MARKER");
      },
    });

    let caught: unknown;
    try {
      new TodosClient(options);
    } catch (error) {
      caught = error;
    }

    expectHostedUnavailable(caught);
    expect((caught as TodosAPIError).body).toMatchObject({ reason: "non_loopback_api_url" });
    expect(reads).toEqual(["baseUrl"]);
  });

  test.each([
    ["hosted", "self_hosted", "self_hosted"],
    ["invalid", "invalid-mode", "invalid-mode"],
    ["conflicting", "local", "remote"],
  ])("%s construction returns typed 503 before config or fetch", (_label, primary, fallback) => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json([]);
    }) as typeof fetch;
    setStorageMode(primary, fallback);

    let caught: unknown;
    try {
      new TodosClient({ baseUrl: "https://todos.example.test", apiKey: "synthetic-key" });
    } catch (error) {
      caught = error;
    }

    expectHostedUnavailable(caught);
    expect(calls).toEqual([]);
  });

  test.each([
    ["explicit option", () => new TodosClient({ baseUrl: "https://remote.example.test", apiKey: "synthetic-key" })],
    ["local URL env", () => {
      process.env.TODOS_URL = "https://remote.example.test";
      return new TodosClient();
    }],
    ["dedicated hosted URL", () => {
      process.env.HASNA_TODOS_API_URL = "https://remote.example.test";
      return new TodosClient();
    }],
    ["dedicated hosted key", () => {
      process.env.HASNA_TODOS_API_KEY = "synthetic-hosted-intent";
      return new TodosClient();
    }],
  ] as const)("%s is denied locally with zero fetch", (_label, construct) => {
    setStorageMode("local");
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json([]);
    }) as typeof fetch;
    let caught: unknown;
    try {
      construct();
    } catch (error) {
      caught = error;
    }
    expectHostedUnavailable(caught);
    expect(calls).toEqual([]);
  });

  test("a configured non-loopback URL is denied before request or key assignment", () => {
    setStorageMode("local");
    const fakeHome = mkdtempSync(join(tmpdir(), "todos-sdk-hosted-config-"));
    process.env.HOME = fakeHome;
    resetConfig();
    updateConfig({ apiUrl: "https://remote.example.test", apiKey: "synthetic-config-key" });
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json([]);
    }) as typeof fetch;
    try {
      let caught: unknown;
      try {
        new TodosClient();
      } catch (error) {
        caught = error;
      }
      expectHostedUnavailable(caught);
      expect(calls).toEqual([]);
    } finally {
      resetConfig();
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test("fromEnv applies the same non-loopback boundary", () => {
    setStorageMode("local");
    process.env.TODOS_URL = "https://remote.example.test";
    let caught: unknown;
    try {
      TodosClient.fromEnv();
    } catch (error) {
      caught = error;
    }
    expectHostedUnavailable(caught);
  });

  test.each(["text", "json"] as const)("a post-construction hosted flip makes tasks.context terminal in %s mode", async (format) => {
    setStorageMode("local");
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19427", apiKey: "synthetic-key" });
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json([]);
    }) as typeof fetch;
    setStorageMode("remote");

    let caught: unknown;
    try {
      await client.tasks.context({ format });
    } catch (error) {
      caught = error;
    }

    expectHostedUnavailable(caught);
    expect(calls).toEqual([]);
  });

  test("a post-construction dedicated hosted API flip is terminal with zero fetch", async () => {
    setStorageMode("local");
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19427" });
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json([]);
    }) as typeof fetch;
    process.env.HASNA_TODOS_API_URL = "https://remote.example.test";
    let caught: unknown;
    try {
      await client.tasks.list();
    } catch (error) {
      caught = error;
    }
    expectHostedUnavailable(caught);
    expect(calls).toEqual([]);
  });

  test.each([
    "http://localhost:19427",
    "http://127.0.0.1:29427",
    "http://[::1]:19427",
  ])("loopback SDK base %s remains available", (baseUrl) => {
    setStorageMode("local");
    expect(new TodosClient({ baseUrl }).baseUrl).toBe(baseUrl);
  });

  test.each([
    "https://127.example.test",
    "https://127.0.0.1.example.test",
    "https://localhost.example.test",
    "http://localhost@remote.example.test",
  ])("an adversarial loopback-looking hostname is denied: %s", (baseUrl) => {
    setStorageMode("local");
    let caught: unknown;
    try {
      new TodosClient({ baseUrl, apiKey: "synthetic-key" });
    } catch (error) {
      caught = error;
    }
    expectHostedUnavailable(caught);
  });

  test.each([
    "http://127.0.0.2:19427",
    "http://127.255.255.254:19427",
  ])("an actual IPv4 loopback-range address remains local: %s", (baseUrl) => {
    setStorageMode("local");
    expect(new TodosClient({ baseUrl }).baseUrl).toBe(baseUrl);
  });

  test.each([
    "https://remote.example.test/api/tasks",
    "http://127.0.0.1:29428/api/tasks",
    "http://localhost:19427/api/tasks",
  ])("_fetchRaw rejects a non-loopback or cross-origin supplied URL before headers/fetch: %s", async (url) => {
    setStorageMode("local");
    const calls: Array<{ input: string; headers?: HeadersInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), headers: init?.headers });
      return Response.json([]);
    }) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19427", apiKey: "synthetic-key" });

    let caught: unknown;
    try {
      await client._fetchRaw(url);
    } catch (error) {
      caught = error;
    }

    expectHostedUnavailable(caught);
    expect(calls).toEqual([]);
  });

  test("_fetchRaw preserves same-origin loopback requests and headers", async () => {
    setStorageMode("local");
    const calls: Array<{ input: string; headers?: HeadersInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), headers: init?.headers });
      return Response.json([]);
    }) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://127.0.0.1:19427", apiKey: "synthetic-key" });

    await client._fetchRaw("http://127.0.0.1:19427/api/tasks");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("http://127.0.0.1:19427/api/tasks");
    expect(calls[0]?.headers).toMatchObject({ "x-api-key": "synthetic-key" });
  });

  test("the constructor guard is ordered before local config loading", () => {
    const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
    const constructorIndex = source.indexOf("constructor(options: TodosClientOptions = {})");
    const guardIndex = source.indexOf("assertTodosSdkLocalAuthority(explicitBaseUrl);", constructorIndex);
    const configIndex = source.indexOf("getLocalApiConfig();", constructorIndex);
    expect(constructorIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(constructorIndex);
    expect(configIndex).toBeGreaterThan(guardIndex);
  });
});
