import { describe, test, expect } from "bun:test";
import {
  parseEventTimestamp,
  assertEventEndsAfterStart,
  parseTimeRange,
  compareEventInstants,
  compareEventTimestampStrings,
} from "./event-time.js";

const NS_PER_MS = 1_000_000n;
const NS_PER_MINUTE = 60_000_000_000n;

function baseNs(year: number, month: number, day: number, hour: number, minute: number, second: number): bigint {
  return BigInt(Date.UTC(year, month - 1, day, hour, minute, second)) * NS_PER_MS;
}

describe("parseEventTimestamp", () => {
  test("parses a plain UTC instant exactly", () => {
    expect(parseEventTimestamp("2026-04-15T09:00:00Z")).toBe(baseNs(2026, 4, 15, 9, 0, 0));
  });

  test("parses fractional seconds with 1-9 digits (padded to nanoseconds)", () => {
    expect(parseEventTimestamp("2026-04-15T09:00:00.5Z")).toBe(baseNs(2026, 4, 15, 9, 0, 0) + 500_000_000n);
    expect(parseEventTimestamp("2026-04-15T09:00:00.0005Z")).toBe(baseNs(2026, 4, 15, 9, 0, 0) + 500_000n);
    expect(parseEventTimestamp("2026-04-15T09:00:00.123456789Z")).toBe(baseNs(2026, 4, 15, 9, 0, 0) + 123_456_789n);
    expect(parseEventTimestamp("2026-04-15T09:00:00.000000001Z")).toBe(baseNs(2026, 4, 15, 9, 0, 0) + 1n);
  });

  test("rejects a 10-digit fraction (out of nanosecond precision)", () => {
    expect(() => parseEventTimestamp("2026-04-15T09:00:00.1234567890Z")).toThrow(RangeError);
  });

  test("applies a positive offset by subtracting it from the instant", () => {
    expect(parseEventTimestamp("2026-04-15T10:00:00+02:00")).toBe(baseNs(2026, 4, 15, 8, 0, 0));
  });

  test("applies a negative offset by adding it to the instant", () => {
    expect(parseEventTimestamp("2026-04-15T08:00:00-02:00")).toBe(baseNs(2026, 4, 15, 10, 0, 0));
  });

  test("applies half-hour and quarter-hour offsets", () => {
    expect(parseEventTimestamp("2026-04-15T10:30:00+05:30")).toBe(baseNs(2026, 4, 15, 5, 0, 0));
    expect(parseEventTimestamp("2026-04-15T10:15:00-03:45")).toBe(baseNs(2026, 4, 15, 14, 0, 0));
  });

  test("accepts the maximum legal offset +23:59", () => {
    expect(parseEventTimestamp("2026-04-15T23:59:00+23:59")).toBe(baseNs(2026, 4, 15, 0, 0, 0));
  });

  test("rejects offsets beyond +23:59", () => {
    expect(() => parseEventTimestamp("2026-04-15T00:00:00+24:00")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T00:00:00+00:60")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T00:00:00+23:60")).toThrow(RangeError);
  });

  test("rejects malformed offset shapes", () => {
    expect(() => parseEventTimestamp("2026-04-15T00:00:00+02")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T00:00:00+0200")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T00:00:00")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T00:00:00+2:00")).toThrow(RangeError);
  });

  test("rejects impossible calendar dates", () => {
    expect(() => parseEventTimestamp("2026-02-30T00:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-31T00:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-06-31T00:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-13-01T00:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-00-10T00:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-00T00:00:00Z")).toThrow(RangeError);
  });

  test("accepts leap-day 2024-02-29 and rejects non-leap 2025-02-29", () => {
    expect(parseEventTimestamp("2024-02-29T00:00:00Z")).toBe(baseNs(2024, 2, 29, 0, 0, 0));
    expect(() => parseEventTimestamp("2025-02-29T00:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("1900-02-29T00:00:00Z")).toThrow(RangeError);
    expect(parseEventTimestamp("2000-02-29T00:00:00Z")).toBe(baseNs(2000, 2, 29, 0, 0, 0));
  });

  test("rejects impossible clock values", () => {
    expect(() => parseEventTimestamp("2026-04-15T24:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T09:60:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T09:00:60Z")).toThrow(RangeError);
  });

  test("rejects non-ISO shapes entirely", () => {
    expect(() => parseEventTimestamp("1")).toThrow(RangeError);
    expect(() => parseEventTimestamp("")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15")).toThrow(RangeError);
    expect(() => parseEventTimestamp("tomorrow")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15T09:00:00")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-04-15 09:00:00Z")).toThrow(RangeError);
  });

  test("handles month-length boundaries across years", () => {
    expect(parseEventTimestamp("2026-12-31T23:59:59Z")).toBe(baseNs(2026, 12, 31, 23, 59, 59));
    expect(() => parseEventTimestamp("2026-11-31T00:00:00Z")).toThrow(RangeError);
    expect(() => parseEventTimestamp("2026-09-31T00:00:00Z")).toThrow(RangeError);
  });

  test("parses year-0 through year-99 correctly (no two-digit-year constructor bug)", () => {
    // Date.UTC(1, ...) would map 0-99 to 1900+year (the JS two-digit-year
    // quirk). The parser uses setUTCFullYear, so it must produce the LITERAL
    // year instant: year 1 CE starts at -62135596800 s (the standard epoch
    // constant for 0001-01-01T00:00:00Z), NOT 1901-01-01T00:00:00Z.
    expect(parseEventTimestamp("0001-01-01T00:00:00Z")).toBe(-62135596800000000000n);
    // 0099-12-31T23:59:59Z = year-1 start + 98 full years (24 leap days) +
    // 364 days + 86399 s = -62135596800 s + 3124137599 s = -59011459201 s.
    expect(parseEventTimestamp("0099-12-31T23:59:59Z")).toBe(-59011459201000000000n);
  });
});

describe("assertEventEndsAfterStart", () => {
  test("accepts a strictly-later end", () => {
    expect(() => assertEventEndsAfterStart("2026-04-15T09:00:00Z", "2026-04-15T10:00:00Z")).not.toThrow();
  });

  test("rejects equal instants in different spellings", () => {
    expect(() => assertEventEndsAfterStart("2026-04-15T10:00:00+02:00", "2026-04-15T08:00:00Z")).toThrow(RangeError);
  });

  test("rejects end before start", () => {
    expect(() => assertEventEndsAfterStart("2026-04-15T10:00:00Z", "2026-04-15T09:00:00Z")).toThrow(RangeError);
  });

  test("propagates timestamp parse errors", () => {
    expect(() => assertEventEndsAfterStart("bogus", "2026-04-15T10:00:00Z")).toThrow(RangeError);
  });
});

describe("parseTimeRange", () => {
  test("returns normalized start/end instants", () => {
    const { start, end } = parseTimeRange("2026-04-15T10:00:00+02:00", "2026-04-15T10:00:00Z");
    expect(start).toBe(baseNs(2026, 4, 15, 8, 0, 0));
    expect(end).toBe(baseNs(2026, 4, 15, 10, 0, 0));
  });

  test("rejects inverted ranges", () => {
    expect(() => parseTimeRange("2026-04-15T11:00:00Z", "2026-04-15T09:00:00Z")).toThrow(RangeError);
    expect(() => parseTimeRange("2026-04-15T09:00:00Z", "2026-04-15T09:00:00Z")).toThrow(RangeError);
  });
});

describe("compareEventInstants", () => {
  test("orders by instant with -1/0/1", () => {
    const a = parseEventTimestamp("2026-04-15T09:00:00Z");
    const b = parseEventTimestamp("2026-04-15T09:00:01Z");
    expect(compareEventInstants(a, b)).toBe(-1);
    expect(compareEventInstants(b, a)).toBe(1);
    expect(compareEventInstants(a, a)).toBe(0);
  });
});

describe("compareEventTimestampStrings", () => {
  test("compares by instant, not by wall-clock spelling", () => {
    const earlier = "2026-04-15T10:00:00+02:00"; // 08:00Z
    const later = "2026-04-15T09:00:00Z";
    expect(compareEventTimestampStrings(earlier, later)).toBe(-1);
    expect(compareEventTimestampStrings(later, earlier)).toBe(1);
  });

  test("ties break by localeCompare on the original strings", () => {
    const a = "2026-04-15T08:00:00-00:00"; // same instant as Z
    const b = "2026-04-15T08:00:00Z";
    expect(compareEventTimestampStrings(a, b)).toBe(a.localeCompare(b));
    expect(compareEventTimestampStrings(b, a)).toBe(b.localeCompare(a));
  });
});
