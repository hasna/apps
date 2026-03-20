import { useState, useEffect, useCallback } from "react";
import type { ApiCheck, ApiCheckResult } from "../types";
import {
  getApiChecks,
  createApiCheck,
  deleteApiCheck,
  runApiCheck,
  runAllApiChecks,
  getApiCheckResults,
} from "../lib/api";
import { Spinner } from "./Spinner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Method Badge ─────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, { color: string; bg: string }> = {
  GET: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  POST: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  PUT: { color: "#eab308", bg: "rgba(234,179,8,0.12)" },
  PATCH: { color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  DELETE: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  HEAD: { color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

function MethodBadge({ method }: { method: string }) {
  const style = METHOD_COLORS[method] ?? { color: "var(--text-muted)", bg: "var(--bg)" };
  return (
    <span
      style={{
        color: style.color,
        background: style.bg,
        padding: "2px 7px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "monospace",
        letterSpacing: "0.03em",
      }}
    >
      {method}
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  passed: { color: "var(--green)", bg: "rgba(34,197,94,0.1)" },
  failed: { color: "var(--red)", bg: "rgba(239,68,68,0.1)" },
  error: { color: "#f97316", bg: "rgba(249,115,22,0.1)" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { color: "var(--text-muted)", bg: "var(--bg)" };
  return (
    <span
      style={{
        color: s.color,
        background: s.bg,
        padding: "2px 7px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

// ─── Add Check Modal ──────────────────────────────────────────────────────────

interface AddCheckModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddCheckModal({ onClose, onCreated }: AddCheckModalProps) {
  const [name, setName] = useState("");
  const [method, setMethod] = useState<ApiCheck["method"]>("GET");
  const [url, setUrl] = useState("");
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [bodyContains, setBodyContains] = useState("");
  const [maxResponseTime, setMaxResponseTime] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showBody = method === "POST" || method === "PUT" || method === "PATCH";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      setError("Name and URL are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createApiCheck({
        name: name.trim(),
        method,
        url: url.trim(),
        expectedStatus,
        expectedBodyContains: bodyContains.trim() || undefined,
        expectedResponseTimeMs: maxResponseTime ? parseInt(maxResponseTime, 10) : undefined,
        body: showBody && body.trim() ? body.trim() : undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        enabled: true,
      } as Partial<ApiCheck>);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text)",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--text-muted)",
    display: "block",
    marginBottom: 4,
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, width: 480, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Add API Check</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Health check" autoFocus />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value as ApiCheck["method"])} style={{ ...inputStyle, cursor: "pointer" }}>
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>PATCH</option>
                  <option>DELETE</option>
                  <option>HEAD</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>URL</label>
                <input style={inputStyle} type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/api/health or https://example.com/api" />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 130 }}>
                <label style={labelStyle}>Expected Status</label>
                <input style={inputStyle} type="number" value={expectedStatus} onChange={(e) => setExpectedStatus(parseInt(e.target.value, 10) || 200)} min={100} max={599} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Max Response Time (ms)</label>
                <input style={inputStyle} type="number" value={maxResponseTime} onChange={(e) => setMaxResponseTime(e.target.value)} placeholder="optional" min={1} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Body Contains (optional)</label>
              <input style={inputStyle} type="text" value={bodyContains} onChange={(e) => setBodyContains(e.target.value)} placeholder='e.g. "status":"ok"' />
            </div>

            {showBody && (
              <div>
                <label style={labelStyle}>Request Body</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 80, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder='{"key": "value"}'
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Tags (comma-separated)</label>
              <input style={inputStyle} type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="api, health, critical" />
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--red)", borderRadius: 4, fontSize: 12, color: "var(--red)" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button type="button" onClick={onClose} style={{ padding: "6px 14px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 500, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Adding…" : "Add Check"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Run All Modal ─────────────────────────────────────────────────────────────

interface RunAllModalProps {
  onClose: () => void;
  onDone: () => void;
}

function RunAllModal({ onClose, onDone }: RunAllModalProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ passed: number; failed: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim()) {
      setError("Base URL is required.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await runAllApiChecks({ baseUrl: baseUrl.trim() });
      setResults({ passed: res.passed, failed: res.failed, errors: res.errors });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text)",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, width: 400, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Run All API Checks</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {results ? (
          <div>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", padding: "16px 0" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--green)" }}>{results.passed}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Passed</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--red)" }}>{results.failed}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Failed</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#f97316" }}>{results.errors}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Errors</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 13 }}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleRun}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Base URL</label>
              <input
                style={inputStyle}
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://app.example.com"
                autoFocus
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Relative URLs in checks will be resolved against this base URL.
              </div>
            </div>

            {error && (
              <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--red)", borderRadius: 4, fontSize: 12, color: "var(--red)" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose} style={{ padding: "6px 14px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
                Cancel
              </button>
              <button type="submit" disabled={running} style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: running ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 500, opacity: running ? 0.7 : 1 }}>
                {running ? <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Spinner size={12} /> Running…</span> : "Run All"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── ApiChecksPage ────────────────────────────────────────────────────────────

export function ApiChecksPage() {
  const [checks, setChecks] = useState<ApiCheck[]>([]);
  const [lastResults, setLastResults] = useState<Record<string, ApiCheckResult>>({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRunAllModal, setShowRunAllModal] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "passing" | "failing" | "error">("all");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getApiChecks();
      setChecks(data);
      // Load latest result for each check
      const resultsMap: Record<string, ApiCheckResult> = {};
      await Promise.all(
        data.map(async (check) => {
          try {
            const results = await getApiCheckResults(check.id, 1);
            if (results[0]) resultsMap[check.id] = results[0];
          } catch {
            // ignore per-check result errors
          }
        })
      );
      setLastResults(resultsMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRunCheck = async (check: ApiCheck) => {
    setRunningId(check.id);
    try {
      const result = await runApiCheck(check.id);
      setLastResults((prev) => ({ ...prev, [check.id]: result }));
      showToast(`"${check.name}" — ${result.status.toUpperCase()}${result.responseTimeMs != null ? ` (${result.responseTimeMs}ms)` : ""}`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (check: ApiCheck) => {
    if (!window.confirm(`Delete check "${check.name}"?`)) return;
    try {
      await deleteApiCheck(check.id);
      setChecks((prev) => prev.filter((c) => c.id !== check.id));
      showToast(`Deleted "${check.name}"`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Filter
  const filteredChecks = checks.filter((check) => {
    if (statusFilter === "all") return true;
    const lastResult = lastResults[check.id];
    if (statusFilter === "passing") return lastResult?.status === "passed";
    if (statusFilter === "failing") return lastResult?.status === "failed";
    if (statusFilter === "error") return lastResult?.status === "error";
    return true;
  });

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-card)",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  };
  const btnStyle: React.CSSProperties = {
    padding: "3px 10px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 11,
  };
  const selectStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text)",
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>API Checks</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            Refresh
          </button>
          <button
            onClick={() => setShowRunAllModal(true)}
            style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--green)", background: "rgba(34,197,94,0.1)", color: "var(--green)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            ▶ Run All
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            + Add Check
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Status:</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={selectStyle}>
          <option value="all">All</option>
          <option value="passing">Passing</option>
          <option value="failing">Failing</option>
          <option value="error">Error</option>
        </select>
        {loading && <Spinner size={14} />}
      </div>

      {/* Content */}
      {loading && checks.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
      ) : filteredChecks.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔌</div>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>
            {checks.length === 0 ? "No API checks yet." : "No checks match the current filter."}
          </div>
          <div style={{ fontSize: 12 }}>
            {checks.length === 0
              ? "Add one to start monitoring your endpoints."
              : "Try changing the status filter above."}
          </div>
          {checks.length === 0 && (
            <button
              onClick={() => setShowAddModal(true)}
              style={{ marginTop: 16, padding: "6px 16px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 13 }}
            >
              Add your first check
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Name / URL</th>
                <th style={{ ...thStyle, width: 80 }}>Expected</th>
                <th style={thStyle}>Last Result</th>
                <th style={thStyle}>Last Run</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredChecks.map((check) => {
                const lastResult = lastResults[check.id];
                const isRunning = runningId === check.id;
                return (
                  <tr key={check.id} style={{ opacity: isRunning ? 0.6 : 1, transition: "opacity 0.2s" }}>
                    <td style={tdStyle}>
                      <MethodBadge method={check.method} />
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 280 }}>
                      <div style={{ fontWeight: 500, marginBottom: 2 }}>{check.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {check.url.length > 60 ? check.url.slice(0, 57) + "…" : check.url}
                      </div>
                      {check.tags.length > 0 && (
                        <div style={{ marginTop: 3, display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {check.tags.map((tag) => (
                            <span key={tag} style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, padding: "2px 6px" }}>
                        {check.expectedStatus}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {isRunning ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Spinner size={12} /><span style={{ fontSize: 12, color: "var(--text-muted)" }}>Running…</span></span>
                      ) : lastResult ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <StatusBadge status={lastResult.status} />
                          {lastResult.responseTimeMs != null && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{lastResult.responseTimeMs}ms</span>
                          )}
                          {lastResult.statusCode != null && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>HTTP {lastResult.statusCode}</span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Not run yet</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "var(--text-muted)" }}>
                      {lastResult ? relativeTime(lastResult.createdAt) : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          onClick={() => handleRunCheck(check)}
                          disabled={isRunning}
                          title="Run check"
                          style={{
                            ...btnStyle,
                            color: "var(--blue)",
                            borderColor: "var(--blue)",
                            opacity: isRunning ? 0.5 : 1,
                            cursor: isRunning ? "not-allowed" : "pointer",
                          }}
                        >
                          {isRunning ? "…" : "▶ Run"}
                        </button>
                        <button
                          onClick={() => handleDelete(check)}
                          title="Delete check"
                          style={{ ...btnStyle, color: "var(--red)", borderColor: "var(--red)" }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <AddCheckModal
          onClose={() => setShowAddModal(false)}
          onCreated={load}
        />
      )}

      {showRunAllModal && (
        <RunAllModal
          onClose={() => setShowRunAllModal(false)}
          onDone={load}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "var(--text)", zIndex: 300, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
