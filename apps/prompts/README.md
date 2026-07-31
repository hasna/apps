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
both. The server permits cross-origin requests, exposes JSON routes below
`/api`, returns `GET /health`, and mounts Streamable HTTP MCP at `/mcp`.

List and search endpoints return slim prompt records by default. Add the
`full` query parameter when a supported endpoint should include prompt bodies.

See the [REST API reference](docs/rest-api.md) for routes and request shapes.

## Dashboard

The React dashboard in `dashboard/` connects to the REST API at
`http://localhost:19430` by default. For development, start `prompts-serve`,
then run `bun install` and `bun run dev` from `dashboard/`. Set `VITE_API_URL`
when the REST server uses another origin.

The dashboard supports browsing, searching, creating, editing, deleting,
rendering, copying, collections, projects, templates, statistics, themes, and
bulk selection.

## Storage

The authoritative store is local SQLite. Data is stored in
`~/.hasna/prompts/prompts.db` by default. A legacy `~/.prompts/` directory is
migrated during normal database startup when the destination allows it.

- `HASNA_PROMPTS_DB_PATH` or `PROMPTS_DB_PATH` selects a custom database.
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
