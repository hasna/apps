import type { BackendConfig } from "../config.js";
import { resolveConfig } from "../config.js";
import type { AuthStorage } from "./contract.js";
import { SqliteAuthStorage } from "./sqlite.js";

export type { AuthStorage } from "./contract.js";
export { SqliteAuthStorage } from "./sqlite.js";
export { PostgresAuthStorage } from "./postgres.js";
export { POSTGRES_STORAGE_MIGRATIONS, checksumStorageSql } from "./postgres-schema.js";

/**
 * Build the storage adapter for the resolved deployment config. A DATABASE_URL
 * (server-side only) selects PostgreSQL; otherwise SQLite is authoritative.
 * The Postgres adapter is loaded lazily so the SQLite path stays dependency-free
 * and `bun test` is hermetic on a box with no `pg` installed.
 */
export async function createAuthStorage(config: BackendConfig = resolveConfig()): Promise<AuthStorage> {
  if (config.databaseUrl) {
    const { Pool } = await import("pg");
    const { PostgresAuthStorage } = await import("./postgres.ts");
    const pool = new Pool({ connectionString: config.databaseUrl });
    const storage = new PostgresAuthStorage({ pool });
    await storage.migrate();
    return storage;
  }
  const storage = new SqliteAuthStorage({ path: config.sqlitePath });
  await storage.migrate();
  return storage;
}
