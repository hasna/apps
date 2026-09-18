import type { EventEnvelope } from "../types.js";
export declare const EVENT_LIST_CURSOR_PREFIX = "events-list-v1:";
interface EventListCursorPayload {
    snapshot_id: string;
    before_id: string;
    source?: string;
    type?: string;
}
export declare function encodeEventListCursor(payload: EventListCursorPayload): string;
export declare function decodeEventListCursor(cursor: string, filters: {
    source?: string;
    type?: string;
}): EventListCursorPayload;
export declare function applyFullEventLimit<T>(events: T[], rawLimit: number | undefined): T[];
export declare function eventListSnapshotPage(events: EventEnvelope[], options: {
    limit: number;
    cursor?: string;
    source?: string;
    type?: string;
}): {
    events: EventEnvelope<import("../types.js").EventData>[];
    count: number;
    total: number;
    snapshot_id: string | null;
    next_cursor: string | null;
    has_more: boolean;
};
export {};
