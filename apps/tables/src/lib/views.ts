import type {
  Base,
  CellValue,
  ComputedRecord,
  Field,
  RecordGroup,
  Table,
  View,
} from "../types/index.js";
import { computeRecords } from "./compute.js";
import { formatCell } from "./fields.js";
import { matchesCondition } from "./filter.js";
import { compareValues } from "./sort.js";

function fieldMap(table: Table): Map<string, Field> {
  return new Map(table.fields.map((f) => [f.id, f]));
}

/** Filter computed records by a view's filter conditions + conjunction. */
export function filterRecords(table: Table, records: ComputedRecord[], view: View): ComputedRecord[] {
  if (view.filters.length === 0) return records;
  const fields = fieldMap(table);
  return records.filter((record) => {
    const results = view.filters.map((cond) => {
      const field = fields.get(cond.fieldId);
      if (!field) return true;
      return matchesCondition(field, record.computed[cond.fieldId] ?? null, cond);
    });
    return view.filterConjunction === "or" ? results.some(Boolean) : results.every(Boolean);
  });
}

/** Sort computed records by a view's sort specs (stable, multi-key). */
export function sortRecords(table: Table, records: ComputedRecord[], view: View): ComputedRecord[] {
  if (view.sorts.length === 0) return records;
  const fields = fieldMap(table);
  const withIndex = records.map((record, index) => ({ record, index }));
  withIndex.sort((a, b) => {
    for (const sort of view.sorts) {
      const field = fields.get(sort.fieldId);
      if (!field) continue;
      const av = a.record.computed[sort.fieldId] ?? null;
      const bv = b.record.computed[sort.fieldId] ?? null;
      const cmp = compareValues(field, av, bv);
      if (cmp !== 0) return sort.direction === "desc" ? -cmp : cmp;
    }
    return a.index - b.index; // stable
  });
  return withIndex.map((w) => w.record);
}

/** Group computed records by a field, preserving first-seen group order. */
export function groupRecords(
  table: Table,
  records: ComputedRecord[],
  groupByFieldId: string,
): RecordGroup[] {
  const field = table.fields.find((f) => f.id === groupByFieldId);
  const groups = new Map<string, RecordGroup>();
  for (const record of records) {
    const raw = record.computed[groupByFieldId] ?? null;
    const key = field ? keyFor(field, raw) : String(raw);
    let group = groups.get(key);
    if (!group) {
      group = { key, value: raw, records: [] };
      groups.set(key, group);
    }
    group.records.push(record);
  }
  return [...groups.values()];
}

function keyFor(field: Field, value: CellValue): string {
  if (Array.isArray(value)) return value.map(String).sort().join("|");
  return formatCell(field, value);
}

export interface ViewResult {
  records: ComputedRecord[];
  groups?: RecordGroup[];
}

/** Run a view end-to-end: compute -> filter -> sort -> (optional) group. */
export function queryView(base: Base, table: Table, view: View): ViewResult {
  const computed = computeRecords(base, table);
  const filtered = filterRecords(table, computed, view);
  const sorted = sortRecords(table, filtered, view);
  if (view.groupByFieldId) {
    return { records: sorted, groups: groupRecords(table, sorted, view.groupByFieldId) };
  }
  return { records: sorted };
}

/** The field ids visible in a view, respecting order + hidden fields. */
export function visibleFieldIds(table: Table, view: View): string[] {
  const hidden = new Set(view.hiddenFieldIds ?? []);
  const ordered = view.fieldOrder && view.fieldOrder.length > 0
    ? [
        ...view.fieldOrder.filter((id) => table.fields.some((f) => f.id === id)),
        ...table.fields.filter((f) => !view.fieldOrder!.includes(f.id)).map((f) => f.id),
      ]
    : table.fields.map((f) => f.id);
  return ordered.filter((id) => !hidden.has(id));
}
