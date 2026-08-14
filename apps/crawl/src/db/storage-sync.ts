import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { getDataDir, getDb } from "./database.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export const STORAGE_TABLES = [
  "crawls",
  "pages",
  "page_versions",
  "webhooks",
  "webhook_deliveries",
  "api_keys",
  "usage_events",
  "feedback",
] as const;

type StorageTable = (typeof STORAGE_TABLES)[number];
type Row = Record<string, unknown>;
export type StorageMode = "local" | "hybrid" | "remote";

const DATABASE_ENV_NAMES = [
  { name: "HASNA_CRAWL_DATABASE_URL", deprecated: false },
  { name: "CRAWL_DATABASE_URL", deprecated: false },
] as const;

const MODE_ENV_NAMES = [
  { name: "HASNA_CRAWL_STORAGE_MODE", deprecated: false },
  { name: "CRAWL_STORAGE_MODE", deprecated: false },
] as const;

const S3_BUCKET_ENV_NAMES = ["HASNA_CRAWL_S3_BUCKET"] as const;
const S3_PREFIX_ENV_NAMES = ["HASNA_CRAWL_S3_PREFIX"] as const;
const S3_REGION_ENV_NAMES = ["HASNA_CRAWL_AWS_REGION", "AWS_REGION", "S3_REGION"] as const;
const S3_ENDPOINT_ENV_NAMES = ["HASNA_CRAWL_S3_ENDPOINT", "AWS_ENDPOINT", "S3_ENDPOINT"] as const;

const PRIMARY_KEYS: Record<StorageTable, string[]> = {
  crawls: ["id"],
  pages: ["id"],
  page_versions: ["id"],
  webhooks: ["id"],
  webhook_deliveries: ["id"],
  api_keys: ["id"],
  usage_events: ["id"],
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

export interface StorageS3Config {
  bucket: string;
  prefix: string;
  region: string | null;
  endpoint: string | null;
}

export interface StorageS3Status {
  configured: boolean;
  bucket: string | null;
  prefix: string;
  region: string | null;
  endpoint: string | null;
  env: {
    bucket: readonly string[];
    prefix: readonly string[];
    region: readonly string[];
    endpoint: readonly string[];
  };
}

export interface ArtifactSyncResult {
  direction: "upload" | "download";
  configured: boolean;
  bucket: string | null;
  prefix: string;
  filesRead: number;
  filesWritten: number;
  bytesWritten: number;
  errors: string[];
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readFirstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = readEnv(name);
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

export function getStorageDatabaseUrl(): string | null {
  const env = getStorageDatabaseEnv();
  return env ? readEnv(env.name) : null;
}

function normalizeStorageMode(value: string): StorageMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "hybrid" || normalized === "remote") {
    return normalized;
  }
  throw new Error(`Unknown crawl storage mode: ${value}`);
}

export function getStorageMode(): StorageMode {
  for (const env of MODE_ENV_NAMES) {
    const value = readEnv(env.name);
    if (value) return normalizeStorageMode(value);
  }
  return getStorageDatabaseUrl() ? "hybrid" : "local";
}

export function getStorageStatus(): {
  configured: boolean;
  mode: StorageMode;
  env: string[];
  deprecatedEnv: string[];
      activeEnv: string | null;
      deprecatedActiveEnv: boolean;
      tables: readonly StorageTable[];
      s3: StorageS3Status;
      sync: SyncMeta[];
} {
  const activeEnv = getStorageDatabaseEnv();
  return {
    configured: Boolean(activeEnv),
    mode: getStorageMode(),
    env: DATABASE_ENV_NAMES.filter((env) => !env.deprecated).map((env) => env.name),
    deprecatedEnv: DATABASE_ENV_NAMES.filter((env) => env.deprecated).map((env) => env.name),
    activeEnv: activeEnv?.name ?? null,
    deprecatedActiveEnv: activeEnv?.deprecated ?? false,
    tables: STORAGE_TABLES,
    s3: getStorageS3Status(),
    sync: getSyncMetaAll(),
  };
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_CRAWL_DATABASE_URL or CRAWL_DATABASE_URL");
  }
  return new PgAdapterAsync(url);
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const sql of PG_MIGRATIONS) await remote.run(sql);
}

