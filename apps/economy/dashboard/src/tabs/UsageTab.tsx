import { useCallback, useEffect, useState } from "react";
import { ActivityIcon } from "lucide-react";
import { getUsage } from "../api";
import type { UsageResponse } from "../api";
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

export function UsageTab() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getUsage("month")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load usage"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const snaps = data?.snapshots ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ActivityIcon className="size-4 text-blue-500" />
            Subscription Usage — This Month
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          <div className="rounded-md border p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">Fleet API-equivalent spend</div>
            <div className="mt-1 text-2xl font-semibold">
              {loading ? "Loading..." : formatUsd(data?.summary?.total_usd ?? 0)}
            </div>
          </div>
          {snaps.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">
              No usage snapshots yet. Run <code className="text-xs">economy sync --cursor</code> to ingest Cursor quotas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Machine</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snaps.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium capitalize">{s.agent}</TableCell>
                    <TableCell>{s.metric}</TableCell>
                    <TableCell className="text-right">
                      {s.value.toLocaleString("en-US")}{s.unit ? ` ${s.unit}` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.date}</TableCell>
                    <TableCell className="text-muted-foreground">{s.machine_id || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
