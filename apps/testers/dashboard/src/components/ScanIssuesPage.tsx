import { useState, useEffect } from "react";
import type { ScanIssue } from "../types";
import { getScanIssues, resolveScanIssue } from "../lib/api";
import { Spinner } from "./Spinner";

const typeStyles: Record<string, { label: string; color: string }> = {
  console_error:  { label: "Console",  color: "var(--red)" },
  network_error:  { label: "Network",  color: "var(--yellow)" },
  broken_link:    { label: "Link",     color: "var(--blue)" },
  performance:    { label: "Perf",     color: "var(--text-muted)" },
};

const severityStyles: Record<string, { color: string; bg: string }> = {
  critical: { color: "#fff",              bg: "var(--red)" },
  high:     { color: "var(--red)",        bg: "rgba(239,68,68,0.1)" },
  medium:   { color: "var(--yellow)",     bg: "rgba(234,179,8,0.1)" },
  low:      { color: "var(--text-muted)", bg: "rgba(115,115,115,0.1)" },
};

const statusStyles: Record<string, { color: string; bg: string }> = {
  open:      { color: "var(--red)",    bg: "rgba(239,68,68,0.1)" },
  regressed: { color: "var(--yellow)", bg: "rgba(234,179,8,0.1)" },
  resolved:  { color: "var(--green)",  bg: "rgba(34,197,94,0.1)" },
};

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 600, color, background: bg, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function ScanIssuesPage() {
  const [issues, setIssues] = useState<ScanIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const load = (status: string, type: string) => {
    setLoading(true);
    getScanIssues({
      status: status !== "all" ? status : undefined,
      type: type !== "all" ? type : undefined,
    }).then(setIssues).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(statusFilter, typeFilter); }, [statusFilter, typeFilter]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleResolve = async (id: string, name: string) => {
    setResolving((s) => new Set([...s, id]));
    try {
      await resolveScanIssue(id);
      showToast(`Resolved: ${name}`);
      load(statusFilter, typeFilter);
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResolving((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const openCount = issues.filter((i) => i.status === "open" || i.status === "regressed").length;

  return (
    <div style={{ padding: "24px 32px" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 8, padding: "10px 16px",
          color: "var(--text)", zIndex: 1000, fontSize: 13,
        }}>
          {toast}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Scan Issues</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Runtime issues detected by <code>testers scan</code> — console errors, broken links, network failures, performance
          </p>
        </div>
        <div style={{ fontSize: 13, color: openCount > 0 ? "var(--red)" : "var(--green)", fontWeight: 600 }}>
          {openCount} open issue{openCount !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {["open", "regressed", "resolved", "all"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{
            padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: statusFilter === s ? "var(--accent)" : "var(--surface)",
            color: statusFilter === s ? "#fff" : "var(--text-muted)",
            border: "1px solid var(--border)",
          }}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div style={{ marginLeft: 8, display: "flex", gap: 8 }}>
          {["all", "console_error", "network_error", "broken_link", "performance"].map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)} style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              background: typeFilter === t ? "var(--surface-hover)" : "transparent",
              color: typeFilter === t ? "var(--text)" : "var(--text-muted)",
              border: "1px solid " + (typeFilter === t ? "var(--border)" : "transparent"),
            }}>
              {t === "all" ? "All types" : (typeStyles[t]?.label ?? t)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner /></div>
      ) : issues.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "64px 32px", color: "var(--text-muted)",
          border: "1px dashed var(--border)", borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No issues found</div>
          <div style={{ fontSize: 13 }}>
            Run <code>testers scan all &lt;url&gt;</code> to detect console errors, broken links, network failures, and performance issues.
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
                {["Severity", "Type", "Status", "Message", "Page", "Occurrences", "Last Seen", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {issues.map((issue, i) => {
                const sev = severityStyles[issue.severity] ?? severityStyles.medium!;
                const sta = statusStyles[issue.status] ?? statusStyles.open!;
                const typ = typeStyles[issue.type];
                return (
                  <tr key={issue.id} style={{ borderBottom: i < issues.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <Badge label={issue.severity} color={sev.color} bg={sev.bg} />
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ color: typ?.color ?? "var(--text-muted)", fontSize: 12, fontWeight: 500 }}>
                        {typ?.label ?? issue.type}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <Badge label={issue.status} color={sta.color} bg={sta.bg} />
                    </td>
                    <td style={{ padding: "10px 14px", maxWidth: 320 }}>
                      <div style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={issue.message}>
                        {issue.message}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", maxWidth: 200 }}>
                      <span style={{ color: "var(--text-muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", display: "block", whiteSpace: "nowrap" }} title={issue.pageUrl}>
                        {issue.pageUrl.replace(/^https?:\/\/[^/]+/, "")}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text-muted)", textAlign: "center" }}>
                      {issue.occurrenceCount}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {relativeTime(issue.lastSeenAt)}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {issue.status !== "resolved" && (
                        <button
                          onClick={() => handleResolve(issue.id, issue.message.slice(0, 40))}
                          disabled={resolving.has(issue.id)}
                          style={{
                            padding: "4px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                            background: "transparent", color: "var(--green)",
                            border: "1px solid var(--green)", fontWeight: 600,
                            opacity: resolving.has(issue.id) ? 0.5 : 1,
                          }}
                        >
                          {resolving.has(issue.id) ? "..." : "Resolve"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
