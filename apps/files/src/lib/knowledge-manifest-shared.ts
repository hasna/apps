/**
 * Transport-independent knowledge-manifest pieces.
 *
 * The manifest envelope — cursor encoding, the stable `manifest_id`, the echoed
 * filter set, the per-file `open_files_root` evidence and its hash, the
 * `source_revision_hash`, permission labels and the JSON/JSONL rendering — is
 * pure: it is a function of a manifest row and the caller's options, with no
 * store behind it.
 *
 * Both producers import it. The on-box exporter (`knowledge-manifest.ts`) reads
 * SQLite behind the local opt-in; the hosted service builds the same manifest
 * from Postgres in `GET /v1/knowledge/manifest`. Sharing these keeps the two
 * byte-compatible — a cursor minted by one is readable by the other, and the
 * `knowledge` app sees one contract on both transports.
 *
 * Nothing here may import a store, `bun:sqlite`, `@aws-sdk/*` or the filesystem:
 * `-serve` imports this module.
 */
import { createHash } from "node:crypto";
import type {
  KnowledgeSourceManifest,
  KnowledgeSourceManifestFileItem,
  KnowledgeSourceManifestFormat,
  KnowledgeSourceManifestItem,
  KnowledgeSourceManifestOptions,
  SourceType,
} from "../types/index.js";

export const MANIFEST_DEFAULT_LIMIT = 100;
export const MANIFEST_MAX_LIMIT = 1000;
export const MANIFEST_ALLOWED_PURPOSES = ["knowledge_index", "knowledge_answer", "agent_context"];

/**
 * One manifest row as both stores produce it. `source_enabled` and
 * `machine_is_current` are integers because SQLite has no boolean; the Postgres
 * query casts with `::int` so a single row shape serves both.
 */
export interface ManifestFileRow {
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

export interface ManifestCursor {
  sync_version: number;
  file_id: string;
  high_watermark: number;
}

export function buildOpenFilesRootEvidence(row: ManifestFileRow): KnowledgeSourceManifestFileItem["open_files_root"] {
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

export function buildRootEvidenceHash(evidence: Omit<KnowledgeSourceManifestFileItem["open_files_root"], "evidence_hash">): string {
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

export function buildFilePermissionLabels(row: ManifestFileRow, storageProvider: string | undefined): string[] {
  return [
    "read_only",
    row.source_enabled === 1 ? "source_enabled" : "source_disabled",
    `source_type:${row.source_type}`,
    `storage:${storageProvider ?? "unknown"}`,
    `status:${row.status}`,
  ];
}

export function manifestFilters(opts: KnowledgeSourceManifestOptions): Record<string, unknown> {
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

export function parseManifestCursor(cursor: string | undefined): ManifestCursor | null {
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

export function buildManifestCursor(cursor: ManifestCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function normalizeManifestLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? MANIFEST_DEFAULT_LIMIT)) return MANIFEST_DEFAULT_LIMIT;
  const normalized = Math.floor(value ?? MANIFEST_DEFAULT_LIMIT);
  if (normalized <= 0) return MANIFEST_DEFAULT_LIMIT;
  return Math.min(normalized, MANIFEST_MAX_LIMIT);
}

export function buildManifestId(
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

export function formatHash(algorithm: string | undefined, hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  if (!algorithm || algorithm === "unknown") return hash;
  return `${algorithm}:${hash}`;
}

export function buildSourceRevisionHash(row: ManifestFileRow, revisionId: string | undefined, hash: string | undefined): string {
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

/** Render a manifest as the caller asked for it. */
export function formatKnowledgeSourceManifest(
  manifest: KnowledgeSourceManifest,
  format: KnowledgeSourceManifestFormat = manifest.format,
): string {
  if (format === "jsonl") {
    return manifest.items.map((item) => JSON.stringify(item)).join("\n") + (manifest.items.length ? "\n" : "");
  }
  return JSON.stringify(manifest, null, 2);
}

/** Inputs a store must supply per row; everything else is derived here. */
export interface ManifestFileItemInputs {
  revision_ref?: string;
  revision_id?: string;
  s3_object_id?: string;
  content_hash_algorithm?: string;
  content_hash?: string;
  tags: string[];
  text_available: boolean;
  storage?: KnowledgeSourceManifestFileItem["storage"];
  acl_summary?: KnowledgeSourceManifestFileItem["acl_summary"];
}

/** Build one manifest file item. Identical on both transports by construction. */
export function buildManifestFileItem(
  row: ManifestFileRow,
  inputs: ManifestFileItemInputs,
): KnowledgeSourceManifestFileItem {
  const sourceRef = `open-files://file/${encodeURIComponent(row.id)}`;
  const hash = formatHash(inputs.content_hash_algorithm, inputs.content_hash ?? row.hash ?? undefined);
  return {
    kind: "file",
    source_ref: sourceRef,
    revision_ref: inputs.revision_ref,
    revision_id: inputs.revision_id,
    s3_object_id: inputs.s3_object_id,
    sync_version: row.sync_version,
    source_revision_hash: buildSourceRevisionHash(row, inputs.revision_id, hash),
    file_id: row.id,
    source_id: row.source_id,
    source_name: row.source_name,
    source_type: row.source_type as SourceType,
    path: row.path,
    name: row.name,
    mime: row.mime,
    size: row.size,
    hash,
    status: row.status as KnowledgeSourceManifestFileItem["status"],
    updated_at: row.modified_at ?? row.indexed_at,
    deleted: row.status === "deleted",
    tombstone: row.status === "deleted" ? true : undefined,
    tags: inputs.tags,
    open_files_root: buildOpenFilesRootEvidence(row),
    storage: inputs.storage,
    extraction: {
      text_available: inputs.text_available,
      status: inputs.text_available ? "available" : "unsupported",
      extracted_text_ref: inputs.text_available ? `${sourceRef}/text` : undefined,
    },
    permissions: {
      mode: "read_only",
      allowed_purposes: MANIFEST_ALLOWED_PURPOSES,
    },
    acl_summary: inputs.acl_summary,
    permission_labels: buildFilePermissionLabels(row, inputs.storage?.provider),
  };
}

/**
 * Assemble the manifest envelope from already-built items. `high_watermark`
 * and the page cursor come from the store; everything else is derived.
 */
export function buildManifestEnvelope(input: {
  generated_at: string;
  format: KnowledgeSourceManifestFormat;
  opts: KnowledgeSourceManifestOptions;
  items: KnowledgeSourceManifestItem[];
  high_watermark: number;
  next_cursor?: string;
}): KnowledgeSourceManifest {
  const { generated_at, format, opts, items, high_watermark, next_cursor } = input;
  return {
    manifest_id: buildManifestId(generated_at, opts, items),
    generated_at,
    format,
    filters: manifestFilters(opts),
    item_count: items.length,
    cursor: opts.cursor,
    next_cursor,
    delta: Boolean(opts.delta || opts.since_cursor || opts.since_sync_version !== undefined),
    high_watermark,
    delta_cursor: buildManifestCursor({ sync_version: high_watermark, file_id: "", high_watermark }),
    tombstone_count: items.filter((item) => item.kind === "file" && item.tombstone).length,
    items,
  };
}
