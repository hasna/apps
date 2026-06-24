# @hasna/prompts

Reusable prompt library for AI agents — CLI + MCP server + REST API + web dashboard

[![npm](https://img.shields.io/npm/v/@hasna/prompts)](https://www.npmjs.com/package/@hasna/prompts)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/prompts
```

## CLI Usage

```bash
prompts --help
```

### Compact Output Defaults

Human-readable list/search/status-style commands are compact by default so they are safe to run inside agent terminals:

- `prompts list`, `prompts search`, `prompts templates`, `prompts recent`, `prompts stale`, `prompts unused`, `prompts project prompts`, `prompts schedule list`, and `prompts config scan` show capped rows by default.
- Long titles, descriptions, snippets, and tag lists are truncated in human output.
- Use `--limit` plus `--offset` or `--cursor` to page through additional rows.
- Use `--verbose` for denser human metadata.
- Use `prompts show <id>` or `prompts get <id>` for prompt details, and `prompts body <id>` or `prompts use <id>` when you explicitly need the full prompt body.
- Use `--json` when you need machine-readable full records. Existing JSON list/search/detail shapes are preserved where practical.

Examples:

```bash
prompts list
prompts list --limit 50 --offset 50
prompts search "review prompt" --verbose
prompts show PRMT-00001
prompts show PRMT-00001 --verbose
prompts body PRMT-00001
prompts --json list --limit 100
```

## MCP Server

```bash
prompts-mcp
```

## HTTP mode

```bash
prompts-mcp --http              # default port 8872
MCP_HTTP=1 MCP_HTTP_PORT=8872 prompts-mcp
```

Endpoints: `GET /health` → `{"status":"ok","name":"prompts"}`, MCP at `/mcp`. The REST server (`prompts-serve`) also mounts `/mcp` on its port.

MCP list/search tools return slim records by default. Detail tools such as `prompts_get` and `prompts_history` omit large bodies unless you pass `include_body:true`; use `prompts_body`, `prompts_use`, export tools, or explicit include flags when full content is required.

## REST API

```bash
prompts-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service prompts
cloud sync pull --service prompts
```

## Data Directory

Data is stored in `~/.hasna/prompts/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
