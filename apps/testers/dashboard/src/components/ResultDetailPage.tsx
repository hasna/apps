import { useState, useEffect } from "react";
import type { Result, Screenshot } from "../types";
import { getResult, getScreenshotUrl } from "../lib/api";

export function ResultDetailPage({ resultId, onBack }: { resultId: string; onBack: () => void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  useEffect(() => {
    getResult(resultId)
      .then(({ result, screenshots }) => {
        setResult(result);
        setScreenshots(screenshots);
      })
      .catch(console.error);
  }, [resultId]);

  if (!result) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>;

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", marginBottom: 16, padding: 0, fontSize: 13 }}>
        Back to Run
      </button>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0" }}>
          {result.scenarioName ?? result.scenarioId.slice(0, 8)}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, fontSize: 13 }}>
          <div><span style={{ color: "var(--text-muted)" }}>Status:</span> <span style={{ color: result.status === "passed" ? "var(--green)" : "var(--red)" }}>{result.status.toUpperCase()}</span></div>
          <div><span style={{ color: "var(--text-muted)" }}>Model:</span> {result.model}</div>
          <div><span style={{ color: "var(--text-muted)" }}>Duration:</span> {(result.durationMs / 1000).toFixed(1)}s</div>
          <div><span style={{ color: "var(--text-muted)" }}>Tokens:</span> {result.tokensUsed} (~${(result.costCents / 100).toFixed(4)})</div>
          <div><span style={{ color: "var(--text-muted)" }}>Steps:</span> {result.stepsCompleted}/{result.stepsTotal}</div>
        </div>

        {result.reasoning && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 6px 0" }}>Reasoning</h3>
            <p style={{ fontSize: 13, margin: 0 }}>{result.reasoning}</p>
          </div>
        )}

        {result.error && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--red)", margin: "0 0 6px 0" }}>Error</h3>
            <p style={{ fontSize: 13, margin: 0, color: "var(--red)" }}>{result.error}</p>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Screenshots ({screenshots.length})</h3>

      {screenshots.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No screenshots captured.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {screenshots.map((ss) => (
            <div
              key={ss.id}
              onClick={() => setSelectedScreenshot(ss)}
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", cursor: "pointer" }}
            >
              <img
                src={getScreenshotUrl(ss.id)}
                alt={ss.action}
                style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
              />
              <div style={{ padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Step {ss.stepNumber}: {ss.action}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {ss.width}x{ss.height}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedScreenshot && (
        <div
          onClick={() => setSelectedScreenshot(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 100, cursor: "pointer",
          }}
        >
          <div style={{ maxWidth: "90vw", maxHeight: "90vh" }}>
            <img
              src={getScreenshotUrl(selectedScreenshot.id)}
              alt={selectedScreenshot.action}
              style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 8 }}
            />
            <div style={{ textAlign: "center", marginTop: 12, color: "#fff", fontSize: 14 }}>
              Step {selectedScreenshot.stepNumber}: {selectedScreenshot.action}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
