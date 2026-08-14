import { useState, useEffect } from "react";
import { getStats } from "../lib/api";

interface TrendPoint {
  date: string;
  passRate: number | null;
  runs: number;
}

function Sparkline({ points, width = 120, height = 32 }: { points: TrendPoint[]; width?: number; height?: number }) {
  if (points.length < 2) return null;

  const rates = points.map((p) => p.passRate ?? 0);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 1;

  const toX = (i: number) => (i / (points.length - 1)) * width;
  const toY = (v: number) => height - ((v - min) / range) * (height - 4) - 2;

  const pathD = rates.map((r, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(r).toFixed(1)}`).join(" ");

  const lastRate = rates[rates.length - 1] ?? 0;
  const lineColor = lastRate >= 80 ? "var(--green)" : lastRate >= 50 ? "var(--yellow)" : "var(--red)";

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Last point dot */}
      <circle
        cx={toX(rates.length - 1)}
        cy={toY(lastRate)}
        r={3}
        fill={lineColor}
      />
    </svg>
  );
}

export function TrendChart() {
  const [stats, setStats] = useState<{
    trend: TrendPoint[];
    last7d: { runs: number; passRate: number | null };
    apiChecks: { total: number; passRate: number | null };
  } | null>(null);
  const [days, setDays] = useState<7 | 14 | 30>(30);

  useEffect(() => {
    getStats(days).then(setStats).catch(console.error);
  }, [days]);

  if (!stats || stats.trend.length === 0) return null;

  const { last7d, apiChecks, trend } = stats;
  const lastRate = trend[trend.length - 1]?.passRate;
  const rateColor = (r: number | null) =>
    r == null ? "var(--text-muted)" : r >= 80 ? "var(--green)" : r >= 50 ? "var(--yellow)" : "var(--red)";

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
      padding: "16px 20px", marginBottom: 24, display: "flex", gap: 32, alignItems: "center",
      flexWrap: "wrap",
    }}>
      {/* Sparkline */}
      <div style={{ flex: "1 1 180px", minWidth: 160 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            Pass Rate Trend
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {([7, 14, 30] as const).map((d) => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: "2px 7px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                background: days === d ? "var(--accent)" : "transparent",
                color: days === d ? "#fff" : "var(--text-muted)",
                border: "1px solid " + (days === d ? "var(--accent)" : "var(--border)"),
              }}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <Sparkline points={trend} width={140} height={36} />
          {lastRate != null && (
            <span style={{ fontSize: 22, fontWeight: 700, color: rateColor(lastRate), lineHeight: 1 }}>
              {lastRate}%
            </span>
          )}
        </div>
      </div>

      <div style={{ width: 1, height: 48, background: "var(--border)", flexShrink: 0 }} />

      {/* Last 7d summary */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: rateColor(last7d.passRate) }}>
          {last7d.passRate != null ? `${last7d.passRate}%` : "—"}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          Last 7d avg · {last7d.runs} run{last7d.runs !== 1 ? "s" : ""}
        </div>
      </div>

      <div style={{ width: 1, height: 48, background: "var(--border)", flexShrink: 0 }} />

      {/* API checks */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: rateColor(apiChecks.passRate) }}>
          {apiChecks.passRate != null ? `${apiChecks.passRate}%` : "—"}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          API checks · {apiChecks.total} result{apiChecks.total !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
