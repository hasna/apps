import { useCallback, useEffect, useState } from "react";
import { ActivityIcon, UserRoundIcon } from "lucide-react";
import { getAccounts, getUsage } from "../api";
import type { AccountStat, UsageResponse } from "../api";
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

function accountLabel(account: AccountStat) {
  return account.account_email || account.account_name || account.account_key || "Unknown account";
}

function titleCase(value: string) {
  if (!value) return "Unknown";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function UsageTab() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([getUsage("month"), getAccounts("month")])
      .then(([usage, accountRows]) => {
        setData(usage.data);
        setAccounts(accountRows.data);
      })
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <UserRoundIcon className="size-4 text-emerald-500" />
            Account Attribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">
              No account-attributed sessions yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">API Eq</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Included</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.account_key}>
                    <TableCell>
                      <div className="font-medium">{accountLabel(account)}</div>
                      <div className="text-xs text-muted-foreground">{account.account_key}</div>
                    </TableCell>
                    <TableCell>{titleCase(account.account_tool)}</TableCell>
                    <TableCell className="text-muted-foreground">{account.account_source}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(account.api_equivalent_usd ?? account.cost_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(account.billable_usd ?? account.metered_api_usd ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(account.subscription_included_usd ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{account.requests.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right tabular-nums">{account.total_tokens.toLocaleString("en-US")}</TableCell>
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
