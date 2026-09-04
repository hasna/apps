# @hasna/shortlinks

Shortlink management for custom domains — CLI, MCP server, REST API, and a generated SDK.

`shortlinks` creates Bitly-style short URLs, supports multiple domains, records click analytics, can run a tiny redirect server, and includes helper commands for Cloudflare DNS/Workers and `@hasna/domains`. The client resolves one store: the hosted shortlinks API when `HASNA_SHORTLINKS_API_URL` + `HASNA_SHORTLINKS_API_KEY` are configured, or the on-box SQLite database (`~/.hasna/shortlinks/shortlinks.db`) when local mode is explicitly opted into with `SHORTLINKS_LOCAL=1` (or `--db <path>`). With neither, store-backed commands fail closed — the CLI never falls back to local storage on its own. The `shortlinks-serve` service reads/writes an app-owned PostgreSQL database when `HASNA_SHORTLINKS_DATABASE_URL` is configured.

## Surfaces

Four surfaces share one core library:

| Surface | Bin / package | Purpose |
| --- | --- | --- |
| CLI | `shortlinks` | Interactive/scriptable link + domain management (`--json` for agents). |
| MCP | `shortlinks-mcp` | Model Context Protocol server (stdio or `--http`) exposing link/domain tools to agents. |
| REST API | `shortlinks-serve` | HTTP service: `GET /health`, `/ready`, `/version`, `/openapi.json`, and a versioned `/v1` CRUD API guarded by API-key auth. |
| SDK | `@hasna/shortlinks-sdk` (+ `@hasna/shortlinks/sdk`) | Typed fetch client generated from the serve OpenAPI (`bun run sdk:generate`). |

### Hosted service

`shortlinks-serve` reads/writes PostgreSQL directly via the vendored `@hasna/contracts` storage kit — no sync engine or cache in the service. A configured `HASNA_SHORTLINKS_DATABASE_URL` selects the postgresql server data backend; the pool factory fails closed without it. API-key auth comes from `@hasna/contracts/auth`; mint keys with `contracts issue-key --app shortlinks --scopes 'shortlinks:read,shortlinks:write'`.

```bash
HASNA_SHORTLINKS_DATABASE_URL=$DATABASE_URL \
HASNA_SHORTLINKS_API_SIGNING_KEY=... \
shortlinks-serve            # migrate (idempotent) then serve on :8080
shortlinks-serve migrate    # one-shot migration task
```

Clients use `HASNA_SHORTLINKS_API_URL` + `HASNA_SHORTLINKS_API_KEY` (legacy aliases `SHORTLINKS_API_URL` / `SHORTLINKS_API_KEY`; never a DSN).

