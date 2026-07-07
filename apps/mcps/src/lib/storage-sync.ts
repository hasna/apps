import type { Database } from "bun:sqlite";
import pg from "pg";
import type { Pool, PoolConfig } from "pg";
import { getDb } from "./db.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";

export const STORAGE_SYNC_TABLES = [
  "servers",
  "tool_cache",
  "sources",
  "machines",
  "provider_profiles",
  "feedback",
] as const;

export type StorageSyncTable = (typeof STORAGE_SYNC_TABLES)[number];
type Row = Record<string, unknown>;

const PRIMARY_KEYS: Record<StorageSyncTable, string[]> = {
  servers: ["id"],
  tool_cache: ["server_id", "name"],
  sources: ["id"],
  machines: ["id"],
  provider_profiles: ["id"],
  feedback: ["id"],
};

const FRESHNESS_COLUMNS: Partial<Record<StorageSyncTable, string>> = {
  servers: "updated_at",
  tool_cache: "cached_at",
  machines: "updated_at",
  provider_profiles: "updated_at",
};

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

export interface StorageSyncStatus {
  configured: boolean;
  env: {
    primary: "HASNA_MCPS_DATABASE_URL";
    fallback: "MCPS_DATABASE_URL";
    active: "HASNA_MCPS_DATABASE_URL" | "MCPS_DATABASE_URL" | null;
  };
  tables: readonly StorageSyncTable[];
  semantics: {
    runtimeStorage: "local-sqlite";
    remoteRole: "optional-postgres-mirror";
    deletePropagation: false;
    conflictPolicy: "freshness-column-wins-or-preserve-existing";
  };
  sync: StorageSyncMeta[];
}

export type StorageSyncOperationResult = StorageSyncResult[] | {
  push: StorageSyncResult[];
  pull: StorageSyncResult[];
};

export function getRemoteDatabaseUrl(): string | null {
  return resolveDatabaseEnv().value;
}

export function getStorageSyncStatus(): StorageSyncStatus {
  const resolved = resolveDatabaseEnv();
  return {
    configured: Boolean(resolved.value),
    env: {
      primary: "HASNA_MCPS_DATABASE_URL",
      fallback: "MCPS_DATABASE_URL",
      active: resolved.active,
    },
    tables: STORAGE_SYNC_TABLES,
    semantics: {
      runtimeStorage: "local-sqlite",
      remoteRole: "optional-postgres-mirror",
      deletePropagation: false,
      conflictPolicy: "freshness-column-wins-or-preserve-existing",
    },
    sync: getStorageSyncMetaAll(),
  };
}

function resolveDatabaseEnv(): {
  value: string | null;
  active: "HASNA_MCPS_DATABASE_URL" | "MCPS_DATABASE_URL" | null;
} {
  const primary = process.env["HASNA_MCPS_DATABASE_URL"]?.trim();
  if (primary) return { value: primary, active: "HASNA_MCPS_DATABASE_URL" };
  const fallback = process.env["MCPS_DATABASE_URL"]?.trim();
  if (fallback) return { value: fallback, active: "MCPS_DATABASE_URL" };
  return { value: null, active: null };
}

export function shouldUsePostgresSsl(connectionString: string): boolean {
  const params = readConnectionQuery(connectionString);
  const sslValues = params.getAll("ssl").map((value) => value.toLowerCase());
  const sslModeValues = params.getAll("sslmode").map((value) => value.toLowerCase());
  return sslValues.some((value) => ["1", "true", "yes", "on", "require"].includes(value))
    || sslModeValues.some((value) => ["require", "verify-ca", "verify-full"].includes(value));
}

