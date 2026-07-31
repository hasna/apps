// ── How a message read is ordered ────────────────────────────────────────────
//
// One resolver, shared by every read path — the sqlite store, the HTTP store,
// and the CLI/MCP paging that windows their answer. It exists because the rule
// used to be written out separately in each store and drifted into a defect
// (todos 2c25973b): both defaulted to `ORDER BY created_at ASC LIMIT N`, so a
// bare `--limit N` — the shape every recency read and channel watcher uses —
// answered with the OLDEST N messages and looked healthy while doing it.
//
// Nothing here touches the database; it is a pure decision so both stores are
// provably making the same one.

export type ReadOrder = "asc" | "desc";

/**
 * Only the fields that decide ordering. Deliberately `unknown`-typed and checked
 * at runtime: MCP tool arguments arrive as loose JSON, so every read option
 * object — typed or not — is assignable and is validated the same way.
 */
export interface ReadWindowInput {
  order?: unknown;
  latest?: unknown;
  since?: unknown;
  since_id?: unknown;
}

export interface ResolvedReadWindow {
  /**
   * The direction the store must SELECT in — i.e. which N rows it returns. A
   * client-side sort cannot substitute for this: the rows the store leaves out
   * never arrive.
   */
  select: ReadOrder;
  /**
   * True when the selected rows must be reversed before they are returned, so a
   * newest-N window still reads as a chronological transcript.
   */
  reverse: boolean;
  /**
   * True when the result is a newest-anchored window. Callers that over-fetch
   * `limit + 1` rows to probe for "more" must keep the TAIL of the array, not
   * the head, or they drop the newest message they just went to fetch.
   */
  newestWindow: boolean;
}

/**
 * The row cap a read falls back to when the caller names no limit. Every read
 * path shares this one number so the CLI can tell whether an answer came back
 * full — and therefore possibly truncated — without guessing what the store
 * would have used.
 */
export const DEFAULT_READ_LIMIT = 20;

/**
 * The number of rows a read will actually cap at: an explicit positive `latest`
 * first, then an explicit positive `limit`, then {@link DEFAULT_READ_LIMIT}.
 */
export function resolveReadLimit(input: object = {}): number {
  const opts = input as { limit?: unknown; latest?: unknown };
  if (typeof opts.latest === "number" && opts.latest > 0) return Math.floor(opts.latest);
  if (typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0) {
    return Math.floor(opts.limit);
  }
  return DEFAULT_READ_LIMIT;
}

/**
 * Decide how to order a `readMessages` query.
 *
 * - An explicit `order` wins and is passed through untouched, so existing
 *   callers (polling with `order: "asc"`, `serve` with `order: "desc"`) and the
 *   `--order` flag keep their exact semantics.
 * - `latest: N` is unchanged: the newest N, newest first.
 * - A `since_id` anchor is a CURSOR — "the next page after this exact id" — and
 *   keeps ascending selection. A newest-N window there would let a catch-up walk
 *   skip the middle of a backlog and never notice.
 * - `since` is NOT a cursor. It is a time filter answering "what happened since
 *   T", and it was the same defect as a bare `limit`: `--since 3h` selected the
 *   OLDEST 20 rows of the window (todos 2c25973b). It is a recency window.
 * - Everything else is a recency window: select the newest N, hand them back
 *   chronologically.
 */
export function resolveReadWindow(input: object = {}): ResolvedReadWindow {
  // `object` rather than `ReadWindowInput` so both the typed store options and a
  // loose MCP argument bag are accepted; every field is checked at runtime below.
  const opts = input as ReadWindowInput;
  const explicit = typeof opts.order === "string" ? opts.order.toLowerCase() : "";
  if (explicit === "asc" || explicit === "desc") {
    return { select: explicit, reverse: false, newestWindow: false };
  }
  if (typeof opts.latest === "number" && opts.latest > 0) {
    return { select: "desc", reverse: false, newestWindow: false };
  }
  if (typeof opts.since_id === "number" && Number.isFinite(opts.since_id)) {
    return { select: "asc", reverse: false, newestWindow: false };
  }
  return { select: "desc", reverse: true, newestWindow: true };
}

/**
 * Take the `limit` rows a caller actually asked for out of an over-fetched
 * (`limit + 1`) result. For a newest-anchored window that is the tail; for every
 * other shape it is the head, exactly as before.
 */
export function takeWindow<T>(items: T[], limit: number, newestWindow: boolean): T[] {
  if (items.length <= limit) return items;
  return newestWindow ? items.slice(items.length - limit) : items.slice(0, limit);
}
