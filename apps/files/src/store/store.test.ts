/**
 * Store seam tests: transport selection + ApiStore path/verb mapping against the
 * `/v1` route table. The ApiStore is exercised through a fake HTTP transport so
 * we assert the exact method + path + body it emits without a live server.
 */
import { describe, expect, it } from "bun:test";
import { createHasnaStorageClient, resolveStorageClient } from "@hasna/contracts/client/storage";
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
    const createdAt = new Date().toISOString();
    const uploadAssetId = "asset_0123456789abcdef";
    const asset = {
      id: uploadAssetId, org_id: "org_1", app: "iapp-accounting", kind: "receipt",
      classification: "evidence", original_name: "r.pdf", content_type: "application/pdf",
      size: 10, checksum: "a".repeat(64), checksum_algorithm: "sha256",
      storage_provider: "s3", bucket: "hasna-xyz-opensource-files-prod", region: "us-east-1",
      object_key: `evidence/${uploadAssetId}/r.pdf`, quarantine_key: `quarantine/evidence/${uploadAssetId}/r.pdf`,
      status: "pending_upload", scan_status: "pending", legal_hold: false, immutable: false,
      metadata: {}, created_at: createdAt, updated_at: createdAt,
    };
    (transport as unknown as { post: (path: string, body?: unknown) => Promise<unknown> }).post = async (path, body) => {
      calls.push({ method: "POST", path, body });
      if (path === "/evidence/upload-intents") {
        return {
          asset,
          intent: {
            id: "upl_0123456789ab", asset_id: asset.id, method: "PUT",
            upload_url: `https://hasna-xyz-opensource-files-prod.s3.amazonaws.com/${asset.quarantine_key}`,
            expires_at: new Date(Date.now() + 60_000).toISOString(), status: "pending",
            expected_checksum: asset.checksum, expected_checksum_algorithm: "sha256", expected_size: asset.size,
            required_headers: {
              "content-type": asset.content_type,
              "x-amz-checksum-sha256": Buffer.from(asset.checksum, "hex").toString("base64"),
              "x-amz-meta-asset-id": asset.id,
              "x-amz-meta-org-id": asset.org_id,
              "x-amz-meta-app": asset.app,
              "x-amz-meta-kind": asset.kind,
              "x-amz-meta-checksum": asset.checksum,
              "x-amz-meta-checksum-algorithm": asset.checksum_algorithm,
            },
            metadata: {}, created_at: createdAt,
          },
        };
      }
      if (path === "/evidence/upload-intents/upl_1/complete") {
        return { ...asset, status: "verified", scan_status: "skipped", updated_at: new Date().toISOString(), verified_at: new Date().toISOString() };
      }
      return { items: [], id: "x" };
    };
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

describe("ApiStore evidence guard (route not deployed)", () => {
  // Build an ApiStore whose client uses the REAL @hasna/contracts HTTP transport
  // (via a fake `fetchImpl`), so the thrown error is the transport's own
  // `HasnaHttpError` — the exact cross-bundle instance the previous tests never
  // exercised because they hand-constructed the error from the sibling bundle.
  function storeWithFetch(fetchImpl: (url: string, init?: { method?: string }) => Response): ApiStore {
    const resolved = resolveStorageClient(
      "files",
      { HASNA_FILES_API_URL: "https://files.hasna.xyz", HASNA_FILES_API_KEY: "k_test" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    if (resolved.transport !== "cloud-http") throw new Error("expected cloud-http transport");
    return new ApiStore(resolved.client);
  }

  const routeMissing = (): Response => new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  const NO_LEAK = /Hasna cloud request failed|-> 404|\/evidence\//;

  it("surfaces an actionable guard instead of a raw 404 leak for reads", async () => {
    const store = storeWithFetch(routeMissing);
    for (const call of [
      () => store.listEvidenceAssets({ org_id: "org_1" }),
      () => store.getEvidenceAsset("asset_0123456789abcdef"),
      () => store.listEvidenceLinks("asset_0123456789abcdef"),
      () => store.listEvidenceAccessEvents("asset_0123456789abcdef"),
    ]) {
      const err = await call().then(() => null, (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("Evidence API is not available on this files deployment");
      expect(err!.message).not.toMatch(NO_LEAK);
    }
  });

  it("surfaces the guard for create/verify/link/sign writes too", async () => {
    const store = storeWithFetch(routeMissing);
    for (const call of [
      () => store.createEvidenceUploadIntent({
        org_id: "org_1", app: "iapp-accounting", kind: "receipt",
        original_name: "r.pdf", size: 10, checksum: "a".repeat(64),
      }),
      () => store.verifyEvidenceAsset("asset_0123456789abcdef"),
      () => store.signEvidenceDownload({ asset_id: "asset_0123456789abcdef" }),
      () => store.linkEvidenceAsset({
        asset_id: "asset_0123456789abcdef", org_id: "org_1", app: "iapp-accounting",
        source_type: "invoice", source_id: "inv_1", kind: "supporting_document",
      }),
    ]) {
      const err = await call().then(() => null, (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("Evidence API is not available on this files deployment");
      expect(err!.message).not.toMatch(NO_LEAK);
    }
  });

  it("keeps record-level not-found semantics when the route IS deployed", async () => {
    // Route present, asset absent: the service answers 404 with a record message.
    const store = storeWithFetch(() => new Response(JSON.stringify({ error: "Evidence asset not found" }), { status: 404 }));
    expect(await store.getEvidenceAsset("asset_0123456789abcdef")).toBeNull();
  });
});
