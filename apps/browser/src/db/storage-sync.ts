import type { TypedDb } from "../types/db-adapter.js";
import { getDatabase } from "./schema.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = [
  "projects",
  "agents",
  "heartbeats",
  "sessions",
  "snapshots",
  "network_log",
  "console_log",
  "recordings",
  "crawl_results",
  "gallery_entries",
  "session_events",
  "session_tags",
  "auth_flows",
  "datasets",
  "api_endpoints",
  "feedback",
  "video_recordings",
] as const;

export const BROWSER_STORAGE_TABLES = STORAGE_TABLES;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;
export type StorageMode = "local" | "hybrid" | "remote";

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  projects: ["id"],
  agents: ["id"],
  heartbeats: ["id"],
  sessions: ["id"],
  snapshots: ["id"],
  network_log: ["id"],
  console_log: ["id"],
  recordings: ["id"],
  crawl_results: ["id"],
  gallery_entries: ["id"],
  session_events: ["id"],
  session_tags: ["session_id", "tag"],
  auth_flows: ["id"],
  datasets: ["id"],
  api_endpoints: ["id"],
  feedback: ["id"],
  video_recordings: ["id"],
};

export interface SyncResult {
  table: string;
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

export interface SyncMeta {
  table_name: string;
  last_synced_at: string | null;
  direction: "push" | "pull";
}

export const BROWSER_STORAGE_ENV = "HASNA_BROWSER_DATABASE_URL";
export const BROWSER_STORAGE_FALLBACK_ENV = "BROWSER_DATABASE_URL";
export const BROWSER_STORAGE_MODE_ENV = "HASNA_BROWSER_STORAGE_MODE";
export const BROWSER_STORAGE_MODE_FALLBACK_ENV = "BROWSER_STORAGE_MODE";
export const STORAGE_DATABASE_ENV = [BROWSER_STORAGE_ENV, BROWSER_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [BROWSER_STORAGE_MODE_ENV, BROWSER_STORAGE_MODE_FALLBACK_ENV] as const;

export interface StorageEnv {
  name: string;
}

export interface StorageStatus {
  configured: boolean;
  mode: StorageMode;
  env: typeof STORAGE_DATABASE_ENV;
  activeEnv: string | null;
  service: "browser";
  tables: readonly StorageTable[];
  sync: SyncMeta[];
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function normalizeStorageMode(value: string | null): StorageMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "hybrid" || normalized === "remote") return normalized;
  return undefined;
}

export function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (readEnv(name)) return name;
  }
  return null;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  const name = getStorageDatabaseEnvName();
  return name ? { name } : null;
}

export function getStorageDatabaseUrl(): string | null {
  const env = getStorageDatabaseEnv();
  return env ? readEnv(env.name) : null;
}

export function getStorageMode(): StorageMode {
  let mode: StorageMode | undefined;
  for (const env of STORAGE_MODE_ENV) {
    mode = normalizeStorageMode(readEnv(env));
    if (mode) break;
  }
  if (mode) return mode;
  return getStorageDatabaseUrl() ? "hybrid" : "local";
}

