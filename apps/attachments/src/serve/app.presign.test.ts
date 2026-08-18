/**
 * Regression suite for presigned direct upload on the HOSTED /v1 backend.
 *
 * Before the port, presign-upload / presign-upload/complete existed only on
 * the on-box `/api` server and the local-only CLI/MCP path ("presign is only
 * available in local mode"). The capability itself does not require client
 * credentials — the server (which holds the S3 creds) mints the PUT URL — so
 * the hosted path must carry it identically.
 *
 * These tests exercise the /v1 routes end to end against the in-memory store
 * harness and a mocked S3 client.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";

class MockS3Client {
  constructor(_config: unknown) {}
  async presignPut(_key: string, _contentType: string, expiresIn: number) {
    return `https://bucket.s3.amazonaws.com/${_key}?X-Amz-Expires=${expiresIn}`;
  }
  async presign(key: string, _expiresIn: number) {
    return `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=ready`;
  }
  async head(_key: string) {
    return { contentLength: 4096, contentType: "application/pdf" };
  }
  async upload() {}
  async delete(_key: string) {}
}

mock.module("../core/s3.js", () => ({ S3Client: MockS3Client }));
afterAll(() => mock.restore());

const { createServeApp } = await import("./app.js");
const { normalizeConfig } = await import("../core/config.js");
const { InMemoryAttachmentsStore, stubQueryClient } = await import("./serve.test-harness.test.js");
const { buildOpenApiDocument } = await import("./openapi.js");

const SIGNING = "test-signing-secret";
const PUBLIC_BASE = "https://has.na";

let store: InstanceType<typeof InMemoryAttachmentsStore>;

function makeApp() {
  store = new InMemoryAttachmentsStore();
  return createServeApp({
    client: stubQueryClient() as never,
    store: store as never,
    config: normalizeConfig({
      s3: { bucket: "test-bucket", region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "s" },
      storage: { backend: "s3", maxSizeBytes: 10 * 1024 * 1024 },
      server: { baseUrl: PUBLIC_BASE, publicPath: "/a" },
      domains: [{ hostname: "has.na", baseUrl: PUBLIC_BASE, primary: true }],
      defaults: { linkType: "presigned", expiry: "7d" },
    }),
    version: "test",
    mode: "cloud",
    signingSecret: SIGNING,
    keyStatus: async () => "active",
  });
}

function writeKey() {
  return mintApiKey({ app: "attachments", scopes: ["attachments:read", "attachments:write"], signingSecret: SIGNING }).token;
}

function readKey() {
  return mintApiKey({ app: "attachments", scopes: ["attachments:read"], signingSecret: SIGNING }).token;
}

function pendingAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "att_pending1",
    filename: "report.pdf",
    s3Key: "attachments/2026-08-18/att_pending1/report.pdf",
    bucket: "test-bucket",
    size: 0,
    contentType: "application/pdf",
    link: null,
    tag: null,
    expiresAt: Date.now() + 3600000,
    createdAt: Date.now(),
    storageBackend: "s3" as const,
    status: "pending" as const,
    ...overrides,
  };
}

describe("/v1 presigned direct upload (ported from local-only)", () => {
  beforeEach(() => {
    store = new InMemoryAttachmentsStore();
  });

  test("POST /v1/attachments/presign-upload returns a presigned PUT URL and stores a pending record", async () => {
    const app = makeApp();
    const res = await app.request("/v1/attachments/presign-upload", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({ filename: "report.pdf", expiry: "2h" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toMatch(/^att_/);
    expect(body.upload_url).toContain("X-Amz-Expires=7200");
    expect(body.content_type).toBe("application/pdf");
    expect(body.filename).toBe("report.pdf");
    expect(body.finalize_url).toBe(`/v1/attachments/${body.id}/presign-upload/complete`);
    const pending = store.attachments.find((a) => a.id === body.id);
    expect(pending?.status).toBe("pending");
    expect(pending?.size).toBe(0);
  });

  test("presign-upload rejects a missing filename with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/attachments/presign-upload", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: expect.stringContaining("filename") });
  });

  test("presign-upload rejects a declared size above the maximum with 413", async () => {
    const app = makeApp();
    const res = await app.request("/v1/attachments/presign-upload", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({ filename: "huge.bin", size: 11 * 1024 * 1024 }),
    });
    expect(res.status).toBe(413);
  });

  test("presign-upload rejects expiry=never with 400", async () => {
    const app = makeApp();
    const res = await app.request("/v1/attachments/presign-upload", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({ filename: "a.txt", expiry: "never" }),
    });
    expect(res.status).toBe(400);
  });

  test("presign-upload requires the write scope (read-only key gets 403)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/attachments/presign-upload", {
      method: "POST",
      headers: { "x-api-key": readKey(), "content-type": "application/json" },
      body: JSON.stringify({ filename: "a.txt" }),
    });
    expect(res.status).toBe(403);
  });

  test("POST /v1/attachments/:id/presign-upload/complete finalizes the pending upload with a presigned link", async () => {
    const app = makeApp();
    store.attachments.push(pendingAttachment());
    const res = await app.request("/v1/attachments/att_pending1/presign-upload/complete", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: string; size: number; attachment: Record<string, unknown> };
    expect(body.size).toBe(4096);
    expect(body.attachment.id).toBe("att_pending1");
    expect(body.link).toContain("X-Amz-Signature=ready");
    const row = store.attachments.find((a) => a.id === "att_pending1");
    expect(row?.status).toBe("ready");
    expect(row?.size).toBe(4096);
    expect(row?.link).toBe(body.link);
  });

  test("complete with a password creates a server-hosted share link instead of a presigned one", async () => {
    const app = makeApp();
    store.attachments.push(pendingAttachment());
    const res = await app.request("/v1/attachments/att_pending1/presign-upload/complete", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({ password: "secret", max_downloads: 2, link_type: "server" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: string };
    expect(body.link.startsWith(`${PUBLIC_BASE}/a/`)).toBe(true);
    expect(store.shareLinks).toHaveLength(1);
    expect(store.shareLinks[0]!.passwordHash).not.toBeNull();
    expect(store.shareLinks[0]!.maxUses).toBe(2);
  });

  test("complete rejects an unknown id with 404", async () => {
    const app = makeApp();
    const res = await app.request("/v1/attachments/att_missing/presign-upload/complete", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  test("complete rejects a non-pending attachment with 409", async () => {
    const app = makeApp();
    store.attachments.push(pendingAttachment({ status: "ready", size: 4096 }));
    const res = await app.request("/v1/attachments/att_pending1/presign-upload/complete", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });

  test("complete removes the record when the uploaded object exceeds the max size", async () => {
    const app = makeApp();
    store.attachments.push(pendingAttachment());
    // Override head for this case by inserting a row the route will re-head.
    // The mock head returns 4096 — exercise the oversized path through the
    // store record instead: seed a larger max so the route's check fires on
    // the mocked head by shrinking the max via a dedicated app.
    const small = new InMemoryAttachmentsStore();
    small.attachments.push(pendingAttachment());
    const appSmall = createServeApp({
      client: stubQueryClient() as never,
      store: small as never,
      config: normalizeConfig({
        s3: { bucket: "test-bucket", region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "s" },
        storage: { backend: "s3", maxSizeBytes: 1024 },
        server: { baseUrl: PUBLIC_BASE, publicPath: "/a" },
        domains: [{ hostname: "has.na", baseUrl: PUBLIC_BASE, primary: true }],
        defaults: { linkType: "presigned", expiry: "7d" },
      }),
      version: "test",
      mode: "cloud",
      signingSecret: SIGNING,
    keyStatus: async () => "active",
    });
    const res = await appSmall.request("/v1/attachments/att_pending1/presign-upload/complete", {
      method: "POST",
      headers: { "x-api-key": writeKey(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(413);
    expect(small.attachments.find((a) => a.id === "att_pending1")).toBeUndefined();
  });

  test("openapi document declares the /v1 presign routes", () => {
    const doc = buildOpenApiDocument("0.0.0") as { paths: Record<string, unknown> };
    expect(doc.paths["/v1/attachments/presign-upload"]).toBeDefined();
    expect(doc.paths["/v1/attachments/{id}/presign-upload/complete"]).toBeDefined();
  });
});
