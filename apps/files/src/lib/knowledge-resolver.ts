import { closeSync, openSync, readSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { lookup as mimeLookup } from "mime-types";
import { logActivity } from "../db/activity.js";
import { getFileAsset } from "../db/evidence.js";
import { getFile, getFileByPath } from "../db/files.js";
import { getFileVersion, getFileVersionBySourceRef, getLatestFileVersion } from "../db/file-versions.js";
import { getS3ObjectRecord, buildS3ObjectResolverContract } from "../db/s3-objects.js";
import { getSource } from "../db/sources.js";
import { buildOpenFilesFileRef, parseOpenFilesSourceRef } from "./source-ref.js";
import { extractTextFromBuffer, isExtractableTextMime, type ExtractTextOptions } from "./extraction.js";
import { buildExtractionSnapshot } from "./extraction-snapshot.js";
import { resolveFileObject } from "./file-object.js";
import { createS3ClientConfig } from "./s3.js";
import type {
  ExtractedTextResult,
  FileVersion,
  FileWithTags,
  KnowledgeSourceResolveMode,
  KnowledgeSourceResolution,
  KnowledgeSourceResolverOptions,
  KnowledgeSourceResolveStatus,
  KnowledgeSourceResolverStorage,
  S3ObjectResolverContract,
  Source,
} from "../types/index.js";

const DEFAULT_PURPOSE = "knowledge_index";
const DEFAULT_ALLOWED_PURPOSES = ["knowledge_index", "knowledge_answer", "agent_context"];
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_BYTES_CEILING = 10 * 1024 * 1024;
const DEFAULT_SIGNED_URL_SECONDS = 600;
const MAX_SIGNED_URL_SECONDS = 3600;

interface ResolveContext {
  requested_ref: string;
  resolved_ref: string;
  file?: FileWithTags;
  version?: FileVersion;
  source: Source;
  source_path: string;
  name: string;
  mime: string;
  size?: number;
  modified_at?: string;
  indexed_at?: string;
  status?: string;
  hash_algorithm?: string;
  hash?: string;
  storage: StorageTarget;
}

interface StorageTarget {
  provider: "local" | "s3" | "unknown";
  source_id?: string;
  local_path?: string;
  bucket?: string;
  key?: string;
  region?: string;
  version_id?: string;
  credential_source?: Source;
  s3_contract?: S3ObjectResolverContract;
  unsupported_reason?: string;
}

interface ByteRead {
  bytes: Buffer;
  total_size?: number;
  truncated: boolean;
}

export async function resolveKnowledgeSourceRef(
  sourceRef: string,
  opts: KnowledgeSourceResolverOptions = {},
): Promise<KnowledgeSourceResolution> {
  const mode = opts.mode ?? "metadata";
  const purpose = opts.purpose ?? DEFAULT_PURPOSE;
  let context: ResolveContext | undefined;
  let resolution: KnowledgeSourceResolution;

  try {
    const purposeDenied = enforcePurpose(sourceRef, purpose, opts.allowed_purposes);
    if (purposeDenied) return purposeDenied;

    const parsed = parseOpenFilesSourceRef(sourceRef);
    if (parsed.kind === "source_path") {
      const unsafe = getUnsafePathReason(parsed.path);
      if (unsafe) {
        return deniedResolution(sourceRef, purpose, mode, unsafe, { source_id: parsed.source_id });
      }
    }
    if (parsed.kind === "asset") {
      return assetMetadataResolution(sourceRef, parsed.revision_id, parsed.asset_id, purpose, mode);
    }

    const resolved = resolveContext(sourceRef);
    if (!resolved.ok) {
      resolution = resolved.resolution;
    } else {
      context = resolved.context;
      if (!context.source.enabled) {
        resolution = baseResolution(context, purpose, mode, "denied", "Source is disabled.");
      } else if (requiresActiveContent(mode) && context.status && context.status !== "active") {
        resolution = baseResolution(context, purpose, mode, "denied", `File is ${context.status}.`);
      } else {
        resolution = await resolveMode(context, mode, purpose, opts);
      }
    }
  } catch (error) {
    resolution = {
      source_ref: sourceRef,
      requested_ref: sourceRef,
      status: "error",
      status_reason: error instanceof Error ? error.message : String(error),
      content: {
        mime: "application/octet-stream",
        text_available: false,
      },
      permissions: permissionsFor(purpose),
      deleted: false,
    };
  }

  if (opts.agent_id && context) {
    logActivity({
      agent_id: opts.agent_id,
      action: "read",
      file_id: context.file?.id,
      source_id: context.source.id,
      session_id: opts.session_id,
      metadata: {
        resolver: "knowledge_source",
        requested_ref: sourceRef,
        resolved_ref: resolution.source_ref,
        mode,
        purpose,
        status: resolution.status,
        bytes_read: resolution.content.bytes_read,
        signed_url: Boolean(resolution.access?.url),
      },
    });
  }

  return resolution;
}

function resolveContext(sourceRef: string): { ok: true; context: ResolveContext } | { ok: false; resolution: KnowledgeSourceResolution } {
  const parsed = parseOpenFilesSourceRef(sourceRef);

  if (parsed.kind === "asset") {
    const asset = getFileAsset(parsed.asset_id);
    if (!asset) {
      return { ok: false, resolution: notFoundResolution(sourceRef, `Asset not found: ${parsed.asset_id}`) };
    }
    return { ok: false, resolution: assetResolutionFromRecord(sourceRef, parsed.revision_id, asset, DEFAULT_PURPOSE, "metadata") };
  }

  if (parsed.kind === "file") {
    const version = parsed.revision_id
      ? getFileVersionBySourceRef(sourceRef) ?? getFileVersion(parsed.revision_id)
      : null;
    if (parsed.revision_id && (!version || version.file_id !== parsed.file_id)) {
      return { ok: false, resolution: notFoundResolution(sourceRef, `File revision not found: ${parsed.revision_id}`) };
    }

    const file = getFile(parsed.file_id);
    if (!file && !version) {
      return { ok: false, resolution: notFoundResolution(sourceRef, `File not found: ${parsed.file_id}`) };
    }

    const source = getSource(version?.source_id ?? file!.source_id);
    if (!source) {
      return { ok: false, resolution: notFoundResolution(sourceRef, `Source not found for ref: ${sourceRef}`) };
    }

    const effectiveFile = file ?? getFile(version!.file_id) ?? undefined;
    const effectiveVersion = version ?? (effectiveFile ? getLatestFileVersion(effectiveFile.id) ?? undefined : undefined);
    const storage = resolveStorageTarget({
      source,
      file: effectiveFile,
      version: effectiveVersion,
      source_path: effectiveVersion?.source_path ?? effectiveFile?.path ?? "",
    });

    return {
      ok: true,
      context: {
        requested_ref: sourceRef,
        resolved_ref: effectiveVersion?.source_ref ?? buildOpenFilesFileRef(parsed.file_id),
        file: effectiveFile,
        version: effectiveVersion,
        source,
        source_path: effectiveVersion?.source_path ?? effectiveFile?.path ?? "",
        name: effectiveFile?.name ?? basename(effectiveVersion?.source_path ?? parsed.file_id),
        mime: effectiveVersion?.mime ?? effectiveFile?.mime ?? "application/octet-stream",
        size: effectiveVersion?.size ?? effectiveFile?.size,
        modified_at: effectiveVersion?.source_modified_at ?? effectiveFile?.modified_at,
        indexed_at: effectiveVersion?.indexed_at ?? effectiveFile?.indexed_at,
        status: effectiveVersion?.state ?? effectiveFile?.status,
        hash_algorithm: effectiveVersion?.content_hash_algorithm ?? (effectiveFile?.hash ? "source" : undefined),
        hash: effectiveVersion?.content_hash ?? effectiveFile?.hash,
        storage,
      },
    };
  }

  const source = getSource(parsed.source_id);
  if (!source) {
    return { ok: false, resolution: notFoundResolution(sourceRef, `Source not found: ${parsed.source_id}`) };
  }

  const fileByPath = getFileByPath(source.id, parsed.path);
  const file = fileByPath ? getFile(fileByPath.id) ?? undefined : undefined;
  const version = file ? getLatestFileVersion(file.id) ?? undefined : undefined;
  const storage = resolveStorageTarget({ source, file, version, source_path: parsed.path });
  const stat = file ? undefined : statSourcePath(source, parsed.path);
  const inferredMime = file?.mime ?? version?.mime ?? (mimeLookup(parsed.path) || "application/octet-stream").toString();

  return {
    ok: true,
    context: {
      requested_ref: sourceRef,
      resolved_ref: version?.source_ref ?? sourceRef,
      file,
      version,
      source,
      source_path: parsed.path,
      name: file?.name ?? basename(parsed.path),
      mime: inferredMime,
      size: version?.size ?? file?.size ?? stat?.size,
      modified_at: version?.source_modified_at ?? file?.modified_at ?? stat?.modified_at,
      indexed_at: version?.indexed_at ?? file?.indexed_at,
      status: version?.state ?? file?.status ?? "active",
      hash_algorithm: version?.content_hash_algorithm ?? (file?.hash ? "source" : undefined),
      hash: version?.content_hash ?? file?.hash,
      storage,
    },
  };
}

function assetMetadataResolution(
  sourceRef: string,
  revisionId: string | undefined,
  assetId: string,
  purpose: string,
  mode: KnowledgeSourceResolveMode,
): KnowledgeSourceResolution {
  const asset = getFileAsset(assetId);
  if (!asset) return notFoundResolution(sourceRef, `Asset not found: ${assetId}`);
  return assetResolutionFromRecord(sourceRef, revisionId, asset, purpose, mode);
}

function assetResolutionFromRecord(
  sourceRef: string,
  revisionId: string | undefined,
  asset: NonNullable<ReturnType<typeof getFileAsset>>,
  purpose: string,
  mode: KnowledgeSourceResolveMode,
): KnowledgeSourceResolution {
  const deleted = asset.status === "deleted";
  const metadataOnly = mode === "metadata";
  return {
    source_ref: sourceRef,
    requested_ref: sourceRef,
    revision_id: revisionId,
    status: deleted ? "denied" : metadataOnly ? "ready" : "unsupported",
    status_reason: deleted
      ? "Asset is deleted."
      : metadataOnly
        ? "Asset metadata is available; raw bytes stay owned by open-files."
        : "Asset refs are metadata-only in the knowledge resolver; use approved open-files asset access APIs for bytes.",
    storage: {
      provider: asset.storage_provider,
      bucket: asset.bucket,
      key: asset.object_key,
      region: asset.region,
    },
    content: {
      mime: asset.content_type,
      size: asset.size,
      hash: `${asset.checksum_algorithm}:${asset.checksum}`,
      text_available: false,
      extraction: {
        status: "unsupported",
        extractor: "open-files-asset-metadata-v1",
        bytes_read: 0,
        truncated: false,
      },
    },
    permissions: {
      ...permissionsFor(purpose),
      requested_mode: mode,
    },
    updated_at: asset.updated_at,
    deleted,
  };
}

async function resolveMode(
  context: ResolveContext,
  mode: KnowledgeSourceResolveMode,
  purpose: string,
  opts: KnowledgeSourceResolverOptions,
): Promise<KnowledgeSourceResolution> {
  if (mode === "metadata") return baseResolution(context, purpose, mode, "ready");

  if (mode === "signed_url") return resolveSignedUrl(context, purpose, mode, opts);

  if (!isMimeAllowed(context.mime, context.name, opts)) {
    return baseResolution(
      context,
      purpose,
      mode,
      "unsupported",
      `MIME type is not allowed for ${mode}: ${context.mime}`,
    );
  }

  const read = await readTargetBytes(context, normalizeMaxBytes(opts.max_bytes));
  if (!read) {
    return baseResolution(
      context,
      purpose,
      mode,
      "unsupported",
      context.storage.unsupported_reason ?? "No read-capable storage target is available for this source ref.",
    );
  }

  if (mode === "content") {
    return {
      ...baseResolution(context, purpose, mode, read.truncated ? "too_large" : "ready", read.truncated ? "Content read was truncated by max_bytes." : undefined),
      content: {
        ...contentDescriptor(context),
        bytes_read: read.bytes.length,
        truncated: read.truncated,
        encoding: "utf-8",
        text: read.bytes.toString("utf8"),
      },
    };
  }

  const extraction = extractTextFromBuffer({
    ...extractOptions(opts),
    source_ref: context.resolved_ref,
    file_id: context.file?.id,
    revision_id: context.version?.id,
    mime: context.mime,
    bytes: read.bytes,
    total_size: read.total_size ?? context.size,
  });

  if (mode === "extracted_text") {
    return {
      ...baseResolution(context, purpose, mode, mapExtractionStatus(extraction), extraction.status_reason),
      extracted_text: extraction,
      content: {
        ...contentDescriptor(context),
        bytes_read: extraction.bytes_read,
        truncated: extraction.truncated,
        extraction: extractionDescriptor(extraction),
      },
    };
  }

  const snapshot = buildExtractionSnapshot(extraction);
  return {
    ...baseResolution(context, purpose, mode, mapExtractionStatus(extraction), extraction.status_reason),
    extracted_text: extraction,
    snapshot,
    content: {
      ...contentDescriptor(context),
      bytes_read: extraction.bytes_read,
      truncated: extraction.truncated,
      extraction: {
        ...extractionDescriptor(extraction),
        snapshot_id: snapshot.snapshot_id,
      },
    },
  };
}

async function resolveSignedUrl(
  context: ResolveContext,
  purpose: string,
  mode: KnowledgeSourceResolveMode,
  opts: KnowledgeSourceResolverOptions,
): Promise<KnowledgeSourceResolution> {
  if (!isMimeAllowed(context.mime, context.name, opts)) {
    return baseResolution(
      context,
      purpose,
      mode,
      "unsupported",
      `MIME type is not allowed for signed access: ${context.mime}`,
    );
  }
  if (context.storage.provider !== "s3" || !context.storage.credential_source || !context.storage.bucket || !context.storage.key) {
    return baseResolution(
      context,
      purpose,
      mode,
      "unsupported",
      context.storage.unsupported_reason ?? "Signed URLs are only available for scoped S3 storage targets.",
    );
  }

  const expiresIn = normalizeExpiresIn(opts.signed_url_expires_in);
  const client = new S3Client(createS3ClientConfig(context.storage.credential_source));
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: context.storage.bucket,
      Key: context.storage.key,
      VersionId: context.storage.version_id,
    }),
    { expiresIn },
  );
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return {
    ...baseResolution(context, purpose, mode, "ready"),
    access: {
      kind: "signed_url",
      method: "GET",
      url,
      expires_at: expiresAt,
    },
  };
}

