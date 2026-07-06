import { describe, expect, test } from "bun:test";
import { createServeApp } from "./app.js";
import { buildOpenApiDocument } from "./openapi.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import { PgShortlinksStore } from "../pg-store.js";

// Minimal shims — the serve unit surface (probes + auth gate) never needs a
// real Postgres. checkHealth issues `SELECT 1`; checkReady runs the ledger
// dry-run (ensureLedger CREATE TABLE + a SELECT), both satisfied by the shim.
function fakeClient(): PoolQueryClient {
  const client = {
    async query() {
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
    async many() {
      return [] as any[];
    },
    async get() {
      return { ok: 1 } as any;
    },
    async one() {
      return { ok: 1 } as any;
    },
    async execute() {},
    async transaction(fn: any) {
      return fn(client);
    },
    async close() {},
    pool: {} as any,
  };
  return client as unknown as PoolQueryClient;
}

function makeApp() {
  const client = fakeClient();
  const store = PgShortlinksStore.fromQueryClient(client);
  return createServeApp({
    client,
    store,
    version: "test",
    mode: "cloud",
    signingSecret: "unit-test-signing-secret",
  });
}

describe("shortlinks serve app", () => {
  test("GET /health returns ok", async () => {
    const res = await makeApp().request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("test");
    expect(body.mode).toBe("cloud");
  });

  test("GET /version returns service metadata", async () => {
    const res = await makeApp().request("/version");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("@hasna/shortlinks");
  });

  test("GET /openapi.json serves the OpenAPI document", async () => {
    const res = await makeApp().request("/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.openapi).toBe("3.0.3");
    expect(body.paths["/v1/links"]).toBeDefined();
  });

  test("GET /v1/links without a key is 401", async () => {
    const res = await makeApp().request("/v1/links");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.reason).toBe("missing_token");
  });

  test("GET /v1/links with a bogus key is 401", async () => {
    const res = await makeApp().request("/v1/links", { headers: { "x-api-key": "hasna_shortlinks_bogus" } });
    expect(res.status).toBe(401);
  });
});

describe("shortlinks openapi", () => {
  test("covers the versioned /v1 operations", () => {
    const doc = buildOpenApiDocument("1.2.3") as any;
    expect(doc.info.version).toBe("1.2.3");
    const opIds = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((op: any) => op.operationId));
    for (const id of ["createLink", "listLinks", "getLink", "deleteLink", "getHealth", "getReady", "getVersion"]) {
      expect(opIds).toContain(id);
    }
  });
});
