import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SQLQueryBindings } from "bun:sqlite";
import { getDb } from "../db/database.js";
import { listFileAssets, listFileLinks } from "../db/evidence.js";
import { getLatestFileVersion } from "../db/file-versions.js";
import { getFileTags } from "../db/tags.js";
import { getSource } from "../db/sources.js";
import { uploadBufferToS3 } from "./s3.js";
import { buildOpenFilesAssetRef, buildOpenFilesAssetRevisionRef, buildOpenFilesFileRef } from "./source-ref.js";
import { resolveKnowledgeSourceRef } from "./knowledge-resolver.js";
import type {
  FileAsset,
  FileStatus,
  KnowledgeSourceManifest,
  KnowledgeSourceManifestArtifact,
  KnowledgeSourceManifestEvidenceAssetItem,
  KnowledgeSourceManifestFileItem,
  KnowledgeSourceManifestFormat,
  KnowledgeSourceManifestItem,
  KnowledgeSourceManifestOptions,
  KnowledgeSourceManifestOutput,
  SourceType,
} from "../types/index.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DEFAULT_ALLOWED_PURPOSES = ["knowledge_index", "knowledge_answer", "agent_context"];
type ManifestAclSummary = NonNullable<KnowledgeSourceManifestFileItem["acl_summary"]>;

interface ManifestFileRow {
  id: string;
  source_id: string;
  path: string;
  name: string;
  size: number;
  mime: string;
  hash: string | null;
  status: string;
  indexed_at: string;
  modified_at: string | null;
  sync_version: number;
  source_name: string;
  source_type: string;
  source_machine_id: string;
  source_root_path: string | null;
  source_bucket: string | null;
  source_prefix: string | null;
  source_region: string | null;
  source_enabled: number;
  file_machine_id: string;
  machine_name: string | null;
  machine_hostname: string | null;
  machine_platform: string | null;
  machine_arch: string | null;
  machine_is_current: number | null;
}

interface ManifestCursor {
  sync_version: number;
  file_id: string;
  high_watermark: number;
}

interface AclSummaryRow {
  id: string;
  owner: string | null;
  review_status: string;
  acl_review_status: string;
  permission_scope: string;
  permission_risk: string;
  target_path: string | null;
  target_collection_id: string | null;
  target_project_id: string | null;
  updated_at: string;
}

export async function exportKnowledgeSourceManifest(
  opts: KnowledgeSourceManifestOptions = {},
): Promise<KnowledgeSourceManifest> {
  const generatedAt = new Date().toISOString();
  const format = opts.format ?? opts.output?.format ?? "json";
  const cursor = parseManifestCursor(opts.cursor);
  const sinceCursor = parseManifestCursor(opts.since_cursor);
  const highWatermark = cursor?.high_watermark ?? getManifestHighWatermark();
  const sinceSyncVersion = opts.since_sync_version ?? sinceCursor?.sync_version;
  const pageAfter = cursor
    ? { sync_version: cursor.sync_version, file_id: cursor.file_id }
    : { sync_version: sinceSyncVersion ?? -1, file_id: "" };
  const limit = normalizeLimit(opts.limit);
  const fileRows = listManifestFileRows({ ...opts, pageAfter, highWatermark, limit: limit + 1 });
  const hasNext = fileRows.length > limit;
  const rows = hasNext ? fileRows.slice(0, limit) : fileRows;
  const fileItems = await Promise.all(rows.map((row) => buildFileItem(row, opts.purpose ?? "knowledge_index", opts)));
  const evidenceItems = opts.include_evidence_assets ? buildEvidenceItems(opts) : [];
  const items: KnowledgeSourceManifestItem[] = [...fileItems, ...evidenceItems];
  const lastRow = rows.at(-1);
  const nextCursor = hasNext && lastRow
    ? buildManifestCursor({
        sync_version: lastRow.sync_version,
        file_id: lastRow.id,
        high_watermark: highWatermark,
      })
    : undefined;
  const deltaCursor = buildManifestCursor({
    sync_version: highWatermark,
    file_id: "",
    high_watermark: highWatermark,
  });

  const manifest: KnowledgeSourceManifest = {
    manifest_id: buildManifestId(generatedAt, opts, items),
    generated_at: generatedAt,
    format,
    filters: manifestFilters(opts),
    item_count: items.length,
    cursor: opts.cursor,
    next_cursor: nextCursor,
    delta: Boolean(opts.delta || opts.since_cursor || opts.since_sync_version !== undefined),
    high_watermark: highWatermark,
    delta_cursor: deltaCursor,
    tombstone_count: fileItems.filter((item) => item.tombstone).length,
    items,
  };

  if (opts.output) {
    manifest.artifact = await writeKnowledgeSourceManifestArtifact(manifest, opts.output);
  }

  return manifest;
}

