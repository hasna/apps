/**
 * JSON serialization + structural validation for workbooks. Loading a document
 * always runs a {@link recalc} so computed values are consistent with the raw
 * inputs regardless of what was persisted.
 */
import type { Cell, CellValue, Sheet, Workbook, WorkbookDocument } from "../types/index.js";
import {
  assertCellContent,
  assertFormulaLength,
  assertPopulatedCells,
  assertSheetDimensions,
  type LimitOptions,
  resolveLimits,
  type SheetsLimits,
} from "./limits.js";
import { isFormula, recalc } from "./recalc.js";

export const WORKBOOK_SCHEMA = "hasna.sheets.workbook";
export const WORKBOOK_VERSION = 1 as const;

/** Wrap a workbook in the versioned document envelope. */
export function toDocument(workbook: Workbook): WorkbookDocument {
  return { schema: WORKBOOK_SCHEMA, version: WORKBOOK_VERSION, workbook };
}

/** Serialize a workbook to a JSON string (optionally pretty-printed). */
export function serializeWorkbook(workbook: Workbook, pretty = false): string {
  return JSON.stringify(toDocument(workbook), null, pretty ? 2 : undefined);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid workbook: ${message}`);
}

function validateCell(value: unknown, a1: string, limits: SheetsLimits): Cell {
  assert(typeof value === "object" && value !== null, `cell ${a1} is not an object`);
  const raw = (value as { raw?: unknown }).raw;
  assert(typeof raw === "string", `cell ${a1} missing raw`);
  // Source-side length caps on the load path, before recalc ever parses.
  if (isFormula(raw)) {
    assertFormulaLength(raw.trim().slice(1), limits);
  } else {
    assertCellContent(raw, limits);
  }
  const rawValue = (value as { value?: unknown }).value;
  const cellValue = rawValue as CellValue;
  const cell: Cell = { raw, value: cellValue ?? null };
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") cell.error = error;
  return cell;
}

function validateSheet(value: unknown, index: number, limits: SheetsLimits): Sheet {
  assert(typeof value === "object" && value !== null, `sheet ${index} is not an object`);
  const s = value as Record<string, unknown>;
  assert(typeof s.id === "string", `sheet ${index} missing id`);
  assert(typeof s.name === "string", `sheet ${index} missing name`);
  const rows = typeof s.rows === "number" ? s.rows : 100;
  const columns = typeof s.columns === "number" ? s.columns : 26;
  // Reject absurd declared dimensions that would defeat the onRange clamp.
  assertSheetDimensions(rows, columns, limits);
  const cells: Record<string, Cell> = {};
  const rawCells = s.cells;
  if (rawCells && typeof rawCells === "object") {
    for (const [a1, cell] of Object.entries(rawCells as Record<string, unknown>)) {
      cells[a1.toUpperCase()] = validateCell(cell, a1, limits);
    }
  }
  return { id: s.id as string, name: s.name as string, rows, columns, cells };
}

/** Validate an unknown value as a {@link Workbook}, throwing on malformed input. */
export function validateWorkbook(value: unknown, options: LimitOptions = {}): Workbook {
  const limits = resolveLimits(options.limits);
  assert(typeof value === "object" && value !== null, "not an object");
  const wb = value as Record<string, unknown>;
  assert(Array.isArray(wb.sheets), "missing sheets array");
  const rawSheets = wb.sheets as unknown[];
  assert(rawSheets.length > 0, "workbook has no sheets");
  const sheets = rawSheets.map((s, i) => validateSheet(s, i, limits));
  // Aggregate populated-cell gate across every sheet.
  let populated = 0;
  for (const sheet of sheets) populated += Object.keys(sheet.cells).length;
  assertPopulatedCells(populated, limits);
  const first = sheets[0];
  assert(first !== undefined, "workbook has no sheets");
  const now = new Date().toISOString();
  const activeSheetId =
    typeof wb.activeSheetId === "string" && sheets.some((s) => s.id === wb.activeSheetId)
      ? wb.activeSheetId
      : first.id;
  return {
    id: typeof wb.id === "string" ? wb.id : "workbook",
    sheets,
    activeSheetId,
    createdAt: typeof wb.createdAt === "string" ? wb.createdAt : now,
    updatedAt: typeof wb.updatedAt === "string" ? wb.updatedAt : now,
  };
}

/** Parse a JSON string or object (document or bare workbook) into a workbook. */
export function deserializeWorkbook(
  input: string | WorkbookDocument | Workbook,
  options: LimitOptions = {},
): Workbook {
  const raw: unknown = typeof input === "string" ? JSON.parse(input) : input;
  const candidate =
    raw && typeof raw === "object" && "workbook" in raw
      ? (raw as { workbook: unknown }).workbook
      : raw;
  return recalc(validateWorkbook(candidate, options), { limits: options.limits });
}

/** Load a workbook from a serialized document or bare workbook (SDK entry point). */
export function loadWorkbook(
  input: string | WorkbookDocument | Workbook,
  options: LimitOptions = {},
): Workbook {
  return deserializeWorkbook(input, options);
}
