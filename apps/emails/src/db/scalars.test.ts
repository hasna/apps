// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// countValue is the one coercion all COUNT(*) result handling funnels
// through. Drivers hand counts back as bigint (bun:sqlite) or number, and
// JSON transport hands them back as strings — so the function has three input
// types and a distinct failure mode for each:
//   - a bigint must survive the Number() conversion without a TypeError;
//   - a NON-finite number (NaN/Infinity — possible from an aggregate over a
//     bad expression) must NOT be returned as-is, or a caller comparing
//     `count > 0` gets a nonsense boolean;
//   - a string is parsed with parseInt, which is lenient in both directions:
//     "42abc" parses as 42 and "1.5" as 1, while "abc42" and "0x10" (with
//     radix 10) parse as 0. Locking these in is deliberate: the leniency is
//     the contract callers rely on for JSON-count strings, and a "fix" to
//     strict parsing would change behavior silently.

import { describe, expect, it } from "bun:test";
import { countValue } from "./scalars.js";

describe("countValue", () => {
  it("converts bigint counts without loss", () => {
    expect(countValue(42n)).toBe(42);
    expect(countValue(0n)).toBe(0);
    expect(countValue(1_000_000n)).toBe(1_000_000);
  });

  it("passes finite numbers through unchanged", () => {
    expect(countValue(42)).toBe(42);
    expect(countValue(0)).toBe(0);
    // A fractional count is returned as-is, not truncated — the caller asked
    // for the value, and coercion to an integer is not this function's job.
    expect(countValue(3.7)).toBe(3.7);
  });

  it("maps non-finite numbers to 0 instead of returning them", () => {
    expect(countValue(NaN)).toBe(0);
    expect(countValue(Infinity)).toBe(0);
    expect(countValue(-Infinity)).toBe(0);
  });

  it("parses integer strings with parseInt semantics", () => {
    expect(countValue("42")).toBe(42);
    expect(countValue("0")).toBe(0);
    expect(countValue(" 42 ")).toBe(42);
    // parseInt stops at the first non-digit: the prefix wins.
    expect(countValue("42abc")).toBe(42);
    // A leading non-digit means NaN, which must fall back to 0.
    expect(countValue("abc42")).toBe(0);
    // With radix 10, the hex prefix is not a valid integer start.
    expect(countValue("0x10")).toBe(0);
    // Fractional strings truncate at the decimal point.
    expect(countValue("3.9")).toBe(3);
    // Exponential notation truncates at the 'e'.
    expect(countValue("1e3")).toBe(1);
    expect(countValue("")).toBe(0);
  });

  it("maps every other value to 0 — never throws, never returns the value", () => {
    expect(countValue(null)).toBe(0);
    expect(countValue(undefined)).toBe(0);
    expect(countValue({})).toBe(0);
    expect(countValue([])).toBe(0);
    expect(countValue(true)).toBe(0);
    expect(countValue(false)).toBe(0);
    expect(countValue(Symbol("n"))).toBe(0);
    expect(countValue(() => 1)).toBe(0);
  });
});
