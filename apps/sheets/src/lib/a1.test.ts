import { describe, expect, test } from "bun:test";
import {
  columnIndexToLabel,
  columnLabelToIndex,
  expandRange,
  isA1,
  normalizeRange,
  parseA1,
  parseRange,
  toA1,
  toRangeRef,
} from "./a1.js";

describe("column labels", () => {
  test("label to index", () => {
    expect(columnLabelToIndex("A")).toBe(0);
    expect(columnLabelToIndex("Z")).toBe(25);
    expect(columnLabelToIndex("AA")).toBe(26);
    expect(columnLabelToIndex("AZ")).toBe(51);
    expect(columnLabelToIndex("BA")).toBe(52);
  });

  test("index to label", () => {
    expect(columnIndexToLabel(0)).toBe("A");
    expect(columnIndexToLabel(25)).toBe("Z");
    expect(columnIndexToLabel(26)).toBe("AA");
    expect(columnIndexToLabel(701)).toBe("ZZ");
    expect(columnIndexToLabel(702)).toBe("AAA");
  });

  test("round trips", () => {
    for (const i of [0, 1, 25, 26, 51, 700, 1000]) {
      expect(columnLabelToIndex(columnIndexToLabel(i))).toBe(i);
    }
  });
});

describe("A1 references", () => {
  test("parse and render", () => {
    expect(parseA1("A1")).toEqual({ row: 0, col: 0 });
    expect(parseA1("B3")).toEqual({ row: 2, col: 1 });
    expect(parseA1("$A$1")).toEqual({ row: 0, col: 0 });
    expect(parseA1("aa10")).toEqual({ row: 9, col: 26 });
    expect(toA1({ row: 2, col: 1 })).toBe("B3");
    expect(toA1({ row: 9, col: 26 })).toBe("AA10");
  });

  test("isA1", () => {
    expect(isA1("A1")).toBe(true);
    expect(isA1("$B$2")).toBe(true);
    expect(isA1("A")).toBe(false);
    expect(isA1("1")).toBe(false);
    expect(isA1("A1:B2")).toBe(false);
  });

  test("invalid throws", () => {
    expect(() => parseA1("A0")).toThrow(); // row 0 is out of range
    expect(() => parseA1("1A")).toThrow();
    expect(() => parseA1("")).toThrow();
  });
});

describe("ranges", () => {
  test("parseRange normalizes", () => {
    expect(parseRange("A1:B3")).toEqual({ start: { row: 0, col: 0 }, end: { row: 2, col: 1 } });
    expect(parseRange("B3:A1")).toEqual({ start: { row: 0, col: 0 }, end: { row: 2, col: 1 } });
  });

  test("toRangeRef", () => {
    expect(toRangeRef({ start: { row: 0, col: 0 }, end: { row: 2, col: 1 } })).toBe("A1:B3");
  });

  test("normalizeRange", () => {
    const r = normalizeRange({ start: { row: 5, col: 5 }, end: { row: 1, col: 1 } });
    expect(r).toEqual({ start: { row: 1, col: 1 }, end: { row: 5, col: 5 } });
  });

  test("expandRange enumerates row-major", () => {
    const coords = expandRange({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } });
    expect(coords).toHaveLength(4);
    expect(coords[0]).toEqual({ row: 0, col: 0 });
    expect(coords[3]).toEqual({ row: 1, col: 1 });
  });
});
