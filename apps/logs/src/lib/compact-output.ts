import type { LogRow } from "../types/index.ts";

export const DEFAULT_LOG_LIST_LIMIT = 25;
export const MAX_LOG_LIST_LIMIT = 999;
export const DEFAULT_COMPACT_LOG_MAX_BYTES = 32 * 1024;
export const MIN_COMPACT_LOG_MAX_BYTES = 1024;
export const MAX_COMPACT_LOG_MAX_BYTES = 1024 * 1024;

const FIELD_BYTES = Object.freeze({
  timestamp: 40,
  level: 12,
  service: 64,
  id: 80,
  message: 160,
});

function parseInteger(value: unknown, label: string): number {
  const text = String(value ?? "").trim();
  const parsed = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== text) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

export function parseLogListLimit(value: unknown): number {
  const parsed = parseInteger(value, "--limit");
  if (parsed < 1 || parsed > MAX_LOG_LIST_LIMIT) {
    throw new Error(`--limit must be between 1 and ${MAX_LOG_LIST_LIMIT}`);
  }
  return parsed;
}

export function parseLogListOffset(value: unknown): number {
  if (value === undefined) return 0;
  const parsed = parseInteger(value, "--offset");
  if (parsed < 0) throw new Error("--offset must be non-negative");
  return parsed;
}

export function parseCompactLogMaxBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_COMPACT_LOG_MAX_BYTES;
  const parsed = parseInteger(value, "--max-bytes");
  if (
    parsed < MIN_COMPACT_LOG_MAX_BYTES ||
    parsed > MAX_COMPACT_LOG_MAX_BYTES
  ) {
    throw new Error(
      `--max-bytes must be between ${MIN_COMPACT_LOG_MAX_BYTES} and ${MAX_COMPACT_LOG_MAX_BYTES}`,
    );
  }
  return parsed;
}

export function truncateUtf8(
  value: string | null | undefined,
  maxBytes: number,
): string {
  const normalized = (value ?? "-").replace(/\s+/g, " ").trim() || "-";
  if (Buffer.byteLength(normalized) <= maxBytes) return normalized;
  const suffix = "...";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix));
  let used = 0;
  let result = "";
  for (const char of normalized) {
    const bytes = Buffer.byteLength(char);
    if (used + bytes > budget) break;
    result += char;
    used += bytes;
  }
  return `${result}${suffix}`;
}

export function compactLogLine(row: LogRow): string {
  return [
    truncateUtf8(row.timestamp, FIELD_BYTES.timestamp),
    `[${truncateUtf8(row.level.toUpperCase(), FIELD_BYTES.level)}]`,
    truncateUtf8(row.service, FIELD_BYTES.service),
    `id=${truncateUtf8(row.id, FIELD_BYTES.id)}`,
    truncateUtf8(row.message, FIELD_BYTES.message),
  ].join(" ");
}

export interface CompactLogOutput {
  text: string;
  count: number;
  nextOffset: number | null;
  byteLength: number;
  byteLimited: boolean;
}

function footer(
  count: number,
  offset: number,
  nextOffset: number | null,
  maxBytes: number,
): string {
  const continuation =
    nextOffset === null
      ? "complete"
      : `next_offset=${nextOffset}; continue with --offset ${nextOffset}`;
  return `Showing ${count} log(s) from offset ${offset}; ${continuation}; bytes<=${maxBytes}. Use logs get <id> for full detail.`;
}

export function buildCompactLogOutput(
  rows: readonly LogRow[],
  options: { limit: number; offset: number; maxBytes: number },
): CompactLogOutput {
  const sourceHasMore = rows.length > options.limit;
  const candidates = rows.slice(0, options.limit);
  const lines: string[] = [];
  let byteLimited = false;

  for (let index = 0; index < candidates.length; index += 1) {
    const line = compactLogLine(candidates[index]!);
    const proposed = [...lines, line];
    const hasMore = sourceHasMore || index + 1 < candidates.length;
    const nextOffset = hasMore ? options.offset + proposed.length : null;
    const text =
      [
        ...proposed,
        footer(proposed.length, options.offset, nextOffset, options.maxBytes),
      ].join("\n") + "\n";
    if (Buffer.byteLength(text) > options.maxBytes) {
      byteLimited = true;
      break;
    }
    lines.push(line);
  }

  const hasMore = sourceHasMore || lines.length < candidates.length;
  const nextOffset = hasMore ? options.offset + lines.length : null;
  const text =
    [
      ...lines,
      footer(lines.length, options.offset, nextOffset, options.maxBytes),
    ].join("\n") + "\n";
  return {
    text,
    count: lines.length,
    nextOffset,
    byteLength: Buffer.byteLength(text),
    byteLimited,
  };
}
