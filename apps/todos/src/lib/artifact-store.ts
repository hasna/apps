import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getDatabasePath } from "../db/database.js";
import { redactValue } from "./redaction.js";
import { sanitizePreWriteText } from "./prewrite-secrets.js";

export type ArtifactIntegrityStatus = "ok" | "missing" | "mismatch" | "metadata_only";
export type ArtifactRedactionStatus = "clean" | "redacted" | "binary_or_unknown";

export interface StoredArtifactMetadata {
  stored: true;
  algorithm: "sha256";
  sha256: string;
  size_bytes: number;
  relative_path: string;
  content_address: string;
  media_type: string;
  redaction: {
    checked: boolean;
    status: ArtifactRedactionStatus;
  };
  retention: {
    days: number | null;
    expires_at: string | null;
  };
  source: {
    path: string;
    size_bytes: number;
    sha256: string;
  };
}

export interface StoreArtifactContentInput {
  path: string;
  metadata?: Record<string, unknown>;
  retention_days?: number;
  created_at?: string;
}

export interface StoredArtifactContent {
  size_bytes: number;
  sha256: string;
  store: StoredArtifactMetadata;
}

export interface ArtifactIntegrityInput {
  id: string;
  path: string;
  size_bytes: number | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
}

export interface ArtifactIntegrityReport {
  id: string;
  path: string;
  status: ArtifactIntegrityStatus;
  expected_sha256: string | null;
  actual_sha256: string | null;
  expected_size_bytes: number | null;
  actual_size_bytes: number | null;
  relative_path: string | null;
  message: string;
}

export interface ExportedArtifactContent {
  artifact_id: string;
  sha256: string;
  size_bytes: number;
  relative_path: string;
  base64: string;
}

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

export function artifactStoreRoot(): string {
  if (process.env["HASNA_TODOS_ARTIFACTS_DIR"]) return resolve(process.env["HASNA_TODOS_ARTIFACTS_DIR"]);
  if (process.env["TODOS_ARTIFACTS_DIR"]) return resolve(process.env["TODOS_ARTIFACTS_DIR"]);
  const dbPath = getDatabasePath();
  if (isInMemoryDb(dbPath)) return join(tmpdir(), "hasna-todos-artifacts");
  return join(dirname(resolve(dbPath)), "artifacts");
}

export function artifactStorePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/") || normalized.length === 0) {
    throw new Error("Invalid artifact store path");
  }
  return join(artifactStoreRoot(), normalized);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isTextLike(buffer: Buffer, path: string): boolean {
  if (buffer.includes(0)) return false;
  if (/\.(txt|log|json|jsonl|md|csv|yaml|yml|xml|html|css|js|ts|tsx|jsx|patch|diff)$/i.test(path)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
  return !sample.includes("\uFFFD");
}

function retentionExpiresAt(createdAt: string, retentionDays: number | undefined): string | null {
  if (retentionDays === undefined) return null;
  if (!Number.isFinite(retentionDays) || retentionDays < 0) throw new Error("retention_days must be a non-negative number");
  const expires = new Date(createdAt);
  expires.setUTCDate(expires.getUTCDate() + retentionDays);
  return expires.toISOString();
}

function mediaTypeFor(path: string, textLike: boolean): string {
  if (/\.(png)$/i.test(path)) return "image/png";
  if (/\.(jpe?g)$/i.test(path)) return "image/jpeg";
  if (/\.(gif)$/i.test(path)) return "image/gif";
  if (/\.(webp)$/i.test(path)) return "image/webp";
  if (/\.(json)$/i.test(path)) return "application/json";
  if (/\.(md)$/i.test(path)) return "text/markdown";
  if (textLike) return "text/plain";
  return "application/octet-stream";
}

export function storeArtifactContent(input: StoreArtifactContentInput): StoredArtifactContent | null {
  const sourcePath = resolve(input.path);
  if (!existsSync(sourcePath)) return null;
  const sourceStat = statSync(sourcePath);
  if (!sourceStat.isFile()) throw new Error(`Artifact path is not a file: ${sanitizePreWriteText(input.path, "artifact.path")}`);

  const sourceBuffer = readFileSync(sourcePath);
  const sourceSha = sha256(sourceBuffer);
  const textLike = isTextLike(sourceBuffer, input.path);
  let storedBuffer = sourceBuffer;
  let redactionStatus: ArtifactRedactionStatus = textLike ? "clean" : "binary_or_unknown";
  if (textLike) {
    const redactedText = sanitizePreWriteText(sourceBuffer.toString("utf8"), "artifact.content");
    storedBuffer = Buffer.from(redactedText);
    if (!storedBuffer.equals(sourceBuffer)) redactionStatus = "redacted";
  }

  const storedSha = sha256(storedBuffer);
  const relativePath = join("sha256", storedSha.slice(0, 2), storedSha).replace(/\\/g, "/");
  const destination = artifactStorePath(relativePath);
  if (!existsSync(destination)) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, storedBuffer);
  }
  const createdAt = input.created_at || new Date().toISOString();
  const retentionDays = input.retention_days ?? null;
  return {
    size_bytes: storedBuffer.length,
    sha256: storedSha,
    store: {
      stored: true,
      algorithm: "sha256",
      sha256: storedSha,
      size_bytes: storedBuffer.length,
      relative_path: relativePath,
      content_address: `sha256:${storedSha}`,
      media_type: mediaTypeFor(input.path, textLike),
      redaction: {
        checked: textLike,
        status: redactionStatus,
      },
      retention: {
        days: retentionDays,
        expires_at: retentionDays === null ? null : retentionExpiresAt(createdAt, retentionDays),
      },
      source: {
        path: sanitizePreWriteText(input.path, "artifact.source_path"),
        size_bytes: sourceBuffer.length,
        sha256: sourceSha,
      },
    },
  };
}

