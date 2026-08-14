import { useEffect, useState } from "react";
import { api, type Config, type Snapshot } from "../api";

const S = {
  card: { background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: 20, marginBottom: 12 } as React.CSSProperties,
  row: (selected: boolean) => ({ padding: "8px 14px", cursor: "pointer", background: selected ? "#21262d" : "transparent", borderBottom: "1px solid #21262d", fontSize: 13 }) as React.CSSProperties,
};

export default function HistoryPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string>("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnap, setSelectedSnap] = useState<Snapshot | null>(null);

  useEffect(() => { api.configs.list().then(setConfigs); }, []);

  const loadSnapshots = async (configId: string) => {
    setSelectedConfig(configId);
    setSelectedSnap(null);
    setSnapshots(await api.configs.snapshots(configId));
  };

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 100px)" }}>
      <div style={{ width: 240 }}>
        <div style={S.card}>
          <div style={{ color: "#8b949e", fontSize: 12, marginBottom: 8 }}>Select config:</div>
          <select
            style={{ background: "#21262d", border: "1px solid #30363d", borderRadius: 6, padding: "6px 10px", color: "#e6edf3", fontSize: 13, width: "100%" }}
            value={selectedConfig}
            onChange={(e) => loadSnapshots(e.target.value)}
          >
            <option value="">Choose…</option>
            {configs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {snapshots.length === 0 && selectedConfig && (
          <div style={{ color: "#8b949e", padding: "0 4px", fontSize: 13 }}>No snapshots yet.</div>
        )}
        {snapshots.map((s) => (
          <div key={s.id} style={S.row(selectedSnap?.id === s.id)} onClick={() => setSelectedSnap(s)}>
            <div style={{ fontWeight: "bold" }}>v{s.version}</div>
            <div style={{ color: "#8b949e", fontSize: 11 }}>{new Date(s.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }}>
        {selectedSnap ? (
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Snapshot v{selectedSnap.version}</h3>
              <div style={{ color: "#8b949e", fontSize: 12 }}>{new Date(selectedSnap.created_at).toLocaleString()}</div>
            </div>
            <pre style={{ background: "#0d1117", borderRadius: 6, padding: 14, overflow: "auto", maxHeight: "calc(100vh - 220px)", fontSize: 12, margin: 0 }}>
              {selectedSnap.content}
            </pre>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#8b949e" }}>
            Select a snapshot to view its content
          </div>
        )}
      </div>
    </div>
  );
}
