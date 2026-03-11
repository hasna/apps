import { useEffect, useState, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { getProjects } from "../api";
import type { ProjectStat } from "../api";
import { RefreshCwIcon, CopyIcon, WalletIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn, type DataTableAction } from "@/components/data-table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? "\u2026" + s.slice(-n) : s;
}

function formatUsd(val: number) {
  return `$${(val ?? 0).toFixed(4)}`;
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString();
}

const chartConfig: ChartConfig = {
  cost_usd: { label: "Cost (USD)", color: "hsl(var(--chart-1, 221 83% 53%))" },
};

interface ProjectChartEntry {
  name: string;
  cost_usd: number;
}

const columns: DataTableColumn<ProjectStat>[] = [
  {
    header: "Project Name",
    accessor: "project_name",
    sortable: true,
    render: (val) => <span className="font-medium">{(val as string) || "\u2014"}</span>,
  },
  {
    header: "Path",
    accessor: "project_path",
    sortable: true,
    className: "max-w-[280px]",
    render: (val, row) => (
      <code className="text-xs text-muted-foreground" title={row.project_path}>
        {truncate(String(val), 40)}
      </code>
    ),
  },
  {
    header: "Sessions",
    accessor: "sessions",
    sortable: true,
    render: (val) => <span className="text-muted-foreground">{val as number}</span>,
  },
  {
    header: "Cost",
    accessor: "cost_usd",
    sortable: true,
    render: (val) => <span className="font-semibold">{formatUsd(val as number)}</span>,
  },
  {
    header: "Last Active",
    accessor: "last_active",
    sortable: true,
    render: (val) => (
      <span className="text-xs text-muted-foreground">{formatDate(String(val))}</span>
    ),
  },
];

export function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getProjects()
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => b.cost_usd - a.cost_usd);
        setProjects(sorted);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(), 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  // Top 10 projects by cost for chart
  const chartData: ProjectChartEntry[] = projects
    .slice(0, 10)
    .map((p) => ({ name: p.project_name || p.project_path.split("/").pop() || "unknown", cost_usd: p.cost_usd }));

  if (loading && projects.length === 0)
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (error && projects.length === 0)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {error}
      </div>
    );

  const actions: DataTableAction<ProjectStat>[] = [
    {
      label: "Set budget",
      icon: <WalletIcon className="size-4" />,
      onClick: (row) => {
        alert(`Navigate to Budgets tab to set a budget for: ${row.project_path}`);
      },
    },
    {
      label: "Copy path",
      icon: <CopyIcon className="size-4" />,
      onClick: (row) => {
        navigator.clipboard.writeText(row.project_path);
      },
    },
  ];

  return (
    <div className="space-y-6">
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Top 10 Projects by Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
              <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                  width={60}
                />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(val: number) => formatUsd(val)} />}
                />
                <Bar dataKey="cost_usd" fill="var(--color-cost_usd)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={projects}
            searchPlaceholder="Search projects..."
            actions={actions}
            getRowId={(_, i) => String(i)}
            loading={false}
            error={null}
            emptyMessage="No projects found."
          />
        </CardContent>
      </Card>
    </div>
  );
}
