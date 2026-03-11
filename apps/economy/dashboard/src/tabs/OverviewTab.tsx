import { useEffect, useState, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { getSummary, getDaily, syncSources } from "../api";
import type { Summary, DailyEntry } from "../api";
import {
  DollarSignIcon,
  CalendarIcon,
  BarChart3Icon,
  RefreshCwIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

function formatUsd(val: number) {
  if (val == null) return "$0.00";
  if (val >= 0.01) {
    return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "$" + val.toFixed(6);
}

function formatTokens(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

function formatDate(d: string) {
  return d.slice(5);
}

interface ChartEntry {
  date: string;
  claude: number;
  codex: number;
}

function buildChartData(entries: DailyEntry[]): ChartEntry[] {
  const map = new Map<string, ChartEntry>();
  for (const e of entries) {
    const key = e.date;
    if (!map.has(key)) map.set(key, { date: formatDate(key), claude: 0, codex: 0 });
    const row = map.get(key)!;
    if (e.agent === "claude") row.claude += e.cost_usd;
    else if (e.agent === "codex") row.codex += e.cost_usd;
    else row.claude += e.cost_usd;
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const chartConfig: ChartConfig = {
  claude: { label: "Claude", color: "hsl(var(--chart-1, 221 83% 53%))" },
  codex: { label: "Codex", color: "hsl(var(--chart-2, 24 95% 53%))" },
};

export function OverviewTab() {
  const [todaySummary, setTodaySummary] = useState<Summary | null>(null);
  const [weekSummary, setWeekSummary] = useState<Summary | null>(null);
  const [monthSummary, setMonthSummary] = useState<Summary | null>(null);
  const [chartData, setChartData] = useState<ChartEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, w, m, daily] = await Promise.all([
        getSummary("today"),
        getSummary("week"),
        getSummary("month"),
        getDaily(30),
      ]);
      setTodaySummary(t.data);
      setWeekSummary(w.data);
      setMonthSummary(m.data);
      setChartData(buildChartData(daily.data));
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(), 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await syncSources("all");
      setSyncMsg("Sync complete");
      load();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 3000);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {error}
      </div>
    );

  const statCards = [
    {
      label: "Today",
      value: formatUsd(todaySummary?.total_usd ?? 0),
      sub: `${formatCount(todaySummary?.sessions ?? 0)} sessions`,
      icon: CalendarIcon,
      color: "text-blue-500",
    },
    {
      label: "This Week",
      value: formatUsd(weekSummary?.total_usd ?? 0),
      sub: `${formatCount(weekSummary?.sessions ?? 0)} sessions`,
      icon: TrendingUpIcon,
      color: "text-green-500",
    },
    {
      label: "This Month",
      value: formatUsd(monthSummary?.total_usd ?? 0),
      sub: `${formatCount(monthSummary?.sessions ?? 0)} sessions`,
      icon: BarChart3Icon,
      color: "text-purple-500",
    },
    {
      label: "Monthly Requests",
      value: formatCount(monthSummary?.requests ?? 0),
      sub: `${formatTokens(monthSummary?.tokens ?? 0)} tokens`,
      icon: DollarSignIcon,
      color: "text-orange-500",
    },
  ];

  const timeSince = Math.round((Date.now() - lastUpdated.getTime()) / 1000);
  const lastUpdatedText = timeSince < 5 ? "just now" : `${timeSince}s ago`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <span className="text-xs text-muted-foreground">Last updated: {lastUpdatedText}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`size-4 ${c.color}`} />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{c.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3Icon className="size-4 text-blue-500" />
              Daily Cost — Last 30 Days
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border">
                <button
                  className={`px-2.5 py-1 text-xs font-medium rounded-l-md transition-colors ${chartType === "line" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  onClick={() => setChartType("line")}
                >
                  Line
                </button>
                <button
                  className={`px-2.5 py-1 text-xs font-medium rounded-r-md transition-colors ${chartType === "bar" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  onClick={() => setChartType("bar")}
                >
                  Bar
                </button>
              </div>
              {syncMsg && (
                <span className="text-xs text-green-600 dark:text-green-400">{syncMsg}</span>
              )}
              <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCwIcon className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Now"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No data available
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
              {chartType === "line" ? (
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    width={60}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(val: number) => formatUsd(val)} />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line
                    type="monotone"
                    dataKey="claude"
                    stroke="var(--color-claude)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="codex"
                    stroke="var(--color-codex)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    width={60}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(val: number) => formatUsd(val)} />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="claude" fill="var(--color-claude)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="codex" fill="var(--color-codex)" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
