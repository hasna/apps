import { useState, useContext, useRef, useEffect } from "react";
import type { Scenario } from "../types";
import { AppContext } from "../app";
import { deleteScenario, triggerRun, getScenarioHistory, createScenario, updateScenario } from "../lib/api";
import { ConfirmModal } from "./ConfirmModal";

const priorityColors: Record<string, string> = {
  critical: "var(--red)",
  high: "var(--yellow)",
  medium: "var(--blue)",
  low: "var(--text-muted)",
};

export function ScenariosPage({ scenarios, onRefresh, editScenarioId, onEditClose }: { scenarios: Scenario[]; onRefresh: () => void; editScenarioId?: string | null; onEditClose?: () => void }) {
  const { selectedScenarioId, setSelectedScenarioId, searchInputRef } = useContext(AppContext);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
  // Local edit modal state (also driven externally via editScenarioId prop for E shortcut)
  const [localEditId, setLocalEditId] = useState<string | null>(null);
  const activeEditId = editScenarioId ?? localEditId;
  const editScenario = activeEditId ? scenarios.find((s) => s.id === activeEditId) ?? null : null;

  const closeEdit = () => {
    setLocalEditId(null);
    onEditClose?.();
  };

  // Deduplicated list of all tags across all scenarios
  const allTags = Array.from(new Set(scenarios.flatMap((s) => s.tags))).sort();

  const toast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 3000);
  };

  const handleDuplicate = (s: Scenario, e: React.MouseEvent) => {
    e.stopPropagation();
    createScenario({
      name: `Copy of ${s.name}`,
      description: s.description,
      steps: s.steps,
      tags: s.tags,
      priority: s.priority,
      model: s.model ?? undefined,
      timeoutMs: s.timeoutMs ?? undefined,
      targetPath: s.targetPath ?? undefined,
      requiresAuth: s.requiresAuth,
    })
      .then(() => {
        toast(`Duplicated "${s.name}" as "Copy of ${s.name}"`);
        onRefresh();
      })
      .catch((err) => toast(`Error: ${err.message}`));
  };

  const filtered = search
    ? scenarios.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())) ||
        s.shortId.toLowerCase().includes(search.toLowerCase())
      )
    : scenarios;

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (checked.size === filtered.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(filtered.map((s) => s.id)));
    }
  };

  const handleRunSelected = () => {
    const ids = Array.from(checked);
    if (ids.length === 0) return;
    triggerRun({ scenarioIds: ids })
      .then(() => {
        toast(`Started run for ${ids.length} scenario${ids.length > 1 ? "s" : ""}`);
        setTimeout(onRefresh, 1500);
      })
      .catch((err) => toast(`Error: ${err.message}`));
  };

  const handleDeleteSelected = () => {
    const ids = Array.from(checked);
    if (ids.length === 0) return;
    setConfirmDelete({ ids });
  };

  const doDelete = (ids: string[]) => {
    setConfirmDelete(null);
    Promise.all(ids.map((id) => deleteScenario(id)))
      .then(() => {
        toast(`Deleted ${ids.length} scenario${ids.length > 1 ? "s" : ""}`);
        setChecked(new Set());
        onRefresh();
      })
      .catch((err) => toast(`Error: ${err.message}`));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Test Scenarios</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={searchInputRef as React.RefObject<HTMLInputElement>}
            type="text"
            placeholder="Search… (/)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 12, width: 180, outline: "none" }}
          />
          <button onClick={onRefresh} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            Refresh
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {scenarios.length === 0
            ? <>No scenarios yet. Use <code style={{ background: "var(--bg-card)", padding: "2px 6px", borderRadius: 4 }}>testers add "scenario name"</code> to create one.</>
            : "No scenarios match your search."}
        </div>
      ) : (
        <>
          {/* Select-all row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingLeft: 4 }}>
            <input
              type="checkbox"
              checked={checked.size === filtered.length && filtered.length > 0}
              onChange={toggleAll}
              style={{ cursor: "pointer" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {checked.size > 0 ? `${checked.size} selected` : "Select all"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((s) => {
              const isSelected = selectedScenarioId === s.id;
              const isChecked = checked.has(s.id);
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedScenarioId(isSelected ? null : s.id)}
                  style={{
                    background: "var(--bg-card)",
                    border: `1px solid ${isSelected ? "var(--blue)" : "var(--border)"}`,
                    borderRadius: 8,
                    padding: 16,
                    cursor: "pointer",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    outline: isSelected ? "2px solid var(--blue)" : "none",
                    outlineOffset: 1,
                  }}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => { e.stopPropagation(); toggleCheck(s.id); }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 3, cursor: "pointer", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ color: "var(--cyan)", fontFamily: "monospace", fontSize: 13 }}>{s.shortId}</span>
                      <span style={{ fontWeight: 600 }}>{s.name}</span>
                      <span style={{ color: priorityColors[s.priority] ?? "var(--text-muted)", fontSize: 12, border: "1px solid", borderRadius: 4, padding: "1px 6px" }}>
                        {s.priority}
                      </span>
                      <button
                        title="Duplicate scenario"
                        onClick={(e) => handleDuplicate(s, e)}
                        style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
                      >
                        ⧉ Duplicate
                      </button>
                    </div>
                    {s.description && (
                      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0" }}>{s.description}</p>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
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
                      <span style={{ marginLeft: "auto" }}>
                        <RunSparkline scenarioId={s.id} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Floating bulk action bar */}
      {checked.size > 0 && (
        <div style={{
          position: "fixed",
          bottom: 70,
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 20px",
          display: "flex",
          gap: 10,
          alignItems: "center",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          zIndex: 50,
          minWidth: 360,
        }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)", marginRight: 4 }}>{checked.size} selected</span>
          <BulkButton color="var(--blue)" onClick={handleRunSelected}>▶ Run Selected</BulkButton>
          <BulkButton color="var(--red)" onClick={handleDeleteSelected}>✕ Delete Selected</BulkButton>
          {!showTagInput ? (
            <BulkButton color="var(--text-muted)" onClick={() => { setShowTagInput(true); setTagSuggestions([]); setTagSuggestionIndex(-1); }}>＋ Add Tag</BulkButton>
          ) : (
            <div style={{ position: "relative", display: "flex", gap: 4, alignItems: "center" }}>
              <input
                autoFocus
                type="text"
                placeholder="tag name"
                value={bulkTagInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setBulkTagInput(val);
                  setTagSuggestionIndex(-1);
                  if (val.trim()) {
                    const lower = val.trim().toLowerCase();
                    setTagSuggestions(allTags.filter((t) => t.toLowerCase().includes(lower) && t.toLowerCase() !== lower));
                  } else {
                    setTagSuggestions(allTags);
                  }
                }}
                onFocus={() => {
                  setTagSuggestions(bulkTagInput.trim() ? allTags.filter((t) => t.toLowerCase().includes(bulkTagInput.toLowerCase())) : allTags);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setTagSuggestionIndex((i) => Math.min(i + 1, tagSuggestions.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setTagSuggestionIndex((i) => Math.max(i - 1, -1));
                    return;
                  }
                  if (e.key === "Enter") {
                    const chosen = tagSuggestionIndex >= 0 ? tagSuggestions[tagSuggestionIndex] : bulkTagInput.trim();
                    if (chosen) {
                      toast(`Tag "${chosen}" would be added (use CLI: testers update --tag ${chosen})`);
                      setBulkTagInput("");
                      setShowTagInput(false);
                      setTagSuggestions([]);
                      setTagSuggestionIndex(-1);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    if (tagSuggestions.length > 0) {
                      setTagSuggestions([]);
                      setTagSuggestionIndex(-1);
                    } else {
                      setShowTagInput(false);
                      setBulkTagInput("");
                    }
                  }
                }}
                style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, width: 120 }}
              />
              {tagSuggestions.length > 0 && (
                <div style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  marginBottom: 4,
                  minWidth: 140,
                  maxHeight: 160,
                  overflowY: "auto",
                  zIndex: 200,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}>
                  {tagSuggestions.map((tag, idx) => (
                    <div
                      key={tag}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        toast(`Tag "${tag}" would be added (use CLI: testers update --tag ${tag})`);
                        setBulkTagInput("");
                        setShowTagInput(false);
                        setTagSuggestions([]);
                        setTagSuggestionIndex(-1);
                      }}
                      style={{
                        padding: "5px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                        background: idx === tagSuggestionIndex ? "var(--blue)" : "transparent",
                        color: idx === tagSuggestionIndex ? "#fff" : "var(--text)",
                      }}
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              )}
              <BulkButton color="var(--text-muted)" onClick={() => { setShowTagInput(false); setBulkTagInput(""); setTagSuggestions([]); }}>Cancel</BulkButton>
            </div>
          )}
          <BulkButton color="var(--text-muted)" onClick={() => setChecked(new Set())}>Clear</BulkButton>
        </div>
      )}

      {/* Edit scenario modal */}
      {editScenario && (
        <EditScenarioModal
          scenario={editScenario}
          onClose={closeEdit}
          onSaved={() => { closeEdit(); onRefresh(); toast(`Saved "${editScenario.name}"`); }}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.ids.length} scenario${confirmDelete.ids.length > 1 ? "s" : ""}?`}
          message="This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => doDelete(confirmDelete.ids)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Toast */}
      {actionToast && (
        <div style={{ position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "var(--text)", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
          {actionToast}
        </div>
      )}
    </div>
  );
}

function RunSparkline({ scenarioId }: { scenarioId: string }) {
  const [history, setHistory] = useState<{ status: string }[]>([]);

  useEffect(() => {
    getScenarioHistory(scenarioId, 10)
      .then(setHistory)
      .catch(() => {});
  }, [scenarioId]);

  const total = 10;
  const dots = Array.from({ length: total }, (_, i) => history[i] ?? null);
  const r = 4;
  const gap = 10;
  const width = total * gap;
  const height = 14;
  const cy = height / 2;

  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }}>
      {dots.map((d, i) => {
        const fill = d === null
          ? "var(--border)"
          : d.status === "passed"
          ? "var(--green)"
          : "var(--red)";
        return <circle key={i} cx={i * gap + r + 1} cy={cy} r={r} fill={fill} opacity={d === null ? 0.4 : 1} />;
      })}
    </svg>
  );
}

function BulkButton({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${color}`, background: "transparent", color, cursor: "pointer", fontSize: 12, fontWeight: 500 }}
    >
      {children}
    </button>
  );
}

function EditScenarioModal({ scenario, onClose, onSaved }: { scenario: Scenario; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description ?? "");
  const [priority, setPriority] = useState(scenario.priority);
  const [tagsRaw, setTagsRaw] = useState(scenario.tags.join(", "));
  const [targetPath, setTargetPath] = useState(scenario.targetPath ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = () => {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    updateScenario(scenario.id, { name: name.trim(), description, priority, tags, targetPath: targetPath || null })
      .then(() => onSaved())
      .catch((err) => { setError(err.message); setSaving(false); });
  };

  const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, width: 480, maxWidth: "90vw", boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Edit Scenario</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>
              {["critical", "high", "medium", "low"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tags (comma-separated)</label>
            <input style={inputStyle} value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="e.g. smoke, auth, regression" />
          </div>
          <div>
            <label style={labelStyle}>Target path (optional)</label>
            <input style={inputStyle} value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder="/path or blank for default URL" />
          </div>
        </div>

        {error && <p style={{ color: "var(--red)", fontSize: 12, marginTop: 12, marginBottom: 0 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "var(--blue)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 500, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
