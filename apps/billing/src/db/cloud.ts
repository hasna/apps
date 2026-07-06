import { resolveDatabaseUrl } from "../config.js";
import {
  sslModeFromConnectionString,
  resolveTlsConfig,
  type PgSslConfig,
} from "../generated/storage-kit/tls.js";
import { createCloudPoolFromEnv } from "../generated/storage-kit/pool.js";
import { checkHealth } from "../generated/storage-kit/health.js";
import { APP_NAME } from "../config.js";

/**
 * Cloud (PURE REMOTE) wiring for @hasna/billing (BUILD-SPEC §2.2/§4.8).
 *
 * This module goes exclusively through the vendored storage-kit
 * (src/generated/storage-kit/*) — it MUST NOT import @hasna/contracts at
 * runtime (no_cloud_guard, §4.2). Cloud connections MUST use
 * sslmode=verify-full with the pinned RDS CA bundle; sslmode=require is
 * rejected here so verification can never silently downgrade.
 *
 * There is NO in-memory / :memory: fallback for cloud mode. If the cloud store
 * is misconfigured or unreachable, callers fail closed with a clear error —
 * money/audit data is never silently written to ephemeral storage.
 */

export interface CloudPoolConfig {
  connectionString: string;
  ssl: PgSslConfig | undefined;
}

/**
 * Build (and validate) the cloud pool config without connecting. Enforces
 * sslmode=verify-full and a resolvable CA bundle via the kit's tls.ts. Unit
 * tested without a live DB (§4.8).
 */
export function buildCloudPoolConfig(env: NodeJS.ProcessEnv = process.env): CloudPoolConfig {
  const dsn = resolveDatabaseUrl(env as Record<string, string | undefined>);
  if (!dsn) {
    throw new Error(
      `cloud mode for ${APP_NAME} needs a database URL (HASNA_BILLING_DATABASE_URL or *_FILE). ` +
        `PURE REMOTE reads/writes go to cloud Postgres; there is no local fallback.`,
    );
  }
  const mode = sslModeFromConnectionString(dsn);
  if (mode !== "verify-full") {
    throw new Error(
      `cloud Postgres DSN must use sslmode=verify-full (got '${mode}'). ` +
        `sslmode=require (no cert verification) is forbidden (BUILD-SPEC §4.8/§10.3).`,
    );
  }
  // Throws if no CA bundle is resolvable — verification can never downgrade.
  const ssl = resolveTlsConfig(dsn, { env: env as Record<string, string | undefined> });
  return { connectionString: dsn, ssl };
}

/**
 * Best-effort reachability probe for storage_status.remote_reachable — NEVER
 * hardcoded (BUILD-SPEC failure class 2). In local mode there is no cloud
 * target (returns false). In cloud mode it actually builds the kit pool and
 * runs a `SELECT 1`, returning false on any failure.
 */
export async function probeCloudReachable(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    buildCloudPoolConfig(env);
    const { client } = createCloudPoolFromEnv(APP_NAME, { env: env as Record<string, string | undefined> });
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
