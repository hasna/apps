import { join } from "node:path";
import { nanoid } from "nanoid";
import { getDb } from "./database.js";
import { findS3ObjectRecordForStorage } from "./s3-objects.js";
import { buildOpenFilesFileRevisionRef } from "../lib/source-ref.js";
import type {
  FileStatus,
  FileVersion,
  FileVersionState,
  FileVersionStorageProvider,
} from "../types/index.js";

interface FileVersionRow {
  id: string;
  file_id: string;
  source_id: string;
  source_ref: string;
  s3_object_id: string | null;
  revision_identity: string;
  content_hash_algorithm: string;
  content_hash: string | null;
  size: number;
  mime: string;
  storage_provider: string;
  bucket: string | null;
  region: string | null;
  object_key: string | null;
  local_path: string | null;
  source_path: string;
  source_modified_at: string | null;
  indexed_at: string;
  state: string;
  source_provenance: string;
  created_at: string;
}

interface CurrentFileVersionRow {
  file_id: string;
  source_id: string;
  machine_id: string;
  path: string;
  name: string;
  size: number;
  mime: string;
  hash: string | null;
  status: string;
  indexed_at: string;
  modified_at: string | null;
  created_at: string;
  source_name: string;
  source_type: string;
  source_root_path: string | null;
  source_bucket: string | null;
  source_prefix: string | null;
  source_region: string | null;
  drive_source_id: string | null;
  drive_id: string | null;
  drive_file_id: string | null;
  drive_hash: string | null;
  drive_storage_type: string | null;
  drive_storage_key: string | null;
  destination_source_id: string | null;
  destination_path: string | null;
  destination_bucket: string | null;
  destination_region: string | null;
  raw_bucket: string | null;
  raw_key: string | null;
  canonical_bucket: string | null;
  canonical_key: string | null;
  canonical_sha256: string | null;
  promotion_status: string | null;
}

export interface FileVersionInput {
  file_id: string;
  source_id: string;
  s3_object_id?: string;
  content_hash_algorithm: string;
  content_hash?: string;
  size: number;
  mime: string;
  storage_provider: FileVersionStorageProvider;
  bucket?: string;
  region?: string;
  object_key?: string;
  local_path?: string;
  source_path: string;
  source_modified_at?: string;
  indexed_at: string;
  state: FileVersionState;
  source_provenance?: Record<string, unknown>;
}

function toVersion(row: FileVersionRow): FileVersion {
  return {
    id: row.id,
    file_id: row.file_id,
    source_id: row.source_id,
    source_ref: row.source_ref,
    s3_object_id: row.s3_object_id ?? undefined,
    revision_identity: row.revision_identity,
    content_hash_algorithm: row.content_hash_algorithm,
    content_hash: row.content_hash ?? undefined,
    size: row.size,
    mime: row.mime,
    storage_provider: row.storage_provider as FileVersionStorageProvider,
    bucket: row.bucket ?? undefined,
    region: row.region ?? undefined,
    object_key: row.object_key ?? undefined,
    local_path: row.local_path ?? undefined,
    source_path: row.source_path,
    source_modified_at: row.source_modified_at ?? undefined,
    indexed_at: row.indexed_at,
    state: row.state as FileVersionState,
    source_provenance: parseJsonObject(row.source_provenance),
    created_at: row.created_at,
  };
}

