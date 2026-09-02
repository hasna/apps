/**
 * Optional XLSX import/export via `exceljs` (MIT). `exceljs` is an optional peer
 * dependency and is imported lazily, so the core SDK stays lightweight for
 * consumers that never touch spreadsheets on disk.
 */
import type { Workbook } from "../types/index.js";
import { parseA1, toA1 } from "./a1.js";
import { addSheet, createWorkbook, setCells } from "./workbook.js";
import { isFormula } from "./recalc.js";

type ExcelJSModule = typeof import("exceljs");

async function loadExcelJS(): Promise<ExcelJSModule> {
  try {
    const imported = await import("exceljs");
    // Bun exposes CommonJS named exports; Node exposes ExcelJS under default.
    return typeof imported.Workbook === "function" ? imported : imported.default;
  } catch {
    throw new Error(
      "XLSX support requires the optional 'exceljs' dependency. Install it with: bun add exceljs",
    );
  }
}

function excelValueToRaw(value: unknown, formula: string | undefined): string {
  if (formula) return `=${formula}`;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.formula === "string") return `=${obj.formula}`;
    if ("result" in obj) return obj.result === null || obj.result === undefined ? "" : String(obj.result);
    if (typeof obj.text === "string") return obj.text;
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((t) => String((t as { text?: unknown }).text ?? "")).join("");
    }
    if ("error" in obj) return String(obj.error);
  }
  return "";
}

/** Parse an .xlsx buffer into a workbook (async — lazily loads exceljs). */
export async function xlsxToWorkbook(data: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const ExcelJS = await loadExcelJS();
  const source = new ExcelJS.Workbook();
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
  await source.xlsx.load(buffer as unknown as Parameters<typeof source.xlsx.load>[0]);

  const worksheets = source.worksheets;
  const first = worksheets[0];
  const workbook = createWorkbook({ sheetName: first ? first.name : "Sheet1" });

  worksheets.forEach((ws, index) => {
    const sheet = index === 0 ? workbook.sheets[0] : addSheet(workbook, { name: uniqueName(workbook, ws.name) });
    if (!sheet) return;
    const entries: Array<[string, string]> = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const raw = excelValueToRaw(cell.value, cell.formula);
        if (raw !== "") {
          entries.push([toA1({ row: rowNumber - 1, col: colNumber - 1 }), raw]);
        }
      });
    });
    setCells(workbook, entries, sheet.id);
  });

  return workbook;
}

/** Serialize a workbook to an .xlsx byte buffer (async — lazily loads exceljs). */
export async function workbookToXlsx(workbook: Workbook): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();
  const out = new ExcelJS.Workbook();
  for (const sheet of workbook.sheets) {
    const ws = out.addWorksheet(sheet.name);
    for (const [a1, cell] of Object.entries(sheet.cells)) {
      const coord = parseA1(a1);
      const target = ws.getCell(coord.row + 1, coord.col + 1);
      if (isFormula(cell.raw)) {
        target.value = {
          formula: cell.raw.trim().slice(1),
          result: cell.value === null ? undefined : cell.value,
        };
      } else {
        target.value = cell.value;
      }
    }
  }
  const buffer = await out.xlsx.writeBuffer();
  return new Uint8Array(buffer as unknown as ArrayBuffer);
}

/** Ensure a sheet name is unique within the workbook. */
function uniqueName(workbook: Workbook, name: string): string {
  if (!workbook.sheets.some((s) => s.name === name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!workbook.sheets.some((s) => s.name === candidate)) return candidate;
  }
}
