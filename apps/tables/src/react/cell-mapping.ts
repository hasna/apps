/**
 * Maps `@hasna/tables` typed fields and cell values to/from
 * Glide Data Grid cells.
 */
import {
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type SizedGridColumn,
} from "@glideapps/glide-data-grid";
import type { CellValue, Field } from "../types/index.js";
import { formatCell, isComputedField } from "../lib/fields.js";

/** Estimated pixel width per field type. */
function defaultWidth(field: Field): number {
  switch (field.type) {
    case "checkbox":
      return 90;
    case "number":
      return 120;
    case "multiSelect":
    case "link":
      return 200;
    default:
      return 180;
  }
}

/** Build a Glide column descriptor from a field. */
export function fieldToColumn(field: Field): SizedGridColumn {
  return {
    id: field.id,
    title: field.name,
    width: defaultWidth(field),
  };
}

/** Convert a stored/computed cell value into a Glide grid cell. */
export function toGridCell(field: Field, value: CellValue): GridCell {
  const readonly = isComputedField(field);

  switch (field.type) {
    case "number": {
      const num = typeof value === "number" ? value : undefined;
      return {
        kind: GridCellKind.Number,
        data: num,
        displayData: formatCell(field, value),
        allowOverlay: !readonly,
        readonly,
      };
    }
    case "checkbox":
      return {
        kind: GridCellKind.Boolean,
        data: Boolean(value),
        allowOverlay: false,
        readonly,
      };
    case "multiSelect":
    case "link":
      return {
        kind: GridCellKind.Bubble,
        data: Array.isArray(value) ? value.map(String) : [],
        allowOverlay: !readonly,
      };
    default: {
      const text = value === null || value === undefined ? "" : String(value);
      return {
        kind: GridCellKind.Text,
        data: readonly ? formatCell(field, value) : text,
        displayData: formatCell(field, value),
        allowOverlay: !readonly,
        readonly,
      };
    }
  }
}

/**
 * Extract the new cell value from a Glide edit event for a field.
 * (Bubble cells — multiSelect/link — are display-only in this basic mapping.)
 */
export function fromGridCell(field: Field, cell: EditableGridCell): CellValue {
  switch (cell.kind) {
    case GridCellKind.Number:
      return typeof cell.data === "number" ? cell.data : null;
    case GridCellKind.Boolean:
      return Boolean(cell.data);
    case GridCellKind.Text:
    case GridCellKind.Uri:
      return cell.data;
    default:
      return field.type === "number" ? null : "";
  }
}
