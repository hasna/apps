// ============================================================================
// STORAGE AMENDMENT A1 — CUTOVER GATE-OFF NOTICE
// ----------------------------------------------------------------------------
// This module is the LEGACY bidirectional sync engine (local SQLite <-> remote
// PostgreSQL). Under Storage Amendment A1 the fleet cloud cutover is PURE
// REMOTE: reads AND writes go directly to cloud Postgres, with NO hybrid mode,
// NO sync engine, NO merge/conflict logic. The fleet cutover WILL NOT use any
// of the bidirectional-sync surfaces below.
//
// Symbols marked `CUTOVER: gate off` MUST be disabled/removed by the flip lane
// (the one that routes getDb() to Postgres) before conversations goes remote:
//   - StorageMode "hybrid" (and its acceptance in normalizeStorageMode)
//   - storageSync() / `storage sync` CLI  (pull-then-push round trip)
//   - the _sync_conflicts machinery: detectConflicts / storeConflicts /
//     listConflicts / detectAndLogConflicts / CONFLICT_TABLES / SyncConflict
//   - syncPush/pushTable/upsertPg and syncPull/pullTable/upsertSqlite as a
//     RUNTIME data path (the pg schema helpers here — getStoragePg,
//     runStorageMigrations, listPgTables — remain safe as ops/migration tools).
// See docs/CUTOVER-RUNBOOK.md for the exact flip procedure and gate list.
// ============================================================================
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Database } from "./db.js";
import { getDb } from "./db.js";
import {
  MESSAGE_SYNC_STATE_TABLE,
  MESSAGE_SYNC_TABLES,
  pullMessages,
  pullReceipts,
  pushMessages,
  pushReceipts,
} from "./message-sync.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";
import {
  SYNC_AGENT_TOMBSTONES_TABLE,
  pullAgentTombstones,
  pushAgentTombstones,
} from "./sync-tombstones.js";

// Tables the GENERIC full-table engine below must never touch. `messages` and
// `message_read_receipts` stay in this set: they replicate through the
// uuid-keyed incremental engine in message-sync.ts (per-machine integer ids
// collide fleet-wide, so full-table pk upserts would corrupt them).
// `_sync_agent_tombstones` rides the agent_presence phase via its own
// delete-propagating path in sync-tombstones.ts, never the generic engine.
export const SYNC_EXCLUDED = new Set([
  "messages",
  "reactions",
  "message_read_receipts",
  "message_mentions",
  "channel_notification_reads",
  "tasks",
  "task_comments",
  "task_activity",
  "task_dependencies",
  "messages_fts",
  "tasks_fts",
  "_sync_conflicts",
  "_migrations",
  MESSAGE_SYNC_STATE_TABLE,
  SYNC_AGENT_TOMBSTONES_TABLE,
  "sqlite_sequence",
]);

export const DEFAULT_STORAGE_TABLES = [
  "projects",
  "channels",
  "channel_members",
  "channel_subscriptions",
  "agent_presence",
  "resource_locks",
  "graph_edges",
  "feedback",
] as const;

/** Full default sync surface: legacy pk-upsert tables + the uuid-keyed message engine tables. */
export const ALL_STORAGE_TABLES = [...DEFAULT_STORAGE_TABLES, ...MESSAGE_SYNC_TABLES] as const;

type SyncTable = (typeof DEFAULT_STORAGE_TABLES)[number];
type Row = Record<string, unknown>;

const MESSAGE_SYNC_TABLE_SET = new Set<string>(MESSAGE_SYNC_TABLES);

const PRIMARY_KEYS: Record<SyncTable, string[]> = {
  projects: ["id"],
  channels: ["name"],
  channel_members: ["channel", "agent"],
  channel_subscriptions: ["channel", "agent"],
  agent_presence: ["agent", "project_id"],
  resource_locks: ["resource_type", "resource_id", "lock_type"],
  graph_edges: ["from_type", "from_id", "to_type", "to_id", "relation"],
  feedback: ["id"],
};

const CONFLICT_TABLES = new Set(["channels", "projects", "agent_presence"]);

