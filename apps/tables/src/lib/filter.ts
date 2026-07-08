import type { CellValue, Field, FilterCondition } from "../types/index.js";
import { formatCell, isEmptyValue } from "./fields.js";

/** Coerce a cell/operand to a number when possible, else NaN. */
function num(value: CellValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return value.trim() === "" ? NaN : n;
  }
  return NaN;
}

function asArray(value: CellValue): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === null) return [];
  return [String(value)];
}

/** Test whether a single cell value satisfies a filter condition. */
export function matchesCondition(field: Field, value: CellValue, condition: FilterCondition): boolean {
  const { operator, value: operand } = condition;

  switch (operator) {
    case "isEmpty":
      return isEmptyValue(value);
    case "isNotEmpty":
      return !isEmptyValue(value);
    case "eq": {
      if (Array.isArray(value)) return value.map(String).includes(String(operand));
      if (field.type === "number") return num(value) === num(operand ?? null);
      if (field.type === "checkbox") return Boolean(value) === Boolean(operand);
      return String(value ?? "") === String(operand ?? "");
    }
    case "neq":
      return !matchesCondition(field, value, { ...condition, operator: "eq" });
    case "contains":
      return formatCell(field, value).toLowerCase().includes(String(operand ?? "").toLowerCase());
    case "notContains":
      return !formatCell(field, value).toLowerCase().includes(String(operand ?? "").toLowerCase());
    case "gt":
      return num(value) > num(operand ?? null);
    case "gte":
      return num(value) >= num(operand ?? null);
    case "lt":
      return num(value) < num(operand ?? null);
    case "lte":
      return num(value) <= num(operand ?? null);
    case "isAnyOf": {
      const set = asArray(operand ?? null);
      const cell = asArray(value);
      return cell.some((c) => set.includes(c));
    }
    case "isNoneOf": {
      const set = asArray(operand ?? null);
      const cell = asArray(value);
      return !cell.some((c) => set.includes(c));
    }
    default:
      return true;
  }
}
