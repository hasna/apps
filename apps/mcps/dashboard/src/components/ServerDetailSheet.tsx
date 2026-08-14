import * as React from "react";
import {
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XIcon,
  PlusIcon,
  ActivityIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { McpServerEntry } from "@/types";

interface CachedTool {
  name: string;
  description?: string;
}

interface DoctorResult {
  ok: boolean;
  message: string;
  details?: string;
}

interface EnvRowProps {
  envKey: string;
  value: string;
  serverId: string;
  onRefresh: () => void;
  onDelete: (key: string) => void;
}

function EnvRow({ envKey, value, serverId, onRefresh, onDelete }: EnvRowProps) {
  const [revealed, setRevealed] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: envKey, value: editValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Failed (${res.status})`);
        return;
      }
      setEditing(false);
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditValue(value);
    setEditing(false);
    setError(null);
  }

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground align-middle w-1/3">
        {envKey}
      </td>
      <td className="py-2 pr-2 align-middle">
        {editing ? (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-7 text-xs font-mono"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
        ) : (
          <span className="font-mono text-xs">
            {revealed ? value : "***"}
          </span>
        )}
        {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
      </td>
      <td className="py-2 align-middle">
        <div className="flex items-center gap-1 justify-end">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={handleSave}
                disabled={saving}
              >
                <CheckIcon className="size-3 text-green-500" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={handleCancel}
                disabled={saving}
              >
                <XIcon className="size-3" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setRevealed((v) => !v)}
                title={revealed ? "Hide value" : "Reveal value"}
              >
                {revealed ? (
                  <EyeOffIcon className="size-3" />
                ) : (
                  <EyeIcon className="size-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => {
                  setEditValue(value);
                  setEditing(true);
                }}
                title="Edit"
              >
                <PencilIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-destructive hover:text-destructive"
                onClick={() => onDelete(envKey)}
                title="Delete"
              >
                <TrashIcon className="size-3" />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

interface AddEnvRowProps {
  serverId: string;
  onAdded: () => void;
}

function AddEnvRow({ serverId, onAdded }: AddEnvRowProps) {
  const [newKey, setNewKey] = React.useState("");
  const [newValue, setNewValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleAdd() {
    if (!newKey.trim()) {
      setError("Key is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newKey.trim(), value: newValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Failed (${res.status})`);
        return;
      }
      setNewKey("");
      setNewValue("");
      onAdded();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td className="pt-2 pr-3 align-top">
        <Input
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="h-7 text-xs font-mono"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
      </td>
      <td className="pt-2 pr-2 align-top">
        <Input
          placeholder="VALUE"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="h-7 text-xs font-mono"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
      </td>
      <td className="pt-2 align-top">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={handleAdd}
          disabled={saving}
          title="Add env var"
        >
          <PlusIcon className="size-3" />
        </Button>
      </td>
    </tr>
  );
}

interface ServerDetailSheetProps {
  server: McpServerEntry | null;
  open: boolean;
  onClose: () => void;
}

