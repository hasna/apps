import { useMemo, useRef, useState } from "react";
import { DataTable } from "@hasna/tables/react";
import type { FieldType } from "@hasna/tables";
import { Plus, Table2 } from "lucide-react";
import { buildSampleBase } from "./lib/sample-data.js";
import { ViewTabs } from "./components/ViewTabs.js";
import { AddFieldDialog } from "./components/AddFieldDialog.js";

export function App() {
  const modelRef = useRef(buildSampleBase());
  const model = modelRef.current;
  const table = model.listTables()[0]!;

  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const [viewId, setViewId] = useState(table.views[0]!.id);
  const [dialogOpen, setDialogOpen] = useState(false);

  const result = useMemo(
    () => model.queryView(table.id, viewId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, table.id, viewId, version],
  );

  const addField = (name: string, type: FieldType, formula?: string) => {
    model.addField(table.id, { name, type, options: formula ? { formula } : undefined });
    bump();
  };

  const addRecord = () => {
    model.createRecord(table.id, {});
    bump();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <Table2 className="h-5 w-5 text-indigo-600" />
        <h1 className="text-lg font-semibold text-slate-900">{model.name}</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {table.name}
        </span>
        <span className="ml-auto text-xs text-slate-400">
          powered by <span className="font-mono text-slate-500">@hasna/tables</span>
        </span>
      </header>

      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2">
        <ViewTabs views={table.views} activeId={viewId} onSelect={setViewId} />
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" /> Field
          </button>
          <button
            type="button"
            onClick={addRecord}
            className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> Record
          </button>
        </div>
      </div>

      {result.groups && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2 text-xs">
          <span className="font-medium text-slate-500">Groups:</span>
          {result.groups.map((g) => (
            <span
              key={g.key}
              className="rounded-full bg-white px-2.5 py-0.5 font-medium text-slate-600 shadow-sm ring-1 ring-slate-200"
            >
              {g.key || "—"} · {g.records.length}
            </span>
          ))}
        </div>
      )}

      <main className="min-h-0 flex-1 bg-white p-4">
        <div className="h-full overflow-hidden rounded-lg border border-slate-200">
          <DataTable
            key={viewId}
            model={model}
            tableId={table.id}
            viewId={viewId}
            onChange={bump}
            onAddField={() => setDialogOpen(true)}
            height="100%"
            width="100%"
          />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-5 py-2 text-xs text-slate-400">
        {result.records.length} record(s) · edit cells inline · resize columns · add rows via the
        trailing row
      </footer>

      <AddFieldDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSubmit={addField} />
    </div>
  );
}
