import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from '../knowledge-db';
import { ensureKnowledgeWorkspace, resolveScopedWorkspace } from '../workspace';
import { PG_MIGRATIONS } from './pg-migrations';
import { PgAdapterAsync } from './remote-storage';

export const STORAGE_TABLES = [
  'sources',
  'wiki_pages',
  'source_revisions',
  'chunks',
  'chunk_embeddings',
  'wiki_backlinks',
  'citations',
  'knowledge_indexes',
  'runs',
  'run_events',
  'provider_usage',
  'redaction_findings',
  'storage_objects',
  'audit_events',
  'approval_gates',
  'vector_index_entries',
  'reindex_queue',
  'knowledge_machines',
  'knowledge_sync_snapshots',
  'knowledge_sync_changes',
  'knowledge_sync_conflicts',
  'knowledge_sync_table_clocks',
  'knowledge_sync_imports',
] as const;

export const KNOWLEDGE_STORAGE_TABLES = STORAGE_TABLES;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;

export type StorageMode = 'local' | 'hybrid' | 'remote';

export interface StorageEnv {
  name: string;
}

export interface StorageSyncOptions {
  tables?: string[];
  scope?: string;
  cwd?: string;
  remote?: StorageRemoteAdapter;
}

export interface StorageStatusOptions {
  scope?: string;
  cwd?: string;
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
  direction: 'push' | 'pull';
}

export interface StorageRemoteAdapter {
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  all(sql: string, ...params: unknown[]): Promise<unknown[]>;
  close(): Promise<void>;
}

export const KNOWLEDGE_STORAGE_ENV = 'HASNA_KNOWLEDGE_DATABASE_URL';
export const KNOWLEDGE_STORAGE_FALLBACK_ENV = 'KNOWLEDGE_DATABASE_URL';
export const KNOWLEDGE_STORAGE_MODE_ENV = 'HASNA_KNOWLEDGE_STORAGE_MODE';
export const KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV = 'KNOWLEDGE_STORAGE_MODE';
export const STORAGE_DATABASE_ENV = [KNOWLEDGE_STORAGE_ENV, KNOWLEDGE_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [KNOWLEDGE_STORAGE_MODE_ENV, KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV] as const;

export interface StorageStatus {
  configured: boolean;
  mode: StorageMode;
  env: typeof STORAGE_DATABASE_ENV;
  activeEnv: string | null;
  service: 'knowledge';
  scope: string;
  databasePath: string;
  tables: typeof STORAGE_TABLES;
  sync: SyncMeta[];
}

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  sources: ['id'],
  wiki_pages: ['id'],
  source_revisions: ['id'],
  chunks: ['id'],
  chunk_embeddings: ['id'],
  wiki_backlinks: ['from_page_id', 'to_page_id'],
  citations: ['id'],
  knowledge_indexes: ['id'],
  runs: ['id'],
  run_events: ['id'],
  provider_usage: ['id'],
  redaction_findings: ['id'],
  storage_objects: ['id'],
  audit_events: ['id'],
  approval_gates: ['id'],
  vector_index_entries: ['id'],
  reindex_queue: ['id'],
  knowledge_machines: ['machine_id'],
  knowledge_sync_snapshots: ['id'],
  knowledge_sync_changes: ['id'],
  knowledge_sync_conflicts: ['id'],
  knowledge_sync_table_clocks: ['table_name', 'machine_id'],
  knowledge_sync_imports: ['bundle_id'],
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeStorageMode(value: string | undefined): StorageMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'local' || normalized === 'hybrid' || normalized === 'remote') return normalized;
  return undefined;
}

function openScopedDb(options: StorageStatusOptions = {}): { db: Database; path: string; scope: string } {
  const workspace = ensureKnowledgeWorkspace(resolveScopedWorkspace(options.scope, options.cwd).home);
  migrateKnowledgeDb(workspace.knowledgeDbPath);
  return {
    db: openKnowledgeDb(workspace.knowledgeDbPath),
    path: workspace.knowledgeDbPath,
    scope: options.scope ?? 'global',
  };
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
  const mode = normalizeStorageMode(readEnv(KNOWLEDGE_STORAGE_MODE_ENV))
    ?? normalizeStorageMode(readEnv(KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV));
  if (mode) return mode;
  return getStorageDatabaseUrl() ? 'hybrid' : 'local';
}

