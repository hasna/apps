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

export interface CompletePage<T> {
  readonly rows: T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly has_more: boolean;
}

export interface CompletePopulation<T> {
  readonly rows: T[];
  readonly total: number;
  readonly pages: number;
  readonly complete: true;
}

export type CompletePageFetcher<T> = (params: { limit: number; offset: number }) => Promise<CompletePage<T>>;

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
        if (seen.has(id)) {
          throw new PaginationError(
            `Projects list pagination returned duplicate row "${id}" at offset ${offset}; refusing to deduplicate a possibly missing page.`,
          );
        }
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

/**
 * Walk a producer that reports its complete match total on every page.
 *
 * This is intentionally stricter than `collectPages`: a complete population
 * is evidence, not a best-effort list. The producer total must remain stable,
 * offsets must advance exactly by the rows returned, every row must have a
 * unique identity, and the terminal page must account for the whole total.
 */
export async function collectCompletePages<T>(
  fetchPage: CompletePageFetcher<T>,
  identify: (row: T) => string | undefined,
  options: Pick<CollectPagesOptions, "pageSize" | "maxPages"> = {},
): Promise<CompletePopulation<T>> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const requestSize = options.pageSize ?? DEFAULT_PAGE_REQUEST;
  const collected: T[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | undefined;
  let pages = 0;

  for (; pages < maxPages; pages++) {
    const page = await fetchPage({ limit: requestSize, offset });
    if (!Number.isInteger(page.total) || page.total < 0) {
      throw new PaginationError(`Complete project traversal requires a non-negative integer producer total at offset ${offset}.`);
    }
    if (!Number.isInteger(page.offset) || page.offset !== offset) {
      throw new PaginationError(`Projects list producer returned offset ${page.offset} for requested offset ${offset}; refusing traversal.`);
    }
    if (!Number.isInteger(page.limit) || page.limit <= 0) {
      throw new PaginationError(`Projects list producer returned invalid page limit ${page.limit} at offset ${offset}.`);
    }
    if (page.rows.length > page.limit) {
      throw new PaginationError(`Projects list producer returned ${page.rows.length} rows for limit ${page.limit}; refusing traversal.`);
    }
    if (expectedTotal === undefined) expectedTotal = page.total;
    if (page.total !== expectedTotal) {
      throw new PaginationError(
        `Projects list producer total changed during traversal (${expectedTotal} -> ${page.total} at offset ${offset}); refusing a moving population.`,
      );
    }
    const expectedHasMore = offset + page.rows.length < expectedTotal;
    if (page.has_more !== expectedHasMore) {
      throw new PaginationError(
        `Projects list producer has_more=${page.has_more} disagrees with total=${expectedTotal} and rows through ${offset + page.rows.length}.`,
      );
    }

    if (page.rows.length === 0) {
      if (expectedTotal !== 0 || page.has_more) {
        throw new PaginationError(`Projects list producer returned an empty non-terminal page at offset ${offset}; refusing missing-page traversal.`);
      }
      return { rows: collected, total: expectedTotal, pages: pages + 1, complete: true };
    }

    for (const row of page.rows) {
      const id = identify(row);
      if (!id) throw new PaginationError(`Projects list producer returned a row without a stable identity at offset ${offset}.`);
      if (seen.has(id)) {
        throw new PaginationError(`Projects list producer returned duplicate row "${id}" at offset ${offset}; refusing traversal.`);
      }
      seen.add(id);
      collected.push(row);
    }

    if (!page.has_more) {
      if (collected.length !== expectedTotal) {
        throw new PaginationError(
          `Projects list terminal invariant failed: collected ${collected.length} unique rows, producer total is ${expectedTotal}.`,
        );
      }
      return { rows: collected, total: expectedTotal, pages: pages + 1, complete: true };
    }

    offset += page.rows.length;
  }

  throw new PaginationError(`Projects list exceeded the ${maxPages}-page safety bound before reaching a terminal invariant.`);
}
