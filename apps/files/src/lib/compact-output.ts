export const DEFAULT_COMPACT_LIMIT = 25;
export const DEFAULT_TEXT_WIDTH = 96;
export const DEFAULT_MCP_LIMIT = 25;
export const MAX_MCP_LIMIT = 100;

export interface CompactPage<T> {
  count: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number;
  items: T[];
  hint?: string;
}

export function truncateText(value: unknown, maxLength = DEFAULT_TEXT_WIDTH): string {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  const keepStart = Math.max(1, Math.ceil((maxLength - 3) * 0.55));
  const keepEnd = Math.max(1, maxLength - 3 - keepStart);
  return `${text.slice(0, keepStart)}...${text.slice(-keepEnd)}`;
}

export function normalizeCompactLimit(
  value: string | number | undefined,
  fallback = DEFAULT_COMPACT_LIMIT,
  max = MAX_MCP_LIMIT,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function compactPage<T>(
  items: T[],
  opts: {
    limit?: number;
    offset?: number;
    hasMore?: boolean;
    hint?: string;
  } = {},
): CompactPage<T> {
  return {
    count: items.length,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    ...(opts.hasMore !== undefined ? { has_more: opts.hasMore } : {}),
    ...(opts.hasMore && opts.limit !== undefined && opts.offset !== undefined
      ? { next_offset: opts.offset + items.length }
      : {}),
    items,
    ...(opts.hint ? { hint: opts.hint } : {}),
  };
}

export function compactFileRecord(
  file: Record<string, unknown>,
  opts: { verbose?: boolean; textWidth?: number } = {},
): Record<string, unknown> {
  if (opts.verbose) return file;
  return definedRecord({
    id: file.id,
    name: truncateText(file.name, opts.textWidth ?? 64),
    path: truncateText(file.path, opts.textWidth ?? DEFAULT_TEXT_WIDTH),
    size: file.size,
    ext: file.ext,
    status: file.status,
    source_id: file.source_id,
    source_name: file.source_name,
    tags: arrayValue(file.tags),
    modified_at: file.modified_at,
    indexed_at: file.indexed_at,
  });
}

export function compactSourceRecord(
  source: Record<string, unknown>,
  opts: { verbose?: boolean; textWidth?: number } = {},
): Record<string, unknown> {
  if (opts.verbose) return source;
  return definedRecord({
    id: source.id,
    name: truncateText(source.name, opts.textWidth ?? 48),
    type: source.type,
    location: compactSourceLocation(source, opts.textWidth ?? DEFAULT_TEXT_WIDTH),
    enabled: source.enabled,
    file_count: source.file_count,
    machine_id: source.machine_id,
    last_indexed_at: source.last_indexed_at,
  });
}

export function compactActivityRecord(
  activity: Record<string, unknown>,
  opts: { verbose?: boolean; textWidth?: number } = {},
): Record<string, unknown> {
  if (opts.verbose) return activity;
  return definedRecord({
    id: activity.id,
    agent_id: activity.agent_id,
    action: activity.action,
    file_id: activity.file_id,
    source_id: activity.source_id,
    created_at: activity.created_at,
    metadata: truncateText(JSON.stringify(activity.metadata ?? {}), opts.textWidth ?? 80),
  });
}

function compactSourceLocation(source: Record<string, unknown>, maxLength: number): string | undefined {
  if (source.type === "s3") {
    const bucket = String(source.bucket ?? "");
    const prefix = source.prefix ? `/${source.prefix}` : "";
    return truncateText(`s3://${bucket}${prefix}`, maxLength);
  }
  if (source.type === "google_drive") {
    const config = source.config as { profile?: string } | undefined;
    return truncateText(`google-drive:${config?.profile ?? "unknown"}`, maxLength);
  }
  return source.path === undefined ? undefined : truncateText(source.path, maxLength);
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function definedRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
