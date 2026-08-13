import type {
  Base,
  CellValue,
  ComputedRecord,
  Field,
  RecordItem,
  Table,
} from "../types/index.js";
import { formatCell, isComputedField, readCell } from "./fields.js";
import { compileFormula, type FieldResolver, type FormulaValue } from "./formula/index.js";

function findFieldByName(table: Table, name: string): Field | undefined {
  const exact = table.fields.find((f) => f.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return table.fields.find((f) => f.name.toLowerCase() === lower);
}

function findTable(base: Base, tableId: string | undefined): Table | undefined {
  if (!tableId) return undefined;
  return base.tables.find((t) => t.id === tableId);
}

function scalarToCell(v: FormulaValue): CellValue {
  return v;
}

/**
 * Compute the resolved value of a single field for a record, resolving
 * formula and lookup fields recursively with cycle protection.
 */
function computeFieldValue(
  base: Base,
  table: Table,
  record: RecordItem,
  field: Field,
  visiting: Set<string>,
  memo: Map<string, CellValue>,
): CellValue {
  if (memo.has(field.id)) return memo.get(field.id)!;
  if (!isComputedField(field)) {
    return readCell(record, field);
  }
  if (visiting.has(field.id)) {
    // circular reference — stop and report empty
    return null;
  }
  visiting.add(field.id);

  let result: CellValue = null;
  try {
    if (field.type === "formula") {
      result = computeFormulaField(base, table, record, field, visiting, memo);
    } else if (field.type === "lookup") {
      result = computeLookupField(base, table, record, field);
    }
  } catch {
    result = null;
  }

  visiting.delete(field.id);
  memo.set(field.id, result);
  return result;
}

function computeFormulaField(
  base: Base,
  table: Table,
  record: RecordItem,
  field: Field,
  visiting: Set<string>,
  memo: Map<string, CellValue>,
): CellValue {
  const source = field.options?.formula;
  if (!source || source.trim() === "") return null;

  const resolver: FieldResolver = (name: string) => {
    const ref = findFieldByName(table, name);
    if (!ref) return null;
    return computeFieldValue(base, table, record, ref, visiting, memo);
  };

  const value = compileFormula(source)(resolver);
  return scalarToCell(value);
}

function computeLookupField(
  base: Base,
  table: Table,
  record: RecordItem,
  field: Field,
): CellValue {
  const linkFieldId = field.options?.linkFieldId;
  const foreignFieldId = field.options?.foreignFieldId;
  if (!linkFieldId || !foreignFieldId) return [];

  const linkField = table.fields.find((f) => f.id === linkFieldId);
  if (!linkField || linkField.type !== "link") return [];

  const foreignTable = findTable(base, linkField.options?.linkedTableId);
  if (!foreignTable) return [];

  const foreignField = foreignTable.fields.find((f) => f.id === foreignFieldId);
  if (!foreignField) return [];

  const linkedIds = readCell(record, linkField);
  const ids = Array.isArray(linkedIds) ? linkedIds : [];

  const out: string[] = [];
  for (const id of ids) {
    const foreignRecord = foreignTable.records.find((r) => r.id === id);
    if (!foreignRecord) continue;
    let value: CellValue;
    if (isComputedField(foreignField)) {
      // compute the foreign record's field in its own table context
      value = computeFieldValue(base, foreignTable, foreignRecord, foreignField, new Set(), new Map());
    } else {
      value = readCell(foreignRecord, foreignField);
    }
    out.push(formatCell(foreignField, value));
  }
  return out;
}

/** Compute all field values (stored + computed) for a single record. */
export function computeRecord(base: Base, table: Table, record: RecordItem): ComputedRecord {
  const memo = new Map<string, CellValue>();
  const computed: Record<string, CellValue> = {};
  for (const field of table.fields) {
    computed[field.id] = computeFieldValue(base, table, record, field, new Set(), memo);
  }
  return { ...record, computed };
}

/** Compute every record in a table. */
export function computeRecords(base: Base, table: Table): ComputedRecord[] {
  return table.records.map((r) => computeRecord(base, table, r));
}
