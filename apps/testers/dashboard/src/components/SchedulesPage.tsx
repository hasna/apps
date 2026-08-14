import { useState, useEffect } from "react";
import type { Schedule } from "../types";
import { getSchedules, createSchedule, updateSchedule, deleteSchedule } from "../lib/api";
import { triggerRun } from "../lib/api";
import { Spinner } from "./Spinner";

// ─── Cron Human Readable Parser ─────────────────────────────────────────────

function parseCronHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];

  const isAny = (v: string) => v === "*";
  const isNum = (v: string) => /^\d+$/.test(v);

  // Every minute
  if (isAny(minute) && isAny(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
    return "Every minute";
  }
  // Every hour at minute N
  if (isNum(minute) && isAny(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
    return `Every hour at :${minute.padStart(2, "0")}`;
  }
  // Daily at H:MM
  if (isNum(minute) && isNum(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
    const h = parseInt(hour, 10);
    const m = minute.padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Daily at ${h12}:${m} ${ampm}`;
  }
  // Weekly on a day
  if (isNum(minute) && isNum(hour) && isAny(dom) && isAny(month) && isNum(dow)) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = days[parseInt(dow, 10)] ?? dow;
    const h = parseInt(hour, 10);
    const m = minute.padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Weekly on ${dayName} at ${h12}:${m} ${ampm}`;
  }
  // Monthly on day N
  if (isNum(minute) && isNum(hour) && isNum(dom) && isAny(month) && isAny(dow)) {
    const h = parseInt(hour, 10);
    const m = minute.padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Monthly on day ${dom} at ${h12}:${m} ${ampm}`;
  }
  // Every N minutes
  if (minute.startsWith("*/") && isAny(hour)) {
    const n = minute.slice(2);
    return `Every ${n} minutes`;
  }
  // Every N hours
  if (isAny(minute) && hour.startsWith("*/")) {
    const n = hour.slice(2);
    return `Every ${n} hours`;
  }

  return expr;
}

// ─── Date Formatter ──────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return dateStr;
  }
}

// ─── New Schedule Modal ──────────────────────────────────────────────────────

interface NewScheduleModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewScheduleModal({ onClose, onCreated }: NewScheduleModalProps) {
  const [name, setName] = useState("");
  const [cronExpression, setCronExpression] = useState("0 * * * *");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("quick");
  const [parallel, setParallel] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim() || !cronExpression.trim()) {
      setError("Name, URL, and Cron Expression are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createSchedule({
        name: name.trim(),
        cronExpression: cronExpression.trim(),
        url: url.trim(),
        model,
        parallel,
        enabled: true,
        headed: false,
        scenarioFilter: {},
      });
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
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, width: 440, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>New Schedule</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly regression" autoFocus />
            </div>

            <div>
              <label style={labelStyle}>Cron Expression</label>
              <input style={inputStyle} type="text" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} placeholder="0 * * * *" />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                Fields: minute hour day month weekday &nbsp;·&nbsp; {parseCronHuman(cronExpression)}
              </div>
            </div>

            <div>
              <label style={labelStyle}>URL</label>
              <input style={inputStyle} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.example.com" />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="quick">Quick</option>
                  <option value="thorough">Thorough</option>
                  <option value="deep">Deep</option>
                </select>
              </div>
              <div style={{ width: 90 }}>
                <label style={labelStyle}>Parallel</label>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  max={10}
                  value={parallel}
                  onChange={(e) => setParallel(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--red)", borderRadius: 4, fontSize: 12, color: "var(--red)" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "6px 14px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 500, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Creating…" : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── SchedulesPage ───────────────────────────────────────────────────────────

export function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getSchedules()
      .then((data) => { setSchedules(data); setLoading(false); })
      .catch((err) => { console.error(err); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async (schedule: Schedule) => {
    setTogglingId(schedule.id);
    try {
      const updated = await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      setSchedules((prev) => prev.map((s) => s.id === schedule.id ? updated : s));
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    if (!window.confirm(`Delete schedule "${schedule.name}"?`)) return;
    try {
      await deleteSchedule(schedule.id);
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      showToast(`Deleted "${schedule.name}"`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRunNow = async (schedule: Schedule) => {
    setRunningId(schedule.id);
    try {
      await triggerRun({ url: schedule.url, model: schedule.model ?? "quick" });
      showToast(`Run started for "${schedule.name}"`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningId(null);
    }
  };

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Schedules</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            + New Schedule
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Spinner />
        </div>
      ) : schedules.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🗓</div>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>No schedules yet</div>
          <div style={{ fontSize: 12 }}>Create a schedule to run tests automatically on a cron expression.</div>
          <button
            onClick={() => setShowModal(true)}
            style={{ marginTop: 16, padding: "6px 16px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 13 }}
          >
            Create your first schedule
          </button>
        </div>
      ) : (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Cron</th>
                <th style={thStyle}>URL</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Next Run</th>
                <th style={thStyle}>Last Run</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id} style={{ transition: "background 0.1s" }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{schedule.name}</span>
                    {schedule.model && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>
                        {schedule.model}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 12, color: "var(--text-muted)", display: "block" }}>{schedule.cronExpression}</code>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{parseCronHuman(schedule.cronExpression)}</span>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 200 }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", wordBreak: "break-all" }}>{schedule.url}</span>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => handleToggle(schedule)}
                      disabled={togglingId === schedule.id}
                      title={schedule.enabled ? "Click to disable" : "Click to enable"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "3px 8px",
                        borderRadius: 20,
                        border: "1px solid " + (schedule.enabled ? "var(--green)" : "var(--border)"),
                        background: schedule.enabled ? "rgba(34,197,94,0.1)" : "transparent",
                        color: schedule.enabled ? "var(--green)" : "var(--text-muted)",
                        cursor: togglingId === schedule.id ? "not-allowed" : "pointer",
                        fontSize: 11,
                        fontWeight: 600,
                        opacity: togglingId === schedule.id ? 0.6 : 1,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: schedule.enabled ? "var(--green)" : "var(--text-muted)", display: "inline-block" }} />
                      {schedule.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "var(--text-muted)" }}>
                    {formatDate(schedule.nextRunAt)}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "var(--text-muted)" }}>
                    {formatDate(schedule.lastRunAt)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => handleRunNow(schedule)}
                        disabled={runningId === schedule.id}
                        title="Run now"
                        style={{
                          ...btnStyle,
                          color: "var(--blue)",
                          borderColor: "var(--blue)",
                          opacity: runningId === schedule.id ? 0.6 : 1,
                          cursor: runningId === schedule.id ? "not-allowed" : "pointer",
                        }}
                      >
                        {runningId === schedule.id ? "…" : "Run Now"}
                      </button>
                      <button
                        onClick={() => handleDelete(schedule)}
                        title="Delete schedule"
                        style={{ ...btnStyle, color: "var(--red)", borderColor: "var(--red)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <NewScheduleModal
          onClose={() => setShowModal(false)}
          onCreated={load}
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