// CUTOVER: gate off "hybrid". A1 permits only "local" (pre-flip) and "remote"
// (pure cloud). "hybrid" is a bidirectional-sync mode and must be rejected at
// the flip; kept here only so pre-cutover configs still parse.
export type StorageMode = "local" | "remote" | "hybrid";

export const CANONICAL_CONVERSATIONS_RDS_CLUSTER = "hasna-xyz-infra-apps-prod-postgres";
export const CANONICAL_CONVERSATIONS_RDS_DATABASE = "conversations";
export const CANONICAL_CONVERSATIONS_RDS_SECRET_PATH = "hasna/xyz/opensource/conversations/prod/rds";
export const CANONICAL_CONVERSATIONS_DATABASE_ENV = "HASNA_CONVERSATIONS_DATABASE_URL";
export const CONVERSATIONS_DATABASE_FALLBACK_ENV = "CONVERSATIONS_DATABASE_URL";

export interface StorageConfig {
  mode: StorageMode;
  rds: {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    url?: string;
    connectionString?: string;
  };
}

export interface CanonicalConversationsRdsConfig {
  cluster: typeof CANONICAL_CONVERSATIONS_RDS_CLUSTER;
  database: typeof CANONICAL_CONVERSATIONS_RDS_DATABASE;
  runtimeSecretPath: typeof CANONICAL_CONVERSATIONS_RDS_SECRET_PATH;
  env: typeof CANONICAL_CONVERSATIONS_DATABASE_ENV;
  fallbackEnv: typeof CONVERSATIONS_DATABASE_FALLBACK_ENV;
}

export interface StorageSyncResult { table: string; rowsRead: number; rowsWritten: number; errors: string[]; }
export type SyncResult = StorageSyncResult;
export interface SyncConflict { table: string; pk: string; local: Row; remote: Row; }

