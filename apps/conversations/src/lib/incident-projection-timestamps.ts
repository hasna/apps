import type { Message } from "../types.js";

const RFC3339_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const SQLITE_UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;
const POSTGRES_TEXT_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)([+-]\d{2})(?::?(\d{2}))?$/;

/** Normalize only the timestamp representations emitted by supported stores. */
export function normalizeIncidentProjectionTimestamp(value: unknown, path: string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error(`${path} is not a valid timestamp`);
    return value.toISOString();
  }
  if (typeof value !== "string") throw new Error(`${path} is not a timestamp string`);

  let candidate: string;
  if (RFC3339_TIMESTAMP.test(value)) {
    candidate = value;
  } else if (SQLITE_UTC_TIMESTAMP.test(value)) {
    candidate = `${value}Z`;
  } else {
    const postgres = POSTGRES_TEXT_TIMESTAMP.exec(value);
    if (!postgres) throw new Error(`${path} is not a supported timestamp`);
    candidate = `${postgres[1]}T${postgres[2]}${postgres[3]}:${postgres[4] ?? "00"}`;
  }

  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${path} is not a valid timestamp`);
  return parsed.toISOString();
}

export function normalizeNullableIncidentProjectionTimestamp(
  value: unknown,
  path: string,
): string | null {
  return value === null ? null : normalizeIncidentProjectionTimestamp(value, path);
}

export function normalizeIncidentProjectionMessageTimestamps(message: Message): Message {
  return {
    ...message,
    created_at: normalizeIncidentProjectionTimestamp(message.created_at, "message.created_at"),
    edited_at: normalizeNullableIncidentProjectionTimestamp(message.edited_at, "message.edited_at"),
    pinned_at: normalizeNullableIncidentProjectionTimestamp(message.pinned_at, "message.pinned_at"),
    read_at: normalizeNullableIncidentProjectionTimestamp(message.read_at, "message.read_at"),
  };
}
