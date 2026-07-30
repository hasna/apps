import chalk from "chalk";
import {
  DEFAULT_COMPACT_LIMIT,
  MAX_COMPACT_LIMIT,
  resolveOutputWindow,
  type OutputWindow,
} from "../lib/compact-output.js";
import { printLine } from "../lib/stdout.js";

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

export function printCompactFooter(opts: {
  shown: number;
  total?: number;
  hasMore?: boolean;
  nextCursor?: number | null;
  detailHint?: string;
  limitCapped?: boolean;
}): void {
  const totalText = typeof opts.total === "number" ? ` of ${opts.total}` : "";
  const lines: string[] = [`Showing ${opts.shown}${totalText}.`];
  if (opts.limitCapped) {
    lines.push(`Limit capped at ${MAX_COMPACT_LIMIT} rows for terminal output.`);
  }
  if (opts.hasMore && opts.nextCursor !== null && opts.nextCursor !== undefined) {
    lines.push(`More available: rerun with --cursor ${opts.nextCursor}.`);
  }
  if (opts.detailHint) lines.push(opts.detailHint);
  printLine(chalk.dim(lines.join(" ")));
}
