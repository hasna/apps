import { resolveTlsConfig, sslModeFromConnectionString } from "../generated/storage-kit/tls.js";
import { createCloudPoolFromEnv, createPgPool } from "../generated/storage-kit/pool.js";

// Cloud (Postgres) path — wired through the vendored storage-kit only (no runtime
// import of @hasna/contracts, §4.2). PURE REMOTE: reads AND writes hit cloud
// Postgres. All cloud connections MUST use sslmode=verify-full with the pinned
// RDS CA bundle (§4.8); sslmode=require is forbidden.

/**
 * Validate that a DSN uses sslmode=verify-full and that a CA bundle is resolvable.
 * Throws otherwise so verification can never silently downgrade.
 */
export function assertVerifyFull(dsn: string, env: Record<string, string | undefined> = process.env): void {
  const mode = sslModeFromConnectionString(dsn);
  if (mode !== "verify-full") {
    throw new Error(
      `IP cloud connections require sslmode=verify-full (got '${mode}'). ` +
        "sslmode=require is forbidden (§4.8).",
    );
  }
  // resolveTlsConfig throws if verify-full has no CA bundle available.
  const ssl = resolveTlsConfig(dsn, { env });
  if (!ssl || ssl === true || ssl.rejectUnauthorized !== true || !ssl.ca) {
    throw new Error("IP cloud TLS config must verify the server certificate against a CA bundle (§4.8).");
  }
}

/**
 * Build the cloud pool via the vendored kit. Enforces verify-full first. Used by
 * the cloud runtime path; local mode never calls this.
 */
export function connectCloud(env: Record<string, string | undefined> = process.env) {
  const dsn = env["HASNA_HOLDINGS_DATABASE_URL"] ?? env["HOLDINGS_DATABASE_URL"];
  if (dsn) assertVerifyFull(dsn, env);
  return createCloudPoolFromEnv("holdings", { applicationName: "holdings", env });
}

/**
 * Cheap, timeout-bounded liveness probe of the cloud Postgres.
 *
 * Returns `true` on a successful `SELECT 1`, and `false` on any failure —
 * missing DSN, a failed verify-full/CA assertion, connection error, or timeout.
 * Owns the full pool lifecycle so no connection is leaked. Only meaningful in
 * cloud mode; the local build never reaches this (openDatabase fails closed).
 */
export async function probeCloudReachable(
  timeoutMs = 1500,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const dsn = env["HASNA_HOLDINGS_DATABASE_URL"] ?? env["HOLDINGS_DATABASE_URL"];
  if (!dsn) return false;
  let pool: import("pg").Pool | undefined;
  try {
    assertVerifyFull(dsn, env);
    pool = createPgPool({ connectionString: dsn, env, applicationName: "holdings", connectionTimeoutMillis: timeoutMs });
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("cloud probe timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}
