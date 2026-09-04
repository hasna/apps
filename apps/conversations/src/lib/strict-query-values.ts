import {
  resolveCollectionLimit,
  resolveCollectionMaxBytes,
  resolveCollectionOffset,
  resolveCollectionPreviewBytes,
  resolveCollectionTimeoutMs,
} from "./message-previews.js";

export interface CollectionQueryOptions {
  limit: number;
  offset: number;
  maxBytes: number;
  previewBytes: number;
  timeoutMs: number;
}

export const ANALYTICS_LIMIT_MAX = 1000;

const ISO_8601_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)))?$/;

export function resolvePresentString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  return normalized;
}

export function resolveAliasedString(
  searchParams: Pick<URLSearchParams, "get">,
  primary: string,
  alias: string,
): string | undefined {
  const primaryValue = resolvePresentString(searchParams.get(primary), primary);
  const aliasValue = resolvePresentString(searchParams.get(alias), alias);
  if (primaryValue !== undefined && aliasValue !== undefined && primaryValue !== aliasValue) {
    throw new Error(`${primary} and ${alias} must match when both are provided`);
  }
  return primaryValue ?? aliasValue;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function resolveIso8601Date(value: unknown, name: string): string | undefined {
  const normalized = resolvePresentString(value, name);
  if (normalized === undefined) return undefined;
  const match = ISO_8601_DATE.exec(normalized);
  if (
    !match
    || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    || !Number.isFinite(Date.parse(normalized))
  ) {
    throw new Error(`${name} must be a valid ISO 8601 date`);
  }
  return normalized;
}

export function resolveExportFormat(value: unknown): "json" | "csv" {
  const format = resolvePresentString(value, "format") ?? "json";
  if (format !== "json" && format !== "csv") throw new Error("format must be json or csv");
  return format;
}

function parsePositiveFiniteInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") throw new Error(`${name} must be a positive integer`);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveAnalyticsLimit(
  value: unknown,
  name: string,
  defaultValue: number,
  max = ANALYTICS_LIMIT_MAX,
): number {
  const parsed = parsePositiveFiniteInteger(value, name);
  if (parsed === undefined) return defaultValue;
  return Math.min(parsed, max);
}

/**
 * Shared collection parser for both cloud API and local HTTP routes.
 * URLSearchParams.get() preserves the absent-vs-present-empty distinction.
 */
export function resolveCollectionQueryOptions(searchParams: Pick<URLSearchParams, "get">): CollectionQueryOptions {
  const rawOffset = searchParams.get("offset");
  const rawCursor = searchParams.get("cursor");
  const offset = resolveCollectionOffset(rawOffset);
  const cursor = resolveCollectionOffset(rawCursor);
  if (rawOffset !== null && rawCursor !== null && offset !== cursor) {
    throw new Error("offset and cursor must match when both are provided");
  }
  return {
    limit: resolveCollectionLimit(searchParams.get("limit")),
    offset: rawOffset !== null ? offset : cursor,
    maxBytes: resolveCollectionMaxBytes(searchParams.get("max_bytes")),
    previewBytes: resolveCollectionPreviewBytes(searchParams.get("preview_bytes")),
    timeoutMs: resolveCollectionTimeoutMs(searchParams.get("timeout_ms")),
  };
}
