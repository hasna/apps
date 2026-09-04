import { describe, expect, it } from "bun:test";
import {
  HasnaHttpError,
  defaultCloudBaseUrl,
  resolveClientTransport,
  type HasnaHttpTransport,
} from "../src/store/contracts-client/transport.js";
import {
  createHasnaStorageClient,
  resolveStorageClient,
} from "../src/store/contracts-client/storage.js";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  options?: any;
}

function fakeTransport(handler: (call: Call) => unknown | Promise<unknown>): { transport: HasnaHttpTransport; calls: Call[] } {
  const calls: Call[] = [];
  const invoke = async (method: string, path: string, body?: unknown, options?: any) => {
    const call = { method, path, body, options };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    transport: {
      baseUrl: "https://demo.test/v1",
      request: invoke as HasnaHttpTransport["request"],
      get: ((path: string, options?: any) => invoke("GET", path, undefined, options)) as HasnaHttpTransport["get"],
      post: ((path: string, body?: unknown, options?: any) => invoke("POST", path, body, options)) as HasnaHttpTransport["post"],
      put: ((path: string, body?: unknown, options?: any) => invoke("PUT", path, body, options)) as HasnaHttpTransport["put"],
      patch: ((path: string, body?: unknown, options?: any) => invoke("PATCH", path, body, options)) as HasnaHttpTransport["patch"],
      del: ((path: string, body?: unknown, options?: any) => invoke("DELETE", path, body, options)) as HasnaHttpTransport["del"],
    },
  };
}

