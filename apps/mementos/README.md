# @hasna/mementos

Persistent memory for AI agents, available as a CLI, MCP server, REST service,
and TypeScript library. Hosted clients use the authenticated Mementos HTTP API;
local SQLite is available only through an explicit local-mode opt-in.

[![npm](https://img.shields.io/npm/v/@hasna/mementos)](https://www.npmjs.com/package/@hasna/mementos)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

Mementos requires [Bun](https://bun.sh/) 1.0 or newer at runtime.

```bash
npm install -g @hasna/mementos
# or
bun add -g @hasna/mementos
```

The package installs three binaries:

| Binary | Purpose |
| --- | --- |
| `mementos` | Memory, agent, project, graph, session, and maintenance CLI |
| `mementos-mcp` | MCP server; Streamable HTTP by default, stdio on request |
| `mementos-serve` | REST API server |

## Quick start

Local mode must be selected explicitly. The first command after the opt-in creates
and migrates `~/.hasna/mementos/mementos.db`.

```bash
export HASNA_MEMENTOS_LOCAL=1
mementos save project-stack "Bun, TypeScript, SQLite" \
  --scope shared --category fact
mementos recall project-stack
mementos search "TypeScript"
mementos list --scope shared
```

Register an agent and project when memories need explicit ownership:

```bash
mementos projects --add --name my-project --path "$PWD"
mementos register-agent marcus --role coding-agent
mementos inject --project "$PWD" --agent marcus --format compact
```

Memory scopes are `global`, `shared`, `private`, and `working`. `working` is
transient session scratch space and defaults to a one-hour lifetime. Categories
are `preference`, `fact`, `knowledge`, `history`, `procedural`, and `resource`.

For CLI `context` and `inject`, an explicit `--project` must resolve to a registered
project and restricts every included scope to that exact project. SDK
`getContext({ project_id })` uses the same exact-project rule. Unknown explicit
projects fail before memories are selected or touched; omitting the project keeps
the existing scope selection.

The library and MCP injection strategies retain unassigned agent-private context
alongside the selected project's private memories. They exclude private memories
assigned to another project. Their existing global/shared policies remain:
library strategies include global memories across projects and project-scoped
shared memories; direct MCP injection also scopes global memories to the project,
while its full smart pipeline uses the library policy.

Injection project references may be a stable project ID, registered name, or
registered path. Library, MCP, and HTTP/SDK injection resolve that reference once
and use the stable project ID for every downstream profile, search, filter, hook,
and touch path.

The list API and SDK expose `include_unassigned_project: true` with `project_id`
for this union. The filter applies before pagination and also governs `total`;
without a project it has no effect. Omitting it keeps an exact project match.

## CLI

```bash
mementos --help
mementos <command> --help
```

Human-readable list and search commands are compact and paginated by default.
Use `--limit` with `--cursor` or `--offset`, `--verbose` for wider snippets, and
`mementos show <id>` for a full record.

Historical `--json` and `--format json` collection reads remain compatible:
they emit full bare arrays and, without `--limit`, traverse the complete result.
Use explicit `--agent-json` when a token-bounded page receipt is wanted. Agent
JSON defaults to 20 compact list rows or 10 compact history rows, includes
`_meta.next_cursor`, and has a 32 KiB byte budget. `--full`, `--all`, and
`--max-bytes` are receipt-mode controls and require `--agent-json`; exhaustive
mode fails closed above 5,000 rows or 1 MiB.

Agent JSON uses offset pagination. Stable ID tie-breakers prevent overlap for
equal timestamps and importance while the result set is unchanged; writes
between page requests can shift offsets, so restart traversal when a stable
snapshot is required.

```bash
mementos list --json                         # compatible full bare array
mementos list --agent-json                   # bounded receipt page
mementos list --agent-json --cursor 20
mementos list --agent-json --full --limit 5
mementos history --agent-json --all
mementos search "deploy" --verbose
mementos storage mode --json
```

The complete command tree and option conventions are in the
[CLI reference](docs/CLI.md).

## MCP

`mementos-mcp` defaults to a shared, stateless Streamable HTTP server bound to
`127.0.0.1:8867`:

```bash
mementos-mcp
# explicit equivalent
mementos-mcp --http --port 8867
```

Endpoints are `GET /health` and `POST /mcp`. Set `MCP_HTTP_PORT` to change the
port. For an MCP host that launches a child process over stdio, opt in explicitly:

```bash
mementos-mcp --stdio
# or: MCP_STDIO=1 mementos-mcp
```

Cursor, Codex, Claude, and other command-based MCP host entries should use
`command = "mementos-mcp"` with `args = ["--stdio"]`.

The default `core` MCP profile exposes a bounded 23-tool agent surface. Select
additional comma-separated profiles with `--mcp-profile`,
`HASNA_MEMENTOS_MCP_PROFILE`, or the compatibility alias
`MEMENTOS_MCP_PROFILE`: `search`, `graph`, `automation`, `admin`, `storage`,
`hooks`, and `full`. The explicit `full` profile preserves all 124 tools and the
legacy unpaged `mementos://memories`, `mementos://agents`, and
`mementos://projects` resources; reduced profiles omit those resources and use
bounded list/get tools instead.

MCP `tools/list` remains the authoritative schema source. `search_tools` returns
a bounded names-only page for active-profile tools, and `describe_tools`
requires one to ten explicit names. See the [MCP reference](docs/MCP.md) for
profile membership and compatibility details.

## REST API

```bash
mementos-serve --port 19428
```

The server binds to `127.0.0.1` unless `MEMENTOS_HOST` is set. `/v1` is the
canonical API prefix and `/api` is a backward-compatible alias. Operational
probes and the generated contract are available without authentication:

```text
GET /health
GET /ready
GET /version
GET /openapi.json
```

API routes use bearer/API-key authentication when configured. See the
[REST API reference](docs/REST-API.md).

## Storage

### Client storage selection

The hosted Mementos API is the ordinary client default. The CLI, MCP server,
and SDK resolve the hosted credential and authority chain described below; if
no hosted credential resolves, client data commands fail closed rather than
opening or creating SQLite automatically.

SQLite is available only through an explicit local opt-in:

```bash
# Use the standard local data root (~/.hasna/mementos/mementos.db).
export HASNA_MEMENTOS_LOCAL=1

# Or select one exact SQLite file explicitly.
export HASNA_MEMENTOS_DB_PATH=/absolute/path/to/mementos.db
```

`MEMENTOS_LOCAL=1` and `MEMENTOS_DB_PATH` are compatibility aliases. Legacy
`~/.mementos` data is considered for migration only after local mode has been
selected explicitly; it is never an automatic client fallback.

### Server backend and HTTP clients

There are no deployment modes. The only runtime switch is the server data
backend: `sqlite | postgresql`, selected by `HASNA_MEMENTOS_DATABASE_URL`
presence. Raw PostgreSQL credentials are server-only — configure
`mementos-serve` with `HASNA_MEMENTOS_DATABASE_URL`; configure CLI and MCP
clients with the HTTPS API endpoint and API key instead:

```bash
# mementos-serve environment
HASNA_MEMENTOS_DATABASE_URL=postgres://...

# client environment; do not distribute the database URL to clients
HASNA_MEMENTOS_API_URL=https://mementos.example.com
HASNA_MEMENTOS_API_KEY=...
```

### Hosted clients — one credential chain

The CLI, the MCP server and the `./sdk` client resolve their credential and
service authority through the ONE resolver in `@hasna/contracts`
(`@hasna/contracts/client`), fresh on every call so a key rotation heals a
long-lived shell or MCP server without a restart:

| Tier | Source |
| --- | --- |
| 1 | explicit arguments (`--api-key` / `--profile`, or `baseUrl` / `apiKey` in the SDK) |
| 2 | deliberate env pointer: `HASNA_MEMENTOS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_MEMENTOS_API_KEY_REF` (a secrets-vault item key, never a value) |
| 3 | macOS Keychain: generic password `hasna.credentials.mementos.api-key`, account `HASNA_STATION` → `hostname -s` → `USER` |
| 4 | disk: `~/.hasna/mementos/config/credentials`, owner-only `0400`/`0600` (`HASNA_HOME` / `HASNA_CONFIG_HOME` move the root) |
| 5 | environment: `HASNA_MEMENTOS_API_KEY` |

The authority follows `HASNA_MEMENTOS_API_URL`, the Keychain `api-url` item,
the credentials file, and finally the fleet gateway
`https://api.hasna.com/mementos` — a credential ALONE is a complete
configuration. The legacy unprefixed `MEMENTOS_API_URL` / `MEMENTOS_API_KEY`
spellings survive only as the resolver's silent alias fallback for one
release. Writing a key to the disk tier:

```bash
mkdir -p ~/.hasna/mementos/config
printf 'HASNA_MEMENTOS_API_KEY=%s\n' "$KEY" > ~/.hasna/mementos/config/credentials
chmod 600 ~/.hasna/mementos/config/credentials
```

FAIL LOUD (owner ruling 2026-09-04): a hosted run with no credential anywhere
exits non-zero naming every tier it consulted; there is no SQLite fallback and
no local-fallback event. The on-box SQLite store is reachable ONLY through the
deliberate opt-ins `HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH` (an explicit
file) or `HASNA_MEMENTOS_LOCAL=1` (alias `MEMENTOS_LOCAL=1`, honoured only when
nothing configures an authority) — and every local run prints one line saying
it is local on stderr. Retired locations (`~/.hasna/fleet-env/`,
`~/.hasna/cloud/`, `~/.config/hasna/`, `$XDG_CONFIG_HOME`) and retired
`*_MODE` / `*_STORAGE_MODE` variables are inputs nowhere.

`mementos storage mode` reports the chosen transport without opening a
database or making a network request; `mementos status` prints the resolved
`API:` line (hasna/apps#1588).

The old `storage push`, `pull`, and `sync` commands remain for compatibility;
they are not the cutover architecture. See [Configuration and
storage](docs/CONFIGURATION.md) and the [cloud cutover runbook](docs/CUTOVER-RUNBOOK.md).

## TypeScript APIs

The main package exports the synchronous database/domain API from
`@hasna/mementos` and an authenticated fetch client from `@hasna/mementos/sdk`
— one package carries every surface (CLI, MCP server, REST server, SDK); there
is no separate `-sdk` or `-mcp` package. See [Library and SDK APIs](docs/LIBRARY.md).

## Shared event webhooks

The CLI includes the `events` and `webhooks` command groups supplied by
`@hasna/events`, allowing memory events to trigger command or HTTP automation.
Inspect their installed-version help before configuring a webhook:

```bash
mementos events --help
mementos webhooks --help
```

Event command handlers receive the envelope on stdin and in
`HASNA_EVENT_JSON`. Include `working_dir`, `project_path`, or `repo_path` when a
downstream agent must run in a particular repository.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

Development entry points are `bun run dev:cli`, `bun run dev:mcp`, and
`bun run dev:serve`.

## Documentation

- [CLI reference](docs/CLI.md)
- [MCP reference](docs/MCP.md)
- [REST API reference](docs/REST-API.md)
- [Configuration and storage](docs/CONFIGURATION.md)
- [Library and SDK APIs](docs/LIBRARY.md)
- [Cloud cutover runbook](docs/CUTOVER-RUNBOOK.md)

## License

Apache-2.0 — see [LICENSE](LICENSE).
