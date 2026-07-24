import { describe, expect, test } from "bun:test";
import { dispatchV1Request, handleV1Request, type V1RequestDependencies } from "./v1.js";

function harness(environment: NodeJS.ProcessEnv = { HASNA_TODOS_STORAGE_MODE: "remote" }) {
  const calls = { verifier: 0, authenticate: 0, schema: 0, storage: 0 };
  const dependencies: V1RequestDependencies = {
    environment,
    getVerifier: () => {
      calls.verifier += 1;
      return {
        authenticate: async () => {
          calls.authenticate += 1;
          return {
            ok: true,
            principal: { kid: "synthetic-kid", app: "todos", agent: null, scopes: ["todos:*"] },
          };
        },
      } as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>;
    },
    ensureSchema: async () => {
      calls.schema += 1;
      throw new Error("schema access must remain unreachable");
    },
    getStorageAdapter: () => {
      calls.storage += 1;
      throw new Error("storage access must remain unreachable");
    },
  };

  return {
    calls,
    async request(
      path: string,
      options: { method?: string; headers?: HeadersInit; body?: unknown } = {},
    ): Promise<Response> {
      const url = new URL(`https://todos.example.test${path}`);
      const response = await handleV1Request(
        new Request(url, {
          method: options.method ?? "GET",
          headers: { "content-type": "application/json", ...(options.headers ?? {}) },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        }),
        url,
        dependencies,
      );
      if (!response) throw new Error("expected /v1 response");
      return response;
    },
  };
}