function resolveStorageTarget(opts: {
  source: Source;
  file?: FileWithTags;
  version?: FileVersion;
  source_path: string;
}): StorageTarget {
  if (opts.version) return resolveVersionStorageTarget(opts.source, opts.file, opts.version);
  return resolveCurrentStorageTarget(opts.source, opts.file, opts.source_path);
}

function resolveVersionStorageTarget(source: Source, file: FileWithTags | undefined, version: FileVersion): StorageTarget {
  if (version.storage_provider === "local") {
    const localPath = resolveVersionLocalPath(source, version);
    return localPath
      ? { provider: "local", source_id: source.id, local_path: localPath }
      : { provider: "local", source_id: source.id, unsupported_reason: "No safe local path is available for this revision." };
  }

  if (version.storage_provider === "s3") {
    const s3Contract = version.s3_object_id ? getS3ObjectRecord(version.s3_object_id) : null;
    const contract = s3Contract ? buildS3ObjectResolverContract(s3Contract) : undefined;
    if (!version.bucket || !version.object_key) {
      return { provider: "s3", source_id: source.id, s3_contract: contract, unsupported_reason: "S3 revision is missing bucket or key." };
    }

    const credentialSource = scopedS3CredentialSource(source, file, version.bucket, version.object_key);
    return {
      provider: "s3",
      source_id: credentialSource?.id ?? source.id,
      bucket: version.bucket,
      key: version.object_key,
      region: version.region,
      credential_source: credentialSource,
      s3_contract: contract,
      unsupported_reason: credentialSource ? undefined : "No scoped S3 credentials are available for this revision bucket/key.",
    };
  }

  return { provider: "unknown", source_id: source.id, unsupported_reason: "Revision storage provider is unknown." };
}

