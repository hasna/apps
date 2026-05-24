import { useCallback, useEffect, useState } from "react";
import { PiggyBankIcon } from "lucide-react";
import { getSavings } from "../api";
import type { SavingsSummary } from "../api";
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

export function SavingsTab() {
  const [data, setData] = useState<SavingsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getSavings("month")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load savings"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const byAgent = Object.entries(data?.by_agent ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PiggyBankIcon className="size-4 text-green-500" />
            Subscription vs API Savings — This Month
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "API Equivalent", value: data?.api_equivalent_usd },
              { label: "Subscription Fee", value: data?.subscription_fee_usd },
              { label: "On-demand", value: data?.on_demand_usd },
              { label: "Saved", value: data?.saved_usd },
            ].map((item) => (
              <div key={item.label} className="rounded-md border p-4">
                <div className="text-xs font-medium uppercase text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-xl font-semibold">
                  {loading ? "…" : formatUsd(item.value ?? 0)}
                </div>
              </div>
            ))}
          </div>
          {byAgent.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">API Equiv.</TableHead>
                  <TableHead className="text-right">Included</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byAgent.map(([agent, row]) => (
                  <TableRow key={agent}>
                    <TableCell className="font-medium capitalize">{agent}</TableCell>
                    <TableCell className="text-right">{formatUsd(row.api_equivalent_usd ?? 0)}</TableCell>
                    <TableCell className="text-right">{formatUsd(row.included_consumed_usd ?? 0)}</TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400">
                      {formatUsd(row.saved_usd ?? 0)}
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
