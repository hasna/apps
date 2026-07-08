/**
 * CSV import/export. Import treats each field as raw input, so `=A1+B1`
 * imported from a CSV becomes a live formula and numeric text becomes numbers
 * after recalculation. Export writes computed values by default.
 */
import type { CellValue, Sheet, Workbook } from "../types/index.js";
import { parseA1, toA1 } from "./a1.js";
import { createWorkbook, setCells } from "./workbook.js";

/** Parse CSV text into a 2D array of raw string fields (RFC-4180 quoting). */
export function parseCsv(text: string, delimiter = ","): string[][] {
  if (text === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // ignore; handled by \n
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function escapeField(value: string, delimiter: string): string {
  if (
    value.includes('"') ||
    value.includes(delimiter) ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize a 2D array of values into CSV text. */
export function toCsv(rows: CellValue[][], delimiter = ","): string {
  return rows
    .map((row) =>
      row.map((v) => escapeField(v === null || v === undefined ? "" : String(v), delimiter)).join(delimiter),
    )
    .join("\n");
}

/** Export a single sheet to CSV. Set `raw: true` to export formulas verbatim. */
export function sheetToCsv(sheet: Sheet, options: { raw?: boolean; delimiter?: string } = {}): string {
  let maxRow = -1;
  let maxCol = -1;
  for (const key of Object.keys(sheet.cells)) {
    const coord = parseA1(key);
    if (coord.row > maxRow) maxRow = coord.row;
    if (coord.col > maxCol) maxCol = coord.col;
  }
  if (maxRow < 0) return "";
  const rows: CellValue[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const rowValues: CellValue[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = sheet.cells[toA1({ row: r, col: c })];
      rowValues.push(cell ? (options.raw ? cell.raw : cell.value) : null);
    }
    rows.push(rowValues);
  }
  return toCsv(rows, options.delimiter ?? ",");
}

/** Build a new workbook from CSV text. */
export function csvToWorkbook(
  text: string,
  options: { sheetName?: string; delimiter?: string } = {},
): Workbook {
  const workbook = createWorkbook({ sheetName: options.sheetName ?? "Sheet1" });
  const sheet = workbook.sheets[0];
  if (!sheet) throw new Error("Workbook has no sheets");
  const rows = parseCsv(text, options.delimiter ?? ",");
  const entries: Array<[string, string]> = [];
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== "") entries.push([toA1({ row: r, col: c }), value]);
    });
  });
  setCells(workbook, entries, sheet.id);
  return workbook;
}

/** Import CSV text into an existing workbook as a new sheet's cells. */
export { csvToWorkbook as importCsv };
