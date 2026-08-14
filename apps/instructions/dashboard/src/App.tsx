import { useState } from "react";
import ConfigsPage from "./pages/ConfigsPage";
import ProfilesPage from "./pages/ProfilesPage";
import ApplyPage from "./pages/ApplyPage";
import HistoryPage from "./pages/HistoryPage";
import MachinesPage from "./pages/MachinesPage";

type Page = "configs" | "profiles" | "apply" | "history" | "machines";

export default function App() {
  const [page, setPage] = useState<Page>("configs");

  return (
    <div style={{ fontFamily: "monospace", minHeight: "100vh", background: "#0d1117", color: "#e6edf3" }}>
      <nav style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", borderBottom: "1px solid #21262d", background: "#161b22" }}>
        <span style={{ fontWeight: "bold", color: "#58a6ff", marginRight: 16 }}>@hasna/configs</span>
        {(["configs", "profiles", "apply", "history", "machines"] as Page[]).map((p) => (
          <button
            key={p}
            onClick={() => setPage(p)}
            style={{
              background: page === p ? "#21262d" : "transparent",
              color: page === p ? "#58a6ff" : "#8b949e",
              border: "1px solid " + (page === p ? "#30363d" : "transparent"),
              borderRadius: 6,
              padding: "4px 12px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </nav>
      <main style={{ padding: 24 }}>
        {page === "configs" && <ConfigsPage />}
        {page === "profiles" && <ProfilesPage />}
        {page === "apply" && <ApplyPage />}
        {page === "history" && <HistoryPage />}
        {page === "machines" && <MachinesPage />}
      </main>
    </div>
  );
}
