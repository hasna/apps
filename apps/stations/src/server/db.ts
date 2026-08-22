// Cloud database access for the stations serve service (PURE REMOTE — all
// reads/writes hit the shared stations Postgres directly, no local cache, no
// sync engine). Built on the vendored @hasna/contracts storage kit so TLS,
// backend resolution, and pooling are the fleet-standard code.
//
// The server data backend is `sqlite | postgresql`, selected by the presence
// of HASNA_STATIONS_DATABASE_URL (never by a storage-mode variable — a set
// HASNA_STATIONS_STORAGE_MODE throws naming the variable).

import { createServerPoolFromEnv, type PoolQueryClient } from "../generated/storage-kit/index.js";
import { assertNoLegacyStorageMode } from "../lib/retired-storage-mode.js";

export const STATIONS_APP_NAME = "stations";

/** Env var carrying the OWNER-role DSN used only for DDL / migrations. */
export const OWNER_DATABASE_URL_ENV = "HASNA_STATIONS_DATABASE_URL_OWNER";

let cached: PoolQueryClient | null = null;

/**
 * Resolve the shared APP-role client the serve process uses for every request.
 * Requires the `postgresql` data backend (HASNA_STATIONS_DATABASE_URL set).
 * Throws a clear error otherwise — never a silent no-op — and any retired
 * storage-mode variable throws naming the variable.
 */
export function getServiceClient(): PoolQueryClient {
  if (!cached) {
    assertNoLegacyStorageMode();
    cached = createServerPoolFromEnv(STATIONS_APP_NAME, {
      applicationName: "stations-serve",
    }).client;
  }
  return cached;
}

/**
 * Build a one-off OWNER-role client for migrations. Prefers the dedicated
 * owner DSN (`HASNA_STATIONS_DATABASE_URL_OWNER`); falls back to the app DSN
 * when no separate owner secret is wired. Caller must `close()` it.
 */
export function getOwnerClient(env: NodeJS.ProcessEnv = process.env): PoolQueryClient {
  assertNoLegacyStorageMode(env);
  const ownerUrl = env[OWNER_DATABASE_URL_ENV]?.trim();
  const overlayEnv: NodeJS.ProcessEnv = ownerUrl
    ? { ...env, HASNA_STATIONS_DATABASE_URL: ownerUrl }
    : env;
  return createServerPoolFromEnv(STATIONS_APP_NAME, {
    env: overlayEnv,
    applicationName: "stations-migrate",
  }).client;
}

/** Close the cached service client (used by tests / graceful shutdown). */
export async function closeServiceClient(): Promise<void> {
  if (cached) {
    await cached.close();
    cached = null;
  }
}
