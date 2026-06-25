import type { Database } from "bun:sqlite";
import { getDatabase } from "./store.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = ["runs", "baselines"] as const;
export const EVALS_STORAGE_TABLES = STORAGE_TABLES;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;
export type StorageMode = "local" | "hybrid" | "remote";

export const EVALS_STORAGE_ENV = "HASNA_EVALS_DATABASE_URL";
export const EVALS_STORAGE_FALLBACK_ENV = "EVALS_DATABASE_URL";
export const EVALS_STORAGE_MODE_ENV = "HASNA_EVALS_STORAGE_MODE";
export const EVALS_STORAGE_MODE_FALLBACK_ENV = "EVALS_STORAGE_MODE";
export const STORAGE_DATABASE_ENV = [EVALS_STORAGE_ENV, EVALS_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [EVALS_STORAGE_MODE_ENV, EVALS_STORAGE_MODE_FALLBACK_ENV] as const;

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  runs: ["id"],
  baselines: ["name"],
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

export interface StorageEnv {
  name: string;
}

export interface StorageStatus {
  configured: boolean;
  mode: StorageMode;
  env: typeof STORAGE_DATABASE_ENV;
  activeEnv: string | null;
  service: "evals";
  tables: readonly StorageTable[];
  sync: SyncMeta[];
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (readEnv(name)) return { name };
  }
  return null;
}

export function getStorageDatabaseUrl(): string | null {
  const env = getStorageDatabaseEnv();
  return env ? readEnv(env.name) : null;
}

function normalizeStorageMode(value: string): StorageMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "hybrid" || normalized === "remote") {
    return normalized;
  }
  throw new Error(`Unknown evals storage mode: ${value}`);
}

export function getStorageMode(): StorageMode {
  for (const name of STORAGE_MODE_ENV) {
    const value = readEnv(name);
    if (value) return normalizeStorageMode(value);
  }
  return getStorageDatabaseUrl() ? "hybrid" : "local";
}

export function getStorageStatus(): StorageStatus {
  const activeEnv = getStorageDatabaseEnv();
  return {
    configured: Boolean(activeEnv),
    mode: getStorageMode(),
    env: STORAGE_DATABASE_ENV,
    activeEnv: activeEnv?.name ?? null,
    service: "evals",
    tables: STORAGE_TABLES,
    sync: getSyncMetaAll(),
  };
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_EVALS_DATABASE_URL or EVALS_DATABASE_URL");
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
    await runStorageMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of parseStorageTables(options?.tables)) results.push(await pushTable(db, remote, table));
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
    await runStorageMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of parseStorageTables(options?.tables)) results.push(await pullTable(remote, db, table));
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
  return db.query<SyncMeta, []>("SELECT table_name, last_synced_at, direction FROM _evals_sync_meta ORDER BY table_name, direction").all();
}

export function parseStorageTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown evals sync table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

export const resolveTables = parseStorageTables;

async function pushTable(db: Database, remote: PgAdapterAsync, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    const rows = db.query<Row, []>(`SELECT * FROM ${quoteIdent(table)}`).all();
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const remoteColumns = await getRemoteColumns(remote, table);
    const columns = filterRemoteColumns(remoteColumns, Object.keys(rows[0]!));
    result.rowsWritten = await upsertPg(remote, table, columns, rows, remoteColumns);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullTable(remote: PgAdapterAsync, db: Database, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
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

async function getRemoteColumns(remote: PgAdapterAsync, table: string): Promise<Map<string, string>> {
  const rows = await remote.all(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
    table,
  ) as Array<{ column_name: string; data_type: string }>;
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}

function filterRemoteColumns(remoteColumns: Map<string, string>, columns: string[]): string[] {
  if (remoteColumns.size === 0) return columns;
  return columns.filter((column) => remoteColumns.has(column));
}

function filterLocalColumns(db: Database, table: string, columns: string[]): string[] {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${quoteIdent(table)})`).all();
  const allowed = new Set(rows.map((row) => row.name));
  return columns.filter((column) => allowed.has(column));
}

async function upsertPg(remote: PgAdapterAsync, table: StorageTable, columns: string[], rows: Row[], remoteColumns: Map<string, string>): Promise<number> {
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
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders}) ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`,
      ...columns.map((column) => coerceValue(row[column], remoteColumns.get(column))),
    );
  }
  return rows.length;
}

function upsertSqlite(db: Database, table: StorageTable, columns: string[], rows: Row[]): number {
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
  const statement = db.prepare(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders}) ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`);
  for (const row of rows) statement.run(...columns.map((column) => coerceValue(row[column])));
  return rows.length;
}

function recordSyncMeta(db: Database, direction: "push" | "pull", results: SyncResult[]): void {
  ensureSyncMetaTable(db);
  const timestamp = new Date().toISOString();
  const statement = db.prepare(
    "INSERT INTO _evals_sync_meta (table_name, last_synced_at, direction) VALUES (?, ?, ?) ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at",
  );
  for (const result of results) {
    if (result.errors.length > 0) continue;
    statement.run(result.table, timestamp, direction);
  }
}

function ensureSyncMetaTable(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS _evals_sync_meta (table_name TEXT NOT NULL, last_synced_at TEXT, direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')), PRIMARY KEY (table_name, direction))");
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function coerceValue(value: unknown, dataType?: string): string | number | bigint | boolean | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (dataType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
