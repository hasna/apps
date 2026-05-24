import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { getSummary, getDaily, syncSources, ALL_AGENTS } from "../api";
import type { Summary, DailyEntry } from "../api";
import {
  DollarSignIcon,
  CalendarIcon,
  BarChart3Icon,
  RefreshCwIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
  XIcon,
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
  rawDate: string;
  [agent: string]: string | number;
}

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude",
  takumi: "Takumi",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  cursor: "Cursor",
  pi: "Pi",
  hermes: "Hermes",
};

const AGENT_CHART_VARS = [
  "hsl(var(--chart-1, 221 83% 53%))",
  "hsl(var(--chart-2, 24 95% 53%))",
  "hsl(var(--chart-3, 142 71% 45%))",
  "hsl(var(--chart-4, 262 83% 58%))",
  "hsl(var(--chart-5, 340 75% 55%))",
  "hsl(var(--chart-1, 221 83% 53%))",
  "hsl(var(--chart-2, 24 95% 53%))",
  "hsl(var(--chart-3, 142 71% 45%))",
];

function buildChartData(entries: DailyEntry[]): { rows: ChartEntry[]; agents: string[] } {
  const agentSet = new Set<string>();
  const map = new Map<string, ChartEntry>();
  for (const e of entries) {
    agentSet.add(e.agent);
    const key = e.date;
    if (!map.has(key)) map.set(key, { date: formatDate(key), rawDate: key });
    const row = map.get(key)!;
    row[e.agent] = (Number(row[e.agent] ?? 0)) + e.cost_usd;
  }
  const agents = [...agentSet].sort((a, b) => {
    const ai = ALL_AGENTS.indexOf(a as typeof ALL_AGENTS[number]);
    const bi = ALL_AGENTS.indexOf(b as typeof ALL_AGENTS[number]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  for (const row of map.values()) {
    for (const agent of agents) {
      if (row[agent] == null) row[agent] = 0;
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => a.rawDate.localeCompare(b.rawDate));
  return { rows, agents };
}

function buildChartConfig(agents: string[]): ChartConfig {
  const cfg: ChartConfig = {};
  agents.forEach((agent, i) => {
    cfg[agent] = {
      label: AGENT_LABELS[agent] ?? agent,
      color: AGENT_CHART_VARS[i % AGENT_CHART_VARS.length]!,
    };
  });
  return cfg;
}

function computeSpikes(daily: DailyEntry[]): { spikeDates: Set<string>; spikeCount: number } {
  const byDate = new Map<string, number>();
  for (const d of daily) {
    byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.cost_usd);
  }
  const dates = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const spikeDates = new Set<string>();
  for (let i = 7; i < dates.length; i++) {
    const window = dates.slice(i - 7, i).map((d) => d[1]);
    const avg = window.reduce((s, v) => s + v, 0) / window.length;
    if (dates[i]![1] > avg * 2 && avg > 0) spikeDates.add(dates[i]![0]);
  }
  return { spikeDates, spikeCount: spikeDates.size };
}

export function OverviewTab() {
  const [todaySummary, setTodaySummary] = useState<Summary | null>(null);
  const [weekSummary, setWeekSummary] = useState<Summary | null>(null);
  const [monthSummary, setMonthSummary] = useState<Summary | null>(null);
  const [allChartData, setAllChartData] = useState<ChartEntry[]>([]);
  const [chartAgents, setChartAgents] = useState<string[]>([]);
  const [allDailyEntries, setAllDailyEntries] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
      setAllDailyEntries(daily.data);
      const built = buildChartData(daily.data);
      setAllChartData(built.rows);
      setChartAgents(built.agents);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Filtered chart data based on date range
  const chartData = useMemo(() => {
    if (!dateFrom && !dateTo) return allChartData;
    return allChartData.filter((entry) => {
      if (dateFrom && entry.rawDate < dateFrom) return false;
      if (dateTo && entry.rawDate > dateTo) return false;
      return true;
    });
  }, [allChartData, dateFrom, dateTo]);

  const chartConfig = useMemo(() => buildChartConfig(chartAgents), [chartAgents]);

  // Spike computation over the full dataset (not filtered)
  const { spikeDates, spikeCount } = useMemo(
    () => computeSpikes(allDailyEntries),
    [allDailyEntries]
  );

  useEffect(() => {
    const run = () => load();
    queueMicrotask(run);
    intervalRef.current = setInterval(run, 30000);
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {spikeCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <AlertTriangleIcon className="size-3.5" />
              {spikeCount} spike {spikeCount === 1 ? "day" : "days"} detected
            </div>
          )}
        </div>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3Icon className="size-4 text-blue-500" />
              Daily Cost — Last 30 Days
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Date range filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">From:</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-xs text-muted-foreground">To:</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {(dateFrom || dateTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                  >
                    <XIcon className="size-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
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
                  {chartAgents.map((agent) => (
                    <Line
                      key={agent}
                      type="monotone"
                      dataKey={agent}
                      stroke={`var(--color-${agent})`}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
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
                  {chartAgents.map((agent, i) => (
                    <Bar
                      key={agent}
                      dataKey={agent}
                      fill={`var(--color-${agent})`}
                      radius={i === chartAgents.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      stackId="cost"
                    />
                  ))}
                </BarChart>
              )}
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
