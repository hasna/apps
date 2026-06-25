import type { Database } from "bun:sqlite";
import { getRawDb } from "./index.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = [
  "fine_tuned_models",
  "training_jobs",
  "training_datasets",
  "feedback",
] as const;

export const BRAINS_STORAGE_TABLES = STORAGE_TABLES;

export const BRAINS_STORAGE_ENV = {
  databaseUrl: "HASNA_BRAINS_DATABASE_URL",
  mode: "HASNA_BRAINS_STORAGE_MODE",
} as const;

export const BRAINS_STORAGE_FALLBACK_ENV = {
  databaseUrl: "BRAINS_DATABASE_URL",
  mode: "BRAINS_STORAGE_MODE",
} as const;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;
export type StorageMode = "local" | "hybrid" | "remote";
type BrainsStorageEnvKey = keyof typeof BRAINS_STORAGE_ENV;

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  fine_tuned_models: ["id"],
  training_jobs: ["id"],
  training_datasets: ["id"],
  feedback: ["id"],
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
  deprecated: boolean;
}

export interface StorageEnvStatus {
  name: string;
  active_name: string;
  configured: boolean;
}

export interface NativeStorageStatus {
  ok: boolean;
  service: "brains";
  mode: StorageMode;
  local_default: boolean;
  remote_enabled: boolean;
  database: {
    configured: boolean;
    redacted_url: string | null;
  };
  tables: readonly StorageTable[];
  env: {
    databaseUrl: StorageEnvStatus;
    mode: StorageEnvStatus;
  };
  issues: string[];
  warnings: string[];
  no_network: true;
}

function normalizeStorageMode(value: string | undefined): StorageMode | undefined {
  if (value === "local" || value === "hybrid" || value === "remote") return value;
  return undefined;
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

const DATABASE_ENV_NAMES = [
  { name: BRAINS_STORAGE_ENV.databaseUrl, deprecated: false },
  { name: BRAINS_STORAGE_FALLBACK_ENV.databaseUrl, deprecated: false },
] as const;

const MODE_ENV_NAMES = [
  { name: BRAINS_STORAGE_ENV.mode, deprecated: false },
  { name: BRAINS_STORAGE_FALLBACK_ENV.mode, deprecated: false },
] as const;

export function getStorageMode(): StorageMode {
  const mode = normalizeStorageMode(getStorageModeValue() ?? undefined);
  if (mode) return mode;
  return getStorageDatabaseUrl() ? "hybrid" : "local";
}

function getStorageModeValue(): string | null {
  for (const env of MODE_ENV_NAMES) {
    const value = readEnv(env.name);
    if (value) return value;
  }
  return null;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  for (const env of DATABASE_ENV_NAMES) {
    if (readEnv(env.name)) return env;
  }
  return null;
}

function getStorageEnvName(key: BrainsStorageEnvKey): string {
  const canonical = BRAINS_STORAGE_ENV[key];
  const fallback = BRAINS_STORAGE_FALLBACK_ENV[key];
  return readEnv(canonical) || !readEnv(fallback) ? canonical : fallback;
}

export function getStorageDatabaseEnvName(): string {
  return getStorageEnvName("databaseUrl");
}

export function getStorageDatabaseUrl(): string | null {
  const env = getStorageDatabaseEnv();
  return env ? readEnv(env.name) : null;
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_BRAINS_DATABASE_URL");
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  await remote.run("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  const local = getRawDb();
  try {
    await runStorageMigrations(remote);
    const db = local.raw;
    const results: SyncResult[] = [];
    for (const table of resolveTables(options?.tables)) {
      results.push(await pushTable(db, remote, table));
    }
    recordSyncMeta(db, "push", results);
    return results;
  } finally {
    local.close();
    await remote.close();
  }
}

export async function storagePull(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  const local = getRawDb();
  try {
    await runStorageMigrations(remote);
    const db = local.raw;
    const results: SyncResult[] = [];
    for (const table of resolveTables(options?.tables)) {
      results.push(await pullTable(remote, db, table));
    }
    recordSyncMeta(db, "pull", results);
    return results;
  } finally {
    local.close();
    await remote.close();
  }
}

export async function storageSync(options?: { tables?: string[] }): Promise<{ pull: SyncResult[]; push: SyncResult[] }> {
  const pull = await storagePull(options);
  const push = await storagePush(options);
  return { pull, push };
}

export function getSyncMetaAll(): SyncMeta[] {
  const local = getRawDb();
  try {
    const db = local.raw;
    ensureSyncMetaTable(db);
    return db
      .prepare("SELECT table_name, last_synced_at, direction FROM _brains_sync_meta ORDER BY table_name, direction")
      .all() as SyncMeta[];
  } finally {
    local.close();
  }
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown brains sync table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

function redactDatabaseUrl(value: string | null): string | null {
  return value?.replace(/:[^:@/]+@/, ":***@") ?? null;
}

function storageEnvStatus(key: BrainsStorageEnvKey): StorageEnvStatus {
  const activeName = getStorageEnvName(key);
  return {
    name: BRAINS_STORAGE_ENV[key],
    active_name: activeName,
    configured: readEnv(activeName) !== null,
  };
}

export function getStorageStatus(): NativeStorageStatus {
  const mode = getStorageMode();
  const databaseUrl = getStorageDatabaseUrl();
  const issues: string[] = [];
  if ((mode === "remote" || mode === "hybrid") && !databaseUrl) {
    issues.push(`Missing ${BRAINS_STORAGE_ENV.databaseUrl}`);
  }

  return {
    ok: issues.length === 0,
    service: "brains",
    mode,
    local_default: mode === "local",
    remote_enabled: mode === "remote" || mode === "hybrid",
    database: {
      configured: Boolean(databaseUrl),
      redacted_url: redactDatabaseUrl(databaseUrl),
    },
    tables: STORAGE_TABLES,
    env: {
      databaseUrl: storageEnvStatus("databaseUrl"),
      mode: storageEnvStatus("mode"),
    },
    issues,
    warnings: [],
    no_network: true,
  };
}

export const getBrainsStorageStatus = getStorageStatus;

async function pushTable(db: Database, remote: PgAdapterAsync, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all() as Row[];
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const columns = await filterRemoteColumns(remote, table, Object.keys(rows[0]!));
    result.rowsWritten = await upsertPg(remote, table, columns, rows);
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

function filterLocalColumns(db: Database, table: string, columns: string[]): string[] {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
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

function recordSyncMeta(db: Database, direction: "push" | "pull", results: SyncResult[]): void {
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.errors.length > 0) continue;
    db.prepare(`
      INSERT INTO _brains_sync_meta (table_name, last_synced_at, direction)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
    `).run(result.table, now, direction);
  }
}

function ensureSyncMetaTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _brains_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
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
