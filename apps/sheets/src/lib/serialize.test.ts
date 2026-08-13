import { describe, expect, test } from "bun:test";
import {
  WORKBOOK_SCHEMA,
  deserializeWorkbook,
  loadWorkbook,
  serializeWorkbook,
  toDocument,
  validateWorkbook,
} from "./serialize.js";
import { createWorkbook, getCellValue, setCells } from "./workbook.js";

describe("serialization", () => {
  test("round trip preserves cells and recomputes values", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "5", A2: "10", A3: "=SUM(A1:A2)" });
    const json = serializeWorkbook(wb);
    const restored = deserializeWorkbook(json);
    expect(getCellValue(restored, "A3")).toBe(15);
    expect(restored.sheets[0]?.cells.A3?.raw).toBe("=SUM(A1:A2)");
  });

  test("document envelope shape", () => {
    const wb = createWorkbook();
    const doc = toDocument(wb);
    expect(doc.schema).toBe(WORKBOOK_SCHEMA);
    expect(doc.version).toBe(1);
    expect(doc.workbook.id).toBe(wb.id);
  });

  test("loadWorkbook accepts a bare workbook object", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "2", A2: "=A1*3" });
    const restored = loadWorkbook(JSON.parse(JSON.stringify(wb)));
    expect(getCellValue(restored, "A2")).toBe(6);
  });

  test("recomputes even if persisted values are stale", () => {
    const wb = createWorkbook();
    setCells(wb, { A1: "1", A2: "=A1+1" });
    const doc = toDocument(wb);
    // Tamper with a persisted computed value.
    const a2 = doc.workbook.sheets[0]?.cells.A2;
    if (a2) a2.value = 999;
    const restored = deserializeWorkbook(doc);
    expect(getCellValue(restored, "A2")).toBe(2);
  });

  test("validateWorkbook rejects malformed input", () => {
    expect(() => validateWorkbook(null)).toThrow();
    expect(() => validateWorkbook({})).toThrow();
    expect(() => validateWorkbook({ sheets: [] })).toThrow();
  });

  test("validateWorkbook uppercases cell keys", () => {
    const wb = validateWorkbook({
      id: "w",
      sheets: [{ id: "s", name: "S", rows: 5, columns: 5, cells: { a1: { raw: "1", value: 1 } } }],
    });
    expect(wb.sheets[0]?.cells.A1).toBeDefined();
  });
});
