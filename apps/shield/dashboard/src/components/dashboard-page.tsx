import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { fetchStats } from "../lib/api";
import type { Stats } from "../types";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
  info: "#6b7280",
};

const SCANNER_COLORS: Record<string, string> = {
  secrets: "#ef4444",
  dependencies: "#f97316",
  code: "#eab308",
  "git-history": "#8b5cf6",
  config: "#3b82f6",
  "ai-safety": "#06b6d4",
};

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function scoreBorderColor(score: number): string {
  if (score >= 80) return "border-emerald-500/30";
  if (score >= 50) return "border-yellow-500/30";
  return "border-red-500/30";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  onNavigateToFindings: (scanId: string) => void;
}

export function DashboardPage({ onNavigateToFindings }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-zinc-600 border-t-emerald-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950/50 p-6 text-red-300">
        Failed to load stats: {error}
      </div>
    );
  }

  if (!stats) return null;

  const scannerData = Object.entries(stats.by_scanner).map(([name, count]) => ({
    name,
    count,
  }));

  const severityCards = [
    { key: "critical", label: "Critical", count: stats.by_severity.critical },
    { key: "high", label: "High", count: stats.by_severity.high },
    { key: "medium", label: "Medium", count: stats.by_severity.medium },
    { key: "low", label: "Low", count: stats.by_severity.low },
    { key: "info", label: "Info", count: stats.by_severity.info },
  ];

  return (
    <div className="space-y-8">
      {/* Top row: Score + Severity breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
        {/* Security Score */}
        <div
          className={`lg:col-span-1 rounded-xl border bg-zinc-900 p-6 flex flex-col items-center justify-center ${
            stats.score !== null ? scoreBorderColor(stats.score) : "border-zinc-800"
          }`}
        >
          <p className="text-sm text-zinc-400 mb-2">Security Score</p>
          {stats.score !== null ? (
            <p className={`text-5xl font-bold ${scoreColor(stats.score)}`}>
              {stats.score}
            </p>
          ) : (
            <p className="text-3xl text-zinc-600">--</p>
          )}
          <p className="text-xs text-zinc-500 mt-2">
            {stats.total_findings} total findings
          </p>
        </div>

        {/* Severity Cards */}
        {severityCards.map((s) => (
          <div
            key={s.key}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 flex flex-col items-center justify-center"
          >
            <p className="text-sm text-zinc-400 mb-2">{s.label}</p>
            <p
              className="text-3xl font-bold"
              style={{ color: SEVERITY_COLORS[s.key] }}
            >
              {s.count}
            </p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Findings by Scanner */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold mb-4">Findings by Scanner</h2>
          {scannerData.length === 0 ? (
            <p className="text-zinc-500 text-sm py-10 text-center">
              No scan data yet. Run a scan to see results.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={scannerData}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  axisLine={{ stroke: "#3f3f46" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  axisLine={{ stroke: "#3f3f46" }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                    color: "#f4f4f5",
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {scannerData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={SCANNER_COLORS[entry.name] || "#6b7280"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Scans */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Scans</h2>
          {stats.recent_scans.length === 0 ? (
            <p className="text-zinc-500 text-sm py-10 text-center">
              No scans yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-400 border-b border-zinc-800">
                    <th className="text-left py-2 pr-4 font-medium">Status</th>
                    <th className="text-left py-2 pr-4 font-medium">
                      Findings
                    </th>
                    <th className="text-left py-2 pr-4 font-medium">
                      Duration
                    </th>
                    <th className="text-left py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_scans.slice(0, 5).map((scan) => (
                    <tr
                      key={scan.id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
                      onClick={() => onNavigateToFindings(scan.id)}
                    >
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={scan.status} />
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {scan.findings_count}
                      </td>
                      <td className="py-2.5 pr-4 text-zinc-400 tabular-nums">
                        {formatDuration(scan.duration_ms)}
                      </td>
                      <td className="py-2.5 text-zinc-400">
                        {formatDate(scan.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-400 animate-pulse",
    completed: "bg-emerald-500/20 text-emerald-400",
    failed: "bg-red-500/20 text-red-400",
    pending: "bg-zinc-500/20 text-zinc-400",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}
    >
      {status}
    </span>
  );
}