export async function getStoragePg(): Promise<StorageRemoteAdapter> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error('Missing HASNA_KNOWLEDGE_DATABASE_URL or KNOWLEDGE_DATABASE_URL');
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: StorageRemoteAdapter): Promise<void> {
  await remote.run('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options: StorageSyncOptions = {}): Promise<SyncResult[]> {
  const remote = options.remote ?? await getStoragePg();
  const ownsRemote = !options.remote;
  const local = openScopedDb(options);
  try {
    await runStorageMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of resolveTables(options.tables)) {
      results.push(await pushTable(local.db, remote, table));
    }
    recordSyncMeta(local.db, 'push', results);
    return results;
  } finally {
    local.db.close();
    if (ownsRemote) await remote.close();
  }
}

export async function storagePull(options: StorageSyncOptions = {}): Promise<SyncResult[]> {
  const remote = options.remote ?? await getStoragePg();
  const ownsRemote = !options.remote;
  const local = openScopedDb(options);
  try {
    await runStorageMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of resolveTables(options.tables)) {
      results.push(await pullTable(remote, local.db, table));
    }
    recordSyncMeta(local.db, 'pull', results);
    return results;
  } finally {
    local.db.close();
    if (ownsRemote) await remote.close();
  }
}

export async function storageSync(options: StorageSyncOptions = {}): Promise<{ pull: SyncResult[]; push: SyncResult[] }> {
  const pull = await storagePull(options);
  const push = await storagePush(options);
  return { pull, push };
}

export function getSyncMetaAll(options: StorageStatusOptions = {}): SyncMeta[] {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    return local.db.query('SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction').all() as SyncMeta[];
  } finally {
    local.db.close();
  }
}

export function getStorageStatus(options: StorageStatusOptions = {}): StorageStatus {
  const activeEnv = getStorageDatabaseEnv();
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    const sync = local.db.query('SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction').all() as SyncMeta[];
    return {
      configured: Boolean(activeEnv),
      mode: getStorageMode(),
      env: STORAGE_DATABASE_ENV,
      activeEnv: activeEnv?.name ?? null,
      service: 'knowledge',
      scope: local.scope,
      databasePath: local.path,
      tables: STORAGE_TABLES,
      sync,
    };
  } finally {
    local.db.close();
  }
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown knowledge sync table(s): ${invalid.join(', ')}`);
  return requested as StorageTable[];
}

export function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined {
  if (!value) return undefined;
  return resolveTables(Array.isArray(value) ? value : value.split(','));
}

async function pushTable(db: Database, remote: StorageRemoteAdapter, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!tableExists(db, table)) return result;
    const rows = db.query(`SELECT * FROM ${quoteIdent(table)}`).all() as Row[];
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

async function pullTable(remote: StorageRemoteAdapter, db: Database, table: StorageTable): Promise<SyncResult> {
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

async function getRemoteColumns(remote: StorageRemoteAdapter, table: string): Promise<Map<string, string>> {
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
  const rows = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
  const allowed = new Set(rows.map((row) => row.name));
  return columns.filter((column) => allowed.has(column));
}

async function upsertPg(remote: StorageRemoteAdapter, table: StorageTable, columns: string[], rows: Row[], remoteColumns: Map<string, string>): Promise<number> {
  if (columns.length === 0) return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const columnList = columns.map(quoteIdent).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const keyList = primaryKeys.map(quoteIdent).join(', ');
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0]!;
  const setClause = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')
    : `${quoteIdent(fallbackKey)} = EXCLUDED.${quoteIdent(fallbackKey)}`;

  for (const row of rows) {
    await remote.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
       ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`,
      ...columns.map((column) => coerceForPg(row[column], remoteColumns.get(column))),
    );
  }
  return rows.length;
}

function upsertSqlite(db: Database, table: StorageTable, columns: string[], rows: Row[]): number {
  if (columns.length === 0) return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const columnList = columns.map(quoteIdent).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const keyList = primaryKeys.map(quoteIdent).join(', ');
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0]!;
  const setClause = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')
    : `${quoteIdent(fallbackKey)} = excluded.${quoteIdent(fallbackKey)}`;
  const statement = db.query(
    `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
     ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`,
  );
  const insert = db.transaction((batch: Row[]) => {
    for (const row of batch) statement.run(...columns.map((column) => coerceForSqlite(row[column])));
  });
  insert(rows);
  return rows.length;
}

function recordSyncMeta(db: Database, direction: 'push' | 'pull', results: SyncResult[]): void {
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  const statement = db.query(`
    INSERT INTO _knowledge_sync_meta (table_name, last_synced_at, direction)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
  `);
  for (const result of results) {
    if (result.errors.length > 0) continue;
    statement.run(result.table, now, direction);
  }
}

function ensureSyncMetaTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _knowledge_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function coerceForPg(value: unknown, dataType?: string): unknown {
  if (value === undefined || value === null) return null;
  if (dataType === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function coerceForSqlite(value: unknown): string | number | bigint | boolean | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
