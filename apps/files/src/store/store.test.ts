/**
 * Store seam tests: transport selection + ApiStore path/verb mapping against the
 * `/v1` route table. The ApiStore is exercised through a fake HTTP transport so
 * we assert the exact method + path + body it emits without a live server.
 */
import { describe, expect, it } from "bun:test";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import { ApiStore } from "./api-store.js";
import { LocalStore } from "./local-store.js";
import { resolveStore } from "./index.js";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function fakeTransport(): { transport: HasnaHttpTransport; calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string) => async (path: string, body?: unknown) => {
    calls.push({ method, path, body });
    // Envelope shape the storage client understands for list().
    return { items: [], id: "x" } as unknown;
  };
  const transport = {
    baseUrl: "https://files.hasna.xyz/v1",
    get: record("GET"),
    post: record("POST"),
    put: record("PUT"),
    patch: record("PATCH"),
    del: record("DELETE"),
  } as unknown as HasnaHttpTransport;
  return { transport, calls };
}

describe("resolveStore", () => {
  it("returns a LocalStore with no cloud env", () => {
    expect(resolveStore({}).transport).toBe("local");
    expect(resolveStore({}) instanceof LocalStore).toBe(true);
  });

  it("returns an ApiStore when API url + key are present", () => {
    const s = resolveStore({
      HASNA_FILES_API_URL: "https://files.hasna.xyz",
      HASNA_FILES_API_KEY: "k_test",
    });
    expect(s.transport).toBe("api");
    expect(s instanceof ApiStore).toBe(true);
  });
});

describe("ApiStore route mapping", () => {
  it("maps data-plane calls to the /v1 route table", async () => {
    const { transport, calls } = fakeTransport();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await store.listSources("m1");
    await store.createSource({ name: "n", type: "local", path: "/tmp", machine_id: "local-only" });
    await store.updateSource("src_1", { name: "renamed", enabled: false });
    await store.deleteSource("src_1");
    await store.tagFile("file_1", "invoice");
    await store.untagFile("file_1", "invoice");
    await store.addToCollection("col_1", "file_1");
    await store.removeFromCollection("col_1", "file_1");
    await store.addToProject("prj_1", "file_1");
    await store.removeFromProject("prj_1", "file_1");

    const find = (method: string, path: string) => calls.find((c) => c.method === method && c.path === path);

    expect(find("GET", "/sources")).toBeDefined();
    // machine_id travels as a query param, not in the path.
    expect(find("POST", "/sources")?.body).toMatchObject({ name: "n", type: "local", machine_id: undefined });
    expect(find("PATCH", "/sources/src_1")?.body).toEqual({ name: "renamed", enabled: false });
    expect(find("DELETE", "/sources/src_1")).toBeDefined();
    expect(find("POST", "/files/file_1/tags")?.body).toEqual({ tags: ["invoice"] });
    expect(find("DELETE", "/files/file_1/tags")?.body).toEqual({ tags: ["invoice"] });
    expect(find("POST", "/collections/col_1/files")?.body).toEqual({ file_id: "file_1" });
    expect(find("DELETE", "/collections/col_1/files/file_1")).toBeDefined();
    expect(find("POST", "/projects/prj_1/files")?.body).toEqual({ file_id: "file_1" });
    expect(find("DELETE", "/projects/prj_1/files/file_1")).toBeDefined();
  });

  it("routes agent registry + activity through /v1 (never local sqlite)", async () => {
    const { transport, calls } = fakeTransport();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await store.registerAgent("agent-smith", "sess_1");
    await store.heartbeatAgent("ag_1");
    await store.setAgentFocus("ag_1", "prj_1");
    await store.getAgent("ag_1");
    await store.listAgents();
    await store.logActivity({ agent_id: "ag_1", action: "read", file_id: "file_1" });
    await store.getFileHistory("file_1", { limit: 10 });
    await store.getAgentActivity("ag_1", { action: "read" });
    await store.getSessionActivity("sess_1");

    const find = (method: string, path: string) => calls.find((c) => c.method === method && c.path === path);

    expect(find("POST", "/agents")?.body).toEqual({ name: "agent-smith", session_id: "sess_1" });
    expect(find("POST", "/agents/ag_1/heartbeat")).toBeDefined();
    expect(find("POST", "/agents/ag_1/focus")?.body).toEqual({ project_id: "prj_1" });
    expect(find("GET", "/agents/ag_1")).toBeDefined();
    expect(find("GET", "/agents")).toBeDefined();
    expect(find("POST", "/activity")?.body).toMatchObject({ agent_id: "ag_1", action: "read", file_id: "file_1" });
    expect(find("GET", "/files/file_1/history")).toBeDefined();
    expect(find("GET", "/agents/ag_1/activity")).toBeDefined();
    expect(find("GET", "/sessions/sess_1/activity")).toBeDefined();
  });
});
