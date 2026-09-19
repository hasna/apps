import { createHash } from "node:crypto";
import { canonicalJson } from "../intake/protocol.js";
import type { EventEnvelope } from "../types.js";

export const EVENT_LIST_CURSOR_VERSION = 2 as const;
export const EVENT_LIST_CURSOR_PREFIX = "events-list-v2:";
export const EVENT_LIST_CURSOR_MAX_CHARS = 1024;
export const DEFAULT_COMPACT_EVENT_LIST_MAX_BYTES = 32 * 1024;
export const COMPACT_EVENT_FIELD_MAX_BYTES = Object.freeze({
  id: 256,
  time: 64,
  source: 128,
  type: 128,
  severity: 32,
  subject: 256,
  message: 160,
  schemaVersion: 32,
});

const EVENT_LIST_CURSOR_MAX_PAYLOAD_BYTES = 768;
const CURSOR_FINGERPRINT = /^[A-Za-z0-9_-]{43}$/;
const CANONICAL_BASE64URL = /^[A-Za-z0-9_-]+$/;
const COMPACT_LIST_HINT = "Continue with --cursor when has_more is true; pass --full for exact, unbounded legacy event fields.";
const CURSOR_STATE_KEYS = [
  "before_fingerprint",
  "before_position",
  "filter_fingerprint",
  "snapshot_fingerprint",
  "snapshot_position",
  "version",
] as const;
const CURSOR_PAYLOAD_KEYS = [...CURSOR_STATE_KEYS, "integrity"].sort();

export interface EventListCursorState {
  version: typeof EVENT_LIST_CURSOR_VERSION;
  snapshot_position: number;
  snapshot_fingerprint: string;
  before_position: number;
  before_fingerprint: string;
  filter_fingerprint: string;
}

interface EventListCursorPayload extends EventListCursorState {
  integrity: string;
}

interface CompactEvent {
  id: string;
  time: string;
  source: string;
  type: string;
  severity: string;
  subject: string | null;
  message: string | null;
  schemaVersion: string;
}

export interface CompactEventListOutput {
  events: CompactEvent[];
  count: number;
  total: number;
  limit: number;
  cursor: string | null;
  snapshot_id: string | null;
  next_cursor: string | null;
  has_more: boolean;
  compact: true;
  truncated: boolean;
  fields_truncated: boolean;
  byte_limited: boolean;
  max_bytes: number;
  hint: string;
}

