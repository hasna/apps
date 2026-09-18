import type { EventEnvelope } from "../types.js";
export declare const EVENT_LIST_CURSOR_PREFIX = "events-list-v1:";
export declare const DEFAULT_COMPACT_EVENT_LIST_MAX_BYTES: number;
export declare const COMPACT_EVENT_FIELD_MAX_BYTES: Readonly<{
    id: 256;
    time: 64;
    source: 128;
    type: 128;
    severity: 32;
    subject: 256;
    message: 160;
    schemaVersion: 32;
}>;
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
    cursor: string | null;
    snapshot_id: string | null;
    next_cursor: string | null;
    has_more: boolean;
};
export declare function compactEventListOutput(events: EventEnvelope[], options: {
    limit: number;
    cursor?: string;
    source?: string;
    type?: string;
    maxBytes?: number;
}): CompactEventListOutput;
export {};
