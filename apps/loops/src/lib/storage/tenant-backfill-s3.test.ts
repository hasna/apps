import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";
import {
  fetchEcsTaskRoleCredentials,
  loadApprovedTenantBackfillBundle,
  logTenantBackfillS3Success,
  TENANT_BACKFILL_MAX_BYTES,
  type TenantBackfillFetch,
  type TenantBackfillS3Client,
} from "./tenant-backfill-s3.js";
import {
  loadTenantBackfillBundle,
  type TenantBackfillBundle,
} from "./tenant-backfill.js";

const RELATIVE_URI = "/v2/credentials/12345678-90ab-cdef-1234-567890abcdef";
const BUCKET = "private-bucket-do-not-log";
const REGION = "eu-central-1";
const CREDENTIALS = {
  AccessKeyId: "temporary-access-id-secret",
  SecretAccessKey: "temporary-secret-key-secret",
  Token: "temporary-session-token-secret",
  Expiration: "2099-01-01T00:00:00Z",
};

const bundle: TenantBackfillBundle = {
  schema: "open-loops.tenant-backfill/v1",
  tenants: [{ id: "tenant-private-id", slug: "tenant-private-slug", name: "Private Tenant", status: "active" }],
  principals: [{ id: "principal-private-id", kind: "service", displayName: "Private Principal", status: "active" }],
  memberships: [{ tenantId: "tenant-private-id", principalId: "principal-private-id", status: "active", roles: ["service"] }],
  keyBindings: [{ kid: "private-key-id", tenantId: "tenant-private-id", principalId: "principal-private-id", tokenKind: "service" }],
  rowAssignments: [{ table: "loops", rowId: "private-row-id", tenantId: "tenant-private-id" }],
};

function approvedObject(bytes: Uint8Array): { key: string; size: number } {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return { key: `approved/sha256-${digest}.json`, size: bytes.byteLength };
}

