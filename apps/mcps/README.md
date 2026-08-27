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
- `mcps env ref <server-id> API_KEY=<upstream-key> --source env`
- `mcps machines list`
- `mcps machines add --host linux-node-a --platform linux --arch arm64`
- `mcps machines seed-defaults`
- `mcps fleet catalog`
- `mcps fleet health --refresh`
- `mcps fleet install --yes`

## Output Defaults

CLI list/search/status-style commands are compact by default for human and
agent terminals. They show essential fields, truncate long text, and cap rows.
Use `--limit` and `--cursor` to page through broad results.

Use detail flags and commands when you need full records:

```bash
mcps list --verbose
mcps info <server-id> --json
mcps tools --verbose --limit 50
mcps find postgres --cursor 20
mcps providers info github --json
```

MCP list/search/catalog tools follow the same gradual-disclosure pattern:
default responses are compact envelopes with `items`, `total`, `nextCursor`,
and a `hint`; pass `verbose: true` or call a detail tool such as
`get_server_info` or `get_provider_profile` for full JSON records.

## Fleet Operations

Use machine registration plus fleet health/install commands to manage `@hasna/*`
MCP packages across multiple hosts over SSH.

```bash
mcps machines add --host linux-node-a --username hasna --platform linux --arch arm64
mcps machines add --host macos-node-a --platform darwin --arch arm64
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
mcps add --yes --name notion npx -y @notion/mcp --credential-env NOTION_TOKEN=<notion-token>
mcps env ref notion API_KEY=<upstream-key> --source env
mcps env ref notion API_KEY=<notion-token> --source local-vault
mcps env ref notion API_KEY=<cred-id> --source hosted
```

Local runtime resolution supports `env` and `local-vault` references. The local
vault defaults to `credentials.local.json` inside the effective data home (resolved
via `@hasna/paths`, default `~/.hasna/mcps`); set
`HASNA_MCPS_CREDENTIAL_VAULT_PATH` to use a different JSON file. Hosted
credential references are recorded for platforms that resolve credentials outside
the local runtime.

## MCP Server

```bash
mcps-mcp
```

The MCP server exposes registry, finder, machine registry, and fleet orchestration tools.

## Data Directory

Data is stored locally in the effective data home by default (resolved via
`@hasna/paths`): the legacy `~/.hasna/mcps` stays effective until the store is
migrated to the XDG data home (`~/.local/share/hasna/mcps` on Linux,
`~/Library/Application Support/Hasna/mcps` on macOS) or the data-kind override
`HASNA_DATA_HOME` is set — an existing local store never becomes invisible on
upgrade.

- Set `HASNA_MCPS_DATA_DIR` to override the data directory.
- Set `HASNA_DATA_HOME` to move the data home to a custom base (XDG data layout).
- Set `HASNA_MCPS_DB_PATH` to point at a specific SQLite database file.
- Set `HASNA_MCPS_STORAGE_MODE=local` to make the storage mode explicit.

## Postgres Storage Sync

Local SQLite remains the runtime source of truth. Hosted deployments can mirror
app-owned registry tables through a Postgres database without any shared runtime
package.

```bash
export HASNA_MCPS_DATABASE_URL=postgres://...

mcps storage status
mcps storage push
mcps storage pull
mcps storage sync
```

Use `MCPS_DATABASE_URL` as the fallback variable. The MCP server exposes the
same flow through `storage_status`, `storage_push`, `storage_pull`, and
`storage_sync`.

`storage sync` uses freshness columns when a table has one and otherwise
preserves existing conflicting rows. It mirrors rows only; deletes are not
propagated. Remote or hosted deployments should keep this as an mcps-owned
storage adapter or service boundary. This package owns its database adapter and
MCP tool surface.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
