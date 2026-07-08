import type { CellValue, Field, FieldType, RecordItem } from "../types/index.js";

/** Field types whose values are computed, never stored on the record. */
export const COMPUTED_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "formula",
  "lookup",
]);

export function isComputedField(field: Field): boolean {
  return COMPUTED_FIELD_TYPES.has(field.type);
}

/** The natural "empty" value for a given field type. */
export function emptyValue(type: FieldType): CellValue {
  switch (type) {
    case "checkbox":
      return false;
    case "multiSelect":
    case "link":
      return [];
    case "number":
      return null;
    default:
      return null;
  }
}

/** True when a cell value counts as empty for that field type. */
export function isEmptyValue(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value === false) return true;
  return false;
}

/**
 * Coerce an arbitrary input value into the canonical stored shape for a field.
 * Throws a TypeError on values that cannot be represented for the field type.
 */
export function coerceValue(field: Field, input: unknown): CellValue {
  const { type } = field;
  if (input === null || input === undefined) return emptyValue(type);

  switch (type) {
    case "text":
    case "date":
    case "singleSelect": {
      if (typeof input === "string") return input;
      if (typeof input === "number" || typeof input === "boolean") return String(input);
      throw new TypeError(`Field "${field.name}" expects a string, got ${typeof input}`);
    }
    case "number": {
      if (typeof input === "number") return Number.isFinite(input) ? input : null;
      if (typeof input === "string") {
        const trimmed = input.trim();
        if (trimmed === "") return null;
        const n = Number(trimmed);
        if (Number.isNaN(n)) throw new TypeError(`Field "${field.name}" expects a number, got "${input}"`);
        return n;
      }
      throw new TypeError(`Field "${field.name}" expects a number, got ${typeof input}`);
    }
    case "checkbox": {
      if (typeof input === "boolean") return input;
      if (typeof input === "string") return input === "true" || input === "1" || input === "yes";
      if (typeof input === "number") return input !== 0;
      return Boolean(input);
    }
    case "multiSelect":
    case "link": {
      if (Array.isArray(input)) return input.map((v) => String(v));
      if (typeof input === "string") {
        const trimmed = input.trim();
        return trimmed === "" ? [] : trimmed.split(",").map((s) => s.trim()).filter(Boolean);
      }
      throw new TypeError(`Field "${field.name}" expects an array, got ${typeof input}`);
    }
    default:
      throw new TypeError(`Cannot set value on computed field "${field.name}" (${type})`);
  }
}

/** Read a stored value from a record, defaulting to the field's empty value. */
export function readCell(record: RecordItem, field: Field): CellValue {
  const value = record.fields[field.id];
  return value === undefined ? emptyValue(field.type) : value;
}

/** Human-readable rendering of a cell value (used by CSV export and formulas). */
export function formatCell(field: Field, value: CellValue): string {
  if (isEmptyValue(value) && field.type !== "checkbox") return "";
  switch (field.type) {
    case "checkbox":
      return value ? "true" : "false";
    case "number": {
      if (typeof value !== "number") return "";
      const precision = field.options?.precision;
      return precision === undefined ? String(value) : value.toFixed(precision);
    }
    case "multiSelect":
    case "link":
      return Array.isArray(value) ? value.join(", ") : "";
    default:
      return value === null ? "" : String(value);
  }
}