export async function storagePush(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  try {
    await runStorageMigrations(remote);
    const db = getDb();
    const results: SyncResult[] = [];
    for (const table of parseStorageTables(options?.tables)) {
      results.push(await pushTable(db, remote, table));
    }
    recordSyncMeta("push", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storagePull(options?: { tables?: string[] }): Promise<SyncResult[]> {
  const remote = await getStoragePg();
  try {
    await runStorageMigrations(remote);
    const db = getDb();
    const results: SyncResult[] = [];
    for (const table of parseStorageTables(options?.tables)) {
      results.push(await pullTable(remote, db, table));
    }
    recordSyncMeta("pull", results);
    return results;
  } finally {
    await remote.close();
  }
}

export async function storageSync(options?: { tables?: string[] }): Promise<{ push: SyncResult[]; pull: SyncResult[] }> {
  const push = await storagePush(options);
  const pull = await storagePull(options);
  return { push, pull };
}

export function getSyncMetaAll(): SyncMeta[] {
  const db = getDb();
  ensureSyncMetaTable(db);
  return db
    .prepare("SELECT table_name, last_synced_at, direction FROM _crawl_sync_meta ORDER BY table_name, direction")
    .all() as SyncMeta[];
}

export function parseStorageTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown crawl sync table(s): ${invalid.join(", ")}`);
  return requested as StorageTable[];
}

export const resolveTables = parseStorageTables;

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
  const whereClause = updateColumns.includes("updated_at")
    ? ` WHERE ${quoteIdent(table)}.${quoteIdent("updated_at")} IS NULL OR EXCLUDED.${quoteIdent("updated_at")} >= ${quoteIdent(table)}.${quoteIdent("updated_at")}`
    : "";

  for (const row of rows) {
    await remote.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
       ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}${whereClause}`,
      ...columns.map((column) => coerceForPg(table, column, row[column])),
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

function recordSyncMeta(direction: "push" | "pull", results: SyncResult[]): void {
  const db = getDb();
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.errors.length > 0) continue;
    db.prepare(`
      INSERT INTO _crawl_sync_meta (table_name, last_synced_at, direction)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
    `).run(result.table, now, direction);
  }
}

function ensureSyncMetaTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _crawl_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}

export function getStorageS3Config(): StorageS3Config | null {
  const bucket = readFirstEnv(S3_BUCKET_ENV_NAMES);
  if (!bucket) return null;
  return {
    bucket,
    prefix: normalizeS3Prefix(readFirstEnv(S3_PREFIX_ENV_NAMES) ?? "open-crawl"),
    region: readFirstEnv(S3_REGION_ENV_NAMES),
    endpoint: readFirstEnv(S3_ENDPOINT_ENV_NAMES),
  };
}

export function getStorageS3Status(): StorageS3Status {
  const config = getStorageS3Config();
  return {
    configured: Boolean(config),
    bucket: config?.bucket ?? null,
    prefix: config?.prefix ?? "open-crawl",
    region: config?.region ?? null,
    endpoint: config?.endpoint ?? null,
    env: {
      bucket: S3_BUCKET_ENV_NAMES,
      prefix: S3_PREFIX_ENV_NAMES,
      region: S3_REGION_ENV_NAMES,
      endpoint: S3_ENDPOINT_ENV_NAMES,
    },
  };
}

