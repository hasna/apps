import { resolveDatabaseDsn } from "../config.js";
import { sslModeFromConnectionString, type SslMode } from "../generated/storage-kit/tls.js";

/**
 * Cloud (PURE REMOTE) Postgres wiring for iapp-access. The actual pool is opened
 * via the vendored storage-kit only when running in cloud mode; local builds
 * never connect. This module exposes the guardrail asserted by conformance/unit
 * tests: cloud connections MUST use sslmode=verify-full with the pinned Amazon
 * RDS CA bundle (§4.8).
 */

/** Pinned Amazon RDS global CA bundle location (env-overridable for the runtime). */
export const RDS_CA_BUNDLE_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";

export interface CloudSslPolicy {
  sslmode: SslMode;
  requiresCaBundle: boolean;
  caBundleEnvKeys: string[];
}

/**
 * Assert and describe the mandated cloud TLS policy for a DSN. Throws if the DSN
 * does not request `verify-full` — `require` (no cert verification) is forbidden.
 */
export function assertCloudTlsPolicy(connectionString: string): CloudSslPolicy {
  const sslmode = sslModeFromConnectionString(connectionString);
  if (sslmode !== "verify-full") {
    throw new Error(
      `Refusing cloud connection: sslmode=${sslmode} is forbidden; use sslmode=verify-full with the pinned RDS CA bundle (${RDS_CA_BUNDLE_URL}).`,
    );
  }
  return { sslmode, requiresCaBundle: true, caBundleEnvKeys: ["PGSSLROOTCERT", "NODE_EXTRA_CA_CERTS"] };
}

/**
 * Open a cloud Postgres query client via the vendored kit. Dynamically imported
 * so the local build never pulls the pg driver into the bundle. Verifies the
 * verify-full policy before connecting, then scrubs the DSN from the env.
 */
export async function openCloudClient(): Promise<import("../generated/storage-kit/query.js").PoolQueryClient> {
  const dsn = resolveDatabaseDsn();
  if (!dsn) {
    throw new Error("cloud mode needs HASNA_ACCESS_DATABASE_URL (or _FILE); PURE REMOTE reads/writes go to cloud Postgres.");
  }
  assertCloudTlsPolicy(dsn);
  const { createCloudPoolFromEnv } = await import("../generated/storage-kit/pool.js");
  const { scrubDatabaseDsn } = await import("../config.js");
  const { client } = createCloudPoolFromEnv("access");
  scrubDatabaseDsn();
  return client;
}
