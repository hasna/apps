import type { Database } from "bun:sqlite";
import { getDb } from "./db.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = ["secrets", "vault_items", "audit_log", "users", "feedback"] as const;
export const SECRETS_STORAGE_TABLES = STORAGE_TABLES;

export const SECRETS_STORAGE_ENV = {
  databaseUrl: "HASNA_SECRETS_DATABASE_URL",
  mode: "HASNA_SECRETS_STORAGE_MODE",
} as const;

export const SECRETS_STORAGE_FALLBACK_ENV = {
  databaseUrl: "SECRETS_DATABASE_URL",
  mode: "SECRETS_STORAGE_MODE",
} as const;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;
type SecretsStorageEnvKey = keyof typeof SECRETS_STORAGE_ENV;

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  secrets: ["key"],
  vault_items: ["id"],
  audit_log: ["id"],
  users: ["id"],
  feedback: ["id"],
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

export const STORAGE_DATABASE_ENV = [
  SECRETS_STORAGE_ENV.databaseUrl,
  SECRETS_STORAGE_FALLBACK_ENV.databaseUrl,
] as const;
export const STORAGE_MODE_ENV = [
  SECRETS_STORAGE_ENV.mode,
  SECRETS_STORAGE_FALLBACK_ENV.mode,
] as const;

export const CANONICAL_SECRETS_RDS_CLUSTER = "hasna-xyz-infra-apps-prod-postgres";
export const CANONICAL_SECRETS_RDS_DATABASE = "secrets";
export const CANONICAL_SECRETS_RDS_SECRET_PATH = "hasna/xyz/opensource/secrets/prod/rds";

export interface CanonicalSecretsRdsConfig {
  cluster: typeof CANONICAL_SECRETS_RDS_CLUSTER;
  database: typeof CANONICAL_SECRETS_RDS_DATABASE;
  runtimeSecretPath: typeof CANONICAL_SECRETS_RDS_SECRET_PATH;
  primaryEnv: typeof SECRETS_STORAGE_ENV.databaseUrl;
  fallbackEnv: typeof SECRETS_STORAGE_FALLBACK_ENV.databaseUrl;
}

export function getCanonicalSecretsRdsConfig(): CanonicalSecretsRdsConfig {
  return {
    cluster: CANONICAL_SECRETS_RDS_CLUSTER,
    database: CANONICAL_SECRETS_RDS_DATABASE,
    runtimeSecretPath: CANONICAL_SECRETS_RDS_SECRET_PATH,
    primaryEnv: SECRETS_STORAGE_ENV.databaseUrl,
    fallbackEnv: SECRETS_STORAGE_FALLBACK_ENV.databaseUrl,
  };
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
  service: "secrets";
  mode: StorageMode;
  local_default: boolean;
  remote_enabled: boolean;
  database: {
    configured: boolean;
    redacted_url: string | null;
  };
  canonical: CanonicalSecretsRdsConfig;
  tables: readonly StorageTable[];
  env: {
    databaseUrl: StorageEnvStatus;
    mode: StorageEnvStatus;
  };
  issues: string[];
  warnings: string[];
  no_network: true;
}

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

export function getStorageDatabaseEnv(): StorageEnv | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (process.env[name]) return { name, deprecated: false };
  }
  return null;
}

function getStorageEnvName(key: SecretsStorageEnvKey): string {
  const canonical = SECRETS_STORAGE_ENV[key];
  const fallback = SECRETS_STORAGE_FALLBACK_ENV[key];
  return process.env[canonical]?.trim() || !process.env[fallback]?.trim() ? canonical : fallback;
}

export function getStorageDatabaseEnvName(): string {
  return getStorageEnvName("databaseUrl");
}

export function getStorageDatabaseUrl(): string | null {
  const env = getStorageDatabaseEnv();
  return env ? process.env[env.name]?.trim() || null : null;
}