export function formatKnowledgeSourceManifest(
  manifest: KnowledgeSourceManifest,
  format: KnowledgeSourceManifestFormat = manifest.format,
): string {
  if (format === "jsonl") {
    return manifest.items.map((item) => JSON.stringify(item)).join("\n") + (manifest.items.length ? "\n" : "");
  }
  return JSON.stringify(manifest, null, 2);
}

export async function writeKnowledgeSourceManifestArtifact(
  manifest: KnowledgeSourceManifest,
  output: KnowledgeSourceManifestOutput,
): Promise<KnowledgeSourceManifestArtifact> {
  const format = output.format ?? manifest.format;
  const body = formatKnowledgeSourceManifest(manifest, format);
  const bytes = Buffer.byteLength(body);

  if (output.provider === "local") {
    if (!output.path) throw new Error("Local manifest output requires path.");
    mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, body);
    return {
      provider: "local",
      format,
      bytes,
      path: output.path,
    };
  }

  if (!output.source_id) throw new Error("S3 manifest output requires source_id.");
  if (!output.key) throw new Error("S3 manifest output requires key.");
  const source = getSource(output.source_id);
  if (!source) throw new Error(`S3 manifest output source not found: ${output.source_id}`);
  if (!source.enabled) throw new Error(`S3 manifest output source is disabled: ${output.source_id}`);
  if (source.type !== "s3" || !source.bucket) throw new Error(`Manifest output source must be an enabled S3 source: ${output.source_id}`);

  await uploadBufferToS3(
    source,
    Buffer.from(body),
    output.key,
    format === "jsonl" ? "application/x-ndjson" : "application/json",
    bytes,
  );

  return {
    provider: "s3",
    format,
    bytes,
    source_id: output.source_id,
    bucket: source.bucket,
    region: source.region,
    key: output.key,
  };
}

