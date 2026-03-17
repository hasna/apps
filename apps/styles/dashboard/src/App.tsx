import { useState, useEffect, useCallback } from "react";
import {
  Palette,
  Heart,
  User,
  Settings,
  Layout,
  Search,
  X,
  ChevronRight,
  Play,
  Trash2,
  Plus,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StyleMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  principles: string[];
  antiPatterns?: string[];
  styleMd?: string;
}

interface StyleProfile {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  principles: string[];
  antiPatterns: string[];
  tags: string[];
  createdAt: number;
  builtin: boolean;
}

interface FileViolation {
  filePath: string;
  rule: string;
  message: string;
  severity: "critical" | "warning" | "info";
}

interface HealthCheckResult {
  id: string;
  projectPath: string;
  runAt: number;
  violations: FileViolation[];
  score: number;
  status: "pass" | "warn" | "fail";
  filesScanned: number;
}

interface Preference {
  key: string;
  value: string;
  scope: string;
}

interface StyleTemplate {
  id: string;
  name: string;
  description: string;
  styleProfileId: string;
  variables: Record<string, string>;
  createdAt: number;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Shared UI components ──────────────────────────────────────────────────────

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: "bg-zinc-800 text-zinc-300",
    blue: "bg-blue-900/60 text-blue-300",
    green: "bg-green-900/60 text-green-300",
    yellow: "bg-yellow-900/60 text-yellow-300",
    red: "bg-red-900/60 text-red-300",
    purple: "bg-purple-900/60 text-purple-300",
    orange: "bg-orange-900/60 text-orange-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color] ?? colors.gray}`}>
      {children}
    </span>
  );
}

