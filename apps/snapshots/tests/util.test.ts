import { describe, expect, test } from "bun:test";
import { formatDuration, parseDuration, resolveMaxAgeMs } from "../src/util.js";

describe("parseDuration", () => {
  test("parses single-unit durations", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("7d")).toBe(604_800_000);
    expect(parseDuration("1500ms")).toBe(1_500);
    expect(parseDuration("90")).toBe(90_000); // bare numbers are seconds
  });

  test("parses compound durations", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("1d12h")).toBe(129_600_000);
  });

  test("rejects malformed durations", () => {
    expect(() => parseDuration("bogus")).toThrow("Invalid duration");
    expect(() => parseDuration("")).toThrow("Invalid duration");
    expect(() => parseDuration("h")).toThrow("Invalid duration");
    expect(() => parseDuration("1.5h")).toThrow("Invalid duration");
  });
});

describe("formatDuration", () => {
  test("renders compactly", () => {
    expect(formatDuration(3 * 86_400_000)).toBe("3d");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(250)).toBe("250ms");
    expect(formatDuration(0)).toBe("0ms");
  });
});

describe("resolveMaxAgeMs", () => {
  test("an explicit value wins over the environment", () => {
    process.env.HASNA_SNAPSHOTS_MAX_AGE = "1h";
    try {
      expect(resolveMaxAgeMs(5_000)).toBe(5_000);
    } finally {
      delete process.env.HASNA_SNAPSHOTS_MAX_AGE;
    }
  });

  test("falls back to the environment and then to disabled", () => {
    process.env.HASNA_SNAPSHOTS_MAX_AGE = "72h";
    try {
      expect(resolveMaxAgeMs(undefined)).toBe(72 * 3_600_000);
    } finally {
      delete process.env.HASNA_SNAPSHOTS_MAX_AGE;
    }
    expect(resolveMaxAgeMs(undefined)).toBeUndefined();
  });
});
