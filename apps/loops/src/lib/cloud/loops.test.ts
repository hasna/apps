import { describe, expect, test } from "bun:test";
import { resolveCloudStorage } from "./resolve.js";
import { CloudLoopStore, resolveCloudLoopStore } from "./loops.js";
import { createHasnaStorageClient } from "./storage.js";
import { createHasnaHttpTransport } from "./transport.js";
import type { CreateLoopInput } from "../../types.js";

const CREATE_INPUT: CreateLoopInput = {
  name: "unit-loop",
  schedule: { type: "once", at: "2030-01-01T00:00:00Z" },
  target: { type: "command", command: "echo", args: ["hi"] },
};

describe("resolveCloudStorage (loops)", () => {
  test("local when neither API var is set", () => {
    const r = resolveCloudStorage("loops", {});
    expect(r.transport).toBe("local");
  });

  test("local when only one of URL/key is set", () => {
    expect(resolveCloudStorage("loops", { HASNA_LOOPS_API_URL: "https://loops.example" }).transport).toBe("local");
    expect(resolveCloudStorage("loops", { HASNA_LOOPS_API_KEY: "k" }).transport).toBe("local");
  });

  test("cloud-http when both URL+key are set (presence implies self_hosted)", () => {
    const r = resolveCloudStorage("loops", {
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "secret-key-value",
    });
    expect(r.transport).toBe("cloud-http");
    if (r.transport === "cloud-http") expect(r.baseUrl).toBe("https://loops.example.test/v1");
  });

  test("cloud-http when URL + _API_TOKEN alias are set (control-plane bearer)", () => {
    const r = resolveCloudStorage("loops", {
      LOOPS_API_URL: "https://loops.example.test",
      LOOPS_API_TOKEN: "control-plane-bearer-value",
    });
    expect(r.transport).toBe("cloud-http");
    if (r.transport === "cloud-http") expect(r.baseUrl).toBe("https://loops.example.test/v1");
  });

  test("cloud-http when URL + HASNA_LOOPS_API_TOKEN alias are set", () => {
    const r = resolveCloudStorage("loops", {
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_TOKEN: "control-plane-bearer-value",
    });
    expect(r.transport).toBe("cloud-http");
  });

  test("explicit mode=local forces local even with API vars", () => {
    const r = resolveCloudStorage("loops", {
      HASNA_LOOPS_STORAGE_MODE: "local",
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "secret-key-value",
    });
    expect(r.transport).toBe("local");
  });

  test("resolveCloudLoopStore returns null in local mode", () => {
    expect(resolveCloudLoopStore({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

function fakeClient(handler: (method: string, path: string, body: unknown) => { status: number; body: unknown }) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const transport = createHasnaHttpTransport({
    name: "loops",
    baseUrl: "https://loops.example.test/v1",
    apiKey: "k",
    fetchImpl: async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.replace("https://loops.example.test/v1", "");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const res = handler(method, path, body);
      return new Response(res.body == null ? "" : JSON.stringify(res.body), {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { store: new CloudLoopStore(createHasnaStorageClient("loops", transport), "https://loops.example.test/v1"), calls };
}

describe("CloudLoopStore CRUD over HTTP", () => {
  test("createLoop POSTs /loops and unwraps { loop }", async () => {
    const { store, calls } = fakeClient((method, path) => {
      if (method === "POST" && path === "/loops") {
        return { status: 201, body: { ok: true, loop: { id: "abc", name: "unit-loop", status: "active" } } };
      }
      return { status: 404, body: null };
    });
    const loop = await store.createLoop(CREATE_INPUT);
    expect(loop.id).toBe("abc");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/loops" });
  });

  test("listLoops extracts the { loops } envelope", async () => {
    const { store } = fakeClient((method, path) => {
      if (method === "GET" && path.startsWith("/loops")) {
        return { status: 200, body: { ok: true, loops: [{ id: "a" }, { id: "b" }] } };
      }
      return { status: 404, body: null };
    });
    const loops = await store.listLoops({ status: "active" });
    expect(loops.map((l) => l.id)).toEqual(["a", "b"]);
  });

  test("deleteLoop resolves id then DELETEs, returns true", async () => {
    const { store, calls } = fakeClient((method, path) => {
      if (method === "GET" && path === "/loops/abc") return { status: 200, body: { ok: true, loop: { id: "abc" } } };
      if (method === "DELETE" && path === "/loops/abc") return { status: 200, body: { ok: true, deleted: true } };
      return { status: 404, body: null };
    });
    expect(await store.deleteLoop("abc")).toBe(true);
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/loops/abc")).toBe(true);
  });

  test("deleteLoop returns false when loop is absent", async () => {
    const { store } = fakeClient((method, path) => {
      if (method === "GET" && path.startsWith("/loops") && path !== "/loops/missing-id") {
        return { status: 200, body: { ok: true, loops: [] } };
      }
      return { status: 404, body: null };
    });
    expect(await store.deleteLoop("missing-id")).toBe(false);
  });

  test("resolveLoop falls back to a server-side name filter, not a full list", async () => {
    const { store, calls } = fakeClient((method, path) => {
      // id lookup misses; name filter returns the single match.
      if (method === "GET" && path === "/loops/my-loop") return { status: 404, body: { ok: false, error: "not_found" } };
      if (method === "GET" && path.startsWith("/loops?")) {
        return { status: 200, body: { ok: true, loops: [{ id: "L1", name: "my-loop", status: "active" }] } };
      }
      return { status: 404, body: null };
    });
    const loop = await store.requireLoop("my-loop");
    expect(loop.id).toBe("L1");
    const nameCall = calls.find((c) => c.method === "GET" && c.path.startsWith("/loops?"));
    // Must use the bounded name filter, never an unbounded limit=10000 list.
    expect(nameCall?.path).toContain("name=my-loop");
    expect(nameCall?.path).not.toContain("limit=10000");
  });

  test("resolveLoop throws AmbiguousNameError when >1 active name match", async () => {
    const { store } = fakeClient((method, path) => {
      if (method === "GET" && path === "/loops/dup") return { status: 404, body: { ok: false, error: "not_found" } };
      if (method === "GET" && path.startsWith("/loops?")) {
        return { status: 200, body: { ok: true, loops: [{ id: "A", name: "dup", status: "active" }, { id: "B", name: "dup", status: "active" }] } };
      }
      return { status: 404, body: null };
    });
    await expect(store.requireLoop("dup")).rejects.toThrow(/ambiguous/i);
  });

  test("listLoops forwards offset for pagination past the page cap", async () => {
    const { store, calls } = fakeClient((method, path) => {
      if (method === "GET" && path.startsWith("/loops")) return { status: 200, body: { ok: true, loops: [] } };
      return { status: 404, body: null };
    });
    await store.listLoops({ limit: 1000, offset: 2000, includeArchived: true });
    const call = calls.find((c) => c.method === "GET" && c.path.startsWith("/loops"));
    expect(call?.path).toContain("offset=2000");
    expect(call?.path).toContain("limit=1000");
  });

  test("listRuns GETs /runs, forwards filters, extracts the { runs } envelope", async () => {
    const { store, calls } = fakeClient((method, path) => {
      if (method === "GET" && path.startsWith("/runs")) {
        return { status: 200, body: { ok: true, runs: [{ id: "r1", status: "succeeded" }, { id: "r2", status: "failed" }] } };
      }
      return { status: 404, body: null };
    });
    const runs = await store.listRuns({ loopId: "abc", limit: 2, showOutput: true });
    expect(runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    const runsCall = calls.find((c) => c.method === "GET" && c.path.startsWith("/runs"));
    expect(runsCall?.path).toContain("loopId=abc");
    expect(runsCall?.path).toContain("limit=2");
    expect(runsCall?.path).toContain("showOutput=true");
  });
});
