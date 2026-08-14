import { useState, useEffect } from "react";

interface ActionRecording {
  id: string;
  name: string;
  start_url?: string;
  steps: unknown[];
  created_at: string;
}

interface VideoRecording {
  id: string;
  session_id?: string;
  name: string;
  status: "recording" | "completed" | "failed";
  path?: string;
  url?: string;
  width: number;
  height: number;
  size_bytes?: number;
  duration_ms?: number;
  started_at: string;
  stopped_at?: string;
  error?: string;
}

const panel: React.CSSProperties = {
  background: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const button: React.CSSProperties = {
  border: "none",
  borderRadius: 4,
  padding: "7px 12px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

function sizeLabel(bytes?: number) {
  if (!bytes) return "pending";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function durationLabel(ms?: number) {
  if (!ms) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RecordingsPage({ sessionId }: { sessionId: string | null }) {
  const [recordings, setRecordings] = useState<ActionRecording[]>([]);
  const [videos, setVideos] = useState<VideoRecording[]>([]);
  const [quality, setQuality] = useState("high");
  const [busy, setBusy] = useState(false);

  const activeVideo = sessionId ? videos.find(v => v.session_id === sessionId && v.status === "recording") : undefined;

  const load = () => {
    fetch("/api/recordings").then(r => r.json()).then(d => setRecordings(d.recordings ?? [])).catch(() => {});
    fetch("/api/videos").then(r => r.json()).then(d => setVideos(d.recordings ?? [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const delAction = async (id: string) => {
    await fetch(`/api/recordings/${id}`, { method: "DELETE" });
    load();
  };

  const delVideo = async (id: string) => {
    await fetch(`/api/videos/${id}`, { method: "DELETE" });
    load();
  };

  const startVideo = async () => {
    if (!sessionId) return;
    setBusy(true);
    await fetch("/api/videos/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        quality,
        name: `session-${sessionId.slice(0, 8)}`,
      }),
    }).catch(() => {});
    setBusy(false);
    load();
  };

  const stopVideo = async () => {
    if (!activeVideo) return;
    setBusy(true);
    await fetch(`/api/videos/${activeVideo.id}/stop`, { method: "POST" }).catch(() => {});
    setBusy(false);
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Recordings</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={quality}
            onChange={e => setQuality(e.target.value)}
            style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#e0e0e0", padding: "6px 8px", fontSize: 12 }}
          >
            <option value="source">Source</option>
            <option value="medium">720p</option>
            <option value="high">1080p</option>
            <option value="ultra">4K</option>
          </select>
          {activeVideo ? (
            <button
              onClick={stopVideo}
              disabled={busy}
              style={{ ...button, background: "#f87171", color: "#000" }}
            >{busy ? "Stopping..." : "Stop video"}</button>
          ) : (
            <button
              onClick={startVideo}
              disabled={busy || !sessionId}
              style={{ ...button, background: sessionId ? "#7c9ef8" : "#333", color: sessionId ? "#000" : "#777" }}
            >{busy ? "Starting..." : "Start video"}</button>
          )}
        </div>
      </div>

      {!sessionId && <p style={{ color: "#555", marginTop: 0 }}>Select a session from Sessions tab.</p>}

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>Video</h2>
      {videos.length === 0 && <p style={{ color: "#555" }}>No video recordings yet.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))", gap: 12, marginBottom: 24 }}>
        {videos.map(v => (
          <div key={v.id} style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                  <span style={{ background: v.status === "completed" ? "#4ade8022" : v.status === "failed" ? "#f8717122" : "#facc1522", color: v.status === "completed" ? "#4ade80" : v.status === "failed" ? "#f87171" : "#facc15", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>{v.status}</span>
                </div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 5 }}>
                  {v.width}x{v.height} · {sizeLabel(v.size_bytes)} {v.duration_ms ? `· ${durationLabel(v.duration_ms)}` : ""}
                </div>
              </div>
              <button
                onClick={() => delVideo(v.id)}
                style={{ background: "#f87c7c22", color: "#f87c7c", border: "1px solid #f87c7c44", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}
              >Delete</button>
            </div>
            {v.status === "completed" && (
              <video
                controls
                src={`/api/videos/${v.id}/raw`}
                style={{ width: "100%", aspectRatio: "16 / 9", background: "#000", borderRadius: 6, display: "block" }}
              />
            )}
            {v.error && <div style={{ fontSize: 11, color: "#f87171", marginTop: 8 }}>{v.error}</div>}
            {v.url && <div style={{ fontSize: 11, color: "#555", marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.url}</div>}
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>Actions</h2>
      {recordings.length === 0 && <p style={{ color: "#555" }}>No action recordings yet.</p>}
      {recordings.map(r => (
        <div key={r.id} style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span style={{ marginLeft: 8, background: "#2a2a2a", color: "#888", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>{r.steps.length} steps</span>
            </div>
            <button onClick={() => delAction(r.id)} style={{ background: "#f87c7c22", color: "#f87c7c", border: "1px solid #f87c7c44", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Delete</button>
          </div>
          {r.start_url && <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{r.start_url}</div>}
          <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>{r.created_at}</div>
        </div>
      ))}
    </div>
  );
}
