import { useState, useEffect } from "react";
import type { Run, Result } from "../types";
import { getRun } from "../lib/api";

const statusColors: Record<string, string> = {
  passed: "var(--green)",
  failed: "var(--red)",
  error: "var(--yellow)",
  skipped: "var(--text-muted)",
};

export function RunDetailPage({ runId, onBack, onSelectResult }: { runId: string; onBack: () => void; onSelectResult: (id: string) => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    getRun(runId)
      .then(({ run, results }) => {
        setRun(run);
        setResults(results);
      })
      .catch(console.error);
  }, [runId]);

  if (!run) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>;

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", marginBottom: 16, padding: 0, fontSize: 13 }}>
        Back to Runs
      </button>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0" }}>Run {run.id.slice(0, 8)}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, fontSize: 13 }}>
          <div><span style={{ color: "var(--text-muted)" }}>URL:</span> {run.url}</div>
          <div><span style={{ color: "var(--text-muted)" }}>Model:</span> {run.model}</div>
          <div><span style={{ color: "var(--text-muted)" }}>Status:</span> <span style={{ color: statusColors[run.status] }}>{run.status}</span></div>
          <div><span style={{ color: "var(--green)" }}>{run.passed} passed</span> / <span style={{ color: run.failed > 0 ? "var(--red)" : "var(--text-muted)" }}>{run.failed} failed</span> / {run.total} total</div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Results</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.map((r) => (
          <div
            key={r.id}
            onClick={() => onSelectResult(r.id)}
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: statusColors[r.status] ?? "var(--text-muted)", fontWeight: 600, fontSize: 12 }}>
                {r.status.toUpperCase()}
              </span>
              {r.scenarioShortId && <span style={{ color: "var(--cyan)", fontFamily: "monospace", fontSize: 12 }}>{r.scenarioShortId}</span>}
              <span style={{ fontWeight: 500, fontSize: 13 }}>{r.scenarioName ?? r.scenarioId.slice(0, 8)}</span>
              <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 12 }}>
                {(r.durationMs / 1000).toFixed(1)}s | {r.tokensUsed} tokens | {r.screenshots.length} screenshots
              </span>
            </div>
            {r.reasoning && (
              <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "6px 0 0 0" }}>{r.reasoning}</p>
            )}
            {r.error && (
              <p style={{ color: "var(--red)", fontSize: 12, margin: "6px 0 0 0" }}>{r.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
