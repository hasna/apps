import * as React from "react";
import { CheckCircle2Icon, XCircleIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DoctorCheck {
  name: string;
  pass: boolean;
  message?: string;
}

interface DoctorResult {
  serverId: string;
  serverName?: string;
  checks: DoctorCheck[];
  healthy: boolean;
}

interface DoctorPanelProps {
  serverId?: string;
  serverIds?: string[];
  showToast?: (msg: string, type: "success" | "error") => void;
}

async function runDoctorForServer(id: string): Promise<DoctorResult> {
  const res = await fetch(`/api/servers/${id}/doctor`);
  if (!res.ok) {
    return {
      serverId: id,
      checks: [{ name: "Connection", pass: false, message: `HTTP ${res.status}` }],
      healthy: false,
    };
  }
  const data = await res.json().catch(() => ({}));
  return {
    serverId: id,
    serverName: data.serverName,
    checks: data.checks || [],
    healthy: data.healthy ?? false,
  };
}

export function DoctorPanel({ serverId, serverIds, showToast }: DoctorPanelProps) {
  const [results, setResults] = React.useState<DoctorResult[]>([]);
  const [running, setRunning] = React.useState(false);

  const allIds = React.useMemo(() => {
    if (serverIds) return serverIds;
    if (serverId) return [serverId];
    return [];
  }, [serverId, serverIds]);

  async function handleRun() {
    if (allIds.length === 0) return;
    setRunning(true);
    setResults([]);
    try {
      const res = await Promise.all(allIds.map(runDoctorForServer));
      setResults(res);
      const healthy = res.filter((r) => r.healthy).length;
      showToast?.(`${healthy}/${res.length} servers healthy`, healthy === res.length ? "success" : "error");
    } catch {
      showToast?.("Health check failed", "error");
    } finally {
      setRunning(false);
    }
  }

  const healthyCount = results.filter((r) => r.healthy).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {results.length > 0 && (
            <p className="text-sm font-medium">
              {healthyCount}/{results.length} server{results.length !== 1 ? "s" : ""} healthy
            </p>
          )}
        </div>
        <Button size="sm" onClick={handleRun} disabled={running || allIds.length === 0}>
          <RefreshCwIcon className={`size-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Checking..." : allIds.length > 1 ? "Check All" : "Run Health Check"}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((r) => (
            <div key={r.serverId} className="rounded-md border p-4 space-y-2">
              <div className="flex items-center gap-2">
                {r.healthy ? (
                  <CheckCircle2Icon className="size-4 text-green-500 shrink-0" />
                ) : (
                  <XCircleIcon className="size-4 text-red-500 shrink-0" />
                )}
                <span className="font-medium text-sm">
                  {r.serverName || r.serverId}
                </span>
              </div>
              {r.checks.length > 0 && (
                <ul className="space-y-1 ml-6">
                  {r.checks.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {c.pass ? (
                        <CheckCircle2Icon className="size-3.5 text-green-500 mt-0.5 shrink-0" />
                      ) : (
                        <XCircleIcon className="size-3.5 text-red-500 mt-0.5 shrink-0" />
                      )}
                      <span className="font-medium">{c.name}</span>
                      {c.message && (
                        <span className="text-muted-foreground">{c.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && !running && allIds.length > 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Click "Run Health Check" to check server health
        </div>
      )}

      {allIds.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No servers to check
        </div>
      )}
    </div>
  );
}
