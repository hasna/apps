import { describe, expect, test } from "bun:test";
import { csvToWorkbook, parseCsv, sheetToCsv, toCsv } from "./csv.js";
import { getCellValue, resolveSheet } from "./workbook.js";

describe("parseCsv", () => {
  test("simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("quoted fields with commas and quotes", () => {
    expect(parseCsv('"a,b","c""d",e')).toEqual([["a,b", 'c"d', "e"]]);
  });

  test("embedded newlines inside quotes", () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([["line1\nline2", "x"]]);
  });

  test("trailing newline does not add an empty row", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });

  test("empty string yields no rows", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("toCsv", () => {
  test("escapes as needed", () => {
    expect(toCsv([["a,b", 'c"d', null, 1]])).toBe('"a,b","c""d",,1');
  });
});

describe("csvToWorkbook", () => {
  test("imports literals and live formulas", () => {
    const wb = csvToWorkbook("1,2,=A1+B1\n10,20,=A2+B2");
    expect(getCellValue(wb, "A1")).toBe(1);
    expect(getCellValue(wb, "C1")).toBe(3);
    expect(getCellValue(wb, "C2")).toBe(30);
  });

  test("round trips through computed CSV", () => {
    const wb = csvToWorkbook("1,2,=A1+B1");
    const sheet = resolveSheet(wb);
    expect(sheetToCsv(sheet)).toBe("1,2,3");
    expect(sheetToCsv(sheet, { raw: true })).toBe("1,2,=A1+B1");
  });
});
