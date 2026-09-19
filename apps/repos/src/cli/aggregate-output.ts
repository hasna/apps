import { createHash } from "node:crypto";

/**
 * Token-bounded machine output for secondary aggregate commands.
 *
 * Aggregate queries derive complete populations before presentation. Ordinary
 * JSON must not inject those populations into an agent context, and page two
 * must never silently continue against a different population. Cursors are
 * therefore opaque, command/filter/order-bound, and carry a fingerprint of the
 * complete compact snapshot. Any insert, delete, reorder, or projected-row
 * mutation between pages fails closed instead of duplicating or skipping rows.
 */

export const AGGREGATE_JSON_DEFAULT_LIMIT = 20;
export const AGGREGATE_JSON_MAX_BYTES = 32 * 1024;
export const AGGREGATE_CURSOR_VERSION = "repos-aggregate-v1";
const MAX_CURSOR_CHARS = 512;

export class AggregateCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregateCursorError";
  }
}

export interface AggregatePageOptions<T, U> {
  collection: string;
  command: string;
  filters: Record<string, unknown>;
  ordering: string;
  items: readonly T[];
  cursor?: string | null;
  limit: number;
  project: (item: T) => U;
  maxBytes?: number;
}

export type AggregatePage = {
  [collection: string]: unknown;
  count: number;
  total: number;
  limit: number;
  cursor: string | null;
  next_cursor: string | null;
  has_more: boolean;
  complete: boolean;
  compact: true;
  byte_limit: number;
  cursor_version: typeof AGGREGATE_CURSOR_VERSION;
  hint: string;
};

interface CursorPayload {
  v: 1;
  k: string;
  s: string;
  o: number;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

function serializedBytes(value: unknown): number {
  // CLI JSON output includes one trailing newline through printJsonLine().
  return Buffer.byteLength(`${JSON.stringify(value)}\n`, "utf8");
}

function encodeCursor(contextDigest: string, snapshotDigest: string, offset: number): string {
  const payload: CursorPayload = { v: 1, k: contextDigest, s: snapshotDigest, o: offset };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  token: string,
  contextDigest: string,
  snapshotDigest: string,
  total: number,
): number {
  if (token.length === 0 || token.length > MAX_CURSOR_CHARS || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new AggregateCursorError("invalid aggregate cursor encoding");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new AggregateCursorError("invalid aggregate cursor payload");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AggregateCursorError("invalid aggregate cursor payload");
  }
  const row = payload as Partial<CursorPayload>;
  if (
    row.v !== 1
    || typeof row.k !== "string"
    || typeof row.s !== "string"
    || !Number.isSafeInteger(row.o)
    || (row.o as number) < 0
  ) {
    throw new AggregateCursorError("invalid aggregate cursor payload");
  }
  if (row.k !== contextDigest) {
    throw new AggregateCursorError("aggregate cursor does not match this command, filters, or ordering");
  }
  if (row.s !== snapshotDigest) {
    throw new AggregateCursorError("aggregate cursor snapshot no longer matches; restart from the first page");
  }
  if ((row.o as number) > total) {
    throw new AggregateCursorError("aggregate cursor offset is outside the current snapshot");
  }
  return row.o as number;
}

function envelope<U>(
  collection: string,
  rows: readonly U[],
  total: number,
  inputCursor: string | null,
  offset: number,
  limit: number,
  maxBytes: number,
  contextDigest: string,
  snapshotDigest: string,
): AggregatePage {
  const nextOffset = offset + rows.length;
  const hasMore = nextOffset < total;
  return {
    [collection]: rows,
    count: rows.length,
    total,
    limit,
    cursor: inputCursor,
    next_cursor: hasMore ? encodeCursor(contextDigest, snapshotDigest, nextOffset) : null,
    has_more: hasMore,
    complete: !hasMore,
    compact: true,
    byte_limit: maxBytes,
    cursor_version: AGGREGATE_CURSOR_VERSION,
    hint: hasMore
      ? "Continue with --cursor <next_cursor>; use --full or --all for exhaustive legacy JSON."
      : "Use --full or --all for exhaustive legacy JSON.",
  } as AggregatePage;
}

/**
 * Build one minified aggregate page whose serialized stdout is never larger
 * than maxBytes. `items` must already be in the command's documented stable
 * ordering. Rows are consumed only after the complete envelope fits, so the
 * opaque next cursor always names the first row not returned.
 */
export function buildAggregatePage<T, U>(options: AggregatePageOptions<T, U>): AggregatePage {
  const { collection, command, filters, ordering, items, project } = options;
  const limit = Math.max(1, Math.trunc(options.limit));
  const maxBytes = Math.max(512, Math.trunc(options.maxBytes ?? AGGREGATE_JSON_MAX_BYTES));
  const projected = items.map(project);
  const contextDigest = digest({ command, filters, ordering });
  const snapshotDigest = digest(projected);
  const inputCursor = options.cursor ?? null;
  const start = inputCursor
    ? decodeCursor(inputCursor, contextDigest, snapshotDigest, projected.length)
    : 0;
  const candidates = projected.slice(start, start + limit);
  const rows: U[] = [];

  for (const row of candidates) {
    const candidateRows = [...rows, row];
    const candidate = envelope(
      collection,
      candidateRows,
      projected.length,
      inputCursor,
      start,
      limit,
      maxBytes,
      contextDigest,
      snapshotDigest,
    );
    if (serializedBytes(candidate) > maxBytes) break;
    rows.push(row);
  }

  if (candidates.length > 0 && rows.length === 0) {
    throw new Error(
      `compact ${collection} projection cannot fit one row within ${maxBytes} UTF-8 bytes`,
    );
  }

  const page = envelope(
    collection,
    rows,
    projected.length,
    inputCursor,
    start,
    limit,
    maxBytes,
    contextDigest,
    snapshotDigest,
  );
  if (serializedBytes(page) > maxBytes) {
    throw new Error(`compact ${collection} envelope exceeds ${maxBytes} UTF-8 bytes`);
  }
  return page;
}

export function aggregatePageBytes(value: unknown): number {
  return serializedBytes(value);
}
