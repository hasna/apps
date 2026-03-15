import * as React from "react";
import { ChevronDownIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface ToolResult {
  content?: unknown;
  error?: string;
}

interface ToolsBrowserProps {
  serverId: string;
}

function ToolRunner({ serverId, tool }: { serverId: string; tool: McpTool }) {
  const [open, setOpen] = React.useState(false);
  const defaultArgs = tool.inputSchema
    ? JSON.stringify(
        Object.fromEntries(
          Object.keys((tool.inputSchema.properties as Record<string, unknown>) || {}).map(
            (k) => [k, ""]
          )
        ),
        null,
        2
      )
    : "{}";
  const [argsText, setArgsText] = React.useState(defaultArgs);
  const [result, setResult] = React.useState<ToolResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);

  async function handleRun() {
    let args: unknown;
    try {
      args = JSON.parse(argsText);
      setParseError(null);
    } catch {
      setParseError("Invalid JSON");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.name, args }),
      });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setResult(data);
    } catch {
      setResult({ error: "Request failed" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button
        className="flex w-full items-center gap-2 py-2 text-left hover:bg-muted/40 rounded px-2 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDownIcon className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />
        )}
        <span className="font-mono text-sm font-medium">{tool.name}</span>
        {tool.description && (
          <span className="text-xs text-muted-foreground truncate">{tool.description}</span>
        )}
      </button>

      {open && (
        <div className="ml-6 mt-1 space-y-2 pb-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Input (JSON)</label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              className="w-full rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              rows={4}
              spellCheck={false}
            />
            {parseError && <p className="text-xs text-destructive">{parseError}</p>}
          </div>
          <Button size="sm" onClick={handleRun} disabled={running}>
            <PlayIcon className="size-3.5" />
            {running ? "Running..." : "Execute"}
          </Button>
          {result && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium mb-1 text-muted-foreground">Result</p>
              <pre className="text-xs overflow-auto max-h-64 whitespace-pre-wrap break-words">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolsBrowser({ serverId }: ToolsBrowserProps) {
  const [tools, setTools] = React.useState<McpTool[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!serverId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/servers/${serverId}/tools`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setTools(Array.isArray(data) ? data : data.tools || []);
        setLoaded(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [serverId]);

  if (loading) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Loading tools...</div>;
  }
  if (error) {
    return <div className="py-6 text-center text-sm text-destructive">Failed to load tools: {error}</div>;
  }
  if (loaded && tools.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No tools available</div>;
  }

  return (
    <div className="space-y-0.5">
      {tools.map((tool) => (
        <ToolRunner key={tool.name} serverId={serverId} tool={tool} />
      ))}
    </div>
  );
}
