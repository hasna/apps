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
  const keyTenants = options.keyTenants ?? {
    "kid-a": TENANT_A,
    "kid-b": TENANT_B,
  };
  return createV1Handler({
    getClient: () => client,
    verifier: verifyApiKey({
      app: "files",
      signingSecret: SIGNING_SECRET,
      keyStatus: async (kid) => (keyTenants[kid] !== undefined ? "active" : "unknown"),
    }),
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

  test("content route passes a bounded max_bytes to the object reader and serves only the bound", async () => {
    const seen: Array<{ max_bytes?: number }> = [];
    const h = handler(async (_locator, options) => {
      seen.push(options ?? {});
      const bound = options?.max_bytes ?? PRIVATE_BYTES.byteLength;
      return new Response(PRIVATE_BYTES.subarray(0, bound));
    });
    const req = request("/v1/files/f_remote/content?max_bytes=4", token("kid-a"));
    const response = await h.handle(req, new URL(req.url));

    expect(response?.status).toBe(200);
    expect(Buffer.from(await response!.arrayBuffer())).toEqual(Buffer.from("PRIV"));
    expect(seen[0]?.max_bytes).toBe(4);
  });

  test("content route clamps an absurd max_bytes to the server-side cap", async () => {
    const seen: Array<{ max_bytes?: number }> = [];
    const h = handler(async (_locator, options) => {
      seen.push(options ?? {});
      return new Response(PRIVATE_BYTES);
    });
    const req = request("/v1/files/f_remote/content?max_bytes=999999999999", token("kid-a"));
    const response = await h.handle(req, new URL(req.url));

    expect(response?.status).toBe(200);
    expect(seen[0]?.max_bytes).toBeLessThanOrEqual(10 * 1024 * 1024);
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

  test("keeps the shared request loop responsive while applying caller redactions", async () => {
    const bytes = Buffer.from(`${"a".repeat(36)}!`, "utf8");
    let timerFiredAt = 0;
    let resolveTimer!: () => void;
    const timerDone = new Promise<void>((resolve) => {
      resolveTimer = resolve;
    });
    const h = handler(async () => ({
      async arrayBuffer() {
        setTimeout(() => {
          timerFiredAt = performance.now();
          resolveTimer();
        }, 10);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    }) as Response);
    const req = request("/v1/files/f_remote/extract-text", token("kid-a"), {
      method: "POST",
      body: JSON.stringify({ redact_patterns: ["(a+)+$", "!"] }),
      headers: { "content-type": "application/json" },
    });

    const startedAt = performance.now();
    const response = await h.handle(req, new URL(req.url));
    const extractionDoneAt = performance.now();
    const timerFiredBeforeRouteCompleted = timerFiredAt > 0;
    await timerDone;
    const result = await response!.json() as {
      redacted: boolean;
      segments: Array<{ text: string }>;
    };

    console.log(`event_loop_route_status=${response?.status}`);
    console.log(`event_loop_extract_elapsed_ms=${Math.round(extractionDoneAt - startedAt)}`);
    console.log(`event_loop_timer_delay_ms=${Math.round(timerFiredAt - startedAt)}`);

    expect(response?.status).toBe(200);
    expect(timerFiredBeforeRouteCompleted).toBe(true);
    expect(result.redacted).toBe(true);
    expect(result.segments[0]?.text).toBe(`${"a".repeat(36)}[REDACTED]`);
    expect(JSON.stringify(result)).not.toContain("private-bucket-never-returned");
    expect(JSON.stringify(result)).not.toContain("private/object-key-never-returned");
  });

  test("preserves generic invalid-redaction errors across worker isolation", async () => {
    const h = handler(async () => new Response(PRIVATE_BYTES));
    const req = request("/v1/files/f_remote/extract-text", token("kid-a"), {
      method: "POST",
      body: JSON.stringify({ redact_patterns: ["["] }),
      headers: { "content-type": "application/json" },
    });

    const response = await h.handle(req, new URL(req.url));
    const body = await response!.text();

    expect(response?.status).toBe(400);
    expect(body).toContain("Invalid extraction options");
    expect(body).not.toContain(PRIVATE_BYTES.toString("utf8").trim());
    expect(body).not.toContain("private-bucket-never-returned");
    expect(body).not.toContain("private/object-key-never-returned");
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
    const cases: Array<[FakeClientOptions, number]> = [
      // Unregistered key: contracts 0.13.1 denies with 401 (unknown keyStatus).
      [{ keyTenants: {}, objectTenant: undefined }, 401],
      [{ keyTenants: {}, objectTenant: TENANT_A }, 401],
      // Registered key but missing or mismatched object tenant: 404, no object read.
      [{ keyTenants: { "kid-a": TENANT_A }, objectTenant: undefined }, 404],
      [{ keyTenants: { "kid-a": TENANT_B }, objectTenant: TENANT_A }, 404],
    ];

    for (const [options, expectedStatus] of cases) {
      let reads = 0;
      const h = handler(async () => {
        reads++;
        return new Response(PRIVATE_BYTES);
      }, options);
      const req = request("/v1/files/f_remote/content", token("kid-a"));
      const response = await h.handle(req, new URL(req.url));

      expect(response?.status).toBe(expectedStatus);
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
