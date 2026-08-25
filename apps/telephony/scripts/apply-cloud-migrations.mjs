#!/usr/bin/env bun
/**
 * Apply the @hasna/telephony server Postgres schema via the vendored
 * storage kit's MigrationLedger (checksum ledger + drift/downgrade guards).
 *
 * Runs against the PostgreSQL backend only. Requires:
 *   HASNA_TELEPHONY_DATABASE_URL=postgres://...   (never logged)
 *
 * Usage:
 *   bun scripts/apply-cloud-migrations.mjs [--dry-run] [--json]
 *
 * The DATABASE_URL value is never printed. Fetch it into the environment from
 * Secrets Manager without echoing, e.g.:
 *   export HASNA_TELEPHONY_DATABASE_URL="$(aws secretsmanager get-secret-value \
 *     --secret-id hasna/oss/telephony/database-url-owner --query SecretString --output text)"
 */
import {
  MigrationLedger,
  createTelephonyCloudClient,
} from "../src/storage.ts";
import { buildTelephonyPostgresMigrations } from "../src/lib/migrate-list.ts";

const dryRun = process.argv.includes("--dry-run");
const asJson = process.argv.includes("--json");

// Migrations run DDL and therefore need the DB OWNER role. Prefer an
// owner-scoped DSN when one is injected (HASNA_TELEPHONY_DATABASE_URL_OWNER),
// falling back to the standard app DSN for local/dev runs. The resolved value
// is written to HASNA_TELEPHONY_DATABASE_URL so the cloud client picks it up.
// Also restore kit-intended sslmode=require semantics under node-postgres
// >= 8.22 (see src/server/cloud-serve.ts::normalizeCloudDatabaseUrl). Never
// logs the URL.
{
  const key = "HASNA_TELEPHONY_DATABASE_URL";
  let url = process.env.HASNA_TELEPHONY_DATABASE_URL_OWNER ?? process.env[key];
  if (url) {
    const lower = url.toLowerCase();
    if (
      (lower.includes("sslmode=require") || lower.includes("sslmode=prefer")) &&
      !lower.includes("uselibpqcompat")
    ) {
      url = url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
    }
    process.env[key] = url;
  }
  // Migrations always target the PostgreSQL backend; the kit resolves it from
  // DATABASE_URL presence (any retired STORAGE_MODE variable throws).
}

// ONE ordered migration program (extensions -> telephony_pg_* -> api keys ->
// rc.1 tenancy), composed by buildTelephonyPostgresMigrations in
// src/lib/migrate-list.ts. The id scheme matches the ledger the prod DB was
// migrated under (O15-00691); the same builder is exercised by
// tests/legacy-ledger-compat.test.ts so the composed list cannot drift from
// what the tests pin.
const migrations = buildTelephonyPostgresMigrations();

const client = createTelephonyCloudClient();
try {
  const ledger = new MigrationLedger(client, migrations);
  const result = await ledger.migrate({ dryRun });
  const pending = result.plan.filter((item) => item.state === "pending").map((item) => item.migration.id);
  const summary = {
    ok: true,
    dryRun,
    total: migrations.length,
    alreadyApplied: result.plan.length - pending.length,
    pending,
  };
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(
      `[telephony] migrations ${dryRun ? "plan (dry-run)" : "applied"}: total=${summary.total} already=${summary.alreadyApplied} pending=${pending.length}`,
    );
    if (pending.length) console.log(`[telephony] pending: ${pending.join(", ")}`);
  }
} finally {
  await client.close();
}
