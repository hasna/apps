import { nanoid } from "nanoid";
import { getDb } from "./database.js";
import type { S3ObjectRecord, S3ObjectResolverContract } from "../types/index.js";

interface S3ObjectRow {
  id: string;
  source_id: string | null;
  identity: string;
  bucket: string;
  region: string | null;
  object_key: string;
  version_id: string | null;
  etag: string | null;
  checksum_sha256: string | null;
  size: number;
  content_type: string;
  storage_class: string | null;
  server_side_encryption: string | null;
  sse_kms_key_id: string | null;
  metadata: string;
  org_id: string | null;
  company_id: string | null;
  project_id: string | null;
  app: string | null;
  discovered_at: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertS3ObjectInput {
  source_id?: string;
  bucket: string;
  region?: string;
  object_key: string;
  version_id?: string;
  etag?: string;
  checksum_sha256?: string;
  size: number;
  content_type?: string;
  storage_class?: string;
  server_side_encryption?: string;
  sse_kms_key_id?: string;
  metadata?: Record<string, unknown>;
  org_id?: string;
  company_id?: string;
  project_id?: string;
  app?: string;
  discovered_at?: string;
}

export interface S3ObjectLookupInput {
  source_id?: string;
  bucket: string;
  object_key: string;
  version_id?: string;
  etag?: string;
  checksum_sha256?: string;
}

export interface ListS3ObjectsOptions {
  source_id?: string;
  bucket?: string;
  prefix?: string;
  org_id?: string;
  company_id?: string;
  project_id?: string;
  app?: string;
  limit?: number;
  offset?: number;
}

function toS3Object(row: S3ObjectRow): S3ObjectRecord {
  return {
    id: row.id,
    source_id: row.source_id ?? undefined,
    identity: row.identity,
    bucket: row.bucket,
    region: row.region ?? undefined,
    object_key: row.object_key,
    version_id: row.version_id ?? undefined,
    etag: row.etag ?? undefined,
    checksum_sha256: row.checksum_sha256 ?? undefined,
    size: row.size,
    content_type: row.content_type,
    storage_class: row.storage_class ?? undefined,
    server_side_encryption: row.server_side_encryption ?? undefined,
    sse_kms_key_id: row.sse_kms_key_id ?? undefined,
    metadata: parseJsonObject(row.metadata),
    org_id: row.org_id ?? undefined,
    company_id: row.company_id ?? undefined,
    project_id: row.project_id ?? undefined,
    app: row.app ?? undefined,
    discovered_at: row.discovered_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function upsertS3ObjectRecord(input: UpsertS3ObjectInput): S3ObjectRecord {
  const normalized = normalizeInput(input);
  const identity = buildS3ObjectIdentity(normalized);
  const db = getDb();
  const existing = db.query<S3ObjectRow, [string]>(
    "SELECT * FROM s3_objects WHERE identity = ?",
  ).get(identity);

  if (existing) {
    db.run(
      `UPDATE s3_objects
       SET source_id = COALESCE(?, source_id),
           region = COALESCE(?, region),
           version_id = COALESCE(?, version_id),
           etag = COALESCE(?, etag),
           checksum_sha256 = COALESCE(?, checksum_sha256),
           size = ?,
           content_type = ?,
           storage_class = ?,
           server_side_encryption = ?,
           sse_kms_key_id = ?,
           metadata = ?,
           org_id = COALESCE(?, org_id),
           company_id = COALESCE(?, company_id),
           project_id = COALESCE(?, project_id),
           app = COALESCE(?, app),
           discovered_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        normalized.source_id ?? null,
        normalized.region ?? null,
        normalized.version_id ?? null,
        normalized.etag ?? null,
        normalized.checksum_sha256 ?? null,
        normalized.size,
        normalized.content_type ?? "application/octet-stream",
        normalized.storage_class ?? null,
        normalized.server_side_encryption ?? null,
        normalized.sse_kms_key_id ?? null,
        JSON.stringify(normalized.metadata ?? {}),
        normalized.org_id ?? null,
        normalized.company_id ?? null,
        normalized.project_id ?? null,
        normalized.app ?? null,
        normalized.discovered_at ?? new Date().toISOString(),
        new Date().toISOString(),
        existing.id,
      ],
    );
    return getS3ObjectRecord(existing.id)!;
  }

  const id = `s3obj_${nanoid(14)}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO s3_objects (
      id, source_id, identity, bucket, region, object_key, version_id, etag,
      checksum_sha256, size, content_type, storage_class, server_side_encryption,
      sse_kms_key_id, metadata, org_id, company_id, project_id, app,
      discovered_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      normalized.source_id ?? null,
      identity,
      normalized.bucket,
      normalized.region ?? null,
      normalized.object_key,
      normalized.version_id ?? null,
      normalized.etag ?? null,
      normalized.checksum_sha256 ?? null,
      normalized.size,
      normalized.content_type ?? "application/octet-stream",
      normalized.storage_class ?? null,
      normalized.server_side_encryption ?? null,
      normalized.sse_kms_key_id ?? null,
      JSON.stringify(normalized.metadata ?? {}),
      normalized.org_id ?? null,
      normalized.company_id ?? null,
      normalized.project_id ?? null,
      normalized.app ?? null,
      normalized.discovered_at ?? now,
      now,
      now,
    ],
  );
  return getS3ObjectRecord(id)!;
}

export function getS3ObjectRecord(id: string): S3ObjectRecord | null {
  const row = getDb().query<S3ObjectRow, [string]>("SELECT * FROM s3_objects WHERE id = ?").get(id);
  return row ? toS3Object(row) : null;
}

export function findS3ObjectRecordForStorage(input: S3ObjectLookupInput): S3ObjectRecord | null {
  const normalized = {
    ...input,
    etag: normalizeEtag(input.etag),
    checksum_sha256: normalizeSha256(input.checksum_sha256),
  };
  const db = getDb();
  const sourceClause = normalized.source_id ? "AND source_id = ?" : "";

  if (normalized.version_id) {
    const params = normalized.source_id
      ? [normalized.bucket, normalized.object_key, normalized.version_id, normalized.source_id]
      : [normalized.bucket, normalized.object_key, normalized.version_id];
    const row = db.query<S3ObjectRow, any[]>(
      `SELECT * FROM s3_objects
       WHERE bucket = ? AND object_key = ? AND version_id = ? ${sourceClause}
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(...params);
    if (row) return toS3Object(row);
  }

  if (normalized.checksum_sha256) {
    const params = normalized.source_id
      ? [normalized.bucket, normalized.object_key, normalized.checksum_sha256, normalized.source_id]
      : [normalized.bucket, normalized.object_key, normalized.checksum_sha256];
    const row = db.query<S3ObjectRow, any[]>(
      `SELECT * FROM s3_objects
       WHERE bucket = ? AND object_key = ? AND checksum_sha256 = ? ${sourceClause}
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(...params);
    if (row) return toS3Object(row);
  }

  if (normalized.etag) {
    const params = normalized.source_id
      ? [normalized.bucket, normalized.object_key, normalized.etag, normalized.source_id]
      : [normalized.bucket, normalized.object_key, normalized.etag];
    const row = db.query<S3ObjectRow, any[]>(
      `SELECT * FROM s3_objects
       WHERE bucket = ? AND object_key = ? AND etag = ? ${sourceClause}
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(...params);
    if (row) return toS3Object(row);
  }

  const params = normalized.source_id
    ? [normalized.bucket, normalized.object_key, normalized.source_id]
    : [normalized.bucket, normalized.object_key];
  const row = db.query<S3ObjectRow, any[]>(
    `SELECT * FROM s3_objects
     WHERE bucket = ? AND object_key = ? ${sourceClause}
     ORDER BY updated_at DESC LIMIT 1`,
  ).get(...params);
  return row ? toS3Object(row) : null;
}

export function listS3ObjectRecords(opts: ListS3ObjectsOptions = {}): S3ObjectRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.source_id) { conditions.push("source_id = ?"); params.push(opts.source_id); }
  if (opts.bucket) { conditions.push("bucket = ?"); params.push(opts.bucket); }
  if (opts.prefix) { conditions.push("object_key LIKE ?"); params.push(`${opts.prefix}%`); }
  if (opts.org_id) { conditions.push("org_id = ?"); params.push(opts.org_id); }
  if (opts.company_id) { conditions.push("company_id = ?"); params.push(opts.company_id); }
  if (opts.project_id) { conditions.push("project_id = ?"); params.push(opts.project_id); }
  if (opts.app) { conditions.push("app = ?"); params.push(opts.app); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb().query<S3ObjectRow, any[]>(
    `SELECT * FROM s3_objects ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).all(...[...params, opts.limit ?? 100, opts.offset ?? 0]);
  return rows.map(toS3Object);
}

export function buildS3ObjectResolverContract(object: S3ObjectRecord): S3ObjectResolverContract {
  return {
    object_id: object.id,
    storage: {
      provider: "s3",
      bucket: object.bucket,
      key: object.object_key,
      region: object.region,
      version_id: object.version_id,
    },
    object: {
      size: object.size,
      content_type: object.content_type,
      etag: object.etag,
      checksum_sha256: object.checksum_sha256,
      storage_class: object.storage_class,
      encryption: object.server_side_encryption || object.sse_kms_key_id
        ? {
            mode: object.server_side_encryption,
            kms_key_id: object.sse_kms_key_id,
          }
        : undefined,
      metadata: object.metadata,
    },
    scope: {
      org_id: object.org_id,
      company_id: object.company_id,
      project_id: object.project_id,
      app: object.app,
    },
    permissions: {
      mode: "read_only",
    },
  };
}

export function buildS3ObjectIdentity(input: UpsertS3ObjectInput): string {
  const normalized = normalizeInput(input);
  return JSON.stringify({
    bucket: normalized.bucket,
    object_key: normalized.object_key,
    version_id: normalized.version_id ?? null,
    etag: normalized.etag ?? null,
    checksum_sha256: normalized.checksum_sha256 ?? null,
    size: normalized.size,
    content_type: normalized.content_type ?? "application/octet-stream",
  });
}

function normalizeInput(input: UpsertS3ObjectInput): UpsertS3ObjectInput {
  if (!input.bucket) throw new Error("S3 object bucket is required.");
  if (!input.object_key) throw new Error("S3 object key is required.");
  return {
    ...input,
    etag: normalizeEtag(input.etag),
    checksum_sha256: normalizeSha256(input.checksum_sha256),
    content_type: input.content_type ?? "application/octet-stream",
  };
}

function normalizeEtag(etag: string | undefined): string | undefined {
  return etag?.replace(/^"|"$/g, "");
}

function normalizeSha256(checksum: string | undefined): string | undefined {
  if (!checksum) return undefined;
  if (/^[a-f0-9]{64}$/i.test(checksum)) return checksum.toLowerCase();
  try {
    const decoded = Buffer.from(checksum, "base64");
    if (decoded.length === 32) return decoded.toString("hex");
  } catch {
    return checksum;
  }
  return checksum;
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
