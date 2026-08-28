# @hasna/prompts

Local-first prompt library for AI agents, with a Bun CLI, MCP server, REST API,
and React dashboard.

[![npm](https://img.shields.io/npm/v/@hasna/prompts)](https://www.npmjs.com/package/@hasna/prompts)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Requirements

- Bun 1.0 or newer
- Node.js/npm only for installing the published package

## Install

```bash
npm install -g @hasna/prompts
```

The package installs three executables:

- `prompts` manages the local prompt registry.
- `prompts-mcp` exposes the registry over MCP.
- `prompts-serve` exposes the REST API and an MCP endpoint.

## Quick Start

```bash
# Save a prompt. Omit --body or pass "-" to read it from stdin.
prompts save "Review this change" --body "Review {{target}} for correctness."

# Find and inspect prompts without incrementing use counts.
prompts list
prompts search "review"
prompts show review-this-change

# Render a template, or use it and increment its use count.
prompts render review-this-change --var target=src/cli
prompts use review-this-change
```

Prompt identifiers may be full IDs, unique ID prefixes, slugs, unique slug
prefixes, or unique title/slug substrings.

## CLI

```bash
prompts --help
prompts <command> --help
```

The CLI supports prompt CRUD and templates, full-text search, collections,
projects, version history and diffs, schedules, import/export, bulk operations,
quality checks, shell completion, watched Markdown directories, AI-agent config
files, and storage diagnostics.

See the [CLI reference](docs/cli.md) for every command and option group.

Global options must precede the command:

```bash
prompts --json list
prompts --project my-project search "release"
```

### Compact Output

Human-readable list and status commands cap and truncate output by default so
they remain safe in agent terminals. Use `--limit` with `--offset` or
`--cursor` for pagination, and `--verbose` for denser human-readable metadata.

JSON output preserves full records where practical. List/search APIs return
slim records by default in token-sensitive surfaces; use `show`, `body`, `use`,
or explicit full-body options when content is required.

```bash
prompts list --limit 50 --offset 50
prompts search "review prompt" --verbose
prompts show PRMT-00001 --verbose
prompts body PRMT-00001
prompts --json list --limit 100
```

### Dispatch

`prompts dispatch` renders a stored prompt strictly (missing variables fail
with `STRICT_RENDER_MISSING_VARS` before a run is accepted) and hands it to a
runtime. Initial runtimes: `emit` (rendered prompt only, no process — the
default) and `codewith` (read-only headless execution).

```bash
prompts dispatch PRMT-00001 --var target=src/cli            # emit (default)
prompts dispatch PRMT-00001 --runtime codewith --target account001 --wait
prompts targets list                                        # read-only discovery
prompts dispatch get run-xxxxxx                             # status + pointers
prompts dispatch get run-xxxxxx --include-output            # bounded captures
prompts dispatch cancel run-xxxxxx                          # cancel a running run
```

Codewith runs are strictly read-only: the rendered prompt is passed on stdin
(never interpolated into a shell command), the runtime environment is
allowlisted, the provider account is reserved for the duration of the run
(`conversations locks` key `codewith/provider-account/<provider>/<fingerprint>`),
and stdout/stderr are bounded and redacted before persistence. One accepted
run increments prompt usage exactly once. `prompts targets list` returns safe
profile names and availability only — never credentials or raw auth payloads.

## MCP Server

`prompts-mcp` uses Streamable HTTP by default and binds only to
`127.0.0.1:8872`:

```bash
prompts-mcp
prompts-mcp --http --port 9000
MCP_HTTP_PORT=9000 prompts-mcp
```

Use stdio explicitly for clients that launch one MCP process per session:

```bash
prompts-mcp --stdio
MCP_STDIO=1 prompts-mcp
```

The HTTP transport exposes `GET /health` and MCP at `/mcp`. When both HTTP and
stdio flags are present, stdio takes precedence.

MCP list/search tools return slim records by default. Detail tools such as
`prompts_get` and `prompts_history` omit large bodies unless
`include_body: true` is supplied; `prompts_body`, `prompts_use`, and export
tools return content explicitly.

See the [MCP reference](docs/mcp.md) for transports and the complete tool list.

## REST API

```bash
prompts-serve                    # http://localhost:19430
prompts-serve --port 9000
PORT=9000 prompts-serve
```

`PORT` takes precedence over `PROMPTS_PORT`; `--port` takes precedence over
both. Every `/api` data request requires `Authorization: Bearer
<PROMPTS_API_TOKEN>` and fails closed when no token is configured. CORS is
restricted, never wildcard: `OPTIONS` preflights from a loopback origin (the
dashboard's Vite dev server) or from an exact origin in
`PROMPTS_API_CORS_ORIGIN` receive CORS headers without a bearer, while every
actual data request still requires the token; preflights and data requests
from any other origin are denied. It exposes JSON routes below `/api`, returns
`GET /health`, and mounts Streamable HTTP MCP at `/mcp`.

List and search endpoints return slim prompt records by default. Add the
`full` query parameter when a supported endpoint should include prompt bodies.

See the [REST API reference](docs/rest-api.md) for routes and request shapes.

## Dashboard

The React dashboard in `dashboard/` connects to the REST API at
`http://localhost:19430` by default. For development, start `prompts-serve`
with `PROMPTS_API_TOKEN` set, then set the same token as `VITE_API_TOKEN` in
the dashboard environment and run `bun install` and `bun run dev` from
`dashboard/`. Set `VITE_API_URL` when the REST server uses another origin.

The dashboard supports browsing, searching, creating, editing, deleting,
rendering, copying, collections, projects, templates, statistics, themes, and
bulk selection.

## Storage

The authoritative store is local SQLite. Data is stored in
`~/.hasna/prompts/prompts.db` by default — the legacy data root. The store
path resolves through the `@hasna/paths` resolver (XDG/macOS home layout):
the resolver data home (`~/.local/share/hasna/prompts` on Linux,
`~/Library/Application Support/Hasna/prompts` on macOS) is adopted when
`HASNA_DATA_HOME` is set or the store has already been physically migrated
there; otherwise the legacy `~/.hasna/prompts` root stays effective. The
exact-app overrides `HASNA_PROMPTS_HOME` / `PROMPTS_HOME` win unconditionally.
A legacy `~/.prompts/` directory is migrated into the effective data root
during normal database startup when the destination allows it.

- `HASNA_PROMPTS_DB_PATH` or `PROMPTS_DB_PATH` selects a custom database.
- `HASNA_PROMPTS_HOME` or `PROMPTS_HOME` pins the exact data root (overrides
  both the legacy default and the resolver root).
- `PROMPTS_DB_SCOPE=project` selects `.prompts/prompts.db` at the nearest Git
  root.
- `HASNA_PROMPTS_STORAGE_MODE` or `PROMPTS_STORAGE_MODE` accepts `local`,
  `auto`, or `remote`.
- `PROMPTS_REGISTRY_POSTGRES_URL`, `PROMPTS_REGISTRY_S3_BUCKET`, and
  `PROMPTS_REGISTRY_AWS_REGION` are detected for diagnostics only.
- `PROMPTS_SAVE_MEMENTOS=1` enables best-effort prompt-use memories when the
  optional `@hasna/mementos` package is available.

`auto` and `remote` report remote intent, but reads and writes still fall back
to local SQLite because this package does not provide a remote registry
runtime. Inspect the active boundary without exposing configured values:

```bash
prompts storage
prompts --json storage
```

The package does not provision buckets, secrets, roles, migrations,
infrastructure, or spend-increasing cloud resources.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Contracts conformance

`hasna.contract.json` declares this repo against `hasna.service_contract.v1`, checked by
`bun run contracts:check`. That check currently exits 1 on four structural gates. See
[docs/contracts-conformance.md](docs/contracts-conformance.md) for which gates are open, why
no manifest edit or waiver closes them, and the two routes to green.

## License

Apache-2.0 — see [LICENSE](LICENSE).
