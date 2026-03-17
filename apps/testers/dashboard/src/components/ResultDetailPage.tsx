import { useState, useEffect, useCallback } from "react";
import type { Result, Screenshot } from "../types";
import { getResult, getScreenshotUrl } from "../lib/api";
import { Spinner } from "./Spinner";

export function ResultDetailPage({ resultId, onBack }: { resultId: string; onBack: () => void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    getResult(resultId)
      .then(({ result, screenshots }) => {
        setResult(result);
        setScreenshots(screenshots);
      })
      .catch(console.error);
  }, [resultId]);

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const prevSlide = useCallback(() => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i)), []);
  const nextSlide = useCallback(() => setLightboxIndex((i) => (i !== null && i < screenshots.length - 1 ? i + 1 : i)), [screenshots.length]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") prevSlide();
      else if (e.key === "ArrowRight") nextSlide();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, closeLightbox, prevSlide, nextSlide]);

  if (!result) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", display: "flex", justifyContent: "center" }}><Spinner /></div>;

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
          {screenshots.map((ss, idx) => (
            <div
              key={ss.id}
              onClick={() => setLightboxIndex(idx)}
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", cursor: "pointer", transition: "border-color 0.15s" }}
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

      {/* Lightbox modal */}
      {lightboxIndex !== null && screenshots[lightboxIndex] && (() => {
        const ss = screenshots[lightboxIndex]!;
        return (
          <div
            onClick={closeLightbox}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 200,
            }}
          >
            {/* Main content — stop propagation so clicking image doesn't close */}
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: "90vw", maxHeight: "90vh", position: "relative" }}
            >
              {/* Download button */}
              <a
                href={getScreenshotUrl(ss.id)}
                download={`step-${ss.stepNumber}.png`}
                onClick={(e) => e.stopPropagation()}
                title="Download screenshot"
                style={{
                  position: "absolute",
                  top: -8,
                  right: -8,
                  background: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 6,
                  color: "#fff",
                  textDecoration: "none",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: "5px 8px",
                  cursor: "pointer",
                  zIndex: 10,
                }}
              >
                ⬇
              </a>

              {/* Step overlay */}
              <div style={{ color: "#fff", fontSize: 13, marginBottom: 10, opacity: 0.7 }}>
                Step {ss.stepNumber} of {screenshots.length}
              </div>

              <img
                src={getScreenshotUrl(ss.id)}
                alt={ss.action}
                style={{ maxWidth: "80vw", maxHeight: "75vh", borderRadius: 8, display: "block" }}
              />

              {/* Description */}
              <div style={{ marginTop: 12, color: "#fff", fontSize: 14, fontWeight: 500, textAlign: "center" }}>
                {ss.action}
              </div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 4 }}>
                {ss.width}×{ss.height}
              </div>

              {/* Prev / Next */}
              <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); prevSlide(); }}
                  disabled={lightboxIndex === 0}
                  style={{ padding: "6px 18px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.08)", color: lightboxIndex === 0 ? "rgba(255,255,255,0.2)" : "#fff", cursor: lightboxIndex === 0 ? "default" : "pointer", fontSize: 13 }}
                >
                  ← Prev
                </button>
                <button
                  onClick={closeLightbox}
                  style={{ padding: "6px 18px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 13 }}
                >
                  ✕ Close
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); nextSlide(); }}
                  disabled={lightboxIndex === screenshots.length - 1}
                  style={{ padding: "6px 18px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.08)", color: lightboxIndex === screenshots.length - 1 ? "rgba(255,255,255,0.2)" : "#fff", cursor: lightboxIndex === screenshots.length - 1 ? "default" : "pointer", fontSize: 13 }}
                >
                  Next →
                </button>
              </div>
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 8 }}>
                ← → arrow keys to navigate · Esc to close
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
