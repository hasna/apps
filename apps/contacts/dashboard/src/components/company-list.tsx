import * as React from "react";
import { PlusIcon, Trash2Icon, PencilIcon, BuildingIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/search-bar";
import { cn } from "@/lib/utils";
import type { CompanyWithDetails } from "@/types";

interface CompanyListProps {
  companies: CompanyWithDetails[];
  total: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (company: CompanyWithDetails) => void;
  onNew: () => void;
  onEdit: (company: CompanyWithDetails) => void;
  onDelete: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
}

export function CompanyList({
  companies,
  total,
  loading,
  selectedId,
  onSelect,
  onNew,
  onEdit,
  onDelete,
  search,
  onSearchChange,
}: CompanyListProps) {
  const filtered = search
    ? companies.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.industry ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : companies;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b">
        <SearchBar
          value={search}
          onChange={onSearchChange}
          placeholder="Search companies..."
          className="flex-1"
        />
        <Button size="icon" onClick={onNew} title="New company">
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-b">
        {loading ? "Loading..." : `${total} compan${total !== 1 ? "ies" : "y"}`}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <BuildingIcon className="size-8 opacity-30" />
            <span>No companies found</span>
            <Button size="sm" variant="outline" onClick={onNew}>
              <PlusIcon className="size-3 mr-1" /> Add company
            </Button>
          </div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={cn(
              "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-accent transition-colors border-b last:border-0 group",
              selectedId === c.id && "bg-accent"
            )}
            onClick={() => onSelect(c)}
          >
            <div className="flex-shrink-0 size-9 rounded-md bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{c.name}</div>
              {c.industry && (
                <div className="text-xs text-muted-foreground">{c.industry}</div>
              )}
              <div className="text-xs text-muted-foreground">
                {c.employee_count} employee{c.employee_count !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={(e) => { e.stopPropagation(); onEdit(c); }}
                title="Edit"
              >
                <PencilIcon className="size-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-destructive hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                title="Delete"
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
