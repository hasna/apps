# @hasna/git

Local git intelligence platform for AI agents. Track all repos on your machine, search commits, PRs, branches across every repository. CLI + MCP server + Web dashboard.

## Install

```bash
bun install -g @hasna/git
```

## Quick Start

```bash
# Scan all repos under ~/Workspace
git-local scan

# List all tracked repos
git-local repos

# Search across everything
git-local search "authentication"

# Show stats
git-local stats

# Start the dashboard
git-local-serve  # http://localhost:19450
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `git-local scan` | Discover and index all git repos |
| `git-local repos` | List repositories |
| `git-local repo <name>` | Get repo details |
| `git-local commits` | List commits |
| `git-local branches` | List branches |
| `git-local tags` | List tags |
| `git-local prs` | List pull requests |
| `git-local search <query>` | Unified search across all entities |
| `git-local stats` | Global statistics |
| `git-local activity` | Recent commit activity |
| `git-local contributors` | Top contributors |
| `git-local stale` | Stale repos with no recent commits |
| `git-local heatmap` | Commit activity heatmap |
| `git-local sync-github` | Sync PRs from GitHub |
| `git-local gh-info <name>` | Fetch GitHub metadata |

All commands support `--json` for machine-readable output.

## MCP Server

```bash
git-local-mcp
```

19 tools available for AI agents:

- `list_repos`, `get_repo`, `search_repos`
- `list_commits`, `search_commits`
- `list_branches`, `list_tags`
- `list_prs`, `search_prs`
- `list_remotes`
- `search` (unified)
- `scan_repos`
- `get_stats`, `get_repo_stats`
- `sync_github_prs`, `sync_all_github_prs`, `fetch_repo_metadata`
- `register_agent`, `heartbeat`, `list_agents`

## REST API

```bash
git-local-serve  # Default port: 19450
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/repos` | GET | List repos |
| `/api/repos/:id` | GET | Get repo + stats |
| `/api/search/repos` | GET | Search repos |
| `/api/commits` | GET | List commits |
| `/api/search/commits` | GET | Search commits |
| `/api/branches` | GET | List branches |
| `/api/tags` | GET | List tags |
| `/api/prs` | GET | List PRs |
| `/api/search` | GET | Unified search |
| `/api/stats` | GET | Global stats |
| `/api/scan` | POST | Trigger scan |

## SDK

```typescript
import { scanRepos, searchAll, listRepos, getGlobalStats } from "@hasna/git";

const result = scanRepos(["/home/user/code"]);
const repos = listRepos({ org: "myorg" });
const results = searchAll("authentication");
```

## Data Storage

SQLite database at `~/.hasna/git/git-local.db` with WAL mode and FTS5 full-text search.

## License

Apache-2.0
