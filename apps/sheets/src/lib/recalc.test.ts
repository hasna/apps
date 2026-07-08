import { describe, expect, test } from "bun:test";
import { isFormula, parseLiteral, recalc } from "./recalc.js";
import { addSheet, createWorkbook, getCellValue, setCell, setCells } from "./workbook.js";

describe("literal parsing", () => {
  test("isFormula", () => {
    expect(isFormula("=A1")).toBe(true);
    expect(isFormula("  =A1")).toBe(true);
    expect(isFormula("42")).toBe(false);
  });

  test("parseLiteral", () => {
    expect(parseLiteral("42")).toBe(42);
    expect(parseLiteral("-3.5")).toBe(-3.5);
    expect(parseLiteral("1e3")).toBe(1000);
    expect(parseLiteral("true")).toBe(true);
    expect(parseLiteral("FALSE")).toBe(false);
    expect(parseLiteral("hello")).toBe("hello");
    expect(parseLiteral("")).toBeNull();
  });
});

describe("recalc engine", () => {
  test("SUM over a range", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "5", A2: "10", A3: "15", B1: "=SUM(A1:A3)" });
    expect(getCellValue(wb, "B1")).toBe(30);
  });

  test("arithmetic across cells", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "6", B1: "7", C1: "=A1*B1" });
    expect(getCellValue(wb, "C1")).toBe(42);
  });

  test("chained dependencies evaluate in order", () => {
    const wb = createWorkbook();
    // D1 depends on C1 depends on A1+B1 — written out of order on purpose.
    setCells(wb, { D1: "=C1*2", C1: "=A1+B1", A1: "3", B1: "4" });
    expect(getCellValue(wb, "C1")).toBe(7);
    expect(getCellValue(wb, "D1")).toBe(14);
  });

  test("updating an upstream cell propagates", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "1", B1: "=A1+10" });
    expect(getCellValue(wb, "B1")).toBe(11);
    setCell(wb, "A1", "5");
    expect(getCellValue(wb, "B1")).toBe(15);
  });

  test("cross-sheet references", () => {
    const wb = createWorkbook({ sheetName: "Main" });
    const second = addSheet(wb, { name: "Data" });
    setCell(wb, "A1", "100", { sheet: second.id });
    setCell(wb, "A1", "=Data!A1+1", { sheet: "Main" });
    expect(getCellValue(wb, "A1", "Main")).toBe(101);
  });

  test("division by zero yields #DIV/0!", () => {
    const wb = createWorkbook();
    setCell(wb, "A1", "=1/0");
    expect(getCellValue(wb, "A1")).toBe("#DIV/0!");
    expect(wb.sheets[0]?.cells.A1?.error).toBe("#DIV/0!");
  });

  test("circular references are flagged", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "=B1", B1: "=A1" });
    expect(getCellValue(wb, "A1")).toBe("#CIRCULAR!");
    expect(getCellValue(wb, "B1")).toBe("#CIRCULAR!");
  });

  test("recalc is idempotent", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "2", A2: "3", A3: "=A1*A2", A4: "=A3+A1" });
    const first = { a3: getCellValue(wb, "A3"), a4: getCellValue(wb, "A4") };
    recalc(wb);
    expect(getCellValue(wb, "A3")).toBe(first.a3);
    expect(getCellValue(wb, "A4")).toBe(first.a4);
    expect(getCellValue(wb, "A3")).toBe(6);
    expect(getCellValue(wb, "A4")).toBe(8);
  });

  test("built-in functions work", () => {
    const wb = createWorkbook();
    setCells(wb, {
      A1: "10",
      A2: "20",
      A3: "30",
      B1: "=AVERAGE(A1:A3)",
      B2: "=PRODUCT(A1:A3)",
      B3: '=IF(A1>5,"big","small")',
      B4: "=COUNT(A1:A3)",
      B5: "=ROUND(AVERAGE(A1:A3)/3,2)",
    });
    expect(getCellValue(wb, "B1")).toBe(20);
    expect(getCellValue(wb, "B2")).toBe(6000);
    expect(getCellValue(wb, "B3")).toBe("big");
    expect(getCellValue(wb, "B4")).toBe(3);
    expect(getCellValue(wb, "B5")).toBe(6.67);
  });
});