export async function storageArtifactsUpload(options: { crawlId?: string; pageId?: string } = {}): Promise<ArtifactSyncResult> {
  const config = getStorageS3Config();
  const result = artifactResult("upload", config);
  if (!config) {
    result.errors.push("Missing HASNA_CRAWL_S3_BUCKET");
    return result;
  }

  const client = createS3Client(config);
  for (const artifact of listLocalScreenshotArtifacts(config, options)) {
    result.filesRead += 1;
    try {
      const written = await client.write(artifact.key, Bun.file(artifact.localPath), { type: "image/png" });
      result.filesWritten += 1;
      result.bytesWritten += written;
    } catch (error) {
      result.errors.push(`${artifact.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export async function storageArtifactsDownload(options: { crawlId?: string; pageId?: string } = {}): Promise<ArtifactSyncResult> {
  const config = getStorageS3Config();
  const result = artifactResult("download", config);
  if (!config) {
    result.errors.push("Missing HASNA_CRAWL_S3_BUCKET");
    return result;
  }

  const client = createS3Client(config);
  const listPrefix = screenshotKeyPrefix(config, options.crawlId);
  let continuationToken: string | undefined;
  do {
    const listed = await client.list({ prefix: listPrefix, continuationToken, maxKeys: 1000 });
    for (const object of listed.contents ?? []) {
      if (options.pageId && !object.key.endsWith(`/${options.pageId}.png`)) continue;
      result.filesRead += 1;
      const localPath = localPathForScreenshotKey(config, object.key);
      try {
        mkdirSync(dirname(localPath), { recursive: true });
        const written = await Bun.write(localPath, client.file(object.key));
        result.filesWritten += 1;
        result.bytesWritten += written;
      } catch (error) {
        result.errors.push(`${object.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    continuationToken = listed.nextContinuationToken;
  } while (continuationToken);

  return result;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function createS3Client(config: StorageS3Config): Bun.S3Client {
  return new Bun.S3Client({
    bucket: config.bucket,
    region: config.region ?? undefined,
    endpoint: config.endpoint ?? undefined,
  });
}

function artifactResult(direction: ArtifactSyncResult["direction"], config: StorageS3Config | null): ArtifactSyncResult {
  return {
    direction,
    configured: Boolean(config),
    bucket: config?.bucket ?? null,
    prefix: config?.prefix ?? "open-crawl",
    filesRead: 0,
    filesWritten: 0,
    bytesWritten: 0,
    errors: [],
  };
}

function listLocalScreenshotArtifacts(
  config: StorageS3Config,
  options: { crawlId?: string; pageId?: string },
): Array<{ localPath: string; key: string }> {
  const root = screenshotRoot(options.crawlId);
  if (!existsSync(root)) return [];
  const files = listFiles(root).filter((file) => {
    if (!file.endsWith(".png")) return false;
    return options.pageId ? file.endsWith(`${sep}${options.pageId}.png`) : true;
  });
  return files.map((localPath) => ({
    localPath,
    key: joinS3Key(config.prefix, "screenshots", relative(screenshotRoot(), localPath).split(sep).join("/")),
  }));
}

function listFiles(root: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) entries.push(...listFiles(path));
    else if (stats.isFile()) entries.push(path);
  }
  return entries;
}

function localPathForScreenshotKey(config: StorageS3Config, key: string): string {
  const prefix = screenshotKeyPrefix(config);
  const relativeKey = key.startsWith(prefix) ? key.slice(prefix.length).replace(/^\/+/, "") : key;
  return join(screenshotRoot(), ...relativeKey.split("/").filter(Boolean));
}

function screenshotRoot(crawlId?: string): string {
  return crawlId ? join(getDataDir(), "screenshots", crawlId) : join(getDataDir(), "screenshots");
}

function screenshotKeyPrefix(config: StorageS3Config, crawlId?: string): string {
  return joinS3Key(config.prefix, "screenshots", crawlId ?? "");
}

function joinS3Key(...parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function normalizeS3Prefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "") || "open-crawl";
}

function coerceForPg(table: StorageTable, column: string, value: unknown): unknown {
  if (value === undefined) return null;
  if ((table === "webhooks" || table === "api_keys") && column === "active") return Boolean(value);
  if (typeof value === "boolean") return value;
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
