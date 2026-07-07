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
    if (LOCAL_PATH_METADATA_KEYS.has(key)) continue;
    redacted[key] = redactPublicMetadataValue(nestedValue);
  }
  return redacted;
}

export function publicMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactPublicMetadataValue(metadata) as Record<string, unknown>;
}

export function publicClipRecord(record: ClipRecord): Record<string, unknown> {
  const { artifactPath: _artifactPath, metadata, ...rest } = record;
  return {
    ...rest,
    hasArtifact: Boolean(record.artifactPath),
    rawUrl: `/s/${encodeURIComponent(record.slug)}/raw`,
    metadata: publicMetadata(metadata),
  };
}

export function publicClipRecords(records: ClipRecord[]): Record<string, unknown>[] {
  return records.map(publicClipRecord);
}

export function publicStorageStatus(status: ClipStorageStatus): Record<string, unknown> {
  return {
    totalActive: status.totalActive,
    deleted: status.deleted,
    database: "sqlite",
    artifacts: "local",
    localPathsRedacted: true,
  };
}
