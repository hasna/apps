/**
 * Regression tests for the ApiStore (hosted transport) `uploadFile` path —
 * the supported cloud-mode ingestion that turns a local document into a
 * tagged, PROJECT-LINKED file resource on the files service.
 *
 * Bug de9aeeed: in api mode `files upload` was refused on the client with
 * "runs on-box only and is unavailable on the hosted transport", and the
 * hosted `/v1` surface had no ingestion route — so a partner contract PDF
 * could not be stored to the files service as a tagged, project-linked
 * resource. This test pins the ApiStore contract: it must POST the upload
 * intent, PUT the bytes, and complete the upload, returning the filed file.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import { ApiStore } from "./api-store.js";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

const UPLOAD_URL = "https://upload.example.test/put";
const FILE = { id: "f_1", source_id: "src_uploads_x", machine_id: "files-serve", path: "uploads/t/uploads/x.pdf", name: "x", ext: ".pdf", size: 4, mime: "application/pdf", hash: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", status: "active", tags: ["partner-deal"], created_at: "now", indexed_at: "now" };

function fakeTransport(): { transport: HasnaHttpTransport; calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string) => async (path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (path === "/files") {
      return { file_id: "f_1", upload_url: UPLOAD_URL, method: "PUT", required_headers: { "content-type": "application/pdf" } };
    }
    if (path === "/files/f_1/complete") {
      return { file: FILE };
    }
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

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("ApiStore cloud ingestion (uploadFile)", () => {
  it("posts intent, PUTs bytes, completes, and returns the tagged project file", async () => {
    dir = mkdtempSync(join(tmpdir(), "files-upload-cli-"));
    const fixture = join(dir, "partner-contract.pdf");
    writeFileSync(fixture, "data");
    const { transport, calls } = fakeTransport();
    const store = new ApiStore(createHasnaStorageClient("files", transport));
    const putBodies: Array<{ url: string; body: BodyInit | null }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      putBodies.push({ url: String(url), body: init?.body ?? null });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      const result = await store.uploadFile({
        path: fixture,
        project_id: "prj_deal1",
        tags: ["partner-deal"],
      });

      const intent = calls.find((c) => c.method === "POST" && c.path === "/files");
      expect(intent).toBeDefined();
      expect(intent?.body).toMatchObject({
        name: "partner-contract.pdf",
        size: 4,
        mime: "application/pdf",
        checksum_algorithm: "sha256",
        tags: ["partner-deal"],
        project_id: "prj_deal1",
      });
      expect((intent?.body as { source_id?: unknown }).source_id).toBeUndefined();
      expect(calls.some((c) => c.method === "POST" && c.path === "/files/f_1/complete")).toBe(true);
      expect(putBodies.length).toBe(1);
      expect(putBodies[0]!.url).toBe(UPLOAD_URL);
      expect(result.file.tags).toContain("partner-deal");
      expect(result.file.id).toBe("f_1");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("refuses a missing local document before any network call", async () => {
    const { transport, calls } = fakeTransport();
    const store = new ApiStore(createHasnaStorageClient("files", transport));
    await expect(store.uploadFile({ path: "/does/not/exist.pdf" })).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});
