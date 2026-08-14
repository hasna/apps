// Cloud database access for the machines serve service (Amendment A1: PURE
// REMOTE — all reads/writes hit the shared RDS `machines` database directly,
// no local cache, no sync engine). Built on the vendored @hasna/contracts
// storage kit so TLS, mode resolution, and pooling are the fleet-standard code.

import { createCloudPoolFromEnv, type CloudPoolFromEnv } from "../generated/storage-kit/pool.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";

export const MACHINES_APP_NAME = "machines";

/** Env var carrying the OWNER-role DSN used only for DDL / migrations. */
export const OWNER_DATABASE_URL_ENV = "HASNA_MACHINES_DATABASE_URL_OWNER";

let cached: CloudPoolFromEnv | null = null;

/**
 * Resolve the shared APP-role cloud client the serve process uses for every
 * request. Requires `HASNA_MACHINES_STORAGE_MODE=cloud` and
 * `HASNA_MACHINES_DATABASE_URL`. Throws a clear error otherwise — never a
 * silent no-op.
 */
export function getServiceClient(): PoolQueryClient {
  if (!cached) {
    cached = createCloudPoolFromEnv(MACHINES_APP_NAME, { applicationName: "machines-serve" });
  }
  return cached.client;
}

/**
 * Build a one-off OWNER-role cloud client for migrations. Prefers the dedicated
 * owner DSN (`HASNA_MACHINES_DATABASE_URL_OWNER`); falls back to the app DSN
 * when no separate owner secret is wired. Caller must `close()` it.
 */
export function getOwnerClient(env: NodeJS.ProcessEnv = process.env): PoolQueryClient {
  const ownerUrl = env[OWNER_DATABASE_URL_ENV]?.trim();
  const overlayEnv: NodeJS.ProcessEnv = ownerUrl
    ? { ...env, HASNA_MACHINES_DATABASE_URL: ownerUrl, HASNA_MACHINES_STORAGE_MODE: "cloud" }
    : env;
  return createCloudPoolFromEnv(MACHINES_APP_NAME, {
    env: overlayEnv,
    applicationName: "machines-migrate",
  }).client;
}

/** Close the cached service client (used by tests / graceful shutdown). */
export async function closeServiceClient(): Promise<void> {
  if (cached) {
    await cached.client.close();
    cached = null;
  }
}
