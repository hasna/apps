import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { migrateCoreSchema } from "../src/server/core-schema.js";
import { buildCoreApp } from "../src/server/core-app.js";
import { AccessClient, CORE_ROUTES, type CoreOperation } from "../src/client/index.js";
import { createCorePool, type CoreConnection, type CorePool } from "../src/server/core-store.js";

test("all 43 core operations execute against the PostgreSQL engine through authenticated HTTPS client", async () => {
  // Hermetic default: in-memory test-only PostgreSQL engine. No DSN, socket,
  // real credential, or disk data. Set ACCESS_TEST_DATABASE_URL (the same
  // TEST-ONLY variable scripts/pg-test-gate.mjs uses) to run this exact domain
  // path against a real PostgreSQL server: the production pool constructor
  // then validates the DSN (sslmode=verify-full, CA via PGSSLROOTCERT) and
  // connects. The connection string is never printed.
  const liveDsn = process.env["ACCESS_TEST_DATABASE_URL"]?.trim();
  if (liveDsn) process.env["HASNA_ACCESS_DATABASE_URL"] = liveDsn;
  // Log the engine mode only; the connection string itself is never printed.
  console.log(`[core-domain-postgres] engine: ${liveDsn ? "live PostgreSQL (ACCESS_TEST_DATABASE_URL set)" : "in-memory PGlite"}`);
  const pg = liveDsn ? null : new PGlite();
  const pool: CorePool = pg
    ? { async connect() { return { async query(sql, params) { return pg.query(sql, params); }, release() {} }; }, async end() { await pg.close(); } }
    : createCorePool();
  // Raw-store probe for the append-only and rollback assertions. PGlite shares
  // one implicit session, so live mode mirrors that with one dedicated connection.
  let raw: CoreConnection | null = null;
  const rawQuery = async (sql: string, params: unknown[] = []) => {
    if (pg) return pg.query(sql, params);
    raw ??= await pool.connect();
    return raw.query(sql, params);
  };
  const signingKey = "isolated-unit-test-signing-material-not-real";
  try {
    await migrateCoreSchema(pool);
    const entity = crypto.randomUUID();
    const key = "isolated-unit-test-api-credential";
    const app = buildCoreApp(pool, { HASNA_ACCESS_TOKEN_SIGNING_KEY: signingKey, HASNA_ACCESS_API_CREDENTIALS: JSON.stringify([{ id: "unit", token: key, roles: ["owner"], entity_ids: [entity] }]) });
    const client = new AccessClient({ HASNA_ACCESS_API_URL: "https://access.example.test", HASNA_ACCESS_API_KEY: key }, (async (url, options) => app.fetch(new Request(url, options))) as typeof fetch);
    const covered = new Set<string>();
    const call = async (op: CoreOperation, input: Record<string, unknown> = {}): Promise<any> => { covered.add(op); return client.runOperation(op, input); };
    const identity = await call("identity.create", { entity_id: entity, kind: "agent", name: "unit" });
    const id = identity.id;
    expect((await call("identity.get", { id })).name).toBe("unit");
    expect(await call("identity.list")).toHaveLength(1);
    expect((await call("identity.update", { id, name: "renamed" })).name).toBe("renamed");
    const credential = await call("credential.register", { identity_id: id, name: "reference", kind: "api_key", secret_ref: "test/access/reference" });
    await call("credential.get", { id: credential.id }); await call("credential.list");
    const grant = await call("scope.grant", { identity_id: id, scope: "access:read" });
    await call("scope.get", { id: grant.id }); await call("scope.list"); await call("scope.effective", { identity_id: id });
    const elevation = await call("elevation.request", { identity_id: id, scope: "access:write", reason: "unit", ttl_minutes: 1 });
    await call("elevation.get", { id: elevation.id }); await call("elevation.list");
    await call("elevation.approve", { id: elevation.id, approver: "unit" });
    await call("elevation.revoke", { id: elevation.id }); await call("elevation.expire");
    const review = await call("review.schedule", { entity_id: entity, name: "unit" });
    await call("review.get", { id: review.id }); await call("review.list");
    await call("review.start", { id: review.id }); await call("review.complete", { id: review.id });
    const cancelledReview = await call("review.schedule", { entity_id: entity, name: "cancel" });
    await call("review.cancel", { id: cancelledReview.id });
    const requestInput = { identity_id: id, provider: "github", resource_kind: "repository_deploy_key", resource_ref: "github:example/test" };
    const request = await call("request.create", requestInput);
    await call("request.get", { id: request.id }); await call("request.list");
    await call("request.approve", { id: request.id }); await call("request.provision", { id: request.id });
    const failed = await call("request.create", requestInput);
    await call("request.approve", { id: failed.id }); await call("request.fail", { id: failed.id, reason: "unit failure" });
    const cancelled = await call("request.create", requestInput); await call("request.cancel", { id: cancelled.id });
    const token = await call("token.issue", { identity_id: id, scopes: ["access:read"], ttl_minutes: 1 });
    const issuedClient = new AccessClient({ HASNA_ACCESS_API_URL: "https://access.example.test", HASNA_ACCESS_API_KEY: token.token }, (async (url, options) => app.fetch(new Request(url, options))) as typeof fetch);
    expect((await issuedClient.runOperation("identity.get", { id }) as { id: string }).id).toBe(id);
    await expect(issuedClient.runOperation("identity.update", { id, name: "forbidden" })).rejects.toThrow("HTTP 403");
    await call("token.verify", { token: token.token });
    await call("token.get", { id: token.record.id }); await call("token.list");
    await call("token.revoke", { id: token.record.id });
    await expect(issuedClient.runOperation("identity.get", { id })).rejects.toThrow("HTTP 401");
    await call("scope.revoke", { id: grant.id }); await call("credential.revoke", { id: credential.id });
    await call("revocation.execute", { identity_id: id, target_type: "identity", reason: "unit" }); await call("revocation.list");
    await call("identity.suspend", { id }); await call("identity.retire", { id });
    expect((await call("audit.list")).length).toBeGreaterThan(0);
    expect((await call("audit.verify")).valid).toBe(true);
    expect([...covered].sort()).toEqual(Object.keys(CORE_ROUTES).sort());
    await expect(rawQuery("DELETE FROM audit_log")).rejects.toThrow("append-only");
    const unscopedApp = buildCoreApp(pool, { HASNA_ACCESS_TOKEN_SIGNING_KEY: signingKey, HASNA_ACCESS_API_CREDENTIALS: JSON.stringify([{ id: "unscoped", token: key, roles: ["owner"] }]) });
    expect((await unscopedApp.request(`/v1/identities/${id}`, { headers: { Authorization: `Bearer ${key}` } })).status).toBe(403);
    expect((await app.request(`/v1/identities/${id}`)).status).toBe(401);
    const failingPool: CorePool = {
      async connect() {
        if (pg) return { async query(sql, params) {
          if (sql.startsWith("INSERT INTO audit_log")) throw new Error("test audit write failure");
          return pg.query(sql, params);
        }, release() {} };
        const connection = await pool.connect();
        return { query: async (sql, params) => {
          if (sql.startsWith("INSERT INTO audit_log")) throw new Error("test audit write failure");
          return connection.query(sql, params);
        }, release: () => connection.release() };
      },
      async end() {},
    };
    const failingApp = buildCoreApp(failingPool, { HASNA_ACCESS_TOKEN_SIGNING_KEY: signingKey, HASNA_ACCESS_API_CREDENTIALS: JSON.stringify([{ id: "unit", token: key, roles: ["owner"], entity_ids: [entity] }]) });
    const failedWrite = await failingApp.request("/v1/identities", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: entity, kind: "agent", name: "must-rollback" }) });
    expect(failedWrite.status).toBe(500);
    expect((await rawQuery("SELECT id FROM identities WHERE name = 'must-rollback'")).rows).toHaveLength(0);
  } finally {
    if (raw) raw.release();
    await pool.end();
    if (liveDsn) {
      delete process.env["HASNA_ACCESS_DATABASE_URL"];
      delete process.env["ACCESS_TEST_DATABASE_URL"];
    }
  }
}, 60_000);
