import { describe, expect, it } from "bun:test";
import { assertNoNumeratorKeys, formatFraction } from "../src/core/fraction";

describe("provenance-bearing fractions", () => {
  it("emits a fraction and provenance without exposing a numerator field", () => {
    const result = formatFraction({
      numerator: 3,
      denominator: 4,
      source: "manifest",
      observedAt: "2026-08-01T00:00:00.000Z",
      axes: ["source", "reachability"],
      omittedAxis: "transient health",
    });

    expect(result).toEqual({
      fraction: "3/4",
      provenance: {
        source: "manifest",
        observedAt: "2026-08-01T00:00:00.000Z",
        axes: ["source", "reachability"],
        omittedAxis: "transient health",
      },
    });
    expect(result).not.toHaveProperty("numerator");
    expect(JSON.stringify(result)).not.toContain('"numerator"');
    expect(() => assertNoNumeratorKeys(result)).not.toThrow();
  });

  it("rejects known-bad numerator fixtures as a positive control", () => {
    expect(() => assertNoNumeratorKeys({ fraction: "3/4", numerator: 3 })).toThrow(
      /numerator/i,
    );
  });
});
