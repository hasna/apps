import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { getBilling, syncBilling } from "../api";
import type { BillingSummary } from "../api";
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

export function BillingTab() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getBilling("month")
      .then((r) => setSummary(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load billing"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
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

  const rows = Object.entries(summary?.by_provider ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Provider Billing</CardTitle>
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              <RefreshCwIcon className={`size-3.5 mr-1 ${syncing ? "animate-spin" : ""}`} />
              Sync Billing
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          <div className="rounded-md border p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">Month To Date</div>
            <div className="mt-1 text-2xl font-semibold">
              {loading ? "Loading..." : formatUsd(summary?.total_usd ?? 0)}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Actual Billed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground">
                    No billing data synced.
                  </TableCell>
                </TableRow>
              ) : rows.map(([provider, cost]) => (
                <TableRow key={provider}>
                  <TableCell className="font-medium capitalize">{provider}</TableCell>
                  <TableCell className="text-right">{formatUsd(cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
