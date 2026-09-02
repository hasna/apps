// Copy into a fresh packed consumer with React/ReactDOM 18.3.1,
// react-spreadsheet 0.10.1 and optional ExcelJS 4.4.0, then run with its runtime.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createWorkbook, setCells, getCellValue, loadWorkbook, serializeWorkbook,
  csvToWorkbook, sheetToCsv, workbookToXlsx, xlsxToWorkbook } from "@hasna/sheets";
import { Spreadsheet } from "@hasna/sheets/react";

const workbook = createWorkbook({ sheetName: "Packed" });
setCells(workbook, { A1: "2", A2: "3", A3: "=SUM(A1:A2)" });
assert.equal(getCellValue(loadWorkbook(serializeWorkbook(workbook)), "A3"), 5);
assert.ok(sheetToCsv(csvToWorkbook("2,3").sheets[0]).includes("2,3"));
const xlsx = await workbookToXlsx(workbook);
assert.ok(xlsx.byteLength > 0);
assert.equal(getCellValue(await xlsxToWorkbook(xlsx), "A3"), 5);
assert.ok(renderToStaticMarkup(createElement(Spreadsheet, { workbook })).includes("table"));
console.log("PASS: packed Sheets formulas, JSON/CSV/XLSX and React server rendering");