export function buildPostgresPoolConfig(connectionString: string): PoolConfig {
  rejectInsecureAmbientPostgresTls();
  const params = readConnectionQuery(connectionString);
  const sslMode = params.get("sslmode")?.toLowerCase();
  const ssl = params.get("ssl")?.toLowerCase();
  const libpqCompat = ["1", "true", "yes", "on"].includes(params.get("uselibpqcompat")?.toLowerCase() ?? "");
  if (sslMode === "no-verify" || ssl === "no-verify") {
    throw new Error("Unsupported insecure PostgreSQL TLS verification mode");
  }
  if (libpqCompat && ["allow", "prefer", "require"].includes(sslMode ?? "")) {
    throw new Error("Unsupported libpq-compatible PostgreSQL TLS mode without certificate verification");
  }
  const safeConnectionString = stripPostgresSslQueryParams(connectionString);
  return shouldUsePostgresSsl(connectionString)
    ? { connectionString: safeConnectionString, ssl: true }
    : { connectionString: safeConnectionString, ssl: false };
}

function rejectInsecureAmbientPostgresTls(): void {
  const pgSslMode = process.env["PGSSLMODE"]?.trim().toLowerCase();
  if (pgSslMode === "no-verify") {
    throw new Error("Unsupported insecure ambient PGSSLMODE=no-verify");
  }
}

function readConnectionQuery(connectionString: string): URLSearchParams {
  try {
    return new URL(connectionString).searchParams;
  } catch {
    const queryIndex = connectionString.indexOf("?");
    return new URLSearchParams(queryIndex >= 0 ? connectionString.slice(queryIndex + 1) : "");
  }
}

function stripPostgresSslQueryParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    for (const key of ["ssl", "sslmode", "uselibpqcompat"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

function translatePlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => (value === undefined ? null : value));
}

export class PostgresStorageClient {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool(buildPostgresPoolConfig(connectionString));
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount ?? 0 };
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function getRemotePostgresClient(): Promise<PostgresStorageClient> {
  const url = getRemoteDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_MCPS_DATABASE_URL or MCPS_DATABASE_URL");
  }
  return new PostgresStorageClient(url);
}