function credentialsFetch(onRequest?: (url: string, init?: RequestInit) => void): TenantBackfillFetch {
  return async (input: string, init?: RequestInit) => {
    onRequest?.(String(input), init);
    return new Response(JSON.stringify(CREDENTIALS), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function s3Fixture(options: {
  contents?: Array<{ key: string; size: number }>;
  bytes?: Uint8Array;
  isTruncated?: boolean;
  listError?: unknown;
  readError?: unknown;
  deleteError?: unknown;
  events?: string[];
}): TenantBackfillS3Client {
  return {
    list: async (input) => {
      options.events?.push(`list:${input.prefix}:${input.maxKeys}`);
      if (options.listError) throw options.listError;
      return { contents: options.contents, isTruncated: options.isTruncated };
    },
    file: () => ({
      bytes: async () => {
        options.events?.push("read");
        if (options.readError) throw options.readError;
        return options.bytes ?? new Uint8Array();
      },
    }),
    delete: async () => {
      options.events?.push("delete");
      if (options.deleteError) throw options.deleteError;
    },
  };
}

function deliveryOptions() {
  return {
    bucket: BUCKET,
    region: REGION,
    credentialsRelativeUri: RELATIVE_URI,
  };
}

const unusedClient = {} as PoolQueryClient;

describe("ECS task-role credential boundary", () => {
  test("fetches temporary credentials only from the fixed link-local ECS endpoint", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const credentials = await fetchEcsTaskRoleCredentials(
      RELATIVE_URI,
      credentialsFetch((url, init) => requests.push({ url, init })),
    );

    expect(requests).toEqual([{
      url: `http://169.254.170.2${RELATIVE_URI}`,
      init: { method: "GET", redirect: "error" },
    }]);
    expect(credentials).toEqual({
      accessKeyId: CREDENTIALS.AccessKeyId,
      secretAccessKey: CREDENTIALS.SecretAccessKey,
      sessionToken: CREDENTIALS.Token,
    });
  });

  test("rejects anything except one bounded ECS credential path segment", async () => {
    for (const value of [
      "",
      "http://example.invalid/credentials",
      "//example.invalid/credentials",
      "/v2/credentials/../metadata",
      "/v2/credentials/id?redirect=http://example.invalid",
      "/v2/credentials/id/extra",
      `/v2/credentials/${"a".repeat(129)}`,
    ]) {
      let called = false;
      await expect(fetchEcsTaskRoleCredentials(value, credentialsFetch(() => { called = true; })))
        .rejects.toThrow("tenant backfill credential configuration is invalid");
      expect(called).toBe(false);
    }
  });

  test("rejects malformed, non-temporary, expired, and provider-error credential responses safely", async () => {
    const secret = "provider-secret-that-must-not-escape";
    const cases: TenantBackfillFetch[] = [
      async () => new Response(secret, { status: 500 }),
      async () => new Response("not-json", { status: 200 }),
      async () => new Response(JSON.stringify({ ...CREDENTIALS, Token: "" }), { status: 200 }),
      async () => new Response(JSON.stringify({ ...CREDENTIALS, Expiration: "2000-01-01T00:00:00Z" }), { status: 200 }),
      async () => { throw new Error(secret); },
    ];
    for (const fetchImpl of cases) {
      try {
        await fetchEcsTaskRoleCredentials(RELATIVE_URI, fetchImpl);
        throw new Error("expected credential failure");
      } catch (error) {
        expect(String(error)).toBe("Error: tenant backfill credential retrieval failed");
        expect(String(error)).not.toContain(secret);
        expect(String(error)).not.toContain(CREDENTIALS.SecretAccessKey);
      }
    }
  });
});

describe("approved S3 tenant backfill delivery", () => {
  test("loads one approved object, returns its raw digest and bounded counts, then deletes it", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    const object = approvedObject(bytes);
    const events: string[] = [];
    const loaded: TenantBackfillBundle[] = [];
    const clientOptions: unknown[] = [];

    const result = await loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
      fetch: credentialsFetch(),
      createS3Client: (options) => {
        clientOptions.push(options);
        return s3Fixture({ contents: [object], bytes, events });
      },
      loadBundle: async (_client, parsed) => {
        events.push("load");
        loaded.push(parsed);
        return { digest: "sha256:canonical-json-digest-is-not-approved-digest", assignments: 1 };
      },
    });

    expect(clientOptions).toEqual([{
      accessKeyId: CREDENTIALS.AccessKeyId,
      secretAccessKey: CREDENTIALS.SecretAccessKey,
      sessionToken: CREDENTIALS.Token,
      bucket: BUCKET,
      region: REGION,
      endpoint: `https://s3.${REGION}.amazonaws.com`,
    }]);
    expect(events).toEqual(["list:approved/:2", "read", "load", "delete"]);
    expect(loaded).toEqual([bundle]);
    expect(result).toEqual({
      digest: `sha256:${object.key.slice("approved/sha256-".length, -".json".length)}`,
      counts: { tenants: 1, principals: 1, memberships: 1, keyBindings: 1, rowAssignments: 1 },
    });
  });

  test("requires exactly one complete listing under approved/", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    const object = approvedObject(bytes);
    for (const fixture of [
      { contents: [] },
      { contents: [object, { ...object, key: object.key.replace("approved/", "approved/other-") }] },
      { contents: [object], isTruncated: true },
    ]) {
      const events: string[] = [];
      await expect(loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
        fetch: credentialsFetch(),
        createS3Client: () => s3Fixture({ ...fixture, bytes, events }),
        loadBundle: async () => { throw new Error("must not load"); },
      })).rejects.toThrow("tenant backfill delivery requires exactly one approved object");
      expect(events.includes("read")).toBe(false);
      expect(events.includes("delete")).toBe(fixture.contents.length === 1);
    }
  });

  test("rejects malformed keys without exposing or reading them and still deletes the selected object", async () => {
    const malformedKey = `approved/sha256-${"A".repeat(64)}.json`;
    const events: string[] = [];
    try {
      await loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
        fetch: credentialsFetch(),
        createS3Client: () => s3Fixture({ contents: [{ key: malformedKey, size: 2 }], events }),
      });
      throw new Error("expected malformed-key failure");
    } catch (error) {
      expect(String(error)).toBe("Error: tenant backfill approved object key is invalid");
      expect(String(error)).not.toContain(malformedKey);
    }
    expect(events).toEqual(["list:approved/:2", "delete"]);
  });

  test("enforces the 10 MiB cap before and after the in-memory read", async () => {
    const smallBytes = new TextEncoder().encode(JSON.stringify(bundle));
    const object = approvedObject(smallBytes);
    const preEvents: string[] = [];
    await expect(loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
      fetch: credentialsFetch(),
      createS3Client: () => s3Fixture({ contents: [{ ...object, size: TENANT_BACKFILL_MAX_BYTES + 1 }], events: preEvents }),
    })).rejects.toThrow("tenant backfill approved object exceeds the size limit");
    expect(preEvents).toEqual(["list:approved/:2", "delete"]);

    const postEvents: string[] = [];
    await expect(loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
      fetch: credentialsFetch(),
      createS3Client: () => s3Fixture({
        contents: [{ ...object, size: TENANT_BACKFILL_MAX_BYTES }],
        bytes: new Uint8Array(TENANT_BACKFILL_MAX_BYTES + 1),
        events: postEvents,
      }),
    })).rejects.toThrow("tenant backfill approved object exceeds the size limit");
    expect(postEvents).toEqual(["list:approved/:2", "read", "delete"]);
  });

  test("verifies the raw-byte digest before attempting JSON parsing", async () => {
    const invalidJson = new TextEncoder().encode("{private-invalid-json");
    const differentBytes = new TextEncoder().encode("different bytes");
    const wrongObject = approvedObject(differentBytes);
    await expect(loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
      fetch: credentialsFetch(),
      createS3Client: () => s3Fixture({ contents: [{ ...wrongObject, size: invalidJson.byteLength }], bytes: invalidJson }),
    })).rejects.toThrow("tenant backfill approved object digest mismatch");
  });

  test("rejects invalid JSON and invalid bundle schema with stable secret-safe errors", async () => {
    const cases = [
      { bytes: new TextEncoder().encode("{private-invalid-json"), message: "tenant backfill approved object is not valid JSON" },
      { bytes: new TextEncoder().encode(JSON.stringify({ privateBundleId: "must-not-escape" })), message: "tenant backfill approved object schema is invalid" },
    ];
    for (const { bytes, message } of cases) {
      const object = approvedObject(bytes);
      try {
        await loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
          fetch: credentialsFetch(),
          createS3Client: () => s3Fixture({ contents: [object], bytes }),
        });
        throw new Error("expected parse failure");
      } catch (error) {
        expect(String(error)).toBe(`Error: ${message}`);
        expect(String(error)).not.toContain("privateBundleId");
      }
    }
  });

  test("deletes after failures and makes cleanup failure fatal even after a successful load", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    const object = approvedObject(bytes);
    const providerSecret = "raw-s3-provider-secret";
    const databaseSecret = "raw-database-provider-secret";

    const readEvents: string[] = [];
    await expect(loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
      fetch: credentialsFetch(),
      createS3Client: () => s3Fixture({ contents: [object], readError: new Error(providerSecret), events: readEvents }),
    })).rejects.toThrow("tenant backfill approved object read failed");
    expect(readEvents).toEqual(["list:approved/:2", "read", "delete"]);

    const loadEvents: string[] = [];
    await expect(loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
      fetch: credentialsFetch(),
      createS3Client: () => s3Fixture({ contents: [object], bytes, events: loadEvents }),
      loadBundle: async () => { loadEvents.push("load"); throw new Error(databaseSecret); },
    })).rejects.toThrow("tenant backfill transaction failed");
    expect(loadEvents).toEqual(["list:approved/:2", "read", "load", "delete"]);

    const cleanupEvents: string[] = [];
    try {
      await loadApprovedTenantBackfillBundle(unusedClient, deliveryOptions(), {
        fetch: credentialsFetch(),
        createS3Client: () => s3Fixture({ contents: [object], bytes, deleteError: new Error(providerSecret), events: cleanupEvents }),
        loadBundle: async () => { cleanupEvents.push("load"); return { digest: "ignored", assignments: 1 }; },
      });
      throw new Error("expected cleanup failure");
    } catch (error) {
      expect(String(error)).toBe("Error: tenant backfill approved object cleanup failed");
      expect(String(error)).not.toContain(providerSecret);
      expect(String(error)).not.toContain(BUCKET);
      expect(String(error)).not.toContain(object.key);
    }
    expect(cleanupEvents).toEqual(["list:approved/:2", "read", "load", "delete"]);
  });

  test("logs only the approved digest and bounded counts on success", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
    try {
      logTenantBackfillS3Success({
        digest: `sha256:${"a".repeat(64)}`,
        counts: { tenants: 1, principals: 2, memberships: 3, keyBindings: 4, rowAssignments: 5 },
      });
    } finally {
      console.log = originalLog;
    }
    expect(logs).toEqual([JSON.stringify({
      evt: "tenant_backfill_s3_loaded",
      digest: `sha256:${"a".repeat(64)}`,
      counts: { tenants: 1, principals: 2, memberships: 3, keyBindings: 4, rowAssignments: 5 },
    })]);
    expect(logs[0]).not.toContain(BUCKET);
    expect(logs[0]).not.toContain("private");
    expect(logs[0]).not.toContain(CREDENTIALS.SecretAccessKey);
  });
});

