/**
 * Snapshot-bound compact pagination for MCP collection tools.
 *
 * The continuation is deliberately opaque and canonical. It binds the exact
 * collection, filter set, order contract, prior identity boundary, and complete
 * projected snapshot. Any mutation between pages is refused instead of being
 * rendered as an overlapping, skipped, or internally inconsistent page.
 */
import { createHash } from "node:crypto";

export const DEFAULT_MCP_COLLECTION_LIMIT = 20;
export const MAX_MCP_COLLECTION_LIMIT = 500;
export const MAX_MCP_COLLECTION_BYTES = 32 * 1024;
export const MAX_MCP_EXHAUSTIVE_ROWS = 10_000;
export const MAX_MCP_EXHAUSTIVE_BYTES = 1024 * 1024;
export const MCP_COLLECTION_CURSOR_CONTRACT = "todos.mcp.collection.cursor.v1";

const CURSOR_HASH_LENGTH = 43; // complete SHA-256 in unpadded base64url
const CURSOR_OFFSET_LENGTH = 16; // zero-padded hexadecimal safe integer
const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;
const CURSOR_HASH = /^[A-Za-z0-9_-]{43}$/;
const CURSOR_OFFSET = /^[0-9a-f]{16}$/;
const CURSOR_KEYS = ["b", "c", "o", "p", "q", "s", "v"] as const;

interface CanonicalCollectionCursorPayload {
  /** SHA-256 of the stable identity immediately before p. */
  b: string;
  /** SHA-256 of the collection name. */
  c: string;
  /** SHA-256 of the declared stable-order contract. */
  o: string;
  /** Next offset, fixed-width lowercase hexadecimal. */
  p: string;
  /** SHA-256 of the canonical filter object. */
  q: string;
  /** SHA-256 of the complete ordered collection snapshot. */
  s: string;
  v: 1;
}

export interface CollectionCursorContext {
  collection: string;
  query: Record<string, unknown>;
  order: string;
}

export interface DecodedCollectionCursor {
  offset: number;
  boundaryFingerprint: string;
  snapshotFingerprint: string;
}

export interface CollectionPageInput<T, U> extends CollectionCursorContext {
  key: string;
  rows: readonly T[];
  project: (row: T) => U;
  identity: (row: T) => string;
  orderKey: (row: T) => string;
  snapshotValue?: (row: T) => unknown;
  limit?: number;
  offset?: number;
  cursor?: string;
  maxBytes?: number;
}

export interface CollectionPageEnvelope {
  [key: string]: unknown;
  cursor_contract: typeof MCP_COLLECTION_CURSOR_CONTRACT;
  count: number;
  total: number;
  requested_limit: number;
  limit: number;
  offset: number;
  consumed: number;
  has_more: boolean;
  next_offset: number | null;
  next_cursor: string | null;
  complete: boolean;
  max_bytes: number;
  truncated_by_bytes: boolean;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function truncateUtf8(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 4) {
    throw new Error("maximumBytes must be an integer of at least 4");
  }
  if (utf8Bytes(value) <= maximumBytes) return value;
  const suffix = "...";
  const target = maximumBytes - utf8Bytes(suffix);
  let output = "";
  for (const character of value) {
    if (utf8Bytes(output + character) > target) break;
    output += character;
  }
  return `${output}${suffix}`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Collection snapshots cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }
  throw new Error("Collection snapshots must contain JSON-compatible values");
}

export function canonicalCollectionJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalCollectionJson(value)).digest("base64url");
}

function collectionHash(value: string): string {
  if (!value || utf8Bytes(value) > 256) throw new Error("collection must be a bounded non-empty string");
  return fingerprint(value);
}

function fixedOffset(offset: number): string {
  if (!Number.isSafeInteger(offset) || offset < 1) {
    throw new Error("collection cursor offset must be a positive safe integer");
  }
  return offset.toString(16).padStart(CURSOR_OFFSET_LENGTH, "0");
}

function cursorPayload(
  context: CollectionCursorContext,
  offset: number,
  boundaryIdentity: string,
  snapshotFingerprint: string,
): CanonicalCollectionCursorPayload {
  if (!boundaryIdentity || utf8Bytes(boundaryIdentity) > 1024) {
    throw new Error("collection cursor boundary identity must be a bounded non-empty string");
  }
  if (!CURSOR_HASH.test(snapshotFingerprint)) throw new Error("invalid collection snapshot fingerprint");
  return {
    b: fingerprint(boundaryIdentity),
    c: collectionHash(context.collection),
    o: fingerprint(context.order),
    p: fixedOffset(offset),
    q: fingerprint(context.query),
    s: snapshotFingerprint,
    v: 1,
  };
}