function listManifestFileRows(opts: KnowledgeSourceManifestOptions & {
  pageAfter: { sync_version: number; file_id: string };
  highWatermark: number;
  limit: number;
}): ManifestFileRow[] {
  const conditions: string[] = [];
  const joins: string[] = [
    "JOIN sources s ON s.id = f.source_id",
    "LEFT JOIN machines m ON m.id = f.machine_id",
  ];
  const joinParams: SQLQueryBindings[] = [];
  const whereParams: SQLQueryBindings[] = [];

  if (opts.status && opts.status !== "all") {
    conditions.push("f.status = ?");
    whereParams.push(opts.status);
  } else if (!opts.include_deleted && !opts.delta && opts.status !== "all") {
    conditions.push("f.status = 'active'");
  }

  conditions.push("f.sync_version <= ?");
  whereParams.push(opts.highWatermark);
  conditions.push("(f.sync_version > ? OR (f.sync_version = ? AND f.id > ?))");
  whereParams.push(opts.pageAfter.sync_version, opts.pageAfter.sync_version, opts.pageAfter.file_id);

  if (opts.source_id) {
    conditions.push("f.source_id = ?");
    whereParams.push(opts.source_id);
  }
  if (opts.collection_id) {
    joins.push("JOIN collection_files cf_filter ON cf_filter.file_id = f.id AND cf_filter.collection_id = ?");
    joinParams.push(opts.collection_id);
  }
  if (opts.project_id) {
    joins.push("JOIN project_files pf_filter ON pf_filter.file_id = f.id AND pf_filter.project_id = ?");
    joinParams.push(opts.project_id);
  }
  if (opts.tag) {
    joins.push("JOIN file_tags ft_filter ON ft_filter.file_id = f.id JOIN tags t_filter ON t_filter.id = ft_filter.tag_id AND t_filter.name = ?");
    joinParams.push(opts.tag.toLowerCase());
  }
  if (opts.after) {
    conditions.push("COALESCE(f.modified_at, f.indexed_at) >= ?");
    whereParams.push(opts.after);
  }
  if (opts.before) {
    conditions.push("COALESCE(f.modified_at, f.indexed_at) <= ?");
    whereParams.push(opts.before);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return getDb()
    .query<ManifestFileRow, SQLQueryBindings[]>(
      `SELECT DISTINCT
         f.id, f.source_id, f.path, f.name, f.size, f.mime, f.hash, f.status,
         f.indexed_at, f.modified_at, f.sync_version,
         s.name AS source_name, s.type AS source_type,
         s.machine_id AS source_machine_id, s.path AS source_root_path,
         s.bucket AS source_bucket, s.prefix AS source_prefix, s.region AS source_region,
         s.enabled AS source_enabled,
         f.machine_id AS file_machine_id, m.name AS machine_name, m.hostname AS machine_hostname,
         m.platform AS machine_platform, m.arch AS machine_arch, m.is_current AS machine_is_current
       FROM files f
       ${joins.join(" ")}
       ${where}
       ORDER BY f.sync_version ASC, f.id ASC
       LIMIT ?`,
    )
    .all(...joinParams, ...whereParams, opts.limit);
}

async function buildFileItem(
  row: ManifestFileRow,
  purpose: string,
  opts: KnowledgeSourceManifestOptions,
): Promise<KnowledgeSourceManifestFileItem> {
  const sourceRef = buildOpenFilesFileRef(row.id);
  const version = getLatestFileVersion(row.id);
  const tags = getFileTags(row.id).map((tag) => tag.name);
  const resolution = await resolveKnowledgeSourceRef(sourceRef, {
    mode: "metadata",
    purpose,
    allowed_purposes: [purpose],
  });
  const textAvailable = resolution.content.text_available;
  const storage = resolution.storage;
  const hash = formatHash(version?.content_hash_algorithm, version?.content_hash ?? row.hash ?? undefined);

  return {
    kind: "file",
    source_ref: sourceRef,
    revision_ref: version?.source_ref,
    revision_id: version?.id,
    s3_object_id: version?.s3_object_id,
    sync_version: row.sync_version,
    source_revision_hash: buildSourceRevisionHash(row, version?.id, hash),
    file_id: row.id,
    source_id: row.source_id,
    source_name: row.source_name,
    source_type: row.source_type as SourceType,
    path: row.path,
    name: row.name,
    mime: row.mime,
    size: row.size,
    hash,
    status: row.status as FileStatus,
    updated_at: row.modified_at ?? row.indexed_at,
    deleted: row.status === "deleted",
    tombstone: row.status === "deleted" ? true : undefined,
    tags,
    open_files_root: buildOpenFilesRootEvidence(row),
    storage,
    extraction: {
      text_available: textAvailable,
      status: textAvailable ? "available" : "unsupported",
      extracted_text_ref: resolution.content.extracted_text_ref,
    },
    permissions: {
      mode: "read_only",
      allowed_purposes: DEFAULT_ALLOWED_PURPOSES,
    },
    acl_summary: opts.include_acl_summary ? getAclSummary(row.id) : undefined,
    permission_labels: buildFilePermissionLabels(row, storage?.provider),
  };
}

function buildEvidenceItems(opts: KnowledgeSourceManifestOptions): KnowledgeSourceManifestEvidenceAssetItem[] {
  return listFileAssets({
    ...opts.evidence,
    limit: opts.evidence?.limit ?? DEFAULT_LIMIT,
    offset: opts.evidence?.offset ?? 0,
  }).map(toEvidenceItem);
}

function toEvidenceItem(asset: FileAsset): KnowledgeSourceManifestEvidenceAssetItem {
  const sourceRef = buildOpenFilesAssetRef(asset.id);
  const revisionId = buildEvidenceAssetRevisionId(asset);
  return {
    kind: "evidence_asset",
    source_ref: sourceRef,
    asset_ref: sourceRef,
    revision_ref: buildOpenFilesAssetRevisionRef(asset.id, revisionId),
    revision_id: revisionId,
    source_revision_hash: buildEvidenceAssetRevisionHash(asset, revisionId),
    asset_id: asset.id,
    org_id: asset.org_id,
    company_id: asset.company_id,
    app: asset.app,
    asset_kind: asset.kind,
    classification: asset.classification,
    original_name: asset.original_name,
    mime: asset.content_type,
    size: asset.size,
    hash: `${asset.checksum_algorithm}:${asset.checksum}`,
    status: asset.status,
    scan_status: asset.scan_status,
    updated_at: asset.updated_at,
    storage: {
      provider: asset.storage_provider,
      bucket: asset.bucket,
      region: asset.region,
      key: asset.object_key,
    },
    links: listFileLinks(asset.id),
    permissions: {
      mode: "read_only",
      allowed_purposes: DEFAULT_ALLOWED_PURPOSES,
      write: false,
    },
    redaction: {
      status: "metadata_only",
      metadata_only: true,
      raw_bytes_copied: false,
      raw_text_copied: false,
      private_inventory_copied: false,
      secret_values_copied: false,
    },
    permission_labels: buildEvidencePermissionLabels(asset),
  };
}

function buildOpenFilesRootEvidence(row: ManifestFileRow): KnowledgeSourceManifestFileItem["open_files_root"] {
  const machineId = row.file_machine_id || row.source_machine_id;
  const evidence = {
    open_files_root: `open-files://source/${encodeURIComponent(row.source_id)}`,
    source_id: row.source_id,
    source_type: row.source_type as SourceType,
    source_path: row.path,
    machine: {
      machine_id: machineId,
      name: row.machine_name ?? undefined,
      hostname: row.machine_hostname ?? undefined,
      platform: row.machine_platform ?? undefined,
      arch: row.machine_arch ?? undefined,
      is_current: row.machine_is_current === null ? undefined : row.machine_is_current === 1,
    },
    local: row.source_root_path ? { path: row.source_root_path } : undefined,
    s3: row.source_bucket ? {
      bucket: row.source_bucket,
      prefix: row.source_prefix ?? undefined,
      region: row.source_region ?? undefined,
    } : undefined,
    evidence_hash: "",
  };
  return {
    ...evidence,
    evidence_hash: buildRootEvidenceHash(evidence),
  };
}

function buildRootEvidenceHash(evidence: Omit<KnowledgeSourceManifestFileItem["open_files_root"], "evidence_hash">): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    open_files_root: evidence.open_files_root,
    source_id: evidence.source_id,
    source_type: evidence.source_type,
    source_path: evidence.source_path,
    machine_id: evidence.machine.machine_id,
    hostname: evidence.machine.hostname,
    local_path: evidence.local?.path,
    s3_bucket: evidence.s3?.bucket,
    s3_prefix: evidence.s3?.prefix,
    s3_region: evidence.s3?.region,
  })).digest("hex")}`;
}

function buildFilePermissionLabels(row: ManifestFileRow, storageProvider: string | undefined): string[] {
  return [
    "read_only",
    row.source_enabled === 1 ? "source_enabled" : "source_disabled",
    `source_type:${row.source_type}`,
    `storage:${storageProvider ?? "unknown"}`,
    `status:${row.status}`,
  ];
}

function buildEvidencePermissionLabels(asset: FileAsset): string[] {
  return [
    "read_only",
    "metadata_only",
    "raw_bytes_owned_by:open-files",
    `asset_status:${asset.status}`,
    `scan_status:${asset.scan_status}`,
    `classification:${asset.classification}`,
    `storage:${asset.storage_provider}`,
  ];
}

function buildEvidenceAssetRevisionId(asset: FileAsset): string {
  return `assetrev_${createHash("sha256").update(JSON.stringify({
    asset_id: asset.id,
    checksum_algorithm: asset.checksum_algorithm,
    checksum: asset.checksum,
    size: asset.size,
    status: asset.status,
    scan_status: asset.scan_status,
    updated_at: asset.updated_at,
  })).digest("hex").slice(0, 24)}`;
}

function buildEvidenceAssetRevisionHash(asset: FileAsset, revisionId: string): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    asset_id: asset.id,
    revision_id: revisionId,
    org_id: asset.org_id,
    company_id: asset.company_id,
    app: asset.app,
    kind: asset.kind,
    classification: asset.classification,
    content_type: asset.content_type,
    size: asset.size,
    checksum_algorithm: asset.checksum_algorithm,
    checksum: asset.checksum,
    storage_provider: asset.storage_provider,
    bucket: asset.bucket,
    region: asset.region,
    object_key: asset.object_key,
    status: asset.status,
    scan_status: asset.scan_status,
    updated_at: asset.updated_at,
  })).digest("hex")}`;
}