function resolveCurrentStorageTarget(source: Source, file: FileWithTags | undefined, sourcePath: string): StorageTarget {
  if (file) {
    try {
      const resolved = resolveFileObject(file.id);
      if (resolved.storageSource.type === "local") {
        const localPath = safeJoinSourcePath(resolved.storageSource.path, resolved.objectKey);
        return localPath
          ? { provider: "local", source_id: resolved.storageSource.id, local_path: localPath }
          : { provider: "local", source_id: resolved.storageSource.id, unsupported_reason: "Resolved local path is outside the source root." };
      }
      if (resolved.storageSource.type === "s3") {
        return {
          provider: "s3",
          source_id: resolved.storageSource.id,
          bucket: resolved.storageSource.bucket,
          key: resolved.objectKey,
          region: resolved.storageSource.region,
          credential_source: resolved.storageSource,
        };
      }
    } catch {
      // Fall through to source-based direct resolution below.
    }
  }

  if (source.type === "local") {
    const localPath = safeJoinSourcePath(source.path, sourcePath);
    return localPath
      ? { provider: "local", source_id: source.id, local_path: localPath }
      : { provider: "local", source_id: source.id, unsupported_reason: "Resolved local path is outside the source root." };
  }

  if (source.type === "s3") {
    return {
      provider: "s3",
      source_id: source.id,
      bucket: source.bucket,
      key: sourcePath,
      region: source.region,
      credential_source: source.bucket ? source : undefined,
      unsupported_reason: source.bucket ? undefined : "S3 source is missing a bucket.",
    };
  }

  return { provider: "unknown", source_id: source.id, unsupported_reason: `Unsupported source type for byte reads: ${source.type}` };
}

