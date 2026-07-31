import chalk from "chalk";
import {
  DEFAULT_COMPACT_LIMIT,
  MAX_COMPACT_LIMIT,
  resolveOutputWindow,
  windowItems,
  type OutputWindow,
} from "../lib/compact-output.js";
import { formatSortDescriptor, type SortDescriptor } from "../lib/list-order.js";
import { printErrorLine, printLine } from "../lib/stdout.js";

export function getCliWindow(opts: {
  limit?: unknown;
  cursor?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
}): OutputWindow {
  return resolveOutputWindow({
    limit: opts.limit,
    cursor: opts.cursor,
    defaultLimit: opts.defaultLimit ?? DEFAULT_COMPACT_LIMIT,
    maxLimit: opts.maxLimit ?? MAX_COMPACT_LIMIT,
  });
}

/**
 * The window for a machine-readable surface.
 *
 * `MAX_COMPACT_LIMIT` exists so a terminal is not flooded; applying it to
 * `--json` would silently clamp `--limit 500` to 100, which is the same
 * silent-truncation defect this change exists to remove. `defaultLimit` is the
 * limit the verb already applied before this change, so an existing caller that
 * passes no `--limit` keeps getting exactly the rows it got yesterday.
 */
export function getJsonWindow(opts: {
  limit?: unknown;
  cursor?: unknown;
  defaultLimit: number;
}): OutputWindow {
  return resolveOutputWindow({
    limit: opts.limit,
    cursor: opts.cursor,
    defaultLimit: opts.defaultLimit,
    maxLimit: Number.MAX_SAFE_INTEGER,
  });
}

export function queryLimitFor(window: OutputWindow): number {
  return window.limit + 1;
}

export function pageFromQuery<T>(items: T[], window: OutputWindow) {
  const page = items.slice(0, window.limit);
  const hasMore = items.length > window.limit;
  return {
    items: page,
    count: page.length,
    hasMore,
    nextCursor: hasMore ? window.offset + page.length : null,
  };
}

export interface CompactFooterOptions {
  shown: number;
  total?: number;
  hasMore?: boolean;
  nextCursor?: number | null;
  detailHint?: string;
  limitCapped?: boolean;
  /**
   * Which rows these are. Optional only so call sites that have not yet been
   * given a truthful descriptor stay honest by saying nothing rather than
   * guessing.
   */
  sort?: SortDescriptor;
}

/**
 * "Showing 3 of 1035. sort=name asc. More available: rerun with --cursor 3."
 *
 * The ordering clause is the whole point of this line. Before it existed the
 * footer disclosed HOW MANY rows a reader held and never WHICH, so an agent
 * reading `--limit 40` of a channel got its forty OLDEST messages and had no
 * reason to suspect it. The `sort=<field> <direction>` token is the shape
 * `knowledge list` already prints, copied rather than invented.
 */
export function formatCompactFooter(opts: CompactFooterOptions): string {
  const totalText = typeof opts.total === "number" ? ` of ${opts.total}` : "";
  const lines: string[] = [`Showing ${opts.shown}${totalText}.`];
  if (opts.sort) lines.push(`${formatSortDescriptor(opts.sort)}.`);
  if (opts.limitCapped) {
    lines.push(`Limit capped at ${MAX_COMPACT_LIMIT} rows for terminal output.`);
  }
  if (opts.hasMore && opts.nextCursor !== null && opts.nextCursor !== undefined) {
    lines.push(`More available: rerun with --cursor ${opts.nextCursor}.`);
  }
  if (opts.detailHint) lines.push(opts.detailHint);
  return lines.join(" ");
}

export function printCompactFooter(opts: CompactFooterOptions): void {
  printLine(chalk.dim(formatCompactFooter(opts)));
}

/**
 * The same disclosure, for `--json`, on stderr.
 *
 * stdout keeps its exact shape — a bare array — because every monitor on this
 * fleet parses it as one, and turning it into an object would hand those
 * readers `undefined` and a false "no messages", which is the very failure
 * being fixed. The disclosure therefore goes to stderr, where a human or agent
 * running the command sees it and a redirected `> file` does not.
 */
export function printJsonDisclosure(opts: CompactFooterOptions): void {
  const text = formatCompactFooter(opts);
  printErrorLine(chalk.dim(text));
}

/**
 * Apply `--limit` / `--cursor` to a fully-materialised listing on the `--json`
 * surface, and say what was applied.
 *
 * Measured 2026-07-31 at 0.5.13: `channel list --json --limit 3` returned all
 * 1035 channels — 1.2 MB — while the same verb in text mode returned 3. Every
 * listing verb shared the defect: the window was computed and then the
 * UNWINDOWED array was printed. An agent bounding a read for memory reasons got
 * the whole store, with no error and no truncation, and the payload then met
 * the standing "never pipe conversations --json" hazard at full size.
 *
 * The bound is applied ONLY when the caller actually asked for one. A default
 * limit here would newly truncate every existing unbounded `--json` reader —
 * introducing the silent truncation this change exists to remove, in the one
 * place it genuinely did not occur.
 */
export function windowJsonList<T>(items: T[], opts: { limit?: unknown; cursor?: unknown }) {
  const bounded = opts.limit !== undefined || opts.cursor !== undefined;
  const window = getJsonWindow({
    limit: opts.limit,
    cursor: opts.cursor,
    // Unbounded callers keep the complete set; `items.length || 1` because a
    // window's limit must be at least 1.
    defaultLimit: items.length || 1,
  });
  const page = windowItems(items, window);
  return { bounded, window, page, rows: bounded ? page.items : items };
}
