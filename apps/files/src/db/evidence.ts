import { nanoid } from "nanoid";
import { getDb } from "./database.js";
import type { SQLQueryBindings } from "bun:sqlite";
import type {
  CreateFileAccessEventInput,
  CreateFileAssetInput,
  CreateFileLinkInput,
  FileAccessEvent,
  FileAccessAction,
  FileAsset,
  FileAssetStatus,
  FileLink,
  FileScanStatus,
  FileStorageProvider,
  FileUploadIntent,
} from "../types/index.js";

interface FileAssetRow {
  id: string;
  org_id: string;
  company_id: string | null;
  app: string;
  kind: string;
  classification: string;
  original_name: string;
  content_type: string;
  size: number;
  checksum: string;
  checksum_algorithm: string;
  storage_provider: string;
  bucket: string | null;
  region: string | null;
  object_key: string;
  quarantine_key: string | null;
  status: string;
  scan_status: string;
  retention_until: string | null;
  retention_policy: string | null;
  storage_class: string | null;
  legal_hold: number;
  immutable: number;
  metadata: string;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
}

interface UploadIntentRow {
  id: string;
  asset_id: string;
  method: "PUT";
  expires_at: string;
  status: string;
  expected_checksum: string;
  expected_checksum_algorithm: string;
  expected_size: number;
  required_headers: string;
  metadata: string;
  created_at: string;
  completed_at: string | null;
}

interface FileLinkRow {
  id: string;
  asset_id: string;
  org_id: string;
  company_id: string | null;
  app: string;
  source_type: string;
  source_id: string;
  kind: string;
  metadata: string;
  created_at: string;
}

interface AccessEventRow {
  id: string;
  asset_id: string;
  org_id: string;
  company_id: string | null;
  app: string | null;
  actor_id: string | null;
  action: string;
  purpose: string | null;
  metadata: string;
  created_at: string;
}

export interface ListFileAssetsOptions {
  org_id?: string;
  company_id?: string;
  app?: string;
  kind?: string;
  status?: FileAssetStatus;
  checksum?: string;
  limit?: number;
  offset?: number;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || "{}") as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function toAsset(row: FileAssetRow): FileAsset {
  return {
    id: row.id,
    org_id: row.org_id,
    company_id: row.company_id ?? undefined,
    app: row.app,
    kind: row.kind,
    classification: row.classification,
    original_name: row.original_name,
    content_type: row.content_type,
    size: row.size,
    checksum: row.checksum,
    checksum_algorithm: row.checksum_algorithm,
    storage_provider: row.storage_provider as FileStorageProvider,
    bucket: row.bucket ?? undefined,
    region: row.region ?? undefined,
    object_key: row.object_key,
    quarantine_key: row.quarantine_key ?? undefined,
    status: row.status as FileAssetStatus,
    scan_status: row.scan_status as FileScanStatus,
    retention_until: row.retention_until ?? undefined,
    retention_policy: row.retention_policy ?? undefined,
    storage_class: row.storage_class ?? undefined,
    legal_hold: row.legal_hold === 1,
    immutable: row.immutable === 1,
    metadata: parseJsonObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    verified_at: row.verified_at ?? undefined,
  };
}

function toIntent(row: UploadIntentRow, uploadUrl?: string): FileUploadIntent {
  return {
    id: row.id,
    asset_id: row.asset_id,
    method: row.method,
    upload_url: uploadUrl,
    expires_at: row.expires_at,
    status: row.status as FileUploadIntent["status"],
    expected_checksum: row.expected_checksum,
    expected_checksum_algorithm: row.expected_checksum_algorithm,
    expected_size: row.expected_size,
    // Transport headers are intentionally never rehydrated from persistence.
    required_headers: {},
    metadata: parseJsonObject(row.metadata),
    created_at: row.created_at,
    completed_at: row.completed_at ?? undefined,
  };
}

function toLink(row: FileLinkRow): FileLink {
  return {
    id: row.id,
    asset_id: row.asset_id,
    org_id: row.org_id,
    company_id: row.company_id ?? undefined,
    app: row.app,
    source_type: row.source_type,
    source_id: row.source_id,
    kind: row.kind,
    metadata: parseJsonObject(row.metadata),
    created_at: row.created_at,
  };
}

function toAccessEvent(row: AccessEventRow): FileAccessEvent {
  return {
    id: row.id,
    asset_id: row.asset_id,
    org_id: row.org_id,
    company_id: row.company_id ?? undefined,
    app: row.app ?? undefined,
    actor_id: row.actor_id ?? undefined,
    action: row.action as FileAccessAction,
    purpose: row.purpose ?? undefined,
    metadata: parseJsonObject(row.metadata),
    created_at: row.created_at,
  };
}

