import { getDatabase } from "../db/database.js";
import { PG_MIGRATIONS } from "../db/pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";
import { syncPull, syncPush, type SyncProgress, type SyncResult } from "./storage-sync.js";

export const REMOTE_STORAGE_TABLES = [
  "agents",
  "resource_locks",
  "connector_rate_usage",
  "connector_jobs",
  "connector_job_runs",
  "connector_workflows",
  "connector_usage",
  "connector_promotions",
  "feedback",
] as const;

export interface SyncMeta {
  table_name: string;
  last_synced_at: string | null;
  direction: "push" | "pull";
}

export function getRemoteDatabaseUrl(): string | null {
  return process.env.HASNA_CONNECTORS_DATABASE_URL
    ?? process.env.CONNECTORS_DATABASE_URL
    ?? null;
}

export async function getRemotePg(): Promise<PgAdapterAsync> {
  const url = getRemoteDatabaseUrl();
  if (!url) throw new Error("Missing HASNA_CONNECTORS_DATABASE_URL or CONNECTORS_DATABASE_URL");
  return new PgAdapterAsync(url);
}

export async function runRemoteMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function remotePush(opts?: { tables?: string[]; onProgress?: (progress: SyncProgress) => void }): Promise<SyncResult[]> {
  const remote = await getRemotePg();
  try {
    await runRemoteMigrations(remote);
    const db = getDatabase();
    const results = await syncPush(db, remote, { tables: resolveTables(opts?.tables), onProgress: opts?.onProgress });
    assertSyncSucceeded(results);
    recordSyncMeta("push", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function remotePull(opts?: { tables?: string[]; onProgress?: (progress: SyncProgress) => void }): Promise<SyncResult[]> {
  const remote = await getRemotePg();
  try {
    await runRemoteMigrations(remote);
    const db = getDatabase();
    const results = await syncPull(remote, db, { tables: resolveTables(opts?.tables), onProgress: opts?.onProgress });
    assertSyncSucceeded(results);
    recordSyncMeta("pull", results);
    return results;
  } finally {
    await remote.close();
  }
}

export function getSyncMetaAll(): SyncMeta[] {
  const db = getDatabase();
  ensureSyncMetaTable();
  return db.all("SELECT table_name, last_synced_at, direction FROM _connectors_sync_meta ORDER BY table_name") as SyncMeta[];
}

export function resolveTables(tables?: string[]): string[] {
  if (!tables || tables.length === 0) return [...REMOTE_STORAGE_TABLES];
  const allowed = new Set<string>(REMOTE_STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown connectors sync table(s): ${invalid.join(", ")}`);
  return requested;
}

export function assertSyncSucceeded(results: SyncResult[]): void {
  const failed = results.filter((result) => result.errors.length > 0);
  if (failed.length === 0) return;
  const details = failed
    .map((result) => `${result.table}: ${result.errors.join(", ")}`)
    .join("; ");
  throw new Error(`Remote storage sync aborted: ${details}`);
}

function recordSyncMeta(direction: "push" | "pull", results: SyncResult[]): void {
  const db = getDatabase();
  ensureSyncMetaTable();
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.errors.length > 0) continue;
    db.run(
      `INSERT INTO _connectors_sync_meta (table_name, last_synced_at, direction)
       VALUES (?, ?, ?)
       ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
      [result.table, now, direction],
    );
  }
}

function ensureSyncMetaTable(): void {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS _connectors_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}
