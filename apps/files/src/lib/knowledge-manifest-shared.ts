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
 * Privacy-minimized, canonical filter attestation for the hosted manifest.
 *
 * Pagination controls and signed cursors are deliberately excluded: they do
 * not change the selected population. Every property here is applied by the
 * hosted query and is therefore safe for a client to compare exactly with its
 * request, including on continuation pages.
 */
export interface HostedKnowledgeManifestFilters {
  source_id?: string;
  collection_id?: string;
  project_id?: string;
  tag?: string;
  status: "active" | "deleted" | "moved" | "all";
  delta: boolean;
  after?: string;
  before?: string;
}

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



/** Safe, tenant-bound snapshot persisted by the hosted PostgreSQL change log. */
export interface HostedManifestSnapshot {
  file_id: string;
  source_id: string;
  source_type: SourceType;
  source_enabled: boolean;
  name: string;
  mime: string;
  size: number;
  hash?: string;
  status: "active" | "deleted" | "moved";
  indexed_at: string;
  modified_at?: string;
  tags: string[];
  project_ids: string[];
  collection_ids: string[];
  revision?: {
    id: string;
    source_ref: string;
    content_hash_algorithm?: string;
    content_hash?: string;
  };
  extraction: {
    status: "ready" | "partial" | "unsupported" | "error" | "stale" | "unavailable";
    revision_id?: string;
  };
}

export interface HostedManifestChangeRow {
  cursor: string;
  file_id: string;
  snapshot: HostedManifestSnapshot;
}

export function parseHostedManifestChangeRow(value: Record<string, unknown>): HostedManifestChangeRow {
  const cursor = typeof value.cursor === "string" ? value.cursor : String(value.cursor ?? "");
  const fileId = typeof value.file_id === "string" ? value.file_id : "";
  const raw = typeof value.snapshot === "string"
    ? (() => { try { return JSON.parse(value.snapshot) as unknown; } catch { return null; } })()
    : value.snapshot;
  if (!/^(0|[1-9][0-9]*)$/.test(cursor) || !fileId || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
  }
  const snapshot = raw as Record<string, unknown>;
  const stringValue = (key: string, required = true): string | undefined => {
    const candidate = snapshot[key];
    if (candidate === undefined || candidate === null) {
      if (required) throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
      return undefined;
    }
    if (!isNonBlankString(candidate)) {
      throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
    }
    return candidate;
  };
  const stringArray = (key: string, requireNonBlank = false): string[] => {
    const candidate = snapshot[key];
    if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== "string" || (requireNonBlank && !isNonBlankString(entry)))) {
      throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
    }
    return [...candidate] as string[];
  };
  const sourceType = stringValue("source_type")!;
  const status = stringValue("status")!;
  if (!["local", "s3", "google_drive"].includes(sourceType) || !["active", "deleted", "moved"].includes(status)) {
    throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
  }
  const size = Number(snapshot.size);
  if (!Number.isSafeInteger(size) || size < 0 || typeof snapshot.source_enabled !== "boolean") {
    throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
  }
  const rawRevision = snapshot.revision;
  let revision: HostedManifestSnapshot["revision"];
  if (rawRevision !== undefined && rawRevision !== null) {
    if (typeof rawRevision !== "object" || Array.isArray(rawRevision)) throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
    const revisionRecord = rawRevision as Record<string, unknown>;
    if (!isNonBlankString(revisionRecord.id) || !isNonBlankString(revisionRecord.source_ref)) {
      throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
    }
    for (const key of ["content_hash_algorithm", "content_hash"] as const) {
      if (revisionRecord[key] !== undefined && !isNonBlankString(revisionRecord[key])) {
        throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
      }
    }
    revision = {
      id: revisionRecord.id,
      source_ref: revisionRecord.source_ref,
      content_hash_algorithm: revisionRecord.content_hash_algorithm as string | undefined,
      content_hash: revisionRecord.content_hash as string | undefined,
    };
  }
  const rawExtraction = snapshot.extraction;
  if (!rawExtraction || typeof rawExtraction !== "object" || Array.isArray(rawExtraction)) {
    throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
  }
  const extractionRecord = rawExtraction as Record<string, unknown>;
  const extractionStatus = extractionRecord.status;
  if (typeof extractionStatus !== "string" || !["ready", "partial", "unsupported", "error", "stale", "unavailable"].includes(extractionStatus)) {
    throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
  }
  const snapshotFileId = stringValue("file_id")!;
  const indexedAt = stringValue("indexed_at")!;
  const modifiedAt = stringValue("modified_at", false);
  if (snapshotFileId !== fileId) throw new Error("Hosted knowledge manifest store returned a mismatched change snapshot.");
  if (!isValidIsoDateTime(indexedAt) || (modifiedAt !== undefined && !isValidIsoDateTime(modifiedAt))) {
    throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
  }
  if (extractionRecord.revision_id !== undefined && !isNonBlankString(extractionRecord.revision_id)) {
    throw new Error("Hosted knowledge manifest store returned a malformed change snapshot.");
  }
  return {
    cursor,
    file_id: fileId,
    snapshot: {
      file_id: snapshotFileId,
      source_id: stringValue("source_id")!,
      source_type: sourceType as SourceType,
      source_enabled: snapshot.source_enabled,
      name: stringValue("name")!,
      mime: stringValue("mime")!,
      size,
      hash: stringValue("hash", false),
      status: status as HostedManifestSnapshot["status"],
      indexed_at: indexedAt,
      modified_at: modifiedAt,
      tags: stringArray("tags"),
      project_ids: stringArray("project_ids", true),
      collection_ids: stringArray("collection_ids", true),
      revision,
      extraction: {
        status: extractionStatus as HostedManifestSnapshot["extraction"]["status"],
        revision_id: extractionRecord.revision_id as string | undefined,
      },
    },
  };
}