[![npm](https://img.shields.io/npm/v/@hasna/shortlinks)](https://www.npmjs.com/package/@hasna/shortlinks)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/shortlinks
```

The on-box SQLite database (used only under the explicit local opt-in, see
[Storage selection](#storage-selection)) lives at:

```bash
~/.hasna/shortlinks/shortlinks.db
```

## Quick Start

Point the CLI at the hosted shortlinks API, or opt into the on-box store:

```bash
# Hosted API (requires a fleet API key):
export HASNA_SHORTLINKS_API_URL=https://api.hasna.com/shortlinks
export HASNA_SHORTLINKS_API_KEY=hsk_...

# Or explicit local mode:
export SHORTLINKS_LOCAL=1

shortlinks init --domain has.na
shortlinks create https://example.com --slug docs
shortlinks serve --host 127.0.0.1 --port 8787
```

With neither the hosted API env nor `SHORTLINKS_LOCAL=1`/`--db`, store-backed
commands exit non-zero with an error naming the required configuration — they
never silently serve local data.

Then a request for `https://has.na/docs` redirects to `https://example.com` and records a click.

## Agent-Friendly JSON

Every operational command supports `--json`:

```bash
shortlinks --json create https://example.com --domain has.na
shortlinks --json link list
shortlinks --json stats docs --domain has.na
shortlinks --json doctor
```

Errors are emitted as:

```json
{ "error": "message" }
```

## Compact Defaults and Details

Human output is compact by default so agent terminals do not fill with full
records. List and status commands show essential fields, truncate long URLs or
text, cap human rows, and print the next command to use for details.

Use these gradual disclosure paths when you need more:

```bash
shortlinks link list --limit 50
shortlinks link get home --verbose
shortlinks stats home --verbose
shortlinks doctor --verbose
shortlinks domain check has.na --verbose
shortlinks events list --limit 50
shortlinks webhooks list --limit 50
shortlinks --json link get home
```

`--json` remains the machine-readable path and keeps full objects where commands
already returned them. Prefer `--json` for automation and `--verbose` for human
debugging.

Example compact output:

```text
https://has.na/home -> https://example.com/landing-page-with-a-very-long-path... active
Showing 1 link(s).
Use `shortlinks link get <slug>` for details.
```

Before this behavior, detail/status commands such as `shortlinks link get home`,
`shortlinks stats home`, and `shortlinks doctor` printed full JSON-like objects
by default.

## CLI

```bash
shortlinks init --domain has.na
shortlinks domain add has.na --default
shortlinks domain setup go.example.com --cloudflare --target shortlinks.example.com --dry-run
shortlinks domain check example.ai
shortlinks domain buy example.ai --dry-run

shortlinks create https://example.com --slug home
shortlinks link create https://example.com/docs --domain has.na --title Docs
shortlinks link list
shortlinks link get home --domain has.na
shortlinks link disable home --domain has.na
shortlinks link enable home --domain has.na
shortlinks stats home --domain has.na

shortlinks serve --port 8787
shortlinks doctor
```

## Local Domain Setup

Record a local mapping with the `machines` CLI and print the remaining hosts/proxy setup:

```bash
shortlinks local setup has.na --port 8787
shortlinks local plan has.na --port 8787
```

The command emits the `/etc/hosts` line, a Caddy reverse-proxy snippet, and certificate paths. Writing `/etc/hosts` still requires sudo on macOS.

## Custom Domains

Add as many domains as you need:

```bash
shortlinks domain add has.na --default
shortlinks domain add go.example.com --provider cloudflare
```

Generated links use the default domain unless `--domain` is passed.

Remove a domain (this also deletes all of its links and clicks):

```bash
shortlinks domain remove go.example.com
```

## Cloudflare

Create a dry-run plan:

```bash
shortlinks cloudflare plan has.na \
  --target shortlinks.example.com \
  --origin https://shortlinks.example.com
```

Write a Cloudflare Worker that forwards requests to the redirect server while preserving the original host:

```bash
shortlinks cloudflare worker \
  --worker shortlinks \
  --origin https://shortlinks.example.com
```

Upsert DNS when `CLOUDFLARE_API_TOKEN` is available. Global API key auth is also supported with `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`.

```bash
shortlinks cloudflare dns has.na --target shortlinks.example.com
```

## Buying Domains

Domain purchasing goes through the `domains` CLI from `@hasna/domains`:

```bash
shortlinks domain check new-short-domain.ai
shortlinks domain buy new-short-domain.ai --dry-run
```

This package does not install or call any removed `connect-*` packages.

## Storage selection

The client resolves ONE `Store` from the environment — there is no DSN on any client:

- **hosted `/v1` HTTP API** (default when configured): set `HASNA_SHORTLINKS_API_URL`
  + `HASNA_SHORTLINKS_API_KEY` to route every call to the hosted `/v1` API with a
  bearer key (legacy aliases `SHORTLINKS_API_URL` / `SHORTLINKS_API_KEY`). Setting
  only one of the two is a configuration error and fails loudly — never silent
  local drift.
- **on-box SQLite** (explicit opt-in only): the local database at
  `~/.hasna/shortlinks/shortlinks.db` is used ONLY when local mode is explicitly
  selected with `SHORTLINKS_LOCAL=1` or the `--db <path>` flag.
- **fail closed** (no configuration): with neither the hosted API env nor the
  local opt-in, store-backed commands exit non-zero with an error naming
  `HASNA_SHORTLINKS_API_URL` / `HASNA_SHORTLINKS_API_KEY` and the local opt-in —
  the CLI never silently serves local data and never creates
  `~/.hasna/shortlinks/shortlinks.db` on its own.

```bash
# Route the client to the hosted API (bearer key, never a DSN):
export HASNA_SHORTLINKS_API_URL=https://shortlinks.example.com
export HASNA_SHORTLINKS_API_KEY=hsk_...
shortlinks doctor

# Explicit local mode (on-box SQLite):
export SHORTLINKS_LOCAL=1
shortlinks init --domain has.na
```

The server (`shortlinks-serve`) is the only component that holds a Postgres
connection, and it opens its pool server-side through the sanctioned storage
kit — the raw RDS DSN is never distributed to clients.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

## Repository

The OSS repository is expected to be:

```text
hasna/shortlinks
```

The local workspace folder is named `shortlinks`; the published package and GitHub repo use bare names without the retired `open-` prefix.

## License

Apache-2.0. See [LICENSE](LICENSE).
