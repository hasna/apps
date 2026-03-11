import { useEffect, useState, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { getModels } from "../api";
import type { ModelStat } from "../api";
import { RefreshCwIcon, CopyIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn, type DataTableAction } from "@/components/data-table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

function formatUsd(val: number) {
  return `$${(val ?? 0).toFixed(4)}`;
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

const chartConfig: ChartConfig = {
  cost_usd: { label: "Cost (USD)", color: "hsl(var(--chart-1, 221 83% 53%))" },
};

interface ModelChartEntry {
  model: string;
  cost_usd: number;
}

const columns: DataTableColumn<ModelStat>[] = [
  {
    header: "Model",
    accessor: "model",
    sortable: true,
    render: (val) => <code className="text-xs">{String(val)}</code>,
  },
  {
    header: "Agent",
    accessor: "agent",
    sortable: true,
    render: (val) => <AgentBadge agent={String(val)} />,
  },
  {
    header: "Requests",
    accessor: "requests",
    sortable: true,
    render: (val) => (
      <span className="text-muted-foreground">{((val as number) ?? 0).toLocaleString()}</span>
    ),
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
    header: "Cost",
    accessor: "cost_usd",
    sortable: true,
    render: (val) => <span className="font-semibold">{formatUsd(val as number)}</span>,
  },
];

export function ModelsTab() {
  const [models, setModels] = useState<ModelStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getModels()
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => b.cost_usd - a.cost_usd);
        setModels(sorted);
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

  // Build chart data: aggregate cost per model (top 10)
  const chartData: ModelChartEntry[] = (() => {
    const map = new Map<string, number>();
    for (const m of models) {
      map.set(m.model, (map.get(m.model) ?? 0) + m.cost_usd);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([model, cost_usd]) => ({ model, cost_usd }));
  })();

  if (loading && models.length === 0)
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (error && models.length === 0)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {error}
      </div>
    );

  const actions: DataTableAction<ModelStat>[] = [
    {
      label: "Copy model name",
      icon: <CopyIcon className="size-4" />,
      onClick: (row) => {
        navigator.clipboard.writeText(row.model);
      },
    },
  ];

  return (
    <div className="space-y-6">
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Cost by Model (Top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                />
                <YAxis
                  type="category"
                  dataKey="model"
                  axisLine={false}
                  tickLine={false}
                  width={180}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(val: number) => formatUsd(val)} />}
                />
                <Bar dataKey="cost_usd" fill="var(--color-cost_usd)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Model Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={models}
            searchPlaceholder="Search models..."
            actions={actions}
            getRowId={(row, i) => `${row.model}-${row.agent}-${i}`}
            loading={false}
            error={null}
            emptyMessage="No model data."
          />
        </CardContent>
      </Card>
    </div>
  );
}