export function createFileAsset(input: CreateFileAssetInput): FileAsset {
  const id = input.id ?? `asset_${nanoid(12)}`;
  getDb().run(
    `INSERT INTO file_assets (
      id, org_id, company_id, app, kind, classification, original_name, content_type,
      size, checksum, checksum_algorithm, storage_provider, bucket, region, object_key,
      quarantine_key, retention_until, retention_policy, storage_class, legal_hold, immutable, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.org_id,
      input.company_id ?? null,
      input.app,
      input.kind,
      input.classification ?? "general",
      input.original_name,
      input.content_type,
      input.size,
      input.checksum,
      input.checksum_algorithm ?? "sha256",
      input.storage_provider,
      input.bucket ?? null,
      input.region ?? null,
      input.object_key,
      input.quarantine_key ?? null,
      input.retention_until ?? null,
      input.retention_policy ?? null,
      input.storage_class ?? null,
      input.legal_hold ? 1 : 0,
      input.immutable ? 1 : 0,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return getFileAsset(id)!;
}

export function getFileAsset(id: string): FileAsset | null {
  const row = getDb().query<FileAssetRow, [string]>("SELECT * FROM file_assets WHERE id = ?").get(id);
  return row ? toAsset(row) : null;
}

export function listFileAssets(opts: ListFileAssetsOptions = {}): FileAsset[] {
  const conditions: string[] = ["status != 'deleted'"];
  const params: SQLQueryBindings[] = [];
  if (opts.org_id) { conditions.push("org_id = ?"); params.push(opts.org_id); }
  if (opts.company_id) { conditions.push("company_id = ?"); params.push(opts.company_id); }
  if (opts.app) { conditions.push("app = ?"); params.push(opts.app); }
  if (opts.kind) { conditions.push("kind = ?"); params.push(opts.kind); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.checksum) { conditions.push("checksum = ?"); params.push(opts.checksum); }
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return getDb()
    .query<FileAssetRow, SQLQueryBindings[]>(
      `SELECT * FROM file_assets WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map(toAsset);
}

export function createFileUploadIntent(input: {
  asset_id: string;
  expires_at: string;
  expected_checksum: string;
  expected_checksum_algorithm: string;
  expected_size: number;
  required_headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}): FileUploadIntent {
  const id = `upl_${nanoid(12)}`;
  getDb().run(
    `INSERT INTO file_upload_intents (
      id, asset_id, expires_at, expected_checksum, expected_checksum_algorithm,
      expected_size, required_headers, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.asset_id,
      input.expires_at,
      input.expected_checksum,
      input.expected_checksum_algorithm,
      input.expected_size,
      "{}",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return getFileUploadIntent(id)!;
}

export function getFileUploadIntent(id: string, uploadUrl?: string): FileUploadIntent | null {
  const row = getDb()
    .query<UploadIntentRow, [string]>("SELECT * FROM file_upload_intents WHERE id = ?")
    .get(id);
  return row ? toIntent(row, uploadUrl) : null;
}

export function markFileUploadIntentCompleted(id: string): FileUploadIntent | null {
  getDb().run(
    "UPDATE file_upload_intents SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
    [id],
  );
  return getFileUploadIntent(id);
}

export function updateFileAssetStatus(input: {
  id: string;
  status: FileAssetStatus;
  scan_status?: FileScanStatus;
  verified?: boolean;
}): FileAsset | null {
  getDb().run(
    `UPDATE file_assets
     SET status = ?, scan_status = COALESCE(?, scan_status), updated_at = datetime('now'),
         verified_at = CASE WHEN ? THEN datetime('now') ELSE verified_at END
     WHERE id = ?`,
    [input.status, input.scan_status ?? null, input.verified ? 1 : 0, input.id],
  );
  return getFileAsset(input.id);
}

export function createFileLink(input: CreateFileLinkInput): FileLink {
  const asset = getFileAsset(input.asset_id);
  if (!asset) throw new Error(`File asset not found: ${input.asset_id}`);
  if (asset.status !== "verified") throw new Error(`File asset must be verified before linking: ${input.asset_id}`);
  if (asset.scan_status !== "clean" && asset.scan_status !== "skipped") {
    throw new Error(`File asset scan status blocks linking: ${asset.scan_status}`);
  }

  const id = `link_${nanoid(12)}`;
  getDb().run(
    `INSERT OR IGNORE INTO file_links (
      id, asset_id, org_id, company_id, app, source_type, source_id, kind, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.asset_id,
      input.org_id,
      input.company_id ?? null,
      input.app,
      input.source_type,
      input.source_id,
      input.kind,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  const row = getDb()
    .query<FileLinkRow, [string, string, string, string, string]>(
      `SELECT * FROM file_links
       WHERE asset_id = ? AND app = ? AND source_type = ? AND source_id = ? AND kind = ?`,
    )
    .get(input.asset_id, input.app, input.source_type, input.source_id, input.kind);
  return toLink(row!);
}

export function listFileLinks(assetId: string): FileLink[] {
  return getDb()
    .query<FileLinkRow, [string]>("SELECT * FROM file_links WHERE asset_id = ? ORDER BY created_at DESC")
    .all(assetId)
    .map(toLink);
}

export function createFileAccessEvent(input: CreateFileAccessEventInput): FileAccessEvent {
  const id = `evt_${nanoid(12)}`;
  getDb().run(
    `INSERT INTO file_access_events (
      id, asset_id, org_id, company_id, app, actor_id, action, purpose, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.asset_id,
      input.org_id,
      input.company_id ?? null,
      input.app ?? null,
      input.actor_id ?? null,
      input.action,
      input.purpose ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return getDb()
    .query<AccessEventRow, [string]>("SELECT * FROM file_access_events WHERE id = ?")
    .all(id)
    .map(toAccessEvent)[0]!;
}

export function listFileAccessEvents(assetId: string, limit = 50): FileAccessEvent[] {
  return getDb()
    .query<AccessEventRow, [string, number]>(
      "SELECT * FROM file_access_events WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(assetId, limit)
    .map(toAccessEvent);
}