export function ServerDetailSheet({
  server,
  open,
  onClose,
}: ServerDetailSheetProps) {
  const [tools, setTools] = React.useState<CachedTool[]>([]);
  const [toolsLoading, setToolsLoading] = React.useState(false);
  const [doctorResults, setDoctorResults] = React.useState<DoctorResult[] | null>(null);
  const [doctorRunning, setDoctorRunning] = React.useState(false);
  const [envData, setEnvData] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!server || !open) {
      setTools([]);
      setDoctorResults(null);
      setEnvData({});
      return;
    }
    setEnvData(server.env ?? {});
    loadTools(server.id);
  }, [server, open]);

  async function loadTools(id: string) {
    setToolsLoading(true);
    try {
      const res = await fetch(`/api/servers/${id}/tools`);
      if (res.ok) {
        const data = await res.json();
        setTools(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    } finally {
      setToolsLoading(false);
    }
  }

  async function refreshServer() {
    if (!server) return;
    try {
      const res = await fetch(`/api/servers/${server.id}`);
      if (res.ok) {
        const data = await res.json();
        setEnvData(data.env ?? {});
      }
    } catch {
      // ignore
    }
  }

  async function handleDeleteEnv(key: string) {
    if (!server) return;
    try {
      const res = await fetch(`/api/servers/${server.id}/env/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        refreshServer();
      }
    } catch {
      // ignore
    }
  }

  async function runDoctor() {
    if (!server) return;
    setDoctorRunning(true);
    setDoctorResults(null);
    try {
      const res = await fetch(`/api/servers/${server.id}/doctor`);
      if (res.ok) {
        const data = await res.json();
        setDoctorResults(Array.isArray(data) ? data : [data]);
      } else {
        setDoctorResults([{ ok: false, message: `Request failed (${res.status})` }]);
      }
    } catch {
      setDoctorResults([{ ok: false, message: "Network error" }]);
    } finally {
      setDoctorRunning(false);
    }
  }

  if (!server) return null;

  const fullCommand = [server.command, ...server.args].join(" ");

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-start gap-3 pr-8">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl">{server.name}</SheetTitle>
              <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                {server.id}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                server.enabled
                  ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400 shrink-0"
                  : "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400 shrink-0"
              }
            >
              {server.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </SheetHeader>

        <div className="space-y-6">
          {/* Description */}
          {server.description && (
            <div>
              <h3 className="text-sm font-medium mb-1">Description</h3>
              <p className="text-sm text-muted-foreground">{server.description}</p>
            </div>
          )}

          {/* Command */}
          <div>
            <h3 className="text-sm font-medium mb-1">Command</h3>
            <code className="block rounded border bg-muted px-3 py-2 text-xs font-mono text-muted-foreground break-all">
              {fullCommand}
            </code>
          </div>

          {/* Connection Details */}
          <div>
            <h3 className="text-sm font-medium mb-2">Connection</h3>
            <div className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24">Transport</span>
                <span className="font-mono">{server.transport}</span>
              </div>
              {server.url && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-24">URL</span>
                  <span className="font-mono text-xs break-all">{server.url}</span>
                </div>
              )}
              {server.last_connected_at && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-24">Last connected</span>
                  <span className="text-xs">
                    {new Date(server.last_connected_at).toLocaleString()}
                  </span>
                </div>
              )}
              {server.last_error && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground w-24 shrink-0">Last error</span>
                  <span className="text-xs text-red-500 break-all">{server.last_error}</span>
                </div>
              )}
            </div>
          </div>

          {/* Env Vars */}
          <div>
            <h3 className="text-sm font-medium mb-2">Environment Variables</h3>
            <div className="rounded border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-1.5 px-3 text-xs font-medium text-muted-foreground">KEY</th>
                    <th className="text-left py-1.5 px-2 text-xs font-medium text-muted-foreground">VALUE</th>
                    <th className="py-1.5 px-2 w-24" />
                  </tr>
                </thead>
                <tbody className="px-3">
                  {Object.entries(envData).length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-2 px-3 text-xs text-muted-foreground italic">
                        No environment variables
                      </td>
                    </tr>
                  )}
                  {Object.entries(envData).map(([k, v]) => (
                    <EnvRow
                      key={k}
                      envKey={k}
                      value={v}
                      serverId={server.id}
                      onRefresh={refreshServer}
                      onDelete={handleDeleteEnv}
                    />
                  ))}
                  <AddEnvRow serverId={server.id} onAdded={refreshServer} />
                </tbody>
              </table>
            </div>
          </div>

          {/* Tools */}
          <div>
            <h3 className="text-sm font-medium mb-2">
              Cached Tools {tools.length > 0 && `(${tools.length})`}
            </h3>
            {toolsLoading ? (
              <p className="text-xs text-muted-foreground">Loading tools…</p>
            ) : tools.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No cached tools</p>
            ) : (
              <div className="rounded border divide-y">
                {tools.map((tool) => (
                  <div key={tool.name} className="px-3 py-2">
                    <p className="text-xs font-mono font-medium">{tool.name}</p>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Doctor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Health Check</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={runDoctor}
                disabled={doctorRunning}
              >
                <ActivityIcon className="size-3.5" />
                {doctorRunning ? "Running…" : "Run Health Check"}
              </Button>
            </div>
            {doctorResults && (
              <div className="rounded border divide-y">
                {doctorResults.map((result, i) => (
                  <div key={i} className="px-3 py-2 flex items-start gap-2">
                    <span className={result.ok ? "text-green-500" : "text-red-500"}>
                      {result.ok ? "✓" : "✗"}
                    </span>
                    <div>
                      <p className="text-xs font-medium">{result.message}</p>
                      {result.details && (
                        <p className="text-xs text-muted-foreground mt-0.5">{result.details}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
