import type { Scenario } from "../types";

const priorityColors: Record<string, string> = {
  critical: "var(--red)",
  high: "var(--yellow)",
  medium: "var(--blue)",
  low: "var(--text-muted)",
};

export function ScenariosPage({ scenarios, onRefresh }: { scenarios: Scenario[]; onRefresh: () => void }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Test Scenarios</h2>
        <button onClick={onRefresh} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
          Refresh
        </button>
      </div>

      {scenarios.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          No scenarios yet. Use <code style={{ background: "var(--bg-card)", padding: "2px 6px", borderRadius: 4 }}>testers add "scenario name"</code> to create one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {scenarios.map((s) => (
            <div key={s.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ color: "var(--cyan)", fontFamily: "monospace", fontSize: 13 }}>{s.shortId}</span>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: priorityColors[s.priority] ?? "var(--text-muted)", fontSize: 12, border: "1px solid", borderRadius: 4, padding: "1px 6px" }}>
                  {s.priority}
                </span>
              </div>
              {s.description && (
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0" }}>{s.description}</p>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {s.tags.map((tag) => (
                  <span key={tag} style={{ background: "var(--bg-hover)", color: "var(--text-muted)", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>
                    {tag}
                  </span>
                ))}
                {s.steps.length > 0 && (
                  <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{s.steps.length} steps</span>
                )}
                {s.model && (
                  <span style={{ color: "var(--text-muted)", fontSize: 11 }}>model: {s.model}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
