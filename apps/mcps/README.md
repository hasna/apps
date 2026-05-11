# @hasna/mcps

Meta-MCP registry & CLI — discover, manage, and proxy MCP servers

[![npm](https://img.shields.io/npm/v/@hasna/mcps)](https://www.npmjs.com/package/@hasna/mcps)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/mcps
```

## CLI Usage

```bash
mcps --help
```

- `mcps list`
- `mcps search`
- `mcps add`
- `mcps remove`
- `mcps enable`
- `mcps disable`
- `mcps tools`
- `mcps call`
- `mcps info`
- `mcps doctor`
- `mcps providers list`
- `mcps providers search github`
- `mcps providers install github`
- `mcps env list <server-id>`
- `mcps env ref <server-id> API_KEY=UPSTREAM_API_KEY --source env`
- `mcps machines list`
- `mcps machines add --host spark01 --platform linux --arch arm64`
- `mcps machines seed-defaults`
- `mcps fleet catalog`
- `mcps fleet health --refresh`
- `mcps fleet install --yes`

## Fleet Operations

Use machine registration plus fleet health/install commands to manage `@hasna/*`
MCP packages across multiple hosts over SSH.

```bash
mcps machines add --host spark01 --username hasna --platform linux --arch arm64
mcps machines add --host apple01 --platform darwin --arch arm64
mcps fleet health --refresh
mcps fleet install --yes --mode missing-or-outdated
```

Notes:

- Fleet commands only target enabled machines.
- `mcps fleet install` requires `--yes` because it performs remote installs.
- Targets need SSH access plus `node` and either `bun` or `npm` available remotely.
- Use `-j` or `--json` on the new `machines` and `fleet` commands for scriptable output.

## Curated Provider Profiles

`mcps providers` exposes a curated catalog of common MCP providers with source,
auth, transport, and install metadata. The default catalog includes Notion,
Linear, GitHub, Slack, Gmail, Google Drive, Google Calendar, Stripe, Cloudflare,
PostgreSQL, filesystem, and browser automation profiles.

```bash
mcps providers list
mcps providers info github --json
mcps providers install github
```

Direct remote providers install as HTTP/SSE entries. Local stdio fallbacks such
as PostgreSQL, filesystem, and Playwright browser automation require explicit
local command consent before registration.

## Credential References

Secret-like environment keys and values are rejected from plain server env storage.
Use credential references instead so exports, MCP tools, API responses, logs, and
diagnostics never contain raw credential values.

```bash
mcps add --yes --name notion npx -y @notion/mcp --credential-env NOTION_TOKEN=NOTION_TOKEN
mcps env ref notion API_KEY=UPSTREAM_API_KEY --source env
mcps env ref notion API_KEY=notion-token --source local-vault
mcps env ref notion API_KEY=cred_123 --source hosted
```

Local runtime resolution supports `env` and `local-vault` references. The local
vault defaults to `~/.hasna/mcps/credentials.local.json`; set
`HASNA_MCPS_CREDENTIAL_VAULT_PATH` to use a different JSON file. Hosted
credential references are recorded for platforms that resolve credentials outside
the local runtime.

## MCP Server

```bash
mcps-mcp
```

The MCP server exposes registry, finder, machine registry, and fleet orchestration tools.

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service mcps
cloud sync pull --service mcps
```

## Data Directory

Data is stored in `~/.hasna/mcps/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
