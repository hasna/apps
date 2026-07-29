import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../db.js";
import { resolveCloudStorage } from "./resolve.js";
import {
  CloudMachineRegistryStore,
  LocalMachineRegistryStore,
  resolveMachineRegistryStore,
} from "./registry.js";
import { createHasnaStorageClient } from "./storage.js";
import { createHasnaHttpTransport } from "./transport.js";

describe("resolveCloudStorage (machines)", () => {
  test("local when API vars unset", () => {
    expect(resolveCloudStorage("machines", {}).transport).toBe("local");
  });
  test("cloud-http when both API vars set", () => {
    const r = resolveCloudStorage("machines", {
      HASNA_MACHINES_API_URL: "https://machines.example.test",
      HASNA_MACHINES_API_KEY: "k",
    });
    expect(r.transport).toBe("cloud-http");
    if (r.transport === "cloud-http") expect(r.baseUrl).toBe("https://machines.example.test/v1");
  });
  test("explicit mode=local forces local even with API vars", () => {
    expect(
      resolveCloudStorage("machines", {
        HASNA_MACHINES_STORAGE_MODE: "local",
        HASNA_MACHINES_API_URL: "https://machines.example.test",
        HASNA_MACHINES_API_KEY: "k",
      }).transport,
    ).toBe("local");
  });
  test("retired deployment-mode words in the mode env are rejected loudly", () => {
    // Deployment modes were removed (owner directive 2026-07-29): a stale
    // HASNA_MACHINES_STORAGE_MODE=self_hosted must fail naming the fix, not be
    // silently remapped to another backend.
    for (const retired of ["self_hosted", "self-hosted", "remote", "hybrid"]) {
      expect(() =>
        resolveCloudStorage("machines", {
          HASNA_MACHINES_STORAGE_MODE: retired,
          HASNA_MACHINES_API_URL: "https://machines.example.test",
          HASNA_MACHINES_API_KEY: "k",
        }),
      ).toThrow(/use local \(on-box store\) or cloud/);
    }
  });
});

describe("resolveMachineRegistryStore backend selection", () => {
  test("returns cloud store when flipped", () => {
    const store = resolveMachineRegistryStore({
      HASNA_MACHINES_API_URL: "https://machines.example.test",
      HASNA_MACHINES_API_KEY: "k",
    } as NodeJS.ProcessEnv);
    expect(store.backend).toBe("cloud-http");
    expect(store.baseUrl).toBe("https://machines.example.test/v1");
  });
  test("returns local store otherwise", () => {
    expect(resolveMachineRegistryStore({} as NodeJS.ProcessEnv).backend).toBe("local");
  });
});

function fakeCloudStore() {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const db = new Map<string, Record<string, unknown>>();
  const transport = createHasnaHttpTransport({
    name: "machines",
    baseUrl: "https://machines.example.test/v1",
    apiKey: "k",
    fetchImpl: async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.replace("https://machines.example.test/v1", "");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (method === "POST" && path === "/machines") {
        const rec = { ...(body as object), createdAt: "t", updatedAt: "t" };
        db.set((body as { id: string }).id, rec);
        return new Response(JSON.stringify(rec), { status: 200, headers: { "content-type": "application/json" } });
      }
      const m = path.match(/^\/machines\/(.+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const rec = db.get(id);
          return new Response(rec ? JSON.stringify(rec) : "", { status: rec ? 200 : 404 });
        }
        if (method === "DELETE") {
          db.delete(id);
          return new Response(JSON.stringify({ deleted: true, id }), { status: 200 });
        }
      }
      if (method === "GET" && path.startsWith("/machines")) {
        return new Response(JSON.stringify({ machines: [...db.values()], count: db.size }), { status: 200 });
      }
      return new Response("", { status: 404 });
    },
  });
  return { store: new CloudMachineRegistryStore(createHasnaStorageClient("machines", transport), "https://machines.example.test/v1"), calls };
}

describe("CloudMachineRegistryStore CRUD over HTTP", () => {
  test("upsert -> get -> list -> remove round trip", async () => {
    const { store, calls } = fakeCloudStore();
    const rec = await store.upsert({ id: "m1", friendlyName: "one", status: "online" });
    expect(rec.id).toBe("m1");
    expect((await store.get("m1"))?.friendlyName).toBe("one");
    expect((await store.list()).map((m) => m.id)).toContain("m1");
    expect(await store.remove("m1")).toBe(true);
    expect(await store.get("m1")).toBeNull();
    expect(await store.remove("m1")).toBe(false);
    expect(calls.some((c) => c.method === "POST" && c.path === "/machines")).toBe(true);
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/machines/m1")).toBe(true);
  });
});

describe("LocalMachineRegistryStore CRUD over SQLite", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "machines-registry-"));
    process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
    closeDb();
  });
  afterEach(() => {
    closeDb();
    delete process.env.HASNA_MACHINES_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  test("upsert -> get -> list -> remove round trip", async () => {
    const store = new LocalMachineRegistryStore();
    const rec = await store.upsert({ id: "local1", friendlyName: "loc", platform: "linux", status: "online" });
    expect(rec.id).toBe("local1");
    expect(rec.friendlyName).toBe("loc");
    expect((await store.get("local1"))?.platform).toBe("linux");
    expect((await store.list()).map((m) => m.id)).toContain("local1");
    // upsert again updates
    const updated = await store.upsert({ id: "local1", friendlyName: "loc2", status: "offline" });
    expect(updated.friendlyName).toBe("loc2");
    expect(updated.status).toBe("offline");
    expect(await store.remove("local1")).toBe(true);
    expect(await store.get("local1")).toBeNull();
    expect(await store.remove("local1")).toBe(false);
  });
});
