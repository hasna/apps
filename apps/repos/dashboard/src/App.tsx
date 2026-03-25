import React, { useEffect, useState } from "react";
import { Search, GitBranch, GitCommit, GitPullRequest, FolderGit2, BarChart3, RefreshCw } from "lucide-react";

const API = "/api";

interface Repo {
  id: number;
  name: string;
  org: string | null;
  path: string;
  remote_url: string | null;
  default_branch: string;
  commit_count: number;
  branch_count: number;
  tag_count: number;
  last_scanned: string | null;
}

interface Stats {
  total_repos: number;
  total_commits: number;
  total_branches: number;
  total_tags: number;
  total_prs: number;
  repos_by_org: Record<string, number>;
  most_active_repos: Array<{ name: string; commits: number }>;
}

interface SearchResult {
  type: string;
  repo_name: string;
  title: string;
  snippet: string;
  date: string | null;
}

type View = "repos" | "search" | "stats";

export function App() {
  const [view, setView] = useState<View>("repos");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [orgFilter, setOrgFilter] = useState("");

  useEffect(() => {
    fetch(`${API}/repos?limit=200`).then((r) => r.json()).then(setRepos);
    fetch(`${API}/stats`).then((r) => r.json()).then(setStats);
  }, []);

  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    const res = await fetch(`${API}/search?query=${encodeURIComponent(searchQuery)}`);
    setSearchResults(await res.json());
    setView("search");
  };

  const doScan = async () => {
    setScanning(true);
    await fetch(`${API}/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const res = await fetch(`${API}/repos?limit=200`);
    setRepos(await res.json());
    const statsRes = await fetch(`${API}/stats`);
    setStats(await statsRes.json());
    setScanning(false);
  };

  const orgs = [...new Set(repos.map((r) => r.org).filter(Boolean))] as string[];
  const filteredRepos = orgFilter ? repos.filter((r) => r.org === orgFilter) : repos;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderGit2 className="w-6 h-6" /> repos
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={doScan} disabled={scanning}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm"
            style={{ background: "var(--accent)", color: "var(--accent-fg)", opacity: scanning ? 0.5 : 1 }}>
            <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning..." : "Scan"}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4" style={{ color: "var(--muted)" }} />
          <input
            type="text" placeholder="Search repos, commits, PRs..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            className="w-full pl-10 pr-4 py-2 rounded border text-sm"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          />
        </div>
      </div>

      {/* Nav */}
      <div className="flex gap-4 mb-6 border-b" style={{ borderColor: "var(--border)" }}>
        {[
          { key: "repos" as View, label: "Repos", icon: FolderGit2, count: stats?.total_repos },
          { key: "search" as View, label: "Search", icon: Search },
          { key: "stats" as View, label: "Stats", icon: BarChart3 },
        ].map(({ key, label, icon: Icon, count }) => (
          <button key={key} onClick={() => setView(key)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px"
            style={{ borderColor: view === key ? "var(--accent)" : "transparent", color: view === key ? "var(--accent)" : "var(--muted)" }}>
            <Icon className="w-4 h-4" /> {label} {count !== undefined && <span className="text-xs">({count})</span>}
          </button>
        ))}
      </div>

      {/* Repos View */}
      {view === "repos" && (
        <div>
          {orgs.length > 0 && (
            <div className="flex gap-2 mb-4 flex-wrap">
              <button onClick={() => setOrgFilter("")}
                className="px-2 py-1 rounded text-xs"
                style={{ background: !orgFilter ? "var(--accent)" : "var(--card)", color: !orgFilter ? "var(--accent-fg)" : "var(--fg)", border: `1px solid var(--border)` }}>
                All
              </button>
              {orgs.map((org) => (
                <button key={org} onClick={() => setOrgFilter(org)}
                  className="px-2 py-1 rounded text-xs"
                  style={{ background: orgFilter === org ? "var(--accent)" : "var(--card)", color: orgFilter === org ? "var(--accent-fg)" : "var(--fg)", border: `1px solid var(--border)` }}>
                  {org} ({repos.filter((r) => r.org === org).length})
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3">
            {filteredRepos.map((repo) => (
              <div key={repo.id} className="p-4 rounded border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium">{repo.name}</h3>
                    {repo.org && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>{repo.org}</span>}
                  </div>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{repo.default_branch}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{repo.path}</p>
                <div className="flex gap-4 mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  <span className="flex items-center gap-1"><GitCommit className="w-3 h-3" /> {repo.commit_count}</span>
                  <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" /> {repo.branch_count}</span>
                  <span className="flex items-center gap-1"><GitPullRequest className="w-3 h-3" /> {repo.tag_count} tags</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search View */}
      {view === "search" && (
        <div className="grid gap-2">
          {searchResults.length === 0 && <p style={{ color: "var(--muted)" }}>No results. Try a search above.</p>}
          {searchResults.map((r, i) => (
            <div key={i} className="p-3 rounded border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{ background: r.type === "repo" ? "#2563eb20" : r.type === "commit" ? "#eab30820" : "#a855f720", color: r.type === "repo" ? "#2563eb" : r.type === "commit" ? "#eab308" : "#a855f7" }}>
                  {r.type}
                </span>
                <span className="font-medium text-sm">{r.title}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>({r.repo_name})</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{r.snippet}</p>
            </div>
          ))}
        </div>
      )}

      {/* Stats View */}
      {view === "stats" && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Repos", value: stats.total_repos },
            { label: "Commits", value: stats.total_commits },
            { label: "Branches", value: stats.total_branches },
            { label: "PRs", value: stats.total_prs },
          ].map(({ label, value }) => (
            <div key={label} className="p-4 rounded border text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="text-2xl font-bold">{value.toLocaleString()}</div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>{label}</div>
            </div>
          ))}
          {stats.most_active_repos.length > 0 && (
            <div className="col-span-full p-4 rounded border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="font-medium mb-2">Most Active Repos</h3>
              {stats.most_active_repos.slice(0, 10).map((r) => (
                <div key={r.name} className="flex justify-between text-sm py-1">
                  <span>{r.name}</span>
                  <span style={{ color: "var(--muted)" }}>{r.commits} commits</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
