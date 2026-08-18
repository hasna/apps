/**
 * Postgres data-plane bootstrap for testers-serve.
 *
 * The server selects its backend from the environment: `HASNA_TESTERS_DATABASE_URL`
 * present selects Postgres (reads AND writes go directly to Postgres through the
 * vendored storage kit), otherwise the app runs on SQLite. There is no sync
 * engine, cache, or local mirror in the service.
 */
import { createCloudPoolFromEnv } from "../generated/storage-kit/pool.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";

export const APP_NAME = "testers";

let cached: PoolQueryClient | null = null;

/** True when the environment selects the Postgres backend. */
export function databaseUrlPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["HASNA_TESTERS_DATABASE_URL"]?.trim() || env["TESTERS_DATABASE_URL"]?.trim());
}

/**
 * Return the shared Postgres query client, building it on first use. Throws a
 * clear error (never a silent no-op) when no database URL is configured.
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
