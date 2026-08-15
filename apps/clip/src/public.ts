import { readAccessProtection, SENSITIVE_METADATA_KEYS } from "./access.js";
import type { ClipRecord, ClipStorageStatus } from "./types.js";

const LOCAL_PATH_METADATA_KEYS = new Set([
  "artifactDir",
  "artifactPath",
  "dbPath",
  "filePath",
  "homeDir",
  "localPath",
  "outputPath",
  "path",
]);

function looksLikeLocalPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("file://") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /(^|[\s("'[,;=:])\/(?!\/)[^\s"'<>]+/.test(value) ||
    /(^|[\s("'[,;=])[A-Za-z]:[\\/][^\s"'<>]+/.test(value) ||
    /file:\/\/[^\s"'<>]+/i.test(value)
  );
}

function redactPublicMetadataValue(value: unknown): unknown {
  if (typeof value === "string") return looksLikeLocalPath(value) ? "[redacted]" : value;
  if (Array.isArray(value)) return value.map(redactPublicMetadataValue);
  if (!value || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (LOCAL_PATH_METADATA_KEYS.has(key) || SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) continue;
    redacted[key] = redactPublicMetadataValue(nestedValue);
  }
  return redacted;
}

export function publicMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactPublicMetadataValue(metadata) as Record<string, unknown>;
}

export function publicClipRecord(record: ClipRecord, options: { authorized?: boolean } = {}): Record<string, unknown> {
  const protection = readAccessProtection(record.metadata);
  const authorized = !protection || options.authorized === true;
  const { artifactPath: _artifactPath, metadata, text, sha256: recordSha256, ...rest } = record;
  const publicRecord: Record<string, unknown> = {
    ...rest,
    text: authorized ? text : null,
    sha256: authorized ? recordSha256 : "[redacted]",
    hasArtifact: Boolean(record.artifactPath),
    rawUrl: `/s/${encodeURIComponent(record.slug)}/raw`,
    metadata: publicMetadata(metadata),
  };
  if (protection) publicRecord["protected"] = true;
  return publicRecord;
}

export function publicClipRecords(records: ClipRecord[]): Record<string, unknown>[] {
  return records.map((record) => publicClipRecord(record));
}

export function publicStorageStatus(status: ClipStorageStatus): Record<string, unknown> {
  return {
    totalActive: status.totalActive,
    expired: status.expired,
    deleted: status.deleted,
    database: "sqlite",
    artifacts: "local",
    localPathsRedacted: true,
  };
}
