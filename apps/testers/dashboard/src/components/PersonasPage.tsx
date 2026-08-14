import { useState, useEffect } from "react";
import type { Persona } from "../types";
import { getPersonas, createPersona, deletePersona } from "../lib/api";
import { Spinner } from "./Spinner";
import { ConfirmModal } from "./ConfirmModal";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rolePillColor(role: string): { color: string; bg: string } {
  const hash = role.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const palette = [
    { color: "#3b82f6", bg: "rgba(59,130,246,0.13)" },
    { color: "#8b5cf6", bg: "rgba(139,92,246,0.13)" },
    { color: "#22c55e", bg: "rgba(34,197,94,0.13)" },
    { color: "#f97316", bg: "rgba(249,115,22,0.13)" },
    { color: "#ec4899", bg: "rgba(236,72,153,0.13)" },
    { color: "#06b6d4", bg: "rgba(6,182,212,0.13)" },
  ];
  return palette[hash % palette.length]!;
}

function RoleBadge({ role }: { role: string }) {
  const s = rolePillColor(role);
  return (
    <span
      style={{
        color: s.color,
        background: s.bg,
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {role}
    </span>
  );
}

function ScopeBadge({ projectId }: { projectId: string | null }) {
  return projectId ? (
    <span
      style={{
        color: "var(--text-muted)",
        background: "rgba(107,114,128,0.13)",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      project
    </span>
  ) : (
    <span
      style={{
        color: "#3b82f6",
        background: "rgba(59,130,246,0.13)",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      Global
    </span>
  );
}

// ─── New Persona Modal ────────────────────────────────────────────────────────

interface NewPersonaModalProps {
  onClose: () => void;
  onCreated: (p: Persona) => void;
}

function NewPersonaModal({ onClose, onCreated }: NewPersonaModalProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [traitInput, setTraitInput] = useState("");
  const [traits, setTraits] = useState<string[]>([]);
  const [goalInput, setGoalInput] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTrait = () => {
    const t = traitInput.trim();
    if (t && !traits.includes(t)) setTraits((prev) => [...prev, t]);
    setTraitInput("");
  };

  const addGoal = () => {
    const g = goalInput.trim();
    if (g && !goals.includes(g)) setGoals((prev) => [...prev, g]);
    setGoalInput("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) {
      setError("Name and role are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const persona = await createPersona({
        name: name.trim(),
        role: role.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        traits,
        goals,
        projectId: scope === "global" ? undefined : undefined, // could add project selector
        enabled: true,
      });
      onCreated(persona);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 13,
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    marginBottom: 4,
    display: "block",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 24,
          width: 560,
          maxWidth: "95vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 20px 0" }}>New Persona</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah the First-Timer" />
          </div>
          <div>
            <label style={labelStyle}>Role *</label>
            <input
              style={inputStyle}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="first-time user, admin, power user, security auditor..."
            />
          </div>
          <div>
            <label style={labelStyle}>Scope</label>
            <div style={{ display: "flex", gap: 12 }}>
              {(["global", "project"] as const).map((s) => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                  <input type="radio" checked={scope === s} onChange={() => setScope(s)} />
                  {s === "global" ? "Global (all projects)" : "Project-scoped"}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of who this persona is..."
            />
          </div>
          <div>
            <label style={labelStyle}>Instructions</label>
            <textarea
              style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="How this persona should behave — e.g. Always hesitate before clicking, look for errors..."
            />
          </div>
          <div>
            <label style={labelStyle}>Traits</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={traitInput}
                onChange={(e) => setTraitInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTrait(); } }}
                placeholder="e.g. impatient — press Enter to add"
              />
              <button type="button" onClick={addTrait} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 13 }}>
                Add
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {traits.map((t) => (
                <span
                  key={t}
                  style={{ background: "rgba(107,114,128,0.15)", color: "var(--text-muted)", padding: "2px 8px", borderRadius: 12, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => setTraits((prev) => prev.filter((x) => x !== t))}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}
                  >✕</button>
                </span>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Goals</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGoal(); } }}
                placeholder="e.g. find checkout — press Enter to add"
              />
              <button type="button" onClick={addGoal} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 13 }}>
                Add
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {goals.map((g) => (
                <span
                  key={g}
                  style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6", padding: "2px 8px", borderRadius: 12, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                >
                  {g}
                  <button
                    type="button"
                    onClick={() => setGoals((prev) => prev.filter((x) => x !== g))}
                    style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}
                  >✕</button>
                </span>
              ))}
            </div>
          </div>
          {error && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#3b82f6", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Creating..." : "Create Persona"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Persona Detail Panel ─────────────────────────────────────────────────────

function PersonaDetail({ persona, onClose }: { persona: Persona; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 24,
          width: 540,
          maxWidth: "95vw",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px 0" }}>{persona.name}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <RoleBadge role={persona.role} />
              <ScopeBadge projectId={persona.projectId} />
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {persona.description && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px 0" }}>{persona.description}</p>
        )}

        {persona.instructions && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>INSTRUCTIONS</h3>
            <p style={{ fontSize: 13, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 14px", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              {persona.instructions}
            </p>
          </div>
        )}

        {persona.traits.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>TRAITS</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {persona.traits.map((t) => (
                <span key={t} style={{ background: "rgba(107,114,128,0.15)", color: "var(--text-muted)", padding: "3px 10px", borderRadius: 12, fontSize: 12 }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {persona.goals.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>GOALS</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {persona.goals.map((g) => (
                <li key={g} style={{ fontSize: 13, color: "var(--text)", marginBottom: 4 }}>{g}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
          ID: {persona.shortId} · v{persona.version} · {persona.enabled ? "enabled" : "disabled"} · Created {new Date(persona.createdAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

// ─── PersonasPage ─────────────────────────────────────────────────────────────

export function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Persona | null>(null);

  const load = () => {
    setLoading(true);
    getPersonas()
      .then(setPersonas)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreated = (p: Persona) => {
    setShowModal(false);
    setPersonas((prev) => [p, ...prev]);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePersona(deleteTarget.id);
      setPersonas((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Personas</h2>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "none",
            background: "#3b82f6",
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          + New Persona
        </button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Spinner />
        </div>
      ) : personas.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 24px",
            color: "var(--text-muted)",
            background: "var(--bg-card)",
            border: "1px dashed var(--border)",
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 16 }}>🎭</div>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px 0", color: "var(--text)" }}>No personas yet</h3>
          <p style={{ margin: 0, fontSize: 14 }}>
            Create one to give your AI agent a testing identity.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {personas.map((persona) => (
            <div
              key={persona.id}
              onClick={() => setSelectedPersona(persona)}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 18,
                cursor: "pointer",
                transition: "border-color 0.15s",
                position: "relative",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              {/* Delete button */}
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(persona); }}
                title="Delete persona"
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "2px 4px",
                  borderRadius: 4,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>

              <div style={{ marginBottom: 10, paddingRight: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px 0" }}>{persona.name}</h3>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <RoleBadge role={persona.role} />
                  <ScopeBadge projectId={persona.projectId} />
                </div>
              </div>

              {persona.description && (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    margin: "0 0 12px 0",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {persona.description}
                </p>
              )}

              {persona.traits.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {persona.traits.slice(0, 5).map((t) => (
                    <span
                      key={t}
                      style={{
                        background: "rgba(107,114,128,0.12)",
                        color: "var(--text-muted)",
                        padding: "1px 7px",
                        borderRadius: 10,
                        fontSize: 11,
                      }}
                    >
                      {t}
                    </span>
                  ))}
                  {persona.traits.length > 5 && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>+{persona.traits.length - 5} more</span>
                  )}
                </div>
              )}

              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {persona.goals.length} goal{persona.goals.length !== 1 ? "s" : ""}
                {!persona.enabled && <span style={{ marginLeft: 8, color: "var(--red)" }}>disabled</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <NewPersonaModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}

      {selectedPersona && (
        <PersonaDetail persona={selectedPersona} onClose={() => setSelectedPersona(null)} />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete Persona"
          message={`Delete persona "${deleteTarget.name}"? This cannot be undone. Scenarios using this persona will lose their persona assignment.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