function encodePayload(payload: CanonicalCollectionCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function encodeCollectionCursor(
  context: CollectionCursorContext,
  offset: number,
  boundaryIdentity: string,
  snapshotFingerprint: string,
): string {
  return encodePayload(cursorPayload(context, offset, boundaryIdentity, snapshotFingerprint));
}

const CURSOR_LENGTH_TEMPLATE = encodePayload({
  b: "A".repeat(CURSOR_HASH_LENGTH),
  c: "A".repeat(CURSOR_HASH_LENGTH),
  o: "A".repeat(CURSOR_HASH_LENGTH),
  p: "0".repeat(CURSOR_OFFSET_LENGTH),
  q: "A".repeat(CURSOR_HASH_LENGTH),
  s: "A".repeat(CURSOR_HASH_LENGTH),
  v: 1,
});

/** Every valid Todos MCP collection cursor has exactly this many ASCII bytes. */
export const MCP_COLLECTION_CURSOR_LENGTH = CURSOR_LENGTH_TEMPLATE.length;

export function decodeCollectionCursor(
  cursor: string,
  context: CollectionCursorContext,
): DecodedCollectionCursor {
  if (
    typeof cursor !== "string"
    || cursor.length !== MCP_COLLECTION_CURSOR_LENGTH
    || utf8Bytes(cursor) !== MCP_COLLECTION_CURSOR_LENGTH
    || !CURSOR_ALPHABET.test(cursor)
  ) {
    throw new Error("INVALID_COLLECTION_CURSOR: cursor length or alphabet is not canonical");
  }

  let decoded: Buffer;
  let value: unknown;
  try {
    decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw new Error("noncanonical encoding");
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error("INVALID_COLLECTION_CURSOR: cursor encoding is not canonical");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_COLLECTION_CURSOR: cursor payload must be an object");
  }

  const payload = value as Partial<CanonicalCollectionCursorPayload> & Record<string, unknown>;
  if (
    Object.keys(payload).join(",") !== CURSOR_KEYS.join(",")
    || payload.v !== 1
    || typeof payload.b !== "string" || !CURSOR_HASH.test(payload.b)
    || typeof payload.c !== "string" || !CURSOR_HASH.test(payload.c)
    || typeof payload.o !== "string" || !CURSOR_HASH.test(payload.o)
    || typeof payload.p !== "string" || !CURSOR_OFFSET.test(payload.p)
    || typeof payload.q !== "string" || !CURSOR_HASH.test(payload.q)
    || typeof payload.s !== "string" || !CURSOR_HASH.test(payload.s)
  ) {
    throw new Error("INVALID_COLLECTION_CURSOR: cursor keys or field shapes are not canonical");
  }
  if (encodePayload(payload as CanonicalCollectionCursorPayload) !== cursor) {
    throw new Error("INVALID_COLLECTION_CURSOR: cursor JSON is not canonical");
  }
  if (
    payload.c !== collectionHash(context.collection)
    || payload.q !== fingerprint(context.query)
    || payload.o !== fingerprint(context.order)
  ) {
    throw new Error("COLLECTION_CURSOR_MISMATCH: cursor does not match this collection, filter, or order");
  }

  const offsetBigInt = BigInt(`0x${payload.p}`);
  if (offsetBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("INVALID_COLLECTION_CURSOR: cursor offset is outside the safe integer range");
  }
  const offset = Number(offsetBigInt);
  if (offset < 1) throw new Error("INVALID_COLLECTION_CURSOR: cursor offset must be positive");
  return {
    offset,
    boundaryFingerprint: payload.b,
    snapshotFingerprint: payload.s,
  };
}

function validateLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MCP_COLLECTION_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MCP_COLLECTION_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_MCP_COLLECTION_LIMIT}`);
  }
  return limit;
}

function validateOffset(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
  return offset;
}

function bytewiseCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildCollectionPage<T, U>(input: CollectionPageInput<T, U>): CollectionPageEnvelope {
  if (input.cursor !== undefined && input.offset !== undefined) {
    throw new Error("Pass cursor or offset, not both");
  }
  const requestedLimit = validateLimit(input.limit);
  const maxBytes = input.maxBytes ?? MAX_MCP_COLLECTION_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_MCP_COLLECTION_BYTES) {
    throw new Error(`max_bytes must be an integer from 1024 to ${MAX_MCP_COLLECTION_BYTES}`);
  }

  const ordered = input.rows.map((row) => {
    const identity = input.identity(row);
    const orderKey = input.orderKey(row);
    if (!identity || utf8Bytes(identity) > 1024) throw new Error("collection row identity must be bounded and non-empty");
    if (typeof orderKey !== "string" || utf8Bytes(orderKey) > 2048) throw new Error("collection row order key must be bounded");
    return { row, identity, orderKey, item: input.project(row) };
  }).sort((left, right) => bytewiseCompare(left.orderKey, right.orderKey) || bytewiseCompare(left.identity, right.identity));

  const identities = new Set<string>();
  for (const entry of ordered) {
    if (identities.has(entry.identity)) throw new Error(`DUPLICATE_COLLECTION_IDENTITY: ${input.collection} contains a repeated stable identity`);
    identities.add(entry.identity);
  }

  const snapshotFingerprint = fingerprint(ordered.map((entry) => ({
    identity: entry.identity,
    order_key: entry.orderKey,
    value: input.snapshotValue ? input.snapshotValue(entry.row) : entry.row,
  })));
  const context: CollectionCursorContext = { collection: input.collection, query: input.query, order: input.order };
  let offset = validateOffset(input.offset);
  if (input.cursor !== undefined) {
    const decoded = decodeCollectionCursor(input.cursor, context);
    offset = decoded.offset;
    if (decoded.snapshotFingerprint !== snapshotFingerprint) {
      throw new Error("COLLECTION_MUTATED: collection changed after the cursor was issued; restart from the first page");
    }
    const boundary = ordered[offset - 1];
    if (!boundary || fingerprint(boundary.identity) !== decoded.boundaryFingerprint) {
      throw new Error("COLLECTION_MUTATED: stable identity boundary changed after the cursor was issued; restart from the first page");
    }
  }

  const total = ordered.length;
  const available = ordered.slice(offset, offset + requestedLimit);
  let selected = available;

  const envelope = (): CollectionPageEnvelope => {
    const count = selected.length;
    const nextOffset = offset + count < total ? offset + count : null;
    const boundary = nextOffset === null ? null : ordered[nextOffset - 1];
    return {
      [input.key]: selected.map((entry) => entry.item),
      cursor_contract: MCP_COLLECTION_CURSOR_CONTRACT,
      count,
      total,
      requested_limit: requestedLimit,
      limit: requestedLimit,
      offset,
      consumed: count,
      has_more: nextOffset !== null,
      next_offset: nextOffset,
      next_cursor: nextOffset === null || !boundary
        ? null
        : encodeCollectionCursor(context, nextOffset, boundary.identity, snapshotFingerprint),
      complete: nextOffset === null,
      max_bytes: maxBytes,
      truncated_by_bytes: count < available.length,
    };
  };

  let result = envelope();
  while (utf8Bytes(JSON.stringify(result)) > maxBytes && selected.length > 0) {
    selected = selected.slice(0, -1);
    result = envelope();
  }
  if (utf8Bytes(JSON.stringify(result)) > maxBytes) {
    throw new Error(`${input.collection} page metadata exceeds the ${maxBytes}-byte response ceiling`);
  }
  if (available.length > 0 && selected.length === 0) {
    throw new Error(`${input.collection} row cannot fit inside the ${maxBytes}-byte response ceiling`);
  }
  return result;
}

export function legacyCollectionText(kind: string, rowCount: number, text: string): string {
  if (rowCount > MAX_MCP_EXHAUSTIVE_ROWS) {
    throw new Error(
      `${kind} exhaustive output has ${rowCount} rows, above the ${MAX_MCP_EXHAUSTIVE_ROWS}-row safety maximum; use pagination`,
    );
  }
  const bytes = utf8Bytes(text);
  if (bytes > MAX_MCP_EXHAUSTIVE_BYTES) {
    throw new Error(
      `${kind} exhaustive output is ${bytes} bytes, above the ${MAX_MCP_EXHAUSTIVE_BYTES}-byte safety maximum; use pagination`,
    );
  }
  return text;
}
