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
const ASSET_ID = "asset_0123456789abcdef";
const INTENT_ID = "upl_0123456789ab";
const QUARANTINE_KEY = "quarantine/evidence/synthetic-object";
writeFileSync(fixture, fixtureBytes);

let uploadStatus = 200;
let uploadCalls = 0;
let uploadedBytes = Buffer.alloc(0);
let uploadedHeaders: Headers | undefined;
let server: ReturnType<typeof Bun.serve>;
const priorUploadOrigins = process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS;
const priorLoopbackPolicy = process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK;
const priorUploadBuckets = process.env.HASNA_FILES_EVIDENCE_UPLOAD_BUCKETS;

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
  process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS = server.url.origin;
  process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK = "1";
  process.env.HASNA_FILES_EVIDENCE_UPLOAD_BUCKETS = "synthetic-bucket";
});

afterAll(() => {
  server.stop(true);
  rmSync(testDir, { recursive: true, force: true });
  if (priorUploadOrigins === undefined) delete process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS;
  else process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS = priorUploadOrigins;
  if (priorLoopbackPolicy === undefined) delete process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK;
  else process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK = priorLoopbackPolicy;
  if (priorUploadBuckets === undefined) delete process.env.HASNA_FILES_EVIDENCE_UPLOAD_BUCKETS;
  else process.env.HASNA_FILES_EVIDENCE_UPLOAD_BUCKETS = priorUploadBuckets;
});

