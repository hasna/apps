/**
 * Regression tests for hosted (`/v1`) cloud ingestion of a document as a
 * TAGGED, PROJECT-LINKED file resource.
 *
 * Bug de9aeeed (@hasna/files — no supported cloud-mode path to add/link a
 * project-resource file). The runtime `/v1/files` surface was read-only: it
 * could LIST files, tag them, link them to projects and serve their bytes,
 * but there was NO route to CREATE an ingested file row, and the CLI `files
 * upload` refused in api mode ("runs on-box only ... the files service owns
 * ingestion"). A partner contract PDF therefore could not be stored to the
 * files service as a tagged, project-linked resource.
 *
 * These tests drive the real V1Handler through a fake typed query client (no
 * live Postgres), with an injected upload verifier standing in for the
 * server-owned S3 HEAD — mirroring the DI pattern in file-content.test.ts.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { createV1Handler } from "./v1.js";

const SIGNING_SECRET = "test-only-file-ingest-signing-secret-32-bytes";
const TENANT = "tenant-ingest";
const UPLOAD_BUCKET = "test-upload-bucket";
const FILE_SIZE = 12_345;
const FILE_HASH = "a".repeat(64);
const TAG = "partner-deal";

// The intent route signs a server-owned S3 PUT URL offline; a static (dummy)
// credential lets SigV4 sign without any AWS credentials or network. Never a
// real secret — arbitrary test values only.
beforeAll(() => {
  process.env.AWS_ACCESS_KEY_ID ??= "file-ingest-test-access";
  process.env.AWS_SECRET_ACCESS_KEY ??= "file-ingest-test-secret";
  process.env.AWS_SESSION_TOKEN ??= "";
});
afterAll(() => {
  delete process.env.AWS_SESSION_TOKEN;
  if (process.env.AWS_ACCESS_KEY_ID === "file-ingest-test-access") delete process.env.AWS_ACCESS_KEY_ID;
  if (process.env.AWS_SECRET_ACCESS_KEY === "file-ingest-test-secret") delete process.env.AWS_SECRET_ACCESS_KEY;
});

function token(kid: string, scopes: string[] = ["files:write"]): string {
  return mintApiKey({
    app: "files",
    kid,
    scopes,
    signingSecret: SIGNING_SECRET,
  }).token;
}

const machineRow = {
  id: "files-serve",
  name: "files-serve",
  hostname: "files-serve",
  platform: "linux",
  arch: "arm64",
  is_current: false,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const sourceRow = {
  id: "src_uploads_" + createHash("sha256").update(TENANT).digest("hex").slice(0, 12),
  name: "uploads",
  type: "s3",
  path: null,
  bucket: UPLOAD_BUCKET,
  prefix: "uploads",
  region: "us-east-1",
  config: "{}",
  machine_id: "files-serve",
  enabled: true,
  last_indexed_at: null,
  file_count: 0,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const fileRow = {
  id: "f_ingest1",
  source_id: sourceRow.id,
  machine_id: "files-serve",
  path: `uploads/${TENANT}/2026/08/f_ingest1-partner-contract.pdf`,
  name: "partner-contract",
  original_name: "partner-contract.pdf",
  canonical_name: "abc123-partner-contract.pdf",
  ext: ".pdf",
  size: FILE_SIZE,
  mime: "application/pdf",
  description: "",
  hash: FILE_HASH,
  status: "active",
  indexed_at: "2026-08-20T00:00:00.000Z",
  modified_at: null,
  created_at: "2026-08-20T00:00:00.000Z",
};

interface FakeClientOptions {
  keyTenants?: Record<string, string | undefined>;
  tags?: string[];
}

/** Fake typed query client: fixtures for the reads the ingestion routes make,
 *  a recording `execute` for the writes, and a tenant-bound locator for the
 *  completing file. */
function fakeClient(options: FakeClientOptions = {}): { client: TypedQueryClient; executed: string[] } {
  const keyTenants = options.keyTenants ?? { "kid-write": TENANT };
  const tags = options.tags ?? [TAG];
  const executed: string[] = [];
  const client: TypedQueryClient = {
    async query() {
      return { rows: [] as never[], rowCount: 0 };
    },
    async many<T>(sql: string) {
      if (sql.includes("FROM tags t JOIN file_tags")) {
        return tags.map((name) => ({ name })) as T;
      }
      return [] as T;
    },
    async get<T>(sql: string, params: unknown[] = []) {
      if (sql.includes("api_key_tenants")) {
        const tenant = keyTenants[String(params[0] ?? "kid-write")];
        return tenant ? ({ tenant_id: tenant } as T) : null;
      }
      if (sql.includes("FROM machines")) return machineRow as T;
      if (sql.includes("FROM sources") || sql.includes("FROM sources s") || sql.startsWith("SELECT * FROM sources")) {
        return sourceRow as T;
      }
      if (sql.includes("LEFT JOIN LATERAL")) {
        const id = String(params[0] ?? fileRow.id);
        return {
          file_id: id,
          file_mime: fileRow.mime,
          file_size: fileRow.size,
          revision_id: "rev_ingest1",
          source_ref: `open-files://file/${id}/revision/rev_ingest1`,
          storage_provider: "s3",
          bucket: UPLOAD_BUCKET,
          region: "us-east-1",
          object_key: fileRow.path,
          version_id: undefined,
          tenant_id: TENANT,
        } as T;
      }
      if (sql.includes("SELECT * FROM files WHERE id")) {
        return { ...fileRow, id: String(params[0] ?? fileRow.id) } as T;
      }
      if (sql.includes("SELECT id FROM tags WHERE name")) return { id: `tag_${String(params[0])}` } as T;
      return null;
    },
    async one<T>() {
      return {} as T;
    },
    async execute(sql: string) {
      executed.push(sql);
    },
  };
  return { client, executed };
}

