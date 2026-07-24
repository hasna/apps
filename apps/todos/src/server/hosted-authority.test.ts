import { describe, expect, test } from "bun:test";
import {
  containHostedDatastoreSurface,
  hostedReadinessResponse,
  rejectCallerAuthorityClaims,
} from "./hosted-authority.js";
import { resolveStartServerOptions, startServer } from "./serve.js";

describe("Todos hosted surface containment", () => {
  test("the process-role floor precedes hostile request access", async () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    let requestReads = 0;
    const request = new Proxy({}, {
      get() {
        requestReads += 1;
        throw new Error("FAKE_ONLY_REQUEST_GETTER_MARKER");
      },
      ownKeys() {
        requestReads += 1;
        throw new Error("FAKE_ONLY_REQUEST_OWN_KEYS_MARKER");
      },
    }) as Request;
    try {
      const response = await containHostedDatastoreSurface(request);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toMatchObject({ code: "HOSTED_AUTHORITY_UNAVAILABLE" });
      expect(requestReads).toBe(1);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
    }
  });

  test("a local process translates a hostile request URL after one bounded read", async () => {
    const originalHasnaMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let requestReads = 0;
    const request = new Proxy({}, {
      get() {
        requestReads += 1;
        throw new Error("FAKE_ONLY_LOCAL_REQUEST_GETTER_MARKER");
      },
      ownKeys() {
        requestReads += 1;
        throw new Error("FAKE_ONLY_LOCAL_REQUEST_OWN_KEYS_MARKER");
      },
    }) as Request;
    try {
      const response = await containHostedDatastoreSurface(request, {
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "local",
      });
      expect(response?.status).toBe(503);
      const body = await response?.text();
      expect(body).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(body).not.toContain("FAKE_ONLY");
      expect(requestReads).toBe(1);
    } finally {
      if (originalHasnaMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalHasnaMode;
      if (originalFallbackMode === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallbackMode;
    }
  });

  test("hosted server startup reaches the process floor without reading options", () => {
    const originalHasnaMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let optionReads = 0;
    const options = new Proxy({}, {
      get() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_SERVER_OPTIONS_MARKER");
      },
      ownKeys() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_SERVER_OPTIONS_KEYS_MARKER");
      },
    });
    try {
      const resolved = resolveStartServerOptions(options);
      expect(resolved.storageRole.role).toBe("hosted");
      expect(resolved.shouldOpen).toBe(false);
      expect(resolved.apiKey).toBeNull();
      expect(optionReads).toBe(0);
    } finally {
      if (originalHasnaMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalHasnaMode;
      if (originalFallbackMode === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallbackMode;
    }
  });

  test("direct hosted startup rejects asynchronously before Bun.serve or caller options", async () => {
    const originalHasnaMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
    const originalServe = Bun.serve;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let optionReads = 0;
    let serveCalls = 0;
    const options = new Proxy({}, {
      get() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_DIRECT_SERVER_OPTIONS_MARKER");
      },
      ownKeys() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_DIRECT_SERVER_OPTIONS_KEYS_MARKER");
      },
    });
    (Bun as unknown as { serve: typeof Bun.serve }).serve = ((..._args: Parameters<typeof Bun.serve>) => {
      serveCalls += 1;
      throw new Error("FAKE_ONLY_BUN_SERVE_MARKER");
    }) as typeof Bun.serve;

    try {
      let pending: Promise<void> | undefined;
      expect(() => {
        pending = startServer(19427, options);
      }).not.toThrow();
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending!).rejects.toMatchObject({
        code: "HOSTED_AUTHORITY_UNAVAILABLE",
        reason: "explicit_hosted",
      });
      expect(optionReads).toBe(0);
      expect(serveCalls).toBe(0);
    } finally {
      (Bun as unknown as { serve: typeof Bun.serve }).serve = originalServe;
      if (originalHasnaMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalHasnaMode;
      if (originalFallbackMode === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallbackMode;
    }
  });

  test("a local process snapshots an own environment option without invoking proxy getters", () => {
    const originalHasnaMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let optionReads = 0;
    const options = new Proxy({
      environment: {
        HASNA_TODOS_STORAGE_MODE: "remote",
        TODOS_STORAGE_MODE: "remote",
      },
    }, {
      get(target, key, receiver) {
        optionReads += 1;
        if (key !== "environment") throw new Error("FAKE_ONLY_LATE_SERVER_OPTION_MARKER");
        return Reflect.get(target, key, receiver);
      },
      ownKeys() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_SERVER_OPTIONS_KEYS_MARKER");
      },
    });
    try {
      const resolved = resolveStartServerOptions(options);
      expect(resolved.storageRole.role).toBe("hosted");
      expect(resolved.shouldOpen).toBe(false);
      expect(optionReads).toBe(0);
    } finally {
      if (originalHasnaMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalHasnaMode;
      if (originalFallbackMode === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallbackMode;
    }
  });

  test("server option and environment accessors are rejected without invocation", () => {
    const originalHasnaMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let reads = 0;
    const environment = Object.defineProperty({}, "HASNA_TODOS_STORAGE_MODE", {
      enumerable: true,
      get() {
        reads += 1;
        return "local";
      },
    }) as NodeJS.ProcessEnv;
    const options = Object.defineProperty({}, "environment", {
      enumerable: true,
      get() {
        reads += 1;
        return environment;
      },
    });
    try {
      expect(() => resolveStartServerOptions(options)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(reads).toBe(0);
    } finally {
      if (originalHasnaMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalHasnaMode;
      if (originalFallbackMode === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallbackMode;
    }
  });

  test("a process-role denial during option snapshot prevents the dashboard listener", async () => {
    const originalHasnaMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
    const originalServe = Bun.serve;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let serveCalls = 0;
    const options = new Proxy({
      open: false,
      host: "127.0.0.1",
      environment: {
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "local",
      },
    }, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "host") {
          process.env.HASNA_TODOS_STORAGE_MODE = "remote";
          process.env.TODOS_STORAGE_MODE = "remote";
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    (Bun as unknown as { serve: typeof Bun.serve }).serve = ((..._args: Parameters<typeof Bun.serve>) => {
      serveCalls += 1;
      throw new Error("FAKE_ONLY_DASHBOARD_LISTENER_STARTED");
    }) as typeof Bun.serve;
    try {
      await expect(startServer(19428, options)).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(serveCalls).toBe(0);
    } finally {
      (Bun as unknown as { serve: typeof Bun.serve }).serve = originalServe;
      if (originalHasnaMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalHasnaMode;
      if (originalFallbackMode === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallbackMode;
    }
  });

  test("Stage A status matrix stops at untrusted 503 and forged-claim 400, never synthetic 403", async () => {
    const ordinary = await containHostedDatastoreSurface(
      new Request("https://todos.example.test/api/tasks"),
      { HASNA_TODOS_STORAGE_MODE: "remote" },
    );
    const forged = await containHostedDatastoreSurface(
      new Request("https://todos.example.test/api/tasks", {
        headers: { "x-principal-id": "caller-forged-principal" },
      }),
      { HASNA_TODOS_STORAGE_MODE: "remote" },
    );

    expect(ordinary?.status).toBe(503);
    expect(forged?.status).toBe(400);
    expect([ordinary?.status, forged?.status]).not.toContain(403);
  });

  test.each(["remote", "self_hosted", "cloud", "hybrid"])(
    "%s intent blocks API and MCP without requiring a DSN",
    async (mode) => {
      const env = { HASNA_TODOS_STORAGE_MODE: mode };
      for (const path of ["/api/tasks", "/api/tasks/context", "/api/tasks/export", "/api/reports", "/mcp"]) {
        const response = await containHostedDatastoreSurface(
          new Request(`https://todos.example.test${path}`),
          env,
        );
        expect(response?.status).toBe(503);
        expect(await response?.json()).toMatchObject({ code: "HOSTED_AUTHORITY_UNAVAILABLE" });
      }
    },
  );

  test("invalid, conflicting, and no-mode service DSN configurations fail closed", async () => {
    for (const env of [
      { HASNA_TODOS_STORAGE_MODE: "invalid" },
      { HASNA_TODOS_STORAGE_MODE: "local", TODOS_STORAGE_MODE: "remote" },
      { HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos" },
    ]) {
      expect((await containHostedDatastoreSurface(
        new Request("https://todos.example.test/api/tasks"),
        env,
      ))?.status).toBe(503);
    }
  });

  test("explicit local stays local with a shadow DSN and ignores unrelated DATABASE_URL", async () => {
    for (const env of [
      {
        HASNA_TODOS_STORAGE_MODE: "local",
        HASNA_TODOS_SHADOW: "1",
        HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
      },
      { DATABASE_URL: "postgres://synthetic.invalid/unrelated" },
    ]) {
      expect(await containHostedDatastoreSurface(
        new Request("https://todos.example.test/api/tasks"),
        env,
      )).toBeNull();
    }
  });

  test("request containment re-evaluates a local-to-hosted role flip", async () => {
    const environment = { HASNA_TODOS_STORAGE_MODE: "local" };
    const request = new Request("https://todos.example.test/api/tasks");
    expect(await containHostedDatastoreSurface(request, environment)).toBeNull();
    environment.HASNA_TODOS_STORAGE_MODE = "remote";
    expect((await containHostedDatastoreSurface(request, environment))?.status).toBe(503);
  });

  test("reserved claim channels are rejected but selector and metadata fields are data", async () => {
    const forgedHeader = await rejectCallerAuthorityClaims(new Request("https://todos.example.test/api/tasks", {
      headers: { "x-project-id": "synthetic-project" },
    }));
    expect(forgedHeader?.status).toBe(400);

    const topLevelClaim = await rejectCallerAuthorityClaims(new Request("https://todos.example.test/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal: { id: "synthetic-principal" } }),
    }));
    expect(topLevelClaim).toBeNull();

    for (const request of [
      new Request("https://todos.example.test/api/tasks?project_id=synthetic-project"),
      new Request("https://todos.example.test/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: "synthetic-project",
          metadata: { authority: "ordinary-data", principal: "ordinary-data" },
        }),
      }),
    ]) {
      expect(await rejectCallerAuthorityClaims(request)).toBeNull();
      expect((await containHostedDatastoreSurface(request, { HASNA_TODOS_STORAGE_MODE: "remote" }))?.status).toBe(503);
    }
  });

  test("hosted denial does not pull an unfinished request body", async () => {
    let pulls = 0;
    let release: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        return new Promise<void>((resolve) => {
          release = () => {
            controller.close();
            resolve();
          };
        });
      },
    });
    const request = new Request("https://todos.example.test/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const pending = containHostedDatastoreSurface(request, { HASNA_TODOS_STORAGE_MODE: "remote" });
    try {
      const result = await Promise.race([
        pending,
        Bun.sleep(50).then(() => null),
      ]);
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(503);
      expect(request.bodyUsed).toBe(false);
    } finally {
      release?.();
      await pending;
    }
  });

  test("tenant_id is inert Stage-A data and never authority or access proof", async () => {
    for (const request of [
      new Request("https://todos.example.test/api/tasks?tenant_id=synthetic-tenant"),
      new Request("https://todos.example.test/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: "synthetic-tenant", project_id: "synthetic-project" }),
      }),
    ]) {
      expect(await rejectCallerAuthorityClaims(request)).toBeNull();
      expect((await containHostedDatastoreSurface(request, { HASNA_TODOS_STORAGE_MODE: "remote" }))?.status).toBe(503);
    }
  });

  test("hosted readiness fails while liveness can remain healthy", async () => {
    const ready = hostedReadinessResponse("1.2.3", "remote");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ status: "unavailable", mode: "remote" });

    const health = Response.json({ status: "ok", version: "1.2.3", mode: "remote", name: "todos" });
    expect(health.status).toBe(200);
  });
});