describe("vendored client transport contract", () => {
  it("rejects every retired storage-mode variable as a hard error", () => {
    const keys = [
      "HASNA_DEMO_STORAGE_MODE",
      "HASNA_DEMO_MODE",
      "DEMO_STORAGE_MODE",
      "DEMO_MODE",
    ] as const;
    for (const key of keys) {
      expect(() =>
        resolveClientTransport("demo", {
          [key]: "cloud",
          HASNA_DEMO_API_URL: "http://localhost:9999",
          HASNA_DEMO_API_KEY: "fixture-key",
        }),
      ).toThrow(new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} was removed`));
    }
  });

  it("selects the API transport from URL + key alone", () => {
    const resolved = resolveClientTransport("demo", {
      HASNA_DEMO_API_URL: "http://localhost:9999",
      HASNA_DEMO_API_KEY: "fixture-key",
    });
    expect(resolved).toMatchObject({
      transport: "cloud-http",
      baseUrl: "http://localhost:9999/v1",
      apiUrlSource: "HASNA_DEMO_API_URL",
      apiKeyPresent: true,
      apiKeySource: "HASNA_DEMO_API_KEY",
      misconfigured: false,
    });
  });

  it("flags a half-applied flip (URL or key alone) as misconfigured", () => {
    const urlOnly = resolveClientTransport("demo", { HASNA_DEMO_API_URL: "http://localhost:9999" });
    expect(urlOnly.transport).toBe("local");
    expect(urlOnly.misconfigured).toBe(true);
    expect(urlOnly.warning).toContain("HASNA_DEMO_API_KEY");

    const keyOnly = resolveClientTransport("demo", { HASNA_DEMO_API_KEY: "fixture-key" });
    expect(keyOnly.transport).toBe("local");
    expect(keyOnly.misconfigured).toBe(true);
    expect(keyOnly.warning).toContain("HASNA_DEMO_API_URL");
  });

  it("composes the neutral default cloud host for an app", () => {
    // The published package ships no real hostname: absent HASNA_FLEET_API_DOMAIN
    // the default composes the neutral, non-resolving `.example` placeholder; set,
    // it composes the configured suffix. An explicit env map keeps the ambient
    // environment out of the assertion.
    expect(defaultCloudBaseUrl("demo", {})).toBe("https://demo.your-deployment.example");
    expect(defaultCloudBaseUrl("demo", { HASNA_FLEET_API_DOMAIN: "api.example.org" })).toBe(
      "https://demo.api.example.org",
    );
  });

  it("preserves HTTP error metadata", () => {
    const error = new HasnaHttpError("GET", "/things", 418, { error: "teapot" });
    expect(error).toMatchObject({
      name: "HasnaHttpError",
      status: 418,
      method: "GET",
      path: "/things",
      body: { error: "teapot" },
    });
  });
});

describe("generic Hasna storage client", () => {
  it("extracts collection envelope variants and validates resource names", async () => {
    const responses: unknown[] = [
      [{ id: 1 }],
      { data: [{ id: 2 }], count: 9, next_cursor: "next" },
      { results: [{ id: 3 }], totalCount: 8, nextCursor: "cursor" },
      { rows: [{ id: 4 }], total_count: 7, next: "last" },
      { records: [{ id: 5 }], total: 6, cursor: "first" },
      { items: "not-an-array" },
      null,
    ];
    const { transport } = fakeTransport(() => responses.shift());
    const client = createHasnaStorageClient("demo", transport);
    expect(client.name).toBe("demo");
    expect(client.baseUrl).toBe(transport.baseUrl);
    expect(client.transport).toBe(transport);
    expect((await client.list("/things/")).items).toEqual([{ id: 1 }]);
    expect(await client.list("things")).toMatchObject({ items: [{ id: 2 }], total: 9, cursor: "next" });
    expect(await client.list("things")).toMatchObject({ items: [{ id: 3 }], total: 8, cursor: "cursor" });
    expect(await client.list("things")).toMatchObject({ items: [{ id: 4 }], total: 7, cursor: "last" });
    expect(await client.list("things")).toMatchObject({ items: [{ id: 5 }], total: 6, cursor: "first" });
    expect(await client.list("things")).toMatchObject({ items: [], total: null, cursor: null });
    expect(await client.list("things")).toMatchObject({ items: [], total: null, cursor: null });
    await expect(client.list("///")).rejects.toThrow("resource must be a non-empty");
  });

  it("gets entities, encodes ids, maps 404 to null, and rethrows other errors", async () => {
    const errors: unknown[] = [
      { id: "a/b" },
      new HasnaHttpError("GET", "/things/missing", 404, {}),
      new HasnaHttpError("GET", "/things/broken", 500, {}),
    ];
    const { transport, calls } = fakeTransport(() => {
      const result = errors.shift();
      if (result instanceof Error) throw result;
      return result;
    });
    const client = createHasnaStorageClient("demo", transport);
    expect(await client.get("things", "a/b")).toEqual({ id: "a/b" });
    expect(calls[0]!.path).toBe("/things/a%2Fb");
    expect(await client.get("things", "missing")).toBeNull();
    await expect(client.get("things", "broken")).rejects.toBeInstanceOf(HasnaHttpError);
    await expect(client.get("things", "")).rejects.toThrow("id must be a non-empty");
    await expect(client.get("things", null as any)).rejects.toThrow("id must be a non-empty");
  });

  it("creates with explicit and generated idempotency keys, including the fallback generator", async () => {
    const { transport, calls } = fakeTransport(() => ({ ok: true }));
    const client = createHasnaStorageClient("demo", transport);
    await client.create("things", { a: 1 }, { idempotencyKey: "stable", headers: { x: "y" } });
    expect(calls.at(-1)?.options).toMatchObject({ idempotencyKey: "stable", headers: { x: "y" } });
    await client.create("things", { a: 2 });
    expect(calls.at(-1)?.options.idempotencyKey).toBeString();

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    try {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
      await client.create("things", { a: 3 });
      expect(calls.at(-1)?.options.idempotencyKey).toStartWith("idmp_");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    }
  });

  it("updates with PATCH and PUT and implements idempotent delete", async () => {
    let deleteMode: "ok" | "missing" | "broken" = "ok";
    const { transport, calls } = fakeTransport((call) => {
      if (call.method === "DELETE" && deleteMode === "missing") {
        throw new HasnaHttpError("DELETE", call.path, 404, {});
      }
      if (call.method === "DELETE" && deleteMode === "broken") {
        throw new HasnaHttpError("DELETE", call.path, 500, {});
      }
      return { ok: true };
    });
    const client = createHasnaStorageClient("demo", transport);
    await client.update("things", "one", { a: 1 });
    expect(calls.at(-1)?.method).toBe("PATCH");
    await client.update("things", "two", { a: 2 }, { method: "PUT", idempotencyKey: "replace" });
    expect(calls.at(-1)).toMatchObject({ method: "PUT", options: { idempotencyKey: "replace" } });
    await client.delete("things", "one");
    deleteMode = "missing";
    await expect(client.delete("things", "missing")).resolves.toBeUndefined();
    deleteMode = "broken";
    await expect(client.delete("things", "broken")).rejects.toBeInstanceOf(HasnaHttpError);
  });

  it("resolves local and cloud storage clients", async () => {
    // The resolution travels with the local result too — the CLI's fallback notice
    // depends on seeing WHY local was selected (no URL+key pair = unselected
    // fallback, incident 715558). It must never be dropped at this layer.
    expect(resolveStorageClient("demo", {})).toEqual({
      transport: "local",
      client: null,
      resolution: expect.objectContaining({ transport: "local", misconfigured: false }),
    });
    const resolved = resolveStorageClient("demo", {
      HASNA_DEMO_API_URL: "http://localhost:9999",
      HASNA_DEMO_API_KEY: "fixture-key",
    });
    expect(resolved.transport).toBe("cloud-http");
    if (resolved.transport === "cloud-http") {
      expect(resolved.client.name).toBe("demo");
      expect(resolved.client.baseUrl).toBe("http://localhost:9999/v1");
      expect(resolved.resolution).toMatchObject({
        transport: "cloud-http",
        apiUrlSource: "HASNA_DEMO_API_URL",
        apiKeySource: "HASNA_DEMO_API_KEY",
      });
    }
  });
});
