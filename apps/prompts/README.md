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

## Data Directory

Data is stored locally in `~/.hasna/prompts/` by default.

- Set `HASNA_PROMPTS_DB_PATH` to point at a specific SQLite database file.
- Set `PROMPTS_DB_SCOPE=project` to use the nearest project `.prompts/prompts.db`.
- Set `HASNA_PROMPTS_STORAGE_MODE=local` to make the storage mode explicit.
- Set `HASNA_PROMPTS_STORAGE_MODE=auto` or `remote` to request a remote registry
  path while retaining local-first fallback.

Inspect the active storage boundary with:

```bash
prompts storage
prompts --json storage
```

The diagnostic output reports the requested mode, active local SQLite database
path, local scope, remote Postgres/S3/AWS configuration presence, fallback state,
and sync behavior. It reports only whether remote environment variables are set;
it does not print configured values. The diagnostic command is read-only and
does not migrate legacy `~/.prompts/` data; normal database startup still owns
that compatibility migration.

Remote or hosted deployments should provide a prompts-owned storage adapter or
service boundary. This package owns its database adapter and MCP tool surface.

Current runtime semantics:

- Local SQLite is the authoritative read/write store.
- Local prompt files live under `~/.hasna/prompts/` by default, or the nearest
  project `.prompts/` directory when `PROMPTS_DB_SCOPE=project` is set.
- Remote Postgres configuration is detected with `PROMPTS_REGISTRY_POSTGRES_URL`.
- Remote object storage configuration is detected with
  `PROMPTS_REGISTRY_S3_BUCKET`.
- Registry AWS region configuration is detected with
  `PROMPTS_REGISTRY_AWS_REGION`.
- `auto` uses local storage unless remote registry configuration is present.
- `remote` records that a remote path was requested, but reads and writes still
  fall back to local SQLite until a prompts-owned remote runtime is supplied.
- This package does not create buckets, secrets, roles, data migrations,
  infrastructure, or spend-increasing AWS resources.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
