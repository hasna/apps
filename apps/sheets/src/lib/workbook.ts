/**
 * Workbook / sheet / cell operations over the headless model. All functions
 * mutate and return the workbook so callers can chain; cell writes trigger a
 * {@link recalc} by default.
 */
import { nanoid } from "nanoid";
import type {
  AddSheetOptions,
  Cell,
  CellValue,
  CreateWorkbookOptions,
  Sheet,
  Workbook,
} from "../types/index.js";
import { expandRange, parseA1, parseRange, toA1 } from "./a1.js";
import { isFormula, parseLiteral, recalc } from "./recalc.js";

const DEFAULT_ROWS = 100;
const DEFAULT_COLUMNS = 26;

/** Create a new, empty workbook with a single sheet. */
export function createWorkbook(options: CreateWorkbookOptions = {}): Workbook {
  const now = new Date().toISOString();
  const sheetId = nanoid();
  const sheet: Sheet = {
    id: sheetId,
    name: options.sheetName ?? "Sheet1",
    rows: options.rows ?? DEFAULT_ROWS,
    columns: options.columns ?? DEFAULT_COLUMNS,
    cells: {},
  };
  return {
    id: options.id ?? nanoid(),
    sheets: [sheet],
    activeSheetId: sheetId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Resolve a sheet by id or name; defaults to the active sheet when omitted. */
export function resolveSheet(workbook: Workbook, ref?: string): Sheet {
  if (ref === undefined) {
    const active = workbook.sheets.find((s) => s.id === workbook.activeSheetId);
    if (active) return active;
    const first = workbook.sheets[0];
    if (!first) throw new Error("Workbook has no sheets");
    return first;
  }
  const found = workbook.sheets.find((s) => s.id === ref || s.name === ref);
  if (!found) throw new Error(`Sheet not found: ${ref}`);
  return found;
}

function uniqueSheetName(workbook: Workbook): string {
  for (let i = workbook.sheets.length + 1; ; i++) {
    const candidate = `Sheet${i}`;
    if (!workbook.sheets.some((s) => s.name === candidate)) return candidate;
  }
}

/** Append a new sheet to the workbook. */
export function addSheet(workbook: Workbook, options: AddSheetOptions = {}): Sheet {
  const id = options.id ?? nanoid();
  const name = options.name ?? uniqueSheetName(workbook);
  if (workbook.sheets.some((s) => s.name === name)) {
    throw new Error(`Sheet name already exists: ${name}`);
  }
  const sheet: Sheet = {
    id,
    name,
    rows: options.rows ?? DEFAULT_ROWS,
    columns: options.columns ?? DEFAULT_COLUMNS,
    cells: {},
  };
  workbook.sheets.push(sheet);
  if (options.activate) workbook.activeSheetId = id;
  workbook.updatedAt = new Date().toISOString();
  return sheet;
}

/** Rename a sheet. Recalculates so cross-sheet references are re-resolved. */
export function renameSheet(workbook: Workbook, ref: string, name: string): Workbook {
  const sheet = resolveSheet(workbook, ref);
  if (sheet.name === name) return workbook;
  if (workbook.sheets.some((s) => s.name === name)) {
    throw new Error(`Sheet name already exists: ${name}`);
  }
  sheet.name = name;
  return recalc(workbook);
}

/** Remove a sheet by id or name. The last remaining sheet cannot be removed. */
export function removeSheet(workbook: Workbook, ref: string): Workbook {
  if (workbook.sheets.length <= 1) {
    throw new Error("Cannot remove the last sheet");
  }
  const sheet = resolveSheet(workbook, ref);
  workbook.sheets = workbook.sheets.filter((s) => s.id !== sheet.id);
  if (workbook.activeSheetId === sheet.id) {
    const first = workbook.sheets[0];
    if (first) workbook.activeSheetId = first.id;
  }
  return recalc(workbook);
}

/** Set the active sheet. */
export function setActiveSheet(workbook: Workbook, ref: string): Workbook {
  const sheet = resolveSheet(workbook, ref);
  workbook.activeSheetId = sheet.id;
  workbook.updatedAt = new Date().toISOString();
  return workbook;
}

/** Get a cell by A1 reference (case-insensitive), or undefined if empty. */
export function getCell(workbook: Workbook, a1: string, sheetRef?: string): Cell | undefined {
  const sheet = resolveSheet(workbook, sheetRef);
  return sheet.cells[toA1(parseA1(a1))];
}

/** Get a cell's computed value, or null if empty. */
export function getCellValue(workbook: Workbook, a1: string, sheetRef?: string): CellValue {
  return getCell(workbook, a1, sheetRef)?.value ?? null;
}

interface SetCellOptions {
  sheet?: string;
  /** Recalculate after the write. Defaults to true. */
  recalc?: boolean;
}

/**
 * Set a cell's raw input by A1 reference. An empty string clears the cell.
 * The sheet auto-grows to include the addressed cell.
 */
export function setCell(
  workbook: Workbook,
  a1: string,
  raw: string,
  options: SetCellOptions = {},
): Workbook {
  const sheet = resolveSheet(workbook, options.sheet);
  const coord = parseA1(a1);
  const key = toA1(coord);
  sheet.rows = Math.max(sheet.rows, coord.row + 1);
  sheet.columns = Math.max(sheet.columns, coord.col + 1);

  if (raw === "") {
    delete sheet.cells[key];
  } else {
    sheet.cells[key] = {
      raw,
      value: isFormula(raw) ? null : parseLiteral(raw),
    };
  }

  if (options.recalc === false) {
    workbook.updatedAt = new Date().toISOString();
    return workbook;
  }
  return recalc(workbook);
}

/** Set many cells on a sheet in one batch, recalculating once at the end. */
export function setCells(
  workbook: Workbook,
  entries: Record<string, string> | Array<[string, string]>,
  sheetRef?: string,
): Workbook {
  const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
  for (const [a1, raw] of pairs) {
    setCell(workbook, a1, raw, { sheet: sheetRef, recalc: false });
  }
  return recalc(workbook);
}

/** Clear a cell (equivalent to setting an empty raw). */
export function clearCell(workbook: Workbook, a1: string, sheetRef?: string): Workbook {
  return setCell(workbook, a1, "", { sheet: sheetRef });
}

/** Get the computed values of a rectangular range like "A1:C3". */
export function getRangeValues(
  workbook: Workbook,
  range: string,
  sheetRef?: string,
): CellValue[][] {
  const sheet = resolveSheet(workbook, sheetRef);
  const parsed = parseRange(range);
  const grid: CellValue[][] = [];
  for (let row = parsed.start.row; row <= parsed.end.row; row++) {
    const rowValues: CellValue[] = [];
    for (let col = parsed.start.col; col <= parsed.end.col; col++) {
      rowValues.push(sheet.cells[toA1({ row, col })]?.value ?? null);
    }
    grid.push(rowValues);
  }
  return grid;
}

/** Enumerate all non-empty coordinates of a range (utility re-export). */
export { expandRange };
