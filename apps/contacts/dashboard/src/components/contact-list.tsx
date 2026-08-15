import * as React from "react";
import { PlusIcon, Trash2Icon, PencilIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "@/components/search-bar";
import { cn } from "@/lib/utils";
import type { ContactWithDetails } from "@/types";

interface ContactListProps {
  contacts: ContactWithDetails[];
  total: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (contact: ContactWithDetails) => void;
  onNew: () => void;
  onEdit: (contact: ContactWithDetails) => void;
  onDelete: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
}

export function ContactList({
  contacts,
  total,
  loading,
  selectedId,
  onSelect,
  onNew,
  onEdit,
  onDelete,
  search,
  onSearchChange,
}: ContactListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b">
        <SearchBar
          value={search}
          onChange={onSearchChange}
          placeholder="Search contacts..."
          className="flex-1"
        />
        <Button size="icon" onClick={onNew} title="New contact">
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-b">
        {loading ? "Loading..." : `${total} contact${total !== 1 ? "s" : ""}`}
      </div>
      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <UserIcon className="size-8 opacity-30" />
            <span>No contacts found</span>
            <Button size="sm" variant="outline" onClick={onNew}>
              <PlusIcon className="size-3 mr-1" /> Add contact
            </Button>
          </div>
        )}
        {contacts.map((c) => (
          <div
            key={c.id}
            className={cn(
              "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-accent transition-colors border-b last:border-0 group",
              selectedId === c.id && "bg-accent"
            )}
            onClick={() => onSelect(c)}
          >
            <div className="flex-shrink-0 size-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
              {c.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{c.display_name}</div>
              {c.job_title && (
                <div className="text-xs text-muted-foreground truncate">{c.job_title}</div>
              )}
              {c.company && (
                <div className="text-xs text-muted-foreground truncate">{c.company.name}</div>
              )}
              {c.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.tags.slice(0, 3).map((t) => (
                    <Badge
                      key={t.id}
                      variant="secondary"
                      className="text-[10px] px-1 py-0"
                      style={{ backgroundColor: t.color + "20", color: t.color }}
                    >
                      {t.name}
                    </Badge>
                  ))}
                </div>
              )}
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
