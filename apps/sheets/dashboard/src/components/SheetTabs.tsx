import clsx from "clsx";
import type { Workbook } from "../types.js";

interface SheetTabsProps {
  workbook: Workbook;
  activeSheetId: string;
  onSelect: (sheetId: string) => void;
  onAdd: () => void;
  onRename: (sheetId: string) => void;
}

export function SheetTabs({ workbook, activeSheetId, onSelect, onAdd, onRename }: SheetTabsProps) {
  return (
    <div className="flex items-center gap-1 border-t border-neutral-200 bg-white px-3 py-1.5">
      {workbook.sheets.map((sheet) => {
        const active = sheet.id === activeSheetId;
        return (
          <button
            key={sheet.id}
            type="button"
            onClick={() => onSelect(sheet.id)}
            onDoubleClick={() => onRename(sheet.id)}
            title="Double-click to rename"
            className={clsx(
              "rounded-md px-3 py-1 text-sm transition-colors",
              active
                ? "bg-indigo-50 font-medium text-indigo-700"
                : "text-neutral-500 hover:bg-neutral-100",
            )}
          >
            {sheet.name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="rounded-md px-2.5 py-1 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
      >
        Add sheet
      </button>
    </div>
  );
}