export function getStorageMode(): StorageMode {
  return normalizeStorageMode(firstEnv(STORAGE_MODE_ENV))
    ?? (getStorageDatabaseUrl() ? "hybrid" : "local");
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_SECRETS_DATABASE_URL or SECRETS_DATABASE_URL");
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<StorageSyncResult[]> {
  const remote = await getStoragePg();
  try {
    await runStorageMigrations(remote);
    const db = getDb();
    const results: StorageSyncResult[] = [];
    for (const table of resolveTables(options?.tables)) {
      results.push(await pushTable(db, remote, table));
    }
    recordSyncMeta("push", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storagePull(options?: { tables?: string[] }): Promise<StorageSyncResult[]> {
  const remote = await getStoragePg();
  try {
    await runStorageMigrations(remote);
    const db = getDb();
    const results: StorageSyncResult[] = [];
    for (const table of resolveTables(options?.tables)) {
      results.push(await pullTable(remote, db, table));
    }
    recordSyncMeta("pull", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storageSync(options?: { tables?: string[] }): Promise<{ push: StorageSyncResult[]; pull: StorageSyncResult[] }> {
  const push = await storagePush(options);
  const pull = await storagePull(options);
  return { push, pull };
}

export function getStorageSyncMetaAll(): StorageSyncMeta[] {
  const db = getDb();
  ensureSyncMetaTable(db);
  return db
    .prepare("SELECT table_name, last_synced_at, direction FROM _secrets_sync_meta ORDER BY table_name, direction")
    .all() as StorageSyncMeta[];
}

export function getSyncMetaAll(): StorageSyncMeta[] {
  return getStorageSyncMetaAll();
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown secrets sync table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

const SENSITIVE_DATABASE_URL_QUERY_PARAMS = new Set([
  "access_key",
  "access_key_id",
  "api_key",
  "database_url",
  "password",
  "passwd",
  "secret",
  "secret_access_key",
  "secret_key",
  "token",
]);

function redactDatabaseUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    if (url.search) {
      const redacted = new URLSearchParams();
      for (const [key] of url.searchParams) {
        const normalized = key.toLowerCase();
        if (SENSITIVE_DATABASE_URL_QUERY_PARAMS.has(normalized)) continue;
        redacted.append(key, "***");
      }
      url.search = redacted.toString();
    }
    return url.toString();
  } catch {
    return value.replace(/:[^:@/]+@/, ":***@").replace(/\?.+$/, "?***");
  }
}

function storageEnvStatus(key: SecretsStorageEnvKey): StorageEnvStatus {
  const activeName = getStorageEnvName(key);
  return {
    name: SECRETS_STORAGE_ENV[key],
    active_name: activeName,
    configured: Boolean(process.env[activeName]?.trim()),
  };
}

export function getStorageStatus(): NativeStorageStatus {
  const mode = getStorageMode();
  const databaseUrl = getStorageDatabaseUrl();
  const issues: string[] = [];
  if ((mode === "remote" || mode === "hybrid") && !databaseUrl) {
    issues.push(`Missing ${SECRETS_STORAGE_ENV.databaseUrl}`);
  }

  return {
    ok: issues.length === 0,
    service: "secrets",
    mode,
    local_default: mode === "local",
    remote_enabled: mode === "remote" || mode === "hybrid",
    database: {
      configured: Boolean(databaseUrl),
      redacted_url: redactDatabaseUrl(databaseUrl),
    },
    canonical: getCanonicalSecretsRdsConfig(),
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

export const getSecretsStorageStatus = getStorageStatus;

async function pushTable(db: Database, remote: PgAdapterAsync, table: StorageTable): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
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

async function pullTable(remote: PgAdapterAsync, db: Database, table: StorageTable): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
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
  const whereClause = updateColumns.includes("updated_at")
    ? ` WHERE ${quoteIdent(table)}.${quoteIdent("updated_at")} IS NULL OR EXCLUDED.${quoteIdent("updated_at")} >= ${quoteIdent(table)}.${quoteIdent("updated_at")}`
    : "";

  for (const row of rows) {
    await remote.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
       ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}${whereClause}`,
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
  const whereClause = updateColumns.includes("updated_at")
    ? ` WHERE ${quoteIdent(table)}.${quoteIdent("updated_at")} IS NULL OR excluded.${quoteIdent("updated_at")} >= ${quoteIdent(table)}.${quoteIdent("updated_at")}`
    : "";
  const statement = db.prepare(
    `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
     ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}${whereClause}`,
  );
  const insert = db.transaction((batch: Row[]) => {
    for (const row of batch) {
      statement.run(...columns.map((column) => coerceForSqlite(row[column])));
    }
  });
  insert(rows);
  return rows.length;
}

function recordSyncMeta(direction: "push" | "pull", results: StorageSyncResult[]): void {
  const db = getDb();
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.errors.length > 0) continue;
    db.prepare(`
      INSERT INTO _secrets_sync_meta (table_name, last_synced_at, direction)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
    `).run(result.table, now, direction);
  }
}

function ensureSyncMetaTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _secrets_sync_meta (
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
