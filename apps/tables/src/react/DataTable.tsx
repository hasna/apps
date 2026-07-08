/**
 * <DataTable> — a Glide-Data-Grid-backed, editable grid over a `@hasna/tables`
 * base. Renders a table's fields as typed columns and its (computed) records as
 * rows. Edits are written straight back into the in-memory model.
 *
 * NOTE: consumers must import Glide's stylesheet once in their app:
 *   import "@glideapps/glide-data-grid/dist/index.css";
 * and render a `<div id="portal" />` at the document root for overlay editors.
 */
import * as React from "react";
import {
  DataEditor,
  GridCellKind,
  type DataEditorProps,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type SizedGridColumn,
  type Item,
} from "@glideapps/glide-data-grid";
import type { TablesBase } from "../lib/base.js";
import type { ComputedRecord, Field } from "../types/index.js";
import { isComputedField } from "../lib/fields.js";
import { visibleFieldIds } from "../lib/views.js";
import { fieldToColumn, fromGridCell, toGridCell } from "./cell-mapping.js";

export interface DataTableProps {
  /** The in-memory base model. */
  model: TablesBase;
  /** Table id (or name) to render. */
  tableId: string;
  /** Optional view id/name to apply (filter/sort/group + column visibility). */
  viewId?: string;
  /** Called after any mutation (edit / add row) with the mutated model. */
  onChange?: (model: TablesBase) => void;
  /** Called when the user clicks the "+" add-column affordance. */
  onAddField?: () => void;
  /** Allow inline edits (default true). */
  editable?: boolean;
  /** Allow appending rows via the trailing row (default true). */
  canAddRows?: boolean;
  height?: number | string;
  width?: number | string;
  className?: string;
  /** Escape hatch for advanced Glide props. */
  gridProps?: Partial<DataEditorProps>;
}

export function DataTable(props: DataTableProps): React.ReactElement {
  const {
    model,
    tableId,
    viewId,
    onChange,
    onAddField,
    editable = true,
    canAddRows = true,
    height = "100%",
    width = "100%",
    className,
    gridProps,
  } = props;

  // Bumping `tick` forces the memoized selectors below to recompute after a
  // mutation to the (mutable) model.
  const [tick, setTick] = React.useState(0);
  const bump = React.useCallback(() => {
    setTick((n) => n + 1);
    onChange?.(model);
  }, [model, onChange]);

  const [widths, setWidths] = React.useState<Record<string, number>>({});

  const table = model.getTable(tableId);
  const view = viewId ? table.views.find((v) => v.id === viewId || v.name === viewId) : undefined;
  const viewKey = view?.id;

  const fields: Field[] = React.useMemo(() => {
    const t = model.getTable(tableId);
    const v = viewKey ? t.views.find((x) => x.id === viewKey) : undefined;
    const ids = v ? visibleFieldIds(t, v) : t.fields.map((f) => f.id);
    return ids
      .map((id) => t.fields.find((f) => f.id === id))
      .filter((f): f is Field => Boolean(f));
  }, [model, tableId, viewKey, tick]);

  const records: ComputedRecord[] = React.useMemo(() => {
    if (viewKey) return model.queryView(tableId, viewKey).records;
    return model.computeRecords(tableId);
  }, [model, tableId, viewKey, tick]);

  const columns: SizedGridColumn[] = React.useMemo(
    () => fields.map((f) => {
      const col = fieldToColumn(f);
      return { ...col, width: widths[f.id] ?? col.width };
    }),
    [fields, widths],
  );

  const getCellContent = React.useCallback(
    ([col, row]: Item): GridCell => {
      const field = fields[col];
      const record = records[row];
      if (!field || !record) {
        return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      }
      return toGridCell(field, record.computed[field.id] ?? null);
    },
    [fields, records],
  );

  const onCellEdited = React.useCallback(
    ([col, row]: Item, newValue: EditableGridCell): void => {
      if (!editable) return;
      const field = fields[col];
      const record = records[row];
      if (!field || !record || isComputedField(field)) return;
      model.updateRecord(tableId, record.id, { [field.id]: fromGridCell(field, newValue) });
      bump();
    },
    [editable, fields, records, model, tableId, bump],
  );

  const onRowAppended = React.useCallback((): void => {
    if (!canAddRows) return;
    model.createRecord(tableId, {});
    bump();
  }, [canAddRows, model, tableId, bump]);

  const onColumnResize = React.useCallback((column: GridColumn, newSize: number): void => {
    if (!column.id) return;
    const id = column.id;
    setWidths((prev) => ({ ...prev, [id]: newSize }));
  }, []);

  return (
    <div className={className} style={{ width, height }}>
      <DataEditor
        columns={columns}
        rows={records.length}
        getCellContent={getCellContent}
        onCellEdited={editable ? onCellEdited : undefined}
        onColumnResize={onColumnResize}
        rowMarkers="number"
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        onRowAppended={canAddRows ? onRowAppended : undefined}
        trailingRowOptions={canAddRows ? { sticky: true, tint: true, hint: "New record" } : undefined}
        rightElement={
          onAddField ? (
            <button
              type="button"
              onClick={onAddField}
              style={{
                height: "100%",
                padding: "0 16px",
                border: "none",
                borderLeft: "1px solid var(--gdg-border-color, #e1e1e1)",
                background: "var(--gdg-bg-header, #f7f7f8)",
                cursor: "pointer",
                fontSize: 16,
              }}
              aria-label="Add field"
            >
              +
            </button>
          ) : undefined
        }
        rightElementProps={{ fill: false, sticky: false }}
        {...gridProps}
      />
    </div>
  );
}
