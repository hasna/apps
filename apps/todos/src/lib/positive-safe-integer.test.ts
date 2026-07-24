import { describe, expect, test } from "bun:test";
import {
  parseNonNegativeSafeInteger,
  parseOptionalNonNegativeSafeInteger,
  parseOptionalPositiveSafeInteger,
  parsePositiveSafeInteger,
  parsePositiveSafeIntegerOr,
} from "./positive-safe-integer.js";

describe("canonical positive safe integers", () => {
  test.each([
    "0",
    "-1",
    "+1",
    " 1",
    "1 ",
    "01",
    "1.0",
    "1suffix",
    "9007199254740992",
    "",
  ])("rejects non-canonical input %j", (value) => {
    expect(() => parsePositiveSafeInteger(value, "--value")).toThrow(
      "--value must be a positive integer",
    );
  });

  test.each([
    ["1", 1],
    ["42", 42],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ] as const)("accepts %s", (value, expected) => {
    expect(parsePositiveSafeInteger(value)).toBe(expected);
  });

  test("preserves omitted/default values without accepting an explicit zero", () => {
    expect(parseOptionalPositiveSafeInteger(undefined)).toBeUndefined();
    expect(parsePositiveSafeIntegerOr(undefined, 25)).toBe(25);
    expect(() => parsePositiveSafeIntegerOr("0", 25)).toThrow();
  });

  test("preserves canonical zero only for explicitly non-negative domains", () => {
    expect(parseNonNegativeSafeInteger("0")).toBe(0);
    expect(parseOptionalNonNegativeSafeInteger(undefined)).toBeUndefined();
    for (const value of ["00", "+0", "-0", " 0", "0 ", "0.0"]) {
      expect(() => parseNonNegativeSafeInteger(value)).toThrow("must be a positive integer");
    }
  });
});
