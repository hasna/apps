/**
 * Cloud (RDS Postgres) data-plane bootstrap for testers-serve.
 *
 * Amendment A1 (PURE REMOTE): the service reads AND writes the cloud Postgres
 * directly through the vendored storage kit. There is no sync engine, cache, or
 * local mirror in the service. The vendored kit resolves the storage mode and
 * DSN from the environment (`HASNA_TESTERS_STORAGE_MODE`,
 * `HASNA_TESTERS_DATABASE_URL`).
 */
import { createCloudPoolFromEnv } from "../generated/storage-kit/pool.js";
import { resolveStorageMode } from "../generated/storage-kit/mode.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";

export const APP_NAME = "testers";

let cached: PoolQueryClient | null = null;

/** True when the environment selects cloud storage mode. */
export function isCloudMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveStorageMode(APP_NAME, env).mode === "cloud";
}

/**
 * Return the shared cloud query client, building it on first use. Throws a
 * clear error (never a silent no-op) when cloud mode/DSN is not configured.
 */
export function getCloudClient(): PoolQueryClient {
  if (cached) return cached;
  cached = createCloudPoolFromEnv(APP_NAME, {
    applicationName: "testers-serve",
    max: Number(process.env["TESTERS_PG_POOL_MAX"] ?? "10"),
  }).client;
  return cached;
}

/** Close the pool (for graceful shutdown / tests). */
export async function closeCloudClient(): Promise<void> {
  if (cached) {
    await cached.close();
    cached = null;
  }
}
