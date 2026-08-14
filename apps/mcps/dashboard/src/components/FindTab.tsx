import * as React from "react";
import { SearchIcon, PackagePlusIcon } from "lucide-react";
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
import type { McpSource } from "@/types";

interface FindResult {
  id?: string;
  name: string;
  description?: string | null;
  stars?: number;
  source?: string;
  sourceType?: McpSource["type"];
  command?: string;
  args?: string[];
  url?: string;
}

interface FindTabProps {
  showToast: (msg: string, type: "success" | "error") => void;
}

function SourceTypeBadge({ type }: { type?: McpSource["type"] | string }) {
  if (!type) return null;
  const styles: Record<string, string> = {
    "mcp-registry": "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    "awesome-list": "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    "npm-search": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    "github-topic": "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  };
  return (
    <Badge className={`${styles[type] || "bg-gray-100 text-gray-700"} border-0 text-xs`}>
      {type}
    </Badge>
  );
}

export function FindTab({ showToast }: FindTabProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<FindResult[]>([]);
  const [sources, setSources] = React.useState<McpSource[]>([]);
  const [selectedSources, setSelectedSources] = React.useState<Set<string>>(new Set());
  const [searching, setSearching] = React.useState(false);
  const [installTarget, setInstallTarget] = React.useState<FindResult | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((data: McpSource[]) => setSources(data))
      .catch(() => {});
  }, []);

  const doSearch = React.useCallback(
    async (q: string, srcIds: Set<string>) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const params = new URLSearchParams({ q });
        if (srcIds.size > 0) {
          params.set("sources", Array.from(srcIds).join(","));
        }
        const res = await fetch(`/api/find?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data : data.results || []);
      } catch {
        showToast("Search failed", "error");
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [showToast]
  );

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query, selectedSources);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selectedSources, doSearch]);

  function toggleSource(id: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-lg">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search for MCP servers..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        {searching && (
          <span className="text-sm text-muted-foreground">Searching...</span>
        )}
      </div>

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter sources:</span>
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={() => toggleSource(s.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                selectedSources.has(s.id)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {results.length === 0 && query.trim() && !searching ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No results found for "{query}"
        </div>
      ) : results.length === 0 && !query.trim() ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Type to search for MCP servers
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={r.id || r.name + i}
              className="flex items-start justify-between rounded-lg border p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{r.name}</span>
                  {r.sourceType && <SourceTypeBadge type={r.sourceType} />}
                  {r.source && !r.sourceType && (
                    <span className="text-xs text-muted-foreground">{r.source}</span>
                  )}
                  {typeof r.stars === "number" && (
                    <span className="text-xs text-muted-foreground">★ {r.stars.toLocaleString()}</span>
                  )}
                </div>
                {r.description && (
                  <p className="text-xs text-muted-foreground truncate max-w-[480px]">{r.description}</p>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => setInstallTarget(r)} className="ml-4 shrink-0">
                <PackagePlusIcon className="size-3.5" />
                Install
              </Button>
            </div>
          ))}
        </div>
      )}

      {installTarget && (
        <InstallDialog
          result={installTarget}
          onClose={() => setInstallTarget(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

interface InstallDialogProps {
  result: FindResult;
  onClose: () => void;
  showToast: (msg: string, type: "success" | "error") => void;
}

function InstallDialog({ result, onClose, showToast }: InstallDialogProps) {
  const [installing, setInstalling] = React.useState(false);
  const [done, setDone] = React.useState<{ id: string } | null>(null);

  async function handleInstall() {
    setInstalling(true);
    try {
      const body: Record<string, unknown> = {
        name: result.name,
        description: result.description,
      };
      if (result.command) body.command = result.command;
      if (result.args) body.args = result.args;
      if (result.url) body.url = result.url;

      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Failed to add server", "error");
        return;
      }
      setDone({ id: data.id });
      showToast("Server added successfully", "success");
    } catch {
      showToast("Failed to add server", "error");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlusIcon className="size-5" />
            Install Server
          </DialogTitle>
          <DialogDescription>
            Add <strong>{result.name}</strong> to your local registry.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-green-600 dark:text-green-400">
              Server added with ID: <code className="font-mono text-xs">{done.id}</code>
            </p>
            <p className="text-sm text-muted-foreground">
              Run <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">mcps install {done.id}</code> from the CLI to configure agents.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {result.description && (
              <p className="text-sm text-muted-foreground">{result.description}</p>
            )}
            {result.command && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-mono">
                {result.command} {result.args?.join(" ")}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{done ? "Close" : "Cancel"}</Button>
          {!done && (
            <Button onClick={handleInstall} disabled={installing}>
              {installing ? "Installing..." : "Add to Registry"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
