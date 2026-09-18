import type { EventEnvelope } from "../types.js";

export const EVENT_LIST_CURSOR_PREFIX = "events-list-v1:";

interface EventListCursorPayload {
  snapshot_id: string;
  snapshot_position: number;
  before_id: string;
  before_position: number;
  source?: string;
  type?: string;
}

function sameFilter(left: string | undefined, right: string | undefined): boolean {
  return (left ?? undefined) === (right ?? undefined);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function encodeEventListCursor(payload: EventListCursorPayload): string {
  if (
    !payload.snapshot_id ||
    !isNonNegativeInteger(payload.snapshot_position) ||
    !payload.before_id ||
    !isNonNegativeInteger(payload.before_position) ||
    payload.before_position > payload.snapshot_position
  ) {
    throw new Error("Event list cursor identities and positions are required");
  }
  return `${EVENT_LIST_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export function decodeEventListCursor(
  cursor: string,
  filters: { source?: string; type?: string },
): EventListCursorPayload {
  if (!cursor.startsWith(EVENT_LIST_CURSOR_PREFIX)) throw new Error(`Invalid event list cursor: ${cursor}`);
  let payload: EventListCursorPayload;
  try {
    payload = JSON.parse(Buffer.from(cursor.slice(EVENT_LIST_CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error(`Invalid event list cursor: ${cursor}`);
  }
  if (
    !payload ||
    typeof payload.snapshot_id !== "string" ||
    !payload.snapshot_id ||
    !isNonNegativeInteger(payload.snapshot_position) ||
    typeof payload.before_id !== "string" ||
    !payload.before_id ||
    !isNonNegativeInteger(payload.before_position) ||
    payload.before_position > payload.snapshot_position
  ) {
    throw new Error(`Invalid event list cursor: ${cursor}`);
  }
  if (!sameFilter(payload.source, filters.source) || !sameFilter(payload.type, filters.type)) {
    throw new Error("Event list cursor filter mismatch");
  }
  return payload;
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

  if (options.cursor) {
    const cursor = decodeEventListCursor(options.cursor, options);
    const snapshotEvent = events.at(cursor.snapshot_position);
    if (!snapshotEvent || snapshotEvent.id !== cursor.snapshot_id) {
      throw new Error("Event list cursor snapshot is no longer available");
    }
    snapshotEvents = events.slice(0, cursor.snapshot_position + 1);
    snapshotPosition = cursor.snapshot_position;
    snapshotId = cursor.snapshot_id;
    const boundaryEvent = snapshotEvents.at(cursor.before_position);
    if (!boundaryEvent || boundaryEvent.id !== cursor.before_id) {
      throw new Error("Event list cursor boundary is no longer available");
    }
    end = cursor.before_position;
  }

  const start = Math.max(0, end - limit);
  const pageEvents = snapshotEvents.slice(start, end);
  const hasMore = start > 0;
  const nextCursor = hasMore && snapshotId && pageEvents[0]
    ? encodeEventListCursor({
        snapshot_id: snapshotId,
        snapshot_position: snapshotPosition,
        before_id: pageEvents[0].id,
        before_position: start,
        ...(options.source ? { source: options.source } : {}),
        ...(options.type ? { type: options.type } : {}),
      })
    : null;

  return {
    events: pageEvents,
    count: pageEvents.length,
    total: snapshotEvents.length,
    snapshot_id: snapshotId,
    next_cursor: nextCursor,
    has_more: hasMore,
  };
}
