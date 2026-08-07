/**
 * Store seam tests: transport selection + ApiStore path/verb mapping against the
 * `/v1` route table. The ApiStore is exercised through a fake HTTP transport so
 * we assert the exact method + path + body it emits without a live server.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
    baseUrl: "https://files.md/v1",
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
      HASNA_FILES_API_URL: "https://files.md",
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
      baseUrl: "https://files.md/v1",
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
    expect((find("POST", "/evidence/upload-intents")?.body as Record<string, unknown>).include_upload_url).toBeUndefined();
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

  it("does not return the presigned URL after a high-level API upload", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "files-api-evidence-"));
    const fixture = join(fixtureRoot, "receipt.txt");
    writeFileSync(fixture, "receipt bytes");

    const uploadUrl = "https://upload.example.invalid/object?synthetic-signature=temporary";
    const intent = {
      id: "upl_1",
      asset_id: "asset_1",
      method: "PUT",
      upload_url: uploadUrl,
      expires_at: "2099-01-01T00:00:00.000Z",
      status: "pending",
      expected_checksum: "a".repeat(64),
      expected_checksum_algorithm: "sha256",
      expected_size: 13,
      required_headers: { "content-type": "text/plain" },
      metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const asset = {
      id: "asset_1",
      status: "verified",
      scan_status: "skipped",
    };
    let createBody: unknown;
    const transport = {
      baseUrl: "https://files.example.invalid/v1",
      get: async () => ({}),
      post: async (path: string, body?: unknown) => {
        if (path === "/evidence/upload-intents") {
          createBody = body;
          return { asset, intent };
        }
        if (path === "/evidence/upload-intents/upl_1/complete") return asset;
        throw new Error(`Unexpected POST ${path}`);
      },
      put: async () => ({}),
      patch: async () => ({}),
      del: async () => ({}),
    } as unknown as HasnaHttpTransport;
    const store = new ApiStore(createHasnaStorageClient("files", transport));
    const originalFetch = globalThis.fetch;
    let uploadedTo: string | undefined;
    globalThis.fetch = (async (input: string | URL | Request) => {
      uploadedTo = String(input);
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const result = await store.uploadEvidenceFile({
        path: fixture,
        org_id: "org_1",
        app: "iapp-accounting",
        kind: "receipt",
      });

      expect(uploadedTo).toBe(uploadUrl);
      expect(createBody).toMatchObject({ include_upload_url: true });
      expect(result.intent.upload_url).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("upload_url");
      expect(JSON.stringify(result)).not.toContain("synthetic-signature");
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("ApiStore search scope — cloud mode must not answer a question it cannot ask", () => {
  /** A transport whose `/files` list returns one row, so mapping is inspectable. */
  function transportReturningOneFile(): { transport: HasnaHttpTransport; queries: unknown[] } {
    const queries: unknown[] = [];
    const file = {
      id: "f_1", source_id: "src_1", machine_id: "m_1",
      path: "/docs/cert.pdf", name: "cert.pdf", ext: ".pdf",
      size: 1, mime: "application/pdf", status: "active",
      indexed_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z",
      tags: [],
    };
    const transport = {
      baseUrl: "https://files.md/v1",
      get: async (_path: string, opts?: unknown) => { queries.push(opts); return { items: [file] }; },
      post: async () => ({}),
      put: async () => ({}),
      patch: async () => ({}),
      del: async () => ({}),
    } as unknown as HasnaHttpTransport;
    return { transport, queries };
  }

  // ── must fire ──────────────────────────────────────────────────────────────
  it("refuses --scope content rather than returning an empty list", async () => {
    // /v1/files matches name and path only; the extracted-content FTS index is
    // on-box. Serving this scope over the API answered [] at rc=0 for terms that
    // appear only inside document bodies — a confident, wrong "not found".
    const { transport } = transportReturningOneFile();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await expect(store.searchFiles("Buzura", { search_scope: "content" })).rejects.toThrow(/content/i);
    await expect(store.searchFiles("Buzura", { search_scope: "content" })).rejects.toThrow(/on-box|local/i);
  });

  it("labels cloud results as metadata matches so --scope all cannot imply content coverage", async () => {
    const { transport } = transportReturningOneFile();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    const results = await store.searchFiles("cert", {});
    expect(results).toHaveLength(1);
    expect(results[0]!.search_match_sources).toEqual(["metadata"]);
    expect(results[0]!.search_match_sources).not.toContain("content");
  });

  // ── must stay silent ───────────────────────────────────────────────────────
  it("still serves the scopes the endpoint can actually answer", async () => {
    const { transport, queries } = transportReturningOneFile();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    for (const scope of ["metadata", "all"] as const) {
      const results = await store.searchFiles("cert", { search_scope: scope, limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("f_1");
    }
    // The query term still reaches the endpoint — the guard rejects a scope, not a search.
    expect(JSON.stringify(queries)).toContain("cert");
  });
});