export const STORAGE_CONFIG_PATH = join(homedir(), ".hasna", "conversations", "storage", "config.json");
export const STORAGE_DATABASE_ENV = [CANONICAL_CONVERSATIONS_DATABASE_ENV, CONVERSATIONS_DATABASE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = ["HASNA_CONVERSATIONS_STORAGE_MODE", "CONVERSATIONS_STORAGE_MODE"] as const;

export function getCanonicalConversationsRdsConfig(): CanonicalConversationsRdsConfig {
  return {
    cluster: CANONICAL_CONVERSATIONS_RDS_CLUSTER,
    database: CANONICAL_CONVERSATIONS_RDS_DATABASE,
    runtimeSecretPath: CANONICAL_CONVERSATIONS_RDS_SECRET_PATH,
    env: CANONICAL_CONVERSATIONS_DATABASE_ENV,
    fallbackEnv: CONVERSATIONS_DATABASE_FALLBACK_ENV,
  };
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

export function getStorageConfig(): StorageConfig {
  const envMode = getStorageDatabaseUrlFromEnv() ? "remote" : "local";
  if (!existsSync(STORAGE_CONFIG_PATH)) return { mode: normalizeStorageMode(firstEnv(STORAGE_MODE_ENV)) ?? envMode, rds: {} };
  try {
    const parsed = JSON.parse(readFileSync(STORAGE_CONFIG_PATH, "utf8")) as Partial<StorageConfig>;
    return {
      mode: normalizeStorageMode(firstEnv(STORAGE_MODE_ENV))
        ?? normalizeStorageMode(parsed.mode)
        ?? "local",
      rds: parsed.rds ?? {},
    };
  } catch {
    return { mode: "local", rds: {} };
  }
}

export function getStorageDatabaseUrl(): string | null {
  const envUrl = getStorageDatabaseUrlFromEnv();
  if (envUrl) return envUrl;
  const config = getStorageConfig();
  if (config.mode === "local") return null;
  if (config.rds.connectionString) return config.rds.connectionString;
  if (config.rds.url) return config.rds.url;
  if (!config.rds.host || !config.rds.username) return null;
  const password = config.rds.password ? `:${encodeURIComponent(config.rds.password)}` : "";
  const port = config.rds.port ?? 5432;
  const database = config.rds.database ?? "conversations";
  return `postgres://${encodeURIComponent(config.rds.username)}${password}@${config.rds.host}:${port}/${database}`;
}

function getStorageDatabaseUrlFromEnv(): string | null {
  return firstEnv(STORAGE_DATABASE_ENV);
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error(
      "Missing HASNA_CONVERSATIONS_DATABASE_URL, CONVERSATIONS_DATABASE_URL, or remote storage RDS config"
    );
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  await remote.run("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export function listSqliteTables(db: Database = getDb()): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name as string);
}

export async function listPgTables(remote: PgAdapterAsync): Promise<string[]> {
  const rows = await remote.all("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename") as Array<{ tablename: string }>;
  return rows.map((row) => row.tablename);
}

export function resolveTables(tables?: string[] | string): string[] {
  const requested = Array.isArray(tables)
    ? tables
    : typeof tables === "string"
      ? tables.split(",")
      : [];
  if (requested.length === 0) return [...ALL_STORAGE_TABLES];
  const allowed = new Set<string>(ALL_STORAGE_TABLES);
  const clean = requested.map((table) => table.trim()).filter(Boolean);
  const invalid = clean.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unsupported conversations storage table(s): ${invalid.join(", ")}`);
  return clean;
}

export async function storagePush(options?: { tables?: string[] | string }): Promise<StorageSyncResult[]> {
  const remote = await getStoragePg();
  const db = getDb();
  try {
    await runStorageMigrations(remote);
    return await syncPush(db, remote, { tables: resolveTables(options?.tables) });
  } finally {
    await remote.close();
  }
}

export async function storagePull(options?: { tables?: string[] | string }): Promise<StorageSyncResult[]> {
  const remote = await getStoragePg();
  const db = getDb();
  try {
    await runStorageMigrations(remote);
    return await syncPull(remote, db, { tables: resolveTables(options?.tables) });
  } finally {
    await remote.close();
  }
}

// CUTOVER: gate off. Bidirectional pull-then-push is forbidden under A1 (pure
// remote). The flip lane must remove this and the `storage sync` CLI command.
export async function storageSync(options?: { tables?: string[] | string }): Promise<{ pull: StorageSyncResult[]; push: StorageSyncResult[] }> {
  const pull = await storagePull(options);
  const push = await storagePush(options);
  return { pull, push };
}

export async function syncPush(db: Database, remote: PgAdapterAsync, options: { tables: string[] }): Promise<StorageSyncResult[]> {
  const results: StorageSyncResult[] = [];
  for (const table of options.tables) {
    if (MESSAGE_SYNC_TABLE_SET.has(table)) continue; // routed below (messages before receipts)
    results.push(await pushTable(db, remote, table as SyncTable));
    // Agent removals must propagate: the generic engine is append-only, so a
    // purge would otherwise be resurrected by the next pull (2026-07-06
    // registry-purge regression). Tombstones ride with agent_presence.
    if (table === "agent_presence") results.push(await pushAgentTombstones(db, remote));
  }
  if (options.tables.includes("messages")) results.push(await pushMessages(db, remote));
  if (options.tables.includes("message_read_receipts")) results.push(await pushReceipts(db, remote));
  return results;
}

export async function syncPull(remote: PgAdapterAsync, db: Database, options: { tables: string[] }): Promise<StorageSyncResult[]> {
  const results: StorageSyncResult[] = [];
  for (const table of options.tables) {
    if (MESSAGE_SYNC_TABLE_SET.has(table)) continue; // routed below (messages before receipts)
    results.push(await pullTable(remote, db, table as SyncTable));
    // Runs AFTER the presence pull so rows the append-only upsert just
    // resurrected are reconciled against tombstones in the same pass.
    if (table === "agent_presence") results.push(await pullAgentTombstones(remote, db));
  }
  if (options.tables.includes("messages")) results.push(await pullMessages(remote, db));
  if (options.tables.includes("message_read_receipts")) results.push(await pullReceipts(remote, db));
  return results;
}

async function pushTable(db: Database, remote: PgAdapterAsync, table: SyncTable): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, table)) return result;
    const rows = db.all<Row>(`SELECT * FROM ${quoteIdent(table)}`);
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

async function pullTable(remote: PgAdapterAsync, db: Database, table: SyncTable): Promise<StorageSyncResult> {
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

function sqliteTableExists(db: Database, table: string): boolean {
  return Boolean(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", table));
}

export function ensureConflictsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sync_conflicts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      table_name TEXT NOT NULL,
      pk TEXT NOT NULL,
      local_row TEXT NOT NULL,
      remote_row TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const columns = new Set(
    db.all<{ name: string }>("PRAGMA table_info(_sync_conflicts)").map((column) => column.name),
  );
  if (!columns.has("resolved")) {
    db.exec("ALTER TABLE _sync_conflicts ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.has("detected_at")) {
    db.exec("ALTER TABLE _sync_conflicts ADD COLUMN detected_at TEXT");
  }
}

export function detectConflicts(localRows: Row[], remoteRows: Row[], table: string, pk: string, tsCol = "created_at"): SyncConflict[] {
  const remoteByPk = new Map(remoteRows.map((row) => [String(row[pk] ?? ""), row]));
  const conflicts: SyncConflict[] = [];
  for (const local of localRows) {
    const key = String(local[pk] ?? "");
    if (!key) continue;
    const remote = remoteByPk.get(key);
    if (!remote) continue;
    if (String(local[tsCol] ?? "") === String(remote[tsCol] ?? "")) continue;
    if (JSON.stringify(local) !== JSON.stringify(remote)) conflicts.push({ table, pk: key, local, remote });
  }
  return conflicts;
}

export function storeConflicts(db: Database, conflicts: SyncConflict[]): void {
  ensureConflictsTable(db);
  const insert = db.prepare(`
    INSERT INTO _sync_conflicts (table_name, pk, local_row, remote_row)
    VALUES (?, ?, ?, ?)
  `);
  for (const conflict of conflicts) {
    insert.run(conflict.table, conflict.pk, JSON.stringify(conflict.local), JSON.stringify(conflict.remote));
  }
}

export function listConflicts(db: Database, options?: { resolved?: boolean }): Row[] {
  ensureConflictsTable(db);
  if (options?.resolved === undefined) return db.all<Row>("SELECT * FROM _sync_conflicts ORDER BY detected_at DESC");
  return db.all<Row>("SELECT * FROM _sync_conflicts WHERE resolved = ? ORDER BY detected_at DESC", options.resolved ? 1 : 0);
}

export async function detectAndLogConflicts(local: Database, remote: PgAdapterAsync, table: string): Promise<number> {
  if (!CONFLICT_TABLES.has(table)) return 0;
  const pk = table === "channels" ? "name" : "id";
  const localRows = local.all<Row>(`SELECT * FROM ${quoteIdent(table)}`);
  const remoteRows = await remote.all(`SELECT * FROM ${quoteIdent(table)}`) as Row[];
  if (localRows.length === 0 || remoteRows.length === 0) return 0;
  const conflicts = detectConflicts(localRows, remoteRows, table, pk, "created_at");
  if (conflicts.length > 0) storeConflicts(local, conflicts);
  return conflicts.length;
}

export function saveFeedback(message: string, email?: string): { id: string; sent: false; error: string } {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO feedback (id, message, email, category, version) VALUES (?, ?, ?, ?, ?)").run(id, message, email ?? null, "general", null);
  return { id, sent: false, error: "Saved locally; remote feedback transport is not configured." };
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
  const rows = db.all<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  const allowed = new Set(rows.map((row) => row.name));
  return columns.filter((column) => allowed.has(column));
}

async function upsertPg(remote: PgAdapterAsync, table: SyncTable, columns: string[], rows: Row[], remoteColumns: Map<string, string>): Promise<number> {
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

function upsertSqlite(db: Database, table: SyncTable, columns: string[], rows: Row[]): number {
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
