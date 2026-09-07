# @hasna/logs

Log aggregation + browser script + headless page scanner + performance monitoring for AI agents

[![npm](https://img.shields.io/npm/v/@hasna/logs)](https://www.npmjs.com/package/@hasna/logs)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/logs
```

## Credentials and authority

Every hosted surface — the CLI, the MCP server and the `@hasna/logs/api` SDK —
resolves its API key and URL through the shared `@hasna/contracts` client
resolver (hasna/apps#1720), fresh on every request:

| Tier | Credential | Authority |
|---|---|---|
| 1. explicit argument | `--api-key` / `credentials.apiKey` | `baseUrl` option |
| 2. env pointers | `HASNA_LOGS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_LOGS_API_KEY_REF` | — |
| 3. macOS Keychain | `hasna.credentials.logs.api-key` (account `HASNA_STATION`, else `hostname -s`, else `USER`) | `hasna.credentials.logs.api-url` |
| 4. disk (`0400`/`0600`) | `~/.hasna/logs/config/credentials` (`HASNA_HOME` / `HASNA_CONFIG_HOME` move the root; XDG is never consulted) | same file |
| 5. env | `HASNA_LOGS_API_KEY` | `HASNA_LOGS_API_URL` |

With no URL configured the authority defaults to the fleet gateway
`https://api.hasna.com/logs` (the client appends `/v1`) — a key alone is a
complete configuration. The legacy unprefixed `LOGS_API_URL` / `LOGS_API_KEY`
names are accepted only as the resolver's silent alias fallback for one
release and never outrank the canonical `HASNA_LOGS_*` pair. Retired inputs
(`~/.hasna/fleet-env`, the legacy `~/.hasna` `cloud` / `config` dotdirs,
`$XDG_CONFIG_HOME`, `~/.logs/config.json`) are never read, and no
`*_MODE` / `*_STORAGE_MODE` variable selects anything.

**Hosted mode fails loud.** A data-plane command with no resolvable credential
exits non-zero with one actionable line — no SQLite fallback, no local-fallback
event. The on-box SQLite store (`~/.hasna/logs/logs.db`) is reachable only
through the explicit opt-in:

```bash
export HASNA_LOGS_LOCAL=1   # alias: LOGS_LOCAL=1
```

…and a run that lands there prints one `local` line on stderr — it is never
silent. Inspect which transport and source a run would resolve:

```bash
logs transport          # e.g. transport: http, source: default, api_key_tier: keychain
logs transport --json
```

The serve (`logs-serve`) follows the same rule: `HASNA_LOGS_DATABASE_URL`
selects the PostgreSQL-backed fleet API (validated fail-closed by the
vendored storage kit), `HASNA_LOGS_LOCAL=1` selects the on-box SQLite
collector (with the `local` line on stderr), and neither configured is a
non-zero startup with no SQLite.

## Environment

| Variable | Surface | Purpose |
|---|---|---|
| `HASNA_LOGS_API_KEY` | CLI / MCP / `@hasna/logs/api` | Fleet API key (env tier of the credential chain) |
| `HASNA_LOGS_API_URL` | CLI / MCP / `@hasna/logs/api` | Service authority; defaults to `https://api.hasna.com/logs` |
| `HASNA_LOGS_API_KEY_OVERRIDE` / `HASNA_LOGS_API_KEY_REF` / `HASNA_PROFILE` | CLI / MCP / SDK | Deliberate credential pointers (tier 2) |
| `HASNA_STATION` | CLI / MCP / SDK | macOS Keychain account selector |
| `HASNA_HOME` / `HASNA_CONFIG_HOME` | CLI / MCP / SDK | Move the disk credential/config root |
| `HASNA_LOGS_LOCAL` (`LOGS_LOCAL`) | CLI / MCP / `logs-serve` | Explicit opt-in for the on-box SQLite store/collector |
| `HASNA_LOGS_DATABASE_URL` (`LOGS_DATABASE_URL`) | `logs-serve`, `logs db migrate/status` | PostgreSQL connection URL for the hosted serve |
| `HASNA_LOGS_DATA_DIR` / `HASNA_LOGS_DB_PATH` | local store | On-box SQLite location (default `~/.hasna/logs/logs.db`) |
| `HASNA_LOGS_API_TOKEN` (`LOGS_API_TOKEN`) | `logs-serve` | API token required for `/api/*` requests |
| `HASNA_LOGS_API_SIGNING_KEY` | `logs-serve` | Signing secret for hosted `/v1` API keys |
| `HASNA_LOGS_SECRET_KEY` (`LOGS_SECRET_KEY`) | `logs-serve` | Encrypt page-scanner credentials at rest |
| `HASNA_LOGS_S3_BUCKET` | `logs-serve` | S3 artifact upload bucket |
| `LOGS_PORT` / `PORT` | `logs-serve` | Listen port (default 3460) |

## CLI Usage

```bash
logs --help
```

- `logs list`
- `logs tail`
- `logs summary`
- `logs push`
- `logs events`
- `logs test-reports`
- `logs scan`
- `logs diagnose`

## MCP Server

```bash
logs-mcp
```

Includes log search, raw event search/watch/export, projected test-report search/get, storage sync, scan, issue, and performance tools.

## HTTP mode

Run a shared Streamable HTTP MCP server (127.0.0.1 only):

```bash
logs-mcp --http               # default port 8864
logs-mcp --http --port 8864
MCP_HTTP=1 logs-mcp
```

- Health: `GET http://127.0.0.1:8864/health`
- MCP: `POST http://127.0.0.1:8864/mcp`

Stdio remains the default when no `--http` flag is passed.

## REST API

```bash
HASNA_LOGS_DATABASE_URL=postgres://… logs-serve     # PostgreSQL-backed fleet API
HASNA_LOGS_LOCAL=1 logs-serve --local-open          # on-box SQLite collector (says "local" on stderr)
```

By default the API is locked unless an API token is configured or trusted
loopback mode is explicitly enabled:

```bash
HASNA_LOGS_API_TOKEN="$(openssl rand -hex 32)" logs-serve
# or, for local-only development:
HASNA_LOGS_LOCAL=1 logs-serve --local-open
```

Use `Authorization: Bearer <token>` or `X-Logs-Token: <token>` for `/api/*`
requests. Browser ingest tokens remain scoped write-only tokens for browser
capture and do not grant general API access.

Page scanner credentials are encrypted at rest with a generated local
`page-auth.key` under the logs data directory. For deployments that need a
managed secret, set `HASNA_LOGS_SECRET_KEY` or `LOGS_SECRET_KEY`:

```bash
export HASNA_LOGS_SECRET_KEY="$(openssl rand -hex 32)"
```

## PostgreSQL backend

The hosted serve reads and writes PostgreSQL directly (including AWS RDS).
Configure `HASNA_LOGS_DATABASE_URL` (or the `LOGS_DATABASE_URL` alias), then
apply the schema and inspect it:

```bash
logs db migrate            # apply cloud migrations (schema + api_keys)
logs db status
```

The MCP server exposes the same event/log data plane over the HTTP transport
when a credential resolves — there is no DSN on any client and no storage
sync in the data plane.

`LOGS_DATABASE_URL` is accepted as the non-Hasna fallback database URL for one
release.

## Data Directory

Data is stored in `~/.hasna/logs/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
