import type { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = [
  "domains",
  "dns_records",
  "alerts",
  "domain_offers",
  "domain_emails",
  "domain_owners",
  "domain_history",
  "domain_reputation",
] as const;
export const DOMAINS_STORAGE_TABLES = STORAGE_TABLES;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  domains: ["id"],
  dns_records: ["id"],
  alerts: ["id"],
  domain_offers: ["id"],
  domain_emails: ["id"],
  domain_owners: ["id"],
  domain_history: ["id"],
  domain_reputation: ["id"],
};

export type StorageMode = "local" | "remote" | "hybrid";

export interface StorageSyncResult {
  table: string;
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

export interface StorageSyncMeta {
  table_name: string;
  last_synced_at: string | null;
  direction: "push" | "pull";
}

export type SyncResult = StorageSyncResult;
export type SyncMeta = StorageSyncMeta;

export interface StorageStatus {
  configured: boolean;
  env: typeof STORAGE_DATABASE_ENV;
  mode: StorageMode;
  service: "domains";
  tables: typeof STORAGE_TABLES;
  sync: StorageSyncMeta[];
}

export const DOMAINS_STORAGE_ENV = "DOMAINS_DATABASE_URL";
export const DOMAINS_STORAGE_FALLBACK_ENV = "HASNA_DOMAINS_DATABASE_URL";
export const DOMAINS_STORAGE_MODE_ENV = "DOMAINS_STORAGE_MODE";
export const DOMAINS_STORAGE_MODE_FALLBACK_ENV = "HASNA_DOMAINS_STORAGE_MODE";
export const STORAGE_DATABASE_ENV = [DOMAINS_STORAGE_ENV, DOMAINS_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [DOMAINS_STORAGE_MODE_ENV, DOMAINS_STORAGE_MODE_FALLBACK_ENV] as const;

function firstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

function normalizeStorageMode(value?: string | null): StorageMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "remote" || normalized === "hybrid") return normalized;
  return null;
}

export function getStorageDatabaseUrl(): string | null {
  return firstEnv(STORAGE_DATABASE_ENV);
}

export function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (process.env[name]) return name;
  }
  return null;
}

export function getStorageMode(): StorageMode {
  return normalizeStorageMode(firstEnv(STORAGE_MODE_ENV))
    ?? (getStorageDatabaseUrl() ? "remote" : "local");
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing DOMAINS_DATABASE_URL or HASNA_DOMAINS_DATABASE_URL");
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<StorageSyncResult[]> {
  const remote = await getStoragePg();
  const db = getDatabase();
  try {
    await runStorageMigrations(remote);
    const results: StorageSyncResult[] = [];
    for (const table of resolveTables(options?.tables)) results.push(await pushTable(db, remote, table));
    recordSyncMeta(db, "push", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storagePull(options?: { tables?: string[] }): Promise<StorageSyncResult[]> {
  const remote = await getStoragePg();
  const db = getDatabase();
  try {
    await runStorageMigrations(remote);
    const results: StorageSyncResult[] = [];
    for (const table of resolveTables(options?.tables)) results.push(await pullTable(remote, db, table));
    recordSyncMeta(db, "pull", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storageSync(options?: { tables?: string[] }): Promise<{ pull: StorageSyncResult[]; push: StorageSyncResult[] }> {
  const pull = await storagePull(options);
  const push = await storagePush(options);
  return { pull, push };
}

export function getStorageSyncMetaAll(): StorageSyncMeta[] {
  const db = getDatabase();
  ensureSyncMetaTable(db);
  return db.query<StorageSyncMeta, []>("SELECT table_name, last_synced_at, direction FROM _domains_sync_meta ORDER BY table_name, direction").all();
}

export function getStorageStatus(): StorageStatus {
  return {
    configured: Boolean(getStorageDatabaseUrl()),
    env: STORAGE_DATABASE_ENV,
    mode: getStorageMode(),
    service: "domains",
    tables: STORAGE_TABLES,
    sync: getStorageSyncMetaAll(),
  };
}

export function getSyncMetaAll(): StorageSyncMeta[] {
  return getStorageSyncMetaAll();
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown domains sync table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

async function pushTable(db: Database, remote: PgAdapterAsync, table: StorageTable): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, table)) return result;
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

async function pullTable(remote: PgAdapterAsync, db: Database, table: StorageTable): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, table)) return result;
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
      ...columns.map((column) => coerceForPg(row[column], remoteColumns.get(column))),
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
  for (const row of rows) statement.run(...columns.map((column) => coerceForSqlite(row[column])));
  return rows.length;
}

function recordSyncMeta(db: Database, direction: "push" | "pull", results: StorageSyncResult[]): void {
  ensureSyncMetaTable(db);
  const timestamp = new Date().toISOString();
  const statement = db.prepare(
    "INSERT INTO _domains_sync_meta (table_name, last_synced_at, direction) VALUES (?, ?, ?) ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at",
  );
  for (const result of results) {
    if (result.errors.length > 0) continue;
    statement.run(result.table, timestamp, direction);
  }
}

function ensureSyncMetaTable(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS _domains_sync_meta (table_name TEXT NOT NULL, last_synced_at TEXT, direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')), PRIMARY KEY (table_name, direction))");
}

function sqliteTableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table));
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function coerceForPg(value: unknown, dataType?: string): unknown {
  if (value === undefined || value === null) return null;
  if (dataType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function coerceForSqlite(value: unknown): string | number | bigint | boolean | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
