// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// Pagination helpers: every list read in this package funnels through these
// four functions, so a single bad limit/offset here corrupts every paged query
// at once. The failure modes a happy-path test misses are the NON-numeric and
// NON-finite inputs — NaN, ±Infinity, negative values, fractions — because
// callers parse user input through JSON and the CLI, and a NaN that survives
// into SQL LIMIT is a silent error at the driver boundary.
//
// Asserted behaviors:
//   - null/undefined fall back; NaN/±Infinity ALSO fall back (Number.isFinite
//     is the gate, not a typeof check);
//   - limits clamp to >= 1 and offsets to >= 0 (a negative offset is a SQL
//     error in SQLite; a zero limit returns nothing);
//   - fractional values are truncated, never rounded — 5.9 must behave like 5,
//     because rounding would silently skip the row at the boundary;
//   - safeOptionalLimit preserves the null-vs-number distinction (null means
//     "no limit requested" and is a DIFFERENT answer from 0);
//   - cappedLimit applies the max AFTER the fallback, so a caller that passes
//     a max smaller than its fallback gets the max, never more.

import { describe, expect, it } from "bun:test";
import { cappedLimit, safeLimit, safeOffset, safeOptionalLimit } from "./pagination.js";

describe("safeLimit", () => {
  it("returns the fallback for null and undefined", () => {
    expect(safeLimit(undefined)).toBe(50);
    expect(safeLimit(null)).toBe(50);
    expect(safeLimit(null, 10)).toBe(10);
  });

  it("returns the fallback for non-finite numbers", () => {
    expect(safeLimit(NaN)).toBe(50);
    expect(safeLimit(Infinity)).toBe(50);
    expect(safeLimit(-Infinity)).toBe(50);
    expect(safeLimit(NaN, 7)).toBe(7);
  });

  it("clamps zero and negative values to 1 — never a LIMIT 0", () => {
    expect(safeLimit(0)).toBe(1);
    expect(safeLimit(-5)).toBe(1);
    expect(safeLimit(-0.5)).toBe(1);
  });

  it("truncates fractional values instead of rounding them", () => {
    expect(safeLimit(5.9)).toBe(5);
    expect(safeLimit(5.1)).toBe(5);
    expect(safeLimit(0.9)).toBe(1); // trunc(0.9) = 0, then clamped to 1
  });

  it("passes finite integers through unchanged", () => {
    expect(safeLimit(1000)).toBe(1000);
    expect(safeLimit(1)).toBe(1);
  });
});

describe("safeOptionalLimit", () => {
  it("returns null for null and undefined — the 'no limit requested' answer", () => {
    expect(safeOptionalLimit(undefined)).toBeNull();
    expect(safeOptionalLimit(null)).toBeNull();
  });

  it("applies safeLimit semantics to numbers", () => {
    expect(safeOptionalLimit(0)).toBe(1);
    expect(safeOptionalLimit(-3)).toBe(1);
    expect(safeOptionalLimit(5.9)).toBe(5);
    expect(safeOptionalLimit(NaN, 20)).toBe(20);
    expect(safeOptionalLimit(42)).toBe(42);
  });
});

describe("safeOffset", () => {
  it("returns 0 for null, undefined and non-finite values", () => {
    expect(safeOffset(undefined)).toBe(0);
    expect(safeOffset(null)).toBe(0);
    expect(safeOffset(NaN)).toBe(0);
    expect(safeOffset(Infinity)).toBe(0);
    expect(safeOffset(-Infinity)).toBe(0);
  });

  it("clamps negative offsets to 0 — SQLite rejects negative OFFSET", () => {
    expect(safeOffset(-1)).toBe(0);
    expect(safeOffset(-100)).toBe(0);
    expect(safeOffset(-0.5)).toBe(0);
  });

  it("truncates fractional offsets", () => {
    expect(safeOffset(5.9)).toBe(5);
    expect(safeOffset(0.9)).toBe(0);
  });

  it("passes finite non-negative integers through", () => {
    expect(safeOffset(0)).toBe(0);
    expect(safeOffset(100)).toBe(100);
  });
});

describe("cappedLimit", () => {
  it("caps the value at max", () => {
    expect(cappedLimit(200, 50, 100)).toBe(100);
    expect(cappedLimit(1000, 50, 500)).toBe(500);
  });

  it("applies the cap to the fallback too — never exceeds max", () => {
    expect(cappedLimit(null, 50, 30)).toBe(30);
    expect(cappedLimit(undefined, 200, 100)).toBe(100);
    expect(cappedLimit(NaN, 200, 100)).toBe(100);
  });

  it("keeps values below the cap unchanged", () => {
    expect(cappedLimit(2, 50, 100)).toBe(2);
    expect(cappedLimit(50, 50, 100)).toBe(50);
  });

  it("still enforces the >= 1 limit floor under the cap", () => {
    expect(cappedLimit(0, 50, 100)).toBe(1);
    expect(cappedLimit(-5, 50, 100)).toBe(1);
  });
});
