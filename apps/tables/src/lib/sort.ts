import type { CellValue, Field } from "../types/index.js";
import { formatCell, isEmptyValue } from "./fields.js";

/**
 * Type-aware comparator for two cell values of the same field.
 * Empty values always sort last (regardless of direction).
 */
export function compareValues(field: Field, a: CellValue, b: CellValue): number {
  const aEmpty = isEmptyValue(a);
  const bEmpty = isEmptyValue(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  // Runtime-numeric comparison first — this covers `number` fields AND computed
  // (formula/lookup) fields that resolve to numbers, where the declared field
  // type is not `number`. String collation mis-orders decimals (e.g. 2.33 vs 2.5).
  if (typeof a === "number" && typeof b === "number") return a - b;

  switch (field.type) {
    case "number": {
      const na = typeof a === "number" ? a : Number(a);
      const nb = typeof b === "number" ? b : Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      break;
    }
    case "checkbox":
      return (a ? 1 : 0) - (b ? 1 : 0);
    case "date": {
      const ta = Date.parse(String(a));
      const tb = Date.parse(String(b));
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
      return String(a).localeCompare(String(b));
    }
    default:
      break;
  }

  // string fallback (also reached by non-numeric `number` cells)
  return formatCell(field, a).localeCompare(formatCell(field, b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
