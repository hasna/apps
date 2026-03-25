import React, { useEffect, useState } from "react";
import { Search, GitBranch, GitCommit, GitPullRequest, FolderGit2, BarChart3, RefreshCw, ArrowLeft, Tag, Clock } from "lucide-react";

const API = "/api";

interface Repo {
  id: number;
  name: string;
  org: string | null;
  path: string;
  remote_url: string | null;
  default_branch: string;
  description: string | null;
  commit_count: number;
  branch_count: number;
  tag_count: number;
  last_scanned: string | null;
}

interface Commit {
  id: number;
  sha: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
  files_changed: number;
  insertions: number;
  deletions: number;
}

interface Branch {
  id: number;
  name: string;
  is_remote: number;
  last_commit_sha: string | null;
  last_commit_date: string | null;
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

type View = "repos" | "search" | "stats" | "repo-detail" | "timeline";

export function App() {
  const [view, setView] = useState<View>("repos");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [orgFilter, setOrgFilter] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [repoCommits, setRepoCommits] = useState<Commit[]>([]);
  const [repoBranches, setRepoBranches] = useState<Branch[]>([]);
  const [repoDetail, setRepoDetail] = useState<any>(null);
  const [timeline, setTimeline] = useState<Commit[]>([]);

  useEffect(() => {
    fetch(`${API}/repos?limit=500`).then((r) => r.json()).then(setRepos);
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
    const [reposRes, statsRes] = await Promise.all([fetch(`${API}/repos?limit=500`), fetch(`${API}/stats`)]);
    setRepos(await reposRes.json());
    setStats(await statsRes.json());
    setScanning(false);
  };

  const openRepo = async (repo: Repo) => {
    setSelectedRepo(repo);
    const [detailRes, commitsRes, branchesRes] = await Promise.all([
      fetch(`${API}/repos/${repo.id}`),
      fetch(`${API}/commits?repo_id=${repo.id}&limit=50`),
      fetch(`${API}/branches?repo_id=${repo.id}&limit=100`),
    ]);
    setRepoDetail(await detailRes.json());
    setRepoCommits(await commitsRes.json());
    setRepoBranches(await branchesRes.json());
    setView("repo-detail");
  };

  const openTimeline = async () => {
    const res = await fetch(`${API}/commits?limit=100`);
    setTimeline(await res.json());
    setView("timeline");
  };

  const orgs = [...new Set(repos.map((r) => r.org).filter(Boolean))] as string[];
  const filteredRepos = orgFilter ? repos.filter((r) => r.org === orgFilter) : repos;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2 cursor-pointer" onClick={() => setView("repos")}>
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
          <input type="text" placeholder="Search repos, commits, PRs..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            className="w-full pl-10 pr-4 py-2 rounded border text-sm"
            style={{ background: "var(--card)", borderColor: "var(--border)" }} />
        </div>
      </div>

      {/* Nav */}
      <div className="flex gap-4 mb-6 border-b" style={{ borderColor: "var(--border)" }}>
        {[
          { key: "repos" as View, label: "Repos", icon: FolderGit2, count: stats?.total_repos },
          { key: "timeline" as View, label: "Timeline", icon: Clock },
          { key: "search" as View, label: "Search", icon: Search },
          { key: "stats" as View, label: "Stats", icon: BarChart3 },
        ].map(({ key, label, icon: Icon, count }) => (
          <button key={key} onClick={() => key === "timeline" ? openTimeline() : setView(key)}
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
              <button onClick={() => setOrgFilter("")} className="px-2 py-1 rounded text-xs"
                style={{ background: !orgFilter ? "var(--accent)" : "var(--card)", color: !orgFilter ? "var(--accent-fg)" : "var(--fg)", border: "1px solid var(--border)" }}>
                All ({repos.length})
              </button>
              {orgs.map((org) => (
                <button key={org} onClick={() => setOrgFilter(org)} className="px-2 py-1 rounded text-xs"
                  style={{ background: orgFilter === org ? "var(--accent)" : "var(--card)", color: orgFilter === org ? "var(--accent-fg)" : "var(--fg)", border: "1px solid var(--border)" }}>
                  {org} ({repos.filter((r) => r.org === org).length})
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3">
            {filteredRepos.map((repo) => (
              <div key={repo.id} className="p-4 rounded border cursor-pointer hover:border-blue-400 transition-colors"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
                onClick={() => openRepo(repo)}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium">{repo.name}</h3>
                    {repo.org && <span className="text-xs px-1.5 py-0.5 rounded ml-1" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>{repo.org}</span>}
                  </div>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{repo.default_branch}</span>
                </div>
                {repo.description && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{repo.description}</p>}
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{repo.path}</p>
                <div className="flex gap-4 mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  <span className="flex items-center gap-1"><GitCommit className="w-3 h-3" /> {repo.commit_count}</span>
                  <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" /> {repo.branch_count}</span>
                  <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {repo.tag_count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repo Detail View */}
      {view === "repo-detail" && selectedRepo && (
        <div>
          <button onClick={() => setView("repos")} className="flex items-center gap-1 text-sm mb-4" style={{ color: "var(--accent)" }}>
            <ArrowLeft className="w-4 h-4" /> Back to repos
          </button>

          <div className="p-4 rounded border mb-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h2 className="text-xl font-bold">{selectedRepo.name}</h2>
            {selectedRepo.org && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>{selectedRepo.org}</span>}
            {selectedRepo.description && <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>{selectedRepo.description}</p>}
            <p className="text-xs mt-1 font-mono" style={{ color: "var(--muted)" }}>{selectedRepo.path}</p>
            {selectedRepo.remote_url && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{selectedRepo.remote_url}</p>}
            <div className="grid grid-cols-4 gap-4 mt-4">
              {[
                { label: "Commits", value: repoDetail?.commit_count || selectedRepo.commit_count },
                { label: "Branches", value: repoDetail?.branch_count || selectedRepo.branch_count },
                { label: "Tags", value: repoDetail?.tag_count || selectedRepo.tag_count },
                { label: "PRs", value: repoDetail?.pr_count || 0 },
              ].map(({ label, value }) => (
                <div key={label} className="text-center p-2 rounded" style={{ background: "var(--bg)" }}>
                  <div className="text-lg font-bold">{value}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
                </div>
              ))}
            </div>
            {repoDetail?.top_authors?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-1">Top Authors</h4>
                <div className="flex flex-wrap gap-2">
                  {repoDetail.top_authors.slice(0, 5).map((a: any) => (
                    <span key={a.author} className="text-xs px-2 py-1 rounded" style={{ background: "var(--bg)" }}>
                      {a.author} ({a.count})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Branches */}
          {repoBranches.length > 0 && (
            <div className="p-4 rounded border mb-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="font-medium mb-2 flex items-center gap-1"><GitBranch className="w-4 h-4" /> Branches ({repoBranches.length})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {repoBranches.filter(b => !b.is_remote).map((b) => (
                  <div key={b.id} className="text-xs p-2 rounded flex items-center gap-1" style={{ background: "var(--bg)" }}>
                    <GitBranch className="w-3 h-3" style={{ color: "var(--accent)" }} />
                    {b.name}
                    {b.last_commit_sha && <span className="font-mono" style={{ color: "var(--muted)" }}>{b.last_commit_sha.slice(0, 7)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commits */}
          <div className="p-4 rounded border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="font-medium mb-2 flex items-center gap-1"><GitCommit className="w-4 h-4" /> Recent Commits</h3>
            <div className="space-y-2">
              {repoCommits.map((c) => (
                <div key={c.id} className="flex items-start gap-3 text-sm py-2 border-b" style={{ borderColor: "var(--border)" }}>
                  <span className="font-mono text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "#eab30815", color: "#eab308" }}>
                    {c.sha.slice(0, 7)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{c.message}</p>
                    <div className="flex gap-3 text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      <span>{c.author_name}</span>
                      <span>{c.date.slice(0, 10)}</span>
                      {(c.insertions > 0 || c.deletions > 0) && (
                        <span>
                          <span style={{ color: "#22c55e" }}>+{c.insertions}</span>
                          {" / "}
                          <span style={{ color: "#ef4444" }}>-{c.deletions}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Timeline View */}
      {view === "timeline" && (
        <div>
          <h2 className="text-lg font-bold mb-4">Global Commit Timeline</h2>
          <div className="space-y-2">
            {timeline.map((c) => (
              <div key={c.id} className="flex items-start gap-3 p-3 rounded border text-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <span className="font-mono text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "#eab30815", color: "#eab308" }}>
                  {c.sha.slice(0, 7)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{c.message}</p>
                  <div className="flex gap-3 text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    <span>{c.author_name}</span>
                    <span>{c.date.slice(0, 16).replace("T", " ")}</span>
                    {(c.insertions > 0 || c.deletions > 0) && (
                      <span><span style={{ color: "#22c55e" }}>+{c.insertions}</span> / <span style={{ color: "#ef4444" }}>-{c.deletions}</span></span>
                    )}
                  </div>
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
          {Object.keys(stats.repos_by_org).length > 0 && (
            <div className="col-span-full p-4 rounded border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <h3 className="font-medium mb-2">Repos by Org</h3>
              <div className="flex flex-wrap gap-3">
                {Object.entries(stats.repos_by_org).map(([org, count]) => (
                  <div key={org} className="text-center p-2 rounded" style={{ background: "var(--bg)" }}>
                    <div className="text-lg font-bold">{count}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>{org}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
