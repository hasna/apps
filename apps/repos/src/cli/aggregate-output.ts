/**
 * Token-bounded machine output for secondary aggregate commands.
 *
 * These commands often derive every matching row before presentation (dirty
 * worktrees, cross-org authors, dependency walks, and similar summaries). The
 * derivation can remain exhaustive, but ordinary JSON must not inject the
 * whole population into an agent context. This helper applies a stable
 * offset window, a caller-supplied compact projection, and a whole-response
 * UTF-8 byte ceiling while keeping continuation metadata truthful.
 */

export const AGGREGATE_JSON_DEFAULT_LIMIT = 20;
export const AGGREGATE_JSON_MAX_BYTES = 32 * 1024;

export interface AggregatePageOptions<T, U> {
  collection: string;
  items: readonly T[];
  cursor: number;
  limit: number;
  project: (item: T) => U;
  maxBytes?: number;
}

export type AggregatePage = {
  [collection: string]: unknown;
  count: number;
  total: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
  has_more: boolean;
  complete: boolean;
  compact: true;
  byte_limit: number;
  hint: string;
};

function serializedBytes(value: unknown): number {
  // CLI JSON output includes one trailing newline through printJsonLine().
  return Buffer.byteLength(`${JSON.stringify(value)}\n`, "utf8");
}

function envelope<U>(
  collection: string,
  rows: readonly U[],
  total: number,
  cursor: number,
  limit: number,
  maxBytes: number,
): AggregatePage {
  const next = cursor + rows.length;
  const hasMore = next < total;
  return {
    [collection]: rows,
    count: rows.length,
    total,
    limit,
    cursor,
    next_cursor: hasMore ? next : null,
    has_more: hasMore,
    complete: !hasMore,
    compact: true,
    byte_limit: maxBytes,
    hint: hasMore
      ? `Continue with --cursor ${next}; use --full or --all for exhaustive legacy JSON.`
      : "Use --full or --all for exhaustive legacy JSON.",
  } as AggregatePage;
}

/**
 * Build one minified aggregate page whose serialized stdout is never larger
 * than maxBytes. Rows are consumed only after the complete envelope fits, so
 * next_cursor always names the first row not returned.
 */
export function buildAggregatePage<T, U>(options: AggregatePageOptions<T, U>): AggregatePage {
  const { collection, items, project } = options;
  const cursor = Math.max(0, Math.trunc(options.cursor));
  const limit = Math.max(1, Math.trunc(options.limit));
  const maxBytes = Math.max(512, Math.trunc(options.maxBytes ?? AGGREGATE_JSON_MAX_BYTES));
  const start = Math.min(cursor, items.length);
  const candidates = items.slice(start, start + limit);
  const rows: U[] = [];

  for (const item of candidates) {
    const candidateRows = [...rows, project(item)];
    const candidate = envelope(collection, candidateRows, items.length, start, limit, maxBytes);
    if (serializedBytes(candidate) > maxBytes) break;
    rows.push(candidateRows[candidateRows.length - 1]!);
  }

  if (candidates.length > 0 && rows.length === 0) {
    throw new Error(
      `compact ${collection} projection cannot fit one row within ${maxBytes} UTF-8 bytes`,
    );
  }

  const page = envelope(collection, rows, items.length, start, limit, maxBytes);
  if (serializedBytes(page) > maxBytes) {
    throw new Error(`compact ${collection} envelope exceeds ${maxBytes} UTF-8 bytes`);
  }
  return page;
}

export function aggregatePageBytes(value: unknown): number {
  return serializedBytes(value);
}
