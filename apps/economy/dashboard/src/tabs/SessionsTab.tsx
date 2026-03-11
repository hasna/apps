import { useEffect, useState, useCallback } from "react";
import { getSessions } from "../api";
import type { Session } from "../api";
import { SearchIcon, ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatUsd(val: number) {
  if (val == null) return "$0.0000";
  return `$${val.toFixed(4)}`;
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleString();
}

function AgentBadge({ agent }: { agent: string }) {
  const colors: Record<string, string> = {
    claude: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    codex: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[agent] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
    >
      {agent}
    </span>
  );
}

export function SessionsTab() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSessions({
        agent: agentFilter || undefined,
        project: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setSessions(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [agentFilter, search, page]);

  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by project..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-8 h-9"
          />
        </div>
        <select
          value={agentFilter}
          onChange={(e) => { setAgentFilter(e.target.value); setPage(0); }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">All agents</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200 m-4">
              {error}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session ID</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No sessions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  sessions.map((s) => (
                    <TableRow key={s.session_id}>
                      <TableCell>
                        <code className="text-xs text-muted-foreground">
                          {truncate(s.session_id, 16)}
                        </code>
                      </TableCell>
                      <TableCell>
                        <AgentBadge agent={s.agent} />
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <span className="text-sm truncate block">
                          {truncate(s.project || s.project_path || "", 30)}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{formatUsd(s.cost_usd)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {(s.total_tokens ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.requests}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(s.started_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={sessions.length < PAGE_SIZE}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
