import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { CLOUD_MIGRATIONS, FILE_CONTENT_TENANCY_MIGRATIONS } from "../db/cloud-migrations.js";
import { createV1Handler } from "./v1.js";
import type { RemoteObjectReader } from "./file-content.js";

const SIGNING_SECRET = "test-only-files-content-signing-secret-with-32-bytes";
const PRIVATE_BYTES = Buffer.from("PRIVATE_SERVER_BYTES_7004\n", "utf8");
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function token(kid: string): string {
  return mintApiKey({
    app: "files",
    kid,
    scopes: ["files:read"],
    signingSecret: SIGNING_SECRET,
  }).token;
}

interface FakeClientOptions {
  keyTenants?: Record<string, string | undefined>;
  objectTenant?: string;
}

function fakeClient(options: FakeClientOptions = {}): TypedQueryClient {
  const keyTenants = options.keyTenants ?? {
    "kid-a": TENANT_A,
    "kid-b": TENANT_B,
  };
  const objectTenant = "objectTenant" in options ? options.objectTenant : TENANT_A;
  return {
    async query() {
      return { rows: [] as never[], rowCount: 0 };
    },
    async many<T>() {
      return [] as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      if (sql.includes("api_key_tenants")) {
        const tenant = keyTenants[String(params[0])];
        return tenant ? ({ tenant_id: tenant } as T) : null;
      }
      if (sql.includes("LEFT JOIN LATERAL")) {
        if (params[0] === "f_missing") return null;
        return {
          file_id: String(params[0]),
          file_mime: "text/plain",
          file_size: PRIVATE_BYTES.byteLength,
          revision_id: "rev_remote",
          source_ref: `open-files://file/${String(params[0])}/revision/rev_remote`,
          storage_provider: "s3",
          bucket: "private-bucket-never-returned",
          region: "us-east-1",
          object_key: "private/object-key-never-returned.txt",
          version_id: "version-remote-1",
          tenant_id: objectTenant,
        } as T;
      }
      return null;
    },
    async one<T>() {
      return {} as T;
    },
    async execute() {},
  };
}

function handler(reader: RemoteObjectReader, options: FakeClientOptions = {}) {
  const client = fakeClient(options);
  return createV1Handler({
    getClient: () => client,
    verifier: verifyApiKey({ app: "files", signingSecret: SIGNING_SECRET }),
    readObject: reader,
  });
}

function request(path: string, apiKey?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (apiKey) headers.set("x-api-key", apiKey);
  return new Request(`https://files.example.test${path}`, { ...init, headers });
}

