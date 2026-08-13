import { addSheet, createWorkbook, setCells, type Workbook } from "@hasna/sheets";

/** A generic sample workbook that shows literals, formulas, and cross-sheet refs. */
export function seedWorkbook(): Workbook {
  const workbook = createWorkbook({ sheetName: "Revenue", rows: 14, columns: 6 });
  setCells(workbook, {
    A1: "Region",
    B1: "Q1",
    C1: "Q2",
    D1: "Q3",
    E1: "Total",
    A2: "North",
    B2: "120",
    C2: "150",
    D2: "160",
    E2: "=SUM(B2:D2)",
    A3: "South",
    B3: "90",
    C3: "110",
    D3: "130",
    E3: "=SUM(B3:D3)",
    A4: "West",
    B4: "140",
    C4: "160",
    D4: "170",
    E4: "=SUM(B4:D4)",
    A5: "Total",
    B5: "=SUM(B2:B4)",
    C5: "=SUM(C2:C4)",
    D5: "=SUM(D2:D4)",
    E5: "=SUM(E2:E4)",
    A7: "Avg / region",
    B7: "=ROUND(AVERAGE(E2:E4),1)",
  });

  const notes = addSheet(workbook, { name: "Summary" });
  setCells(
    workbook,
    {
      A1: "Metric",
      B1: "Value",
      A2: "Grand total",
      B2: "=Revenue!E5",
      A3: "Average region total",
      B3: "=ROUND(AVERAGE(Revenue!E2:E4),1)",
      A4: "Q1 share of total",
      B4: "=ROUND(Revenue!B5/Revenue!E5*100,1)",
    },
    notes.id,
  );

  return workbook;
}
