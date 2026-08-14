import { randomBytes } from "node:crypto";

const TIME_HEX_LENGTH = 12;

/**
 * Generate a 128-bit, time-sortable identifier (ULID-like): a 48-bit
 * millisecond timestamp prefix (12 lowercase hex chars) followed by 80 random
 * bits (20 lowercase hex chars). Fixed width keeps lexicographic order aligned
 * with creation time, and plain lowercase hex stays compatible with the
 * existing TEXT primary keys written by earlier releases.
 */
export function genId(): string {
  const time = Date.now().toString(16).padStart(TIME_HEX_LENGTH, "0");
  return `${time}${randomBytes(10).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
