import { createHash } from "node:crypto";

export const PROJECTS_COLLECTION_CURSOR_SCHEMA = "projects.collection-cursor.v1" as const;
export const MAX_PROJECTS_COLLECTION_CURSOR_BYTES = 4 * 1024;

interface CollectionCursorPayload {
  schema: typeof PROJECTS_COLLECTION_CURSOR_SCHEMA;
  collection: string;
  filter_digest: string;
  snapshot_digest: string;
  total: number;
  position: number;
  after_id: string;
}

interface EncodedCollectionCursor {
  payload: CollectionCursorPayload;
  checksum: string;
}

export class CollectionCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionCursorError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return "null";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cursorChecksum(payload: CollectionCursorPayload): string {
  return sha256(canonicalJson(payload));
}

function encodeCursor(payload: CollectionCursorPayload): string {
  const encoded: EncodedCollectionCursor = { payload, checksum: cursorChecksum(payload) };
  return Buffer.from(canonicalJson(encoded), "utf8").toString("base64url");
}

function cursorFailure(reason: string): CollectionCursorError {
  return new CollectionCursorError(
    `Projects collection cursor is invalid or stale (${reason}). Restart the listing from the first page; raw offsets are not safe across collection changes.`,
  );
}

function decodeCursor(value: string): CollectionCursorPayload {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_PROJECTS_COLLECTION_CURSOR_BYTES) {
    throw cursorFailure("size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw cursorFailure("encoding");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw cursorFailure("shape");
  const encoded = parsed as Partial<EncodedCollectionCursor>;
  const payload = encoded.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw cursorFailure("payload");
  if (encoded.checksum !== cursorChecksum(payload as CollectionCursorPayload)) throw cursorFailure("checksum");
  if (
    payload.schema !== PROJECTS_COLLECTION_CURSOR_SCHEMA
    || typeof payload.collection !== "string" || payload.collection.length === 0
    || typeof payload.filter_digest !== "string" || !/^[a-f0-9]{64}$/.test(payload.filter_digest)
    || typeof payload.snapshot_digest !== "string" || !/^[a-f0-9]{64}$/.test(payload.snapshot_digest)
    || !Number.isSafeInteger(payload.total) || payload.total < 0
    || !Number.isSafeInteger(payload.position) || payload.position < 0
    || typeof payload.after_id !== "string" || payload.after_id.length === 0
  ) throw cursorFailure("fields");
  return payload as CollectionCursorPayload;
}

export interface StableCollectionPage<T> {
  items: T[];
  total: number;
  position: number;
  cursor: string | null;
  snapshot: string;
  has_more: boolean;
  complete: boolean;
  cursorForCount(count: number): string | null;
}

export function pageStableCollection<T>(
  source: readonly T[],
  options: {
    collection: string;
    filter: unknown;
    limit: number;
    cursor?: string;
    identity: (item: T) => string;
    compare?: (left: T, right: T) => number;
  },
): StableCollectionPage<T> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
    throw new CollectionCursorError("Collection page limit must be a positive safe integer.");
  }
  const rows = [...source];
  rows.sort(options.compare ?? ((left, right) => options.identity(left).localeCompare(options.identity(right))));
  const identities = rows.map(options.identity);
  if (identities.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new CollectionCursorError(`Collection ${options.collection} contains a row without an immutable identity.`);
  }
  if (new Set(identities).size !== identities.length) {
    throw new CollectionCursorError(`Collection ${options.collection} contains duplicate immutable identities.`);
  }

  const filterDigest = sha256(canonicalJson({ collection: options.collection, filter: options.filter }));
  const snapshotDigest = sha256(canonicalJson({ collection: options.collection, identities }));
  let start = 0;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded.collection !== options.collection) throw cursorFailure("collection");
    if (decoded.filter_digest !== filterDigest) throw cursorFailure("filter");
    if (decoded.total !== rows.length || decoded.snapshot_digest !== snapshotDigest) throw cursorFailure("collection changed");
    if (decoded.position >= identities.length || identities[decoded.position] !== decoded.after_id) throw cursorFailure("identity boundary");
    start = decoded.position + 1;
  }

  const items = rows.slice(start, start + options.limit);
  const hasMore = start + items.length < rows.length;
  return {
    items,
    total: rows.length,
    position: start,
    cursor: options.cursor ?? null,
    snapshot: snapshotDigest,
    has_more: hasMore,
    complete: start === 0 && !hasMore,
    cursorForCount(count: number): string | null {
      if (!Number.isSafeInteger(count) || count < 0 || count > items.length) {
        throw new CollectionCursorError(`Cannot advance ${options.collection} cursor by ${count} rows from a ${items.length}-row page.`);
      }
      const consumed = start + count;
      if (consumed >= rows.length) return null;
      if (count === 0) throw new CollectionCursorError(`Cannot advance ${options.collection} cursor without emitting a row.`);
      const position = consumed - 1;
      return encodeCursor({
        schema: PROJECTS_COLLECTION_CURSOR_SCHEMA,
        collection: options.collection,
        filter_digest: filterDigest,
        snapshot_digest: snapshotDigest,
        total: rows.length,
        position,
        after_id: identities[position]!,
      });
    },
  };
}
