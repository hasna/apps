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
import {
  buildManifestCursor,
  buildManifestEnvelope,
  buildManifestFileItem,
  formatKnowledgeSourceManifest,
  MANIFEST_ALLOWED_PURPOSES,
  MANIFEST_DEFAULT_LIMIT,
  normalizeManifestLimit,
  parseManifestCursor,
  type ManifestFileRow,
} from "./knowledge-manifest-shared.js";

export { formatKnowledgeSourceManifest } from "./knowledge-manifest-shared.js";
import { resolveKnowledgeSourceRef } from "./knowledge-resolver.js";
import type {
  FileAsset,
  KnowledgeSourceManifest,
  KnowledgeSourceManifestArtifact,
  KnowledgeSourceManifestEvidenceAssetItem,
  KnowledgeSourceManifestFileItem,
  KnowledgeSourceManifestItem,
  KnowledgeSourceManifestOptions,
  KnowledgeSourceManifestOutput,
} from "../types/index.js";

type ManifestAclSummary = NonNullable<KnowledgeSourceManifestFileItem["acl_summary"]>;

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
  const limit = normalizeManifestLimit(opts.limit);
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
  const manifest = buildManifestEnvelope({
    generated_at: generatedAt,
    format,
    opts,
    items,
    high_watermark: highWatermark,
    next_cursor: nextCursor,
  });

  if (opts.output) {
    manifest.artifact = await writeKnowledgeSourceManifestArtifact(manifest, opts.output);
  }

  return manifest;
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
  const version = getLatestFileVersion(row.id);
  const resolution = await resolveKnowledgeSourceRef(buildOpenFilesFileRef(row.id), {
    mode: "metadata",
    purpose,
    allowed_purposes: [purpose],
  });
  return buildManifestFileItem(row, {
    revision_ref: version?.source_ref,
    revision_id: version?.id,
    s3_object_id: version?.s3_object_id,
    content_hash_algorithm: version?.content_hash_algorithm,
    content_hash: version?.content_hash,
    tags: getFileTags(row.id).map((tag) => tag.name),
    text_available: resolution.content.text_available,
    storage: resolution.storage,
    acl_summary: opts.include_acl_summary ? getAclSummary(row.id) : undefined,
  });
}

function buildEvidenceItems(opts: KnowledgeSourceManifestOptions): KnowledgeSourceManifestEvidenceAssetItem[] {
  return listFileAssets({
    ...opts.evidence,
    limit: opts.evidence?.limit ?? MANIFEST_DEFAULT_LIMIT,
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
      allowed_purposes: MANIFEST_ALLOWED_PURPOSES,
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

function getManifestHighWatermark(): number {
  return getDb().query<{ max_sync_version: number }, []>(
    "SELECT COALESCE(MAX(sync_version), 0) AS max_sync_version FROM files",
  ).get()?.max_sync_version ?? 0;
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
