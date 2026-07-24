# @hasna/markdown

Open Markdown Protocol (OMP) — structured markdown as intermediate representation between AI models. Smart LLM writes it, cheap LLM/regex executes it.

[![npm](https://img.shields.io/npm/v/@hasna/markdown)](https://www.npmjs.com/package/@hasna/markdown)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/markdown
```

## CLI Usage

```bash
omp --help
```

- `omp validate <file>`
- `omp run <file>`
- `omp compile <file>`
- `omp lint <file>`
- `omp inspect <file>`
- `omp init`

CLI output is compact by default for agent-friendly terminals. Commands that can
produce large structures show summaries and hints first:

```bash
omp inspect app.omp.md --limit 10
omp inspect app.omp.md --verbose
omp inspect app.omp.md --json

omp compile app.omp.md
omp compile app.omp.md --json
```

- Use `--limit <n>` to increase or reduce compact rows.
- Use `--verbose` for all cards, execution steps, and detail columns.
- Use `--json` when another program needs the full machine-readable payload.

## MCP Server

```bash
omp-mcp
```

MCP tool outputs are also compact by default. Pass `json=true` for full
machine-readable payloads, `verbose=true` for expanded text, and `limit=<n>` for
larger compact previews.

## HTTP mode

Long-lived Streamable HTTP transport for shared agent connections (stdio remains the default):

```bash
omp-mcp --http
# or: MCP_HTTP=1 omp-mcp
# default port: 8822 (override with --port or MCP_HTTP_PORT)
```

Endpoints on `127.0.0.1` only:

- `GET /health` → `{"status":"ok","name":"markdown"}`
- `POST /mcp` → MCP Streamable HTTP

## REST API

```bash
omp-serve
```

## Data Directory

Runtime data is stored locally in `~/.hasna/markdown/markdown.db` by default.
Set `HASNA_MARKDOWN_DIR` or `MARKDOWN_DIR` to move the local store.

Feedback rows include a machine identifier. The resolver checks
`HASNA_MARKDOWN_MACHINE_ID`, `MARKDOWN_MACHINE_ID`, `HASNA_MACHINE_ID`,
`OPEN_MACHINES_ID`, then `MACHINE_ID` before falling back to the host name.

Optional remote mirroring uses Postgres directly:

```bash
export HASNA_MARKDOWN_DATABASE_URL="postgres://user:pass@example.com/markdown?sslmode=require"
omp storage status
omp storage push
omp storage pull
omp storage sync
```

The local SQLite database remains the runtime source. The remote database is an
append-only feedback mirror; deletes are not propagated.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