export function getStorageStatus(): StorageStatus {
  const activeEnv = getStorageDatabaseEnv();
  return {
    configured: Boolean(activeEnv),
    mode: getStorageMode(),
    env: STORAGE_DATABASE_ENV,
    activeEnv: activeEnv?.name ?? null,
    service: "browser",
    tables: STORAGE_TABLES,
    sync: getSyncMetaAll(),
  };
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_BROWSER_DATABASE_URL or BROWSER_DATABASE_URL");
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  const db = getDatabase();
  try {
    ensureOptionalLocalTables(db);
    await runStorageMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of resolveTables(options?.tables)) {
      results.push(await pushTable(db, remote, table));
    }
    recordSyncMeta(db, "push", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storagePull(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  const db = getDatabase();
  try {
    ensureOptionalLocalTables(db);
    await runStorageMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of resolveTables(options?.tables)) {
      results.push(await pullTable(remote, db, table));
    }
    recordSyncMeta(db, "pull", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storageSync(options?: { tables?: string[] }): Promise<{ pull: SyncResult[]; push: SyncResult[] }> {
  const pull = await storagePull(options);
  const push = await storagePush(options);
  return { pull, push };
}

export function getSyncMetaAll(): SyncMeta[] {
  const db = getDatabase();
  ensureSyncMetaTable(db);
  return db
    .query<SyncMeta, []>("SELECT table_name, last_synced_at, direction FROM _browser_sync_meta ORDER BY table_name, direction")
    .all();
}

export function getStorageSyncMetaAll(): SyncMeta[] {
  return getSyncMetaAll();
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown browser sync table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

async function pushTable(db: TypedDb, remote: PgAdapterAsync, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!tableExists(db, table)) return result;
    const rows = db.query<Row, []>(`SELECT * FROM ${quoteIdent(table)}`).all();
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const columns = await filterRemoteColumns(remote, table, Object.keys(rows[0]!));
    result.rowsWritten = await upsertPg(remote, table, columns, rows);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullTable(remote: PgAdapterAsync, db: TypedDb, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!tableExists(db, table)) return result;
    const rows = await remote.all(`SELECT * FROM ${quoteIdent(table)}`) as Row[];
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const columns = filterLocalColumns(db, table, Object.keys(rows[0]!));
    result.rowsWritten = upsertSqlite(db, table, columns, rows);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function filterRemoteColumns(remote: PgAdapterAsync, table: string, columns: string[]): Promise<string[]> {
  const rows = await remote.all(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ?
  `, table) as Array<{ column_name: string }>;
  if (rows.length === 0) return columns;
  const allowed = new Set(rows.map((row) => row.column_name));
  return columns.filter((column) => allowed.has(column));
}

function filterLocalColumns(db: TypedDb, table: string, columns: string[]): string[] {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${quoteIdent(table)})`).all();
  const allowed = new Set(rows.map((row) => row.name));
  return columns.filter((column) => allowed.has(column));
}

async function upsertPg(remote: PgAdapterAsync, table: StorageTable, columns: string[], rows: Row[]): Promise<number> {
  if (columns.length === 0) return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0]!;
  const setClause = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")
    : `${quoteIdent(fallbackKey)} = EXCLUDED.${quoteIdent(fallbackKey)}`;

  for (const row of rows) {
    await remote.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
       ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`,
      ...columns.map((column) => row[column] ?? null),
    );
  }
  return rows.length;
}

function upsertSqlite(db: TypedDb, table: StorageTable, columns: string[], rows: Row[]): number {
  if (columns.length === 0) return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0]!;
  const setClause = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(", ")
    : `${quoteIdent(fallbackKey)} = excluded.${quoteIdent(fallbackKey)}`;
  const statement = db.prepare(
    `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
     ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`,
  );
  const insert = db.transaction((batch: Row[]) => {
    for (const row of batch) {
      statement.run(...columns.map((column) => coerceForSqlite(row[column])));
    }
  });
  insert(rows);
  return rows.length;
}

function recordSyncMeta(db: TypedDb, direction: "push" | "pull", results: SyncResult[]): void {
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.errors.length > 0) continue;
    db.prepare(`
      INSERT INTO _browser_sync_meta (table_name, last_synced_at, direction)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
    `).run(result.table, now, direction);
  }
}

function ensureSyncMetaTable(db: TypedDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _browser_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}

function ensureOptionalLocalTables(db: TypedDb): void {
  db.exec(`
    DROP TABLE IF EXISTS watch_events;
    DROP TABLE IF EXISTS watch_jobs;
    DROP TABLE IF EXISTS cron_events;
    DROP TABLE IF EXISTS cron_jobs;
    DROP TABLE IF EXISTS script_runs;
    DROP TABLE IF EXISTS script_steps;
    DROP TABLE IF EXISTS scripts;
  `);
}

function tableExists(db: TypedDb, table: string): boolean {
  const row = db.query<{ name: string }, [string]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(table);
  return Boolean(row);
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function coerceForSqlite(value: unknown): string | number | bigint | boolean | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