function manifestFilters(opts: KnowledgeSourceManifestOptions): Record<string, unknown> {
  return {
    source_id: opts.source_id,
    collection_id: opts.collection_id,
    tag: opts.tag,
    project_id: opts.project_id,
    status: opts.status ?? (opts.include_deleted ? "all" : "active"),
    delta: opts.delta ?? false,
    since_cursor: opts.since_cursor,
    since_sync_version: opts.since_sync_version,
    include_acl_summary: opts.include_acl_summary ?? false,
    after: opts.after,
    before: opts.before,
    include_evidence_assets: opts.include_evidence_assets ?? false,
    evidence: opts.evidence,
  };
}

function parseManifestCursor(cursor: string | undefined): ManifestCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const syncVersion = Number((parsed as { sync_version?: unknown }).sync_version);
    const fileId = String((parsed as { file_id?: unknown }).file_id ?? "");
    const highWatermark = Number((parsed as { high_watermark?: unknown }).high_watermark ?? syncVersion);
    if (!Number.isInteger(syncVersion) || syncVersion < 0) return null;
    if (!Number.isInteger(highWatermark) || highWatermark < 0) return null;
    return { sync_version: syncVersion, file_id: fileId, high_watermark: highWatermark };
  } catch {
    return null;
  }
}

function buildManifestCursor(cursor: ManifestCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_LIMIT)) return DEFAULT_LIMIT;
  const normalized = Math.floor(value ?? DEFAULT_LIMIT);
  if (normalized <= 0) return DEFAULT_LIMIT;
  return Math.min(normalized, MAX_LIMIT);
}

