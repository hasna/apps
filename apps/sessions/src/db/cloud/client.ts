// Postgres client for sessions-serve (PURE REMOTE).
//
// Opens a single pooled connection to PostgreSQL via the vendored storage
// kit. The server has exactly one technical switch: a configured
// HASNA_SESSIONS_DATABASE_URL selects PostgreSQL; otherwise SQLite is
// authoritative. With the postgresql backend, reads AND writes go directly to
// Postgres — there is no sync engine, cache, or local mirror in the service
// path.

import {
  createServerPoolFromEnv,
  resolveServerDataBackend,
  type PoolQueryClient,
} from "../../generated/storage-kit/index.js";

export const APP_NAME = "sessions";

let _client: PoolQueryClient | null = null;

/**
 * The server's data backend, selected by the environment:
 * `HASNA_SESSIONS_DATABASE_URL` present -> "postgresql", else "sqlite".
 * Legacy storage-mode variables are rejected by the kit's
 * `resolveServerDataBackend` (they were removed, never mapped).
 */
export function serverDataBackend(env: NodeJS.ProcessEnv = process.env): "sqlite" | "postgresql" {
  return resolveServerDataBackend(APP_NAME, env).backend;
}

/**
 * Get the process-wide Postgres client, creating it on first use.
 * Throws a clear error (never a silent no-op) when no database URL selects
 * the postgresql backend.
 */
export function getCloudClient(): PoolQueryClient {
  if (_client) return _client;
  const { client } = createServerPoolFromEnv(APP_NAME, {
    applicationName: "sessions-serve",
    max: 5,
  });
  _client = client;
  return _client;
}

/** Close the cloud client (used on shutdown / in tests). */
export async function closeCloudClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}
