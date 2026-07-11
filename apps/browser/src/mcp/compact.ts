export const DEFAULT_MCP_LIST_LIMIT = 25;
export const MAX_MCP_LIST_LIMIT = 200;
export const DEFAULT_MCP_TEXT_CHARS = 4000;
export const MAX_MCP_TEXT_CHARS = 20000;

export interface CompactListResult<T> {
  items: T[];
  count: number;
  total: number;
  limit: number;
  truncated: boolean;
  next_offset?: number;
  hint?: string;
}

export function clampLimit(value: number | undefined, fallback = DEFAULT_MCP_LIST_LIMIT): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return fallback;
  return Math.min(Math.floor(value as number), MAX_MCP_LIST_LIMIT);
}

export function clampOffset(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return 0;
  return Math.floor(value as number);
}

export function clampChars(value: number | undefined, fallback = DEFAULT_MCP_TEXT_CHARS): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return fallback;
  return Math.min(Math.floor(value as number), MAX_MCP_TEXT_CHARS);
}

export function truncateText(value: unknown, max = 120): string {
  const text = value == null ? "" : String(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function compactList<T, U>(
  items: T[],
  limitInput: number | undefined,
  map: (item: T) => U,
  options: { offset?: number; hint?: string } = {},
): CompactListResult<U> {
  const limit = clampLimit(limitInput);
  const offset = clampOffset(options.offset);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const truncated = nextOffset < items.length;
  return {
    items: page.map(map),
    count: page.length,
    total: items.length,
    limit,
    truncated,
    ...(truncated ? { next_offset: nextOffset } : {}),
    ...(options.hint ? { hint: options.hint } : {}),
  };
}
