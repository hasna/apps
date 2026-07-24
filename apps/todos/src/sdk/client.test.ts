import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { TodosClient } from "./client.js";
import { TodosTimeoutError } from "./types.js";
import { resetConfig, updateConfig } from "../lib/config.js";

const originalHome = process.env["HOME"];
const originalTodosApiUrl = process.env["TODOS_API_URL"];
const originalTodosUrl = process.env["TODOS_URL"];
const originalTodosMode = process.env["TODOS_MODE"];
const originalTodosApiKey = process.env["TODOS_API_KEY"];
const originalFetch = globalThis.fetch;

let fakeHome: string;

const REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const;

interface RedirectTestClient {
  tasks: { list(): Promise<unknown> };
  _fetchRaw(url: string, init?: RequestInit): Promise<Response>;
}

type RedirectTestClientConstructor = new (options: {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}) => RedirectTestClient;

type TimeoutErrorConstructor = new (ms: number) => Error & { ms: number };

async function expectRawTimeoutContract(
  Client: RedirectTestClientConstructor,
  TimeoutError: TimeoutErrorConstructor,
): Promise<void> {
  const previousFetch = globalThis.fetch;
  const previousClearTimeout = globalThis.clearTimeout;
  let timerClears = 0;
  let observedSignal: AbortSignal | null = null;
  try {
    globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
      timerClears += 1;
      return previousClearTimeout(handle);
    }) as typeof clearTimeout;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? null;
      throw new DOMException("synthetic raw abort", "AbortError");
    }) as typeof fetch;

    const client = new Client({
      baseUrl: "http://localhost:19427",
      apiKey: "synthetic-local-key",
      timeout: 37,
    });
    let operation: Promise<Response> | undefined;
    expect(() => {
      operation = client._fetchRaw("http://localhost:19427/raw-timeout");
    }).not.toThrow();
    expect(operation).toBeInstanceOf(Promise);
    await expect(operation!).rejects.toBeInstanceOf(TimeoutError);
    await expect(operation!).rejects.toMatchObject({
      name: "TodosTimeoutError",
      message: "Request timed out after 37ms",
      ms: 37,
    });
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(timerClears).toBe(1);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.clearTimeout = previousClearTimeout;
  }
}

