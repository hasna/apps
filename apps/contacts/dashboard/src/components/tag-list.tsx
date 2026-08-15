import * as React from "react";
import { PlusIcon, Trash2Icon, TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tag } from "@/types";

interface TagListProps {
  tags: Tag[];
  loading: boolean;
  onCreate: (name: string, color: string, description: string) => void;
  onDelete: (id: string) => void;
}

const PRESET_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4",
];

export function TagList({ tags, loading, onCreate, onDelete }: TagListProps) {
  const [newName, setNewName] = React.useState("");
  const [newColor, setNewColor] = React.useState(PRESET_COLORS[0]!);
  const [newDesc, setNewDesc] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreate(newName.trim(), newColor, newDesc.trim());
      setNewName("");
      setNewDesc("");
      setNewColor(PRESET_COLORS[0]!);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 p-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold mb-4">Tags</h2>

        <form onSubmit={handleCreate} className="flex flex-col gap-3 mb-6 p-4 border rounded-lg bg-card">
          <div className="text-sm font-medium">New Tag</div>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tag name"
              className="flex-1"
            />
            <Input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Color:</span>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className={`size-5 rounded-full border-2 transition-transform ${
                  newColor === c ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="size-5 rounded cursor-pointer border-0 bg-transparent"
              title="Custom color"
            />
          </div>
          <Button type="submit" size="sm" disabled={!newName.trim() || creating}>
            <PlusIcon className="size-3 mr-1" />
            Create Tag
          </Button>
        </form>

        {loading && <p className="text-sm text-muted-foreground">Loading tags...</p>}

        {!loading && tags.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
            <TagIcon className="size-8 opacity-30" />
            <span>No tags yet. Create one above.</span>
          </div>
        )}

        <div className="space-y-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-3 px-3 py-2 border rounded-md hover:bg-accent transition-colors group"
            >
              <div
                className="size-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{tag.name}</span>
                {tag.description && (
                  <span className="text-xs text-muted-foreground ml-2">{tag.description}</span>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onDelete(tag.id)}
                title="Delete tag"
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