function ScoreBadge({ score, status }: { score: number; status: string }) {
  const color = status === "pass" ? "green" : status === "warn" ? "yellow" : "red";
  const Icon = status === "pass" ? CheckCircle : status === "warn" ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${
      color === "green" ? "bg-green-900/40 text-green-300 border border-green-800" :
      color === "yellow" ? "bg-yellow-900/40 text-yellow-300 border border-yellow-800" :
      "bg-red-900/40 text-red-300 border border-red-800"
    }`}>
      <Icon size={14} />
      {score}/100
    </span>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="p-4 rounded-full bg-zinc-800/50 mb-4">
        <Icon size={28} className="text-zinc-500" />
      </div>
      <p className="text-zinc-400 font-medium">{title}</p>
      {subtitle && <p className="text-zinc-600 text-sm mt-1">{subtitle}</p>}
    </div>
  );
}

function Input({ label, value, onChange, placeholder, className = "" }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>}
      <input
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500 focus:border-zinc-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  const base = "inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm" };
  const variants = {
    default: "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700",
    primary: "bg-zinc-100 hover:bg-white text-zinc-900",
    danger: "bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800/50",
    ghost: "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200",
  };
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// ── Styles Tab ────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Minimalist: "blue",
  Brutalist: "gray",
  Corporate: "purple",
  Startup: "green",
  Glassmorphism: "blue",
  Editorial: "orange",
  Retro: "orange",
  Material: "blue",
  Neubrutalism: "yellow",
  Neumorphic: "purple",
};

function StyleCard({ style, onClick }: { style: StyleMeta; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-800/60 transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-semibold text-zinc-100 group-hover:text-white">{style.displayName}</h3>
        <ChevronRight size={16} className="text-zinc-600 group-hover:text-zinc-400 mt-0.5 shrink-0" />
      </div>
      <Badge color={CATEGORY_COLORS[style.category] ?? "gray"}>{style.category}</Badge>
      <p className="text-sm text-zinc-400 mt-3 line-clamp-2 leading-relaxed">{style.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {style.tags.slice(0, 4).map((t) => (
          <span key={t} className="text-xs text-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 rounded">
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

function StyleDetail({
  style,
  onClose,
  currentProject,
}: {
  style: StyleMeta;
  onClose: () => void;
  currentProject: string;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function useStyle() {
    if (!currentProject) { setMsg("Set a project path first (in Health tab)"); return; }
    setLoading(true);
    try {
      await api("/api/projects/init", { method: "POST", body: JSON.stringify({ projectPath: currentProject, styleName: style.name }) });
      setMsg("Style applied to project!");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto">
        <div className="sticky top-0 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{style.displayName}</h2>
            <Badge color={CATEGORY_COLORS[style.category] ?? "gray"}>{style.category}</Badge>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-6">
          <p className="text-zinc-300 text-sm leading-relaxed">{style.description}</p>

          {style.principles && style.principles.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Principles</h3>
              <ul className="space-y-2">
                {style.principles.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-300">
                    <span className="text-zinc-600 shrink-0 mt-0.5">→</span>
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {style.antiPatterns && style.antiPatterns.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Anti-patterns</h3>
              <ul className="space-y-2">
                {style.antiPatterns.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-red-400/80">
                    <span className="text-red-700 shrink-0 mt-0.5">✗</span>
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {style.tags && style.tags.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {style.tags.map((t) => (
                  <span key={t} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded">{t}</span>
                ))}
              </div>
            </section>
          )}

          {style.styleMd && (
            <section>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">STYLE.md</h3>
              <pre className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                {style.styleMd}
              </pre>
            </section>
          )}

          <div className="pt-2">
            <Button variant="primary" onClick={useStyle} disabled={loading}>
              <Play size={14} />
              {loading ? "Applying…" : "Use Style"}
            </Button>
            {msg && <p className="text-xs text-zinc-400 mt-2">{msg}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StylesTab({ currentProject }: { currentProject: string }) {
  const [styles, setStyles] = useState<StyleMeta[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<StyleMeta | null>(null);
  const [loading, setLoading] = useState(true);

  const CATEGORIES = ["Minimalist", "Brutalist", "Corporate", "Startup", "Glassmorphism", "Editorial", "Retro", "Material", "Neubrutalism", "Neumorphic"];

  useEffect(() => {
    setLoading(true);
    const fetchStyles = async () => {
      try {
        const q = search ? `/api/styles/search?q=${encodeURIComponent(search)}` : category ? `/api/styles?category=${encodeURIComponent(category)}` : "/api/styles";
        const data = await api<StyleMeta[]>(q);
        setStyles(data);
      } catch {
        setStyles([]);
      } finally {
        setLoading(false);
      }
    };
    const t = setTimeout(fetchStyles, search ? 200 : 0);
    return () => clearTimeout(t);
  }, [search, category]);

  async function openDetail(s: StyleMeta) {
    try {
      const detail = await api<StyleMeta>(`/api/styles/${s.name}`);
      setSelected(detail);
    } catch {
      setSelected(s);
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="Search styles…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCategory(""); }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => { setCategory(""); setSearch(""); }}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!category ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCategory(c === category ? "" : c); setSearch(""); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${category === c ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw size={20} className="text-zinc-600 animate-spin" />
        </div>
      ) : styles.length === 0 ? (
        <EmptyState icon={Palette} title="No styles found" subtitle="Try a different search or category" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {styles.map((s) => (
            <StyleCard key={s.name} style={s} onClick={() => openDetail(s)} />
          ))}
        </div>
      )}

      {selected && (
        <StyleDetail style={selected} onClose={() => setSelected(null)} currentProject={currentProject} />
      )}
    </div>
  );
}

// ── Health Tab ────────────────────────────────────────────────────────────────

function HealthTab({ currentProject, setCurrentProject }: { currentProject: string; setCurrentProject: (p: string) => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [history, setHistory] = useState<HealthCheckResult[]>([]);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const h = await api<HealthCheckResult[]>(`/api/health/history?project=${encodeURIComponent(path)}&limit=5`);
      setHistory(h);
    } catch {
      setHistory([]);
    }
  }, []);

  async function runCheck() {
    if (!currentProject) return;
    setRunning(true);
    setError("");
    try {
      const r = await api<HealthCheckResult>("/api/health/run", { method: "POST", body: JSON.stringify({ projectPath: currentProject }) });
      setResult(r);
      await loadHistory(currentProject);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const bySeverity = (violations: FileViolation[], sev: string) => violations.filter((v) => v.severity === sev);

  const severityColor: Record<string, string> = {
    critical: "text-red-400",
    warning: "text-yellow-400",
    info: "text-blue-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label="Project path"
            value={currentProject}
            onChange={setCurrentProject}
            placeholder="/Users/you/my-project"
          />
        </div>
        <div className="flex items-end">
          <Button variant="primary" onClick={runCheck} disabled={running || !currentProject}>
            {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? "Running…" : "Run Check"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ScoreBadge score={result.score} status={result.status} />
              <span className="text-sm text-zinc-500">{result.filesScanned} files scanned</span>
            </div>
            <span className="text-xs text-zinc-600">{new Date(result.runAt).toLocaleString()}</span>
          </div>

          {result.violations.length === 0 ? (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle size={16} />
              No violations found
            </div>
          ) : (
            <div className="space-y-4">
              {(["critical", "warning", "info"] as const).map((sev) => {
                const vs = bySeverity(result.violations, sev);
                if (!vs.length) return null;
                return (
                  <div key={sev}>
                    <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${severityColor[sev]}`}>
                      {sev} ({vs.length})
                    </h4>
                    <div className="space-y-1.5">
                      {vs.slice(0, 20).map((v, i) => (
                        <div key={i} className="bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <code className="text-zinc-500 truncate">{v.filePath.split("/").slice(-2).join("/")}</code>
                            <Badge color={sev === "critical" ? "red" : sev === "warning" ? "yellow" : "blue"}>{v.rule}</Badge>
                          </div>
                          <p className="text-zinc-400 mt-1">{v.message}</p>
                        </div>
                      ))}
                      {vs.length > 20 && <p className="text-xs text-zinc-600 pl-2">…and {vs.length - 20} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Recent runs</h3>
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <ScoreBadge score={h.score} status={h.status} />
                  <span className="text-xs text-zinc-500">{h.violations.length} violations · {h.filesScanned} files</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-zinc-600">
                  <Clock size={12} />
                  {new Date(h.runAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && history.length === 0 && !running && (
        <EmptyState icon={Heart} title="No health checks yet" subtitle="Enter a project path and run a check" />
      )}
    </div>
  );
}

