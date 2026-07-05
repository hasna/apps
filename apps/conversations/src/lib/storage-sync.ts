import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Database } from "./db.js";
import { getDb, getDbPath } from "./db.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const SYNC_EXCLUDED = new Set([
  "tasks",
  "task_comments",
  "task_activity",
  "task_dependencies",
  "messages_fts",
  "tasks_fts",
  "_sync_conflicts",
  "_migrations",
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

export const STORAGE_MESSAGE_TABLES = [
  "messages",
  "message_read_receipts",
  "channel_notification_reads",
  "message_mentions",
  "reactions",
] as const;

export const CLOUD_RUNTIME_STORAGE_TABLES = [
  ...DEFAULT_STORAGE_TABLES,
  ...STORAGE_MESSAGE_TABLES,
] as const;

export const STORAGE_LOCAL_ONLY_TABLES = [
  "messages_fts",
  "tasks_fts",
  "_sync_conflicts",
  "_migrations",
  "sqlite_sequence",
  "tasks",
  "task_comments",
  "task_activity",
  "task_dependencies",
] as const;

export const STORAGE_TABLE_GROUPS = {
  metadata: DEFAULT_STORAGE_TABLES,
  "cloud-runtime": CLOUD_RUNTIME_STORAGE_TABLES,
  messages: ["messages"] as const,
  "read-state": ["message_read_receipts", "channel_notification_reads", "message_mentions", "reactions"] as const,
} as const;

type SyncTable = (typeof CLOUD_RUNTIME_STORAGE_TABLES)[number];
type Row = Record<string, unknown>;

const PRIMARY_KEYS: Record<string, string[]> = {
  projects: ["id"],
  channels: ["name"],
  channel_members: ["channel", "agent"],
  channel_subscriptions: ["channel", "agent"],
  agent_presence: ["agent", "project_id"],
  resource_locks: ["resource_type", "resource_id", "lock_type"],
  graph_edges: ["from_type", "from_id", "to_type", "to_id", "relation"],
  feedback: ["id"],
  messages: ["uuid"],
};

const CONFLICT_TABLES = new Set(["channels", "projects", "agent_presence"]);

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
export interface MessageUuidDuplicate { uuid: string; count: number; }
export type StorageRuntimeStatus = "active" | "configured" | "not_configured" | "opt_in" | "local_only" | "manual_gate";
export interface StorageRuntimePath {
  surface: string;
  status: StorageRuntimeStatus;
  local: string;
  remote: string;
  tables: string[];
  gates: string[];
}
export interface StorageReadiness {
  mode: StorageMode;
  configured: boolean;
  canonical: CanonicalConversationsRdsConfig;
  local: {
    sqlite: string;
    attachments: string;
  };
  tableGroups: {
    default: string[];
    cloudRuntime: string[];
    metadata: string[];
    messages: string[];
    readState: string[];
    localOnly: string[];
  };
  runtimePaths: StorageRuntimePath[];
  privacyAndMigrationGates: string[];
}

export const STORAGE_CONFIG_PATH = join(homedir(), ".hasna", "conversations", "storage", "config.json");
export const STORAGE_CONFIG_PATH_ENV = ["HASNA_CONVERSATIONS_STORAGE_CONFIG", "CONVERSATIONS_STORAGE_CONFIG"] as const;
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

export function getStorageConfigPath(): string {
  return firstEnv(STORAGE_CONFIG_PATH_ENV) ?? STORAGE_CONFIG_PATH;
}

