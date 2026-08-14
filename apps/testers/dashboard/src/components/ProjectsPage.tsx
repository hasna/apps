import { useState, useEffect, useCallback } from "react";
import type { Project, Environment } from "../types";
import {
  getProjects,
  createProject,
  updateProject,
  getProjectEnvironments,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment,
} from "../lib/api";
import { Spinner } from "./Spinner";

// ─── New Project Modal ────────────────────────────────────────────────────────

interface NewProjectModalProps {
  onClose: () => void;
  onCreated: (p: Project) => void;
}

function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const p = await createProject({ name: name.trim(), description: description.trim() || undefined });
      onCreated(p);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, width: 400, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>New Project</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Description (optional)</label>
              <input style={inputStyle} type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
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
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Environment Modal ────────────────────────────────────────────────────

interface EnvVariable { key: string; value: string }

interface AddEnvModalProps {
  projectId: string;
  existing?: Environment;
  onClose: () => void;
  onSaved: () => void;
}

function AddEnvModal({ projectId, existing, onClose, onSaved }: AddEnvModalProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [vars, setVars] = useState<EnvVariable[]>(
    existing ? Object.entries(existing.variables ?? {}).map(([k, v]) => ({ key: k, value: v })) : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const addVar = () => setVars((v) => [...v, { key: "", value: "" }]);
  const removeVar = (i: number) => setVars((v) => v.filter((_, idx) => idx !== i));
  const updateVar = (i: number, field: "key" | "value", val: string) => {
    setVars((v) => v.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) { setError("Name and URL are required."); return; }
    setSaving(true);
    setError(null);
    const variables = Object.fromEntries(vars.filter((v) => v.key.trim()).map((v) => [v.key.trim(), v.value]));
    try {
      if (existing) {
        await updateEnvironment(existing.id, { name: name.trim(), url: url.trim(), isDefault, variables });
      } else {
        await createEnvironment(projectId, { name: name.trim(), url: url.trim(), isDefault, variables });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, width: 520, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{existing ? "Edit Environment" : "Add Environment"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Name</label>
                <input style={inputStyle} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" autoFocus />
              </div>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>URL</label>
                <input style={inputStyle} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.example.com" />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="isDefault"
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <label htmlFor="isDefault" style={{ fontSize: 13, cursor: "pointer" }}>Set as default environment</label>
            </div>

            {/* Variables */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={labelStyle}>Variables</label>
                <button
                  type="button"
                  onClick={addVar}
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
                >
                  + Add
                </button>
              </div>
              {vars.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>No variables yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {vars.map((v, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }}
                        type="text"
                        value={v.key}
                        onChange={(e) => updateVar(i, "key", e.target.value)}
                        placeholder="KEY"
                      />
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>=</span>
                      <input
                        style={{ ...inputStyle, flex: 2, fontFamily: "monospace", fontSize: 12 }}
                        type="text"
                        value={v.value}
                        onChange={(e) => updateVar(i, "value", e.target.value)}
                        placeholder="value"
                      />
                      <button
                        type="button"
                        onClick={() => removeVar(i)}
                        style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
              {saving ? "Saving…" : existing ? "Save Changes" : "Add Environment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Project Detail View ──────────────────────────────────────────────────────

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  onUpdated: (p: Project) => void;
}

function ProjectDetail({ project, onBack, onUpdated }: ProjectDetailProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [baseUrl, setBaseUrl] = useState(project.baseUrl ?? "");
  const [port, setPort] = useState(project.port != null ? String(project.port) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [envs, setEnvs] = useState<Environment[]>([]);
  const [loadingEnvs, setLoadingEnvs] = useState(true);
  const [showAddEnv, setShowAddEnv] = useState(false);
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadEnvs = useCallback(async () => {
    setLoadingEnvs(true);
    try {
      const data = await getProjectEnvironments(project.id);
      setEnvs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingEnvs(false);
    }
  }, [project.id]);

  useEffect(() => { loadEnvs(); }, [loadEnvs]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateProject(project.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        port: port ? parseInt(port, 10) : undefined,
      });
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEnv = async (env: Environment) => {
    if (!window.confirm(`Delete environment "${env.name}"?`)) return;
    try {
      await deleteEnvironment(env.id);
      setEnvs((prev) => prev.filter((e) => e.id !== env.id));
      showToast(`Deleted "${env.name}"`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
  const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-card)",
  };
  const tdStyle: React.CSSProperties = {
    padding: "9px 10px",
    fontSize: 13,
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  };

  return (
    <div>
      {/* Back button + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{ padding: "5px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}
        >
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{project.name}</h2>
      </div>

      {/* Edit project form */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 14, fontWeight: 600 }}>Project Settings</h3>
        <form onSubmit={handleSave}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label style={labelStyle}>Base URL</label>
              <input style={inputStyle} type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://app.example.com" />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input style={inputStyle} type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="e.g. 3000" min={1} max={65535} />
            </div>
          </div>

          {saveError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--red)", borderRadius: 4, fontSize: 12, color: "var(--red)" }}>
              {saveError}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: "6px 16px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 500, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            {saved && <span style={{ fontSize: 12, color: "var(--green)" }}>Saved!</span>}
          </div>
        </form>
      </div>

      {/* Environments section */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Environments</h3>
          <button
            onClick={() => setShowAddEnv(true)}
            style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            + Add Environment
          </button>
        </div>

        {loadingEnvs ? (
          <div style={{ padding: 24, textAlign: "center" }}><Spinner /></div>
        ) : envs.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            No environments yet. Add one to configure deployment targets.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>URL</th>
                <th style={thStyle}>Variables</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {envs.map((env) => (
                <tr key={env.id}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{env.name}</span>
                    {env.isDefault && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--blue)", background: "rgba(59,130,246,0.1)", border: "1px solid var(--blue)", borderRadius: 3, padding: "1px 5px" }}>
                        default
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{env.url}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "var(--text-muted)" }}>
                    {Object.keys(env.variables ?? {}).length} var{Object.keys(env.variables ?? {}).length !== 1 ? "s" : ""}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setEditingEnv(env)}
                        style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteEnv(env)}
                        style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid var(--red)", background: "transparent", color: "var(--red)", cursor: "pointer", fontSize: 11 }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(showAddEnv || editingEnv) && (
        <AddEnvModal
          projectId={project.id}
          existing={editingEnv ?? undefined}
          onClose={() => { setShowAddEnv(false); setEditingEnv(null); }}
          onSaved={loadEnvs}
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

// ─── ProjectsPage ─────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProjects();
      setProjects(data);
    } catch (err) {
      console.error(err);
      showToast(`Failed to load projects: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selectedProject) {
    return (
      <ProjectDetail
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
        onUpdated={(updated) => {
          setProjects((prev) => prev.map((p) => p.id === updated.id ? updated : p));
          setSelectedProject(updated);
        }}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Projects</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            Refresh
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            + New Project
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
      ) : projects.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>No projects yet</div>
          <div style={{ fontSize: 12 }}>Create a project to group your scenarios, schedules, and API checks.</div>
          <button
            onClick={() => setShowNewModal(true)}
            style={{ marginTop: 16, padding: "6px 16px", borderRadius: 4, border: "none", background: "var(--blue)", color: "#fff", cursor: "pointer", fontSize: 13 }}
          >
            Create your first project
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => setSelectedProject(project)}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 18,
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{project.name}</div>
              {project.description && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{project.description}</div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {project.baseUrl ? (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, padding: "2px 7px", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                    {project.baseUrl}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, padding: "2px 7px" }}>
                    No URL configured
                  </span>
                )}
                {project.port != null && (
                  <span style={{ fontSize: 11, color: "var(--blue)", background: "rgba(59,130,246,0.1)", border: "1px solid var(--blue)", borderRadius: 3, padding: "2px 7px" }}>
                    :{project.port}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewModal && (
        <NewProjectModal
          onClose={() => setShowNewModal(false)}
          onCreated={(p) => {
            setProjects((prev) => [p, ...prev]);
            showToast(`Created "${p.name}"`);
          }}
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
