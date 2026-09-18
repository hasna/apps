import { createHash } from "node:crypto";
import type { EventEnvelope } from "../types.js";

export const EVENT_LIST_CURSOR_PREFIX = "events-list-v1:";
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

const CURSOR_FINGERPRINT = /^[A-Za-z0-9_-]{43}$/;
const COMPACT_LIST_HINT = "Continue with --cursor when has_more is true; pass --full for exact, unbounded legacy event fields.";

interface EventListCursorPayload {
  snapshot_position: number;
  snapshot_fingerprint: string;
  before_position: number;
  before_fingerprint: string;
  filter_fingerprint: string;
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCursorFingerprint(value: unknown): value is string {
  return typeof value === "string" && CURSOR_FINGERPRINT.test(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

function eventFingerprint(event: EventEnvelope): string {
  return fingerprint([event.id, event.time, event.source, event.type, event.schemaVersion]);
}

function filterFingerprint(filters: { source?: string; type?: string }): string {
  return fingerprint([filters.source ?? null, filters.type ?? null]);
}

export function encodeEventListCursor(payload: EventListCursorPayload): string {
  if (
    !isNonNegativeInteger(payload.snapshot_position) ||
    !isCursorFingerprint(payload.snapshot_fingerprint) ||
    !isNonNegativeInteger(payload.before_position) ||
    payload.before_position > payload.snapshot_position ||
    !isCursorFingerprint(payload.before_fingerprint) ||
    !isCursorFingerprint(payload.filter_fingerprint)
  ) {
    throw new Error("Event list cursor positions and fingerprints are required");
  }
  return `${EVENT_LIST_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export function decodeEventListCursor(
  cursor: string,
  filters: { source?: string; type?: string },
): EventListCursorPayload {
  if (!cursor.startsWith(EVENT_LIST_CURSOR_PREFIX)) throw new Error("Invalid event list cursor");
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(cursor.slice(EVENT_LIST_CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid event list cursor");
  }
  const payload = candidate as Partial<EventListCursorPayload> | null;
  if (
    !payload ||
    !isNonNegativeInteger(payload.snapshot_position) ||
    !isCursorFingerprint(payload.snapshot_fingerprint) ||
    !isNonNegativeInteger(payload.before_position) ||
    payload.before_position > payload.snapshot_position ||
    !isCursorFingerprint(payload.before_fingerprint) ||
    !isCursorFingerprint(payload.filter_fingerprint)
  ) {
    throw new Error("Invalid event list cursor");
  }
  if (payload.filter_fingerprint !== filterFingerprint(filters)) {
    throw new Error("Event list cursor filter mismatch");
  }
  return {
    snapshot_position: payload.snapshot_position,
    snapshot_fingerprint: payload.snapshot_fingerprint,
    before_position: payload.before_position,
    before_fingerprint: payload.before_fingerprint,
    filter_fingerprint: payload.filter_fingerprint,
  };
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
    if (!snapshotEvent || eventFingerprint(snapshotEvent) !== cursor.snapshot_fingerprint) {
      throw new Error("Event list cursor snapshot is no longer available");
    }
    snapshotEvents = events.slice(0, cursor.snapshot_position + 1);
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
        snapshot_position: snapshotPosition,
        snapshot_fingerprint: eventFingerprint(snapshotEvents[snapshotPosition]!),
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