export function getStorageReadiness(): StorageReadiness {
  const config = getStorageConfig();
  const configured = Boolean(getStorageDatabaseUrl());
  const canonical = getCanonicalConversationsRdsConfig();
  const attachmentsDir = process.env.CONVERSATIONS_ATTACHMENTS_DIR
    || join(homedir(), ".hasna", "conversations", "attachments");

  return {
    mode: config.mode,
    configured,
    canonical,
    local: {
      sqlite: getDbPath(),
      attachments: attachmentsDir,
    },
    tableGroups: {
      default: [...DEFAULT_STORAGE_TABLES],
      cloudRuntime: [...CLOUD_RUNTIME_STORAGE_TABLES],
      metadata: [...DEFAULT_STORAGE_TABLES],
      messages: [...STORAGE_TABLE_GROUPS.messages],
      readState: [...STORAGE_TABLE_GROUPS["read-state"]],
      localOnly: [...STORAGE_LOCAL_ONLY_TABLES],
    },
    runtimePaths: [
      {
        surface: "local-sqlite",
        status: "active",
        local: "Primary runtime store for CLI, MCP, digest, search, cursors, and read state.",
        remote: "Not used unless a storage command is invoked or a future remote runtime adapter is selected.",
        tables: [...CLOUD_RUNTIME_STORAGE_TABLES],
        gates: [],
      },
      {
        surface: "remote-postgres",
        status: configured ? "configured" : "not_configured",
        local: "Default storage sync keeps local SQLite authoritative for live commands.",
        remote: `PostgreSQL sync uses ${canonical.env} or ${canonical.fallbackEnv}; default table group is metadata only.`,
        tables: [...DEFAULT_STORAGE_TABLES],
        gates: [
          "Set the database URL through the runtime environment or local config without printing the secret value.",
          "Run storage migrate --dry-run before applying remote schema changes.",
        ],
      },
      {
        surface: "messages-and-sessions",
        status: "opt_in",
        local: "Sessions and channel digests are derived from local messages ordered by message id/cursor.",
        remote: "Use --tables cloud-runtime to sync message rows by UUID and keep remote integer ids machine-independent.",
        tables: [...STORAGE_TABLE_GROUPS.messages],
        gates: [
          "Back up local SQLite before first push or pull.",
          "Verify no duplicate message UUIDs before cloud-runtime sync.",
        ],
      },
      {
        surface: "read-state",
        status: "opt_in",
        local: "read_at, per-agent receipts, mentions, reactions, and channel notification reads remain local by default.",
        remote: "cloud-runtime sync translates dependent read-state rows through message UUIDs instead of local integer ids.",
        tables: [...STORAGE_TABLE_GROUPS["read-state"]],
        gates: [
          "Sync messages before dependent read-state rows.",
          "Run digest/read-state regression tests before cutover.",
        ],
      },
      {
        surface: "search-and-digests",
        status: "opt_in",
        local: "SQLite FTS5 remains the default search path and digest cursor source.",
        remote: "PostgreSQL migrations create a tsvector index for remote smoke/search readiness; live search still uses local SQLite unless a remote query adapter is selected.",
        tables: ["messages", "messages_fts"],
        gates: [
          "Rebuild or verify remote search_vector after imports.",
          "Compare digest cursors before switching readers to remote-backed queries.",
        ],
      },
      {
        surface: "attachments",
        status: "local_only",
        local: "Attachment files are copied under the local attachments directory; message rows store local attachment metadata.",
        remote: "cloud-runtime sync omits local attachment metadata and file paths until an approved object-store migration exists.",
        tables: ["messages.attachments"],
        gates: [
          "Create a separate approval task for S3 bucket/object migration before syncing attachment bytes.",
          "Do not expose attachment contents, local attachment paths, or secret values in diagnostics.",
        ],
      },
      {
        surface: "aws-production",
        status: "manual_gate",
        local: "No production AWS mutation is required for local messaging.",
        remote: `Canonical runtime target is ${canonical.cluster}/${canonical.database}; secret path is metadata only.`,
        tables: [],
        gates: [
          "No terraform apply, production migration, secret creation, spend increase, or data migration without explicit approval.",
          "Run a read-only smoke before any write-enabled production command.",
        ],
      },
    ],
    privacyAndMigrationGates: [
      "Never print database URLs, credentials, attachment contents, or secret values.",
      "Keep default sync on metadata tables unless cloud-runtime is requested explicitly.",
      "Back up local SQLite and attachment directories before first cross-machine push/pull.",
      "Run storage status, storage migrate --dry-run, focused digest/search/read-state tests, and a read-only remote smoke before cutover.",
      "Create a follow-up approval task for live AWS mutation, S3 object migration, or production data migration.",
    ],
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
  const configPath = getStorageConfigPath();
  if (!existsSync(configPath)) return { mode: normalizeStorageMode(firstEnv(STORAGE_MODE_ENV)) ?? envMode, rds: {} };
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Partial<StorageConfig>;
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

export function resolveTables(tables?: string[] | string): SyncTable[] {
  const requested = Array.isArray(tables)
    ? tables
    : typeof tables === "string"
      ? tables.split(",")
      : [];
  if (requested.length === 0) return [...DEFAULT_STORAGE_TABLES];
  const allowed = new Set<string>(CLOUD_RUNTIME_STORAGE_TABLES);
  const clean = requested.map((table) => table.trim()).filter(Boolean);
  const expanded: string[] = [];
  for (const table of clean) {
    if (table === "default" || table === "metadata") {
      expanded.push(...DEFAULT_STORAGE_TABLES);
      continue;
    }
    if (table === "cloud-runtime" || table === "cloud_runtime") {
      expanded.push(...CLOUD_RUNTIME_STORAGE_TABLES);
      continue;
    }
    if (table === "read-state" || table === "read_state") {
      expanded.push(...STORAGE_TABLE_GROUPS["read-state"]);
      continue;
    }
    expanded.push(table);
  }
  const invalid = expanded.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unsupported conversations storage table(s): ${invalid.join(", ")}`);
  return [...new Set(expanded)] as SyncTable[];
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

export async function storageSync(options?: { tables?: string[] | string }): Promise<{ pull: StorageSyncResult[]; push: StorageSyncResult[] }> {
  const pull = await storagePull(options);
  const push = await storagePush(options);
  return { pull, push };
}

export async function syncPush(db: Database, remote: PgAdapterAsync, options: { tables: string[] }): Promise<StorageSyncResult[]> {
  const results: StorageSyncResult[] = [];
  for (const table of options.tables) results.push(await pushTable(db, remote, table as SyncTable));
  return results;
}

export async function syncPull(remote: PgAdapterAsync, db: Database, options: { tables: string[] }): Promise<StorageSyncResult[]> {
  const results: StorageSyncResult[] = [];
  for (const table of options.tables) results.push(await pullTable(remote, db, table as SyncTable));
  return results;
}

async function pushTable(db: Database, remote: PgAdapterAsync, table: SyncTable): Promise<StorageSyncResult> {
  if (table === "messages") return pushMessages(db, remote);
  if (table === "message_read_receipts") return pushMessageReadReceipts(db, remote);
  if (table === "channel_notification_reads") return pushChannelNotificationReads(db, remote);
  if (table === "reactions") return pushReactions(db, remote);
  if (table === "message_mentions") return pushMessageMentions(db, remote);

  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, table)) return result;
    const rows = db.all<Row>(`SELECT * FROM ${quoteIdent(table)}`);
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const remoteColumns = await getRemoteColumns(remote, table);
    const columns = filterSyncColumns(table, filterRemoteColumns(remoteColumns, Object.keys(rows[0]!)));
    result.rowsWritten = await upsertPg(remote, table, columns, rows, remoteColumns);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullTable(remote: PgAdapterAsync, db: Database, table: SyncTable): Promise<StorageSyncResult> {
  if (table === "messages") return pullMessages(remote, db);
  if (table === "message_read_receipts") return pullMessageReadReceipts(remote, db);
  if (table === "channel_notification_reads") return pullChannelNotificationReads(remote, db);
  if (table === "reactions") return pullReactions(remote, db);
  if (table === "message_mentions") return pullMessageMentions(remote, db);

  const result: StorageSyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, table)) return result;
    const rows = await remote.all(`SELECT * FROM ${quoteIdent(table)}`) as Row[];
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const columns = filterSyncColumns(table, filterLocalColumns(db, table, Object.keys(rows[0]!)));
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

export function detectConflicts(localRows: Row[], remoteRows: Row[], table: string, pk: string | string[], tsCol = "created_at"): SyncConflict[] {
  const pkColumns = Array.isArray(pk) ? pk : [pk];
  const remoteByPk = new Map(remoteRows.map((row) => [rowKey(row, pkColumns), row]));
  const conflicts: SyncConflict[] = [];
  for (const local of localRows) {
    const key = rowKey(local, pkColumns);
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

export function listDuplicateMessageUuids(db: Database = getDb()): MessageUuidDuplicate[] {
  try {
    if (!sqliteTableExists(db, "messages")) return [];
    return db.all<MessageUuidDuplicate>(`
      SELECT uuid, COUNT(*) AS count
      FROM messages
      WHERE uuid IS NOT NULL AND uuid <> ''
      GROUP BY uuid
      HAVING COUNT(*) > 1
      ORDER BY count DESC, uuid ASC
      LIMIT 20
    `);
  } catch {
    return [];
  }
}

async function pushMessages(db: Database, remote: PgAdapterAsync): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "messages", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "messages")) return result;
    const rows = db.all<Row>("SELECT * FROM messages WHERE uuid IS NOT NULL AND uuid <> ''");
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const remoteColumns = await getRemoteColumns(remote, "messages");
    const columns = filterSyncColumns("messages", filterRemoteColumns(remoteColumns, Object.keys(rows[0]!)));
    result.rowsWritten = await upsertPg(remote, "messages", columns, rows, remoteColumns);
    for (const row of rows) {
      await updateRemoteReplyTo(db, remote, row);
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullMessages(remote: PgAdapterAsync, db: Database): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "messages", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "messages")) return result;
    const rows = await remote.all("SELECT * FROM messages WHERE uuid IS NOT NULL AND uuid <> ''") as Row[];
    result.rowsRead = rows.length;
    if (rows.length === 0) return result;
    const columns = filterSyncColumns("messages", filterLocalColumns(db, "messages", Object.keys(rows[0]!)));
    result.rowsWritten = upsertSqlite(db, "messages", columns, rows);
    for (const row of rows) {
      await updateLocalReplyTo(remote, db, row);
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pushMessageReadReceipts(db: Database, remote: PgAdapterAsync): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "message_read_receipts", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "message_read_receipts") || !sqliteTableExists(db, "messages")) return result;
    const rows = db.all<Row>(`
      SELECT m.uuid AS message_uuid, r.agent, r.read_at
      FROM message_read_receipts r
      INNER JOIN messages m ON m.id = r.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `);
    result.rowsRead = rows.length;
    for (const row of rows) {
      const messageId = await getRemoteMessageId(remote, row.message_uuid);
      if (messageId === null) continue;
      const write = await remote.run(`
        INSERT INTO message_read_receipts (message_id, agent, read_at)
        VALUES (?, ?, ?)
        ON CONFLICT (message_id, agent) DO UPDATE SET
          read_at = GREATEST(message_read_receipts.read_at, EXCLUDED.read_at)
      `, messageId, row.agent, row.read_at);
      result.rowsWritten += write.changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullMessageReadReceipts(remote: PgAdapterAsync, db: Database): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "message_read_receipts", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "message_read_receipts") || !sqliteTableExists(db, "messages")) return result;
    const rows = await remote.all(`
      SELECT m.uuid AS message_uuid, r.agent, r.read_at
      FROM message_read_receipts r
      INNER JOIN messages m ON m.id = r.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `) as Row[];
    result.rowsRead = rows.length;
    const insert = db.prepare(`
      INSERT INTO message_read_receipts (message_id, agent, read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(message_id, agent) DO UPDATE SET
        read_at = max(message_read_receipts.read_at, excluded.read_at)
    `);
    for (const row of rows) {
      const messageId = getLocalMessageId(db, row.message_uuid);
      if (messageId === null) continue;
      result.rowsWritten += insert.run(messageId, row.agent, coerceForSqlite(row.read_at)).changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pushChannelNotificationReads(db: Database, remote: PgAdapterAsync): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "channel_notification_reads", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "channel_notification_reads") || !sqliteTableExists(db, "messages")) return result;
    const rows = db.all<Row>(`
      SELECT m.uuid AS message_uuid, r.agent, r.read_at
      FROM channel_notification_reads r
      INNER JOIN messages m ON m.id = r.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `);
    result.rowsRead = rows.length;
    for (const row of rows) {
      const messageId = await getRemoteMessageId(remote, row.message_uuid);
      if (messageId === null) continue;
      const write = await remote.run(`
        INSERT INTO channel_notification_reads (agent, message_id, read_at)
        VALUES (?, ?, ?)
        ON CONFLICT (agent, message_id) DO UPDATE SET
          read_at = GREATEST(channel_notification_reads.read_at, EXCLUDED.read_at)
      `, row.agent, messageId, row.read_at);
      result.rowsWritten += write.changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullChannelNotificationReads(remote: PgAdapterAsync, db: Database): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "channel_notification_reads", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "channel_notification_reads") || !sqliteTableExists(db, "messages")) return result;
    const rows = await remote.all(`
      SELECT m.uuid AS message_uuid, r.agent, r.read_at
      FROM channel_notification_reads r
      INNER JOIN messages m ON m.id = r.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `) as Row[];
    result.rowsRead = rows.length;
    const insert = db.prepare(`
      INSERT INTO channel_notification_reads (agent, message_id, read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(agent, message_id) DO UPDATE SET
        read_at = max(channel_notification_reads.read_at, excluded.read_at)
    `);
    for (const row of rows) {
      const messageId = getLocalMessageId(db, row.message_uuid);
      if (messageId === null) continue;
      result.rowsWritten += insert.run(row.agent, messageId, coerceForSqlite(row.read_at)).changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pushReactions(db: Database, remote: PgAdapterAsync): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "reactions", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "reactions") || !sqliteTableExists(db, "messages")) return result;
    const rows = db.all<Row>(`
      SELECT m.uuid AS message_uuid, r.agent, r.emoji, r.created_at
      FROM reactions r
      INNER JOIN messages m ON m.id = r.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `);
    result.rowsRead = rows.length;
    for (const row of rows) {
      const messageId = await getRemoteMessageId(remote, row.message_uuid);
      if (messageId === null) continue;
      const write = await remote.run(`
        INSERT INTO reactions (message_id, agent, emoji, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (message_id, agent, emoji) DO UPDATE SET
          created_at = LEAST(reactions.created_at, EXCLUDED.created_at)
      `, messageId, row.agent, row.emoji, row.created_at);
      result.rowsWritten += write.changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullReactions(remote: PgAdapterAsync, db: Database): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "reactions", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "reactions") || !sqliteTableExists(db, "messages")) return result;
    const rows = await remote.all(`
      SELECT m.uuid AS message_uuid, r.agent, r.emoji, r.created_at
      FROM reactions r
      INNER JOIN messages m ON m.id = r.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `) as Row[];
    result.rowsRead = rows.length;
    const insert = db.prepare(`
      INSERT INTO reactions (message_id, agent, emoji, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id, agent, emoji) DO UPDATE SET
        created_at = min(reactions.created_at, excluded.created_at)
    `);
    for (const row of rows) {
      const messageId = getLocalMessageId(db, row.message_uuid);
      if (messageId === null) continue;
      result.rowsWritten += insert.run(messageId, row.agent, row.emoji, coerceForSqlite(row.created_at)).changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pushMessageMentions(db: Database, remote: PgAdapterAsync): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "message_mentions", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "message_mentions") || !sqliteTableExists(db, "messages")) return result;
    const rows = db.all<Row>(`
      SELECT m.uuid AS message_uuid, mm.mentioned_agent, mm.from_agent, mm.channel, mm.notified_at, mm.created_at
      FROM message_mentions mm
      INNER JOIN messages m ON m.id = mm.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `);
    result.rowsRead = rows.length;
    for (const row of rows) {
      const messageId = await getRemoteMessageId(remote, row.message_uuid);
      if (messageId === null) continue;
      const existing = await remote.get(`
        SELECT mm.id
        FROM message_mentions mm
        WHERE mm.message_id = ?
          AND mm.mentioned_agent = ?
          AND mm.from_agent = ?
          AND COALESCE(mm.channel, '') = COALESCE(?, '')
        LIMIT 1
      `, messageId, row.mentioned_agent, row.from_agent, row.channel) as { id?: number | string } | null;
      if (existing?.id !== undefined) {
        if (row.notified_at) {
          const write = await remote.run(
            "UPDATE message_mentions SET notified_at = COALESCE(notified_at, ?) WHERE id = ?",
            row.notified_at,
            existing.id,
          );
          result.rowsWritten += write.changes;
        }
        continue;
      }
      const write = await remote.run(`
        INSERT INTO message_mentions (message_id, mentioned_agent, from_agent, channel, notified_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, messageId, row.mentioned_agent, row.from_agent, row.channel, row.notified_at, row.created_at);
      result.rowsWritten += write.changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function pullMessageMentions(remote: PgAdapterAsync, db: Database): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: "message_mentions", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!sqliteTableExists(db, "message_mentions") || !sqliteTableExists(db, "messages")) return result;
    const rows = await remote.all(`
      SELECT m.uuid AS message_uuid, mm.mentioned_agent, mm.from_agent, mm.channel, mm.notified_at, mm.created_at
      FROM message_mentions mm
      INNER JOIN messages m ON m.id = mm.message_id
      WHERE m.uuid IS NOT NULL AND m.uuid <> ''
    `) as Row[];
    result.rowsRead = rows.length;
    const findMention = db.prepare(`
      SELECT mm.id
      FROM message_mentions mm
      WHERE mm.message_id = ?
        AND mm.mentioned_agent = ?
        AND mm.from_agent = ?
        AND COALESCE(mm.channel, '') = COALESCE(?, '')
      LIMIT 1
    `);
    const updateNotified = db.prepare("UPDATE message_mentions SET notified_at = COALESCE(notified_at, ?) WHERE id = ?");
    const insert = db.prepare(`
      INSERT INTO message_mentions (message_id, mentioned_agent, from_agent, channel, notified_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      const messageId = getLocalMessageId(db, row.message_uuid);
      if (messageId === null) continue;
      const existing = findMention.get(messageId, row.mentioned_agent, row.from_agent, row.channel) as { id?: number } | null;
      if (existing?.id !== undefined) {
        if (row.notified_at) {
          result.rowsWritten += updateNotified.run(coerceForSqlite(row.notified_at), existing.id).changes;
        }
        continue;
      }
      result.rowsWritten += insert.run(
        messageId,
        row.mentioned_agent,
        row.from_agent,
        row.channel,
        coerceForSqlite(row.notified_at),
        coerceForSqlite(row.created_at),
      ).changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

export async function detectAndLogConflicts(local: Database, remote: PgAdapterAsync, table: string): Promise<number> {
  if (!CONFLICT_TABLES.has(table)) return 0;
  const pk = PRIMARY_KEYS[table] ?? [table === "channels" ? "name" : "id"];
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

function filterSyncColumns(table: string, columns: string[]): string[] {
  if (table === "messages") {
    return columns.filter((column) => column !== "id" && column !== "search_vector" && column !== "attachments" && column !== "reply_to");
  }
  if (table === "channel_subscriptions") {
    return columns.filter((column) => column !== "since_message_id");
  }
  return columns;
}

async function updateRemoteReplyTo(db: Database, remote: PgAdapterAsync, row: Row): Promise<void> {
  const messageUuid = row.uuid;
  if (typeof messageUuid !== "string" || messageUuid.length === 0) return;
  const childId = await getRemoteMessageId(remote, messageUuid);
  if (childId === null) return;

  let remoteParentId: number | null = null;
  const localParentId = Number(row.reply_to);
  if (Number.isFinite(localParentId) && localParentId > 0) {
    const parent = db.get<{ uuid: string }>("SELECT uuid FROM messages WHERE id = ?", localParentId);
    if (parent?.uuid) {
      remoteParentId = await getRemoteMessageId(remote, parent.uuid);
    }
  }

  await remote.run("UPDATE messages SET reply_to = ? WHERE id = ?", remoteParentId, childId);
}

async function updateLocalReplyTo(remote: PgAdapterAsync, db: Database, row: Row): Promise<void> {
  const messageUuid = row.uuid;
  if (typeof messageUuid !== "string" || messageUuid.length === 0) return;
  const childId = getLocalMessageId(db, messageUuid);
  if (childId === null) return;

  let localParentId: number | null = null;
  const remoteParentId = Number(row.reply_to);
  if (Number.isFinite(remoteParentId) && remoteParentId > 0) {
    const parent = await remote.get("SELECT uuid FROM messages WHERE id = ?", remoteParentId) as { uuid?: string } | null;
    if (parent?.uuid) {
      localParentId = getLocalMessageId(db, parent.uuid);
    }
  }

  db.run("UPDATE messages SET reply_to = ? WHERE id = ?", localParentId, childId);
}

async function getRemoteMessageId(remote: PgAdapterAsync, messageUuid: unknown): Promise<number | null> {
  if (typeof messageUuid !== "string" || messageUuid.length === 0) return null;
  const row = await remote.get("SELECT id FROM messages WHERE uuid = ?", messageUuid) as { id?: number | string } | null;
  if (!row || row.id === undefined || row.id === null) return null;
  const id = Number(row.id);
  return Number.isFinite(id) ? id : null;
}

function getLocalMessageId(db: Database, messageUuid: unknown): number | null {
  if (typeof messageUuid !== "string" || messageUuid.length === 0) return null;
  const row = db.get<{ id: number }>("SELECT id FROM messages WHERE uuid = ?", messageUuid);
  return row?.id ?? null;
}

function rowKey(row: Row, columns: string[]): string {
  const parts = columns.map((column) => String(row[column] ?? ""));
  if (!parts.every((part) => part.length > 0)) return "";
  if (columns.length === 1) return parts[0]!;
  return columns.map((column, index) => `${column}=${parts[index]}`).join("|");
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
