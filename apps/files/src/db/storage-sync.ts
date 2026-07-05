import { type Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb, getDbPath } from "./database.js";
import { refreshAllFts } from "./files.js";
import { refreshAllFileSearchDocumentFts } from "./file-search-documents.js";
import { getStorageConfig, getStorageConnectionString, getStorageDatabaseUrlEnvName } from "./storage-config.js";
import { PgAdapterAsync } from "./remote-storage.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { getEvidenceStorageOptions } from "../lib/evidence.js";

type Row = Record<string, unknown>;

export const DEFAULT_GOOGLE_DRIVE_CANONICAL_MAPPING_PATH = join(
  homedir(),
  ".hasna",
  "files",
  "google-drive-canonical-object-mapping-2026-06-08.jsonl",
);

interface GoogleDriveCanonicalMappingRow {
  file_record_id: string;
  canonical_bucket: string;
  canonical_key: string | null;
  canonical_sha256: string | null;
  raw_bucket: string;
  raw_key: string;
  promotion_action: string | null;
  mapping_status: string;
}

export interface SyncResult {
  table: string;
  direction: "push" | "pull";
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

export interface StorageRuntimeContract {
  local_index: {
    provider: "sqlite";
    db_path: string;
    role: "local_metadata_index";
    writes: "local_sqlite";
  };
  remote_metadata: {
    provider: "postgres";
    mode: string;
    configured: boolean;
    enabled: boolean;
    database_url_env?: string;
    sync: "explicit_migrate_push_pull_sync";
    writes: "none_from_status" | "explicit_postgres_sync_commands";
  };
  object_bytes: {
    provider: "s3" | "local";
    configured: boolean;
    role: "durable_object_bytes";
    bucket?: string;
    region?: string;
    prefix?: string;
    endpoint_configured?: boolean;
    force_path_style?: boolean;
    credential_source: "aws_profile" | "default_provider_chain" | "local_filesystem";
    profile_configured?: boolean;
    local_root?: string;
    writes: "none_from_status_or_metadata_sync" | "explicit_object_store_apis";
  };
  boundary: {
    storage_status_mutates_remote: false;
    metadata_sync_moves_object_bytes: false;
    local_sqlite_replaced_by_remote: false;
  };
}

export interface StorageStatus {
  mode: string;
  enabled: boolean;
  db_path: string;
  remote_configured: boolean;
  database_url_env?: string;
  object_storage: {
    provider: "s3" | "local";
    configured: boolean;
    bucket?: string;
    region?: string;
    prefix?: string;
    endpoint?: string;
    endpoint_configured?: boolean;
    force_path_style?: boolean;
    credential_source?: "aws_profile" | "default_provider_chain" | "local_filesystem";
    profile_configured?: boolean;
    local_root?: string;
  };
  runtime: StorageRuntimeContract;
  tables: Array<{ table: string; rows: number }>;
}

export interface GoogleDriveMetadataImportResult {
  push: SyncResult[];
  mapping: {
    mappingFile: string;
    rowsRead: number;
    rowsApplied: number;
    rowsMissingInPostgres: number;
    errors: string[];
  };
}

export const STORAGE_TABLES = [
  "machines",
  "sources",
  "s3_objects",
  "files",
  "file_versions",
  "file_search_documents",
  "tags",
  "file_tags",
  "collections",
  "collection_files",
  "projects",
  "project_files",
  "peers",
  "feedback",
  "agents",
  "agent_activity",
  "knowledge_source_outbox_events",
  "knowledge_source_outbox_checkpoints",
  "google_drive_sync_state",
  "google_drive_imported_objects",
  "file_assets",
  "file_upload_intents",
  "file_links",
  "file_access_events",
  "file_organization_reviews",
  "file_organization_events",
] as const;

const TABLE_SET = new Set<string>(STORAGE_TABLES);

const TABLE_KEYS: Record<string, string[]> = {
  machines: ["id"],
  sources: ["id"],
  s3_objects: ["id"],
  files: ["id"],
  file_versions: ["id"],
  file_search_documents: ["id"],
  tags: ["id"],
  file_tags: ["file_id", "tag_id"],
  collections: ["id"],
  collection_files: ["collection_id", "file_id"],
  projects: ["id"],
  project_files: ["project_id", "file_id"],
  peers: ["id"],
  feedback: ["id"],
  agents: ["id"],
  agent_activity: ["id"],
  knowledge_source_outbox_events: ["id"],
  knowledge_source_outbox_checkpoints: ["consumer_id"],
  google_drive_sync_state: ["source_id"],
  google_drive_imported_objects: ["source_id", "drive_id", "file_id"],
  file_assets: ["id"],
  file_upload_intents: ["id"],
  file_links: ["id"],
  file_access_events: ["id"],
  file_organization_reviews: ["id"],
  file_organization_events: ["id"],
};

const BOOLEAN_COLUMNS: Record<string, string[]> = {
  machines: ["is_current"],
  sources: ["enabled"],
  peers: ["auto_sync"],
  google_drive_imported_objects: ["deleted"],
  file_assets: ["legal_hold", "immutable"],
  file_search_documents: ["private"],
};

function quoteId(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function toPgRow(table: string, row: Row): Row {
  const copy = { ...row };
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in copy) copy[column] = Boolean(copy[column]);
  }
  return copy;
}

