import { useState, useEffect } from "react";
import { getCoverage } from "../lib/api";
import { Spinner } from "./Spinner";

type CoverageRoute = { path: string; type: "scenario"; scenarioCount: number; scenarios: string[]; lastPassRate: number | null };
type ApiRoute = { path: string; type: "api_check"; checkCount: number };

function PassRateBadge({ rate }: { rate: number | null }) {
  if (rate == null) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>not run</span>;
  const color = rate >= 80 ? "var(--green)" : rate >= 50 ? "var(--yellow)" : "var(--red)";
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}22`, borderRadius: 4, padding: "2px 7px" }}>
      {rate}%
    </span>
  );
}

function CoverageBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 80, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--blue)", borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 16 }}>{count}</span>
    </div>
  );
}

export function CoveragePage() {
  const [data, setData] = useState<{ routes: CoverageRoute[]; apiRoutes: ApiRoute[]; totalCovered: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | "scenario" | "api_check">("all");
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  useEffect(() => {
    getCoverage().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>;
  if (!data) return null;

  const { routes, apiRoutes, totalCovered } = data;
  const maxCount = Math.max(...routes.map((r) => r.scenarioCount), ...apiRoutes.map((r) => r.checkCount), 1);

  const allRows = [
    ...(typeFilter !== "api_check" ? routes : []),
    ...(typeFilter !== "scenario" ? apiRoutes.map((r) => ({ ...r, scenarioCount: r.checkCount, scenarios: [], lastPassRate: null })) : []),
  ];

  return (
    <div style={{ padding: "24px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Coverage Map</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Routes and pages covered by test scenarios and API checks
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--blue)" }}>{totalCovered}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>paths covered</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["all", "scenario", "api_check"] as const).map((f) => (
          <button key={f} onClick={() => setTypeFilter(f)} style={{
            padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: typeFilter === f ? "var(--accent)" : "var(--surface)",
            color: typeFilter === f ? "#fff" : "var(--text-muted)",
            border: "1px solid var(--border)",
          }}>
            {f === "all" ? "All" : f === "scenario" ? "Browser Scenarios" : "API Checks"}
          </button>
        ))}
      </div>

      {allRows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 32px", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No coverage data yet</div>
          <div style={{ fontSize: 13 }}>
            Add <code>targetPath</code> to scenarios or create API checks to see coverage here.
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
                {["Path / URL", "Type", "Coverage", "Last Pass Rate", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allRows.map((row, i) => {
                const isExpanded = expandedPath === row.path;
                const isScenario = row.type === "scenario";
                const count = "checkCount" in row ? row.checkCount : row.scenarioCount;
                return (
                  <>
                    <tr
                      key={row.path}
                      onClick={() => isScenario && setExpandedPath(isExpanded ? null : row.path)}
                      style={{
                        borderBottom: i < allRows.length - 1 && !isExpanded ? "1px solid var(--border)" : "none",
                        cursor: isScenario ? "pointer" : "default",
                        background: isExpanded ? "rgba(59,130,246,0.05)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 12 }}>
                        <span style={{ color: "var(--text)" }}>{row.path}</span>
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                          background: isScenario ? "rgba(59,130,246,0.1)" : "rgba(34,197,94,0.1)",
                          color: isScenario ? "var(--blue)" : "var(--green)",
                        }}>
                          {isScenario ? "Scenario" : "API Check"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <CoverageBar count={count} max={maxCount} />
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        {isScenario ? <PassRateBadge rate={(row as CoverageRoute).lastPassRate} /> : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 16px", color: "var(--text-muted)", fontSize: 11 }}>
                        {isScenario && <span>{isExpanded ? "▲" : "▼"}</span>}
                      </td>
                    </tr>
                    {isExpanded && isScenario && (row as CoverageRoute).scenarios.length > 0 && (
                      <tr key={`${row.path}-detail`}>
                        <td colSpan={5} style={{ padding: "0 16px 12px 32px", background: "rgba(0,0,0,0.1)", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 8 }}>Scenarios covering this path:</div>
                          <ul style={{ margin: "4px 0 0 0", paddingLeft: 16 }}>
                            {(row as CoverageRoute).scenarios.map((name) => (
                              <li key={name} style={{ fontSize: 12, color: "var(--text)", padding: "2px 0" }}>{name}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
