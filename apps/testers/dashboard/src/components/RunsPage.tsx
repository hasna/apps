import type { Run } from "../types";

const statusStyles: Record<string, { color: string; bg: string }> = {
  passed: { color: "var(--green)", bg: "rgba(34, 197, 94, 0.1)" },
  failed: { color: "var(--red)", bg: "rgba(239, 68, 68, 0.1)" },
  running: { color: "var(--blue)", bg: "rgba(59, 130, 246, 0.1)" },
  pending: { color: "var(--text-muted)", bg: "rgba(115, 115, 115, 0.1)" },
  cancelled: { color: "var(--yellow)", bg: "rgba(234, 179, 8, 0.1)" },
};

export function RunsPage({ runs, onSelectRun, onRefresh }: { runs: Run[]; onSelectRun: (id: string) => void; onRefresh: () => void }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Test Runs</h2>
        <button onClick={onRefresh} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
          Refresh
        </button>
      </div>

      {runs.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          No runs yet. Use <code style={{ background: "var(--bg-card)", padding: "2px 6px", borderRadius: 4 }}>testers run &lt;url&gt;</code> to start testing.
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