describe("authenticated hosted file content", () => {
  test("returns exact bytes to the authorized tenant without storage metadata", async () => {
    let reads = 0;
    const h = handler(async (locator) => {
      expect(locator.version_id).toBe("version-remote-1");
      reads++;
      return new Response(PRIVATE_BYTES);
    });
    const req = request("/v1/files/f_remote/content", token("kid-a"));
    const response = await h.handle(req, new URL(req.url));

    expect(response?.status).toBe(200);
    expect(Buffer.from(await response!.arrayBuffer())).toEqual(PRIVATE_BYTES);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(response?.headers.get("content-disposition")).toBeNull();
    expect(reads).toBe(1);
  });

  test("returns exact derived extraction to the authorized tenant", async () => {
    const h = handler(async (_locator, options) => {
      expect(options?.max_bytes).toBe(128);
      return new Response(PRIVATE_BYTES);
    });
    const req = request("/v1/files/f_remote/extract-text", token("kid-a"), {
      method: "POST",
      body: JSON.stringify({ max_bytes: 128, max_segment_chars: 256 }),
      headers: { "content-type": "application/json" },
    });
    const response = await h.handle(req, new URL(req.url));
    const result = await response!.json() as {
      source_ref: string;
      segments: Array<{ text: string }>;
    };

    expect(response?.status).toBe(200);
    expect(result.source_ref).toBe("open-files://file/f_remote/revision/rev_remote");
    expect(result.segments[0]?.text).toBe(PRIVATE_BYTES.toString("utf8"));
    expect(JSON.stringify(result)).not.toContain("private-bucket-never-returned");
    expect(JSON.stringify(result)).not.toContain("private/object-key-never-returned");
  });

  test("rejects unauthenticated, wrong-tenant, and missing files before object access", async () => {
    let reads = 0;
    const h = handler(async () => {
      reads++;
      return new Response(PRIVATE_BYTES);
    });

    const cases = [
      { path: "/v1/files/f_remote/content", key: undefined, status: 401 },
      { path: "/v1/files/f_remote/content", key: token("kid-b"), status: 404 },
      { path: "/v1/files/f_missing/content", key: token("kid-a"), status: 404 },
    ];
    for (const value of cases) {
      const req = request(value.path, value.key);
      const response = await h.handle(req, new URL(req.url));
      expect(response?.status).toBe(value.status);
      const body = await response!.text();
      expect(body).not.toContain("private-bucket-never-returned");
      expect(body).not.toContain("private/object-key-never-returned");
      expect(body).not.toContain(PRIVATE_BYTES.toString("utf8").trim());
    }
    expect(reads).toBe(0);
  });

  test("fails closed for every missing key/object tenant combination before object access", async () => {
    const cases: FakeClientOptions[] = [
      { keyTenants: {}, objectTenant: undefined },
      { keyTenants: {}, objectTenant: TENANT_A },
      { keyTenants: { "kid-a": TENANT_A }, objectTenant: undefined },
      { keyTenants: { "kid-a": TENANT_B }, objectTenant: TENANT_A },
    ];

    for (const options of cases) {
      let reads = 0;
      const h = handler(async () => {
        reads++;
        return new Response(PRIVATE_BYTES);
      }, options);
      const req = request("/v1/files/f_remote/content", token("kid-a"));
      const response = await h.handle(req, new URL(req.url));

      expect(response?.status).toBe(404);
      expect(await response!.text()).not.toContain(PRIVATE_BYTES.toString("utf8").trim());
      expect(reads).toBe(0);
    }
  });

  test("rejects extraction for a wrong tenant before object access", async () => {
    let reads = 0;
    const h = handler(async () => {
      reads++;
      return new Response(PRIVATE_BYTES);
    });
    const req = request("/v1/files/f_remote/extract-text", token("kid-b"), {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const response = await h.handle(req, new URL(req.url));

    expect(response?.status).toBe(404);
    expect(await response!.text()).not.toContain(PRIVATE_BYTES.toString("utf8").trim());
    expect(reads).toBe(0);
  });

  test("orders key tenancy after auth and backfills only explicit scoped objects", () => {
    const ids = CLOUD_MIGRATIONS.map((migration) => migration.id);
    const authIndex = ids.indexOf("hasna_auth_0002_api_keys_indexes");
    const tenantIndex = ids.indexOf("files-content-tenant-0001-key-map");
    const sql = FILE_CONTENT_TENANCY_MIGRATIONS.map((migration) => migration.sql).join("\n");

    expect(authIndex).toBeGreaterThan(-1);
    expect(tenantIndex).toBeGreaterThan(authIndex);
    expect(sql).toContain("REFERENCES api_keys(kid) ON DELETE CASCADE");
    expect(sql).toContain("WHERE org_id IS NOT NULL");
    expect(sql).toContain("HAVING COUNT(DISTINCT org_id) = 1");
    expect(sql).toContain("fv.s3_object_id IS NULL");
    expect(sql).not.toContain("SET org_id =");
  });

  test("maps a missing object to a generic 404 without provider details", async () => {
    const h = handler(async () => null);
    const req = request("/v1/files/f_remote/content", token("kid-a"));
    const response = await h.handle(req, new URL(req.url));
    const body = await response!.text();

    expect(response?.status).toBe(404);
    expect(body).toContain("File not found");
    expect(body).not.toContain("bucket");
    expect(body).not.toContain("object");
  });
});
