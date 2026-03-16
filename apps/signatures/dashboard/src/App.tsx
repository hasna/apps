import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = "/api";

async function fetchJson(path: string) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

type Tab = "documents" | "signatures" | "projects" | "collections" | "stats";

const styles: Record<string, React.CSSProperties> = {
  app: { maxWidth: 1200, margin: "0 auto", padding: "24px 16px" },
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 32 },
  logo: { fontSize: 28, fontWeight: 800, color: "#3b82f6" },
  nav: { display: "flex", gap: 8, marginBottom: 24 },
  tab: { padding: "8px 16px", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", background: "white", fontSize: 14, fontWeight: 500 },
  tabActive: { background: "#3b82f6", color: "white", border: "1px solid #3b82f6" },
  card: { background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 },
  statCard: { background: "white", borderRadius: 12, padding: 24, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  statNum: { fontSize: 48, fontWeight: 800, color: "#3b82f6", display: "block" },
  statLabel: { fontSize: 14, color: "#64748b", marginTop: 4 },
};

const statusColors: Record<string, string> = {
  draft: "#94a3b8",
  pending: "#f59e0b",
  completed: "#10b981",
  cancelled: "#ef4444",
};

function DocumentsTab() {
  const { data, isLoading, error } = useQuery({ queryKey: ["documents"], queryFn: () => fetchJson("/documents") });
  if (isLoading) return <div>Loading documents...</div>;
  if (error) return <div style={{ color: "red" }}>Failed to load documents</div>;
  const docs = (data as Array<Record<string, unknown>>) ?? [];
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Documents ({docs.length})</h2>
      {docs.length === 0 && <p style={{ color: "#94a3b8" }}>No documents yet. Add one via CLI: <code>open-signatures document add &lt;file.pdf&gt;</code></p>}
      {docs.map((doc) => (
        <div key={doc["id"] as string} style={styles["card"]}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <strong>{doc["name"] as string}</strong>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{doc["id"] as string}</div>
              {doc["description"] && <div style={{ fontSize: 14, color: "#475569", marginTop: 4 }}>{doc["description"] as string}</div>}
            </div>
            <span style={{ ...styles["badge"], background: statusColors[doc["status"] as string] ?? "#94a3b8", color: "white" }}>
              {doc["status"] as string}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>{doc["file_name"] as string}</div>
        </div>
      ))}
    </div>
  );
}

function SignaturesTab() {
  const { data, isLoading, error } = useQuery({ queryKey: ["signatures"], queryFn: () => fetchJson("/signatures") });
  if (isLoading) return <div>Loading signatures...</div>;
  if (error) return <div style={{ color: "red" }}>Failed to load signatures</div>;
  const sigs = (data as Array<Record<string, unknown>>) ?? [];
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Signatures ({sigs.length})</h2>
      {sigs.length === 0 && <p style={{ color: "#94a3b8" }}>No signatures yet. Create one: <code>open-signatures signature create --name "Your Name" --type text</code></p>}
      <div style={styles["grid"]}>
        {sigs.map((sig) => (
          <div key={sig["id"] as string} style={styles["card"]}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{sig["name"] as string}</strong>
              <span style={{ ...styles["badge"], background: "#e2e8f0", color: "#475569" }}>{sig["type"] as string}</span>
            </div>
            {sig["text_value"] && (
              <div style={{ marginTop: 8, fontFamily: "cursive", fontSize: 20, color: sig["color"] as string ?? "#000" }}>
                {sig["text_value"] as string}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>{sig["id"] as string}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsTab() {
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => fetchJson("/projects") });
  if (isLoading) return <div>Loading...</div>;
  const items = (data as Array<Record<string, unknown>>) ?? [];
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Projects ({items.length})</h2>
      <div style={styles["grid"]}>
        {items.map((item) => (
          <div key={item["id"] as string} style={{ ...styles["card"], borderLeft: `4px solid ${item["color"] ?? "#3b82f6"}` }}>
            <strong>{item["name"] as string}</strong>
            {item["description"] && <div style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>{item["description"] as string}</div>}
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>{item["id"] as string}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CollectionsTab() {
  const { data, isLoading } = useQuery({ queryKey: ["collections"], queryFn: () => fetchJson("/collections") });
  if (isLoading) return <div>Loading...</div>;
  const items = (data as Array<Record<string, unknown>>) ?? [];
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Collections ({items.length})</h2>
      <div style={styles["grid"]}>
        {items.map((item) => (
          <div key={item["id"] as string} style={styles["card"]}>
            <strong>{item["name"] as string}</strong>
            {item["description"] && <div style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>{item["description"] as string}</div>}
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>{item["id"] as string}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsTab() {
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchJson("/stats") });
  if (isLoading) return <div>Loading...</div>;
  const stats = (data as Record<string, unknown>) ?? {};
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Statistics</h2>
      <div style={styles["grid"]}>
        {[
          { label: "Documents", key: "total_documents" },
          { label: "Signatures", key: "total_signatures" },
          { label: "Projects", key: "total_projects" },
          { label: "Collections", key: "total_collections" },
          { label: "Tags", key: "total_tags" },
          { label: "Placements", key: "total_placements" },
          { label: "Sessions", key: "total_sessions" },
        ].map(({ label, key }) => (
          <div key={key} style={styles["statCard"]}>
            <span style={styles["statNum"]}>{(stats[key] as number) ?? 0}</span>
            <span style={styles["statLabel"]}>{label}</span>
          </div>
        ))}
      </div>
      {stats["by_status"] && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 12 }}>Documents by Status</h3>
          <div style={styles["grid"]}>
            {Object.entries(stats["by_status"] as Record<string, number>).map(([status, count]) => (
              <div key={status} style={{ ...styles["statCard"], borderTop: `4px solid ${statusColors[status] ?? "#94a3b8"}` }}>
                <span style={{ ...styles["statNum"], color: statusColors[status] ?? "#94a3b8" }}>{count}</span>
                <span style={styles["statLabel"]}>{status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("documents");

  return (
    <div style={styles["app"]}>
      <div style={styles["header"]}>
        <span style={styles["logo"]}>✍ Open Signatures</span>
        <span style={{ color: "#94a3b8", fontSize: 14 }}>Open source e-signature platform</span>
      </div>

      <nav style={styles["nav"]}>
        {(["documents", "signatures", "projects", "collections", "stats"] as Tab[]).map((t) => (
          <button
            key={t}
            style={{ ...styles["tab"], ...(tab === t ? styles["tabActive"] : {}) }}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "documents" && <DocumentsTab />}
      {tab === "signatures" && <SignaturesTab />}
      {tab === "projects" && <ProjectsTab />}
      {tab === "collections" && <CollectionsTab />}
      {tab === "stats" && <StatsTab />}
    </div>
  );
}
