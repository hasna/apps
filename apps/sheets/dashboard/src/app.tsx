import { useEffect, useMemo, useState } from "react";
import { Spreadsheet } from "@hasna/sheets/react";
import { addSheet, renameSheet, resolveSheet, setActiveSheet } from "@hasna/sheets";
import { Toolbar } from "./components/Toolbar.js";
import { SheetTabs } from "./components/SheetTabs.js";
import {
  exportActiveSheetCsv,
  exportWorkbookJson,
  loadPersisted,
  saveWorkbook,
  workbookFromCsv,
} from "./lib/api.js";
import { seedWorkbook } from "./lib/seed.js";
import type { StatusMessage, Workbook } from "./types.js";

function clone(workbook: Workbook): Workbook {
  return JSON.parse(JSON.stringify(workbook)) as Workbook;
}

export function App() {
  const [workbook, setWorkbook] = useState<Workbook>(() => loadPersisted() ?? seedWorkbook());
  const [activeSheetId, setActiveSheetId] = useState<string>(() => workbook.activeSheetId);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  useEffect(() => {
    saveWorkbook(workbook);
  }, [workbook]);

  const activeSheet = useMemo(() => {
    try {
      return resolveSheet(workbook, activeSheetId);
    } catch {
      return resolveSheet(workbook);
    }
  }, [workbook, activeSheetId]);

  const cellCount = Object.keys(activeSheet.cells).length;
  const rows = Math.min(Math.max(activeSheet.rows, 14), 60);
  const columns = Math.min(Math.max(activeSheet.columns, 7), 18);

  function commit(next: Workbook, message?: StatusMessage) {
    setWorkbook(next);
    if (message) setStatus(message);
  }

  function handleSelectSheet(sheetId: string) {
    const next = clone(workbook);
    setActiveSheet(next, sheetId);
    setActiveSheetId(sheetId);
    commit(next);
  }

  function handleAddSheet() {
    const next = clone(workbook);
    const sheet = addSheet(next, { activate: true });
    setActiveSheetId(sheet.id);
    commit(next, { kind: "info", text: `Added ${sheet.name}` });
  }

  function handleRenameSheet(sheetId: string) {
    const current = resolveSheet(workbook, sheetId);
    const name = window.prompt("Rename sheet", current.name);
    if (!name || name === current.name) return;
    const next = clone(workbook);
    try {
      renameSheet(next, sheetId, name);
      commit(next, { kind: "info", text: `Renamed to ${name}` });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Rename failed" });
    }
  }

  async function handleImportCsv(file: File) {
    try {
      const text = await file.text();
      const imported = workbookFromCsv(text, file.name.replace(/\.csv$/i, "") || "Imported");
      setActiveSheetId(imported.activeSheetId);
      commit(imported, { kind: "info", text: `Imported ${file.name}` });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Import failed" });
    }
  }

  function handleReset() {
    const fresh = seedWorkbook();
    setActiveSheetId(fresh.activeSheetId);
    commit(fresh, { kind: "info", text: "Reset to sample workbook" });
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onImportCsv={handleImportCsv}
        onExportCsv={() => exportActiveSheetCsv(workbook, activeSheetId)}
        onExportJson={() => exportWorkbookJson(workbook)}
        onReset={handleReset}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-5">
          <Spreadsheet
            key={activeSheet.id}
            workbook={workbook}
            sheetId={activeSheetId}
            onWorkbookChange={(next) => commit(next)}
            rows={rows}
            columns={columns}
            className="Spreadsheet"
          />
        </div>

        <SheetTabs
          workbook={workbook}
          activeSheetId={activeSheet.id}
          onSelect={handleSelectSheet}
          onAdd={handleAddSheet}
          onRename={handleRenameSheet}
        />
      </main>

      <footer className="flex items-center justify-between border-t border-neutral-200 bg-white px-5 py-2 text-xs text-neutral-500">
        <span>
          Try a formula: type <code className="rounded bg-neutral-100 px-1">=SUM(B2:D2)</code> or{" "}
          <code className="rounded bg-neutral-100 px-1">=ROUND(AVERAGE(E2:E4),1)</code>
        </span>
        <span className="flex items-center gap-3">
          {status && (
            <span className={status.kind === "error" ? "text-red-600" : "text-indigo-600"}>
              {status.text}
            </span>
          )}
          <span>
            {activeSheet.name}: {cellCount} cell(s)
          </span>
        </span>
      </footer>
    </div>
  );
}
