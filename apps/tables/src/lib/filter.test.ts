import { describe, expect, test } from "bun:test";
import type { CellValue, Field, FilterCondition, FilterOperator } from "../types/index.js";
import { matchesCondition } from "./filter.js";

function field(type: Field["type"], options?: Field["options"]): Field {
  return { id: `field-${type}`, name: type, type, options };
}

function matches(type: Field["type"], value: CellValue, operator: FilterOperator, operand?: CellValue): boolean {
  const condition: FilterCondition = { fieldId: `field-${type}`, operator, value: operand };
  return matchesCondition(field(type), value, condition);
}

describe("matchesCondition emptiness", () => {
  test("treats null, empty strings, false, and empty arrays as empty", () => {
    for (const value of [null, "", false, []] satisfies CellValue[]) {
      expect(matches("text", value, "isEmpty")).toBeTrue();
      expect(matches("text", value, "isNotEmpty")).toBeFalse();
    }
  });

  test("does not treat zero or non-empty arrays as empty", () => {
    expect(matches("number", 0, "isEmpty")).toBeFalse();
    expect(matches("multiSelect", [""], "isEmpty")).toBeFalse();
    expect(matches("text", " ", "isEmpty")).toBeFalse();
  });
});

describe("matchesCondition equality", () => {
  test("coerces number fields but rejects empty or non-numeric operands", () => {
    expect(matches("number", 12, "eq", " 12 ")).toBeTrue();
    expect(matches("number", "12", "eq", 12)).toBeTrue();
    expect(matches("number", 0, "eq", "")).toBeFalse();
    expect(matches("number", 12, "eq", "twelve")).toBeFalse();
  });

  test("matches any member of array-valued cells", () => {
    expect(matches("multiSelect", ["red", "blue"], "eq", "blue")).toBeTrue();
    expect(matches("multiSelect", ["red", "blue"], "eq", "green")).toBeFalse();
  });

  test("negation is the exact complement of equality", () => {
    expect(matches("text", "open", "neq", "closed")).toBeTrue();
    expect(matches("text", "open", "neq", "open")).toBeFalse();
    expect(matches("number", 3, "neq", "3")).toBeFalse();
  });

  test("checkbox comparison uses boolean state", () => {
    expect(matches("checkbox", true, "eq", true)).toBeTrue();
    expect(matches("checkbox", false, "eq", false)).toBeTrue();
    expect(matches("checkbox", false, "eq", true)).toBeFalse();
  });
});

describe("matchesCondition text and numeric operators", () => {
  test("contains is case-insensitive and uses formatted cell values", () => {
    expect(matches("text", "Release Ready", "contains", "ready")).toBeTrue();
    expect(matches("multiSelect", ["Alpha", "Beta"], "contains", "ha, be")).toBeTrue();
    expect(matches("text", "Release Ready", "notContains", "blocked")).toBeTrue();
    expect(matches("text", "Release Ready", "notContains", "READY")).toBeFalse();
  });

  test("orders numeric strings and booleans consistently", () => {
    expect(matches("number", "10", "gt", 9)).toBeTrue();
    expect(matches("number", "10", "gte", 10)).toBeTrue();
    expect(matches("number", false, "lt", 1)).toBeTrue();
    expect(matches("number", true, "lte", 1)).toBeTrue();
    expect(matches("number", "invalid", "gt", 1)).toBeFalse();
  });
});

describe("matchesCondition set operators", () => {
  test("detects intersections for scalar and array values", () => {
    expect(matches("multiSelect", ["alpha", "beta"], "isAnyOf", ["beta", "gamma"])).toBeTrue();
    expect(matches("singleSelect", "alpha", "isAnyOf", ["alpha", "beta"])).toBeTrue();
    expect(matches("multiSelect", ["alpha"], "isAnyOf", [])).toBeFalse();
  });

  test("isNoneOf is the complement of intersection", () => {
    expect(matches("multiSelect", ["alpha"], "isNoneOf", ["beta", "gamma"])).toBeTrue();
    expect(matches("multiSelect", ["alpha"], "isNoneOf", ["alpha", "gamma"])).toBeFalse();
    expect(matches("multiSelect", null, "isNoneOf", ["alpha"])).toBeTrue();
  });
});
