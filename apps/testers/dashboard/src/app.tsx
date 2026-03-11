import { useState, useEffect } from "react";
import type { Scenario, Run, Result, Screenshot } from "./types";
import { getScenarios, getRuns, getRun, getResult, getStatus } from "./lib/api";
import { ScenariosPage } from "./components/ScenariosPage";
import { RunsPage } from "./components/RunsPage";
import { RunDetailPage } from "./components/RunDetailPage";
import { ResultDetailPage } from "./components/ResultDetailPage";

type Page =
  | { type: "scenarios" }
  | { type: "runs" }
  | { type: "run-detail"; runId: string }
  | { type: "result-detail"; resultId: string };

export function App() {
  const [page, setPage] = useState<Page>({ type: "scenarios" });
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState<{ scenarioCount: number; runCount: number } | null>(null);

  useEffect(() => {
    getScenarios().then(setScenarios).catch(console.error);
    getRuns().then(setRuns).catch(console.error);
    getStatus().then(setStatus).catch(console.error);
  }, []);

  const refresh = () => {
    getScenarios().then(setScenarios).catch(console.error);
    getRuns().then(setRuns).catch(console.error);
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32, borderBottom: "1px solid var(--border)", paddingBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Testers</h1>
        <nav style={{ display: "flex", gap: 8 }}>
          <NavButton active={page.type === "scenarios"} onClick={() => setPage({ type: "scenarios" })}>
            Scenarios {status ? `(${status.scenarioCount})` : ""}
          </NavButton>
          <NavButton active={page.type === "runs" || page.type === "run-detail"} onClick={() => setPage({ type: "runs" })}>
            Runs {status ? `(${status.runCount})` : ""}
          </NavButton>
        </nav>
      </header>

      {page.type === "scenarios" && (
        <ScenariosPage scenarios={scenarios} onRefresh={refresh} />
      )}
      {page.type === "runs" && (
        <RunsPage runs={runs} onSelectRun={(id) => setPage({ type: "run-detail", runId: id })} onRefresh={refresh} />
      )}
      {page.type === "run-detail" && (
        <RunDetailPage
          runId={page.runId}
          onBack={() => setPage({ type: "runs" })}
          onSelectResult={(id) => setPage({ type: "result-detail", resultId: id })}
        />
      )}
      {page.type === "result-detail" && (
        <ResultDetailPage
          resultId={page.resultId}
          onBack={() => setPage({ type: "runs" })}
        />
      )}
    </div>
  );
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        border: "1px solid " + (active ? "var(--blue)" : "var(--border)"),
        background: active ? "var(--blue)" : "transparent",
        color: active ? "#fff" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}
