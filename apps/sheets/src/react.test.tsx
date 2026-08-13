import { describe, expect, test } from "bun:test";
import { applyMatrixToSheet, workbookSheetToMatrix } from "./react.js";
import { createWorkbook, setCells } from "./lib/workbook.js";
import { recalc } from "./lib/recalc.js";

function firstSheet(wb: ReturnType<typeof createWorkbook>) {
  const sheet = wb.sheets[0];
  if (!sheet) throw new Error("no sheet");
  return sheet;
}

describe("react model bridge", () => {
  test("workbookSheetToMatrix projects raw inputs", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "1", B1: "=A1+1" });
    const matrix = workbookSheetToMatrix(firstSheet(wb), 2, 2);
    expect(matrix[0]?.[0]?.value).toBe("1");
    expect(matrix[0]?.[1]?.value).toBe("=A1+1");
    expect(matrix[1]?.[0]).toBeUndefined();
  });

  test("applyMatrixToSheet preserves off-window cells", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "1", A50: "off-window" });
    const sheet = firstSheet(wb);
    const matrix = workbookSheetToMatrix(sheet, 3, 3);
    const row = matrix[0];
    if (row) row[0] = { value: "99" };
    applyMatrixToSheet(sheet, matrix);
    recalc(wb);
    expect(sheet.cells.A1?.value).toBe(99);
    expect(sheet.cells.A50?.value).toBe("off-window");
  });

  test("applyMatrixToSheet clears emptied in-window cells", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "1", B1: "2" });
    const sheet = firstSheet(wb);
    const matrix = workbookSheetToMatrix(sheet, 2, 2);
    const row = matrix[0];
    if (row) row[0] = { value: "" };
    applyMatrixToSheet(sheet, matrix);
    expect(sheet.cells.A1).toBeUndefined();
    expect(sheet.cells.B1?.raw).toBe("2");
  });
});
