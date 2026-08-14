export interface SanitizePathSegmentOptions {
  fallback?: string;
  maxLength?: number;
}

export interface NormalizeFolderPathSegmentsOptions
  extends SanitizePathSegmentOptions {
  maxDepth?: number;
  segmentFallback?: string;
}

export interface NormalizeSafeRelativePathOptions {
  allowEmpty?: boolean;
  maxLength?: number;
  invalidMessage?: string;
  emptyMessage?: string;
  nullByteMessage?: string;
  absoluteMessage?: string;
  traversalMessage?: string;
}

const DEFAULT_SEGMENT_FALLBACK = "file";
const DEFAULT_SEGMENT_MAX_LENGTH = 200;
const DEFAULT_FOLDER_MAX_DEPTH = 6;
const DEFAULT_PATH_MAX_LENGTH = 1024;

export function sanitizePathSegment(
  name: unknown,
  options: SanitizePathSegmentOptions = {},
): string {
  const fallback = options.fallback ?? DEFAULT_SEGMENT_FALLBACK;
  const maxLength = options.maxLength ?? DEFAULT_SEGMENT_MAX_LENGTH;
  const value = typeof name === "string" ? name : "";
  const cleaned = value
    .replace(/[/\\\x00]/g, "")
    .replace(/^\.+/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, maxLength);
  return cleaned || fallback;
}

export function normalizeFolderPathSegments(
  folderPath: string | null | undefined,
  options: NormalizeFolderPathSegmentsOptions = {},
): string[] {
  const fallback = options.fallback ?? "folder";
  const segmentFallback = options.segmentFallback ?? "folder";
  const maxDepth = options.maxDepth ?? DEFAULT_FOLDER_MAX_DEPTH;
  const raw = (folderPath?.trim() || fallback).replace(/\\/g, "/");
  const segments = raw
    .split("/")
    .map((segment) =>
      sanitizePathSegment(segment.trim(), {
        fallback: segmentFallback,
        maxLength: options.maxLength,
      }),
    )
    .filter(Boolean)
    .slice(0, maxDepth);

  if (segments.length > 0) return segments;
  return [
    sanitizePathSegment(fallback, {
      fallback: segmentFallback,
      maxLength: options.maxLength,
    }),
  ];
}

export function normalizeSafeRelativePath(
  raw: unknown,
  options: NormalizeSafeRelativePathOptions = {},
): string {
  const invalidMessage = options.invalidMessage ?? "Invalid path";
  const emptyMessage = options.emptyMessage ?? "Path cannot be empty";
  const nullByteMessage = options.nullByteMessage ?? "Path contains null byte";
  const absoluteMessage =
    options.absoluteMessage ?? "Absolute paths are not allowed";
  const traversalMessage =
    options.traversalMessage ?? "Path traversal segments not allowed";
  const maxLength = options.maxLength ?? DEFAULT_PATH_MAX_LENGTH;

  if (raw == null || raw === "") {
    if (options.allowEmpty) return "";
    throw new Error(emptyMessage);
  }
  if (typeof raw !== "string" || raw.length > maxLength) {
    throw new Error(invalidMessage);
  }
  if (raw.includes("\0")) {
    throw new Error(nullByteMessage);
  }
  if (raw.startsWith("/") || raw.startsWith("\\")) {
    throw new Error(absoluteMessage);
  }

  const normalized = raw.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) {
    throw new Error(traversalMessage);
  }

  return normalized;
}
