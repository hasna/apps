# @hasna/search

Unified search for machines and agents — a **local file index** (find files by name, path, or content in milliseconds) plus **12 web providers** (Google, SerpAPI, Exa, Perplexity, Twitter, Reddit, YouTube, Brave, Bing, Hacker News, GitHub, arXiv) and YouTube transcription. CLI + MCP + REST API + Dashboard.

[![npm](https://img.shields.io/npm/v/@hasna/search)](https://www.npmjs.com/package/@hasna/search)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/search
```

## Local Search

Index a workspace once, then find anything in one call:

```bash
search index add ~/workspace          # register + index (gitignore-aware, incremental)
search find storage-config            # by file name/path
search find "deduplicate results"     # by content, with line numbers
search find dedup -k file -e ts       # filters: kind, extension, dir, root
search index status                   # roots, file counts, staleness
search index update                   # incremental reindex (auto-runs when stale)
```

The index lives in SQLite (`~/.hasna/search/index.db`) using trigram FTS5 for substring
matching. Re-indexing only touches changed files; stale roots refresh automatically
before serving results. `node_modules`, `.git`, build output, binaries, and anything
in `.gitignore` are excluded.

Local results also join unified search as the `files` and `content` providers
(`search query dedup --profile local`, or blended with web providers via `--profile all`).

Regex (grep-style) search works too, Cursor-style — required literals from the
pattern prefilter candidates through the trigram index, then the real regex runs
only on those files:

```bash
search find "export (function|const) handle\w+" -x          # regex, line-based
search find "storage-(config|sync)\.ts$" -x -k file         # regex over paths
```

### Performance

Measured on a 158,140-file workspace index (79GB tree, 1.8GB index), warm cache,
20-core Linux box — `search find -k content` vs `ripgrep -l`, wall clock per query:

| Query | ripgrep | search find |
|---|---|---|
| `contentless_delete` | 0.65s | 0.06s |
| `registerStorageCommands` | 0.20s | 0.07s |
| `IgnoreMatcher` | 0.20s | 0.06s |

CPU per query: rg ~2.2s across cores; find ~0.08s on one. Initial indexing of the
same tree: 166s; incremental re-index when nothing changed: ~2.7s (runs
automatically at most once per `indexStaleMinutes`). Results come back ranked,
deduplicated across file-name and content matches, and scoped to all indexed
roots regardless of the caller's working directory.

## Web Search

```bash
search query "bun sqlite fts5" --profile research
search exa "semantic search"          # any provider directly
```

## CLI Usage

```bash
search --help
```

### Compact output and detail flags

CLI commands that can return many rows are compact by default. Search results,
history, saved searches, local `find`, and index list/status views show capped
rows, shortened long text, totals, and a hint for the next detail command.

Use these flags when you need more:

```bash
search history list --limit 20 --offset 20
search history show <id> --verbose
search history list --json
search find "storage config" --verbose
search index status --json
```

Human-readable output is optimized for agent terminals and keeps large records
out of context by default. `--json` keeps full machine-readable records for CLI
commands, while `--verbose` expands human output where available.

## MCP Server

```bash
search-mcp
```

Agent-facing tools include `find` (one-call local file lookup), `index_add` /
`index_update` / `index_status` / `index_remove`, unified `search`, per-provider
`search_*` tools, history, saved searches, profiles, and export.

MCP list/search tools also return compact JSON envelopes by default:

```json
{"kind":"results","total":25,"returned":20,"offset":0,"nextOffset":20,"items":[],"hint":"Use get_result for one full record, or verbose:true for full listed records."}
```

Pass `verbose:true` for full listed records, use `limit` and `offset` for paging,
and use detail tools such as `get_search` or `get_result` when you only need one
complete object.

## HTTP mode

```bash
search-mcp --http              # default port 8832
MCP_HTTP=1 search-mcp
```

- Health: `GET http://127.0.0.1:8832/health`
- MCP: `http://127.0.0.1:8832/mcp`
- Stdio remains default. `search-serve` also mounts `/health` and `/mcp`.

## REST API

```bash
search-serve
```

`/api/find`, `/api/index`, `/api/search`, and the dashboard (with a Local tab) on port 19800.

## Storage Sync

Storage sync is optional. By default search uses local SQLite at `~/.hasna/search/`.

```bash
search storage status
search storage push
search storage pull
search storage sync
```

Set `HASNA_SEARCH_DATABASE_URL` or `SEARCH_DATABASE_URL` to run in hybrid/remote mode with PostgreSQL. RDS host settings can be configured in `~/.hasna/search/storage/config.json`. Programmatic storage helpers are available from `@hasna/search/storage`.

## Data Directory

Data is stored in `~/.hasna/search/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
