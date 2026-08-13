import type { View } from "@hasna/tables";
import { clsx } from "clsx";
import { Filter, ArrowUpDown, Group } from "lucide-react";

interface ViewTabsProps {
  views: View[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function ViewTabs({ views, activeId, onSelect }: ViewTabsProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {views.map((view) => {
        const active = view.id === activeId;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onSelect(view.id)}
            className={clsx(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition",
              active ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {view.name}
            {view.filters.length > 0 && <Filter className="h-3.5 w-3.5 opacity-70" />}
            {view.sorts.length > 0 && <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />}
            {view.groupByFieldId && <Group className="h-3.5 w-3.5 opacity-70" />}
          </button>
        );
      })}
    </div>
  );
}