function scopedS3CredentialSource(
  source: Source,
  file: FileWithTags | undefined,
  bucket: string,
  key: string,
): Source | undefined {
  if (source.type === "s3" && source.bucket === bucket) {
    return { ...source, bucket, region: source.region };
  }

  if (!file) return undefined;
  try {
    const resolved = resolveFileObject(file.id);
    if (resolved.storageSource.type === "s3" && resolved.storageSource.bucket === bucket && resolved.objectKey === key) {
      return resolved.storageSource;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveVersionLocalPath(source: Source, version: FileVersion): string | undefined {
  if (source.type === "local" && source.path) {
    return safeJoinSourcePath(source.path, version.source_path);
  }
  if (!version.local_path) return undefined;
  if (!source.path) return undefined;
  const sourceRoot = resolve(source.path);
  const candidate = resolve(version.local_path);
  const rel = relative(sourceRoot, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return candidate;
}

async function readTargetBytes(context: ResolveContext, maxBytes: number): Promise<ByteRead | null> {
  if (context.storage.provider === "local" && context.storage.local_path) {
    const stat = statSync(context.storage.local_path);
    const bytes = readLocalFilePrefix(context.storage.local_path, maxBytes);
    return {
      bytes,
      total_size: stat.size,
      truncated: stat.size > bytes.length,
    };
  }

  if (
    context.storage.provider === "s3"
    && context.storage.credential_source
    && context.storage.bucket
    && context.storage.key
  ) {
    const client = new S3Client(createS3ClientConfig(context.storage.credential_source));
    const response = await client.send(new GetObjectCommand({
      Bucket: context.storage.bucket,
      Key: context.storage.key,
      VersionId: context.storage.version_id,
      Range: `bytes=0-${maxBytes - 1}`,
    }));
    if (!response.Body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks).subarray(0, maxBytes);
    const totalSize = context.size ?? response.ContentLength;
    return {
      bytes,
      total_size: totalSize,
      truncated: totalSize !== undefined ? totalSize > bytes.length : bytes.length === maxBytes,
    };
  }

  return null;
}

function readLocalFilePrefix(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function statSourcePath(source: Source, sourcePath: string): { size: number; modified_at?: string } | undefined {
  if (source.type !== "local") return undefined;
  const localPath = safeJoinSourcePath(source.path, sourcePath);
  if (!localPath) return undefined;
  try {
    const stat = statSync(localPath);
    return {
      size: stat.size,
      modified_at: stat.mtime.toISOString(),
    };
  } catch {
    return undefined;
  }
}

function baseResolution(
  context: ResolveContext,
  purpose: string,
  mode: KnowledgeSourceResolveMode,
  status: KnowledgeSourceResolveStatus,
  statusReason?: string,
): KnowledgeSourceResolution {
  const storage = storageDescriptor(context.storage);
  return {
    source_ref: context.resolved_ref,
    requested_ref: context.requested_ref,
    file_id: context.file?.id,
    revision_id: context.version?.id,
    source_id: context.source.id,
    path: context.source_path,
    name: context.name,
    status,
    status_reason: statusReason,
    storage,
    content: contentDescriptor(context),
    permissions: {
      ...permissionsFor(purpose),
      requested_mode: mode,
    },
    updated_at: context.modified_at ?? context.indexed_at,
    deleted: context.status === "deleted",
  };
}

function contentDescriptor(context: ResolveContext): KnowledgeSourceResolution["content"] {
  const textAvailable = isExtractableTextMime(context.mime, context.name);
  return {
    mime: context.mime,
    size: context.size,
    hash: formatHash(context.hash_algorithm, context.hash),
    text_available: textAvailable,
    extracted_text_ref: textAvailable ? `${context.resolved_ref}/text` : undefined,
  };
}

function storageDescriptor(storage: StorageTarget): KnowledgeSourceResolverStorage {
  return {
    provider: storage.provider,
    source_id: storage.source_id,
    bucket: storage.provider === "s3" ? storage.bucket : undefined,
    key: storage.provider === "s3" ? storage.key : undefined,
    region: storage.provider === "s3" ? storage.region : undefined,
    version_id: storage.provider === "s3" ? storage.version_id : undefined,
    s3_object: storage.s3_contract,
  };
}

function extractionDescriptor(extraction: ExtractedTextResult): NonNullable<KnowledgeSourceResolution["content"]["extraction"]> {
  return {
    status: extraction.status,
    extractor: extraction.metadata.extractor,
    bytes_read: extraction.bytes_read,
    truncated: extraction.truncated,
  };
}

function permissionsFor(purpose: string): KnowledgeSourceResolution["permissions"] {
  return {
    mode: "read_only",
    purpose,
    allowed_purposes: DEFAULT_ALLOWED_PURPOSES,
    write: false,
  };
}

function notFoundResolution(sourceRef: string, reason: string): KnowledgeSourceResolution {
  return {
    source_ref: sourceRef,
    requested_ref: sourceRef,
    status: "not_found",
    status_reason: reason,
    content: {
      mime: "application/octet-stream",
      text_available: false,
    },
    permissions: permissionsFor(DEFAULT_PURPOSE),
    deleted: false,
  };
}

function deniedResolution(
  sourceRef: string,
  purpose: string,
  mode: KnowledgeSourceResolveMode,
  reason: string,
  ids: { source_id?: string; file_id?: string } = {},
): KnowledgeSourceResolution {
  return {
    source_ref: sourceRef,
    requested_ref: sourceRef,
    file_id: ids.file_id,
    source_id: ids.source_id,
    status: "denied",
    status_reason: reason,
    content: {
      mime: "application/octet-stream",
      text_available: false,
    },
    permissions: {
      ...permissionsFor(purpose),
      requested_mode: mode,
    },
    deleted: false,
  };
}

function enforcePurpose(
  sourceRef: string,
  purpose: string,
  allowedPurposes: string[] | undefined,
): KnowledgeSourceResolution | null {
  const allowed = allowedPurposes ?? DEFAULT_ALLOWED_PURPOSES;
  if (allowed.includes(purpose)) return null;
  return {
    source_ref: sourceRef,
    requested_ref: sourceRef,
    status: "denied",
    status_reason: `Purpose is not allowed for source resolution: ${purpose}`,
    content: {
      mime: "application/octet-stream",
      text_available: false,
    },
    permissions: {
      mode: "read_only",
      purpose,
      allowed_purposes: allowed,
      write: false,
    },
    deleted: false,
  };
}

function safeJoinSourcePath(root: string | undefined, sourcePath: string): string | undefined {
  if (!root) return undefined;
  const unsafe = getUnsafePathReason(sourcePath);
  if (unsafe) return undefined;
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, sourcePath);
  const rel = relative(rootPath, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return candidate;
}

function getUnsafePathReason(sourcePath: string): string | undefined {
  if (!sourcePath) return "Source path is empty.";
  if (sourcePath.includes("\0")) return "Source path contains a NUL byte.";
  if (sourcePath.includes("\\")) return "Source path must use forward slashes.";
  if (sourcePath.startsWith("/") || /^[A-Za-z]:\//.test(sourcePath)) return "Source path must be relative.";
  const parts = sourcePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return "Source path contains unsafe path segments.";
  }
  return undefined;
}

function isMimeAllowed(
  mime: string,
  name: string,
  opts: KnowledgeSourceResolverOptions,
): boolean {
  if (opts.allow_binary) return true;
  const normalized = mime.split(";")[0]?.toLowerCase() ?? "application/octet-stream";
  if (opts.allowed_mimes?.length) {
    return opts.allowed_mimes.some((allowed) => {
      const normalizedAllowed = allowed.toLowerCase();
      if (normalizedAllowed.endsWith("/*")) {
        return normalized.startsWith(normalizedAllowed.slice(0, -1));
      }
      return normalized === normalizedAllowed;
    });
  }
  return isExtractableTextMime(normalized, name);
}

function normalizeMaxBytes(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_MAX_BYTES)) return DEFAULT_MAX_BYTES;
  const normalized = Math.floor(value ?? DEFAULT_MAX_BYTES);
  if (normalized <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(normalized, MAX_BYTES_CEILING);
}

function normalizeExpiresIn(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_SIGNED_URL_SECONDS)) return DEFAULT_SIGNED_URL_SECONDS;
  const normalized = Math.floor(value ?? DEFAULT_SIGNED_URL_SECONDS);
  if (normalized <= 0) return DEFAULT_SIGNED_URL_SECONDS;
  return Math.min(normalized, MAX_SIGNED_URL_SECONDS);
}

function requiresActiveContent(mode: KnowledgeSourceResolveMode): boolean {
  return mode !== "metadata";
}

function extractOptions(opts: KnowledgeSourceResolverOptions): ExtractTextOptions {
  return {
    max_bytes: normalizeMaxBytes(opts.max_bytes),
    max_segment_chars: opts.max_segment_chars,
    redactor: opts.redactor,
    redact_patterns: opts.redact_patterns,
  };
}

function mapExtractionStatus(extraction: ExtractedTextResult): KnowledgeSourceResolveStatus {
  if (extraction.status === "ready" || extraction.status === "empty") return "ready";
  if (extraction.status === "too_large") return "too_large";
  if (extraction.status === "unsupported") return "unsupported";
  return "error";
}

function formatHash(algorithm: string | undefined, hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  if (!algorithm || algorithm === "unknown") return hash;
  return `${algorithm}:${hash}`;
}
