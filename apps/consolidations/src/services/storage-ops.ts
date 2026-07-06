import { databaseUrlPresent, resolveDbPath, resolveStorageMode } from "../config.js";
import { SqliteStore } from "../db/sqlite-store.js";
import { DATA_TABLES, type Store } from "../db/store.js";
import { ValidationError } from "../types/index.js";

// Storage push/pull/sync + a REDACTED status. These seed/mirror a working copy
// between local SQLite and cloud Postgres; they NEVER move the append-only
// audit_log (excluded — DATA_TABLES only) and are gated by the caller's
// storage:admin scope at the op boundary (not by any process env var).

export interface RedactedStorageStatus {
  mode: "local" | "cloud";
  dsn_present: boolean;
  sqlite_path: string | null;
  migrations_applied: number;
  remote_reachable: boolean;
}

/**
 * Status payload with NO DSN/secret material. `remote_reachable` is probed live
 * for cloud mode and is false in local mode — it is never hardcoded true.
 */
export async function storageStatus(store: Store): Promise<RedactedStorageStatus> {
  const mode = store.mode;
  const remoteReachable = mode === "cloud" ? await store.ping() : false;
  return {
    mode,
    dsn_present: databaseUrlPresent(),
    sqlite_path: mode === "local" ? resolveDbPath() : null,
    migrations_applied: await store.migrationsApplied(),
    remote_reachable: remoteReachable,
  };
}

async function openCloud(): Promise<Store> {
  try {
    const { PostgresStore } = await import("../db/postgres-store.js");
    return await PostgresStore.connect();
  } catch (error) {
    throw new ValidationError(
      `Cloud Postgres is not reachable/configured for storage sync: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function copyData(from: Store, to: Store): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of DATA_TABLES) {
    const rows = await from.list(table);
    let n = 0;
    for (const row of rows) {
      const existing = await to.get(table, row.id);
      if (existing) {
        await to.update(table, row.id, row.data);
      } else {
        await to.insert(table, {
          id: row.id,
          entity_id: row.entity_id,
          period: row.period,
          run_id: row.run_id,
          data: row.data,
          created_at: row.created_at,
        });
      }
      n += 1;
    }
    counts[table] = n;
  }
  return counts;
}

/** Push local SQLite rows to cloud Postgres (audit tables excluded). */
export async function storagePush(): Promise<{ direction: "push"; copied: Record<string, number> }> {
  if (!databaseUrlPresent()) {
    throw new ValidationError("Cannot push: no cloud DATABASE_URL configured.");
  }
  const local = new SqliteStore(resolveDbPath());
  const cloud = await openCloud();
  try {
    return { direction: "push", copied: await copyData(local, cloud) };
  } finally {
    await local.close();
    await cloud.close();
  }
}

/** Pull cloud Postgres rows into local SQLite (audit tables excluded). */
export async function storagePull(): Promise<{ direction: "pull"; copied: Record<string, number> }> {
  if (!databaseUrlPresent()) {
    throw new ValidationError("Cannot pull: no cloud DATABASE_URL configured.");
  }
  const local = new SqliteStore(resolveDbPath());
  const cloud = await openCloud();
  try {
    return { direction: "pull", copied: await copyData(cloud, local) };
  } finally {
    await local.close();
    await cloud.close();
  }
}

/** Push then pull. */
export async function storageSync(): Promise<{ direction: "sync"; pushed: Record<string, number>; pulled: Record<string, number> }> {
  const pushed = (await storagePush()).copied;
  const pulled = (await storagePull()).copied;
  return { direction: "sync", pushed, pulled };
}

/** Whether the active mode even has a counterpart to sync with. */
export function syncAvailable(): boolean {
  return resolveStorageMode() === "cloud" || databaseUrlPresent();
}
