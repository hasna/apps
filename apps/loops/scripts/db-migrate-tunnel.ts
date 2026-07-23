#!/usr/bin/env bun
// LOCAL-ONLY migration applier for use through an SSM port-forward tunnel.
//
// The tunnel must terminate at a loopback host so the RDS server certificate
// hostname never matches. This helper strips the sslmode query param only after
// proving the target is loopback, then connects with explicit encrypted but
// unverified TLS for that local tunnel. The in-cluster migrator uses verified
// TLS through the generated storage kit.
//
// NEVER used in the container. The container connects directly to the RDS
// hostname with verify-full-capable TLS via `loops-serve migrate`.
import { Pool } from "pg";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { PgPoolExecutor } from "../src/lib/storage/pg-executor.js";
import { PostgresStorage } from "../src/lib/storage/postgres.js";
import { runGuardedPostgresMigrations } from "../src/serve/index.js";

const raw = process.env.TUNNEL_DATABASE_URL?.trim();
if (!raw) throw new Error("set TUNNEL_DATABASE_URL");

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

const noQuery = localTunnelConnectionString(raw, "TUNNEL_DATABASE_URL");

const pool = new Pool({
  connectionString: noQuery,
  ssl: { rejectUnauthorized: false },
  max: 2,
  application_name: "loops-migrate-tunnel",
});
const client = createQueryClient(pool);
const executor = new PgPoolExecutor(client);

const dryRun = process.argv.includes("--dry-run");
const enforceTenancy = process.argv.includes("--enforce-tenancy");
const identityAliases = process.argv.includes("--identity-aliases");
try {
  const schema = new PostgresStorage(executor);
  const result = await runGuardedPostgresMigrations(client, schema, {
    dryRun,
    enforceTenancy,
    identityAliases,
  });
  console.log(
    JSON.stringify({
      step: "storage",
      dryRun,
      enforceTenancy,
      identityAliases,
      applied: result.applied.map((a) => a.id),
      pending: result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id),
    }),
  );
} finally {
  await pool.end();
}
