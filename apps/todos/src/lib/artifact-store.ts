import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getDatabasePath } from "../db/database.js";
import { redactEvidenceText, redactValue } from "./redaction.js";

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
  if (!sourceStat.isFile()) throw new Error(`Artifact path is not a file: ${input.path}`);

  const sourceBuffer = readFileSync(sourcePath);
  const sourceSha = sha256(sourceBuffer);
  const textLike = isTextLike(sourceBuffer, input.path);
  let storedBuffer = sourceBuffer;
  let redactionStatus: ArtifactRedactionStatus = textLike ? "clean" : "binary_or_unknown";
  if (textLike) {
    const redactedText = redactEvidenceText(sourceBuffer.toString("utf8"));
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
        path: input.path,
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
