import { useState, useEffect } from "react";
import type { Run } from "../types";
import { getRuns } from "../lib/api";
import { Spinner } from "./Spinner";

const statusStyles: Record<string, { color: string; bg: string }> = {
  passed: { color: "var(--green)", bg: "rgba(34, 197, 94, 0.1)" },
  failed: { color: "var(--red)", bg: "rgba(239, 68, 68, 0.1)" },
  running: { color: "var(--blue)", bg: "rgba(59, 130, 246, 0.1)" },
  pending: { color: "var(--text-muted)", bg: "rgba(115, 115, 115, 0.1)" },
  cancelled: { color: "var(--yellow)", bg: "rgba(234, 179, 8, 0.1)" },
};

type DateRange = "24h" | "7d" | "30d" | "all";

function dateRangeToSince(range: DateRange): string | undefined {
  if (range === "all") return undefined;
  const now = Date.now();
  const msMap: Record<string, number> = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
  return new Date(now - msMap[range]!).toISOString();
}

export function RunsPage({ runs: initialRuns, onSelectRun, onRefresh }: { runs: Run[]; onSelectRun: (id: string) => void; onRefresh: () => void }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [loading, setLoading] = useState(false);

  // Sync when parent refreshes
  useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);

  // Re-fetch whenever filters change
  useEffect(() => {
    const params: Record<string, string> = {};
    if (statusFilter !== "all") params.status = statusFilter;
    if (modelFilter !== "all") params.model = modelFilter;
    const since = dateRangeToSince(dateRange);
    if (since) params.since = since;

    setLoading(true);
    getRuns(Object.keys(params).length > 0 ? params : undefined)
      .then((data) => { setRuns(data); setLoading(false); })
      .catch((err) => { console.error(err); setLoading(false); });
  }, [statusFilter, modelFilter, dateRange]);

  const selectStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text)",
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Test Runs</h2>
        <button onClick={onRefresh} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
          Refresh
        </button>
      </div>

      {/* Filter row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Status:</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">All</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="error">Error</option>
          <option value="running">Running</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <label style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>Model:</label>
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} style={selectStyle}>
          <option value="all">All</option>
          <option value="quick">Quick</option>
          <option value="thorough">Thorough</option>
          <option value="deep">Deep</option>
        </select>

        <label style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>Date:</label>
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRange)} style={selectStyle}>
          <option value="all">All time</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7d</option>
          <option value="30d">Last 30d</option>
        </select>

        {loading && <Spinner size={14} />}
      </div>

      {runs.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {loading
            ? <Spinner />
            : <>No runs yet. Use <code style={{ background: "var(--bg-card)", padding: "2px 6px", borderRadius: 4 }}>testers run &lt;url&gt;</code> to start testing.</>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {runs.map((run) => {
            const style = statusStyles[run.status] ?? statusStyles["pending"]!;
            const duration = run.finishedAt
              ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
              : "running...";

            return (
              <div
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ color: style.color, background: style.bg, padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                    {run.status.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-muted)" }}>{run.id.slice(0, 8)}</span>
                  <span style={{ fontWeight: 500 }}>{run.url}</span>
                  <span style={{ marginLeft: "auto", color: "var(--green)", fontSize: 13 }}>{run.passed}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 13 }}>/</span>
                  <span style={{ color: run.failed > 0 ? "var(--red)" : "var(--text-muted)", fontSize: 13 }}>{run.total}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{duration}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
