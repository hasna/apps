import { describe, expect, test } from "bun:test";
import type { CellValue, Field } from "../types/index.js";
import { compareValues } from "./sort.js";

function field(type: Field["type"]): Field {
  return { id: `field-${type}`, name: type, type };
}

function sorted(type: Field["type"], values: CellValue[]): CellValue[] {
  return [...values].sort((left, right) => compareValues(field(type), left, right));
}

describe("compareValues empty ordering", () => {
  test("always puts empty values last", () => {
    expect(compareValues(field("text"), null, "value")).toBe(1);
    expect(compareValues(field("text"), "value", "")).toBe(-1);
    expect(sorted("text", [null, "beta", "", "alpha"])).toEqual(["alpha", "beta", null, ""]);
  });

  test("treats any pair of empty values as equal", () => {
    expect(compareValues(field("text"), null, "")).toBe(0);
    expect(compareValues(field("multiSelect"), [], null)).toBe(0);
  });
});

describe("compareValues numeric ordering", () => {
  test("sorts runtime numbers numerically for computed fields", () => {
    expect(sorted("formula", [10, 2.5, 2.33, -1])).toEqual([-1, 2.33, 2.5, 10]);
  });

  test("coerces numeric strings for declared number fields", () => {
    expect(sorted("number", ["10", "2", 3])).toEqual(["2", 3, "10"]);
  });

  test("falls back to natural collation for invalid number cells", () => {
    expect(sorted("number", ["item10", "item2", "item1"])).toEqual(["item1", "item2", "item10"]);
  });
});

describe("compareValues typed ordering", () => {
  test("sorts checkboxes false before true while keeping empties last", () => {
    expect(sorted("checkbox", [true, false, null])).toEqual([false, true, null]);
  });

  test("sorts valid dates chronologically", () => {
    expect(sorted("date", ["2026-10-01", "2025-01-01", "2026-02-01"])).toEqual([
      "2025-01-01",
      "2026-02-01",
      "2026-10-01",
    ]);
  });

  test("falls back to string ordering when either date is invalid", () => {
    expect(compareValues(field("date"), "later", "never")).toBeLessThan(0);
    expect(compareValues(field("date"), "never", "later")).toBeGreaterThan(0);
  });

  test("uses case-insensitive natural collation for text", () => {
    expect(sorted("text", ["Item10", "item2", "ALPHA", "beta"])).toEqual([
      "ALPHA",
      "beta",
      "item2",
      "Item10",
    ]);
  });

  test("formats array values before comparing", () => {
    expect(sorted("multiSelect", [["beta"], ["alpha", "zeta"], ["alpha"]])).toEqual([
      ["alpha"],
      ["alpha", "zeta"],
      ["beta"],
    ]);
  });
});
