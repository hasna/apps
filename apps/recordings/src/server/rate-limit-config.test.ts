import { describe, expect, it } from "bun:test";
import { DEFAULT_RATE_LIMIT_MAX, MAX_RATE_LIMIT_MAX, resolveRateLimitMax } from "./rate-limit-config.js";

describe("rate-limit configuration", () => {
  it("defaults to a finite 12,000 requests/minute for absent or blank configuration", () => {
    expect(DEFAULT_RATE_LIMIT_MAX).toBe(12_000);
    for (const value of [undefined, "", " "]) expect(resolveRateLimitMax(value)).toBe(12_000);
  });

  it("accepts explicit small budgets, fleet headroom, and both inclusive bounds", () => {
    for (const [value, expected] of [["1", 1], ["5", 5], [" 006000 ", 6000], ["60000", 60_000], [String(MAX_RATE_LIMIT_MAX), MAX_RATE_LIMIT_MAX]] as const) {
      expect(resolveRateLimitMax(value)).toBe(expected);
    }
  });

  it("refuses disabled, partial, non-finite, fractional, and excessive budgets without reflecting input", () => {
    for (const value of ["0", "-1", "NaN", "Infinity", "1.5", "1e4", "120junk", "0x20", "+5", "1000001", "9007199254740993", "unexpected-sensitive-value"]) {
      let failure: unknown;
      try { resolveRateLimitMax(value); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("HASNA_RECORDINGS_RATE_LIMIT_MAX (legacy RECORDINGS_RATE_LIMIT_MAX) must be an integer from 1 to 1000000.");
    }
  });
});