export async function runStorageMigrations(remote: PostgresStorageClient): Promise<void> {
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<StorageSyncResult[]> {
  const remote = await getRemotePostgresClient();
  try {
    await runStorageMigrations(remote);
    const db = getDb();
    const results: StorageSyncResult[] = [];
    for (const table of resolveStorageSyncTables(options?.tables)) {
      results.push(await pushTable(db, remote, table));
    }
    recordStorageSyncMeta("push", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storagePull(options?: { tables?: string[] }): Promise<StorageSyncResult[]> {
  const remote = await getRemotePostgresClient();
  try {
    await runStorageMigrations(remote);
    const db = getDb();
    const results: StorageSyncResult[] = [];
    for (const table of resolveStorageSyncTables(options?.tables)) {
      results.push(await pullTable(remote, db, table));
    }
    recordStorageSyncMeta("pull", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storageSync(options?: { tables?: string[]; allowPartial?: boolean }): Promise<{
  push: StorageSyncResult[];
  pull: StorageSyncResult[];
}> {
  const push = await storagePush(options);
  if (!options?.allowPartial && collectStorageSyncErrors(push).length > 0) {
    return { push, pull: [] };
  }
  const pull = await storagePull(options);
  return { push, pull };
}

export function collectStorageSyncErrors(result: StorageSyncOperationResult): string[] {
  const rows = Array.isArray(result) ? result : [...result.push, ...result.pull];
  return rows.flatMap((row) => row.errors.map((error) => `${row.table}: ${error}`));
}

export function getStorageSyncMetaAll(): StorageSyncMeta[] {
  const db = getDb();
  ensureStorageSyncMetaTable(db);
  return db
    .prepare("SELECT table_name, last_synced_at, direction FROM _mcps_storage_sync_meta ORDER BY table_name, direction")
    .all() as StorageSyncMeta[];
}

export function resolveStorageSyncTables(tables?: string[]): StorageSyncTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_SYNC_TABLES];
  const allowed = new Set<string>(STORAGE_SYNC_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown mcps storage table(s): ${invalid.join(", ")}`);
  return requested as StorageSyncTable[];
}

async function pushTable(db: Database, remote: PostgresStorageClient, table: StorageSyncTable): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all() as Row[];
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const columns = await filterRemoteColumns(remote, table, Object.keys(rows[0]!));
    result.rowsWritten = await upsertPostgres(remote, table, columns, rows);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullTable(remote: PostgresStorageClient, db: Database, table: StorageSyncTable): Promise<StorageSyncResult> {
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

async function filterRemoteColumns(remote: PostgresStorageClient, table: string, columns: string[]): Promise<string[]> {
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

async function upsertPostgres(remote: PostgresStorageClient, table: StorageSyncTable, columns: string[], rows: Row[]): Promise<number> {
  if (columns.length === 0) return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const freshnessColumn = FRESHNESS_COLUMNS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const conflictClause = buildPostgresConflictClause(table, keyList, updateColumns, freshnessColumn);
  let applied = 0;

  for (const row of rows) {
    const run = await remote.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
       ${conflictClause}`,
      ...columns.map((column) => coerceForPostgres(table, column, row[column])),
    );
    applied += run.changes;
  }
  return applied;
}

function upsertSqlite(db: Database, table: StorageSyncTable, columns: string[], rows: Row[]): number {
  if (columns.length === 0) return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const freshnessColumn = FRESHNESS_COLUMNS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const conflictClause = buildSqliteConflictClause(table, keyList, updateColumns, freshnessColumn);
  const statement = db.prepare(
    `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
     ${conflictClause}`,
  );
  let applied = 0;
  const insert = db.transaction((batch: Row[]) => {
    for (const row of batch) {
      const result = statement.run(...columns.map((column) => coerceForSqlite(row[column]))) as { changes?: number };
      applied += result.changes ?? 0;
    }
  });
  insert(rows);
  return applied;
}

function buildPostgresConflictClause(
  table: StorageSyncTable,
  keyList: string,
  updateColumns: string[],
  freshnessColumn?: string,
): string {
  if (updateColumns.length === 0) return `ON CONFLICT (${keyList}) DO NOTHING`;
  if (!freshnessColumn || !updateColumns.includes(freshnessColumn)) return `ON CONFLICT (${keyList}) DO NOTHING`;
  const setClause = updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ");
  const freshness = quoteIdent(freshnessColumn);
  return `ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}
    WHERE ${quoteIdent(table)}.${freshness} IS NULL OR EXCLUDED.${freshness} >= ${quoteIdent(table)}.${freshness}`;
}

function buildSqliteConflictClause(
  table: StorageSyncTable,
  keyList: string,
  updateColumns: string[],
  freshnessColumn?: string,
): string {
  if (updateColumns.length === 0) return `ON CONFLICT (${keyList}) DO NOTHING`;
  if (!freshnessColumn || !updateColumns.includes(freshnessColumn)) return `ON CONFLICT (${keyList}) DO NOTHING`;
  const setClause = updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(", ");
  const freshness = quoteIdent(freshnessColumn);
  return `ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}
    WHERE ${quoteIdent(table)}.${freshness} IS NULL OR excluded.${freshness} >= ${quoteIdent(table)}.${freshness}`;
}

function recordStorageSyncMeta(direction: "push" | "pull", results: StorageSyncResult[]): void {
  const db = getDb();
  ensureStorageSyncMetaTable(db);
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.errors.length > 0) continue;
    db.prepare(`
      INSERT INTO _mcps_storage_sync_meta (table_name, last_synced_at, direction)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
    `).run(result.table, now, direction);
  }
}

function ensureStorageSyncMetaTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _mcps_storage_sync_meta (
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

function coerceForPostgres(table: StorageSyncTable, column: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (["servers", "sources", "machines", "provider_profiles"].includes(table) && column === "enabled") {
    return Boolean(value);
  }
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
