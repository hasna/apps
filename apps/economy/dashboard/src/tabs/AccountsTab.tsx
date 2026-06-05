import { useCallback, useEffect, useState } from "react";
import { UserRoundIcon, RefreshCwIcon } from "lucide-react";
import { getAccounts } from "../api";
import type { AccountStat } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Period = "today" | "week" | "month" | "year" | "all";

const periods: Array<{ key: Period; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All" },
];

function formatUsd(val: number) {
  return "$" + (val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTokens(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

function titleCase(value: string) {
  if (!value) return "Unknown";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function accountLabel(account: AccountStat) {
  return account.account_email || account.account_name || account.account_key || "Unknown account";
}

export function AccountsTab() {
  const [period, setPeriod] = useState<Period>("month");
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getAccounts(period)
      .then((response) => setAccounts(response.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load accounts"))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => {
    queueMicrotask(load);
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserRoundIcon className="size-4 text-emerald-500" />
            Accounts
          </CardTitle>
          <div className="flex items-center gap-1 rounded-md border p-1">
            {periods.map((item) => (
              <Button
                key={item.key}
                variant={period === item.key ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPeriod(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <RefreshCwIcon className="size-4 animate-spin" />
              Loading accounts
            </div>
          ) : accounts.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">No account-attributed sessions yet.</p>
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
                  <TableHead className="text-right">Sessions</TableHead>
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
                    <TableCell className="text-right tabular-nums">{account.sessions.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right tabular-nums">{account.requests.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(account.total_tokens)}</TableCell>
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
