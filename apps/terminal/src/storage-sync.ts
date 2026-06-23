import { PG_MIGRATIONS } from "./db/pg-migrations.js";
import { getDb, type TerminalDatabase } from "./sessions-db.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = [
  "sessions",
  "interactions",
  "corrections",
  "outputs",
  "feedback",
] as const;

export const TERMINAL_STORAGE_TABLES = STORAGE_TABLES;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;

interface ColumnInfo {
  dataType: string;
  isIdentity: boolean;
  identityGeneration: string | null;
}

export type StorageMode = "local" | "hybrid" | "remote";

export interface StorageEnv {
  name: string;
}

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

export const TERMINAL_STORAGE_ENV = "HASNA_TERMINAL_DATABASE_URL";
export const TERMINAL_STORAGE_FALLBACK_ENV = "TERMINAL_DATABASE_URL";
export const TERMINAL_STORAGE_MODE_ENV = "HASNA_TERMINAL_STORAGE_MODE";
export const TERMINAL_STORAGE_MODE_FALLBACK_ENV = "TERMINAL_STORAGE_MODE";
export const STORAGE_DATABASE_ENV = [TERMINAL_STORAGE_ENV, TERMINAL_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [TERMINAL_STORAGE_MODE_ENV, TERMINAL_STORAGE_MODE_FALLBACK_ENV] as const;

export const CANONICAL_TERMINAL_RDS_CLUSTER = "hasna-xyz-infra-apps-prod-postgres";
export const CANONICAL_TERMINAL_RDS_DATABASE = "terminal";
export const CANONICAL_TERMINAL_RDS_SECRET_PATH = "hasna/xyz/opensource/terminal/prod/rds";

export interface CanonicalTerminalRdsConfig {
  cluster: typeof CANONICAL_TERMINAL_RDS_CLUSTER;
  database: typeof CANONICAL_TERMINAL_RDS_DATABASE;
  runtimeSecretPath: typeof CANONICAL_TERMINAL_RDS_SECRET_PATH;
  primaryEnv: typeof TERMINAL_STORAGE_ENV;
  fallbackEnv: typeof TERMINAL_STORAGE_FALLBACK_ENV;
}

export interface StorageStatus {
  configured: boolean;
  mode: StorageMode;
  env: typeof STORAGE_DATABASE_ENV;
  activeEnv: string | null;
  service: "terminal";
  canonical: CanonicalTerminalRdsConfig;
  tables: typeof STORAGE_TABLES;
  sync: SyncMeta[];
}

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  sessions: ["id"],
  interactions: ["id"],
  corrections: ["id"],
  outputs: ["id"],
  feedback: ["id"],
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeStorageMode(value: string | undefined): StorageMode | undefined {
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
  return env ? readEnv(env.name) ?? null : null;
}

export function getStorageMode(): StorageMode {
  const mode = normalizeStorageMode(readEnv(TERMINAL_STORAGE_MODE_ENV))
    ?? normalizeStorageMode(readEnv(TERMINAL_STORAGE_MODE_FALLBACK_ENV));
  if (mode) return mode;
  return getStorageDatabaseUrl() ? "hybrid" : "local";
}

export function getCanonicalTerminalRdsConfig(): CanonicalTerminalRdsConfig {
  return {
    cluster: CANONICAL_TERMINAL_RDS_CLUSTER,
    database: CANONICAL_TERMINAL_RDS_DATABASE,
    runtimeSecretPath: CANONICAL_TERMINAL_RDS_SECRET_PATH,
    primaryEnv: TERMINAL_STORAGE_ENV,
    fallbackEnv: TERMINAL_STORAGE_FALLBACK_ENV,
  };
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_TERMINAL_DATABASE_URL or TERMINAL_DATABASE_URL");
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  await remote.run("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  const db = getDb();
  try {
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
  const db = getDb();
  try {
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
  const db = getDb();
  ensureSyncMetaTable(db);
  return db.prepare("SELECT table_name, last_synced_at, direction FROM _terminal_sync_meta ORDER BY table_name, direction").all() as SyncMeta[];
}

export function getStorageStatus(): StorageStatus {
  const activeEnv = getStorageDatabaseEnv();
  return {
    configured: Boolean(activeEnv),
    mode: getStorageMode(),
    env: STORAGE_DATABASE_ENV,
    activeEnv: activeEnv?.name ?? null,
    service: "terminal",
    canonical: getCanonicalTerminalRdsConfig(),
    tables: STORAGE_TABLES,
    sync: getSyncMetaAll(),
  };
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown terminal storage table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

export function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined {
  if (!value) return undefined;
  return resolveTables(Array.isArray(value) ? value : value.split(","));
}

async function pushTable(db: TerminalDatabase, remote: PgAdapterAsync, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!tableExists(db, table)) return result;
    const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all() as Row[];
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

async function pullTable(remote: PgAdapterAsync, db: TerminalDatabase, table: StorageTable): Promise<SyncResult> {
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

async function getRemoteColumns(remote: PgAdapterAsync, table: string): Promise<Map<string, ColumnInfo>> {
  const rows = await remote.all(
    `SELECT column_name, data_type, is_identity, identity_generation
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ?`,
    table,
  ) as Array<{ column_name: string; data_type: string; is_identity: string; identity_generation: string | null }>;
  return new Map(rows.map((row) => [row.column_name, {
    dataType: row.data_type,
    isIdentity: row.is_identity === "YES",
    identityGeneration: row.identity_generation,
  }]));
}

function filterRemoteColumns(remoteColumns: Map<string, ColumnInfo>, columns: string[]): string[] {
  if (remoteColumns.size === 0) return columns;
  return columns.filter((column) => remoteColumns.has(column));
}

function filterLocalColumns(db: TerminalDatabase, table: string, columns: string[]): string[] {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
  const allowed = new Set(rows.map((row) => row.name));
  return columns.filter((column) => allowed.has(column));
}

async function upsertPg(remote: PgAdapterAsync, table: StorageTable, columns: string[], rows: Row[], remoteColumns: Map<string, ColumnInfo>): Promise<number> {
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
  const overriding = columns.some((column) => remoteColumns.get(column)?.identityGeneration === "ALWAYS")
    ? " OVERRIDING SYSTEM VALUE"
    : "";

  for (const row of rows) {
    await remote.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList})${overriding} VALUES (${placeholders})
       ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`,
      ...columns.map((column) => coerceForPg(row[column], remoteColumns.get(column)?.dataType)),
    );
  }
  await alignPgSequence(remote, table, fallbackKey);
  return rows.length;
}

function upsertSqlite(db: TerminalDatabase, table: StorageTable, columns: string[], rows: Row[]): number {
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
    for (const row of batch) statement.run(...columns.map((column) => coerceForSqlite(row[column])));
  });
  insert(rows);
  return rows.length;
}

async function alignPgSequence(remote: PgAdapterAsync, table: StorageTable, primaryKey: string): Promise<void> {
  const sequenceRows = await remote.all("SELECT pg_get_serial_sequence(?, ?) AS sequence_name", table, primaryKey) as Array<{ sequence_name: string | null }>;
  const sequenceName = sequenceRows[0]?.sequence_name;
  if (!sequenceName) return;
  await remote.run(
    `SELECT setval(?::regclass, COALESCE((SELECT MAX(${quoteIdent(primaryKey)}) FROM ${quoteIdent(table)}), 1), true)`,
    sequenceName,
  );
}

function recordSyncMeta(db: TerminalDatabase, direction: "push" | "pull", results: SyncResult[]): void {
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO _terminal_sync_meta (table_name, last_synced_at, direction)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
  `);
  for (const result of results) {
    if (result.errors.length > 0) continue;
    statement.run(result.table, now, direction);
  }
}

function ensureSyncMetaTable(db: TerminalDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _terminal_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}

function tableExists(db: TerminalDatabase, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
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
