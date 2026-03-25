#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listRepos,
  getRepo,
  searchRepos,
  listCommits,
  searchCommits,
  listBranches,
  listTags,
  listPullRequests,
  searchPullRequests,
  searchAll,
  getRepoStats,
  getGlobalStats,
  listRemotes,
} from "../db/repos.js";
import { scanRepos } from "../lib/scanner.js";
import { syncGithubPRs, syncAllGithubPRs, fetchRepoMetadata } from "../lib/github.js";
import { getDb } from "../db/database.js";

const server = new McpServer({
  name: "git-local",
  version: "0.1.0",
});

// ── Repos ──

server.tool("list_repos", "List all tracked repositories", {
  limit: z.number().optional().describe("Max results (default 50)"),
  offset: z.number().optional().describe("Skip N results"),
  org: z.string().optional().describe("Filter by GitHub org"),
  query: z.string().optional().describe("Filter by name/description"),
}, async (args) => {
  const repos = listRepos(args);
  return { content: [{ type: "text", text: JSON.stringify(repos, null, 2) }] };
});

server.tool("get_repo", "Get a repo by ID, path, or name", {
  id: z.string().describe("Repo ID, path, or name"),
}, async ({ id }) => {
  const repo = getRepo(isNaN(Number(id)) ? id : Number(id));
  if (!repo) return { content: [{ type: "text", text: "Repo not found" }] };
  const stats = getRepoStats(repo.id);
  return { content: [{ type: "text", text: JSON.stringify({ ...repo, ...stats }, null, 2) }] };
});

server.tool("search_repos", "Search repos by name, description, or URL", {
  query: z.string().describe("Search query"),
  limit: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, limit }) => {
  const repos = searchRepos(query, limit);
  return { content: [{ type: "text", text: JSON.stringify(repos, null, 2) }] };
});

// ── Commits ──

server.tool("list_commits", "List commits with optional filters", {
  repo_id: z.number().optional().describe("Filter by repo ID"),
  author: z.string().optional().describe("Filter by author name/email"),
  since: z.string().optional().describe("Commits after this date (ISO 8601)"),
  until: z.string().optional().describe("Commits before this date (ISO 8601)"),
  limit: z.number().optional().describe("Max results (default 50)"),
  offset: z.number().optional().describe("Skip N results"),
}, async (args) => {
  const commits = listCommits(args);
  return { content: [{ type: "text", text: JSON.stringify(commits, null, 2) }] };
});

server.tool("search_commits", "Full-text search on commit messages", {
  query: z.string().describe("Search query"),
  limit: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, limit }) => {
  const commits = searchCommits(query, limit);
  return { content: [{ type: "text", text: JSON.stringify(commits, null, 2) }] };
});

// ── Branches ──

server.tool("list_branches", "List branches with optional filters", {
  repo_id: z.number().optional().describe("Filter by repo ID"),
  is_remote: z.boolean().optional().describe("Filter remote/local branches"),
  limit: z.number().optional().describe("Max results (default 100)"),
}, async (args) => {
  const branches = listBranches(args);
  return { content: [{ type: "text", text: JSON.stringify(branches, null, 2) }] };
});

// ── Tags ──

server.tool("list_tags", "List git tags", {
  repo_id: z.number().optional().describe("Filter by repo ID"),
  limit: z.number().optional().describe("Max results (default 100)"),
}, async (args) => {
  const tags = listTags(args);
  return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
});

// ── Pull Requests ──

server.tool("list_prs", "List pull requests", {
  repo_id: z.number().optional().describe("Filter by repo ID"),
  state: z.string().optional().describe("Filter by state: open, closed, merged"),
  author: z.string().optional().describe("Filter by author"),
  limit: z.number().optional().describe("Max results (default 50)"),
}, async (args) => {
  const prs = listPullRequests(args);
  return { content: [{ type: "text", text: JSON.stringify(prs, null, 2) }] };
});

