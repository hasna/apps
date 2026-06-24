import { getDb } from "./index.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = [
  "sessions",
  "action_logs",
  "audit_events",
  "feedback",
  "runtime_goals",
  "workflow_definitions",
  "workflow_runs",
  "run_steps",
  "observations",
  "approvals",
  "resource_leases",
  "artifacts",
  "policy_decisions",
  "model_usage",
] as const;
export const COMPUTER_STORAGE_TABLES = STORAGE_TABLES;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;
export type StorageMode = "local" | "hybrid" | "remote";

export interface StorageEnv {
  name: string;
}

export const COMPUTER_STORAGE_ENV = "HASNA_COMPUTER_DATABASE_URL";
export const COMPUTER_STORAGE_FALLBACK_ENV = "COMPUTER_DATABASE_URL";
export const COMPUTER_STORAGE_MODE_ENV = "HASNA_COMPUTER_STORAGE_MODE";
export const COMPUTER_STORAGE_MODE_FALLBACK_ENV = "COMPUTER_STORAGE_MODE";
export const COMPUTER_STORAGE_SYNC_CONSENT_ENV = "HASNA_COMPUTER_STORAGE_SYNC_CONSENT";
export const COMPUTER_STORAGE_SYNC_CONSENT_FALLBACK_ENV = "COMPUTER_STORAGE_SYNC_CONSENT";
export const COMPUTER_STORAGE_ALLOW_INSECURE_TLS_ENV = "HASNA_COMPUTER_STORAGE_ALLOW_INSECURE_TLS";
export const COMPUTER_STORAGE_ALLOW_INSECURE_TLS_FALLBACK_ENV = "COMPUTER_STORAGE_ALLOW_INSECURE_TLS";
export const STORAGE_DATABASE_ENV = [COMPUTER_STORAGE_ENV, COMPUTER_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [COMPUTER_STORAGE_MODE_ENV, COMPUTER_STORAGE_MODE_FALLBACK_ENV] as const;
export const STORAGE_SYNC_CONSENT_ENV = [COMPUTER_STORAGE_SYNC_CONSENT_ENV, COMPUTER_STORAGE_SYNC_CONSENT_FALLBACK_ENV] as const;
export const STORAGE_INSECURE_TLS_ENV = [COMPUTER_STORAGE_ALLOW_INSECURE_TLS_ENV, COMPUTER_STORAGE_ALLOW_INSECURE_TLS_FALLBACK_ENV] as const;

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  sessions: ["id"],
  action_logs: ["id"],
  audit_events: ["id"],
  feedback: ["id"],
  runtime_goals: ["id"],
  workflow_definitions: ["id"],
  workflow_runs: ["id"],
  run_steps: ["id"],
  observations: ["id"],
  approvals: ["id"],
  resource_leases: ["id"],
  artifacts: ["id"],
  policy_decisions: ["id"],
  model_usage: ["id"],
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

export interface StorageStatus {
  configured: boolean;
  mode: StorageMode;
  env: typeof STORAGE_DATABASE_ENV;
  activeEnv: string | null;
  service: "computer";
  tables: typeof STORAGE_TABLES;
  syncConsent: boolean;
  allowInsecureTls: boolean;
  tls: StorageTlsStatus | null;
  sync: SyncMeta[];
}

export interface StorageTlsStatus {
  local: boolean;
  required: boolean;
  mode: string | null;
  insecure: boolean;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeStorageMode(value: string | undefined): StorageMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "hybrid" || normalized === "remote") return normalized;
  return undefined;
}

function readBooleanEnv(names: readonly string[]): boolean {
  for (const name of names) {
    const value = readEnv(name)?.toLowerCase();
    if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  }
  return false;
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
  const mode = normalizeStorageMode(
    readEnv(COMPUTER_STORAGE_MODE_ENV)
      ?? readEnv(COMPUTER_STORAGE_MODE_FALLBACK_ENV),
  );
  if (mode) return mode;
  return getStorageDatabaseUrl() ? "hybrid" : "local";
}

export function hasStorageSyncConsent(): boolean {
  return readBooleanEnv(STORAGE_SYNC_CONSENT_ENV);
}

export function allowStorageInsecureTls(): boolean {
  return readBooleanEnv(STORAGE_INSECURE_TLS_ENV);
}