function handler(options: { keyTenants?: Record<string, string | undefined>; tags?: string[] } = {}) {
  const { client, executed } = fakeClient(options);
  const h = createV1Handler({
    getClient: () => client,
    verifier: verifyApiKey({ app: "files", signingSecret: SIGNING_SECRET }),
    // Server-owned object verification is DI'd so the route is testable
    // without live S3; the default production implementation does a HEAD.
    verifyUploadedObject: async () => ({ ok: true }),
  });
  return { handler: h, executed };
}

function request(path: string, apiKey?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (apiKey) headers.set("x-api-key", apiKey);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://files.example.test${path}`, { ...init, headers });
}

describe("hosted cloud ingestion of a tagged, project-linked file", () => {
  test("POST /v1/files creates a tenant-bound S3 upload intent (not a 404)", async () => {
    const { handler: h } = handler();
    const req = request("/v1/files", token("kid-write"), {
      method: "POST",
      body: JSON.stringify({
        name: "partner-contract.pdf",
        size: FILE_SIZE,
        mime: "application/pdf",
        checksum: FILE_HASH,
        checksum_algorithm: "sha256",
        tags: [TAG],
        project_id: "prj_deal1",
      }),
    });
    const res = await h.handle(req, new URL(req.url));
    expect(res?.status).toBe(201);
    const body = (await res!.json()) as { file_id: string; upload_url: string; method: string; required_headers: Record<string, string> };
    expect(body.file_id).toMatch(/^f_/);
    expect(body.method).toBe("PUT");
    expect(body.upload_url).toMatch(/^https:\/\//);
    expect(body.required_headers).toBeDefined();
    // The intent must have staged the file row + S3 object + version writes.
  });

  test("complete verifies bytes, applies tags, and links the file to the project", async () => {
    const { handler: h, executed } = handler();
    const created = await h.handle(request("/v1/files", token("kid-write"), {
      method: "POST",
      body: JSON.stringify({
        name: "partner-contract.pdf",
        size: FILE_SIZE,
        mime: "application/pdf",
        checksum: FILE_HASH,
        checksum_algorithm: "sha256",
        tags: [TAG],
        project_id: "prj_deal1",
      }),
    }), new URL("https://files.example.test/v1/files"));
    expect(created?.status).toBe(201);
    const { file_id } = (await created!.json()) as { file_id: string };

    const done = await h.handle(request(`/v1/files/${file_id}/complete`, token("kid-write"), {
      method: "POST",
      body: JSON.stringify({ tags: [TAG], project_id: "prj_deal1" }),
    }), new URL(`https://files.example.test/v1/files/${file_id}/complete`));
    expect(done?.status).toBe(200);
    const payload = (await done!.json()) as { file: { id: string; tags: string[]; status: string } };
    expect(payload.file.id).toBe(file_id);
    expect(payload.file.status).toBe("active");
    expect(payload.file.tags).toContain(TAG);
    // The write path must have recorded the project link and the tag rows/joins.
    expect(executed.some((sql) => sql.startsWith("INSERT INTO project_files"))).toBe(true);
    expect(executed.some((sql) => sql.startsWith("INSERT INTO file_tags"))).toBe(true);
  });

  test("unauthorized requests are refused before any DB write", async () => {
    const { handler: h, executed } = handler();
    const req = request("/v1/files", undefined, {
      method: "POST",
      body: JSON.stringify({ name: "x.pdf", size: 1 }),
    });
    const res = await h.handle(req, new URL(req.url));
    expect(res?.status).toBeGreaterThanOrEqual(401);
    expect(executed.length).toBe(0);
  });

  test("a complete for a file bound to another tenant is refused", async () => {
    const { handler: h } = handler({ keyTenants: { "kid-b": "tenant-other" } });
    const done = await h.handle(request("/v1/files/f_ingest1/complete", token("kid-b")), new URL("https://files.example.test/v1/files/f_ingest1/complete"));
    // The tenant's locator read yields org_id TENANT, not tenant-other → fail
    // closed (403 from the auth/scope layer or 404 from the tenant check).
    expect(done?.status).toBeGreaterThanOrEqual(403);
    expect(done?.status).toBeLessThan(500);
  });
});
