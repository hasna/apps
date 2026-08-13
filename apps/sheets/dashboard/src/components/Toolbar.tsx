import { type ReactNode, useRef } from "react";
import { Download, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";

interface ToolbarProps {
  onImportCsv: (file: File) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onReset: () => void;
}

export function Toolbar({ onImportCsv, onExportCsv, onExportJson, onReset }: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-3">
      <div className="flex items-center gap-2.5">
        <FileSpreadsheet className="h-5 w-5 text-indigo-600" aria-hidden />
        <div>
          <h1 className="text-sm font-semibold text-neutral-800">@hasna/sheets</h1>
          <p className="text-xs text-neutral-500">Headless workbook SDK · live formula recalc</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportCsv(file);
            event.target.value = "";
          }}
        />
        <ToolbarButton icon={<Upload className="h-4 w-4" />} label="Import CSV" onClick={() => fileRef.current?.click()} />
        <ToolbarButton icon={<Download className="h-4 w-4" />} label="Export CSV" onClick={onExportCsv} />
        <ToolbarButton icon={<Download className="h-4 w-4" />} label="Export JSON" onClick={onExportJson} />
        <ToolbarButton icon={<RotateCcw className="h-4 w-4" />} label="Reset" onClick={onReset} />
      </div>
    </header>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
    >
      {icon}
      {label}
    </button>
  );
}