describe("/v1 Stage-A hosted authority floor", () => {
  test("the direct dispatcher enforces process authority before URL, request, or dependency claims", async () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let urlReads = 0;
    let dependencyReads = 0;
    let requestReads = 0;
    const request = new Proxy(new Request("https://todos.example.test/v1/tasks"), {
      get() {
        requestReads += 1;
        throw new Error("FAKE_ONLY_DIRECT_V1_REQUEST_MARKER");
      },
    });
    const url = new Proxy(new URL("https://todos.example.test/v1/tasks"), {
      get() {
        urlReads += 1;
        throw new Error("FAKE_ONLY_DIRECT_V1_URL_MARKER");
      },
    });
    const dependencies = new Proxy({}, {
      get() {
        dependencyReads += 1;
        throw new Error("FAKE_ONLY_DIRECT_V1_DEPENDENCY_MARKER");
      },
      ownKeys() {
        dependencyReads += 1;
        throw new Error("FAKE_ONLY_DIRECT_V1_DEPENDENCY_KEYS_MARKER");
      },
    });
    try {
      const response = await dispatchV1Request(request, url, dependencies);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toMatchObject({ code: "HOSTED_AUTHORITY_UNAVAILABLE" });
      expect({ requestReads, urlReads, dependencyReads }).toEqual({
        requestReads: 0,
        urlReads: 0,
        dependencyReads: 0,
      });
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("the direct dispatcher cannot turn local process authority into hosted datastore authority", async () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let requestReads = 0;
    let urlReads = 0;
    let dependencyReads = 0;
    const request = new Proxy(new Request("https://todos.example.test/v1/tasks"), {
      get() {
        requestReads += 1;
        throw new Error("FAKE_ONLY_LOCAL_DIRECT_V1_REQUEST_MARKER");
      },
    });
    const url = new Proxy(new URL("https://todos.example.test/v1/tasks"), {
      get() {
        urlReads += 1;
        throw new Error("FAKE_ONLY_LOCAL_DIRECT_V1_URL_MARKER");
      },
    });
    const dependencies = new Proxy({}, {
      get() {
        dependencyReads += 1;
        throw new Error("FAKE_ONLY_LOCAL_DIRECT_V1_DEPENDENCY_MARKER");
      },
      ownKeys() {
        dependencyReads += 1;
        throw new Error("FAKE_ONLY_LOCAL_DIRECT_V1_DEPENDENCY_KEYS_MARKER");
      },
    });
    try {
      const response = await dispatchV1Request(request, url, dependencies);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toMatchObject({
        code: "HOSTED_AUTHORITY_UNAVAILABLE",
        reason: "authority_resolver_unavailable",
      });
      expect({ requestReads, urlReads, dependencyReads }).toEqual({
        requestReads: 0,
        urlReads: 0,
        dependencyReads: 0,
      });
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("the process-role floor precedes hostile URL and dependency option proxies", async () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    let urlReads = 0;
    let dependencyReads = 0;
    const hostileUrl = new Proxy(new URL("https://todos.example.test/v1/tasks"), {
      get() {
        urlReads += 1;
        throw new Error("FAKE_ONLY_V1_URL_GETTER_MARKER");
      },
    });
    const hostileDependencies = new Proxy({}, {
      get() {
        dependencyReads += 1;
        throw new Error("FAKE_ONLY_V1_DEPENDENCY_GETTER_MARKER");
      },
      ownKeys() {
        dependencyReads += 1;
        throw new Error("FAKE_ONLY_V1_DEPENDENCY_OWN_KEYS_MARKER");
      },
    });
    try {
      const response = await handleV1Request(
        new Request("https://todos.example.test/v1/tasks"),
        hostileUrl,
        hostileDependencies,
      );
      expect(response?.status).toBe(503);
      expect(urlReads).toBe(0);
      expect(dependencyReads).toBe(0);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
    }
  });

  test.each([
    { HASNA_TODOS_STORAGE_MODE: "remote" },
    { HASNA_TODOS_STORAGE_MODE: "self_hosted" },
    { HASNA_TODOS_STORAGE_MODE: "cloud" },
    { HASNA_TODOS_STORAGE_MODE: "hybrid" },
    { HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos" },
    { HASNA_TODOS_STORAGE_MODE: "invalid" },
    { HASNA_TODOS_STORAGE_MODE: "local", TODOS_STORAGE_MODE: "remote" },
  ])("returns constant 503 before verifier, schema, or storage for %j", async (environment) => {
    const testHarness = harness(environment);
    const response = await testHarness.request("/v1/tasks");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "HOSTED_AUTHORITY_UNAVAILABLE",
      reason: "authority_resolver_unavailable",
    });
    expect(testHarness.calls).toEqual({ verifier: 0, authenticate: 0, schema: 0, storage: 0 });
  });

  test.each([
    ["header tenant", "/v1/tasks", { headers: { "x-tenant-id": "synthetic-tenant" } }],
    ["header project", "/v1/tasks", { headers: { "x-project-id": "synthetic-project" } }],
    ["query authority", "/v1/tasks?authority=synthetic-authority", {}],
  ] as const)("rejects caller authority from %s before every dependency", async (_label, path, options) => {
    const testHarness = harness();
    const response = await testHarness.request(path, options);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "CALLER_AUTHORITY_REJECTED" });
    expect(testHarness.calls).toEqual({ verifier: 0, authenticate: 0, schema: 0, storage: 0 });
  });

  test.each([
    ["query project selector", "/v1/tasks?project_id=synthetic-project", {}],
    ["query tenant selector", "/v1/tasks?tenant_id=synthetic-tenant", {}],
    ["body tenant data", "/v1/tasks", { method: "POST", body: { title: "synthetic", tenant_id: "synthetic-tenant" } }],
    ["top-level principal body is never consumed", "/v1/tasks", { method: "POST", body: { title: "synthetic", principal: "synthetic-principal" } }],
    ["body project selector", "/v1/tasks", { method: "POST", body: { title: "synthetic", project_id: "synthetic-project" } }],
    [
      "nested metadata claims",
      "/v1/import",
      {
        method: "POST",
        body: { metadata: { authority: "ordinary-data", principal: "ordinary-data", org: "synthetic-org" } },
      },
    ],
  ] as const)("treats %s as data and still reaches constant 503", async (_label, path, options) => {
    const testHarness = harness();
    const response = await testHarness.request(path, options);

    expect(response.status).toBe(503);
    expect(testHarness.calls).toEqual({ verifier: 0, authenticate: 0, schema: 0, storage: 0 });
  });

  test("foreign and nonexistent direct IDs are indistinguishable", async () => {
    const testHarness = harness();
    const foreignResponse = await testHarness.request("/v1/tasks/foreign-synthetic-id");
    const missingResponse = await testHarness.request("/v1/tasks/nonexistent-synthetic-id");

    expect(foreignResponse.status).toBe(503);
    expect(missingResponse.status).toBe(503);
    expect(await foreignResponse.text()).toBe(await missingResponse.text());
    expect(testHarness.calls).toEqual({ verifier: 0, authenticate: 0, schema: 0, storage: 0 });
  });

  test.each([
    ["task list/search", "/v1/tasks", "GET"],
    ["task context direct ID", "/v1/tasks/synthetic-id", "GET"],
    ["projects/project-panel source", "/v1/projects", "GET"],
    ["plans", "/v1/plans", "GET"],
    ["reports/activity", "/v1/activity", "GET"],
    ["task lists", "/v1/task-lists", "GET"],
    ["dependency index", "/v1/dependencies", "GET"],
    ["commit artifact lookup", "/v1/commits/synthetic-sha", "GET"],
    ["reference index", "/v1/refs/synthetic-ref", "GET"],
    ["queue job selection", "/v1/next", "GET"],
    ["stats/report", "/v1/stats", "GET"],
    ["bulk import", "/v1/import", "POST"],
  ] as const)("contains hosted %s before every dependency", async (_label, path, method) => {
    const testHarness = harness();
    const response = await testHarness.request(path, { method, body: method === "POST" ? {} : undefined });

    expect(response.status).toBe(503);
    expect(testHarness.calls).toEqual({ verifier: 0, authenticate: 0, schema: 0, storage: 0 });
  });
});
