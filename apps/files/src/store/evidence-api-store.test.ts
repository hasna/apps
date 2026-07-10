import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import { HasnaHttpError } from "@hasna/contracts/client";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sha256Buffer } from "../lib/hasher.js";
import type { CreateEvidenceUploadInput, EvidenceUploadResult } from "../lib/evidence.js";
import type { FileAsset } from "../types/index.js";
import { ApiStore } from "./api-store.js";

const testDir = mkdtempSync(join(tmpdir(), "files-api-evidence-"));
const fixture = join(testDir, "receipt.txt");
const fixtureBytes = Buffer.from("synthetic receipt bytes");
writeFileSync(fixture, fixtureBytes);

let uploadStatus = 200;
let uploadCalls = 0;
let uploadedBytes = Buffer.alloc(0);
let uploadedHeaders: Headers | undefined;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      uploadCalls += 1;
      uploadedHeaders = request.headers;
      uploadedBytes = Buffer.from(await request.arrayBuffer());
      return new Response(null, { status: uploadStatus });
    },
  });
});

afterAll(() => {
  server.stop(true);
  rmSync(testDir, { recursive: true, force: true });
});

describe("ApiStore evidence response boundary", () => {
  test("rejects malformed or contradictory create-intent payloads before byte transport", async () => {
    const input = baseInput();
    const valid = createResponse(input, new URL("/upload", server.url).toString());
    const invalidPayloads: unknown[] = [
      {},
      { ...valid, unexpected: true },
      { ...valid, intent: { ...valid.intent, method: "POST" } },
      { ...valid, intent: { ...valid.intent, upload_url: undefined } },
      { ...valid, intent: { ...valid.intent, upload_url: "file:///tmp/CANARY_FORBIDDEN_SCHEME" } },
      { ...valid, intent: { ...valid.intent, upload_url: "https://synthetic.invalid/CANARY_FORBIDDEN_ORIGIN" } },
      { ...valid, intent: { ...valid.intent, asset_id: "asset_other" } },
      { ...valid, intent: { ...valid.intent, expected_size: valid.intent.expected_size + 1 } },
      { ...valid, intent: { ...valid.intent, expected_checksum: "f".repeat(64) } },
      { ...valid, intent: { ...valid.intent, metadata: { upload_url: "https://synthetic.invalid/CANARY_NESTED_URL" } } },
      { ...valid, asset: { ...valid.asset, metadata: { unexpected: true } } },
      { ...valid, intent: { ...valid.intent, required_headers: { "x-amz-security-token": "CANARY_FORBIDDEN_HEADER" } } },
      { ...valid, intent: { ...valid.intent, required_headers: { "content-type": 42 } } },
    ];

    for (const payload of invalidPayloads) {
      uploadCalls = 0;
      const store = apiStore(async () => payload);
      await expect(store.createEvidenceUploadIntent(input)).rejects.toThrow("Invalid evidence upload intent response");
      expect(uploadCalls).toBe(0);
    }
  });

  test("accepts an explicitly allowlisted non-AWS HTTPS upload origin", async () => {
    const key = "HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS";
    const prior = process.env[key];
    process.env[key] = "https://uploads.synthetic.invalid";
    try {
      const input = baseInput();
      const response = createResponse(input, "https://uploads.synthetic.invalid/transport");
      const store = apiStore(async () => response);
      expect((await store.createEvidenceUploadIntent(input)).intent.id).toBe("intent_synthetic");
    } finally {
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    }
  });

  test("rejects secret-bearing or invalid headers before PUT and completion", async () => {
    uploadCalls = 0;
    let completionCalls = 0;
    const store = apiStore(async (path, body) => {
      if (path === "/evidence/upload-intents") {
        const response = createResponse(body as CreateEvidenceUploadInput, new URL("/upload", server.url).toString());
        response.intent.required_headers = {
          ...response.intent.required_headers,
          "x-amz-security-token": "CANARY_INVALID_HEADER\nVALUE",
        };
        return response;
      }
      if (path.endsWith("/complete")) {
        completionCalls += 1;
        return {};
      }
      throw new Error("unexpected path");
    });

    let caught: unknown;
    try {
      await store.uploadEvidenceFile({
        path: fixture,
        org_id: "org_synthetic",
        app: "iapp-synthetic",
        kind: "receipt",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Invalid evidence upload intent response");
    expect((caught as Error).message.includes("CANARY_INVALID_HEADER")).toBe(false);
    expect(uploadCalls).toBe(0);
    expect(completionCalls).toBe(0);
  });

  test("binds completion to the validated intent and preserves the public result shape", async () => {
    uploadStatus = 200;
    uploadCalls = 0;
    uploadedBytes = Buffer.alloc(0);
    uploadedHeaders = undefined;
    let completionCalls = 0;
    let created: EvidenceUploadResult | undefined;
    const store = apiStore(async (path, body) => {
      if (path === "/evidence/upload-intents") {
        created = createResponse(body as CreateEvidenceUploadInput, new URL("/upload", server.url).toString());
        return created;
      }
      if (path.endsWith("/complete")) {
        completionCalls += 1;
        return completedAsset(created!.asset);
      }
      throw new Error("unexpected path");
    });

    const result = await store.uploadEvidenceFile({
      path: fixture,
      org_id: "org_synthetic",
      app: "iapp-synthetic",
      kind: "receipt",
    });

    expect(uploadCalls).toBe(1);
    expect(completionCalls).toBe(1);
    expect(uploadedBytes.equals(fixtureBytes)).toBe(true);
    expect(uploadedHeaders?.get("content-type")).toBe("text/plain");
    expect(uploadedHeaders?.get("x-amz-meta-asset-id")).toBe("asset_synthetic");
    expect(result.asset.app).toBe("iapp-synthetic");
    expect(result.asset.kind).toBe("receipt");
    expect(result.intent.status).toBe("completed");
    expect(result.intent.required_headers).toEqual({});
    expect("upload_url" in result.intent).toBe(false);
  });

  test("rejects malformed or mismatched completions", async () => {
    const completionMutators: Array<(asset: FileAsset) => unknown> = [
      () => ({}),
      (asset) => ({ ...completedAsset(asset), unexpected: true }),
      (asset) => ({ ...completedAsset(asset), id: "asset_other" }),
      (asset) => ({ ...completedAsset(asset), checksum: "f".repeat(64) }),
      (asset) => ({ ...completedAsset(asset), size: asset.size + 1 }),
      (asset) => ({ ...completedAsset(asset), metadata: { unexpected: true } }),
      (asset) => ({ ...completedAsset(asset), status: "uploaded" }),
      (asset) => ({ ...completedAsset(asset), scan_status: "pending" }),
    ];

    for (const mutate of completionMutators) {
      let created: EvidenceUploadResult | undefined;
      const store = apiStore(async (path, body) => {
        if (path === "/evidence/upload-intents") {
          created = createResponse(body as CreateEvidenceUploadInput, new URL("/upload", server.url).toString());
          return created;
        }
        if (path.endsWith("/complete")) return mutate(created!.asset);
        throw new Error("unexpected path");
      });

      await expect(store.uploadEvidenceFile({
        path: fixture,
        org_id: "org_synthetic",
        app: "iapp-synthetic",
        kind: "receipt",
      })).rejects.toThrow("Invalid evidence upload completion response");
    }
  });

  test("never completes after byte-transport failure and emits a fixed safe diagnostic", async () => {
    uploadStatus = 503;
    let completionCalls = 0;
    const store = apiStore(async (path, body) => {
      if (path === "/evidence/upload-intents") {
        return createResponse(body as CreateEvidenceUploadInput, new URL("/upload/CANARY_TRANSPORT_PATH", server.url).toString());
      }
      if (path.endsWith("/complete")) {
        completionCalls += 1;
        throw new Error("completion must not run");
      }
      throw new Error("unexpected path");
    });

    let caught: unknown;
    try {
      await store.uploadEvidenceFile({
        path: fixture,
        org_id: "org_synthetic",
        app: "iapp-synthetic",
        kind: "receipt",
      });
    } catch (error) {
      caught = error;
    } finally {
      uploadStatus = 200;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Evidence byte upload failed with HTTP 503");
    expect((caught as Error).message.includes("CANARY_")).toBe(false);
    expect(completionCalls).toBe(0);
  });

  test("preserves typed HTTP errors while recursively removing transport material", async () => {
    const original = new HasnaHttpError("POST", "https://synthetic.invalid/CANARY_HTTP_PATH", 503, {
      Authorization: "Bearer CANARY_HTTP_AUTH",
      nested: { "x-amz-security-token": "CANARY_HTTP_SESSION" },
    });
    const store = apiStore(async () => { throw original; });

    let caught: unknown;
    try {
      await store.createEvidenceUploadIntent(baseInput());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(caught).toBeInstanceOf(HasnaHttpError);
    expect((caught as HasnaHttpError).status).toBe(503);
    expect(JSON.stringify(caught).includes("CANARY_")).toBe(false);
  });
});

function apiStore(post: (path: string, body?: unknown) => unknown | Promise<unknown>): ApiStore {
  const transport = {
    baseUrl: "https://synthetic.invalid/v1",
    get: async () => ({}),
    post,
    put: async () => ({}),
    patch: async () => ({}),
    del: async () => ({}),
  } as unknown as HasnaHttpTransport;
  return new ApiStore(createHasnaStorageClient("files", transport));
}

function baseInput(): CreateEvidenceUploadInput {
  return {
    org_id: "org_synthetic",
    app: "iapp-synthetic",
    kind: "receipt",
    original_name: "receipt.txt",
    content_type: "text/plain",
    size: fixtureBytes.length,
    checksum: sha256Buffer(fixtureBytes),
    checksum_algorithm: "sha256",
  };
}

function createResponse(input: CreateEvidenceUploadInput, uploadUrl: string): EvidenceUploadResult {
  const now = new Date().toISOString();
  const checksum = input.checksum;
  const checksumAlgorithm = input.checksum_algorithm ?? "sha256";
  const asset: FileAsset = {
    id: "asset_synthetic",
    org_id: input.org_id,
    company_id: input.company_id,
    app: input.app,
    kind: input.kind,
    classification: input.classification ?? "evidence",
    original_name: input.original_name,
    content_type: input.content_type ?? "application/octet-stream",
    size: input.size,
    checksum,
    checksum_algorithm: checksumAlgorithm,
    storage_provider: "s3",
    bucket: "synthetic-bucket",
    region: "us-east-1",
    object_key: "evidence/synthetic-object",
    quarantine_key: "quarantine/evidence/synthetic-object",
    status: "pending_upload",
    scan_status: "pending",
    retention_until: input.retention_until,
    retention_policy: input.retention_policy,
    storage_class: input.storage_class,
    legal_hold: input.legal_hold ?? false,
    immutable: input.immutable ?? false,
    metadata: input.metadata ?? {},
    created_at: now,
    updated_at: now,
  };
  return {
    asset,
    intent: {
      id: "intent_synthetic",
      asset_id: asset.id,
      method: "PUT",
      upload_url: uploadUrl,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      status: "pending",
      expected_checksum: checksum,
      expected_checksum_algorithm: checksumAlgorithm,
      expected_size: input.size,
      required_headers: {
        "content-type": asset.content_type,
        "x-amz-checksum-sha256": Buffer.from(checksum, "hex").toString("base64"),
        "x-amz-meta-asset-id": asset.id,
        "x-amz-meta-org-id": asset.org_id,
        "x-amz-meta-app": asset.app,
        "x-amz-meta-kind": asset.kind,
        "x-amz-meta-checksum": checksum,
        "x-amz-meta-checksum-algorithm": checksumAlgorithm,
      },
      metadata: {},
      created_at: now,
    },
  };
}

function completedAsset(asset: FileAsset): FileAsset {
  const now = new Date().toISOString();
  return {
    ...asset,
    status: "verified",
    scan_status: "skipped",
    updated_at: now,
    verified_at: now,
  };
}