function invalidCursor(): Error {
  return new Error("Invalid event list cursor");
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCursorFingerprint(value: unknown): value is string {
  return typeof value === "string" && CURSOR_FINGERPRINT.test(value);
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("base64url");
}

/** Every canonical event field, including nested data/metadata and optional fields. */
function eventFingerprint(event: EventEnvelope): string {
  return fingerprint(["hasna.events.list-event.v2", event]);
}

/** Bind the cursor to the complete ordered snapshot while allowing later appends. */
function eventSnapshotFingerprint(events: EventEnvelope[]): string {
  const hash = createHash("sha256");
  hash.update("hasna.events.list-snapshot.v2\0", "utf8");
  hash.update(String(events.length), "utf8");
  hash.update("\0", "utf8");
  for (const event of events) {
    hash.update(eventFingerprint(event), "ascii");
    hash.update("\0", "utf8");
  }
  return hash.digest("base64url");
}

function filterFingerprint(filters: { source?: string; type?: string }): string {
  return fingerprint(["hasna.events.list-filter.v2", filters.source ?? null, filters.type ?? null]);
}

function cursorIntegrity(state: EventListCursorState): string {
  return fingerprint(["hasna.events.list-cursor-integrity.v2", state]);
}

function validateCursorState(value: unknown): value is EventListCursorState {
  if (!hasExactKeys(value, CURSOR_STATE_KEYS)) return false;
  return value.version === EVENT_LIST_CURSOR_VERSION
    && isNonNegativeSafeInteger(value.snapshot_position)
    && isCursorFingerprint(value.snapshot_fingerprint)
    && isNonNegativeSafeInteger(value.before_position)
    && value.before_position <= value.snapshot_position
    && isCursorFingerprint(value.before_fingerprint)
    && isCursorFingerprint(value.filter_fingerprint);
}

export function encodeEventListCursor(state: EventListCursorState): string {
  if (!validateCursorState(state)) throw new Error("Event list cursor positions, version, and fingerprints are required");
  const payload: EventListCursorPayload = { ...state, integrity: cursorIntegrity(state) };
  const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  const cursor = `${EVENT_LIST_CURSOR_PREFIX}${encoded}`;
  if (cursor.length > EVENT_LIST_CURSOR_MAX_CHARS) throw new Error("Event list cursor exceeds its maximum encoded length");
  return cursor;
}

export function decodeEventListCursor(
  cursor: string,
  filters: { source?: string; type?: string },
): EventListCursorState {
  if (
    typeof cursor !== "string"
    || cursor.length <= EVENT_LIST_CURSOR_PREFIX.length
    || cursor.length > EVENT_LIST_CURSOR_MAX_CHARS
    || !cursor.startsWith(EVENT_LIST_CURSOR_PREFIX)
  ) throw invalidCursor();

  const encoded = cursor.slice(EVENT_LIST_CURSOR_PREFIX.length);
  if (!CANONICAL_BASE64URL.test(encoded)) throw invalidCursor();

  let bytes: Buffer;
  let text: string;
  let candidate: unknown;
  try {
    bytes = Buffer.from(encoded, "base64url");
    if (
      bytes.length === 0
      || bytes.length > EVENT_LIST_CURSOR_MAX_PAYLOAD_BYTES
      || bytes.toString("base64url") !== encoded
    ) throw invalidCursor();
    text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw invalidCursor();
    candidate = JSON.parse(text);
    if (canonicalJson(candidate) !== text) throw invalidCursor();
  } catch {
    throw invalidCursor();
  }

  if (!hasExactKeys(candidate, CURSOR_PAYLOAD_KEYS)) throw invalidCursor();
  const state: EventListCursorState = {
    version: candidate.version as typeof EVENT_LIST_CURSOR_VERSION,
    snapshot_position: candidate.snapshot_position as number,
    snapshot_fingerprint: candidate.snapshot_fingerprint as string,
    before_position: candidate.before_position as number,
    before_fingerprint: candidate.before_fingerprint as string,
    filter_fingerprint: candidate.filter_fingerprint as string,
  };
  if (!validateCursorState(state) || !isCursorFingerprint(candidate.integrity)) throw invalidCursor();
  if (candidate.integrity !== cursorIntegrity(state)) throw invalidCursor();
  if (state.filter_fingerprint !== filterFingerprint(filters)) {
    throw new Error("Event list cursor filter mismatch");
  }
  return state;
}

export function applyFullEventLimit<T>(events: T[], rawLimit: number | undefined): T[] {
  if (rawLimit === undefined || rawLimit <= 0) return events;
  if (!Number.isInteger(rawLimit)) throw new Error(`Event full-list limit must be an integer, got ${rawLimit}`);
  return events.slice(-rawLimit);
}

export function eventListSnapshotPage(
  events: EventEnvelope[],
  options: { limit: number; cursor?: string; source?: string; type?: string },
) {
  const limit = Math.max(1, Math.floor(options.limit));
  let snapshotEvents = events;
  let end = events.length;
  let snapshotPosition = events.length - 1;
  let snapshotId = events.at(snapshotPosition)?.id ?? null;
  let currentCursor: string | null = null;

  if (options.cursor) {
    const cursor = decodeEventListCursor(options.cursor, options);
    currentCursor = encodeEventListCursor(cursor);
    const snapshotEvent = events.at(cursor.snapshot_position);
    if (!snapshotEvent) throw new Error("Event list cursor snapshot is no longer available");
    snapshotEvents = events.slice(0, cursor.snapshot_position + 1);
    if (eventSnapshotFingerprint(snapshotEvents) !== cursor.snapshot_fingerprint) {
      throw new Error("Event list cursor snapshot is no longer available");
    }
    snapshotPosition = cursor.snapshot_position;
    snapshotId = snapshotEvent.id;
    const boundaryEvent = snapshotEvents.at(cursor.before_position);
    if (!boundaryEvent || eventFingerprint(boundaryEvent) !== cursor.before_fingerprint) {
      throw new Error("Event list cursor boundary is no longer available");
    }
    end = cursor.before_position;
  }

  const start = Math.max(0, end - limit);
  const pageEvents = snapshotEvents.slice(start, end);
  const hasMore = start > 0;
  const nextCursor = hasMore && snapshotPosition >= 0 && pageEvents[0]
    ? encodeEventListCursor({
        version: EVENT_LIST_CURSOR_VERSION,
        snapshot_position: snapshotPosition,
        snapshot_fingerprint: eventSnapshotFingerprint(snapshotEvents),
        before_position: start,
        before_fingerprint: eventFingerprint(pageEvents[0]),
        filter_fingerprint: filterFingerprint(options),
      })
    : null;

  return {
    events: pageEvents,
    count: pageEvents.length,
    total: snapshotEvents.length,
    cursor: currentCursor,
    snapshot_id: snapshotId,
    next_cursor: nextCursor,
    has_more: hasMore,
  };
}

function truncateUtf8(value: string, maxBytes: number, normalizeWhitespace = false): { value: string; truncated: boolean } {
  const normalized = normalizeWhitespace ? value.replace(/\s+/g, " ").trim() : value;
  if (Buffer.byteLength(normalized, "utf8") <= maxBytes) {
    return { value: normalized, truncated: normalized !== value };
  }
  const suffix = "…";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let bytes = 0;
  let output = "";
  for (const character of normalized) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > budget) break;
    output += character;
    bytes += characterBytes;
  }
  return { value: `${output}${suffix}`, truncated: true };
}

