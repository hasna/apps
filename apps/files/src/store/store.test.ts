/**
 * Store seam tests: transport selection + ApiStore path/verb mapping against the
 * `/v1` route table. The ApiStore is exercised through a fake HTTP transport so
 * we assert the exact method + path + body it emits without a live server.
 */
import { describe, expect, it } from "bun:test";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import { HasnaHttpError } from "@hasna/contracts/client";
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

  it("reports deletes truthfully: 404 -> false, success -> true (no false 'removed')", async () => {
    // A transport whose DELETE 404s (record — or route — absent). The
    // @hasna/contracts `client.delete` helper swallows this and returns void,
    // which used to make every delete claim success; the ApiStore now goes
    // through the raw transport so a 404 is surfaced as `false`.
    const del404: HasnaHttpTransport = {
      baseUrl: "https://files.hasna.xyz/v1",
      get: async () => ({}),
      post: async () => ({}),
      put: async () => ({}),
      patch: async () => ({}),
      del: async (path: string) => { throw new HasnaHttpError("DELETE", path, 404, { error: "not found" }); },
    } as unknown as HasnaHttpTransport;
    const missing = new ApiStore(createHasnaStorageClient("files", del404));
    expect(await missing.deleteCollection("nope")).toBe(false);
    expect(await missing.deleteProject("nope")).toBe(false);
    expect(await missing.deleteSource("nope")).toBe(false);
    expect(await missing.deleteTag("nope")).toBe(false);

    const { transport } = fakeTransport(); // del resolves -> deleted
    const present = new ApiStore(createHasnaStorageClient("files", transport));
    expect(await present.deleteCollection("col_1")).toBe(true);
    expect(await present.deleteProject("prj_1")).toBe(true);

    // A non-404 error must still propagate (not be masked as a boolean).
    const del500: HasnaHttpTransport = {
      ...del404,
      del: async (path: string) => { throw new HasnaHttpError("DELETE", path, 500, { error: "boom" }); },
    } as unknown as HasnaHttpTransport;
    const broken = new ApiStore(createHasnaStorageClient("files", del500));
    await expect(broken.deleteCollection("col_1")).rejects.toThrow();
  });

  it("swallows a cloud 404 even when the transport throws a *different* HasnaHttpError copy", async () => {
    // Regression for the `PATCH /sources/:id -> 404` raw leak: `@hasna/contracts`
    // bundles `HasnaHttpError` separately under `/client` (imported by api-store)
    // and `/client/storage` (thrown by the storage transport). In the published
    // tarball those are distinct class identities, so api-store's `instanceof`
    // check missed the storage transport's 404 and re-threw it as a raw
    // "Hasna cloud request failed: PATCH /sources/… -> 404". This fake models the
    // storage-subpath copy: a genuine HasnaHttpError shape that is NOT
    // `instanceof` the copy api-store imports.
    class ForeignHasnaHttpError extends Error {
      readonly status: number;
      readonly method: string;
      readonly path: string;
      readonly body: unknown;
      constructor(method: string, path: string, status: number, body?: unknown) {
        super(`Hasna cloud request failed: ${method} ${path} -> ${status}`);
        this.name = "HasnaHttpError";
        this.status = status;
        this.method = method;
        this.path = path;
        this.body = body;
      }
    }
    // Sanity: it is a real cross-module mismatch, not the imported class.
    expect(new ForeignHasnaHttpError("PATCH", "/sources/x", 404) instanceof HasnaHttpError).toBe(false);

    const foreign404: HasnaHttpTransport = {
      baseUrl: "https://files.hasna.xyz/v1",
      get: async (path: string) => { throw new ForeignHasnaHttpError("GET", path, 404); },
      post: async (path: string) => { throw new ForeignHasnaHttpError("POST", path, 404); },
      put: async (path: string) => { throw new ForeignHasnaHttpError("PUT", path, 404); },
      patch: async (path: string) => { throw new ForeignHasnaHttpError("PATCH", path, 404); },
      del: async (path: string) => { throw new ForeignHasnaHttpError("DELETE", path, 404); },
    } as unknown as HasnaHttpTransport;
    const store = new ApiStore(createHasnaStorageClient("files", foreign404));

    // enable/disable/rename all route through updateSource -> a graceful null,
    // never a raw leak.
    expect(await store.updateSource("src_missing", { enabled: true })).toBeNull();
    expect(await store.updateSource("src_missing", { name: "x" })).toBeNull();
    expect(await store.deleteSource("src_missing")).toBe(false);

    // A non-404 from the foreign copy must still propagate (not be masked).
    const foreign500: HasnaHttpTransport = {
      ...foreign404,
      patch: async (path: string) => { throw new ForeignHasnaHttpError("PATCH", path, 500); },
    } as unknown as HasnaHttpTransport;
    const broken = new ApiStore(createHasnaStorageClient("files", foreign500));
    await expect(broken.updateSource("src_1", { name: "x" })).rejects.toThrow();
  });

  it("guards a missing cloud duplicates route with a graceful message (never a raw transport leak)", async () => {
    // The self-hosted service has no /files/duplicates route yet, so the cloud
    // transport 404s. `files dupes --json` used to surface the raw
    // "Hasna cloud request failed: GET /files/duplicates -> 404" leak; the guard
    // must translate that into a graceful, actionable message instead.
    const get404: HasnaHttpTransport = {
      baseUrl: "https://files.hasna.xyz/v1",
      get: async (path: string) => { throw new HasnaHttpError("GET", path, 404, { error: "not found" }); },
      post: async () => ({}),
      put: async () => ({}),
      patch: async () => ({}),
      del: async () => ({}),
    } as unknown as HasnaHttpTransport;
    const store = new ApiStore(createHasnaStorageClient("files", get404));

    let msg = "";
    try {
      await store.findDuplicates();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/not available over the cloud \(api\) transport/i);
    expect(msg).toContain("files dupes");
    // The raw transport error must NOT leak through.
    expect(msg).not.toContain("cloud request failed");

    // The guard must also catch the *bundled* HasnaHttpError copy the storage
    // transport actually throws (different class identity than the one api-store
    // imports). This models the published tarball: with an `instanceof` check the
    // 404 would escape and the raw leak would survive. Detection is by public
    // shape (name + numeric status), so this must still be guarded.
    class ForeignHasnaHttpError extends Error {
      readonly status: number;
      constructor(method: string, path: string, status: number) {
        super(`Hasna cloud request failed: ${method} ${path} -> ${status}`);
        this.name = "HasnaHttpError";
        this.status = status;
      }
    }
    expect(new ForeignHasnaHttpError("GET", "/files/duplicates", 404) instanceof HasnaHttpError).toBe(false);
    const foreign404: HasnaHttpTransport = {
      ...get404,
      get: async (path: string) => { throw new ForeignHasnaHttpError("GET", path, 404); },
    } as unknown as HasnaHttpTransport;
    const foreignStore = new ApiStore(createHasnaStorageClient("files", foreign404));
    let foreignMsg = "";
    try {
      await foreignStore.findDuplicates();
    } catch (e) {
      foreignMsg = (e as Error).message;
    }
    expect(foreignMsg).toMatch(/not available over the cloud \(api\) transport/i);
    expect(foreignMsg).not.toContain("cloud request failed");

    // A non-404 error still propagates unchanged (never masked by the guard).
    const get500: HasnaHttpTransport = {
      ...get404,
      get: async (path: string) => { throw new HasnaHttpError("GET", path, 500, { error: "boom" }); },
    } as unknown as HasnaHttpTransport;
    const broken = new ApiStore(createHasnaStorageClient("files", get500));
    await expect(broken.findDuplicates()).rejects.toThrow(/cloud request failed/i);
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

  it("routes the shared evidence vault through /v1/evidence (never local sqlite)", async () => {
    const { transport, calls } = fakeTransport();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await store.createEvidenceUploadIntent({
      org_id: "org_1", app: "iapp-accounting", kind: "receipt",
      original_name: "r.pdf", size: 10, checksum: "a".repeat(64),
    });
    await store.completeEvidenceUpload("upl_1");
    await store.linkEvidenceAsset({
      asset_id: "asset_1", org_id: "org_1", app: "iapp-accounting",
      source_type: "invoice", source_id: "inv_1", kind: "supporting_document",
    });
    await store.signEvidenceDownload({ asset_id: "asset_1", actor_id: "a1" });
    await store.verifyEvidenceAsset("asset_1");
    await store.listEvidenceAssets({ org_id: "org_1", app: "iapp-accounting" });
    await store.getEvidenceAsset("asset_1");
    await store.listEvidenceLinks("asset_1");
    await store.listEvidenceAccessEvents("asset_1", 20);

    const find = (method: string, path: string) => calls.find((c) => c.method === method && c.path === path);

    expect(find("POST", "/evidence/upload-intents")?.body).toMatchObject({ org_id: "org_1", app: "iapp-accounting", kind: "receipt" });
    expect(find("POST", "/evidence/upload-intents/upl_1/complete")).toBeDefined();
    // asset_id travels in the path, not the body.
    expect(find("POST", "/evidence/assets/asset_1/links")?.body).toMatchObject({ source_type: "invoice", source_id: "inv_1" });
    expect((find("POST", "/evidence/assets/asset_1/links")?.body as Record<string, unknown>).asset_id).toBeUndefined();
    expect(find("POST", "/evidence/assets/asset_1/sign-download")?.body).toMatchObject({ actor_id: "a1" });
    expect(find("POST", "/evidence/assets/asset_1/verify")).toBeDefined();
    expect(find("GET", "/evidence/assets")).toBeDefined();
    expect(find("GET", "/evidence/assets/asset_1")).toBeDefined();
    expect(find("GET", "/evidence/assets/asset_1/links")).toBeDefined();
    expect(find("GET", "/evidence/assets/asset_1/access-events")).toBeDefined();
  });
});