async function expectRedirectContract(Client: RedirectTestClientConstructor): Promise<void> {
  for (const status of REDIRECT_STATUSES) {
    for (const surface of ["tasks.list", "raw"] as const) {
      const targetRequests: Array<{ apiKey: string | null; url: string }> = [];
      const sourceRequests: Array<{ apiKey: string | null; method: string }> = [];
      const target = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          targetRequests.push({
            apiKey: request.headers.get("x-api-key"),
            url: request.url,
          });
          return surface === "tasks.list"
            ? Response.json([])
            : new Response("redirected raw response");
        },
      });
      const redirector = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          sourceRequests.push({
            apiKey: request.headers.get("x-api-key"),
            method: request.method,
          });
          return new Response(null, {
            status,
            headers: { location: `http://127.0.0.1:${target.port}/credential-target` },
          });
        },
      });

      try {
        const baseUrl = `http://127.0.0.1:${redirector.port}`;
        const client = new Client({ baseUrl, apiKey: "synthetic-local-key" });
        const operation = surface === "tasks.list"
          ? client.tasks.list()
          : client._fetchRaw(`${baseUrl}/raw`, {
              method: "POST",
              body: "raw request body",
              headers: { "content-type": "text/plain" },
            });

        await expect(operation).rejects.toMatchObject({
          status: 503,
          body: {
            code: "HOSTED_AUTHORITY_UNAVAILABLE",
            reason: "cross_origin_request_url",
          },
        });
        expect(sourceRequests).toEqual([{
          apiKey: "synthetic-local-key",
          method: surface === "tasks.list" ? "GET" : "POST",
        }]);
        expect(targetRequests).toEqual([]);
      } finally {
        redirector.stop(true);
        target.stop(true);
      }
    }
  }

  for (const status of REDIRECT_STATUSES) {
    const redirectedRequests: Array<{
      apiKey: string | null;
      path: string;
      method: string;
      body: string;
    }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/redirected/")) {
          redirectedRequests.push({
            apiKey: request.headers.get("x-api-key"),
            path: url.pathname,
            method: request.method,
            body: await request.text(),
          });
          return url.pathname === "/redirected/tasks"
            ? Response.json([{ id: "same-origin" }])
            : new Response("same-origin raw response");
        }
        return new Response(null, {
          status,
          headers: {
            location: url.pathname === "/api/tasks" ? "/redirected/tasks" : "/redirected/raw",
          },
        });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const client = new Client({ baseUrl, apiKey: "synthetic-local-key" });
      await expect(client.tasks.list()).resolves.toEqual([{ id: "same-origin" }]);
      await expect((await client._fetchRaw(`${baseUrl}/raw`, {
        method: "POST",
        body: "raw request body",
        headers: { "content-type": "text/plain" },
      })).text()).resolves.toBe("same-origin raw response");
      expect(redirectedRequests).toEqual([
        {
          apiKey: "synthetic-local-key",
          path: "/redirected/tasks",
          method: "GET",
          body: "",
        },
        {
          apiKey: "synthetic-local-key",
          path: "/redirected/raw",
          method: status === 301 || status === 302 || status === 303 ? "GET" : "POST",
          body: status === 301 || status === 302 || status === 303 ? "" : "raw request body",
        },
      ]);
    } finally {
      server.stop(true);
    }
  }

  let hopRequests = 0;
  const looping = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      hopRequests += 1;
      const url = new URL(request.url);
      const hop = Number(url.searchParams.get("hop") ?? "0");
      return new Response(null, {
        status: 302,
        headers: { location: `/api/tasks?hop=${hop + 1}` },
      });
    },
  });
  try {
    const client = new Client({
      baseUrl: `http://127.0.0.1:${looping.port}`,
      apiKey: "synthetic-local-key",
    });
    await expect(client.tasks.list()).rejects.toMatchObject({
      status: 503,
      body: {
        code: "HOSTED_AUTHORITY_UNAVAILABLE",
        reason: "too_many_redirects",
      },
    });
    expect(hopRequests).toBeLessThanOrEqual(6);
  } finally {
    looping.stop(true);
  }

  await expectRedirectBodyContainment(Client);
}

function trackedRedirectResponse(
  status: number,
  onCancel: () => void,
  options: { location?: string; cancelError?: Error; cancelPromise?: Promise<void> } = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("redirect response body"));
    },
    cancel() {
      onCancel();
      if (options.cancelError) throw options.cancelError;
      return options.cancelPromise;
    },
  });
  return new Response(body, {
    status,
    headers: options.location === undefined ? undefined : { location: options.location },
  });
}

