import React, { useState, useEffect, useCallback } from "react";
import { Search, History, Bookmark, Settings, BarChart3, Sun, Moon } from "lucide-react";
import {
  search as apiSearch,
  listSearches,
  listProviders,
  listProfiles,
  listSavedSearches,
  getStats,
  updateProviderApi,
  runSavedSearch,
  deleteSearchItem,
  deleteSavedSearch,
  type SearchResponse,
  type SearchResultItem,
  type ProviderItem,
  type ProfileItem,
  type SavedSearchItem,
  type SearchHistoryResponse,
  type StatsResponse,
} from "./lib/api.js";

type Tab = "search" | "history" | "saved" | "providers" | "stats";

export function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "search", label: "Search", icon: <Search size={16} /> },
    { id: "history", label: "History", icon: <History size={16} /> },
    { id: "saved", label: "Saved", icon: <Bookmark size={16} /> },
    { id: "providers", label: "Providers", icon: <Settings size={16} /> },
    { id: "stats", label: "Stats", icon: <BarChart3 size={16} /> },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">open-search</h1>
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors"
                style={{
                  backgroundColor: tab === t.id ? "var(--accent)" : "transparent",
                  color: tab === t.id ? "var(--primary)" : "var(--muted-foreground)",
                }}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <button onClick={() => setDark(!dark)} className="p-2 rounded" style={{ color: "var(--muted-foreground)" }}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {tab === "search" && <SearchPage />}
        {tab === "history" && <HistoryPage />}
        {tab === "saved" && <SavedPage />}
        {tab === "providers" && <ProvidersPage />}
        {tab === "stats" && <StatsPage />}
      </main>
    </div>
  );
}

