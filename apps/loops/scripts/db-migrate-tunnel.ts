#!/usr/bin/env bun
// LOCAL-ONLY migration applier for use through an SSM port-forward tunnel.
//
// The tunnel terminates at 127.0.0.1 so the RDS server certificate hostname
// never matches; `pg-connection-string` now forces verify-full from a
// `sslmode=require` DSN, which hard-fails the tunnel. This helper strips the
// sslmode query param and connects with an explicit encrypt-but-do-not-verify
// TLS config (identical crypto to what the vendored kit produces for
// `sslmode=require`), then runs the same checksum-ledgered migration path so
// the ledger checksums are written exactly as the in-cluster migrator would.
//
// NEVER used in the container. The container connects directly to the RDS
// hostname with verify-full-capable TLS via `loops-serve migrate`.
import { Pool } from "pg";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { PgPoolExecutor } from "../src/lib/storage/pg-executor.js";
import { PostgresStorage } from "../src/lib/storage/postgres.js";
import { assertTenantEnforcementBootstrap } from "../src/serve/index.js";

const raw = process.env.TUNNEL_DATABASE_URL?.trim();
if (!raw) throw new Error("set TUNNEL_DATABASE_URL");
const noQuery = raw.split("?")[0];

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
try {
  if (enforceTenancy) await assertTenantEnforcementBootstrap(client);
  const result = await new PostgresStorage(executor).migrate({
    dryRun,
    through: enforceTenancy ? undefined : "0008_tenant_prepare",
  });
  console.log(
    JSON.stringify({
      step: "storage",
      dryRun,
      enforceTenancy,
      applied: result.applied.map((a) => a.id),
      pending: result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id),
    }),
  );
} finally {
  await pool.end();
}