describe("ApiStore evidence response boundary", () => {
  test("rejects malformed or contradictory create-intent payloads before byte transport", async () => {
    const input = baseInput();
    const valid = createResponse(input, uploadUrl(server.url));
    const unsafeId = "https://synthetic.invalid/transport/CANARY_RECEIPT_ID";
    const invalidPayloads: unknown[] = [
      {},
      { ...valid, unexpected: true },
      { ...valid, intent: { ...valid.intent, method: "POST" } },
      { ...valid, intent: { ...valid.intent, upload_url: undefined } },
      { ...valid, intent: { ...valid.intent, upload_url: "file:///tmp/CANARY_FORBIDDEN_SCHEME" } },
      { ...valid, intent: { ...valid.intent, upload_url: "https://synthetic.invalid/CANARY_FORBIDDEN_ORIGIN" } },
      { ...valid, intent: { ...valid.intent, upload_url: `https://sts.amazonaws.com/${QUARANTINE_KEY}` } },
      { ...valid, intent: { ...valid.intent, upload_url: `https://other-bucket.s3.us-east-1.amazonaws.com/${QUARANTINE_KEY}` } },
      {
        ...valid,
        asset: { ...valid.asset, bucket: "undeclared-bucket" },
        intent: { ...valid.intent, upload_url: `https://undeclared-bucket.s3.us-east-1.amazonaws.com/${QUARANTINE_KEY}` },
      },
      {
        ...valid,
        asset: { ...valid.asset, bucket: "hasna-xyz-opensource-files-prod" },
        intent: {
          ...valid.intent,
          upload_url: `https://hasna-xyz-opensource-files-prod.s3.us-east-1.amazonaws.com/${QUARANTINE_KEY}`,
        },
      },
      { ...valid, intent: { ...valid.intent, upload_url: `https://synthetic-bucket.s3.us-east-1.amazonaws.com/wrong-key` } },
      {
        ...valid,
        asset: { ...valid.asset, quarantine_key: "quarantine/unrelated-object" },
        intent: {
          ...valid.intent,
          upload_url: "https://synthetic-bucket.s3.us-east-1.amazonaws.com/quarantine/unrelated-object",
        },
      },
      { ...valid, intent: { ...valid.intent, asset_id: "asset_other" } },
      { ...valid, asset: { ...valid.asset, id: unsafeId }, intent: { ...valid.intent, asset_id: unsafeId } },
      { ...valid, intent: { ...valid.intent, id: "https://synthetic.invalid/transport/CANARY_RECEIPT_INTENT" } },
      { ...valid, intent: { ...valid.intent, completed_at: "https://synthetic.invalid/transport/CANARY_COMPLETED_AT" } },
      { ...valid, intent: { ...valid.intent, created_at: "Fri, 10 Jul 2026 00:00:00 GMT (https://synthetic.invalid/CANARY_CREATED_AT)" } },
      { ...valid, intent: { ...valid.intent, expires_at: new Date(Date.now() + 3_600_000).toISOString() } },
      {
        ...valid,
        intent: {
          ...valid.intent,
          created_at: "2099-01-01T00:00:00.000Z",
          expires_at: "2099-01-01T00:01:00.000Z",
        },
      },
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

  test("rejects a non-finite requested upload lifetime before calling the service", async () => {
    let serviceCalls = 0;
    const store = apiStore(async () => {
      serviceCalls += 1;
      return {};
    });

    await expect(store.createEvidenceUploadIntent({
      ...baseInput(),
      expires_in_seconds: Number.POSITIVE_INFINITY,
    })).rejects.toThrow("Invalid evidence upload request");
    expect(serviceCalls).toBe(0);
  });

  test("accepts an explicitly allowlisted non-AWS HTTPS upload origin", async () => {
    const key = "HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS";
    const prior = process.env[key];
    process.env[key] = "https://uploads.synthetic.invalid";
    try {
      const input = baseInput();
      const response = createResponse(input, `https://uploads.synthetic.invalid/${QUARANTINE_KEY}`);
      const store = apiStore(async () => response);
      expect((await store.createEvidenceUploadIntent(input)).intent.id).toBe(INTENT_ID);
    } finally {
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    }
  });

  test("rejects loopback HTTP unless both the origin and insecure test policy are explicit", async () => {
    const origins = process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS;
    const policy = process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK;
    delete process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS;
    delete process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK;
    try {
      const input = baseInput();
      const response = createResponse(input, uploadUrl(server.url));
      const store = apiStore(async () => response);
      await expect(store.createEvidenceUploadIntent(input)).rejects.toThrow("Invalid evidence upload intent response");
    } finally {
      if (origins !== undefined) process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS = origins;
      if (policy !== undefined) process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK = policy;
    }
  });

  test("rejects secret-bearing or invalid headers before PUT and completion", async () => {
    uploadCalls = 0;
    let completionCalls = 0;
    const store = apiStore(async (path, body) => {
      if (path === "/evidence/upload-intents") {
        const response = createResponse(body as CreateEvidenceUploadInput, uploadUrl(server.url));
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
        created = createResponse(body as CreateEvidenceUploadInput, uploadUrl(server.url));
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
    expect(uploadedHeaders?.get("x-amz-meta-asset-id")).toBe(ASSET_ID);
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
      (asset) => ({ ...completedAsset(asset), verified_at: "Fri, 10 Jul 2026 00:00:00 GMT (https://synthetic.invalid/CANARY_VERIFIED_AT)" }),
    ];

    for (const mutate of completionMutators) {
      let created: EvidenceUploadResult | undefined;
      const store = apiStore(async (path, body) => {
        if (path === "/evidence/upload-intents") {
          created = createResponse(body as CreateEvidenceUploadInput, uploadUrl(server.url));
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
        return createResponse(body as CreateEvidenceUploadInput, uploadUrl(server.url));
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

  test("refuses byte-transport redirects without forwarding the PUT body", async () => {
    let targetCalls = 0;
    let completionCalls = 0;
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        targetCalls += 1;
        await request.arrayBuffer();
        return new Response(null, { status: 200 });
      },
    });
    const source = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.redirect(uploadUrl(target.url), 307);
      },
    });
    const priorOrigins = process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS;
    process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS = [server.url.origin, source.url.origin, target.url.origin].join(",");

    try {
      let created: EvidenceUploadResult | undefined;
      const store = apiStore(async (path, body) => {
        if (path === "/evidence/upload-intents") {
          created = createResponse(body as CreateEvidenceUploadInput, uploadUrl(source.url));
          return created;
        }
        if (path.endsWith("/complete")) {
          completionCalls += 1;
          return completedAsset(created!.asset);
        }
        throw new Error("unexpected path");
      });

      await expect(store.uploadEvidenceFile({
        path: fixture,
        org_id: "org_synthetic",
        app: "iapp-synthetic",
        kind: "receipt",
      })).rejects.toThrow("Evidence byte upload transport failed before completion");
      expect(targetCalls).toBe(0);
      expect(completionCalls).toBe(0);
    } finally {
      if (priorOrigins === undefined) delete process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS;
      else process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS = priorOrigins;
      source.stop(true);
      target.stop(true);
    }
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

    expect(caught).not.toBe(original);
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
    id: ASSET_ID,
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
    quarantine_key: QUARANTINE_KEY,
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
      id: INTENT_ID,
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

function uploadUrl(origin: URL): string {
  return new URL(`/${QUARANTINE_KEY}`, origin).toString();
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
