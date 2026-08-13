import { resolveDatabaseUrl } from "../config.js";
import {
  sslModeFromConnectionString,
  resolveTlsConfig,
  type PgSslConfig,
} from "../generated/storage-kit/tls.js";
import { createPgPool } from "../generated/storage-kit/pool.js";
import {
  createQueryClient,
  type PoolQueryClient,
} from "../generated/storage-kit/query.js";
import { checkHealth } from "../generated/storage-kit/health.js";
import { APP_NAME } from "../config.js";

/**
 * PostgreSQL wiring for @hasna/billing (BUILD-SPEC §2.2/§4.8).
 *
 * This module goes exclusively through the vendored storage-kit
 * (src/generated/storage-kit/*) and does not import @hasna/contracts at
 * runtime. PostgreSQL connections MUST use
 * sslmode=verify-full with the pinned RDS CA bundle; sslmode=require is
 * rejected here so verification can never silently downgrade.
 *
 * There is no in-memory fallback for the PostgreSQL backend. If the store
 * is misconfigured or unreachable, callers fail closed with a clear error —
 * money/audit data is never silently written to ephemeral storage.
 */

export interface PostgresqlPoolConfig {
  connectionString: string;
  ssl: PgSslConfig | undefined;
}

/**
 * Build and validate the PostgreSQL pool config without connecting. Enforces
 * sslmode=verify-full and a resolvable CA bundle via the kit's tls.ts. Unit
 * tested without a live DB (§4.8).
 */
export function buildPostgresqlPoolConfig(env: NodeJS.ProcessEnv = process.env): PostgresqlPoolConfig {
  const dsn = resolveDatabaseUrl(env as Record<string, string | undefined>);
  if (!dsn) {
    throw new Error(
      `The postgresql backend for ${APP_NAME} needs a database URL ` +
        `(HASNA_BILLING_DATABASE_URL or *_FILE); there is no SQLite fallback.`,
    );
  }
  const mode = sslModeFromConnectionString(dsn);
  if (mode !== "verify-full") {
    throw new Error(
      `PostgreSQL DSN must use sslmode=verify-full (got '${mode}'). ` +
        `sslmode=require (no cert verification) is forbidden (BUILD-SPEC §4.8/§10.3).`,
    );
  }
  // Throws if no CA bundle is resolvable — verification can never downgrade.
  const ssl = resolveTlsConfig(dsn, { env: env as Record<string, string | undefined> });
  return { connectionString: dsn, ssl };
}

/**
 * Build the actual query client from the validated, fully resolved DSN.
 *
 * `resolveDatabaseUrl` supports both the direct URL and mounted `*_FILE`
 * form. Passing that result into the kit pool is important: the kit's generic
 * environment helper only understands the direct URL form.
 */
export function createPostgresqlClient(env: NodeJS.ProcessEnv = process.env): PoolQueryClient {
  const { connectionString } = buildPostgresqlPoolConfig(env);
  const pool = createPgPool({
    connectionString,
    env: env as Record<string, string | undefined>,
    applicationName: APP_NAME,
  });
  return createQueryClient(pool);
}

/**
 * Best-effort reachability probe for storage_status.postgresql_reachable.
 * It builds the kit pool and runs `SELECT 1`, returning false on any failure.
 */
export async function probePostgresqlReachable(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const client = createPostgresqlClient(env);
    try {
      const result = await checkHealth(client);
      return result.ok;
    } finally {
      await client.close();
    }
  } catch {
    return false;
  }
}
