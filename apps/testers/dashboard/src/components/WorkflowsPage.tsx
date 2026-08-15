import { useEffect, useState } from "react";
import type { TestingWorkflow } from "../types";
import { getWorkflows, runWorkflow, runWorkflowAgent } from "../lib/api";
import { Spinner } from "./Spinner";

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<TestingWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    getWorkflows({ enabled: true })
      .then(setWorkflows)
      .catch((err) => setToast(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const run = (workflow: TestingWorkflow) => {
    const url = window.prompt("Target URL");
    if (!url) return;
    runWorkflow(workflow.id, { url })
      .then(() => setToast(`Started ${workflow.name}`))
      .catch((err) => setToast(err.message));
  };

  const runAgent = (workflow: TestingWorkflow) => {
    const url = window.prompt("Target URL");
    if (!url) return;
    runWorkflowAgent(workflow.id, { url })
      .then(() => setToast(`Started goal loop for ${workflow.name}`))
      .catch((err) => setToast(err.message));
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Testing Workflows</h2>
        <button onClick={refresh} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
          Refresh
        </button>
      </div>

      {workflows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          No saved workflows yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {workflows.map((workflow) => (
            <div key={workflow.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "monospace", color: "var(--cyan)", fontSize: 12 }}>{workflow.id.slice(0, 8)}</span>
                <strong>{workflow.name}</strong>
                <span style={{ color: workflow.execution.target === "connector:e2b" ? "var(--cyan)" : "var(--green)", border: "1px solid currentColor", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
                  {workflow.execution.target === "connector:e2b" ? "E2B" : "Local"}
                </span>
                <button onClick={() => run(workflow)} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 12 }}>
                  Run
                </button>
                <button onClick={() => runAgent(workflow)} disabled={!workflow.goal} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: workflow.goal ? "var(--text)" : "var(--text-muted)", cursor: workflow.goal ? "pointer" : "not-allowed", fontSize: 12 }}>
                  Agent
                </button>
              </div>
              {workflow.description && <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "8px 0 0" }}>{workflow.description}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
                {workflow.scenarioFilter.tags?.map((tag) => <span key={tag}>tag:{tag}</span>)}
                {workflow.scenarioFilter.priority && <span>priority:{workflow.scenarioFilter.priority}</span>}
                {workflow.personaIds.length > 0 && <span>{workflow.personaIds.length} personas</span>}
                {workflow.goal && <span>goal loop:{workflow.goal.maxIterations}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, zIndex: 100 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
