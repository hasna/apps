import { useCallback, useEffect, useState } from "react";
import { ServerIcon } from "lucide-react";
import { getFleet } from "../api";
import type { FleetResponse } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatUsd(val: number) {
  return "$" + (val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function FleetTab() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getFleet("month")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load fleet"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const machines = data?.machines ?? [];
  const registry = data?.registry ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ServerIcon className="size-4 text-purple-500" />
            Fleet — All Machines
            {data?.current_machine && (
              <span className="text-xs font-normal text-muted-foreground">
                (this machine: {data.current_machine})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          <div className="rounded-md border p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">Month-to-date (all machines)</div>
            <div className="mt-1 text-2xl font-semibold">
              {loading ? "Loading..." : formatUsd(data?.summary?.total_usd ?? 0)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {data?.summary?.sessions ?? 0} sessions · {data?.summary?.requests ?? 0} requests
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Spend by machine</h3>
            {machines.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">No machine data yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead>Last active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machines.map((m) => (
                    <TableRow key={m.machine_id}>
                      <TableCell className="font-medium">{m.machine_id}</TableCell>
                      <TableCell className="text-right">{formatUsd(m.total_cost_usd)}</TableCell>
                      <TableCell className="text-right">{m.sessions}</TableCell>
                      <TableCell className="text-right">{m.requests}</TableCell>
                      <TableCell className="text-muted-foreground">{formatTime(m.last_active)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {registry.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Sync registry</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Last push</TableHead>
                    <TableHead>Last pull</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registry.map((r) => (
                    <TableRow key={r.machine_id}>
                      <TableCell className="font-medium">{r.machine_id}</TableCell>
                      <TableCell className="text-muted-foreground">{r.economy_version ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatTime(r.last_seen_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatTime(r.last_push_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatTime(r.last_pull_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