/** Build public root evidence without machine, path, or object-store coordinates. */
export function buildHostedOpenFilesRootEvidence(
  snapshot: HostedManifestSnapshot,
): KnowledgeSourceManifestFileItem["open_files_root"] {
  const evidence = {
    open_files_root: `open-files://source/${encodeURIComponent(snapshot.source_id)}`,
    source_id: snapshot.source_id,
    source_type: snapshot.source_type,
  };
  return {
    ...evidence,
    evidence_hash: `sha256:${createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}`,
  };
}

/**
 * Convert one immutable hosted change snapshot to the public manifest item.
 * The snapshot intentionally contains no station identity, local path, bucket,
 * prefix, region, or object key, so derived hashes cannot correlate them.
 */
export function buildHostedManifestFileItem(
  row: HostedManifestChangeRow,
): KnowledgeSourceManifestFileItem {
  const snapshot = row.snapshot;
  const sourceRef = `open-files://file/${encodeURIComponent(snapshot.file_id)}`;
  const revisionHash = formatHash(
    snapshot.revision?.content_hash_algorithm,
    snapshot.revision?.content_hash ?? snapshot.hash,
  );
  const extractionAvailable = (snapshot.extraction.status === "ready" || snapshot.extraction.status === "partial")
    && snapshot.revision !== undefined
    && snapshot.extraction.revision_id === snapshot.revision.id
    && snapshot.status !== "deleted";
  const extractionStatus = extractionAvailable
    ? snapshot.extraction.status === "partial" ? "partial" : "available"
    : snapshot.status === "deleted" || snapshot.extraction.status === "ready" || snapshot.extraction.status === "partial"
      ? "unavailable"
      : snapshot.extraction.status;
  return {
    kind: "file",
    source_ref: sourceRef,
    revision_ref: snapshot.revision?.source_ref,
    revision_id: snapshot.revision?.id,
    change_cursor: row.cursor,
    source_revision_hash: `sha256:${createHash("sha256").update(JSON.stringify({
      file_id: snapshot.file_id,
      source_id: snapshot.source_id,
      revision_id: snapshot.revision?.id,
      hash: revisionHash,
      status: snapshot.status,
    })).digest("hex")}`,
    file_id: snapshot.file_id,
    source_id: snapshot.source_id,
    source_type: snapshot.source_type,
    name: snapshot.name,
    mime: snapshot.mime,
    size: snapshot.size,
    hash: revisionHash,
    status: snapshot.status,
    updated_at: snapshot.modified_at ?? snapshot.indexed_at,
    deleted: snapshot.status === "deleted",
    tombstone: snapshot.status === "deleted" ? true : undefined,
    tags: snapshot.tags,
    open_files_root: buildHostedOpenFilesRootEvidence(snapshot),
    storage: { provider: snapshot.source_type === "s3" ? "s3" : snapshot.source_type === "local" ? "local" : "unknown", source_id: snapshot.source_id },
    extraction: {
      text_available: extractionAvailable,
      status: extractionStatus,
      extracted_text_ref: extractionAvailable ? `${sourceRef}/text` : undefined,
      status_reason: extractionAvailable
        ? undefined
        : snapshot.status === "deleted"
          ? "file_deleted"
          : snapshot.revision === undefined
            ? "revision_unavailable"
            : snapshot.extraction.status === "unavailable"
              ? "materialized_extraction_unavailable"
              : `materialized_extraction_${snapshot.extraction.status}`,
    },
    permissions: {
      mode: "read_only",
      allowed_purposes: MANIFEST_ALLOWED_PURPOSES,
    },
    permission_labels: [
      "read_only",
      snapshot.source_enabled ? "source_enabled" : "source_disabled",
      `source_type:${snapshot.source_type}`,
      `storage:${snapshot.source_type === "s3" ? "s3" : snapshot.source_type === "local" ? "local" : "unknown"}`,
      `status:${snapshot.status}`,
    ],
  };
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
    machine_id: evidence.machine?.machine_id,
    hostname: evidence.machine?.hostname,
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

/** Return the exact closed filter set applied by the hosted PostgreSQL query. */
export function hostedManifestFilters(
  opts: KnowledgeSourceManifestOptions,
): HostedKnowledgeManifestFilters & Record<string, unknown> {
  const delta = Boolean(opts.delta || opts.since_cursor);
  return compactObject({
    source_id: opts.source_id,
    collection_id: opts.collection_id,
    project_id: opts.project_id,
    tag: opts.tag === undefined ? undefined : opts.tag.trim().toLowerCase(),
    status: opts.status ?? (opts.include_deleted || delta ? "all" : "active"),
    delta,
    after: opts.after,
    before: opts.before,
  }) as unknown as HostedKnowledgeManifestFilters & Record<string, unknown>;
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
  filters: Record<string, unknown> = manifestFilters(opts),
): string {
  return `manifest_${createHash("sha256")
    .update(JSON.stringify({ generatedAt, filters, item_ids: itemIds(items) }))
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
  high_watermark: number | string;
  next_cursor?: string;
  filter_contract?: "files.knowledge.manifest.v1";
  cursor_contract?: "files.knowledge.manifest.local-sync.v1" | "files.knowledge.manifest.change.v1";
  delta_cursor?: string;
  has_more?: boolean;
  complete?: boolean;
  filters?: Record<string, unknown>;
}): KnowledgeSourceManifest {
  const { generated_at, format, opts, items, high_watermark, next_cursor } = input;
  const filters = input.filters ?? manifestFilters(opts);
  return {
    filter_contract: input.filter_contract,
    cursor_contract: input.cursor_contract,
    manifest_id: buildManifestId(generated_at, opts, items, filters),
    generated_at,
    format,
    filters,
    item_count: items.length,
    cursor: opts.cursor,
    next_cursor,
    has_more: input.has_more,
    complete: input.complete,
    delta: Boolean(opts.delta || opts.since_cursor || opts.since_sync_version !== undefined),
    high_watermark,
    delta_cursor: input.delta_cursor ?? (() => {
      if (typeof high_watermark !== "number") throw new Error("Hosted manifests require an explicit signed delta cursor.");
      return buildManifestCursor({ sync_version: high_watermark, file_id: "", high_watermark });
    })(),
    tombstone_count: items.filter((item) => item.kind === "file" && item.tombstone).length,
    items,
  };
}

/** Runtime validation for the hosted, privacy-minimized manifest contract. */
export function validateHostedKnowledgeManifest(
  value: unknown,
  requestedOptions: KnowledgeSourceManifestOptions = {},
): KnowledgeSourceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hosted knowledge manifest response is incompatible.");
  const manifest = value as Record<string, unknown>;
  const expectedFilters = hostedManifestFilters(requestedOptions);
  if (
    manifest.filter_contract !== "files.knowledge.manifest.v1"
    || manifest.cursor_contract !== "files.knowledge.manifest.change.v1"
    || !isNonBlankString(manifest.manifest_id)
    || typeof manifest.generated_at !== "string" || !isValidIsoDateTime(manifest.generated_at)
    || (manifest.format !== "json" && manifest.format !== "jsonl")
    || !manifest.filters || typeof manifest.filters !== "object" || Array.isArray(manifest.filters)
    || !Number.isSafeInteger(manifest.item_count) || (manifest.item_count as number) < 0
    || typeof manifest.has_more !== "boolean"
    || typeof manifest.complete !== "boolean"
    || typeof manifest.delta !== "boolean"
    || (typeof manifest.high_watermark !== "string" || !/^(0|[1-9][0-9]*)$/.test(manifest.high_watermark))
    || !isNonBlankString(manifest.delta_cursor)
    || !Number.isSafeInteger(manifest.tombstone_count) || (manifest.tombstone_count as number) < 0
    || !Array.isArray(manifest.items)
  ) throw new Error("Hosted knowledge manifest response is incompatible.");
  if (manifest.format !== (requestedOptions.format ?? "json")) throw new Error("Hosted knowledge manifest response is incompatible.");
  if (manifest.delta !== expectedFilters.delta) throw new Error("Hosted knowledge manifest response is incompatible.");
  const filters = manifest.filters as Record<string, unknown>;
  if (!isValidHostedManifestFilters(filters) || !exactPrimitiveObject(filters, expectedFilters)) {
    throw new Error("Hosted knowledge manifest response is incompatible.");
  }
  if (manifest.items.length !== manifest.item_count) throw new Error("Hosted knowledge manifest response is incompatible.");
  if (manifest.complete && manifest.has_more) throw new Error("Hosted knowledge manifest response is incompatible.");
  if (manifest.cursor !== undefined && !isNonBlankString(manifest.cursor)) {
    throw new Error("Hosted knowledge manifest response is incompatible.");
  }
  if (requestedOptions.cursor === undefined) {
    if (Object.prototype.hasOwnProperty.call(manifest, "cursor")) throw new Error("Hosted knowledge manifest response is incompatible.");
  } else if (manifest.cursor !== requestedOptions.cursor) {
    throw new Error("Hosted knowledge manifest response is incompatible.");
  }
  if (manifest.next_cursor !== undefined && !isNonBlankString(manifest.next_cursor)) {
    throw new Error("Hosted knowledge manifest response is incompatible.");
  }
  if (manifest.has_more !== isNonBlankString(manifest.next_cursor)) {
    throw new Error("Hosted knowledge manifest response is incompatible.");
  }

  const allowedManifestKeys = new Set([
    "filter_contract", "cursor_contract", "manifest_id", "generated_at", "format", "filters",
    "item_count", "cursor", "next_cursor", "has_more", "complete", "delta", "high_watermark",
    "delta_cursor", "tombstone_count", "items",
  ]);
  if (Object.keys(manifest).some((key) => !allowedManifestKeys.has(key))) throw new Error("Hosted knowledge manifest response is incompatible.");
  let previousCursor = -1n;
  let tombstones = 0;
  const fileIds = new Set<string>();
  for (const raw of manifest.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Hosted knowledge manifest response is incompatible.");
    const item = raw as Record<string, unknown>;
    if (
      item.kind !== "file"
      || !isNonBlankString(item.file_id)
      || !isNonBlankString(item.source_id)
      || !isNonBlankString(item.source_ref)
      || typeof item.change_cursor !== "string" || !/^(0|[1-9][0-9]*)$/.test(item.change_cursor)
      || BigInt(item.change_cursor) > BigInt(manifest.high_watermark as string)
      || BigInt(item.change_cursor) <= previousCursor
      || typeof item.name !== "string"
      || typeof item.mime !== "string"
      || !Number.isSafeInteger(item.size) || (item.size as number) < 0
      || !isOneOfString(item.source_type, ["local", "s3", "google_drive"])
      || !isOneOfString(item.status, ["active", "deleted", "moved"])
      || typeof item.updated_at !== "string" || !isValidIsoDateTime(item.updated_at)
      || typeof item.deleted !== "boolean"
      || (item.tombstone !== undefined && typeof item.tombstone !== "boolean")
      || !Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string")
      || !item.open_files_root || typeof item.open_files_root !== "object" || Array.isArray(item.open_files_root)
      || !item.storage || typeof item.storage !== "object" || Array.isArray(item.storage)
      || !item.extraction || typeof item.extraction !== "object" || Array.isArray(item.extraction)
    ) throw new Error("Hosted knowledge manifest response is incompatible.");
    const allowedItemKeys = new Set([
      "kind", "source_ref", "revision_ref", "revision_id", "change_cursor", "source_revision_hash",
      "file_id", "source_id", "source_type", "name", "mime", "size", "hash", "status",
      "updated_at", "deleted", "tombstone", "tags", "open_files_root", "storage", "extraction",
      "permissions", "permission_labels",
    ]);
    if (Object.keys(item).some((key) => !allowedItemKeys.has(key))) throw new Error("Hosted knowledge manifest response is incompatible.");
    previousCursor = BigInt(item.change_cursor as string);
    if (fileIds.has(item.file_id as string)) throw new Error("Hosted knowledge manifest response is incompatible.");
    fileIds.add(item.file_id as string);
    const deleted = item.status === "deleted";
    if (item.deleted !== deleted || (item.tombstone === true) !== deleted) throw new Error("Hosted knowledge manifest response is incompatible.");
    if (deleted) tombstones++;
    if (item.source_ref !== `open-files://file/${encodeURIComponent(item.file_id as string)}`) throw new Error("Hosted knowledge manifest response is incompatible.");
    if (typeof item.source_revision_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(item.source_revision_hash)) {
      throw new Error("Hosted knowledge manifest response is incompatible.");
    }
    if (item.hash !== undefined && !isNonBlankString(item.hash)) {
      throw new Error("Hosted knowledge manifest response is incompatible.");
    }

    for (const forbidden of ["path", "source_name", "s3_object_id", "sync_version", "machine_id", "hostname", "local_path", "bucket", "prefix", "region", "object_key"]) {
      if (forbidden in item) throw new Error("Hosted knowledge manifest response is incompatible.");
    }
    const root = item.open_files_root as Record<string, unknown>;
    if (
      !exactObjectKeys(root, ["evidence_hash", "open_files_root", "source_id", "source_type"])
      || root.open_files_root !== `open-files://source/${encodeURIComponent(item.source_id as string)}`
      || root.source_id !== item.source_id
      || root.source_type !== item.source_type
      || typeof root.evidence_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(root.evidence_hash)
    ) throw new Error("Hosted knowledge manifest response is incompatible.");
    const storage = item.storage as Record<string, unknown>;
    const expectedProvider = item.source_type === "s3" ? "s3" : item.source_type === "local" ? "local" : "unknown";
    if (!exactObjectKeys(storage, ["provider", "source_id"]) || storage.source_id !== item.source_id || storage.provider !== expectedProvider) {
      throw new Error("Hosted knowledge manifest response is incompatible.");
    }
    const extraction = item.extraction as Record<string, unknown>;
    const extractionKeys = new Set(["text_available", "status", "extracted_text_ref", "status_reason"]);
    if (
      Object.keys(extraction).some((key) => !extractionKeys.has(key))
      || typeof extraction.text_available !== "boolean"
      || typeof extraction.status !== "string"
      || !["available", "partial", "unavailable", "unsupported", "error", "stale"].includes(extraction.status)
      || (extraction.status_reason !== undefined && !isNonBlankString(extraction.status_reason))
    ) {
      throw new Error("Hosted knowledge manifest response is incompatible.");
    }
    const available = extraction.text_available === true;
    const availableStatus = extraction.status === "available" || extraction.status === "partial";
    const expectedExtractionRef = `${item.source_ref as string}/text`;
    const hasExactExtractionRef = extraction.extracted_text_ref === expectedExtractionRef;
    if (available !== availableStatus || available !== hasExactExtractionRef) {
      throw new Error("Hosted knowledge manifest response is incompatible.");
    }
    if (
      (!available && Object.prototype.hasOwnProperty.call(extraction, "extracted_text_ref"))
      || (available && Object.prototype.hasOwnProperty.call(extraction, "status_reason"))
      || (!available && !isNonBlankString(extraction.status_reason))
    ) {
      throw new Error("Hosted knowledge manifest response is incompatible.");
    }
    const permissions = item.permissions as Record<string, unknown>;
    if (
      !permissions || typeof permissions !== "object" || Array.isArray(permissions)
      || !exactObjectKeys(permissions, ["allowed_purposes", "mode"])
      || permissions.mode !== "read_only"
      || !Array.isArray(permissions.allowed_purposes)
      || permissions.allowed_purposes.some((purpose) => typeof purpose !== "string")
      || !Array.isArray(item.permission_labels)
      || item.permission_labels.some((label) => typeof label !== "string")
    ) throw new Error("Hosted knowledge manifest response is incompatible.");
    if (item.revision_id !== undefined || item.revision_ref !== undefined) {
      if (
        !isNonBlankString(item.revision_id)
        || item.revision_ref !== `open-files://file/${encodeURIComponent(item.file_id as string)}/revision/${encodeURIComponent(item.revision_id)}`
      ) throw new Error("Hosted knowledge manifest response is incompatible.");
    }
  }
  if (tombstones !== manifest.tombstone_count) throw new Error("Hosted knowledge manifest response is incompatible.");
  return value as KnowledgeSourceManifest;
}

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function exactPrimitiveObject(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  const keys = Object.keys(expected);
  return exactObjectKeys(actual, keys) && keys.every((key) => actual[key] === expected[key]);
}

function isValidHostedManifestFilters(filters: Record<string, unknown>): boolean {
  const allowed = ["source_id", "collection_id", "project_id", "tag", "status", "delta", "after", "before"] as const;
  if (Object.keys(filters).some((key) => !allowed.includes(key as typeof allowed[number]))) return false;
  if (!isOneOfString(filters.status, ["active", "deleted", "moved", "all"]) || typeof filters.delta !== "boolean") return false;
  for (const key of ["source_id", "collection_id", "project_id", "tag", "after", "before"] as const) {
    const value = filters[key];
    if (value !== undefined && !isNonBlankString(value)) return false;
  }
  if ((filters.after !== undefined && !isValidManifestBoundary(filters.after as string))
    || (filters.before !== undefined && !isValidManifestBoundary(filters.before as string))) return false;
  return filters.tag === undefined || filters.tag === (filters.tag as string).trim().toLowerCase();
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isOneOfString<const T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidManifestBoundary(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  return isValidIsoDateTime(value);
}

function isValidIsoDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year
    && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day;
}
