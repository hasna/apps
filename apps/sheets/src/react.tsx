/**
 * `@hasna/sheets/react` — a `react-spreadsheet`-backed <Spreadsheet> editor
 * bound to the headless {@link Workbook} model. This is the primary UI consumer
 * surface; the core SDK (the package root) stays React-free.
 *
 * The grid displays live formula results (react-spreadsheet evaluates with the
 * same MIT `fast-formula-parser` engine), while every edit is written back into
 * a recalculated copy of the model and surfaced through `onWorkbookChange`.
 */
import * as React from "react";
import { Spreadsheet as RSpreadsheet } from "react-spreadsheet";
import type { CellBase, Matrix } from "react-spreadsheet";
import type { Sheet, Workbook } from "./types/index.js";
import { toA1 } from "./lib/a1.js";
import { recalc } from "./lib/recalc.js";
import { resolveSheet } from "./lib/workbook.js";

/** react-spreadsheet cell whose `value` holds the raw workbook input. */
export type SheetCell = CellBase<string>;

export interface SpreadsheetProps {
  /** The workbook model (source of truth). */
  workbook: Workbook;
  /** Which sheet to render (id or name). Defaults to the active sheet. */
  sheetId?: string;
  /** Called with a recalculated copy of the workbook after every edit. */
  onWorkbookChange?: (workbook: Workbook) => void;
  /** Rows to render (defaults to the sheet's row count). */
  rows?: number;
  /** Columns to render (defaults to the sheet's column count). */
  columns?: number;
  className?: string;
  darkMode?: boolean;
}

/** Project a sheet into a dense react-spreadsheet matrix of raw inputs. */
export function workbookSheetToMatrix(
  sheet: Sheet,
  rows: number,
  columns: number,
): Matrix<SheetCell> {
  const matrix: Matrix<SheetCell> = [];
  for (let r = 0; r < rows; r++) {
    const row: Array<SheetCell | undefined> = [];
    for (let c = 0; c < columns; c++) {
      const cell = sheet.cells[toA1({ row: r, col: c })];
      row.push(cell ? { value: cell.raw } : undefined);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Merge a react-spreadsheet matrix of raw inputs back into a sheet. Cells that
 * fall outside the rendered window (the matrix bounds) are preserved, so a grid
 * that renders fewer rows/columns than the sheet actually contains never drops
 * off-screen data.
 */
export function applyMatrixToSheet(sheet: Sheet, matrix: Matrix<SheetCell>): void {
  const cells: Sheet["cells"] = { ...sheet.cells };
  let maxCols = sheet.columns;
  matrix.forEach((row, r) => {
    if (!row) return;
    if (row.length > maxCols) maxCols = row.length;
    row.forEach((cell, c) => {
      const key = toA1({ row: r, col: c });
      const raw = cell?.value;
      if (raw !== undefined && raw !== null && String(raw) !== "") {
        cells[key] = { raw: String(raw), value: null };
      } else {
        // In-window but empty → the user cleared it.
        delete cells[key];
      }
    });
  });
  sheet.cells = cells;
  sheet.rows = Math.max(sheet.rows, matrix.length);
  sheet.columns = maxCols;
}

/**
 * Controlled spreadsheet editor. Renders the given sheet and emits a
 * recalculated workbook copy on every change.
 */
export function Spreadsheet(props: SpreadsheetProps): React.ReactElement {
  const { workbook, sheetId, onWorkbookChange, className, darkMode } = props;
  const sheet = resolveSheet(workbook, sheetId);
  const rows = props.rows ?? sheet.rows;
  const columns = props.columns ?? sheet.columns;

  const data = React.useMemo(
    () => workbookSheetToMatrix(sheet, rows, columns),
    [sheet, rows, columns],
  );

  const handleChange = React.useCallback(
    (matrix: Matrix<SheetCell>) => {
      if (!onWorkbookChange) return;
      const clone = JSON.parse(JSON.stringify(workbook)) as Workbook;
      const target = resolveSheet(clone, sheet.id);
      applyMatrixToSheet(target, matrix);
      recalc(clone);
      onWorkbookChange(clone);
    },
    [workbook, sheet.id, onWorkbookChange],
  );

  return (
    <RSpreadsheet
      data={data}
      onChange={handleChange}
      className={className}
      darkMode={darkMode}
    />
  );
}

export default Spreadsheet;
