import type { EventEnvelope } from "../types.js";

export const EVENT_LIST_CURSOR_PREFIX = "events-list-v1:";

interface EventListCursorPayload {
  snapshot_id: string;
  before_id: string;
  source?: string;
  type?: string;
}

function sameFilter(left: string | undefined, right: string | undefined): boolean {
  return (left ?? undefined) === (right ?? undefined);
}

export function encodeEventListCursor(payload: EventListCursorPayload): string {
  if (!payload.snapshot_id || !payload.before_id) throw new Error("Event list cursor identities are required");
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
  if (!payload || typeof payload.snapshot_id !== "string" || !payload.snapshot_id || typeof payload.before_id !== "string" || !payload.before_id) {
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
  let snapshotId = events.at(-1)?.id ?? null;

  if (options.cursor) {
    const cursor = decodeEventListCursor(options.cursor, options);
    const snapshotIndex = events.findIndex((event) => event.id === cursor.snapshot_id);
    if (snapshotIndex < 0) throw new Error("Event list cursor snapshot is no longer available");
    snapshotEvents = events.slice(0, snapshotIndex + 1);
    snapshotId = cursor.snapshot_id;
    end = snapshotEvents.findIndex((event) => event.id === cursor.before_id);
    if (end < 0) throw new Error("Event list cursor boundary is no longer available");
  }

  const start = Math.max(0, end - limit);
  const pageEvents = snapshotEvents.slice(start, end);
  const hasMore = start > 0;
  const nextCursor = hasMore && snapshotId && pageEvents[0]
    ? encodeEventListCursor({
        snapshot_id: snapshotId,
        before_id: pageEvents[0].id,
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
