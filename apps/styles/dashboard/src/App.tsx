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
  Download,
  Copy,
  Layers,
  Wand2,
  BookMarked,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";

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

function ColorBadge({ children, color = "gray" }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: "bg-secondary text-secondary-foreground",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    green: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color] ?? colors.gray}`}>
      {children}
    </span>
  );
}

function ScoreBadge({ score, status }: { score: number; status: string }) {
  const Icon = status === "pass" ? CheckCircle : status === "warn" ? AlertTriangle : XCircle;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border",
      status === "pass"
        ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800"
        : status === "warn"
        ? "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-800"
        : "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800"
    )}>
      <Icon size={14} />
      {score}/100
    </span>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="p-4 rounded-full bg-secondary mb-4">
        <Icon size={28} className="text-muted-foreground" />
      </div>
      <p className="text-muted-foreground font-medium">{title}</p>
      {subtitle && <p className="text-muted-foreground/60 text-sm mt-1">{subtitle}</p>}
    </div>
  );
}

function InlineInput({ label, value, onChange, placeholder, className = "" }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>}
      <input
        className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ActionButton({
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
    default: "bg-secondary hover:bg-accent text-secondary-foreground border border-border",
    primary: "bg-primary hover:bg-primary/90 text-primary-foreground",
    danger: "bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300 dark:border-red-800/50",
    ghost: "hover:bg-accent text-muted-foreground hover:text-accent-foreground",
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
      className="text-left bg-card border border-border rounded-xl p-5 hover:border-foreground/30 hover:bg-accent/30 transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-semibold text-foreground group-hover:text-foreground">{style.displayName}</h3>
        <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground mt-0.5 shrink-0" />
      </div>
      <ColorBadge color={CATEGORY_COLORS[style.category] ?? "gray"}>{style.category}</ColorBadge>
      <p className="text-sm text-muted-foreground mt-3 line-clamp-2 leading-relaxed">{style.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {style.tags.slice(0, 4).map((t) => (
          <span key={t} className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
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

  async function useStyleFn() {
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
      <div className="relative z-10 w-full max-w-xl h-full bg-background border-l border-border overflow-y-auto">
        <div className="sticky top-0 bg-background/90 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{style.displayName}</h2>
            <ColorBadge color={CATEGORY_COLORS[style.category] ?? "gray"}>{style.category}</ColorBadge>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-6">
          <p className="text-foreground/80 text-sm leading-relaxed">{style.description}</p>

          {style.principles && style.principles.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Principles</h3>
              <ul className="space-y-2">
                {style.principles.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span className="text-muted-foreground shrink-0 mt-0.5">&#x2192;</span>
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {style.antiPatterns && style.antiPatterns.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Anti-patterns</h3>
              <ul className="space-y-2">
                {style.antiPatterns.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-red-600 dark:text-red-400/80">
                    <span className="text-red-500 dark:text-red-700 shrink-0 mt-0.5">&#x2717;</span>
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {style.tags && style.tags.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {style.tags.map((t) => (
                  <span key={t} className="text-xs bg-secondary text-muted-foreground px-2 py-1 rounded">{t}</span>
                ))}
              </div>
            </section>
          )}

          {style.styleMd && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">STYLE.md</h3>
              <pre className="text-xs text-muted-foreground bg-secondary border border-border rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                {style.styleMd}
              </pre>
            </section>
          )}

          <div className="pt-2">
            <ActionButton variant="primary" onClick={useStyleFn} disabled={loading}>
              <Play size={14} />
              {loading ? "Applying\u2026" : "Use Style"}
            </ActionButton>
            {msg && <p className="text-xs text-muted-foreground mt-2">{msg}</p>}
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
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full bg-background border border-input rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Search styles\u2026"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCategory(""); }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => { setCategory(""); setSearch(""); }}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!category ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCategory(c === category ? "" : c); setSearch(""); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${category === c ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw size={20} className="text-muted-foreground animate-spin" />
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
    critical: "text-red-600 dark:text-red-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    info: "text-blue-600 dark:text-blue-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <div className="flex-1">
          <InlineInput
            label="Project path"
            value={currentProject}
            onChange={setCurrentProject}
            placeholder="/Users/you/my-project"
          />
        </div>
        <div className="flex items-end">
          <ActionButton variant="primary" onClick={runCheck} disabled={running || !currentProject}>
            {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? "Running\u2026" : "Run Check"}
          </ActionButton>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ScoreBadge score={result.score} status={result.status} />
              <span className="text-sm text-muted-foreground">{result.filesScanned} files scanned</span>
            </div>
            <span className="text-xs text-muted-foreground">{new Date(result.runAt).toLocaleString()}</span>
          </div>

          {result.violations.length === 0 ? (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
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
                        <div key={i} className="bg-background border border-border/60 rounded-lg px-3 py-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <code className="text-muted-foreground truncate">{v.filePath.split("/").slice(-2).join("/")}</code>
                            <ColorBadge color={sev === "critical" ? "red" : sev === "warning" ? "yellow" : "blue"}>{v.rule}</ColorBadge>
                          </div>
                          <p className="text-foreground/70 mt-1">{v.message}</p>
                        </div>
                      ))}
                      {vs.length > 20 && <p className="text-xs text-muted-foreground pl-2">\u2026and {vs.length - 20} more</p>}
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
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent runs</h3>
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <ScoreBadge score={h.score} status={h.status} />
                  <span className="text-xs text-muted-foreground">{h.violations.length} violations \xB7 {h.filesScanned} files</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
        <ActionButton onClick={() => setShowForm(!showForm)}>
          <Plus size={14} />
          Create Profile
        </ActionButton>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">New Profile</h3>
          <div className="grid grid-cols-2 gap-3">
            <InlineInput label="Name (slug)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="my-profile" />
            <InlineInput label="Display Name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} placeholder="My Profile" />
          </div>
          <InlineInput label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="What is this profile about?" />
          <InlineInput label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder="e.g. Minimalist" />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <ActionButton variant="primary" onClick={create}>Create</ActionButton>
            <ActionButton variant="ghost" onClick={() => setShowForm(false)}>Cancel</ActionButton>
          </div>
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState icon={User} title="No custom profiles" subtitle="Create a profile to get started" />
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-start justify-between bg-card border border-border rounded-xl px-5 py-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-foreground">{p.displayName || p.name}</span>
                  {p.builtin && <ColorBadge color="blue">builtin</ColorBadge>}
                  {p.category && <ColorBadge>{p.category}</ColorBadge>}
                </div>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
              </div>
              {!p.builtin && (
                <ActionButton variant="danger" size="sm" onClick={() => remove(p.id)}>
                  <Trash2 size={13} />
                </ActionButton>
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
        <InlineInput className="flex-1" placeholder="Key" value={newKey} onChange={setNewKey} />
        <InlineInput className="flex-1" placeholder="Value" value={newValue} onChange={setNewValue} />
        <div className="flex items-end">
          <ActionButton onClick={add} disabled={!newKey || !newValue}>
            <Plus size={14} />
            Add
          </ActionButton>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {prefs.length === 0 ? (
        <EmptyState icon={Settings} title="No preferences set" />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Key</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Value</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Scope</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {prefs.map((p) => (
                <tr key={`${p.key}:${p.scope}`} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3 font-mono text-foreground/80 text-xs">{p.key}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {editId === p.key ? (
                      <div className="flex gap-2">
                        <input
                          className="flex-1 bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                        />
                        <ActionButton size="sm" variant="primary" onClick={() => save(p.key, p.scope)}>Save</ActionButton>
                        <ActionButton size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</ActionButton>
                      </div>
                    ) : (
                      <button onClick={() => { setEditId(p.key); setEditValue(p.value); }} className="hover:text-foreground text-left">
                        {p.value}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ColorBadge color={p.scope === "project" ? "purple" : "gray"}>{p.scope}</ColorBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ActionButton variant="ghost" size="sm" onClick={() => remove(p.key, p.scope)}>
                      <Trash2 size={13} />
                    </ActionButton>
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
        <ActionButton onClick={() => setShowForm(!showForm)}>
          <Plus size={14} />
          Create Template
        </ActionButton>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">New Template</h3>
          <InlineInput label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="My Template" />
          <InlineInput label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="What does this template do?" />
          <InlineInput label="Style Profile ID" value={form.styleProfileId} onChange={(v) => setForm({ ...form, styleProfileId: v })} placeholder="builtin:minimalist or custom UUID" />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <ActionButton variant="primary" onClick={create}>Create</ActionButton>
            <ActionButton variant="ghost" onClick={() => setShowForm(false)}>Cancel</ActionButton>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <EmptyState icon={Layout} title="No templates" subtitle="Create a template to quickly apply style rules to projects" />
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="bg-card border border-border rounded-xl px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-medium text-foreground">{t.name}</h3>
                  {t.description && <p className="text-sm text-muted-foreground mt-0.5">{t.description}</p>}
                  {t.styleProfileId && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">profile: {t.styleProfileId}</p>
                  )}
                  {applyMsg[t.id] && (
                    <p className="text-xs text-muted-foreground mt-1.5">{applyMsg[t.id]}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <ActionButton size="sm" onClick={() => apply(t.id)}>
                    <Play size={13} />
                    Apply
                  </ActionButton>
                  <ActionButton variant="danger" size="sm" onClick={() => remove(t.id)}>
                    <Trash2 size={13} />
                  </ActionButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Extract + Kits Types ──────────────────────────────────────────────────────

interface ColorToken { value: string; frequency: number; source: string; name?: string }
interface DesignTokens {
  colors: ColorToken[];
  typography: { fontFamilies: string[]; fontSizes: string[]; fontWeights: string[]; lineHeights: string[]; letterSpacings: string[] };
  spacing: string[];
  borderRadius: string[];
  shadows: string[];
  transitions: string[];
  zIndices: string[];
  gradients: string[];
}
interface StyleKit {
  id: string; name: string; url: string;
  tokens: DesignTokens; tags: string[]; notes?: string;
  extractedAt: number; createdAt: number; updatedAt: number;
}
interface ExtractResult { tokens: DesignTokens; configs: Record<string, string>; kit: StyleKit | null; url: string; extractedAt: number }

type ExportFormat = "shadcn" | "tailwind" | "css-vars" | "mui" | "radix";
const FORMATS: ExportFormat[] = ["shadcn", "tailwind", "css-vars", "mui", "radix"];

// ── Extract Tab ───────────────────────────────────────────────────────────────

function ExtractTab() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [saveKit, setSaveKit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [format, setFormat] = useState<ExportFormat>("shadcn");
  const [copied, setCopied] = useState(false);

  const handleExtract = async () => {
    if (!url) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await api<ExtractResult>("/api/extract", {
        method: "POST",
        body: JSON.stringify({ url, name: name || undefined, save: saveKit && !!name }),
      });
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.configs[format] ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const ext = format === "css-vars" ? "css" : "ts";
    const blob = new Blob([result.configs[format] ?? ""], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${format}-config.${ext}`; a.click();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Extract Styles</h2>
        <p className="text-sm text-muted-foreground">Enter a URL to extract colors, typography, shadows, and spacing &mdash; then export as shadcn, Tailwind, CSS vars, MUI, or Radix config.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <InlineInput label="Website URL" value={url} onChange={setUrl} placeholder="https://linear.app" />
        <div className="flex gap-3 items-end">
          <InlineInput label="Kit name (optional)" value={name} onChange={setName} placeholder="linear-dark" className="flex-1" />
          <label className="flex items-center gap-2 text-sm text-muted-foreground pb-2 cursor-pointer select-none">
            <input type="checkbox" checked={saveKit} onChange={e => setSaveKit(e.target.checked)} className="rounded border-border" />
            Save kit
          </label>
        </div>
        <ActionButton variant="primary" onClick={handleExtract} disabled={loading || !url}>
          {loading
            ? <><RefreshCw size={14} className="animate-spin" /> Extracting...</>
            : <><Wand2 size={14} /> Extract Styles</>}
        </ActionButton>
        {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-3">{error}</p>}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Colors", value: result.tokens.colors.length },
              { label: "Fonts", value: result.tokens.typography.fontFamilies.length },
              { label: "Radii", value: result.tokens.borderRadius.length },
              { label: "Shadows", value: result.tokens.shadows.length },
            ].map(({ label, value }) => (
              <div key={label} className="bg-card border border-border rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-foreground">{value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {result.tokens.colors.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-medium text-foreground mb-3">Colors</h3>
              <div className="flex flex-wrap gap-2">
                {result.tokens.colors.slice(0, 24).map((c, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-lg border border-border shadow-sm" style={{ backgroundColor: c.value }} title={c.value} />
                    <span className="text-xs text-muted-foreground font-mono" style={{ fontSize: "9px" }}>{c.value.slice(0, 9)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.tokens.typography.fontFamilies.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-medium text-foreground mb-3">Typography</h3>
              <div className="space-y-2">
                {result.tokens.typography.fontFamilies.map((f, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-16">Font {i + 1}</span>
                    <span className="text-base text-foreground" style={{ fontFamily: f }}>{f} &mdash; The quick brown fox</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {result.tokens.borderRadius.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-medium text-foreground mb-3">Border Radii</h3>
                <div className="flex flex-wrap gap-3">
                  {result.tokens.borderRadius.slice(0, 8).map((r, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className="w-12 h-12 bg-secondary border border-border" style={{ borderRadius: r }} />
                      <span className="text-xs text-muted-foreground font-mono">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.tokens.shadows.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-medium text-foreground mb-3">Shadows</h3>
                <div className="space-y-3">
                  {result.tokens.shadows.slice(0, 4).map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-12 h-8 bg-secondary rounded" style={{ boxShadow: s }} />
                      <span className="text-xs text-muted-foreground font-mono truncate flex-1">{s.slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">Export Config</h3>
              <div className="flex gap-2">
                <ActionButton size="sm" onClick={handleCopy}><Copy size={12} />{copied ? "Copied!" : "Copy"}</ActionButton>
                <ActionButton size="sm" onClick={handleDownload}><Download size={12} /> Download</ActionButton>
              </div>
            </div>
            <div className="flex gap-2">
              {FORMATS.map((f) => (
                <button key={f} onClick={() => setFormat(f)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${format === f ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                  {f}
                </button>
              ))}
            </div>
            <pre className="bg-background border border-border rounded-lg p-4 text-xs text-foreground/80 font-mono overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">{result.configs[format]}</pre>
          </div>
        </>
      )}
    </div>
  );
}

// ── UI Kit Tab ────────────────────────────────────────────────────────────────

function UiKitTab() {
  const [kits, setKits] = useState<StyleKit[]>([]);
  const [selectedKit, setSelectedKit] = useState<StyleKit | null>(null);
  const [loading, setLoading] = useState(true);

  const loadKits = useCallback(async () => {
    try { setKits(await api<StyleKit[]>("/api/kits")); } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadKits(); }, [loadKits]);

  const vars = selectedKit ? buildCssVars(selectedKit.tokens) : {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">UI Kit Preview</h2>
          <p className="text-sm text-muted-foreground">See your extracted styles applied as a real component kit.</p>
        </div>
        {kits.length > 0 && (
          <select
            className="bg-card border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            value={selectedKit?.id ?? ""}
            onChange={e => setSelectedKit(kits.find(k => k.id === e.target.value) ?? null)}
          >
            <option value="">Select a kit...</option>
            {kits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading kits...</p>}
      {!loading && kits.length === 0 && (
        <EmptyState icon={Layers} title="No kits saved yet" subtitle="Go to Extract tab, extract a site, and save it as a kit." />
      )}
      {!loading && kits.length > 0 && !selectedKit && (
        <EmptyState icon={Layers} title="Select a kit above to preview it" />
      )}

      {selectedKit && (() => {
        const t = selectedKit.tokens;
        const c = (i: number, fallback = "#888") => t.colors[i]?.value ?? fallback;
        const font = t.typography.fontFamilies[0] ?? "sans-serif";
        const mono = t.typography.fontFamilies.find(f => /mono|code|consol/i.test(f)) ?? "monospace";
        const rad = t.borderRadius[0] ?? "6px";
        const shad = t.shadows[0] ?? "none";
        const sectionCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3";
        const cardCls = "bg-card border border-border rounded-xl p-5";

        return (
        <div style={vars as React.CSSProperties} className="space-y-8">
          {/* Colors */}
          <section>
            <h3 className={sectionCls}>Colors ({t.colors.length})</h3>
            <div className="flex flex-wrap gap-2">
              {t.colors.slice(0, 30).map((col, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-12 h-12 rounded-xl border border-border" style={{ backgroundColor: col.value }} />
                  <span style={{ fontSize: "9px" }} className="text-muted-foreground font-mono">{col.value.slice(0, 9)}</span>
                  {col.name && <span style={{ fontSize: "8px" }} className="text-muted-foreground">{col.name}</span>}
                </div>
              ))}
            </div>
          </section>

          {/* Full Typography Scale */}
          <section>
            <h3 className={sectionCls}>Typography Scale</h3>
            <div className={cn(cardCls, "space-y-4")}>
              {(((t.typography as Record<string, unknown>).scale as Array<{tag:string;family:string;size:string;weight:string;lineHeight:string;letterSpacing:string}>)?.length
                ? ((t.typography as Record<string, unknown>).scale as Array<{tag:string;family:string;size:string;weight:string;lineHeight:string;letterSpacing:string}>).filter((s: {tag:string}, i: number, a: Array<{tag:string}>) => a.findIndex((x: {tag:string}) => x.tag === s.tag) === i).slice(0, 8)
                : [
                    { tag: "h1", family: font, size: t.typography.fontSizes[t.typography.fontSizes.length - 1] ?? "2.5rem", weight: "700", lineHeight: "1.2", letterSpacing: t.typography.letterSpacings[0] ?? "normal" },
                    { tag: "h2", family: font, size: t.typography.fontSizes[Math.max(0, t.typography.fontSizes.length - 2)] ?? "2rem", weight: "600", lineHeight: "1.3", letterSpacing: "normal" },
                    { tag: "h3", family: font, size: t.typography.fontSizes[Math.max(0, t.typography.fontSizes.length - 3)] ?? "1.5rem", weight: "600", lineHeight: "1.4", letterSpacing: "normal" },
                    { tag: "p", family: font, size: t.typography.fontSizes[0] ?? "1rem", weight: "400", lineHeight: "1.6", letterSpacing: "normal" },
                    { tag: "small", family: font, size: "0.875rem", weight: "400", lineHeight: "1.5", letterSpacing: "normal" },
                    { tag: "code", family: mono, size: "0.875rem", weight: "400", lineHeight: "1.5", letterSpacing: "normal" },
                  ]
              ).map((entry: {tag:string;family:string;size:string;weight:string;lineHeight:string;letterSpacing:string}, i: number) => (
                <div key={i} className="flex items-baseline gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
                  <span className="text-xs text-muted-foreground font-mono w-16 shrink-0">&lt;{entry.tag}&gt;</span>
                  <div className="flex-1">
                    <div style={{ fontFamily: entry.family, fontSize: entry.size, fontWeight: entry.weight, lineHeight: entry.lineHeight, letterSpacing: entry.letterSpacing }}>
                      The quick brown fox jumps over the lazy dog
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">
                      {entry.family} · {entry.size} · {entry.weight} · lh:{entry.lineHeight} · ls:{entry.letterSpacing}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Font Families + Weights */}
          <section>
            <h3 className={sectionCls}>Font Families ({t.typography.fontFamilies.length})</h3>
            <div className="grid grid-cols-1 gap-4">
              {t.typography.fontFamilies.slice(0, 6).map((f, fi) => {
                const detail = (t.typography as Record<string, unknown>).families ? ((t.typography as Record<string, unknown>).families as Array<{name: string; weights: string[]; isVariable: boolean}>)?.find((d: {name: string}) => d.name === f) : undefined;
                const weights: string[] = detail?.weights?.length ? detail.weights : t.typography.fontWeights;
                return (
                  <div key={fi} className={cardCls}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold">{f}</span>
                      <div className="flex gap-1">
                        {detail?.isVariable && <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">Variable</span>}
                        <span className="text-xs text-muted-foreground">{weights.length} weight{weights.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {weights.slice(0, 6).map((w: string, wi: number) => (
                        <div key={wi} className="flex items-baseline gap-3">
                          <span className="text-xs text-muted-foreground font-mono w-8">{w}</span>
                          <span style={{ fontFamily: f, fontWeight: w, fontSize: "1.25rem" }}>Aa Bb Cc 0123</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Font Sizes Visual Scale */}
          {t.typography.fontSizes.length > 0 && (
          <section>
            <h3 className={sectionCls}>Font Size Scale</h3>
            <div className={cn(cardCls, "space-y-3")}>
              {t.typography.fontSizes.slice(0, 10).map((sz, i) => (
                <div key={i} className="flex items-baseline gap-4">
                  <span className="text-xs text-muted-foreground font-mono w-20 shrink-0">{sz}</span>
                  <span style={{ fontFamily: font, fontSize: sz }}>Aa Bb Cc</span>
                </div>
              ))}
            </div>
          </section>
          )}

          {/* Buttons — expanded */}
          <section>
            <h3 className={sectionCls}>Buttons</h3>
            <div className={cn(cardCls, "space-y-4")}>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: "Primary", bg: c(0), color: "#fff" },
                  { label: "Secondary", bg: c(1), color: "#fff" },
                  { label: "Accent", bg: c(4, "#6366f1"), color: "#fff" },
                  { label: "Ghost", bg: "transparent", color: c(0), border: `1px solid ${c(0)}` },
                  { label: "Muted", bg: c(2, "#f3f4f6"), color: c(0) },
                  { label: "Destructive", bg: "#ef4444", color: "#fff" },
                ].map((btn) => (
                  <button key={btn.label} style={{ backgroundColor: btn.bg, color: btn.color, borderRadius: rad, padding: "8px 18px", fontSize: "14px", border: btn.border ?? "none", fontFamily: font, cursor: "default" }}>
                    {btn.label}
                  </button>
                ))}
              </div>
              {/* Sizes */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">Sizes:</span>
                {["sm", "md", "lg"].map((sz) => (
                  <button key={sz} style={{ backgroundColor: c(0), color: "#fff", borderRadius: rad, padding: sz === "sm" ? "4px 10px" : sz === "lg" ? "12px 28px" : "8px 18px", fontSize: sz === "sm" ? "12px" : sz === "lg" ? "16px" : "14px", border: "none", fontFamily: font, cursor: "default" }}>
                    {sz.toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Pill buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">Pill:</span>
                {["Subscribe", "Get Started", "Learn More"].map((l) => (
                  <button key={l} style={{ backgroundColor: c(0), color: "#fff", borderRadius: "9999px", padding: "8px 24px", fontSize: "14px", border: "none", fontFamily: font, cursor: "default" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Badges / Pills */}
          <section>
            <h3 className={sectionCls}>Badges</h3>
            <div className={cn(cardCls, "flex flex-wrap gap-3")}>
              {[
                { label: "Default", bg: c(0), color: "#fff" },
                { label: "Secondary", bg: c(2, "#f3f4f6"), color: c(0) },
                { label: "Success", bg: "#22c55e", color: "#fff" },
                { label: "Warning", bg: "#f59e0b", color: "#fff" },
                { label: "Error", bg: "#ef4444", color: "#fff" },
                { label: "Info", bg: "#3b82f6", color: "#fff" },
                { label: "Outline", bg: "transparent", color: c(0), border: `1px solid ${c(0)}` },
              ].map((b) => (
                <span key={b.label} style={{ backgroundColor: b.bg, color: b.color, borderRadius: "9999px", padding: "2px 10px", fontSize: "12px", fontWeight: 500, fontFamily: font, border: b.border ?? "none", display: "inline-flex", alignItems: "center" }}>
                  {b.label}
                </span>
              ))}
            </div>
          </section>

          {/* Alerts */}
          <section>
            <h3 className={sectionCls}>Alerts</h3>
            <div className="space-y-3">
              {[
                { type: "Info", bg: "#eff6ff", border: "#3b82f6", color: "#1e40af", icon: "ℹ" },
                { type: "Success", bg: "#f0fdf4", border: "#22c55e", color: "#166534", icon: "✓" },
                { type: "Warning", bg: "#fefce8", border: "#f59e0b", color: "#854d0e", icon: "⚠" },
                { type: "Error", bg: "#fef2f2", border: "#ef4444", color: "#991b1b", icon: "✕" },
              ].map((a) => (
                <div key={a.type} style={{ backgroundColor: a.bg, borderLeft: `4px solid ${a.border}`, color: a.color, borderRadius: rad, padding: "12px 16px", fontSize: "14px", fontFamily: font }}>
                  <span style={{ fontWeight: 600 }}>{a.icon} {a.type}:</span> This is a {a.type.toLowerCase()} alert message.
                </div>
              ))}
            </div>
          </section>

          {/* Cards — expanded */}
          <section>
            <h3 className={sectionCls}>Cards</h3>
            <div className="grid grid-cols-3 gap-4">
              {[
                { title: "Simple Card", desc: "Basic card with title and description" },
                { title: "Feature Card", desc: "Highlighted feature with accent border" },
                { title: "Stat Card", desc: "Numeric stat display", stat: "2,847" },
              ].map((card, n) => (
                <div key={n} style={{ backgroundColor: "var(--card, #fff)", borderRadius: rad, boxShadow: shad, padding: "20px", fontFamily: font, border: n === 1 ? `2px solid ${c(0)}` : "1px solid var(--border, #e5e7eb)" }}>
                  {card.stat && <div style={{ fontSize: "2rem", fontWeight: 700, color: c(0), marginBottom: 4 }}>{card.stat}</div>}
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: "15px" }}>{card.title}</div>
                  <div style={{ color: "var(--muted-foreground, #6b7280)", fontSize: "14px" }}>{card.desc}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Inputs — expanded */}
          <section>
            <h3 className={sectionCls}>Form Elements</h3>
            <div className={cn(cardCls, "space-y-4")}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Text Input</label>
                  <input placeholder="Enter text..." style={{ width: "100%", backgroundColor: "var(--card, #fff)", color: "inherit", borderRadius: rad, border: "1px solid var(--border, #e5e7eb)", padding: "8px 12px", fontSize: "14px", outline: "none", fontFamily: font }} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Search</label>
                  <input type="search" placeholder="Search..." style={{ width: "100%", backgroundColor: "var(--card, #fff)", color: "inherit", borderRadius: rad, border: "1px solid var(--border, #e5e7eb)", padding: "8px 12px", fontSize: "14px", outline: "none", fontFamily: font }} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Textarea</label>
                <textarea placeholder="Write something..." rows={3} style={{ width: "100%", backgroundColor: "var(--card, #fff)", color: "inherit", borderRadius: rad, border: "1px solid var(--border, #e5e7eb)", padding: "8px 12px", fontSize: "14px", outline: "none", fontFamily: font, resize: "vertical" }} />
              </div>
            </div>
          </section>

          {/* Table */}
          <section>
            <h3 className={sectionCls}>Table</h3>
            <div className={cn(cardCls, "p-0 overflow-hidden")}>
              <table style={{ width: "100%", fontFamily: font, fontSize: "14px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                    {["Name", "Status", "Type", "Date"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: "12px", fontWeight: 500, color: "var(--muted-foreground, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Dashboard", "Active", "App", "Mar 21"],
                    ["API Server", "Running", "Service", "Mar 20"],
                    ["Auth Module", "Pending", "Library", "Mar 19"],
                  ].map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ padding: "10px 16px", fontWeight: ci === 0 ? 500 : 400, color: ci === 1 ? c(0) : "inherit" }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Navigation Bar */}
          <section>
            <h3 className={sectionCls}>Navigation</h3>
            <div style={{ backgroundColor: c(0), borderRadius: rad, padding: "0 20px", fontFamily: font, display: "flex", alignItems: "center", justifyContent: "space-between", height: 48 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>Brand</div>
              <div style={{ display: "flex", gap: 24 }}>
                {["Home", "Features", "Pricing", "Docs"].map(l => (
                  <span key={l} style={{ color: "rgba(255,255,255,0.8)", fontSize: "14px", cursor: "default" }}>{l}</span>
                ))}
              </div>
              <button style={{ backgroundColor: "#fff", color: c(0), borderRadius: rad, padding: "4px 14px", fontSize: "13px", border: "none", fontWeight: 500, cursor: "default" }}>Sign up</button>
            </div>
          </section>

          {/* Avatars */}
          <section>
            <h3 className={sectionCls}>Avatars</h3>
            <div className={cn(cardCls, "flex flex-wrap items-end gap-4")}>
              {[24, 32, 40, 48, 56].map((sz) => (
                <div key={sz} className="flex flex-col items-center gap-1">
                  <div style={{ width: sz, height: sz, borderRadius: "50%", backgroundColor: c(0), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: sz * 0.4, fontWeight: 600, fontFamily: font }}>
                    {String.fromCharCode(65 + Math.floor(sz / 10))}
                  </div>
                  <span className="text-xs text-muted-foreground">{sz}px</span>
                </div>
              ))}
            </div>
          </section>

          {/* Spacing Scale */}
          {t.spacing.length > 0 && (
          <section>
            <h3 className={sectionCls}>Spacing Scale</h3>
            <div className={cn(cardCls, "space-y-2")}>
              {t.spacing.slice(0, 10).map((sp, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground font-mono w-16">{sp}</span>
                  <div style={{ height: 12, width: `calc(${sp} * 8)`, backgroundColor: c(0), borderRadius: 2, opacity: 0.6 }} />
                </div>
              ))}
            </div>
          </section>
          )}

          {/* Links */}
          <section>
            <h3 className={sectionCls}>Links</h3>
            <div className={cn(cardCls, "flex flex-wrap gap-6")}>
              <span style={{ color: c(0), fontFamily: font, fontSize: "14px", textDecoration: "underline", cursor: "default" }}>Default link</span>
              <span style={{ color: c(4, "#3b82f6"), fontFamily: font, fontSize: "14px", textDecoration: "underline", cursor: "default" }}>Accent link</span>
              <span style={{ color: c(0), fontFamily: font, fontSize: "14px", textDecoration: "none", borderBottom: `1px dashed ${c(0)}`, cursor: "default" }}>Dashed underline</span>
              <span style={{ color: "var(--muted-foreground, #6b7280)", fontFamily: font, fontSize: "14px", textDecoration: "none", cursor: "default" }}>Muted link →</span>
            </div>
          </section>

          {/* Dividers */}
          <section>
            <h3 className={sectionCls}>Dividers</h3>
            <div className={cn(cardCls, "space-y-4")}>
              <hr style={{ border: "none", borderTop: "1px solid var(--border, #e5e7eb)" }} />
              <hr style={{ border: "none", borderTop: `2px solid ${c(0)}` }} />
              <hr style={{ border: "none", borderTop: "1px dashed var(--border, #e5e7eb)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border, #e5e7eb)" }} />
                <span className="text-xs text-muted-foreground">OR</span>
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border, #e5e7eb)" }} />
              </div>
            </div>
          </section>

          {/* Shadows & Radii */}
          <section>
            <h3 className={sectionCls}>Shadows &amp; Radii</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className={cn(cardCls, "space-y-3")}>
                <div className="text-xs text-muted-foreground mb-2">Shadows ({t.shadows.length})</div>
                {t.shadows.slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div style={{ width: 48, height: 36, background: "var(--card, #fff)", borderRadius: 4, boxShadow: s, border: "1px solid var(--border, #e5e7eb)" }} />
                    <span className="text-xs text-muted-foreground font-mono truncate">{s.slice(0, 45)}</span>
                  </div>
                ))}
              </div>
              <div className={cn(cardCls)}>
                <div className="text-xs text-muted-foreground mb-3">Border Radii ({t.borderRadius.length})</div>
                <div className="flex flex-wrap gap-3">
                  {t.borderRadius.slice(0, 10).map((r, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div style={{ width: 40, height: 40, background: c(0), opacity: 0.15, borderRadius: r }} />
                      <span className="text-xs text-muted-foreground font-mono">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Transitions */}
          {t.transitions.length > 0 && (
          <section>
            <h3 className={sectionCls}>Transitions ({t.transitions.length})</h3>
            <div className={cn(cardCls, "space-y-2")}>
              {t.transitions.slice(0, 5).map((tr, i) => (
                <div key={i} className="text-xs text-muted-foreground font-mono p-2 bg-secondary rounded">{tr}</div>
              ))}
            </div>
          </section>
          )}
        </div>
        );
      })()}
    </div>
  );
}

function buildCssVars(tokens: DesignTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  tokens.colors.slice(0, 12).forEach((c, i) => { vars[`--color-${i + 1}`] = c.value; });
  tokens.typography.fontFamilies.forEach((f, i) => { vars[`--font-${i + 1}`] = `"${f}", sans-serif`; });
  tokens.borderRadius.slice(0, 6).forEach((r, i) => { vars[`--radius-${i + 1}`] = r; });
  tokens.shadows.slice(0, 4).forEach((s, i) => { vars[`--shadow-${i + 1}`] = s; });
  return vars;
}

// ── Kits Tab ──────────────────────────────────────────────────────────────────

function KitsTab() {
  const [kits, setKits] = useState<StyleKit[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StyleKit | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveAsProfileName, setSaveAsProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState<string | null>(null);

  const loadKits = useCallback(async () => {
    try { setKits(await api<StyleKit[]>("/api/kits")); } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadKits(); }, [loadKits]);

  const filtered = kits.filter(k =>
    !search || k.name.toLowerCase().includes(search.toLowerCase()) || k.url.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    await api(`/api/kits/${id}`, { method: "DELETE" });
    setKits(prev => prev.filter(k => k.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleSaveAsProfile = async () => {
    if (!selected || !saveAsProfileName) return;
    setSavingProfile(true);
    try {
      await api(`/api/kits/${selected.id}/save-as-profile`, {
        method: "POST", body: JSON.stringify({ name: saveAsProfileName }),
      });
      setProfileSaved(saveAsProfileName);
      setSaveAsProfileName("");
      setTimeout(() => setProfileSaved(null), 3000);
    } catch { /* ignore */ } finally { setSavingProfile(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Saved Kits</h2>
        <p className="text-sm text-muted-foreground">Browse and manage your extracted style kits.</p>
      </div>

      <InlineInput value={search} onChange={setSearch} placeholder="Search by name or URL..." />

      {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {!loading && filtered.length === 0 && (
        <EmptyState icon={BookMarked} title="No kits saved yet" subtitle="Go to Extract tab to extract your first style kit." />
      )}

      <div className="space-y-3">
        {filtered.map(kit => (
          <div key={kit.id} onClick={() => setSelected(selected?.id === kit.id ? null : kit)}
            className={cn(
              "bg-card border rounded-xl p-4 cursor-pointer transition-all",
              selected?.id === kit.id ? "border-foreground/40" : "border-border hover:border-foreground/20"
            )}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex gap-0.5 shrink-0">
                  {kit.tokens.colors.slice(0, 6).map((c, i) => (
                    <div key={i} className="w-4 h-8 first:rounded-l last:rounded-r" style={{ backgroundColor: c.value }} />
                  ))}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{kit.name}</div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                    <ExternalLink size={10} />
                    {kit.url}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-xs text-muted-foreground">{new Date(kit.createdAt).toLocaleDateString()}</div>
                <div className="flex gap-1.5 text-xs text-muted-foreground">
                  <span className="bg-secondary px-2 py-0.5 rounded">{kit.tokens.colors.length} colors</span>
                  <span className="bg-secondary px-2 py-0.5 rounded">{kit.tokens.typography.fontFamilies.length} fonts</span>
                </div>
                <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors hover:bg-accent text-muted-foreground hover:text-accent-foreground" onClick={(e) => { e.stopPropagation(); void handleDelete(kit.id); }}><Trash2 size={12} /></button>
              </div>
            </div>

            {selected?.id === kit.id && (
              <div className="mt-4 pt-4 border-t border-border space-y-3">
                <div className="grid grid-cols-4 gap-3 text-center">
                  {[
                    { label: "Colors", v: kit.tokens.colors.length },
                    { label: "Fonts", v: kit.tokens.typography.fontFamilies.length },
                    { label: "Radii", v: kit.tokens.borderRadius.length },
                    { label: "Shadows", v: kit.tokens.shadows.length },
                  ].map(({ label, v }) => (
                    <div key={label} className="bg-background rounded-lg p-3">
                      <div className="text-xl font-bold text-foreground">{v}</div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                {kit.tokens.typography.fontFamilies.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="opacity-60">Fonts: </span>
                    {kit.tokens.typography.fontFamilies.join(", ")}
                  </div>
                )}
                {kit.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {kit.tags.map(t => <ColorBadge key={t}>{t}</ColorBadge>)}
                  </div>
                )}
                <div className="flex gap-2 items-center pt-1">
                  <input
                    className="flex-1 bg-background border border-input rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Profile name (e.g. linear-dark)"
                    value={saveAsProfileName}
                    onChange={e => setSaveAsProfileName(e.target.value)}
                  />
                  <ActionButton size="sm" variant="primary" onClick={handleSaveAsProfile} disabled={savingProfile || !saveAsProfileName}>
                    <Plus size={12} />{savingProfile ? "Saving..." : "Save as Profile"}
                  </ActionButton>
                </div>
                {profileSaved && <p className="text-xs text-green-600 dark:text-green-400">Profile &quot;{profileSaved}&quot; created</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

type Tab = "styles" | "health" | "profiles" | "preferences" | "templates" | "extract" | "uikit" | "kits";

const TABS: { id: Tab; label: string }[] = [
  { id: "styles", label: "Styles" },
  { id: "health", label: "Health" },
  { id: "extract", label: "Extract" },
  { id: "uikit", label: "UI Kit" },
  { id: "kits", label: "Kits" },
  { id: "profiles", label: "Profiles" },
  { id: "preferences", label: "Preferences" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("styles");
  const [currentProject, setCurrentProject] = useState("");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-3">
        <div className="flex items-center gap-4 max-w-6xl w-full mx-auto">
          {/* Logo + Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/logo.jpg" alt="logo" className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-bold text-foreground tracking-tight">Hasna</span>
            <span className="font-normal text-muted-foreground tracking-tight">Styles</span>
          </div>

          {/* Navigation */}
          <NavigationMenu className="flex-1">
            <NavigationMenuList className="justify-start gap-0">
              {TABS.map(({ id, label }) => (
                <NavigationMenuItem key={id}>
                  <NavigationMenuLink
                    className={cn(
                      navigationMenuTriggerStyle(),
                      "cursor-pointer",
                      tab === id && "bg-accent text-accent-foreground"
                    )}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>

          {/* Right side controls */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-6 py-6 max-w-6xl w-full mx-auto">
        {tab === "styles" && <StylesTab currentProject={currentProject} />}
        {tab === "health" && <HealthTab currentProject={currentProject} setCurrentProject={setCurrentProject} />}
        {tab === "profiles" && <ProfilesTab />}
        {tab === "preferences" && <PreferencesTab currentProject={currentProject} />}
        {tab === "templates" && <TemplatesTab currentProject={currentProject} />}
        {tab === "extract" && <ExtractTab />}
        {tab === "uikit" && <UiKitTab />}
        {tab === "kits" && <KitsTab />}
      </main>
    </div>
  );
}