function compactEvent(event: EventEnvelope): { event: CompactEvent; truncated: boolean } {
  const id = truncateUtf8(event.id, COMPACT_EVENT_FIELD_MAX_BYTES.id);
  const time = truncateUtf8(event.time, COMPACT_EVENT_FIELD_MAX_BYTES.time);
  const source = truncateUtf8(event.source, COMPACT_EVENT_FIELD_MAX_BYTES.source);
  const type = truncateUtf8(event.type, COMPACT_EVENT_FIELD_MAX_BYTES.type);
  const severity = truncateUtf8(event.severity, COMPACT_EVENT_FIELD_MAX_BYTES.severity);
  const subject = event.subject === undefined
    ? { value: null, truncated: false }
    : truncateUtf8(event.subject, COMPACT_EVENT_FIELD_MAX_BYTES.subject);
  const message = event.message === undefined
    ? { value: null, truncated: false }
    : truncateUtf8(event.message, COMPACT_EVENT_FIELD_MAX_BYTES.message, true);
  const schemaVersion = truncateUtf8(event.schemaVersion, COMPACT_EVENT_FIELD_MAX_BYTES.schemaVersion);
  return {
    event: {
      id: id.value,
      time: time.value,
      source: source.value,
      type: type.value,
      severity: severity.value,
      subject: subject.value,
      message: message.value,
      schemaVersion: schemaVersion.value,
    },
    truncated: [id, time, source, type, severity, subject, message, schemaVersion].some((field) => field.truncated),
  };
}

function serializedCompactBytes(value: CompactEventListOutput): number {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compactCandidate(
  events: EventEnvelope[],
  options: { limit: number; cursor?: string; source?: string; type?: string; maxBytes: number },
  effectiveLimit: number,
  byteLimited: boolean,
): CompactEventListOutput {
  const page = eventListSnapshotPage(events, { ...options, limit: effectiveLimit });
  const compacted = page.events.map(compactEvent);
  const snapshot = page.snapshot_id === null
    ? { value: null, truncated: false }
    : truncateUtf8(page.snapshot_id, COMPACT_EVENT_FIELD_MAX_BYTES.id);
  const fieldsTruncated = snapshot.truncated || compacted.some((entry) => entry.truncated);
  return {
    events: compacted.map((entry) => entry.event),
    count: compacted.length,
    total: page.total,
    limit: options.limit,
    cursor: page.cursor,
    snapshot_id: snapshot.value,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    compact: true,
    truncated: fieldsTruncated || byteLimited,
    fields_truncated: fieldsTruncated,
    byte_limited: byteLimited,
    max_bytes: options.maxBytes,
    hint: COMPACT_LIST_HINT,
  };
}

export function compactEventListOutput(
  events: EventEnvelope[],
  options: { limit: number; cursor?: string; source?: string; type?: string; maxBytes?: number },
): CompactEventListOutput {
  const limit = Math.max(1, Math.floor(options.limit));
  const maxBytes = options.maxBytes ?? DEFAULT_COMPACT_EVENT_LIST_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new Error("Compact event list maxBytes must be an integer of at least 1024 bytes");
  }
  const normalized = { ...options, limit, maxBytes };
  const full = compactCandidate(events, normalized, limit, false);
  if (serializedCompactBytes(full) <= maxBytes) return full;
  if (full.count <= 1) throw new Error(`Compact event list cannot fit within ${maxBytes} bytes`);

  let low = 1;
  let high = full.count - 1;
  let best: CompactEventListOutput | null = null;
  while (low <= high) {
    const candidateLimit = Math.floor((low + high) / 2);
    const candidate = compactCandidate(events, normalized, candidateLimit, true);
    if (serializedCompactBytes(candidate) <= maxBytes) {
      best = candidate;
      low = candidateLimit + 1;
    } else {
      high = candidateLimit - 1;
    }
  }
  if (!best) throw new Error(`Compact event list cannot fit within ${maxBytes} bytes`);
  return best;
}
