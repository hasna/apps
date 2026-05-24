import { useCallback, useEffect, useState } from "react";
import { ScaleIcon, AlertTriangleIcon } from "lucide-react";
import { getBillingDiff, syncBilling } from "../api";
import type { BillingDiffSummary } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

export function ReconciliationTab() {
  const [data, setData] = useState<BillingDiffSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getBillingDiff("month")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reconciliation"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncBilling({ days: 31, providers: ["anthropic", "openai", "gemini"] });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <ScaleIcon className="size-4 text-amber-500" />
              Billing Reconciliation — This Month
            </CardTitle>
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync Billing"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          {data?.is_alert && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangleIcon className="size-4 shrink-0" />
              Estimated spend differs from provider billing by more than {data.threshold_pct}%.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Estimated (telemetry)", value: data?.estimated_usd },
              { label: "Actual (billing)", value: data?.actual_usd },
              { label: "Delta", value: data?.delta_usd },
              { label: "Delta %", value: data?.delta_pct, isPct: true },
            ].map((item) => (
              <div key={item.label} className="rounded-md border p-4">
                <div className="text-xs font-medium uppercase text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-xl font-semibold">
                  {loading ? "…" : item.isPct
                    ? `${(item.value ?? 0).toFixed(1)}%`
                    : formatUsd(item.value ?? 0)}
                </div>
              </div>
            ))}
          </div>
          {(data?.by_agent?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Estimated</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.by_agent.map((row) => (
                  <TableRow key={row.agent}>
                    <TableCell className="font-medium capitalize">{row.agent}</TableCell>
                    <TableCell className="text-right">{formatUsd(row.estimated_usd)}</TableCell>
                    <TableCell className="text-right">{formatUsd(row.actual_usd)}</TableCell>
                    <TableCell className="text-right">
                      {formatUsd(row.delta_usd)} ({row.delta_pct.toFixed(1)}%)
                    </TableCell>
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