async function expectRedirectBodyContainment(Client: RedirectTestClientConstructor): Promise<void> {
  const previousFetch = globalThis.fetch;
  try {
    for (const scenario of [
      { name: "cross-origin", location: "http://127.0.0.1:65530/elsewhere", reason: undefined },
      { name: "missing Location", location: undefined, reason: "invalid_redirect_url" },
      { name: "malformed Location", location: "http://[", reason: "invalid_redirect_url" },
    ] as const) {
      let cancellations = 0;
      globalThis.fetch = (async () => trackedRedirectResponse(302, () => { cancellations += 1; }, {
        location: scenario.location,
        cancelError: scenario.name === "missing Location" ? new Error("synthetic cancellation failure") : undefined,
      })) as typeof fetch;
      const client = new Client({ baseUrl: "http://localhost:19427", apiKey: "synthetic-local-key" });
      const rejection = expect(client.tasks.list()).rejects;
      if (scenario.reason) {
        await rejection.toMatchObject({ body: { reason: scenario.reason } });
      } else {
        await rejection.toThrow();
      }
      expect(cancellations).toBe(1);
    }

    let successFetches = 0;
    let successCancellations = 0;
    globalThis.fetch = (async () => {
      successFetches += 1;
      if (successFetches === 1) {
        return trackedRedirectResponse(301, () => { successCancellations += 1; }, {
          location: "/redirected/tasks",
          cancelError: new Error("synthetic cancellation failure"),
        });
      }
      return Response.json([{ id: "contained" }]);
    }) as typeof fetch;
    const successful = new Client({ baseUrl: "http://localhost:19427", apiKey: "synthetic-local-key" });
    await expect(successful.tasks.list()).resolves.toEqual([{ id: "contained" }]);
    expect(successFetches).toBe(2);
    expect(successCancellations).toBe(1);

    let loopFetches = 0;
    let loopCancellations = 0;
    globalThis.fetch = (async () => {
      loopFetches += 1;
      return trackedRedirectResponse(302, () => { loopCancellations += 1; }, {
        location: `/api/tasks?hop=${loopFetches}`,
      });
    }) as typeof fetch;
    const looping = new Client({ baseUrl: "http://localhost:19427", apiKey: "synthetic-local-key" });
    await expect(looping.tasks.list()).rejects.toMatchObject({
      body: { reason: "too_many_redirects" },
    });
    expect(loopFetches).toBe(6);
    expect(loopCancellations).toBe(6);

    for (const status of REDIRECT_STATUSES) {
      let cancellations = 0;
      globalThis.fetch = (async () => trackedRedirectResponse(status, () => { cancellations += 1; }, {
        cancelPromise: new Promise<void>(() => {}),
      })) as typeof fetch;
      const client = new Client({ baseUrl: "http://localhost:19427", apiKey: "synthetic-local-key" });
      const timeoutMarker = Symbol("redirect cancellation timed out");
      const outcome = await Promise.race([
        client.tasks.list().then(
          () => new Error("redirect unexpectedly resolved"),
          (error: unknown) => error,
        ),
        Bun.sleep(150).then(() => timeoutMarker),
      ]);

      expect(outcome, `HTTP ${status} waited for body cancellation`).not.toBe(timeoutMarker);
      expect(outcome).toMatchObject({
        status: 503,
        body: {
          code: "HOSTED_AUTHORITY_UNAVAILABLE",
          reason: "invalid_redirect_url",
        },
      });
      expect(cancellations).toBe(1);
    }

    let streamCancellations = 0;
    globalThis.fetch = (async () => trackedRedirectResponse(307, () => { streamCancellations += 1; }, {
      location: "/redirected-stream",
    })) as typeof fetch;
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("request body"));
      },
    });
    const streaming = new Client({ baseUrl: "http://localhost:19427", apiKey: "synthetic-local-key" });
    await expect(streaming._fetchRaw("http://localhost:19427/stream", {
      method: "PATCH",
      body: streamBody,
      duplex: "half",
    } as RequestInit)).rejects.toMatchObject({
      body: { reason: "unreplayable_redirect_body" },
    });
    expect(streamCancellations).toBe(1);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "todos-sdk-local-"));
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

