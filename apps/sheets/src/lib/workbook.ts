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
import {
  assertBatchSize,
  assertCellContent,
  assertFormulaLength,
  assertPopulatedCells,
  assertRangeCells,
  assertSheetDimensions,
  type LimitOptions,
  resolveLimits,
  type SheetsLimits,
} from "./limits.js";
import { isFormula, parseLiteral, recalc } from "./recalc.js";

const DEFAULT_ROWS = 100;
const DEFAULT_COLUMNS = 26;

/** Count non-empty cells across every sheet in the workbook. */
function countPopulatedCells(workbook: Workbook): number {
  let total = 0;
  for (const sheet of workbook.sheets) total += Object.keys(sheet.cells).length;
  return total;
}

/** Enforce the per-cell content caps (formula length or literal length). */
function assertCellRaw(raw: string, limits: SheetsLimits): void {
  if (isFormula(raw)) {
    assertFormulaLength(raw.trim().slice(1), limits);
  } else {
    assertCellContent(raw, limits);
  }
}

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

interface SetCellOptions extends LimitOptions {
  sheet?: string;
  /** Recalculate after the write. Defaults to true. */
  recalc?: boolean;
  /**
   * Internal: skip the aggregate populated-cell recount. {@link setCells} sets
   * it after doing one combined check up front, so a large batch stays O(N)
   * instead of recounting the whole workbook on every cell.
   */
  skipAggregateChecks?: boolean;
}

/**
 * Set a cell's raw input by A1 reference. An empty string clears the cell.
 * The sheet auto-grows to include the addressed cell.
 *
 * @throws {SheetsLimitError} when the value, sheet dimensions, or populated
 * cell count would exceed a limit.
 */
export function setCell(
  workbook: Workbook,
  a1: string,
  raw: string,
  options: SetCellOptions = {},
): Workbook {
  const limits = resolveLimits(options.limits);
  const sheet = resolveSheet(workbook, options.sheet);
  const coord = parseA1(a1);
  const key = toA1(coord);

  if (raw !== "") {
    // Bound the value before it is stored (source cap for the parse/output bombs).
    assertCellRaw(raw, limits);
    // Cap sheet auto-grow so a single addressed cell cannot declare absurd dims.
    const nextRows = Math.max(sheet.rows, coord.row + 1);
    const nextColumns = Math.max(sheet.columns, coord.col + 1);
    assertSheetDimensions(nextRows, nextColumns, limits);
    // Incrementally bound the populated-cell count when a NEW key is added.
    if (!options.skipAggregateChecks && !(key in sheet.cells)) {
      assertPopulatedCells(countPopulatedCells(workbook) + 1, limits);
    }
    sheet.rows = nextRows;
    sheet.columns = nextColumns;
    sheet.cells[key] = {
      raw,
      value: isFormula(raw) ? null : parseLiteral(raw),
    };
  } else {
    delete sheet.cells[key];
  }

  if (options.recalc === false) {
    workbook.updatedAt = new Date().toISOString();
    return workbook;
  }
  return recalc(workbook, { limits: options.limits });
}

/**
 * Set many cells on a sheet in one batch, recalculating once at the end.
 *
 * @throws {SheetsLimitError} when the batch is larger than
 * {@link SheetsLimits.maxCellsPerWrite} or would push the workbook past
 * {@link SheetsLimits.maxPopulatedCells}.
 */
export function setCells(
  workbook: Workbook,
  entries: Record<string, string> | Array<[string, string]>,
  sheetRef?: string,
  options: LimitOptions = {},
): Workbook {
  const limits = resolveLimits(options.limits);
  const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
  assertBatchSize(pairs.length, limits);

  // Bound the resulting populated-cell count before mutating: count only the
  // distinct NEW keys this batch introduces on the target sheet, so a large
  // batch is checked once (O(N)) instead of recounting on every cell.
  const sheet = resolveSheet(workbook, sheetRef);
  const newKeys = new Set<string>();
  for (const [a1, raw] of pairs) {
    if (raw === "") continue;
    const key = toA1(parseA1(a1));
    if (!(key in sheet.cells)) newKeys.add(key);
  }
  assertPopulatedCells(countPopulatedCells(workbook) + newKeys.size, limits);

  for (const [a1, raw] of pairs) {
    setCell(workbook, a1, raw, {
      sheet: sheetRef,
      recalc: false,
      limits: options.limits,
      skipAggregateChecks: true,
    });
  }
  return recalc(workbook, { limits: options.limits });
}

/** Clear a cell (equivalent to setting an empty raw). */
export function clearCell(workbook: Workbook, a1: string, sheetRef?: string): Workbook {
  return setCell(workbook, a1, "", { sheet: sheetRef });
}

/**
 * Get the computed values of a rectangular range like "A1:C3". The requested
 * range is clamped to the sheet grid before materialization, then bounded by
 * {@link SheetsLimits.maxRangeCells}.
 *
 * @throws {SheetsLimitError} when the clamped range still exceeds
 * {@link SheetsLimits.maxRangeCells}.
 */
export function getRangeValues(
  workbook: Workbook,
  range: string,
  sheetRef?: string,
  options: LimitOptions = {},
): CellValue[][] {
  const limits = resolveLimits(options.limits);
  const sheet = resolveSheet(workbook, sheetRef);
  const parsed = parseRange(range);
  // Clamp to the grid so an oversized A1:A2000000 request cannot materialize
  // rows that do not exist (the read-path amplification bug).
  const startRow = Math.max(0, parsed.start.row);
  const startCol = Math.max(0, parsed.start.col);
  const endRow = Math.min(parsed.end.row, sheet.rows - 1);
  const endCol = Math.min(parsed.end.col, sheet.columns - 1);
  if (endRow < startRow || endCol < startCol) return [];
  const cellCount = (endRow - startRow + 1) * (endCol - startCol + 1);
  assertRangeCells(cellCount, limits);
  const grid: CellValue[][] = [];
  for (let row = startRow; row <= endRow; row++) {
    const rowValues: CellValue[] = [];
    for (let col = startCol; col <= endCol; col++) {
      rowValues.push(sheet.cells[toA1({ row, col })]?.value ?? null);
    }
    grid.push(rowValues);
  }
  return grid;
}

/** Enumerate all non-empty coordinates of a range (utility re-export). */
export { expandRange };