export function createFileVersion(input: FileVersionInput): FileVersion {
  const db = getDb();
  const revisionIdentity = buildRevisionIdentity(input);
  const existing = db.query<FileVersionRow, [string, string]>(
    "SELECT * FROM file_versions WHERE file_id = ? AND revision_identity = ?",
  ).get(input.file_id, revisionIdentity);
  if (existing) {
    if (input.s3_object_id && !existing.s3_object_id) {
      db.run("UPDATE file_versions SET s3_object_id = ? WHERE id = ?", [input.s3_object_id, existing.id]);
      return getFileVersion(existing.id)!;
    }
    return toVersion(existing);
  }

  const id = `rev_${nanoid(14)}`;
  const sourceRef = buildOpenFilesFileRevisionRef(input.file_id, id);
  db.run(
    `INSERT INTO file_versions (
      id, file_id, source_id, source_ref, revision_identity,
      s3_object_id,
      content_hash_algorithm, content_hash, size, mime, storage_provider,
      bucket, region, object_key, local_path, source_path, source_modified_at,
      indexed_at, state, source_provenance, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.file_id,
      input.source_id,
      sourceRef,
      revisionIdentity,
      input.s3_object_id ?? null,
      input.content_hash_algorithm,
      input.content_hash ?? null,
      input.size,
      input.mime,
      input.storage_provider,
      input.bucket ?? null,
      input.region ?? null,
      input.object_key ?? null,
      input.local_path ?? null,
      input.source_path,
      input.source_modified_at ?? null,
      input.indexed_at,
      input.state,
      JSON.stringify(input.source_provenance ?? {}),
      new Date().toISOString(),
    ],
  );
  return getFileVersion(id)!;
}

export function upsertCurrentFileVersion(fileId: string): FileVersion | null {
  const row = getCurrentFileVersionRow(fileId);
  if (!row) return null;
  return createFileVersion(currentFileRowToVersionInput(row));
}

export function getFileVersion(id: string): FileVersion | null {
  const row = getDb().query<FileVersionRow, [string]>("SELECT * FROM file_versions WHERE id = ?").get(id);
  return row ? toVersion(row) : null;
}

export function getFileVersionBySourceRef(sourceRef: string): FileVersion | null {
  const row = getDb().query<FileVersionRow, [string]>("SELECT * FROM file_versions WHERE source_ref = ?").get(sourceRef);
  return row ? toVersion(row) : null;
}

export function listFileVersions(fileId: string): FileVersion[] {
  return getDb()
    .query<FileVersionRow, [string]>(
      "SELECT * FROM file_versions WHERE file_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(fileId)
    .map(toVersion);
}

export function getLatestFileVersion(fileId: string): FileVersion | null {
  const row = getDb()
    .query<FileVersionRow, [string]>(
      "SELECT * FROM file_versions WHERE file_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(fileId);
  return row ? toVersion(row) : null;
}

export function backfillFileVersions(): number {
  const rows = getDb()
    .query<{ id: string }, []>("SELECT id FROM files ORDER BY indexed_at ASC, id ASC")
    .all();
  let count = 0;
  for (const row of rows) {
    if (upsertCurrentFileVersion(row.id)) count++;
  }
  return count;
}

function getCurrentFileVersionRow(fileId: string): CurrentFileVersionRow | null {
  return getDb()
    .query<CurrentFileVersionRow, [string]>(
      `SELECT
        f.id AS file_id,
        f.source_id,
        f.machine_id,
        f.path,
        f.name,
        f.size,
        f.mime,
        f.hash,
        f.status,
        f.indexed_at,
        f.modified_at,
        f.created_at,
        s.name AS source_name,
        s.type AS source_type,
        s.path AS source_root_path,
        s.bucket AS source_bucket,
        s.prefix AS source_prefix,
        s.region AS source_region,
        g.source_id AS drive_source_id,
        g.drive_id,
        g.file_id AS drive_file_id,
        g.hash AS drive_hash,
        g.storage_type AS drive_storage_type,
        g.storage_key AS drive_storage_key,
        g.destination_source_id,
        ds.path AS destination_path,
        ds.bucket AS destination_bucket,
        ds.region AS destination_region,
        g.raw_bucket,
        g.raw_key,
        g.canonical_bucket,
        g.canonical_key,
        g.canonical_sha256,
        g.promotion_status
       FROM files f
       JOIN sources s ON s.id = f.source_id
       LEFT JOIN google_drive_imported_objects g
        ON g.file_record_id = f.id AND g.deleted = 0
       LEFT JOIN sources ds ON ds.id = g.destination_source_id
       WHERE f.id = ?`,
    )
    .get(fileId);
}

function currentFileRowToVersionInput(row: CurrentFileVersionRow): FileVersionInput {
  const content_hash = row.canonical_sha256 || row.hash || row.drive_hash || undefined;
  const content_hash_algorithm = inferHashAlgorithm(row, content_hash);
  const storage = inferStorage(row);
  const s3Object = storage.storage_provider === "s3" && storage.bucket && storage.object_key
    ? findS3ObjectRecordForStorage({
        source_id: row.source_type === "s3" ? row.source_id : row.destination_source_id ?? undefined,
        bucket: storage.bucket,
        object_key: storage.object_key,
        etag: row.source_type === "s3" ? row.hash ?? undefined : undefined,
        checksum_sha256: row.canonical_sha256 ?? undefined,
      })
    : null;

  return {
    file_id: row.file_id,
    source_id: row.source_id,
    s3_object_id: s3Object?.id,
    content_hash_algorithm,
    content_hash,
    size: row.size,
    mime: row.mime,
    storage_provider: storage.storage_provider,
    bucket: storage.bucket,
    region: storage.region,
    object_key: storage.object_key,
    local_path: storage.local_path,
    source_path: row.path,
    source_modified_at: row.modified_at ?? undefined,
    indexed_at: row.indexed_at,
    state: row.status as FileStatus,
    source_provenance: {
      source_type: row.source_type,
      source_name: row.source_name,
      source_prefix: row.source_prefix ?? undefined,
      google_drive_source_id: row.drive_source_id ?? undefined,
      google_drive_file_id: row.drive_file_id ?? undefined,
      google_drive_drive_id: row.drive_id ?? undefined,
      raw_bucket: row.raw_bucket ?? undefined,
      raw_key: row.raw_key ?? undefined,
      destination_source_id: row.destination_source_id ?? undefined,
      promotion_status: row.promotion_status ?? undefined,
      s3_object_id: s3Object?.id,
      s3_etag: s3Object?.etag,
      s3_version_id: s3Object?.version_id,
    },
  };
}

function inferHashAlgorithm(row: CurrentFileVersionRow, hash: string | undefined): string {
  if (!hash) return "unknown";
  if (row.canonical_sha256) return "sha256";
  if (row.source_type === "local") return "blake3";
  if (row.source_type === "s3") return "etag";
  return "source";
}

function inferStorage(row: CurrentFileVersionRow): {
  storage_provider: FileVersionStorageProvider;
  bucket?: string;
  region?: string;
  object_key?: string;
  local_path?: string;
} {
  if (row.canonical_bucket && row.canonical_key) {
    return {
      storage_provider: "s3",
      bucket: row.canonical_bucket,
      region: row.destination_region ?? row.source_region ?? undefined,
      object_key: row.canonical_key,
    };
  }

  if (row.drive_storage_type === "s3") {
    return {
      storage_provider: "s3",
      bucket: row.destination_bucket ?? row.source_bucket ?? undefined,
      region: row.destination_region ?? row.source_region ?? undefined,
      object_key: row.drive_storage_key ?? undefined,
    };
  }

  if (row.drive_storage_type === "local") {
    return {
      storage_provider: "local",
      local_path: row.destination_path && row.drive_storage_key
        ? join(row.destination_path, row.drive_storage_key)
        : row.drive_storage_key ?? undefined,
    };
  }

  if (row.source_type === "s3") {
    return {
      storage_provider: "s3",
      bucket: row.source_bucket ?? undefined,
      region: row.source_region ?? undefined,
      object_key: row.path,
    };
  }

  if (row.source_type === "local") {
    return {
      storage_provider: "local",
      local_path: row.source_root_path ? join(row.source_root_path, row.path) : row.path,
    };
  }

  return { storage_provider: "unknown" };
}

function buildRevisionIdentity(input: FileVersionInput): string {
  return JSON.stringify({
    content_hash_algorithm: input.content_hash_algorithm,
    content_hash: input.content_hash ?? null,
    size: input.size,
    mime: input.mime,
    storage_provider: input.storage_provider,
    bucket: input.bucket ?? null,
    region: input.region ?? null,
    object_key: input.object_key ?? null,
    local_path: input.local_path ?? null,
    source_path: input.source_path,
    source_modified_at: input.source_modified_at ?? null,
    state: input.state,
  });
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