describe("transactional tenant backfill loader", () => {
  test("returns deterministic results and performs idempotent statement sequences", async () => {
    const runs: Array<Array<{ sql: string; params?: unknown[] }>> = [];
    const client = {
      pool: null as never,
      query: async <T extends QueryResultRow>() => ({ rows: [] as T[], rowCount: 0 }),
      many: async <T extends QueryResultRow>() => [] as T[],
      one: async <T extends QueryResultRow>() => ({ id: "0008_tenant_prepare" }) as unknown as T,
      get: async <T extends QueryResultRow>() => null as T | null,
      execute: async () => undefined,
      close: async () => undefined,
      transaction: async <T>(fn: (tx: TypedQueryClient) => Promise<T>) => {
        const statements: Array<{ sql: string; params?: unknown[] }> = [];
        runs.push(statements);
        const tx: TypedQueryClient = {
          query: async <R extends QueryResultRow>() => ({ rows: [] as R[], rowCount: 0 }),
          many: async <R extends QueryResultRow>() => [] as R[],
          one: async <R extends QueryResultRow>() => ({ id: "0008_tenant_prepare" }) as unknown as R,
          get: async <R extends QueryResultRow>(sql: string) => {
            statements.push({ sql });
            return (sql.includes("0008_tenant_prepare") ? { id: "0008_tenant_prepare" } : null) as R | null;
          },
          execute: async (sql: string, params?: unknown[]) => { statements.push({ sql, params }); },
        };
        return fn(tx);
      },
    } as PoolQueryClient;

    const first = await loadTenantBackfillBundle(client, bundle);
    const second = await loadTenantBackfillBundle(client, bundle);
    expect(first).toEqual(second);
    expect(first.assignments).toBe(1);
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0].some(({ sql }) => sql.includes("ON CONFLICT (id) DO UPDATE"))).toBe(true);
    expect(runs[0].some(({ sql }) => sql === "DELETE FROM api_key_tenant_bindings")).toBe(true);
    expect(runs[0].some(({ sql }) => sql === "DELETE FROM tenant_row_assignments")).toBe(true);
  });
});
