import { useState, useEffect, useRef, createContext } from "react";
import type { Scenario, Run } from "./types";
import { getScenarios, getRuns, getRun, getResult, getStatus, triggerRun } from "./lib/api";
import { ScenariosPage } from "./components/ScenariosPage";
import { RunsPage } from "./components/RunsPage";
import { RunDetailPage } from "./components/RunDetailPage";
import { ResultDetailPage } from "./components/ResultDetailPage";
import { ErrorBoundary } from "./components/ErrorBoundary";

type Page =
  | { type: "scenarios" }
  | { type: "runs" }
  | { type: "run-detail"; runId: string }
  | { type: "result-detail"; resultId: string };

// Context for sharing selected scenario + search ref across pages
export const AppContext = createContext<{
  selectedScenarioId: string | null;
  setSelectedScenarioId: (id: string | null) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onCloseModal: (() => void) | null;
  setOnCloseModal: (fn: (() => void) | null) => void;
}>({
  selectedScenarioId: null,
  setSelectedScenarioId: () => {},
  searchInputRef: { current: null },
  onCloseModal: null,
  setOnCloseModal: () => {},
});

export function App() {
  const [page, setPage] = useState<Page>({ type: "scenarios" });
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState<{ scenarioCount: number; runCount: number } | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [onCloseModal, setOnCloseModal] = useState<(() => void) | null>(null);
  const [runToast, setRunToast] = useState<string | null>(null);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("theme");
    return saved ? saved === "dark" : true; // default dark
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }, [isDark]);

  useEffect(() => {
    getScenarios().then(setScenarios).catch(console.error);
    getRuns().then(setRuns).catch(console.error);
    getStatus().then(setStatus).catch(console.error);
  }, []);

  const refresh = () => {
    getScenarios().then(setScenarios).catch(console.error);
    getRuns().then(setRuns).catch(console.error);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || tag === "select";

      // / → focus search input (even if in input, allow if it's not already the search)
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Escape → close modal
      if (e.key === "Escape") {
        if (onCloseModal) {
          onCloseModal();
          return;
        }
        // Also close detail pages
        if (page.type === "run-detail" || page.type === "result-detail") {
          setPage({ type: "runs" });
        }
        return;
      }

      if (isInput) return; // remaining shortcuts don't apply while typing

      // R → run selected scenario
      if (e.key === "r" || e.key === "R") {
        if (selectedScenarioId && page.type === "scenarios") {
          e.preventDefault();
          const scenario = scenarios.find((s) => s.id === selectedScenarioId);
          if (scenario) {
            triggerRun({ scenarioIds: [selectedScenarioId] })
              .then(() => {
                setRunToast(`Run started for "${scenario.name}"`);
                setTimeout(() => setRunToast(null), 3000);
                setTimeout(refresh, 1500);
              })
              .catch((err) => {
                setRunToast(`Error: ${err.message}`);
                setTimeout(() => setRunToast(null), 3000);
              });
          }
        }
        return;
      }

      // E → edit selected scenario
      if (e.key === "e" || e.key === "E") {
        if (selectedScenarioId && page.type === "scenarios") {
          e.preventDefault();
          setEditingScenarioId(selectedScenarioId);
        }
        return;
      }

      // D → view diff (navigate to runs page)
      if (e.key === "d" || e.key === "D") {
        if (page.type === "scenarios") {
          setPage({ type: "runs" });
        }
        return;
      }

      // S → view screenshots (if on run-detail, focus screenshots section — or navigate to runs)
      if (e.key === "s" || e.key === "S") {
        if (page.type === "scenarios" || page.type === "runs") {
          setPage({ type: "runs" });
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page, selectedScenarioId, scenarios, onCloseModal]);

  return (
    <AppContext.Provider value={{ selectedScenarioId, setSelectedScenarioId, searchInputRef, onCloseModal, setOnCloseModal }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
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
          <button
            onClick={() => setIsDark((d) => !d)}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              color: "var(--text-muted)",
            }}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
        </header>

        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            {page.type === "scenarios" && (
              <ScenariosPage
                scenarios={scenarios}
                onRefresh={refresh}
                editScenarioId={editingScenarioId}
                onEditClose={() => setEditingScenarioId(null)}
              />
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
          </ErrorBoundary>
        </div>

        {/* Run toast */}
        {runToast && (
          <div style={{ position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "var(--text)", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
            {runToast}
          </div>
        )}

        {/* Keyboard shortcuts hint bar */}
        <footer style={{ borderTop: "1px solid var(--border)", marginTop: 32, paddingTop: 10, display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
          <ShortcutHint keys={["R"]} label="Run selected" />
          <ShortcutHint keys={["E"]} label="Edit selected" />
          <ShortcutHint keys={["D"]} label="View runs/diff" />
          <ShortcutHint keys={["S"]} label="Screenshots" />
          <ShortcutHint keys={["/"]} label="Search" />
          <ShortcutHint keys={["Esc"]} label="Close / Back" />
        </footer>
      </div>
    </AppContext.Provider>
  );
}

function ShortcutHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
      {keys.map((k) => (
        <kbd key={k} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px", fontSize: 11, fontFamily: "monospace" }}>{k}</kbd>
      ))}
      <span>{label}</span>
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
