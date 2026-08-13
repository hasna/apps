import { describe, expect, test } from "bun:test";
import {
  addSheet,
  clearCell,
  createWorkbook,
  getCell,
  getCellValue,
  getRangeValues,
  removeSheet,
  renameSheet,
  setActiveSheet,
  setCell,
  setCells,
} from "./workbook.js";

describe("createWorkbook", () => {
  test("defaults", () => {
    const wb = createWorkbook();
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]?.name).toBe("Sheet1");
    expect(wb.sheets[0]?.rows).toBe(100);
    expect(wb.sheets[0]?.columns).toBe(26);
    expect(wb.activeSheetId).toBe(wb.sheets[0]?.id ?? "");
  });

  test("custom options", () => {
    const wb = createWorkbook({ sheetName: "Budget", rows: 10, columns: 5 });
    expect(wb.sheets[0]?.name).toBe("Budget");
    expect(wb.sheets[0]?.rows).toBe(10);
  });
});

describe("cell operations", () => {
  test("set and get", () => {
    const wb = createWorkbook();
    setCell(wb, "A1", "hello");
    expect(getCellValue(wb, "A1")).toBe("hello");
    expect(getCell(wb, "a1")?.raw).toBe("hello");
  });

  test("clearCell removes the cell", () => {
    const wb = createWorkbook();
    setCell(wb, "A1", "x");
    clearCell(wb, "A1");
    expect(getCell(wb, "A1")).toBeUndefined();
    expect(getCellValue(wb, "A1")).toBeNull();
  });

  test("auto-grows sheet dimensions", () => {
    const wb = createWorkbook({ rows: 5, columns: 3 });
    setCell(wb, "H20", "1");
    expect(wb.sheets[0]?.rows).toBeGreaterThanOrEqual(20);
    expect(wb.sheets[0]?.columns).toBeGreaterThanOrEqual(8);
  });

  test("getRangeValues", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "1", B1: "2", A2: "3", B2: "=A2*2" });
    expect(getRangeValues(wb, "A1:B2")).toEqual([
      [1, 2],
      [3, 6],
    ]);
  });
});

describe("sheet management", () => {
  test("addSheet with auto name", () => {
    const wb = createWorkbook();
    const s = addSheet(wb);
    expect(s.name).toBe("Sheet2");
    expect(wb.sheets).toHaveLength(2);
  });

  test("addSheet activate", () => {
    const wb = createWorkbook();
    const s = addSheet(wb, { name: "Two", activate: true });
    expect(wb.activeSheetId).toBe(s.id);
  });

  test("duplicate name rejected", () => {
    const wb = createWorkbook();
    expect(() => addSheet(wb, { name: "Sheet1" })).toThrow();
  });

  test("renameSheet", () => {
    const wb = createWorkbook();
    renameSheet(wb, "Sheet1", "Renamed");
    expect(wb.sheets[0]?.name).toBe("Renamed");
  });

  test("removeSheet keeps at least one", () => {
    const wb = createWorkbook();
    addSheet(wb, { name: "Two" });
    removeSheet(wb, "Two");
    expect(wb.sheets).toHaveLength(1);
    expect(() => removeSheet(wb, "Sheet1")).toThrow();
  });

  test("setActiveSheet", () => {
    const wb = createWorkbook();
    const s = addSheet(wb, { name: "Two" });
    setActiveSheet(wb, "Two");
    expect(wb.activeSheetId).toBe(s.id);
  });

  test("unknown sheet throws", () => {
    const wb = createWorkbook();
    expect(() => setCell(wb, "A1", "x", { sheet: "Nope" })).toThrow();
  });
});