describe("TodosClient local API config", () => {
  test("uses local server URL by default", () => {
    const client = new TodosClient();
    expect(client.baseUrl).toBe("http://localhost:19427");
    expect(client.apiKey).toBeNull();
  });

  test("ignores unsupported legacy remote env vars by default", () => {
    process.env["TODOS_API_URL"] = "https://todos.example/api/";
    process.env["TODOS_MODE"] = "remote";
    process.env["TODOS_API_KEY"] = "env-token";

    const client = new TodosClient();

    expect(client.baseUrl).toBe("http://localhost:19427");
    expect(client.apiKey).toBe("env-token");
  });

  test("uses local config apiUrl and apiKey when env is absent", async () => {
    updateConfig({ apiUrl: "http://127.0.0.1:19427/", apiKey: "config-token" });
    let observedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = init?.headers;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const client = new TodosClient();
    await client.tasks.list();

    expect(client.baseUrl).toBe("http://127.0.0.1:19427");
    expect(client.apiKey).toBe("config-token");
    expect((observedHeaders as Record<string, string>)["x-api-key"]).toBe("config-token");
  });

  test("constructor options override local env/config", () => {
    process.env["TODOS_URL"] = "http://localhost:19429";
    process.env["TODOS_API_KEY"] = "env-token";
    const client = new TodosClient({ baseUrl: "http://localhost:19428/", apiKey: "option-token" });
    expect(client.baseUrl).toBe("http://localhost:19428");
    expect(client.apiKey).toBe("option-token");
  });

  // M8: a 4-byte JSON body (`true`) must parse to the value, not be dropped.
  test("does not drop a 4-byte `true` response body as null", async () => {
    globalThis.fetch = (async () =>
      new Response("true", { status: 200, headers: { "content-length": "4" } })) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "k" });
    const result = await client._get<boolean>("/api/some-boolean");
    expect(result).toBe(true);
  });

  test("still returns null for a genuinely empty body", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 200, headers: { "content-length": "0" } })) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "k" });
    const result = await client._get<unknown>("/api/empty");
    expect(result).toBeNull();
  });

  test.each([
    ["text", ""],
    ["compact", ""],
    ["json", {}],
  ] as const)("tasks.context preserves the base local HTTP-failure fallback for %s", async (format, fallback) => {
    globalThis.fetch = (async () => Response.json(
      { error: "synthetic local failure" },
      { status: 500, statusText: "Synthetic Failure" },
    )) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "synthetic-local-key" });

    await expect(client.tasks.context({ format })).resolves.toEqual(fallback);
  });

  test.each([
    ["text", ""],
    ["compact", ""],
    ["json", {}],
  ] as const)("tasks.context preserves the base local network-failure fallback for %s", async (format, fallback) => {
    globalThis.fetch = (async () => {
      throw new Error("FAKE_ONLY_LOCAL_CONTEXT_NETWORK_FAILURE");
    }) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "synthetic-local-key" });

    await expect(client.tasks.context({ format })).resolves.toEqual(fallback);
  });

  // M9: subscribe() must send auth headers (x-api-key), not a bare fetch.
  test("subscribe() sends the api key header", async () => {
    let observedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = (init?.headers as Record<string, string>) ?? {};
      // Empty SSE stream that closes immediately.
      const body = new ReadableStream({ start(controller) { controller.close(); } });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "sekret" });
    // Drain the generator (closes immediately).
    for await (const _ of client.tasks.subscribe({ agentId: "a" })) { /* no events */ }
    expect(observedHeaders["x-api-key"]).toBe("sekret");
  });

  test("source SDK revalidates every redirect before forwarding credentials", async () => {
    await expectRedirectContract(TodosClient);
  });

  test("source SDK translates raw AbortError and clears its timeout", async () => {
    await expectRawTimeoutContract(TodosClient, TodosTimeoutError);
  });

  test("built SDK revalidates every redirect before forwarding credentials", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "todos-sdk-redirect-build-"));
    try {
      const build = Bun.spawnSync([
        "bun", "build", "src/sdk/index.ts", "--outdir", outputRoot, "--target", "bun",
      ], {
        cwd: join(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(build.exitCode).toBe(0);
      expect(build.stderr.toString()).not.toContain("error:");
      const built = await import(
        `${pathToFileURL(join(outputRoot, "index.js")).href}?redirect-contract=${Date.now()}`
      ) as {
        TodosClient: RedirectTestClientConstructor;
        TodosTimeoutError: TimeoutErrorConstructor;
      };
      await expectRedirectContract(built.TodosClient);
      await expectRawTimeoutContract(built.TodosClient, built.TodosTimeoutError);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
