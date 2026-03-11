import { useEffect, useState, useCallback, useRef } from "react";
import { getSessions } from "../api";
import type { Session } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn, type DataTableAction } from "@/components/data-table";
import { EyeIcon, CopyIcon } from "lucide-react";

const PAGE_SIZE = 25;

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
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

const columns: DataTableColumn<Session>[] = [
  {
    header: "Session ID",
    accessor: "session_id",
    sortable: true,
    render: (val) => (
      <code className="text-xs text-muted-foreground">{truncate(String(val), 16)}</code>
    ),
  },
  {
    header: "Agent",
    accessor: "agent",
    sortable: true,
    render: (val) => <AgentBadge agent={String(val)} />,
  },
  {
    header: "Project",
    accessor: (row) => row.project || row.project_path || "",
    sortable: true,
    render: (val) => (
      <span className="text-sm truncate block max-w-[200px]">{truncate(String(val ?? ""), 30)}</span>
    ),
  },
  {
    header: "Cost",
    accessor: "cost_usd",
    sortable: true,
    render: (val) => <span className="font-medium">{formatUsd(val as number)}</span>,
  },
  {
    header: "Tokens",
    accessor: "total_tokens",
    sortable: true,
    render: (val) => (
      <span className="text-muted-foreground">{((val as number) ?? 0).toLocaleString()}</span>
    ),
  },
  {
    header: "Requests",
    accessor: "requests",
    sortable: true,
    render: (val) => <span className="text-muted-foreground">{val as number}</span>,
  },
  {
    header: "Started",
    accessor: "started_at",
    sortable: true,
    render: (val) => (
      <span className="text-xs text-muted-foreground">{formatDate(String(val))}</span>
    ),
  },
];

export function SessionsTab() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSessions({
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
  }, [search, page]);

  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    intervalRef.current = setInterval(() => load(), 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const actions: DataTableAction<Session>[] = [
    {
      label: "View details",
      icon: <EyeIcon className="size-4" />,
      onClick: (row) => {
        alert(`Session: ${row.session_id}\nAgent: ${row.agent}\nCost: ${formatUsd(row.cost_usd)}\nTokens: ${row.total_tokens?.toLocaleString()}\nRequests: ${row.requests}\nStarted: ${formatDate(row.started_at)}`);
      },
    },
    {
      label: "Copy ID",
      icon: <CopyIcon className="size-4" />,
      onClick: (row) => {
        navigator.clipboard.writeText(row.session_id);
      },
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={sessions}
          searchPlaceholder="Search by project..."
          actions={actions}
          getRowId={(row) => row.session_id}
          loading={loading}
          error={error}
          emptyMessage="No sessions found."
          pageSize={PAGE_SIZE}
          onSearchChange={(val) => { setSearch(val); setPage(0); }}
          searchValue={search}
          onPageChange={setPage}
          currentPage={page}
          totalCount={sessions.length < PAGE_SIZE ? page * PAGE_SIZE + sessions.length : (page + 2) * PAGE_SIZE}
        />
      </CardContent>
    </Card>
  );
}