server.tool("search_prs", "Full-text search on PR titles", {
  query: z.string().describe("Search query"),
  limit: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, limit }) => {
  const prs = searchPullRequests(query, limit);
  return { content: [{ type: "text", text: JSON.stringify(prs, null, 2) }] };
});

// ── Remotes ──

server.tool("list_remotes", "List remotes for a repo", {
  repo_id: z.number().describe("Repo ID"),
}, async ({ repo_id }) => {
  const remotes = listRemotes(repo_id);
  return { content: [{ type: "text", text: JSON.stringify(remotes, null, 2) }] };
});

// ── Unified Search ──

server.tool("search", "Search across all entities (repos, commits, PRs)", {
  query: z.string().describe("Search query"),
  limit: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, limit }) => {
  const results = searchAll(query, limit);
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

// ── Scanner ──

server.tool("scan_repos", "Scan directories to discover and index git repos", {
  roots: z.array(z.string()).optional().describe("Root directories to scan (default: ~/Workspace)"),
  full: z.boolean().optional().describe("Full re-scan (default: incremental)"),
}, async ({ roots, full }) => {
  const result = scanRepos(roots, { full });
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

// ── Stats ──

server.tool("get_stats", "Get global stats across all repos", {}, async () => {
  const stats = getGlobalStats();
  return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
});

server.tool("get_repo_stats", "Get detailed stats for a specific repo", {
  repo_id: z.number().describe("Repo ID"),
}, async ({ repo_id }) => {
  const stats = getRepoStats(repo_id);
  return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
});

// ── GitHub Sync ──

server.tool("sync_github_prs", "Sync PRs from GitHub for a specific repo", {
  repo: z.string().describe("Repo name, path, or ID"),
  limit: z.number().optional().describe("Max PRs to fetch (default 100)"),
  state: z.string().optional().describe("PR state: all, open, closed (default all)"),
}, async ({ repo, limit, state }) => {
  try {
    const result = syncGithubPRs(repo, { limit, state });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
  }
});

server.tool("sync_all_github_prs", "Sync PRs from GitHub for all repos (or by org)", {
  org: z.string().optional().describe("Filter by GitHub org"),
  limit: z.number().optional().describe("Max PRs per repo (default 50)"),
}, async ({ org, limit }) => {
  const result = syncAllGithubPRs({ org, limit });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.tool("fetch_repo_metadata", "Fetch GitHub metadata (stars, topics, language)", {
  repo: z.string().describe("Repo name or ID"),
}, async ({ repo }) => {
  const meta = fetchRepoMetadata(repo);
  if (!meta) return { content: [{ type: "text", text: "Cannot fetch metadata" }] };
  return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }] };
});

// ── Agent Support ──

server.tool("register_agent", "Register an agent", {
  name: z.string().describe("Agent name"),
  description: z.string().optional(),
  session_id: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  working_dir: z.string().optional(),
}, async (args) => {
  const db = getDb();
  const id = crypto.randomUUID().slice(0, 8);
  db.query(`INSERT OR REPLACE INTO agents (id, name, description, session_id, capabilities, working_dir, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(
    id, args.name, args.description || null, args.session_id || null,
    JSON.stringify(args.capabilities || []), args.working_dir || null
  );
  return { content: [{ type: "text", text: JSON.stringify({ id, name: args.name, registered: true }) }] };
});

server.tool("heartbeat", "Send agent heartbeat", {
  name: z.string().optional(),
  status: z.string().optional(),
}, async (args) => {
  const db = getDb();
  if (args.name) {
    db.query("UPDATE agents SET last_seen = datetime('now') WHERE name = ?").run(args.name);
  }
  return { content: [{ type: "text", text: JSON.stringify({ heartbeat: true }) }] };
});

server.tool("list_agents", "List registered agents", {}, async () => {
  const db = getDb();
  const agents = db.query("SELECT * FROM agents ORDER BY last_seen DESC").all();
  return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
});

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