function buildManifestId(
  generatedAt: string,
  opts: KnowledgeSourceManifestOptions,
  items: KnowledgeSourceManifestItem[],
): string {
  return `manifest_${createHash("sha256")
    .update(JSON.stringify({ generatedAt, filters: manifestFilters(opts), item_ids: itemIds(items) }))
    .digest("hex")
    .slice(0, 24)}`;
}

function itemIds(items: KnowledgeSourceManifestItem[]): string[] {
  return items.map((item) => item.kind === "file" ? item.file_id : item.asset_id);
}

function formatHash(algorithm: string | undefined, hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  if (!algorithm || algorithm === "unknown") return hash;
  return `${algorithm}:${hash}`;
}

function getManifestHighWatermark(): number {
  return getDb().query<{ max_sync_version: number }, []>(
    "SELECT COALESCE(MAX(sync_version), 0) AS max_sync_version FROM files",
  ).get()?.max_sync_version ?? 0;
}

function buildSourceRevisionHash(row: ManifestFileRow, revisionId: string | undefined, hash: string | undefined): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    file_id: row.id,
    source_id: row.source_id,
    path: row.path,
    revision_id: revisionId,
    hash,
    size: row.size,
    mime: row.mime,
    status: row.status,
    sync_version: row.sync_version,
    source_machine_id: row.source_machine_id,
    file_machine_id: row.file_machine_id,
    source_root_path: row.source_root_path,
    source_bucket: row.source_bucket,
    source_prefix: row.source_prefix,
    source_region: row.source_region,
  })).digest("hex")}`;
}

function getAclSummary(fileId: string): KnowledgeSourceManifestFileItem["acl_summary"] {
  const row = getDb().query<AclSummaryRow, [string]>(
    `SELECT id, owner, review_status, acl_review_status, permission_scope,
            permission_risk, target_path, target_collection_id,
            target_project_id, updated_at
     FROM file_organization_reviews
     WHERE file_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  ).get(fileId);
  if (!row) return undefined;
  return {
    review_id: row.id,
    owner: row.owner ?? undefined,
    review_status: row.review_status as ManifestAclSummary["review_status"],
    acl_review_status: row.acl_review_status as ManifestAclSummary["acl_review_status"],
    permission_scope: row.permission_scope as ManifestAclSummary["permission_scope"],
    permission_risk: row.permission_risk as ManifestAclSummary["permission_risk"],
    target_path: row.target_path ?? undefined,
    target_collection_id: row.target_collection_id ?? undefined,
    target_project_id: row.target_project_id ?? undefined,
    updated_at: row.updated_at,
  };
}
