import * as React from "react";
import { PlusIcon, TrashIcon, PowerIcon, PowerOffIcon, FlaskConicalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { McpSource } from "@/types";

const SOURCE_TYPES = ["mcp-registry", "awesome-list", "npm-search", "github-topic"] as const;

function TypeBadge({ type }: { type: McpSource["type"] }) {
  const styles: Record<McpSource["type"], string> = {
    "mcp-registry": "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    "awesome-list": "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    "npm-search": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    "github-topic": "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  };
  return (
    <Badge className={`${styles[type]} border-0`}>{type}</Badge>
  );
}

interface SourcesTabProps {
  showToast: (msg: string, type: "success" | "error") => void;
}

export function SourcesTab({ showToast }: SourcesTabProps) {
  const [sources, setSources] = React.useState<McpSource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [addOpen, setAddOpen] = React.useState(false);

  const loadSources = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sources");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSources(await res.json());
    } catch {
      showToast("Failed to load sources", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    loadSources();
  }, [loadSources]);

  async function handleToggle(id: string, enable: boolean) {
    try {
      const res = await fetch(`/api/sources/${id}/${enable ? "enable" : "disable"}`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || `Failed to ${enable ? "enable" : "disable"}`, "error");
        return;
      }
      showToast(`Source ${enable ? "enabled" : "disabled"}`, "success");
      loadSources();
    } catch {
      showToast("Failed to update source", "error");
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || "Failed to remove source", "error");
        return;
      }
      showToast("Source removed", "success");
      loadSources();
    } catch {
      showToast("Failed to remove source", "error");
    }
  }

  async function handleTest(id: string) {
    showToast("Testing source...", "success");
    try {
      const res = await fetch(`/api/sources/${id}`);
      if (!res.ok) {
        showToast("Test failed: source unreachable", "error");
      } else {
        showToast("Source is reachable", "success");
      }
    } catch {
      showToast("Test failed: network error", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Registry Sources</h2>
          <p className="text-xs text-muted-foreground">Manage where servers are discovered from</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-3.5" />
          Add Source
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading sources...</div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No sources configured.
                  </TableCell>
                </TableRow>
              ) : (
                sources.map((s) => (
                  <TableRow key={s.id} className={!s.enabled ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      {s.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{s.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={s.type} />
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground truncate block max-w-[240px]">{s.url}</code>
                    </TableCell>
                    <TableCell>
                      {s.enabled ? (
                        <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400">
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleTest(s.id)}>
                          <FlaskConicalIcon className="size-3.5" />
                          Test
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleToggle(s.id, !s.enabled)}>
                          {s.enabled ? (
                            <><PowerOffIcon className="size-3.5" />Disable</>
                          ) : (
                            <><PowerIcon className="size-3.5" />Enable</>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(s.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <TrashIcon className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AddSourceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          showToast("Source added", "success");
          loadSources();
        }}
      />
    </div>
  );
}

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

function AddSourceDialog({ open, onOpenChange, onAdded }: AddSourceDialogProps) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<McpSource["type"]>("mcp-registry");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [testOnAdd, setTestOnAdd] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setType("mcp-registry");
      setUrl("");
      setDescription("");
      setTestOnAdd(false);
      setError(null);
    }
  }, [open]);

  async function handleSave() {
    if (!name.trim() || !url.trim()) {
      setError("Name and URL are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          url: url.trim(),
          description: description.trim() || undefined,
          test: testOnAdd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Failed to add source (${res.status})`);
        return;
      }
      onOpenChange(false);
      onAdded();
    } catch {
      setError("Failed to add source");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusIcon className="size-5" />
            Add Source
          </DialogTitle>
          <DialogDescription>
            Add a new registry source for discovering MCP servers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="source-name">Name</label>
            <Input
              id="source-name"
              placeholder="e.g. Official MCP Registry"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="source-type">Type</label>
            <select
              id="source-type"
              value={type}
              onChange={(e) => setType(e.target.value as McpSource["type"])}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="source-url">URL</label>
            <Input
              id="source-url"
              placeholder="https://registry.example.com/api/v0"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="source-desc">Description (optional)</label>
            <Input
              id="source-desc"
              placeholder="What does this source provide?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={testOnAdd}
              onChange={(e) => setTestOnAdd(e.target.checked)}
              className="size-4"
            />
            Test connection before adding
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || !url.trim() || saving}>
            {saving ? "Adding..." : "Add Source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