function storeMetadata(metadata: Record<string, unknown>): StoredArtifactMetadata | null {
  const value = metadata["artifact_store"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.stored !== true) return null;
  if (typeof record.sha256 !== "string" || typeof record.relative_path !== "string" || typeof record.size_bytes !== "number") return null;
  return record as unknown as StoredArtifactMetadata;
}

export function verifyStoredArtifact(input: ArtifactIntegrityInput): ArtifactIntegrityReport {
  const store = storeMetadata(input.metadata);
  if (!store) {
    return {
      id: input.id,
      path: input.path,
      status: "metadata_only",
      expected_sha256: input.sha256,
      actual_sha256: null,
      expected_size_bytes: input.size_bytes,
      actual_size_bytes: null,
      relative_path: null,
      message: "artifact has metadata only and no local stored content",
    };
  }
  const storedPath = artifactStorePath(store.relative_path);
  if (!existsSync(storedPath)) {
    return {
      id: input.id,
      path: input.path,
      status: "missing",
      expected_sha256: store.sha256,
      actual_sha256: null,
      expected_size_bytes: store.size_bytes,
      actual_size_bytes: null,
      relative_path: store.relative_path,
      message: "stored artifact content is missing",
    };
  }
  const buffer = readFileSync(storedPath);
  const actualSha = sha256(buffer);
  const actualSize = buffer.length;
  const ok = actualSha === store.sha256 && actualSize === store.size_bytes;
  return {
    id: input.id,
    path: input.path,
    status: ok ? "ok" : "mismatch",
    expected_sha256: store.sha256,
    actual_sha256: actualSha,
    expected_size_bytes: store.size_bytes,
    actual_size_bytes: actualSize,
    relative_path: store.relative_path,
    message: ok ? "stored artifact content matches metadata" : "stored artifact content does not match metadata",
  };
}

export function exportStoredArtifactContent(input: ArtifactIntegrityInput): ExportedArtifactContent | null {
  const report = verifyStoredArtifact(input);
  if (report.status !== "ok" || !report.relative_path || !report.actual_sha256 || report.actual_size_bytes === null) return null;
  const content = readFileSync(artifactStorePath(report.relative_path));
  return {
    artifact_id: input.id,
    sha256: report.actual_sha256,
    size_bytes: report.actual_size_bytes,
    relative_path: report.relative_path,
    base64: content.toString("base64"),
  };
}

export function importStoredArtifactContent(content: ExportedArtifactContent): ArtifactIntegrityReport {
  const buffer = Buffer.from(content.base64, "base64");
  const actualSha = sha256(buffer);
  if (actualSha !== content.sha256 || buffer.length !== content.size_bytes) {
    return {
      id: content.artifact_id,
      path: content.relative_path,
      status: "mismatch",
      expected_sha256: content.sha256,
      actual_sha256: actualSha,
      expected_size_bytes: content.size_bytes,
      actual_size_bytes: buffer.length,
      relative_path: content.relative_path,
      message: "exported artifact content checksum does not match manifest",
    };
  }
  const destination = artifactStorePath(content.relative_path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, buffer);
  return {
    id: content.artifact_id,
    path: content.relative_path,
    status: "ok",
    expected_sha256: content.sha256,
    actual_sha256: actualSha,
    expected_size_bytes: content.size_bytes,
    actual_size_bytes: buffer.length,
    relative_path: content.relative_path,
    message: "stored artifact content imported",
  };
}

export function redactArtifactMetadata<T>(value: T): T {
  return redactValue(value);
}

