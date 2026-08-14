export const DEFAULT_LIST_LIMIT = 20;
export const DEFAULT_DETAIL_LIMIT = 5;
export const MAX_LIST_LIMIT = 200;

export interface Page<T> {
  items: T[];
  total: number;
  shown: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Parse a --limit value.
 *
 * `maxLimit` caps the result. It defaults to MAX_LIST_LIMIT, which is a *display*
 * bound for human output. Machine-readable output MUST pass `Infinity` instead:
 * silently clamping a requested limit and then echoing the clamped value back as
 * `limit` produces a response that is self-consistent with a request the caller
 * never made, which is indistinguishable from a complete read.
 */
export function parseLimit(
  value: string | number | undefined,
  fallback = DEFAULT_LIST_LIMIT,
  maxLimit: number = MAX_LIST_LIMIT
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--limit must be a non-negative integer");
  }
  return Math.min(parsed, maxLimit);
}

export function parseOffset(value: string | number | undefined): number {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--offset must be a non-negative integer");
  }
  return parsed;
}

export function pageItems<T>(
  items: T[],
  options: {
    limit?: string | number;
    offset?: string | number;
    all?: boolean;
    fallbackLimit?: number;
    maxLimit?: number;
  } = {}
): Page<T> {
  const offset = parseOffset(options.offset);
  const limit = options.all
    ? Math.max(items.length - offset, 0)
    : parseLimit(options.limit, options.fallbackLimit, options.maxLimit);
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    total: items.length,
    shown: page.length,
    limit,
    offset,
    hasMore: offset + page.length < items.length,
  };
}

export function pageItemsOrExit<T>(
  items: T[],
  options: {
    limit?: string | number;
    offset?: string | number;
    all?: boolean;
    fallbackLimit?: number;
    maxLimit?: number;
  } = {}
): Page<T> {
  try {
    return pageItems(items, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function truncateText(value: unknown, max = 96): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return value.split("T")[0]?.split(" ")[0] || value;
}

export function compactHint(
  page: Pick<Page<unknown>, "shown" | "total" | "limit" | "offset" | "hasMore">,
  noun: string,
  detailHint: string,
  options: { paging?: "offset" | "limit" | "none" } = {}
): string {
  const base = `Showing ${page.shown}/${page.total} ${noun}`;
  let paging = "";
  if (page.hasMore) {
    if (options.paging === "limit") {
      const nextLimit = Math.min(page.total, page.offset + page.limit + DEFAULT_LIST_LIMIT);
      paging = `; use --limit ${nextLimit} or --all for more`;
    } else if (options.paging !== "none") {
      paging = `; use --limit ${page.limit} --offset ${page.offset + page.shown} for more`;
    }
  }
  return `${base}${paging}. ${detailHint}`;
}
