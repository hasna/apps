#!/usr/bin/env bun
// LOCAL smoke test: assemble the real loops-serve server (createLoopsApiServer +
// PostgresLoopStorage + TenantApiAuthenticator) against the tunnelled RDS, mint
// a real API key into the api_keys table, then drive an authenticated CRUD
// roundtrip through the generated LoopsClient. Tunnel-only relaxed TLS after
// proving each DSN targets a loopback SSM tunnel host.
import { Pool } from "pg";
import { mintApiKey } from "@hasna/contracts/auth";
import { createLoopsApiServer } from "../src/api/index.js";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { TenantApiAuthenticator } from "../src/lib/auth/tenant-auth.js";
import { PgPoolExecutor } from "../src/lib/storage/pg-executor.js";
import { createPostgresLoopStorage } from "../src/lib/storage/postgres-loop-storage.js";
import { LoopsClient } from "../src/sdk/http.js";

const migratorDsn = process.env.TUNNEL_MIGRATOR_DATABASE_URL?.trim();
if (!migratorDsn) throw new Error("set TUNNEL_MIGRATOR_DATABASE_URL");
const runtimeDsn = process.env.TUNNEL_RUNTIME_DATABASE_URL?.trim();
if (!runtimeDsn) throw new Error("set TUNNEL_RUNTIME_DATABASE_URL");
const authDsn = process.env.TUNNEL_AUTH_DATABASE_URL?.trim();
if (!authDsn) throw new Error("set TUNNEL_AUTH_DATABASE_URL");
const signingSecret = process.env.HASNA_LOOPS_API_SIGNING_KEY?.trim();
if (!signingSecret) throw new Error("set HASNA_LOOPS_API_SIGNING_KEY");

function localTunnelConnectionString(value: string, label: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${label} must be a Postgres connection string`);
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error(`${label} must target a loopback SSM tunnel host`);
  }
  parsed.search = "";
  return parsed.toString();
}

const migratorPool = new Pool({
  connectionString: localTunnelConnectionString(migratorDsn, "TUNNEL_MIGRATOR_DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
  max: 2,
});
const runtimePool = new Pool({
  connectionString: localTunnelConnectionString(runtimeDsn, "TUNNEL_RUNTIME_DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
  max: 3,
});
const authPool = new Pool({
  connectionString: localTunnelConnectionString(authDsn, "TUNNEL_AUTH_DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
  max: 2,
});
const migratorClient = createQueryClient(migratorPool);
const runtimeClient = createQueryClient(runtimePool);
const authClient = createQueryClient(authPool);
const executor = new PgPoolExecutor(runtimeClient);
const tenantId = process.env.HASNA_LOOPS_TENANT_ID?.trim();
if (!tenantId) throw new Error("set HASNA_LOOPS_TENANT_ID");
const principalId = process.env.HASNA_LOOPS_PRINCIPAL_ID?.trim();
if (!principalId) throw new Error("set HASNA_LOOPS_PRINCIPAL_ID");

const authenticator = new TenantApiAuthenticator(authClient, signingSecret);

const server = createLoopsApiServer({
  host: "127.0.0.1",
  port: 18795,
  authenticator,
  withTenantStorage: (principal, fn) =>
    executor.withRequestContext(principal, (transactionClient) =>
      fn(createPostgresLoopStorage(transactionClient, principal, { contextAlreadyBound: true }))),
  readyCheck: async () => {
    try {
      await runtimeClient.get("SELECT 1 AS runtime_ready");
      await authClient.get("SELECT 1 AS auth_ready");
      return { ready: true };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : "storage_unreachable" };
    }
  },
});
const base = `http://127.0.0.1:${server.port}`;

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

// Foundation probes (open)
const health = await (await fetch(`${base}/health`)).json();
assert(health.status === "ok" && health.version && health.mode, "health {status,version,mode}");
const ready = await fetch(`${base}/ready`);
const readyBody = await ready.json();
assert(ready.status === 200 && readyBody.status === "ready", `ready -> ${ready.status} ${JSON.stringify(readyBody)}`);
const version = await (await fetch(`${base}/version`)).json();
assert(version.version && version.mode, "version {version,mode}");

// Unauthenticated /v1 must be rejected
const noauth = await fetch(`${base}/v1/loops`);
assert(noauth.status === 401, `unauth /v1 -> ${noauth.status} (expected 401)`);

// Mint + persist a real API key
const minted = await mintApiKey({ app: "loops", agent: principalId, scopes: ["loops:*"], signingSecret });
await migratorClient.transaction(async (tx) => {
  await tx.execute("SET LOCAL ROLE open_loops_owner");
  await tx.get(
    "SELECT set_config('loops.tenant_id', $1, true), set_config('open_loops.tenant_id', $1, true)",
    [tenantId],
  );
  await tx.execute(
    `INSERT INTO api_keys(kid, app, agent, scopes, token_hash, issued_at, expires_at, created_by,
       tenant_id, principal_id, token_kind)
     VALUES ($1, 'loops', $2, $3::jsonb, $4, $5, $6, $2, $7, $2, 'api_key')`,
    [
      minted.kid, principalId, JSON.stringify(minted.claims.scopes), minted.tokenHash,
      new Date(minted.claims.iat * 1000).toISOString(),
      minted.claims.exp === null ? null : new Date(minted.claims.exp * 1000).toISOString(), tenantId,
    ],
  );
});

// Drive CRUD through the generated client
const api = new LoopsClient({ baseUrl: base, apiKey: minted.token });
const created = await api.createLoop({
  name: `smoke-${Date.now()}`,
  schedule: { kind: "interval", everyMs: 3_600_000 },
  target: { type: "command", command: "date" },
});
assert(created.ok && created.loop?.id, "createLoop");
const id = created.loop.id;
const got = await api.getLoop(id);
assert(got.loop.id === id, "getLoop");
const listed = await api.listLoops({});
assert(Array.isArray(listed.loops) && listed.loops.some((l) => l.id === id), "listLoops");
const patched = await api.updateLoop(id, { status: "paused" });
assert(patched.loop.status === "paused", `updateLoop -> ${patched.loop.status}`);
const deleted = await api.deleteLoop(id);
assert(deleted.deleted === true, "deleteLoop");

// Revocation takes effect
await migratorClient.transaction(async (tx) => {
  await tx.execute("SET LOCAL ROLE open_loops_owner");
  await tx.get(
    "SELECT set_config('loops.tenant_id', $1, true), set_config('open_loops.tenant_id', $1, true)",
    [tenantId],
  );
  await tx.execute("UPDATE api_keys SET revoked_at=now(), revoked_reason='smoke-cleanup' WHERE tenant_id=$1 AND kid=$2", [tenantId, minted.kid]);
});
const afterRevoke = await fetch(`${base}/v1/loops`, { headers: { "x-api-key": minted.token } });
assert(afterRevoke.status === 403 || afterRevoke.status === 401, `revoked key -> ${afterRevoke.status}`);

console.log(JSON.stringify({ evt: "smoke_ok", loopId: id, kid: minted.kid }));
server.stop();
await Promise.all([migratorPool.end(), runtimePool.end(), authPool.end()]);
process.exit(0);
