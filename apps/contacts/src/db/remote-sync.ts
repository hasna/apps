import type { ContactsDatabase } from "./database.js";
import { getDatabase } from "./database.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const CONTACTS_REMOTE_TABLES = [
  "companies",
  "contacts",
  "tags",
  "contact_tags",
  "company_tags",
  "emails",
  "phones",
  "addresses",
  "social_profiles",
  "contact_relationships",
  "activity_log",
  "webhooks",
  "groups",
  "contact_groups",
  "company_groups",
  "company_relationships",
  "contact_projects",
  "contact_notes",
  "org_members",
  "vendor_communications",
  "contact_tasks",
  "applications",
  "deals",
  "events",
  "contact_field_history",
  "job_history",
  "contact_learnings",
  "contact_locks",
  "contact_agent_activity",
  "contact_identities",
  "contact_field_confidence",
  "org_chart_edges",
  "deal_contact_roles",
  "contact_embeddings",
  "contact_documents",
  "contact_health",
  "feedback",
  "audiences",
  "contact_consent",
  "contact_suppressions",
  "_contacts_tombstones",
] as const;

type RemoteTable = (typeof CONTACTS_REMOTE_TABLES)[number];
type Row = Record<string, unknown>;

export const CONTACTS_REMOTE_SENSITIVE_TABLES = [
  "webhooks",
  "contact_documents",
  "contact_health",
] as const satisfies readonly RemoteTable[];

export const CONTACTS_REMOTE_DEFAULT_TABLES = CONTACTS_REMOTE_TABLES.filter(
  (table) => !(CONTACTS_REMOTE_SENSITIVE_TABLES as readonly string[]).includes(table)
) as RemoteTable[];

export const CONTACTS_REMOTE_CONFLICT_KEYS: Record<RemoteTable, string[]> = {
  companies: ["id"],
  contacts: ["id"],
  tags: ["id"],
  contact_tags: ["contact_id", "tag_id"],
  company_tags: ["company_id", "tag_id"],
  emails: ["id"],
  phones: ["id"],
  addresses: ["id"],
  social_profiles: ["id"],
  contact_relationships: ["id"],
  activity_log: ["id"],
  webhooks: ["id"],
  groups: ["id"],
  contact_groups: ["contact_id", "group_id"],
  company_groups: ["company_id", "group_id"],
  company_relationships: ["id"],
  contact_projects: ["contact_id", "project_id"],
  contact_notes: ["id"],
  org_members: ["id"],
  vendor_communications: ["id"],
  contact_tasks: ["id"],
  applications: ["id"],
  deals: ["id"],
  events: ["id"],
  contact_field_history: ["id"],
  job_history: ["id"],
  contact_learnings: ["id"],
  contact_locks: ["id"],
  contact_agent_activity: ["id"],
  contact_identities: ["id"],
  contact_field_confidence: ["id"],
  org_chart_edges: ["id"],
  deal_contact_roles: ["id"],
  contact_embeddings: ["contact_id"],
  contact_documents: ["id"],
  contact_health: ["id"],
  feedback: ["id"],
  audiences: ["id"],
  contact_consent: ["contact_id", "channel"],
  contact_suppressions: ["channel", "address"],
  _contacts_tombstones: ["table_name", "row_id"],
};

export const CONTACTS_REMOTE_DELETABLE_TABLES = ["contacts", "companies", "tags"] as const;
type ContactsRemoteDeletableTable = (typeof CONTACTS_REMOTE_DELETABLE_TABLES)[number];

export interface RemoteTombstone {
  table_name: ContactsRemoteDeletableTable;
  row_id: string;
  deleted_at: string;
  actor: string | null;
  reason: string | null;
}

export const CONTACTS_REMOTE_ENV = [
  "HASNA_CONTACTS_POSTGRES_URL",
  "OPEN_CONTACTS_POSTGRES_URL",
  "CONTACTS_POSTGRES_URL",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
] as const;

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

export class ContactsRemoteSyncError extends Error {
  constructor(
    message: string,
    readonly results: SyncResult[],
  ) {
    super(message);
    this.name = "ContactsRemoteSyncError";
  }
}