export function inspectStorageTls(connectionString: string): StorageTlsStatus {
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase();
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase() ?? null;
  const ssl = url.searchParams.get("ssl")?.toLowerCase() ?? null;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const mode = sslMode ?? (ssl ? `ssl=${ssl}` : null);
  const required = sslMode === "require" || sslMode === "verify-full" || sslMode === "verify-ca" || ssl === "true";
  const insecure = sslMode === "disable" || ssl === "false" || sslMode === "allow" || sslMode === "prefer" || sslMode === "no-verify";
  return { local, required, mode, insecure };
}

export function assertStorageRemoteAllowed(connectionString = getStorageDatabaseUrl()): StorageTlsStatus {
  if (!connectionString) throw new Error("Missing HASNA_COMPUTER_DATABASE_URL");
  if (!hasStorageSyncConsent()) {
    throw new Error(
      `Remote storage sync requires explicit consent. Set ${COMPUTER_STORAGE_SYNC_CONSENT_ENV}=1 to allow push/pull/sync.`
    );
  }

  const tls = inspectStorageTls(connectionString);
  if (!tls.local && tls.insecure) {
    throw new Error(
      `Remote storage PostgreSQL must not use insecure TLS mode (${tls.mode}). Use sslmode=require/verify-full or set up a local dev URL.`
    );
  }
  if (!tls.local && !tls.required) {
    throw new Error("Remote storage PostgreSQL requires TLS. Add sslmode=require or ssl=true to the database URL.");
  }
  return tls;
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  const tls = assertStorageRemoteAllowed(url);
  return new PgAdapterAsync(url!, { allowInsecureTls: tls.local && allowStorageInsecureTls() });
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  const db = getDb();
  try {
    await runStorageMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of resolveTables(options?.tables)) results.push(await pushTable(db, remote, table));
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
    for (const table of resolveTables(options?.tables)) results.push(await pullTable(remote, db, table));
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
  return db.prepare("SELECT table_name, last_synced_at, direction FROM _computer_sync_meta ORDER BY table_name, direction").all() as SyncMeta[];
}

export function getStorageStatus(): StorageStatus {
  const activeEnv = getStorageDatabaseEnv();
  const url = getStorageDatabaseUrl();
  return {
    configured: Boolean(activeEnv),
    mode: getStorageMode(),
    env: STORAGE_DATABASE_ENV,
    activeEnv: activeEnv?.name ?? null,
    service: "computer",
    tables: STORAGE_TABLES,
    syncConsent: hasStorageSyncConsent(),
    allowInsecureTls: allowStorageInsecureTls(),
    tls: url ? inspectStorageTls(url) : null,
    sync: getSyncMetaAll(),
  };
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown computer sync table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

export function filterRowsForSync(table: StorageTable, rows: Row[], direction: "push" | "pull"): Row[] {
  if (table !== "resource_leases") return rows;
  return rows.filter((row) => {
    const resourceId = typeof row["resource_id"] === "string" ? row["resource_id"] : "";
    const status = typeof row["status"] === "string" ? row["status"] : "";
    return !(resourceId.startsWith("local:") && status === "active");
  });
}

async function pushTable(db: any, remote: PgAdapterAsync, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    const rows = filterRowsForSync(table, db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all() as Row[], "push");
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const columns = await filterRemoteColumns(remote, table, Object.keys(rows[0]!));
    result.rowsWritten = await upsertPg(remote, table, columns, rows);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullTable(remote: PgAdapterAsync, db: any, table: StorageTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    const rows = filterRowsForSync(table, await remote.all(`SELECT * FROM ${quoteIdent(table)}`) as Row[], "pull");
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

function filterLocalColumns(db: any, table: string, columns: string[]): string[] {
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

function upsertSqlite(db: any, table: StorageTable, columns: string[], rows: Row[]): number {
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

function recordSyncMeta(db: any, direction: "push" | "pull", results: SyncResult[]): void {
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.errors.length > 0) continue;
    db.prepare(`
      INSERT INTO _computer_sync_meta (table_name, last_synced_at, direction)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
    `).run(result.table, now, direction);
  }
}


function ensureSyncMetaTable(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _computer_sync_meta (
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
