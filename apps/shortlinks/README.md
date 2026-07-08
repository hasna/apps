# @hasna/shortlinks

Shortlink management for custom domains — CLI, MCP server, REST API, and a generated SDK.

`shortlinks` creates Bitly-style short URLs, supports multiple domains, records click analytics, can run a tiny redirect server, and includes helper commands for Cloudflare DNS/Workers and `@hasna/domains`. It defaults to local SQLite and can serve from an app-owned PostgreSQL database when `HASNA_SHORTLINKS_STORE=postgres` and `HASNA_SHORTLINKS_DATABASE_URL` are configured.

## Surfaces

Four surfaces share one core library:

| Surface | Bin / package | Purpose |
| --- | --- | --- |
| CLI | `shortlinks` | Interactive/scriptable link + domain management (`--json` for agents). |
| MCP | `shortlinks-mcp` | Model Context Protocol server (stdio or `--http`) exposing link/domain tools to agents. |
| REST API | `shortlinks-serve` | HTTP service: `GET /health`, `/ready`, `/version`, `/openapi.json`, and a versioned `/v1` CRUD API guarded by API-key auth. |
| SDK | `@hasna/shortlinks-sdk` (+ `@hasna/shortlinks/sdk`) | Typed fetch client generated from the serve OpenAPI (`bun run sdk:generate`). |

### Cloud service (PURE REMOTE, Amendment A1)

`shortlinks-serve` reads/writes the shared cloud Postgres directly via the vendored `@hasna/contracts` storage kit — no sync engine or cache in the service. API-key auth comes from `@hasna/contracts/auth`; mint keys with `contracts issue-key --app shortlinks --scopes 'shortlinks:read,shortlinks:write'`.

```bash
HASNA_SHORTLINKS_STORAGE_MODE=cloud \
HASNA_SHORTLINKS_DATABASE_URL=postgres://user:pass@host:5432/shortlinks?sslmode=require \
HASNA_SHORTLINKS_API_SIGNING_KEY=... \
shortlinks-serve            # migrate (idempotent) then serve on :8080
shortlinks-serve migrate    # one-shot migration task
```

Client self_hosted mode uses `SHORTLINKS_API_URL` + `SHORTLINKS_API_KEY` (never a DSN).

[![npm](https://img.shields.io/npm/v/@hasna/shortlinks)](https://www.npmjs.com/package/@hasna/shortlinks)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/shortlinks
```

The local database lives at:

```bash
~/.hasna/shortlinks/shortlinks.db
```

## Quick Start

```bash
shortlinks init --domain has.na
shortlinks create https://example.com --slug docs
shortlinks serve --host 127.0.0.1 --port 8787
```

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
  --target shortlinks.hasna.xyz \
  --origin https://shortlinks.hasna.xyz
```

Write a Cloudflare Worker that forwards requests to the redirect server while preserving the original host:

```bash
shortlinks cloudflare worker \
  --worker shortlinks \
  --origin https://shortlinks.hasna.xyz
```

Upsert DNS when `CLOUDFLARE_API_TOKEN` is available. Global API key auth is also supported with `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`.

```bash
shortlinks cloudflare dns has.na --target shortlinks.hasna.xyz
```

## Buying Domains

Domain purchasing goes through the `domains` CLI from `@hasna/domains`:

```bash
shortlinks domain check new-short-domain.ai
shortlinks domain buy new-short-domain.ai --dry-run
```

This package does not install or call any removed `connect-*` packages.

## Storage modes

The client resolves ONE `Store` from the environment — there is no DSN on any client:

- **local** (default): on-box SQLite. Every command, MCP tool, and SDK call reads
  and writes the local database.
- **self_hosted / cloud**: set `HASNA_SHORTLINKS_API_URL` + `HASNA_SHORTLINKS_API_KEY`
  (and optionally `HASNA_SHORTLINKS_STORAGE_MODE`) to route every call to the cloud
  `/v1` HTTP API with a bearer key. `self_hosted` and `cloud` are identical client
  code; only the URL/key differ.

```bash
# Route the client to the self-hosted cloud API (bearer key, never a DSN):
export HASNA_SHORTLINKS_API_URL=https://shortlinks.hasna.xyz
export HASNA_SHORTLINKS_API_KEY=hsk_...
export HASNA_SHORTLINKS_STORAGE_MODE=self_hosted
shortlinks doctor
```

The cloud server (`shortlinks-serve`, run on ECS Fargate) is the only component
that holds a Postgres connection, and it opens its pool server-side through the
sanctioned storage kit — the raw RDS DSN is never distributed to clients.

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

The local workspace folder may still be named `open-shortlinks`; the published package and GitHub repo do not use the `open-` prefix.

## License

Apache-2.0. See [LICENSE](LICENSE).