export function getRemoteDatabaseUrl(): string | null {
  for (const name of CONTACTS_REMOTE_ENV) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

export async function getRemotePg(): Promise<PgAdapterAsync> {
  const url = getRemoteDatabaseUrl();
  if (!url) throw new Error(`Missing contacts remote database URL. Set one of: ${CONTACTS_REMOTE_ENV.join(", ")}`);
  return new PgAdapterAsync(url);
}

export async function runRemoteMigrations(remote: PgAdapterAsync): Promise<void> {
  await remote.run("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function pushRemote(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getRemotePg();
  const db = getDatabase();
  try {
    await runRemoteMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of resolveRemoteTables(options?.tables)) results.push(await pushTable(db, remote, table));
    recordSyncMeta(db, "push", results);
    throwIfSyncErrors("push", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function pullRemote(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getRemotePg();
  const db = getDatabase();
  try {
    await runRemoteMigrations(remote);
    const results: SyncResult[] = [];
    for (const table of resolveRemoteTables(options?.tables)) results.push(await pullTable(remote, db, table));
    applyRemoteTombstones(db);
    recordSyncMeta(db, "pull", results);
    throwIfSyncErrors("pull", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function syncRemote(options?: { tables?: string[] }): Promise<{ pull: SyncResult[]; push: SyncResult[] }> {
  const pull = await pullRemote(options);
  const push = await pushRemote(options);
  return { pull, push };
}

export function getSyncMetaAll(): SyncMeta[] {
  const db = getDatabase();
  ensureSyncMetaTable(db);
  return db.query("SELECT table_name, last_synced_at, direction FROM _contacts_sync_meta ORDER BY table_name, direction").all() as SyncMeta[];
}

export function getRemoteStatus() {
  return {
    configured: Boolean(getRemoteDatabaseUrl()),
    env: CONTACTS_REMOTE_ENV,
    default_tables: CONTACTS_REMOTE_DEFAULT_TABLES,
    sensitive_tables: CONTACTS_REMOTE_SENSITIVE_TABLES,
    tables: CONTACTS_REMOTE_TABLES,
    sync: getSyncMetaAll(),
  };
}

export function resolveRemoteTables(tables?: string[]): RemoteTable[] {
  if (!tables || tables.length === 0) return [...CONTACTS_REMOTE_DEFAULT_TABLES];
  const allowed = new Set<string>(CONTACTS_REMOTE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown contacts sync table(s): ${invalid.join(", ")}`);
  const sensitiveRequested = requested.filter((table) => (CONTACTS_REMOTE_SENSITIVE_TABLES as readonly string[]).includes(table));
  if (sensitiveRequested.length > 0 && process.env["HASNA_CONTACTS_ALLOW_SENSITIVE_SYNC"] !== "1") {
    throw new Error(
      `Sensitive contacts sync table(s) require HASNA_CONTACTS_ALLOW_SENSITIVE_SYNC=1: ${sensitiveRequested.join(", ")}`
    );
  }
  return requested as RemoteTable[];
}

export function ensureTombstoneTable(db: ContactsDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _contacts_tombstones (
      table_name TEXT NOT NULL CHECK(table_name IN ('contacts','companies','tags')),
      row_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT,
      reason TEXT,
      PRIMARY KEY (table_name, row_id)
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_tombstones_deleted_at ON _contacts_tombstones(deleted_at);
  `);
}

export function recordRemoteTombstone(
  table: ContactsRemoteDeletableTable,
  rowId: string,
  options?: { actor?: string; reason?: string; db?: ContactsDatabase },
): void {
  const db = options?.db ?? getDatabase();
  ensureTombstoneTable(db);
  db.run(
    `INSERT INTO _contacts_tombstones (table_name, row_id, deleted_at, actor, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(table_name, row_id) DO UPDATE SET
       deleted_at = excluded.deleted_at,
       actor = excluded.actor,
       reason = excluded.reason`,
    [table, rowId, new Date().toISOString(), options?.actor ?? "local", options?.reason ?? null],
  );
}

export function applyRemoteTombstones(db: ContactsDatabase = getDatabase()): number {
  ensureTombstoneTable(db);
  const rows = db.query(
    `SELECT table_name, row_id, deleted_at, actor, reason FROM _contacts_tombstones ORDER BY deleted_at ASC`
  ).all() as RemoteTombstone[];
  let applied = 0;
  for (const row of rows) {
    if (!(CONTACTS_REMOTE_DELETABLE_TABLES as readonly string[]).includes(row.table_name)) continue;
    const columns = db.query(`PRAGMA table_info(${quoteIdent(row.table_name)})`).all() as Array<{ name: string }>;
    const hasUpdatedAt = columns.some((column) => column.name === "updated_at");
    const existing = db.query(
      `SELECT ${hasUpdatedAt ? "updated_at" : "id"} FROM ${quoteIdent(row.table_name)} WHERE id = ?`
    ).get(row.row_id) as { updated_at?: string } | null;
    if (!existing) continue;
    if (existing.updated_at && row.deleted_at && isTimestampAfter(existing.updated_at, row.deleted_at)) continue;
    db.run(`DELETE FROM ${quoteIdent(row.table_name)} WHERE id = ?`, [row.row_id]);
    applied++;
  }
  return applied;
}

function isTimestampAfter(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime > rightTime;
  return left > right;
}

async function pushTable(db: ContactsDatabase, remote: PgAdapterAsync, table: RemoteTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
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

async function pullTable(remote: PgAdapterAsync, db: ContactsDatabase, table: RemoteTable): Promise<SyncResult> {
  const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    const rows = (await remote.all(`SELECT * FROM ${quoteIdent(table)}`)) as Row[];
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
  const rows = (await remote.all(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
    table,
  )) as Array<{ column_name: string; data_type: string }>;
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}

function filterRemoteColumns(remoteColumns: Map<string, string>, columns: string[]): string[] {
  if (remoteColumns.size === 0) return columns;
  return columns.filter((column) => remoteColumns.has(column));
}

function filterLocalColumns(db: ContactsDatabase, table: string, columns: string[]): string[] {
  const rows = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
  const allowed = new Set(rows.map((row) => row.name));
  return columns.filter((column) => allowed.has(column));
}

async function upsertPg(remote: PgAdapterAsync, table: RemoteTable, columns: string[], rows: Row[], remoteColumns: Map<string, string>): Promise<number> {
  if (columns.length === 0) return 0;
  const primaryKeys = CONTACTS_REMOTE_CONFLICT_KEYS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0]!;
  const setClause = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")
    : `${quoteIdent(fallbackKey)} = EXCLUDED.${quoteIdent(fallbackKey)}`;
  const whereClause = conflictWhereClause(table, columns, "EXCLUDED");
  for (const row of rows) {
    await remote.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders}) ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}${whereClause}`,
      columns.map((column) => toPostgresValue(row[column], remoteColumns.get(column)))
    );
  }
  return rows.length;
}

function upsertSqlite(db: ContactsDatabase, table: RemoteTable, columns: string[], rows: Row[]): number {
  if (columns.length === 0) return 0;
  const primaryKeys = CONTACTS_REMOTE_CONFLICT_KEYS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0]!;
  const setClause = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(", ")
    : `${quoteIdent(fallbackKey)} = excluded.${quoteIdent(fallbackKey)}`;
  const whereClause = conflictWhereClause(table, columns, "excluded");
  const statement = db.prepare(
    `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders}) ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}${whereClause}`
  );
  for (const row of rows) {
    const values = columns.map((column) => normalizeSqliteSyncValue(row[column])) as any[];
    statement.run(...values);
  }
  return rows.length;
}

function conflictWhereClause(table: RemoteTable, columns: string[], incomingAlias: "EXCLUDED" | "excluded"): string {
  const timestampColumn = columns.includes("updated_at")
    ? "updated_at"
    : columns.includes("created_at")
      ? "created_at"
      : null;

  if (!timestampColumn) return "";

  const existing = `${quoteIdent(table)}.${quoteIdent(timestampColumn)}`;
  const incoming = `${incomingAlias}.${quoteIdent(timestampColumn)}`;
  return ` WHERE ${existing} IS NULL OR ${incoming} IS NULL OR ${incoming} >= ${existing}`;
}

function toPostgresValue(value: unknown, dataType?: string): unknown {
  if (value === undefined) return null;
  if (dataType === "boolean") {
    if (value === null) return null;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return !["0", "false", "no", ""].includes(value.toLowerCase());
    return Boolean(value);
  }
  return value;
}

export function normalizeSqliteSyncValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function ensureSyncMetaTable(db: ContactsDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _contacts_sync_meta (
      table_name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('push','pull')),
      last_synced_at TEXT NOT NULL,
      PRIMARY KEY (table_name, direction)
    )
  `);
}

function recordSyncMeta(db: ContactsDatabase, direction: "push" | "pull", results: SyncResult[]): void {
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO _contacts_sync_meta (table_name, direction, last_synced_at)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
  `);
  for (const result of results) {
    if (result.errors.length === 0) statement.run(result.table, direction, now);
  }
}

function throwIfSyncErrors(operation: string, results: SyncResult[]): void {
  const failures = results.filter((result) => result.errors.length > 0);
  if (failures.length === 0) return;
  const details = failures.map((result) => `${result.table}: ${result.errors.join("; ")}`).join("; ");
  throw new ContactsRemoteSyncError(`Contacts remote ${operation} failed for ${failures.length} table(s): ${details}`, results);
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