// ---------------------------------------------------------------------------
// File-level artifact storage (the layer src/db/artifacts.ts builds on).
//
// `storeArtifactContent` above is the redacting, content-addressed primitive
// used for evidence. The functions below are the file-oriented layer: they copy
// the *original* file into a per-artifact location (or reference it in place)
// and provide retention/export helpers. Behavior is pinned by
// src/db/artifacts.test.ts.
// ---------------------------------------------------------------------------

export type ArtifactStorageModeValue = "copy" | "reference";

export interface StoreArtifactFileInput {
  artifactId: string;
  sourcePath: string;
  storageMode?: ArtifactStorageModeValue;
  name?: string;
  dbPath?: string;
}

export interface StoredArtifactFile {
  sourcePath: string;
  localPath: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CleanupPolicy {
  deleted_retention_days?: number;
  now?: Date;
}

export interface ArtifactExportEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string | null;
  storage_mode: string;
  source_path: string | null;
  local_path: string | null;
  content_hash: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  redaction_status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ArtifactExportManifest {
  schema_version: "todos.artifacts.v1";
  store_root: string;
  exported_at: string;
  artifacts: ArtifactExportEntry[];
}

const DEFAULT_DELETED_RETENTION_DAYS = 30;

/** Root directory of the local artifact store for a given (or default) db path. */
export function getArtifactStoreRoot(dbPath?: string): string {
  if (process.env["HASNA_TODOS_ARTIFACTS_DIR"]) return resolve(process.env["HASNA_TODOS_ARTIFACTS_DIR"]);
  if (process.env["TODOS_ARTIFACTS_DIR"]) return resolve(process.env["TODOS_ARTIFACTS_DIR"]);
  const path = dbPath ?? getDatabasePath();
  if (isInMemoryDb(path)) return join(tmpdir(), "hasna-todos-artifacts");
  return join(dirname(resolve(path)), "artifacts");
}

/** sha256 of a file's raw bytes. */
export function computeContentHash(path: string): string {
  return sha256(readFileSync(resolve(path)));
}

/**
 * Copy (or reference) a source file into the local artifact store, preserving
 * the original bytes. Copies live at `<store-root>/<artifactId>/<name>`.
 */
export function storeArtifactFile(input: StoreArtifactFileInput): StoredArtifactFile {
  const sourcePath = resolve(input.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${input.sourcePath}`);
  }
  if (!statSync(sourcePath).isFile()) {
    throw new Error(`Source path is not a file: ${input.sourcePath}`);
  }
  const buffer = readFileSync(sourcePath);
  const contentHash = sha256(buffer);
  const mimeType = mediaTypeFor(sourcePath, isTextLike(buffer, sourcePath));
  const storageMode: ArtifactStorageModeValue = input.storageMode ?? "copy";

  let localPath = sourcePath;
  if (storageMode === "copy") {
    const fileName = input.name && input.name.trim().length > 0 ? basename(input.name) : basename(sourcePath);
    const destination = join(getArtifactStoreRoot(input.dbPath), input.artifactId, fileName);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, buffer);
    localPath = destination;
  }

  return { sourcePath, localPath, contentHash, mimeType, sizeBytes: buffer.length };
}

/** Remove a stored artifact copy. Reference-mode sources are never touched. */
export function deleteStoredArtifactFile(
  localPath: string | null,
  storageMode: string,
  _dbPath?: string,
): boolean {
  if (storageMode === "reference") return false;
  if (!localPath || !existsSync(localPath)) return false;
  rmSync(localPath, { force: true });
  try {
    rmSync(dirname(localPath), { recursive: false });
  } catch {
    /* per-artifact directory not empty or already gone */
  }
  return true;
}

/** Whether a soft-deleted artifact has aged past the retention window. */
export function isArtifactExpired(deletedAt: string | null, policy: CleanupPolicy = {}): boolean {
  if (!deletedAt) return false;
  const retentionDays = policy.deleted_retention_days ?? DEFAULT_DELETED_RETENTION_DAYS;
  const now = policy.now ?? new Date();
  const ageMs = now.getTime() - new Date(deletedAt).getTime();
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}

/** Build an export manifest tied to the local store root. */
export function buildArtifactExportManifest(
  artifacts: ArtifactExportEntry[],
  dbPath?: string,
): ArtifactExportManifest {
  return {
    schema_version: "todos.artifacts.v1",
    store_root: getArtifactStoreRoot(dbPath),
    exported_at: new Date().toISOString(),
    artifacts,
  };
}

/** Write an export manifest to disk as pretty JSON. */
export function writeArtifactExportManifest(manifest: ArtifactExportManifest, outputPath: string): string {
  const destination = resolve(outputPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  return destination;
}
