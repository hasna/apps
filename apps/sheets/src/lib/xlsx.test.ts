import { describe, expect, test } from "bun:test";
import { workbookToXlsx, xlsxToWorkbook } from "./xlsx.js";
import { createWorkbook, getCellValue, setCells } from "./workbook.js";

describe("xlsx round trip", () => {
  test("export then import preserves literals and formulas", async () => {
    const wb = createWorkbook({ sheetName: "Numbers" });
    setCells(wb, { A1: "5", A2: "10", A3: "=SUM(A1:A2)", B1: "hello" });

    const bytes = await workbookToXlsx(wb);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const restored = await xlsxToWorkbook(bytes);
    expect(restored.sheets[0]?.name).toBe("Numbers");
    expect(getCellValue(restored, "A1")).toBe(5);
    expect(getCellValue(restored, "A3")).toBe(15);
    expect(getCellValue(restored, "B1")).toBe("hello");
    expect(restored.sheets[0]?.cells.A3?.raw).toBe("=SUM(A1:A2)");
  });
});
