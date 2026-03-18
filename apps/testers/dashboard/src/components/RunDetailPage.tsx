import { useState, useEffect } from "react";
import type { Run, Result } from "../types";
import { getRun, getResult, getScreenshotUrl } from "../lib/api";
import { Spinner } from "./Spinner";

const statusColors: Record<string, string> = {
  passed: "var(--green)",
  failed: "var(--red)",
  error: "var(--yellow)",
  skipped: "var(--text-muted)",
};

export function RunDetailPage({ runId, onBack, onSelectResult }: { runId: string; onBack: () => void; onSelectResult: (id: string) => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);

  useEffect(() => {
    getRun(runId)
      .then(({ run, results }) => {
        setRun(run);
        setResults(results);
      })
      .catch(console.error);
  }, [runId]);

  // Shift+click accumulates up to 2 results for comparison
  const [pendingCompareId, setPendingCompareId] = useState<string | null>(null);

  const handleResultClick = (e: React.MouseEvent, resultId: string) => {
    if (e.shiftKey) {
      e.preventDefault();
      if (pendingCompareId && pendingCompareId !== resultId) {
        setCompareIds([pendingCompareId, resultId]);
        setPendingCompareId(null);
      } else {
        setPendingCompareId(resultId);
      }
      return;
    }
    onSelectResult(resultId);
  };

  if (!run) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", display: "flex", justifyContent: "center" }}><Spinner /></div>;

  const leftResult = compareIds ? results.find((r) => r.id === compareIds[0]) ?? null : null;
  const rightResult = compareIds ? results.find((r) => r.id === compareIds[1]) ?? null : null;

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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Results</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {pendingCompareId && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Shift+click a second result to compare
            </span>
          )}
          {compareIds && (
            <button
              onClick={() => setCompareIds(null)}
              style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
            >
              ✕ Close comparison
            </button>
          )}
          {!pendingCompareId && !compareIds && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Shift+click two results to compare</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: compareIds ? 24 : 0 }}>
        {results.map((r) => {
          const isLeft = compareIds?.[0] === r.id;
          const isRight = compareIds?.[1] === r.id;
          const isPending = pendingCompareId === r.id;
          const highlighted = isLeft || isRight || isPending;
          return (
            <div
              key={r.id}
              onClick={(e) => handleResultClick(e, r.id)}
              style={{
                background: "var(--bg-card)",
                border: `1px solid ${highlighted ? "var(--blue)" : "var(--border)"}`,
                borderRadius: 8,
                padding: 14,
                cursor: "pointer",
                outline: highlighted ? "2px solid var(--blue)" : "none",
                outlineOffset: 1,
              }}
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
                {(isLeft || isRight) && (
                  <span style={{ background: "var(--blue)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4 }}>
                    {isLeft ? "LEFT" : "RIGHT"}
                  </span>
                )}
                {isPending && (
                  <span style={{ background: "var(--yellow)", color: "#000", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4 }}>
                    SELECTED
                  </span>
                )}
              </div>
              {r.reasoning && (
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "6px 0 0 0" }}>{r.reasoning}</p>
              )}
              {r.error && (
                <p style={{ color: "var(--red)", fontSize: 12, margin: "6px 0 0 0" }}>{r.error}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Side-by-side comparison panel */}
      {compareIds && leftResult && rightResult && (
        <CompareView left={leftResult} right={rightResult} />
      )}
    </div>
  );
}

// Side-by-side comparison component
function CompareView({ left, right }: { left: Result; right: Result }) {
  return (
    <div style={{ marginTop: 8 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Side-by-side Comparison</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ResultPane result={left} label="LEFT" />
        <ResultPane result={right} label="RIGHT" />
      </div>
    </div>
  );
}

function ResultPane({ result, label }: { result: Result; label: string }) {
  const [screenshots, setScreenshots] = useState<import("../types").Screenshot[]>([]);

  useEffect(() => {
    getResult(result.id)
      .then(({ screenshots }) => setScreenshots(screenshots))
      .catch(() => {});
  }, [result.id]);

  const statusColor = result.status === "passed" ? "var(--green)" : result.status === "failed" ? "var(--red)" : "var(--yellow)";

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ background: "var(--blue)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4 }}>{label}</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{result.scenarioName ?? result.scenarioId.slice(0, 8)}</span>
      </div>

      {/* Stats */}
      <div style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12, borderBottom: "1px solid var(--border)" }}>
        <div><span style={{ color: "var(--text-muted)" }}>Status: </span><span style={{ color: statusColor, fontWeight: 600 }}>{result.status.toUpperCase()}</span></div>
        <div><span style={{ color: "var(--text-muted)" }}>Duration: </span>{(result.durationMs / 1000).toFixed(1)}s</div>
        <div><span style={{ color: "var(--text-muted)" }}>Tokens: </span>{result.tokensUsed}</div>
        <div><span style={{ color: "var(--text-muted)" }}>Steps: </span>{result.stepsCompleted}/{result.stepsTotal}</div>
        <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--text-muted)" }}>Cost: </span>${(result.costCents / 100).toFixed(4)}</div>
      </div>

      {/* Reasoning / Error */}
      {result.reasoning && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>REASONING</div>
          <p style={{ fontSize: 12, margin: 0, color: "var(--text)" }}>{result.reasoning}</p>
        </div>
      )}
      {result.error && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 4, fontWeight: 600 }}>ERROR</div>
          <p style={{ fontSize: 12, margin: 0, color: "var(--red)" }}>{result.error}</p>
        </div>
      )}

      {/* Screenshot thumbnails */}
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>SCREENSHOTS ({screenshots.length})</div>
        {screenshots.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No screenshots</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {screenshots.map((ss) => (
              <div key={ss.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <a href={getScreenshotUrl(ss.id)} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                  <img
                    src={getScreenshotUrl(ss.id)}
                    alt={ss.action}
                    style={{ width: 80, height: 50, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", display: "block" }}
                  />
                </a>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>Step {ss.stepNumber}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{ss.action}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