function toSqliteRow(table: string, row: Row): Row {
  const copy = { ...row };
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in copy) copy[column] = copy[column] ? 1 : 0;
  }
  return copy;
}

async function getRemoteColumns(remote: PgAdapterAsync, table: string): Promise<Set<string>> {
  const rows = await remote.all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    table,
  ) as Array<{ column_name: string }>;
  return new Set(rows.map((row) => row.column_name));
}

function getSqliteColumns(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${quoteId(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

async function upsertPg(remote: PgAdapterAsync, table: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;

  const remoteColumns = await getRemoteColumns(remote, table);
  const keyColumns = TABLE_KEYS[table] ?? ["id"];
  const preparedRows = rows
    .map((rawRow) => toPgRow(table, rawRow))
    .map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => remoteColumns.has(column))))
    .filter((row) => keyColumns.every((column) => column in row));
  if (preparedRows.length === 0) return 0;

  const columns = Object.keys(preparedRows[0]!).filter((column) => remoteColumns.has(column));
  if (keyColumns.some((column) => !columns.includes(column))) return 0;

  const updateColumns = columns.filter((column) => !keyColumns.includes(column));
  const updateClause = updateColumns.length > 0
    ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = EXCLUDED.${quoteId(column)}`).join(", ")}`
    : "DO NOTHING";
  const batchSize = Math.max(1, Math.floor(60000 / columns.length));
  let written = 0;

  for (let offset = 0; offset < preparedRows.length; offset += batchSize) {
    const batch = preparedRows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders = batch.map((row) => {
      const rowPlaceholders = columns.map((column) => {
        values.push(row[column]);
        return `$${values.length}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    }).join(", ");

    const result = await remote.run(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES ${placeholders}
       ON CONFLICT (${keyColumns.map(quoteId).join(", ")}) ${updateClause}`,
      ...values,
    );
    written += result.changes;
  }

  return written;
}

function upsertSqlite(db: Database, table: string, rows: Row[]): number {
  const sqliteColumns = getSqliteColumns(db, table);
  const keyColumns = TABLE_KEYS[table] ?? ["id"];
  let written = 0;

  for (const rawRow of rows) {
    const row = toSqliteRow(table, rawRow);
    const columns = Object.keys(row).filter((column) => sqliteColumns.has(column));
    if (keyColumns.some((column) => !columns.includes(column))) continue;

    const updateColumns = columns.filter((column) => !keyColumns.includes(column));
    const updateClause = updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = excluded.${quoteId(column)}`).join(", ")}`
      : "DO NOTHING";

    db.query(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})
       ON CONFLICT(${keyColumns.map(quoteId).join(", ")}) ${updateClause}`,
    ).run(...columns.map((column) => row[column]) as any[]);
    written++;
  }

  return written;
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  return new PgAdapterAsync(getStorageConnectionString("files"));
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const migration of PG_MIGRATIONS) {
    await remote.exec(migration);
  }
}

export function getStorageStatus(db: Database = getDb()): StorageStatus {
  const config = getStorageConfig();
  const objectStorage = getEvidenceStorageOptions();
  const databaseUrlEnv = getStorageDatabaseUrlEnvName();
  const dbPath = getDbPath();
  const remoteConfigured = Boolean(databaseUrlEnv || (config.rds.host && config.rds.username));
  const remoteEnabled = config.mode === "hybrid" || config.mode === "remote";
  const objectStorageConfigured = objectStorage.provider === "local"
    ? Boolean(objectStorage.localRoot)
    : Boolean(objectStorage.bucket && objectStorage.region);
  const objectCredentialSource: StorageRuntimeContract["object_bytes"]["credential_source"] = objectStorage.provider === "local"
    ? "local_filesystem"
    : objectStorage.profile
      ? "aws_profile"
      : "default_provider_chain";
  const objectStorageStatus = objectStorage.provider === "s3" ? {
    provider: objectStorage.provider,
    configured: objectStorageConfigured,
    bucket: objectStorage.bucket,
    region: objectStorage.region,
    prefix: objectStorage.prefix || undefined,
    endpoint: objectStorage.endpoint || undefined,
    endpoint_configured: Boolean(objectStorage.endpoint),
    force_path_style: Boolean(objectStorage.forcePathStyle),
    credential_source: objectCredentialSource,
    profile_configured: Boolean(objectStorage.profile),
  } : {
    provider: objectStorage.provider,
    configured: objectStorageConfigured,
    local_root: objectStorage.localRoot,
    credential_source: objectCredentialSource,
  };

  return {
    mode: config.mode,
    enabled: remoteEnabled,
    db_path: dbPath,
    remote_configured: remoteConfigured,
    database_url_env: databaseUrlEnv,
    object_storage: objectStorageStatus,
    runtime: {
      local_index: {
        provider: "sqlite",
        db_path: dbPath,
        role: "local_metadata_index",
        writes: "local_sqlite",
      },
      remote_metadata: {
        provider: "postgres",
        mode: config.mode,
        configured: remoteConfigured,
        enabled: remoteEnabled,
        database_url_env: databaseUrlEnv,
        sync: "explicit_migrate_push_pull_sync",
        writes: remoteEnabled ? "explicit_postgres_sync_commands" : "none_from_status",
      },
      object_bytes: objectStorage.provider === "s3" ? {
        provider: "s3",
        configured: objectStorageConfigured,
        role: "durable_object_bytes",
        bucket: objectStorage.bucket,
        region: objectStorage.region,
        prefix: objectStorage.prefix || undefined,
        endpoint_configured: Boolean(objectStorage.endpoint),
        force_path_style: Boolean(objectStorage.forcePathStyle),
        credential_source: objectCredentialSource,
        profile_configured: Boolean(objectStorage.profile),
        writes: "explicit_object_store_apis",
      } : {
        provider: "local",
        configured: objectStorageConfigured,
        role: "durable_object_bytes",
        local_root: objectStorage.localRoot,
        credential_source: objectCredentialSource,
        writes: "explicit_object_store_apis",
      },
      boundary: {
        storage_status_mutates_remote: false,
        metadata_sync_moves_object_bytes: false,
        local_sqlite_replaced_by_remote: false,
      },
    },
    tables: STORAGE_TABLES.map((table) => {
      try {
        const row = db.query(`SELECT COUNT(*) as count FROM ${quoteId(table)}`).get() as { count: number };
        return { table, rows: row.count };
      } catch {
        return { table, rows: 0 };
      }
    }),
  };
}

export async function pushStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<SyncResult[]> {
  const db = getDb();
  const remote = await getStoragePg();
  const results: SyncResult[] = [];

  try {
    await runStorageMigrations(remote);
    for (const table of tables) {
      const result: SyncResult = { table, direction: "push", rowsRead: 0, rowsWritten: 0, errors: [] };
      try {
        const rows = db.query(`SELECT * FROM ${quoteId(table)}`).all() as Row[];
        result.rowsRead = rows.length;
        result.rowsWritten = await upsertPg(remote, table, rows);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      results.push(result);
    }
  } finally {
    await remote.close();
  }

  return results;
}

export async function applyGoogleDriveCanonicalMapping(
  mappingFile: string = DEFAULT_GOOGLE_DRIVE_CANONICAL_MAPPING_PATH,
): Promise<GoogleDriveMetadataImportResult["mapping"]> {
  const remote = await getStoragePg();
  const result: GoogleDriveMetadataImportResult["mapping"] = {
    mappingFile,
    rowsRead: 0,
    rowsApplied: 0,
    rowsMissingInPostgres: 0,
    errors: [],
  };

  try {
    await runStorageMigrations(remote);
    const rows = readJsonl<GoogleDriveCanonicalMappingRow>(mappingFile);
    result.rowsRead = rows.length;

    const validRows: GoogleDriveCanonicalMappingRow[] = [];
    for (const row of rows) {
      if (!row.file_record_id || row.mapping_status !== "mapped" || !row.canonical_key || !row.canonical_sha256) {
        result.errors.push(`Invalid mapping row for file_record_id=${row.file_record_id || "(missing)"}`);
        continue;
      }
      validRows.push(row);
    }

    const columns = [
      "file_record_id",
      "raw_bucket",
      "raw_key",
      "canonical_bucket",
      "canonical_key",
      "canonical_sha256",
      "promotion_action",
      "promotion_status",
      "storage_key",
    ] as const;
    const batchSize = 1000;

    for (let offset = 0; offset < validRows.length; offset += batchSize) {
      const batch = validRows.slice(offset, offset + batchSize);
      const values: unknown[] = [];
      const placeholders = batch.map((row) => {
        const tuple = [
          row.file_record_id,
          row.raw_bucket,
          row.raw_key,
          row.canonical_bucket,
          row.canonical_key,
          row.canonical_sha256,
          row.promotion_action,
          row.mapping_status,
          row.canonical_key,
        ];
        return `(${tuple.map((value) => {
          values.push(value);
          return `$${values.length}`;
        }).join(", ")})`;
      }).join(", ");

      const update = await remote.run(
        `UPDATE google_drive_imported_objects
         SET raw_bucket = mapping.raw_bucket,
             raw_key = mapping.raw_key,
             canonical_bucket = mapping.canonical_bucket,
             canonical_key = mapping.canonical_key,
             canonical_sha256 = mapping.canonical_sha256,
             promotion_action = mapping.promotion_action,
             promotion_status = mapping.promotion_status,
             storage_type = 's3',
             storage_key = mapping.storage_key
         FROM (VALUES ${placeholders}) AS mapping(${columns.map(quoteId).join(", ")})
         WHERE google_drive_imported_objects.file_record_id = mapping.file_record_id`,
        ...values,
      );

      result.rowsApplied += update.changes;
    }
    result.rowsMissingInPostgres = validRows.length - result.rowsApplied;
  } finally {
    await remote.close();
  }

  return result;
}

export async function importGoogleDriveMetadata(
  mappingFile: string = DEFAULT_GOOGLE_DRIVE_CANONICAL_MAPPING_PATH,
): Promise<GoogleDriveMetadataImportResult> {
  const push = await pushStorageChanges([...STORAGE_TABLES]);
  const mapping = await applyGoogleDriveCanonicalMapping(mappingFile);
  return { push, mapping };
}

export async function pullStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<SyncResult[]> {
  const db = getDb();
  const remote = await getStoragePg();
  const results: SyncResult[] = [];

  try {
    await runStorageMigrations(remote);
    for (const table of tables) {
      const result: SyncResult = { table, direction: "pull", rowsRead: 0, rowsWritten: 0, errors: [] };
      try {
        const rows = await remote.all(`SELECT * FROM ${quoteId(table)}`) as Row[];
        result.rowsRead = rows.length;
        result.rowsWritten = upsertSqlite(db, table, rows);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      results.push(result);
    }
    if (tables.includes("files") || tables.includes("tags") || tables.includes("file_tags")) {
      refreshAllFts();
    }
    if (tables.includes("file_search_documents")) {
      refreshAllFileSearchDocumentFts();
    }
  } finally {
    await remote.close();
  }

  return results;
}

export async function syncStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<{ push: SyncResult[]; pull: SyncResult[] }> {
  return {
    push: await pushStorageChanges(tables),
    pull: await pullStorageChanges(tables),
  };
}

export function parseStorageTables(raw?: string): string[] {
  if (!raw) return [...STORAGE_TABLES];

  const requested = raw.split(",").map((table) => table.trim()).filter(Boolean);
  if (requested.length === 0) return [...STORAGE_TABLES];

  const invalid = requested.filter((table) => !TABLE_SET.has(table));
  if (invalid.length > 0) {
    throw new Error(`Unknown storage table(s): ${invalid.join(", ")}`);
  }

  return requested;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid JSON in ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}
