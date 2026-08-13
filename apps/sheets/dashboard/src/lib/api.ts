import {
  csvToWorkbook,
  deserializeWorkbook,
  resolveSheet,
  serializeWorkbook,
  sheetToCsv,
  type Workbook,
} from "@hasna/sheets";

const STORAGE_KEY = "hasna-sheets-demo";

/** Persist a workbook to localStorage (the demo's tiny "backend"). */
export function saveWorkbook(workbook: Workbook): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeWorkbook(workbook));
  } catch {
    // ignore quota / private-mode failures in the demo
  }
}

/** Load a persisted workbook, or null if none/invalid. */
export function loadPersisted(): Workbook | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserializeWorkbook(raw);
  } catch {
    return null;
  }
}

/** Trigger a browser download of arbitrary text content. */
export function download(filename: string, content: string, type = "text/plain"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportWorkbookJson(workbook: Workbook): void {
  download("workbook.json", serializeWorkbook(workbook, true), "application/json");
}

export function exportActiveSheetCsv(workbook: Workbook, sheetId?: string): void {
  const sheet = resolveSheet(workbook, sheetId);
  download(`${sheet.name}.csv`, sheetToCsv(sheet), "text/csv");
}

/** Build a workbook from raw CSV text. */
export function workbookFromCsv(text: string, sheetName: string): Workbook {
  return csvToWorkbook(text, { sheetName });
}
