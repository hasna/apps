# @hasna/crawl

AI-powered web crawler — self-hosted Firecrawl alternative. Crawl, extract, render JS, search. CLI + MCP + REST API + Dashboard.

[![npm](https://img.shields.io/npm/v/@hasna/crawl)](https://www.npmjs.com/package/@hasna/crawl)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/crawl
```

## CLI Usage

```bash
crawl --help
```

- `crawl crawl <url>`
- `crawl list`
- `crawl stats`
- `crawl search <query>`
- `crawl search-web <query>` (Exa-backed web search; requires `EXA_API_KEY`)
- `crawl sitemap <url>`
- `crawl map <url>`
- `crawl export`

### Output defaults

CLI commands use compact human output by default so agent terminals do not fill
with full records or page bodies. List-style commands show the most useful
columns, cap rows, truncate long text, and print a hint for the next detail
command.

Use these flags when you need more:

- `--limit <n>` and `--offset <n>` page through list/search output.
- `--verbose` adds secondary fields such as timestamps, crawl options, or
  payload previews.
- `crawl get <page-id>` shows a short page preview; `crawl get <page-id> --full`
  prints complete page content.
- `crawl map <url>` and `crawl sitemap <url>` preview discovered URLs; use
  `--show <n>`, `--all`, or `--json` for more.
- `--json` keeps machine-readable output for scripts. Sensitive or bulky webhook
  fields stay redacted by default; use explicit flags such as
  `--include-secret`, `--include-secrets`, or `--include-payloads` only when the
  full values are needed.

## MCP Server

```bash
crawl-mcp
```

30 tools available.

MCP tools also prefer compact responses by default. Tools that can return large
page bodies, URL lists, webhook payloads, or scraped search results expose
explicit detail arguments such as `format: "full"`, `full: true`, `content_limit`,
`show`, `all`, `offset`, `verbose`, or `include_payloads`. Paginated tools return
`nextOffset` when more results are available.

## HTTP mode

Long-lived Streamable HTTP transport for shared agent sessions (binds `127.0.0.1` only):

```bash
crawl-mcp --http              # default port 8857
crawl-mcp --http --port 8857
MCP_HTTP=1 MCP_HTTP_PORT=8857 crawl-mcp
```

- `GET /health` → `{"status":"ok","name":"crawl"}`
- `POST /mcp` — Streamable HTTP MCP endpoint (also mounted on `crawl-serve`)

Stdio remains the default transport for gradual rollout.

## Exa Web Search

`crawl search-web` and the MCP `search_web` tool use Exa's Search API. They read
`EXA_API_KEY` from the process environment and do not read local vaults directly.
Inject secrets through your shell, process manager, or deployment secret provider.

```bash
export EXA_API_KEY=...
crawl doctor
crawl search-web "recent web crawling research" --limit 5
```

## REST API

```bash
crawl-serve
```

## Storage Sync

This package supports optional remote storage sync directly against a Postgres/RDS
database. Local SQLite remains the default. Screenshot artifacts can optionally
sync to S3 using Bun's native S3 client.

```bash
export HASNA_CRAWL_DATABASE_URL=postgres://...
export HASNA_CRAWL_S3_BUCKET=my-crawl-artifacts
export HASNA_CRAWL_S3_PREFIX=open-crawl/prod
export HASNA_CRAWL_AWS_REGION=us-east-1

crawl storage status
crawl storage push
crawl storage pull
crawl storage sync
crawl storage artifacts status
crawl storage artifacts upload
crawl storage artifacts download
```

MCP exposes the same flow through `storage_status`, `storage_push`,
`storage_pull`, `storage_sync`, `storage_artifacts_upload`, and
`storage_artifacts_download`.

## Data Directory

Data is stored under a data root resolved through the `@hasna/paths` resolver
(XDG/macOS home layout). The legacy `~/.hasna/crawl/` root stays the effective
data root until the store is physically migrated to the XDG data home
(`data.db` present there) or the operator sets the data-kind override
`HASNA_DATA_HOME` — the XDG data home is `~/.local/share/hasna/crawl` on
Linux. The exact-app overrides `HASNA_CRAWL_HOME` / `CRAWL_HOME` win
unconditionally, and the store overrides `HASNA_CRAWL_DB_PATH` /
`CRAWL_DB_PATH` are layered on top. Legacy `~/.open-crawl` and `~/.crawl` data
is copied forward into the effective data root on startup without deleting the
legacy source or overwriting existing canonical files.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
