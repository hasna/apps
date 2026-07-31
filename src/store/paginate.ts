// Cursor-free page walking for list endpoints that the server bounds.
//
// The projects API clamps every list response to a server-side maximum row
// count. A client that issues one request and returns the body therefore
// returns a TRUNCATED set with no way for the caller to notice: the response
// carries the page length, not the total, so a full page and a complete result
// are indistinguishable.
//
// `collectPages` removes that failure mode by walking `offset` until the server
// stops producing rows. It never assumes what the cap is — the stride is
// learned from the first response — so a server that raises or lowers its cap
// needs no client change.

/** Fetch one page. Implementations must send BOTH limit and offset. */
export type PageFetcher<T> = (params: { limit: number; offset: number }) => Promise<T[]>;

export interface CollectPagesOptions {
  /**
   * Requested page size. This is a HINT, not a cap: the server is free to
   * return fewer rows, and whatever it returns for the first page becomes the
   * stride for the rest of the walk. Deliberately larger than any cap we know
   * of so a single round trip suffices where the server allows it.
   */
  readonly pageSize?: number;
  /** Stop after this many rows. Undefined means "every row". */
  readonly want?: number;
  /** Start here. Defaults to 0. */
  readonly offset?: number;
  /**
   * Safety valve for a server that neither errors nor advances. Exceeding it
   * throws — a loud failure is always preferable to a quietly short list.
   */
  readonly maxPages?: number;
}

export const DEFAULT_PAGE_REQUEST = 5_000;
export const DEFAULT_MAX_PAGES = 1_000;

export class PaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginationError";
  }
}

/**
 * Walk a bounded list endpoint until it is exhausted (or `want` rows are in
 * hand) and return the rows in server order.
 *
 * Termination is driven entirely by what comes back:
 *   - an empty page ends the walk;
 *   - a page shorter than the stride is the last page;
 *   - a full page means "there may be more", so we ask again at the next offset.
 *
 * A server that ignores `offset` would otherwise loop forever handing back the
 * same page; that is detected via `identify` and raised rather than silently
 * cut short.
 */
export async function collectPages<T>(
  fetchPage: PageFetcher<T>,
  identify: (row: T) => string | undefined,
  options: CollectPagesOptions = {},
): Promise<T[]> {
  const want = options.want;
  if (want !== undefined && want <= 0) return [];

  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const requestSize = options.pageSize ?? DEFAULT_PAGE_REQUEST;
  let offset = options.offset ?? 0;

  const collected: T[] = [];
  const seen = new Set<string>();
  // Learned from the first response; until then we only know what we asked for.
  let stride: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const remaining = want === undefined ? undefined : want - collected.length;
    if (remaining !== undefined && remaining <= 0) break;
    const ask = remaining === undefined ? (stride ?? requestSize) : Math.min(remaining, stride ?? requestSize);

    const rows = await fetchPage({ limit: ask, offset });
    if (rows.length === 0) break;

    let fresh = 0;
    for (const row of rows) {
      const id = identify(row);
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      collected.push(row);
      fresh++;
      if (want !== undefined && collected.length >= want) break;
    }

    // Every row on a non-empty page was one we already had: the server is not
    // honouring `offset`. Continuing would spin; stopping would silently
    // truncate. Neither is acceptable, so surface it.
    if (fresh === 0) {
      throw new PaginationError(
        `Projects list pagination stalled at offset ${offset}: the server returned ${rows.length} row(s) that were all already seen, which means it is ignoring the offset parameter. Refusing to return a silently truncated list.`,
      );
    }

    if (want !== undefined && collected.length >= want) break;

    // First response defines the real page size the server is willing to serve.
    if (stride === null) stride = rows.length;
    // Short page => that was the tail.
    if (rows.length < (stride ?? rows.length)) break;
    offset += rows.length;
  }

  return collected;
}
