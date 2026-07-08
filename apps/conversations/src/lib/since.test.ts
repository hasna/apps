import { describe, test, expect } from "bun:test";
import { normalizeSince, parseRelativeDurationMs } from "./since";

// Fixed reference clock: 2026-07-08T12:00:00.000Z
const NOW = Date.UTC(2026, 6, 8, 12, 0, 0, 0);

describe("parseRelativeDurationMs", () => {
  test("single units", () => {
    expect(parseRelativeDurationMs("45s")).toBe(45_000);
    expect(parseRelativeDurationMs("30m")).toBe(30 * 60_000);
    expect(parseRelativeDurationMs("24h")).toBe(24 * 3_600_000);
    expect(parseRelativeDurationMs("7d")).toBe(7 * 86_400_000);
    expect(parseRelativeDurationMs("1w")).toBe(604_800_000);
  });

  test("combos and whitespace and case", () => {
    expect(parseRelativeDurationMs("1w2d")).toBe(604_800_000 + 2 * 86_400_000);
    expect(parseRelativeDurationMs("1h30m")).toBe(3_600_000 + 30 * 60_000);
    expect(parseRelativeDurationMs(" 2h ")).toBe(2 * 3_600_000);
    expect(parseRelativeDurationMs("7D")).toBe(7 * 86_400_000);
  });

  test("non-durations return null (passthrough signal)", () => {
    expect(parseRelativeDurationMs("2026-07-01")).toBeNull();
    expect(parseRelativeDurationMs("2026-07-01T12:00:00Z")).toBeNull();
    expect(parseRelativeDurationMs("123")).toBeNull();
    expect(parseRelativeDurationMs("")).toBeNull();
    expect(parseRelativeDurationMs("yesterday")).toBeNull();
  });
});

describe("normalizeSince", () => {
  test("relative durations convert to absolute ISO", () => {
    expect(normalizeSince("7d", NOW)).toBe("2026-07-01T12:00:00.000Z");
    expect(normalizeSince("24h", NOW)).toBe("2026-07-07T12:00:00.000Z");
    expect(normalizeSince("30m", NOW)).toBe("2026-07-08T11:30:00.000Z");
    expect(normalizeSince("1w", NOW)).toBe("2026-07-01T12:00:00.000Z");
    expect(normalizeSince("45s", NOW)).toBe("2026-07-08T11:59:15.000Z");
    expect(normalizeSince("1h30m", NOW)).toBe("2026-07-08T10:30:00.000Z");
  });

  test("ISO / absolute values pass through untouched", () => {
    expect(normalizeSince("2026-07-01", NOW)).toBe("2026-07-01");
    expect(normalizeSince("2026-07-01T12:00:00Z", NOW)).toBe("2026-07-01T12:00:00Z");
  });

  test("empty / nullish → undefined", () => {
    expect(normalizeSince(undefined, NOW)).toBeUndefined();
    expect(normalizeSince(null, NOW)).toBeUndefined();
    expect(normalizeSince("", NOW)).toBeUndefined();
    expect(normalizeSince("   ", NOW)).toBeUndefined();
  });
});