// --- Search Page ---
function SearchPage() {
  const [query, setQuery] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInfo, setSearchInfo] = useState<{ duration: number; count: number } | null>(null);
  const [errors, setErrors] = useState<Array<{ provider: string; error: string }>>([]);

  useEffect(() => {
    listProviders().then(setProviders).catch(() => {});
    listProfiles().then(setProfiles).catch(() => {});
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setErrors([]);
    try {
      const res = await apiSearch(
        query,
        selectedProviders.length > 0 ? selectedProviders : undefined,
        selectedProfile || undefined,
      );
      setResults(res.results);
      setSearchInfo({ duration: res.search.duration, count: res.results.length });
      setErrors(res.errors);
    } catch (err) {
      setErrors([{ provider: "system", error: err instanceof Error ? err.message : "Search failed" }]);
    } finally {
      setLoading(false);
    }
  }, [query, selectedProviders, selectedProfile]);

  const toggleProvider = (name: string) => {
    setSelectedProviders((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    );
  };

  const SOURCE_COLORS: Record<string, string> = {
    google: "#4285f4",
    exa: "#8b5cf6",
    perplexity: "#06b6d4",
    brave: "#fb923c",
    bing: "#0078d4",
    twitter: "#000000",
    reddit: "#ff4500",
    youtube: "#ff0000",
    hackernews: "#ff6600",
    github: "#333333",
    arxiv: "#b31b1b",
    serpapi: "#22c55e",
  };

  return (
    <div>
      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search across all providers..."
          className="flex-1 px-4 py-2 rounded border text-sm outline-none"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Provider checkboxes + profile selector */}
      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <div className="flex flex-wrap gap-2">
          {providers.filter((p) => p.enabled && p.configured).map((p) => (
            <label key={p.name} className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selectedProviders.includes(p.name)}
                onChange={() => toggleProvider(p.name)}
              />
              {p.name}
            </label>
          ))}
        </div>
        <select
          value={selectedProfile}
          onChange={(e) => setSelectedProfile(e.target.value)}
          className="text-xs px-2 py-1 rounded border"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
        >
          <option value="">No profile</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Search info */}
      {searchInfo && (
        <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>
          {searchInfo.count} results in {searchInfo.duration}ms
        </p>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="mb-4 p-2 rounded text-xs" style={{ backgroundColor: "#fef2f2", color: "#991b1b" }}>
          {errors.map((e, i) => (
            <div key={i}>{e.provider}: {e.error}</div>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="space-y-3">
        {results.map((r) => (
          <div key={r.id} className="p-3 rounded border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white"
                style={{ backgroundColor: SOURCE_COLORS[r.source] ?? "#666" }}
              >
                {r.source}
              </span>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline" style={{ color: "var(--primary)" }}>
                {r.title}
              </a>
            </div>
            <p className="text-xs truncate" style={{ color: "var(--muted-foreground)" }}>{r.url}</p>
            {r.snippet && <p className="text-xs mt-1 line-clamp-2">{r.snippet}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- History Page ---
function HistoryPage() {
  const [data, setData] = useState<SearchHistoryResponse | null>(null);

  useEffect(() => {
    listSearches(50).then(setData).catch(() => {});
  }, []);

  const handleDelete = async (id: string) => {
    await deleteSearchItem(id);
    setData((prev) =>
      prev ? { ...prev, searches: prev.searches.filter((s) => s.id !== id), total: prev.total - 1 } : null,
    );
  };

  if (!data) return <p style={{ color: "var(--muted-foreground)" }}>Loading...</p>;

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Search History ({data.total})</h2>
      <div className="space-y-2">
        {data.searches.map((s) => (
          <div key={s.id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
            <div>
              <p className="text-sm font-medium">{s.query}</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                {s.providers.join(", ")} &middot; {s.resultCount} results &middot; {s.duration}ms &middot; {new Date(s.createdAt).toLocaleString()}
              </p>
            </div>
            <button onClick={() => handleDelete(s.id)} className="text-xs px-2 py-1 rounded" style={{ color: "var(--destructive)" }}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Saved Page ---
function SavedPage() {
  const [items, setItems] = useState<SavedSearchItem[]>([]);

  useEffect(() => {
    listSavedSearches().then(setItems).catch(() => {});
  }, []);

  const handleRun = async (id: string) => {
    const res = await runSavedSearch(id);
    alert(`Ran search: ${res.results.length} results`);
  };

  const handleDelete = async (id: string) => {
    await deleteSavedSearch(id);
    setItems((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Saved Searches</h2>
      {items.length === 0 ? (
        <p style={{ color: "var(--muted-foreground)" }}>No saved searches yet</p>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 rounded border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
              <div>
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {s.query} &middot; {s.providers.join(", ") || "all"} &middot; last: {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "never"}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleRun(s.id)} className="text-xs px-2 py-1 rounded" style={{ color: "var(--primary)" }}>Run</button>
                <button onClick={() => handleDelete(s.id)} className="text-xs px-2 py-1 rounded" style={{ color: "var(--destructive)" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Providers Page ---
function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);

  useEffect(() => {
    listProviders().then(setProviders).catch(() => {});
  }, []);

  const toggleEnabled = async (name: string, enabled: boolean) => {
    await updateProviderApi(name, { enabled: !enabled });
    setProviders((prev) => prev.map((p) => (p.name === name ? { ...p, enabled: !enabled } : p)));
  };

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Search Providers</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {providers.map((p) => (
          <div key={p.name} className="p-4 rounded border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">{p.name}</span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: p.enabled && p.configured ? "#dcfce7" : p.enabled ? "#fef9c3" : "var(--muted)",
                  color: p.enabled && p.configured ? "#166534" : p.enabled ? "#854d0e" : "var(--muted-foreground)",
                }}
              >
                {p.enabled ? (p.configured ? "ready" : "no key") : "disabled"}
              </span>
            </div>
            <p className="text-xs mb-2" style={{ color: "var(--muted-foreground)" }}>
              {p.apiKeyEnv || "No key needed"} &middot; {p.rateLimit}/min
            </p>
            <button
              onClick={() => toggleEnabled(p.name, p.enabled)}
              className="text-xs px-2 py-1 rounded border"
              style={{ borderColor: "var(--border)" }}
            >
              {p.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Stats Page ---
function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  if (!stats) return <p style={{ color: "var(--muted-foreground)" }}>Loading...</p>;

  const maxCount = Math.max(...Object.values(stats.providerBreakdown), 1);

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Statistics</h2>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
          <p className="text-2xl font-bold">{stats.totalSearches}</p>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Total Searches</p>
        </div>
        <div className="p-4 rounded border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
          <p className="text-2xl font-bold">{stats.totalResults}</p>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Total Results</p>
        </div>
      </div>

      <h3 className="text-sm font-bold mb-3">Results by Provider</h3>
      <div className="space-y-2">
        {Object.entries(stats.providerBreakdown)
          .sort(([, a], [, b]) => b - a)
          .map(([provider, count]) => (
            <div key={provider} className="flex items-center gap-3">
              <span className="text-xs w-20">{provider}</span>
              <div className="flex-1 h-5 rounded overflow-hidden" style={{ backgroundColor: "var(--muted)" }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(count / maxCount) * 100}%`,
                    backgroundColor: "var(--primary)",
                  }}
                />
              </div>
              <span className="text-xs w-12 text-right">{count}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