// ── Profiles Tab ──────────────────────────────────────────────────────────────

function ProfilesTab() {
  const [profiles, setProfiles] = useState<StyleProfile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", displayName: "", description: "", category: "" });
  const [error, setError] = useState("");

  async function load() {
    try {
      setProfiles(await api<StyleProfile[]>("/api/profiles"));
    } catch { setProfiles([]); }
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    if (!form.name) return;
    try {
      await api("/api/profiles", {
        method: "POST",
        body: JSON.stringify({ ...form, principles: [], antiPatterns: [], typography: {}, colors: {}, componentRules: {}, tags: [] }),
      });
      setForm({ name: "", displayName: "", description: "", category: "" });
      setShowForm(false);
      setError("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/profiles/${id}`, { method: "DELETE" });
      await load();
    } catch {}
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus size={14} />
          Create Profile
        </Button>
      </div>

      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-200">New Profile</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name (slug)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="my-profile" />
            <Input label="Display Name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} placeholder="My Profile" />
          </div>
          <Input label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="What is this profile about?" />
          <Input label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder="e.g. Minimalist" />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={create}>Create</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState icon={User} title="No custom profiles" subtitle="Create a profile to get started" />
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-start justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-zinc-100">{p.displayName || p.name}</span>
                  {p.builtin && <Badge color="blue">builtin</Badge>}
                  {p.category && <Badge>{p.category}</Badge>}
                </div>
                {p.description && <p className="text-sm text-zinc-500">{p.description}</p>}
              </div>
              {!p.builtin && (
                <Button variant="danger" size="sm" onClick={() => remove(p.id)}>
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Preferences Tab ───────────────────────────────────────────────────────────

function PreferencesTab({ currentProject }: { currentProject: string }) {
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  async function load() {
    try {
      const q = currentProject ? `?project=${encodeURIComponent(currentProject)}` : "";
      setPrefs(await api<Preference[]>(`/api/preferences${q}`));
    } catch { setPrefs([]); }
  }

  useEffect(() => { void load(); }, [currentProject]);

  async function add() {
    if (!newKey || !newValue) return;
    try {
      await api("/api/preferences", {
        method: "POST",
        body: JSON.stringify({ key: newKey, value: newValue, scope: "global" }),
      });
      setNewKey("");
      setNewValue("");
      setError("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(key: string, scope: string) {
    try {
      await api(`/api/preferences/${encodeURIComponent(key)}?scope=${scope}`, { method: "DELETE" });
      await load();
    } catch {}
  }

  async function save(key: string, scope: string) {
    try {
      await api("/api/preferences", {
        method: "POST",
        body: JSON.stringify({ key, value: editValue, scope }),
      });
      setEditId(null);
      await load();
    } catch {}
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <Input className="flex-1" placeholder="Key" value={newKey} onChange={setNewKey} />
        <Input className="flex-1" placeholder="Value" value={newValue} onChange={setNewValue} />
        <div className="flex items-end">
          <Button onClick={add} disabled={!newKey || !newValue}>
            <Plus size={14} />
            Add
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {prefs.length === 0 ? (
        <EmptyState icon={Settings} title="No preferences set" />
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Key</th>
                <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Value</th>
                <th className="text-left text-xs text-zinc-500 font-medium px-4 py-3">Scope</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {prefs.map((p) => (
                <tr key={`${p.key}:${p.scope}`} className="border-b border-zinc-800/50 last:border-0">
                  <td className="px-4 py-3 font-mono text-zinc-300 text-xs">{p.key}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {editId === p.key ? (
                      <div className="flex gap-2">
                        <input
                          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                        />
                        <Button size="sm" variant="primary" onClick={() => save(p.key, p.scope)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditId(p.key); setEditValue(p.value); }} className="hover:text-zinc-200 text-left">
                        {p.value}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={p.scope === "project" ? "purple" : "gray"}>{p.scope}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => remove(p.key, p.scope)}>
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Templates Tab ─────────────────────────────────────────────────────────────

function TemplatesTab({ currentProject }: { currentProject: string }) {
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [applyMsg, setApplyMsg] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", styleProfileId: "" });
  const [error, setError] = useState("");

  async function load() {
    try {
      setTemplates(await api<StyleTemplate[]>("/api/templates"));
    } catch { setTemplates([]); }
  }

  useEffect(() => { void load(); }, []);

  async function apply(id: string) {
    if (!currentProject) { setApplyMsg({ ...applyMsg, [id]: "Set project path first (Health tab)" }); return; }
    try {
      const r = await api<{ success: boolean; filesCreated: string[]; errors: string[] }>(`/api/templates/${id}/apply`, {
        method: "POST",
        body: JSON.stringify({ projectPath: currentProject }),
      });
      setApplyMsg({ ...applyMsg, [id]: r.success ? `Applied! ${r.filesCreated.length} files created.` : `Errors: ${r.errors.join(", ")}` });
    } catch (e) {
      setApplyMsg({ ...applyMsg, [id]: (e as Error).message });
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/templates/${id}`, { method: "DELETE" });
      await load();
    } catch {}
  }

  async function create() {
    if (!form.name) return;
    try {
      await api("/api/templates", {
        method: "POST",
        body: JSON.stringify({ ...form, variables: {} }),
      });
      setForm({ name: "", description: "", styleProfileId: "" });
      setShowForm(false);
      setError("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus size={14} />
          Create Template
        </Button>
      </div>

      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-200">New Template</h3>
          <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="My Template" />
          <Input label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="What does this template do?" />
          <Input label="Style Profile ID" value={form.styleProfileId} onChange={(v) => setForm({ ...form, styleProfileId: v })} placeholder="builtin:minimalist or custom UUID" />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={create}>Create</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <EmptyState icon={Layout} title="No templates" subtitle="Create a template to quickly apply style rules to projects" />
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-medium text-zinc-100">{t.name}</h3>
                  {t.description && <p className="text-sm text-zinc-500 mt-0.5">{t.description}</p>}
                  {t.styleProfileId && (
                    <p className="text-xs text-zinc-600 mt-1 font-mono">profile: {t.styleProfileId}</p>
                  )}
                  {applyMsg[t.id] && (
                    <p className="text-xs text-zinc-400 mt-1.5">{applyMsg[t.id]}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => apply(t.id)}>
                    <Play size={13} />
                    Apply
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => remove(t.id)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

type Tab = "styles" | "health" | "profiles" | "preferences" | "templates";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "styles", label: "Styles", icon: Palette },
  { id: "health", label: "Health", icon: Heart },
  { id: "profiles", label: "Profiles", icon: User },
  { id: "preferences", label: "Preferences", icon: Settings },
  { id: "templates", label: "Templates", icon: Layout },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("styles");
  const [currentProject, setCurrentProject] = useState("");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center">
            <Palette size={14} className="text-zinc-900" />
          </div>
          <span className="font-semibold text-zinc-100 tracking-tight">open-styles</span>
        </div>
        <span className="text-xs text-zinc-600">style management for AI agents</span>
      </header>

      {/* Nav */}
      <nav className="border-b border-zinc-800 px-6">
        <div className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === id
                  ? "border-zinc-100 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 px-6 py-6 max-w-5xl w-full mx-auto">
        {tab === "styles" && <StylesTab currentProject={currentProject} />}
        {tab === "health" && <HealthTab currentProject={currentProject} setCurrentProject={setCurrentProject} />}
        {tab === "profiles" && <ProfilesTab />}
        {tab === "preferences" && <PreferencesTab currentProject={currentProject} />}
        {tab === "templates" && <TemplatesTab currentProject={currentProject} />}
      </main>
    </div>
  );
}
