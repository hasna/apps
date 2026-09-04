# @hasna/calendar

Universal calendar management for AI coding agents. The package ships a typed SDK,
a `calendar` CLI, a Model Context Protocol server, and a PostgreSQL HTTP API server.

This is a **partial migration**, not a whole-package remote-only release. Calendar
domain operations are authenticated HTTPS clients. Embedded Events/channel/replay
commands and explicit `db-migrate` retain their existing local semantics pending
an approved migration contract; legacy data is not moved or deleted by this change.

**Fleet storage doctrine (`docs/fleet-local-storage.md`): in api mode the CLI
creates, opens, and migrates NO local database.** Installation no longer
pre-creates `~/.hasna/calendar`; `db-migrate` is `LOCAL-ONLY` and refuses to
run whenever an API URL/key is configured, loading the SQLite layer only when
it is actually allowed to run.

## Install

```sh
bun add @hasna/calendar
```

The package requires Bun. Installed binaries:

- `calendar` - CLI for orgs, agents, calendars, events, attendees, availability,
  memberships, and event-log commands from `@hasna/events`.
- `calendar-mcp` - MCP server over stdio, or Streamable HTTP with `--http`.
- `calendar-serve` - PostgreSQL HTTP API server.

## Storage And Configuration

Calendar domain CLI commands, MCP tools, root `getStore()`, and `./sdk` require
both `HASNA_CALENDAR_API_URL` (explicit HTTPS) and `HASNA_CALENDAR_API_KEY`.
The `CALENDAR_*` aliases are accepted only when nonblank and nonconflicting.
Absent, partial, blank, malformed and conflicting configuration fails closed.
Retired placement selectors are rejected. Network/authentication failures never
fall back to a local domain database. Clients do not consume database DSNs.

In api mode the CLI loads no local database at all: no SQLite adapter is
instantiated, no shadow mirror or outbox exists, and `~/.hasna/calendar` is
never created by the package (there is no `postinstall` and no command path
that touches a local database when `HASNA_CALENDAR_API_URL` is set). The only
local database surface is the explicit legacy `db-migrate` command, which is
LOCAL-ONLY and refuses to run in api mode.

Each client snapshots its authority and credential. Redirects and authentication
header overrides are refused. Only reads may retry; server write deduplication
is not established. Response errors do not expose server bodies.

`calendar-serve` requires an app-scoped valid PostgreSQL URL before binding:
`HASNA_CALENDAR_DATABASE_URL` or the nonconflicting `CALENDAR_DATABASE_URL`
alias. The DSN must contain exactly one `sslmode=verify-full`; absent, weaker,
duplicate or competing SSL/TLS parameters are rejected. Certificate and hostname
verification are forced in the Bun driver. An explicit PEM trust bundle may be
read from `HASNA_CALENDAR_PG_CA_FILE` or the existing `PGSSLROOTCERT` (values must
agree). No plaintext production or test-mode exception is provided.
`/v1` also requires `HASNA_CALENDAR_API_SIGNING_KEY` (or supported
signing-secret alias). Schema changes remain explicit `calendar-serve migrate`
operations, never automatic request-time migrations.

The HTTP server uses `CALENDAR_PORT` (default 19428); MCP HTTP mode uses
`MCP_HTTP_PORT` (default 8803). A server with no serve credential disables
`/mcp`; enabling it requires both a separate serve credential and a valid
domain API URL/key.

### Unresolved public integrations — package remains incomplete

**Multi-tenant authorization is NOT established.** The current server checks
Calendar app scopes but does not bind `principal.tid` to organization queries.
Adversarial tests reproduce cross-organization reads/deletes. Do not interpret
HTTPS authentication as tenant isolation or approve this package for a shared
multi-tenant deployment. See `TENANCY-GAP.md` in the source tree for required
product/API decisions; no tenant mapping or administrative scope was invented.

- Embedded `events` and `channels` commands from `@hasna/events` still use
  that package's local event/channel/delivery store. They are distinct from
  Calendar scheduling events and have no matching Calendar API routes.
- Explicit `db-migrate` retains its existing legacy SQLite copy semantics
  as a LOCAL-ONLY surface: it refuses to run when `HASNA_CALENDAR_API_URL`
  (or an alias) is configured, and its SQLite layer is loaded lazily so an
  api-mode CLI never opens the local tier. It is not a server import and does
  not establish remote authority.
- `LocalStore` is no longer a public root export or a selectable domain
  transport. Internal SQLite code remains for fixtures and the explicit legacy
  command. No new runtime paths are introduced; legacy data stays untouched.
- The canonical shared Contracts revision is unpublished. This package keeps
  its existing released dependency and does not claim the new kit is released.

## SDK

```ts
import { getStore } from "@hasna/calendar";
import { createCalendarClient } from "@hasna/calendar/sdk";

// Both validate the canonical environment pair before operating.
const store = getStore();
const org = await store.createOrg({ name: "Platform" });
console.log(await store.listCalendars(org.id));

const sdk = createCalendarClient();
const { events } = await sdk.listEvents({ org_id: org.id });
console.log(events);
```

All generated SDK methods retain their `/v1` response envelopes. The root
store unwraps those envelopes into domain objects. There is no public local
CRUD export.

## CLI

Calendar CRUD commands accept `--json` either globally or on the subcommand:

```sh
calendar --json org-add "Platform"
calendar org-list --json
```

Global options:

- `--json` outputs JSON and serializes command errors as JSON.
- `--agent <name>` provides an agent name for commands that use agent context.
- `--org <slug>` is accepted as global org context for integrations; commands
  that need an org usually require an explicit `--org <org-id>` option.

Command groups:

```text
calendar org-add <name> [--slug <slug>] [--description <desc>]
calendar org-list
calendar org-show <id-or-slug>
calendar org-update <id> [--name <name>] [--description <desc>]
calendar org-delete <id>

calendar init <name> [--description <desc>] [--role <role>] [--org <org-id>]
calendar agents
calendar heartbeat [agent]
calendar agent-update <id> [--description <desc>] [--role <role>]
calendar agent-delete <id>

calendar cal-add <name> --org <org-id> [--slug <slug>] [--description <desc>]
  [--color <hex>] [--timezone <tz>] [--visibility public|org|private]
calendar cal-list [--org <org-id>]
calendar cal-update <id> [--name <name>] [--description <desc>]
  [--color <hex>] [--timezone <tz>] [--visibility <visibility>]
calendar cal-delete <id>

calendar add <title> --calendar <calendar-id> --start <iso> --end <iso>
  [--org <org-id>] [--description <desc>] [--location <loc>] [--all-day]
  [--status tentative|confirmed|cancelled] [--busy busy|free|out_of_office]
  [--timezone <tz>] [--rrule <rule>] [--source-task <id>] [--agent <agent-id>]
calendar list [--calendar <calendar-id>] [--org <org-id>]
  [--after <iso>] [--before <iso>] [--limit <n>]
calendar show <id>
calendar update <id> [--title <title>] [--start <iso>] [--end <iso>]
  [--description <desc>] [--location <loc>] [--status <status>]
calendar delete <id>
calendar search <query> [--org <org-id>]
calendar conflicts <calendar-id> --start <iso> --end <iso>

calendar attendee-add --event <event-id>
  [--agent <agent-id>] [--name <name>] [--email <email>] [--required|--optional]
calendar attendee-respond <attendee-id> --status accepted|declined|tentative
  [--comment <comment>]
calendar attendee-delete <id>

calendar availability-set --agent <agent-id> --org <org-id>
  --day <0-6> --start <HH:mm> --end <HH:mm>
calendar availability-show <agent-id> [--org <org-id>]
calendar availability-delete <id>

calendar member-add --org <org-id> --agent <agent-id>
  [--role admin|member|service]
calendar members <org-id>
calendar member-remove <agent-id> <org-id>
calendar agent-orgs <agent-id>
```

The CLI also registers `events` and `channels` command groups from
`@hasna/events` for local event-log and webhook operations:

```sh
calendar events --help
calendar channels --help
```

### Compact Output And Gradual Disclosure

Human-readable list and search commands are compact by default so agent
terminals do not fill with full records. Default output shows essential fields,
caps the first page at 20 rows, and prints a hint for the next step.

Use these flags to disclose more detail:

- `--limit <n>` changes the number of rows in the current page (max 100).
- `--cursor <n>` starts from a later zero-based row offset.
- `--verbose` adds secondary fields such as descriptions, locations, IDs, and
  timestamps without switching to JSON.
- `--json` keeps machine-readable output as the existing full JSON record array
  unless paging is explicitly requested with `--limit` or `--cursor`.
- `--json --limit` or `--json --cursor` returns a pagination envelope:
  `{ "items": [...], "total": 42, "limit": 20, "cursor": 0, "next_cursor": 20 }`.
- Detail commands such as `calendar show <id>` and `calendar org-show <id>`
  return a focused record when you know the ID.

```sh
calendar list --calendar cal_123
calendar list --calendar cal_123 --cursor 20
calendar list --calendar cal_123 --limit 5 --verbose
calendar show evt_123
calendar list --calendar cal_123 --json
```

MCP list/search tools use the same gradual disclosure model. They return compact
summary envelopes by default and accept `limit`, `cursor`, and `verbose` fields
where applicable.

## Common CLI Workflow

```sh
ORG_JSON=$(calendar --json org-add "Platform")
ORG_ID=$(bun -e 'console.log(JSON.parse(process.argv[1]).id)' "$ORG_JSON")

AGENT_JSON=$(calendar --json init spark01 --org "$ORG_ID" --role dispatcher)
AGENT_ID=$(bun -e 'console.log(JSON.parse(process.argv[1]).id)' "$AGENT_JSON")

CAL_JSON=$(calendar --json cal-add "Engineering" --org "$ORG_ID" --timezone UTC)
CAL_ID=$(bun -e 'console.log(JSON.parse(process.argv[1]).id)' "$CAL_JSON")

calendar --json add "Release review" \
  --calendar "$CAL_ID" \
  --org "$ORG_ID" \
  --start "2026-06-24T14:00:00Z" \
  --end "2026-06-24T14:30:00Z" \
  --agent "$AGENT_ID"

calendar --json list --calendar "$CAL_ID" --limit 5
calendar --json conflicts "$CAL_ID" \
  --start "2026-06-24T14:10:00Z" \
  --end "2026-06-24T14:20:00Z"
```

## MCP Server

Start the stdio MCP server:

```sh
calendar-mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "calendar": {
      "command": "calendar-mcp"
    }
  }
}
```

The MCP server exposes tools for orgs, agents, calendars, events, attendees,
availability, memberships, and bootstrap:

```text
create_org, list_orgs, get_org
register_agent, list_agents, heartbeat
create_calendar, list_calendars
create_event, list_events, get_event, update_event, delete_event
search_events, find_conflicts
add_attendee, list_attendees, respond_to_event
set_availability, get_availability
add_member, list_members
bootstrap
```

Start Streamable HTTP MCP mode:

```sh
calendar-mcp --http --port 8803
curl http://127.0.0.1:8803/health
```

Environment equivalent:

```sh
MCP_HTTP=1 MCP_HTTP_PORT=8803 calendar-mcp
```

In HTTP mode, MCP requests are served at `/mcp`.

## HTTP API Server

`calendar-serve` exposes exactly three kinds of surface. Nothing else is mounted.

### Route census

| # | Route | Methods | Auth | Store reached | Carries |
| --- | --- | --- | --- | --- | --- |
| 1 | `/health` | GET | **public** | none | metadata |
| 2 | `/version` | GET | **public** | none | metadata |
| 3 | `/ready` | GET | **public** | `select 1` round-trip only | metadata |
| 4 | `/openapi.json` | GET | **public** | none | metadata |
| 5 | `/v1` | any | API key | none (banner) | metadata |
| 6 | `/v1/orgs[/:id]` | GET POST PATCH PUT DELETE | API key | Postgres | **data** |
| 7 | `/v1/calendars[/:id]` | GET POST PATCH PUT DELETE | API key | Postgres | **data** |
| 8 | `/v1/events[/:id]`, `/v1/events/search`, `/v1/events/conflicts` | GET POST PATCH PUT DELETE | API key | Postgres | **data** |
| 9 | `/v1/attendees[/:id]` | GET POST PATCH PUT DELETE | API key | Postgres | **data** |
| 10 | `/v1/agents[/:id[/heartbeat]]` | GET POST PATCH PUT DELETE | API key | Postgres | **data** |
| 11 | `/v1/availability[/:id]` | GET POST DELETE | API key | Postgres | **data** |
| 12 | `/v1/members` | GET POST DELETE | API key | Postgres | **data** |
| 13 | `/v1/<unknown>` | any | API key | none | metadata (404) |
| 14 | `/mcp` | POST GET DELETE (+ OPTIONS) | **auth posture** (below) | `getStore()`, 23 tools | **data** |
| 15 | `OPTIONS` (non-`/v1`, non-`/mcp`) | OPTIONS | public | none | metadata (CORS) |
| 16 | anything else | any | public | none | metadata (404) |

Routes 1-4 are metadata-only and stay public in every configuration: they are the
service-contract probes an ALB target group and a container healthcheck depend on.
`/v1` authenticates itself with the `@hasna/contracts` API-key verifier (reads need
`calendar:read`, writes need `calendar:write`).

Known quirks — both pre-existing, both CORS-preflight-only, neither fixed here:

- `OPTIONS /v1/...` is claimed by the `/v1` handler and treated as a write, so it
  answers **401** rather than returning CORS headers.
- `OPTIONS /mcp` is claimed by the `/mcp` route and goes through the auth posture, so
  it answers **401** in `enforce` and **404 `LOCAL_PLANE_DISABLED`** when the local
  plane is disabled — in neither case does it return CORS headers. Only routes 15/16
  (everything that is neither `/v1*` nor `/mcp`) get a real CORS preflight response.
  Consequence: a browser cannot call `/v1` or `/mcp` cross-origin. Both surfaces are
  server-to-server today, so this is documented rather than changed.

### Auth posture for `/mcp`

`/mcp` is a full read/write data plane (`create_org`, `register_agent`,
`create_event`, `update_event`, `delete_event`, `add_member`, …). The posture is
resolved **once at startup, before the socket is bound**:

| Configuration | Posture | `/mcp` | `/v1` | probes |
| --- | --- | --- | --- | --- |
| `CALENDAR_SERVE_API_KEY` (or `--api-key`) | `enforce` | credential required | authenticated | public |
| hosted (an app-scoped database URL, `HASNA_CALENDAR_DATABASE_URL`) with no serve key | `local-plane-disabled` | **404 `LOCAL_PLANE_DISABLED`** — not mounted | authenticated | public |
| absent or invalid PostgreSQL URL, even with `--allow-anonymous` | — | server refuses to bind | — | — |
| anything else | — | **the server refuses to start, exit 1** | — | — |

`--allow-anonymous` is refused outright for a non-loopback bind host, and even when
active a request is only served anonymously if its **raw transport peer** is loopback
(`x-forwarded-for` is deliberately ignored, so a proxy header cannot forge it).

On a **hosted** deployment, setting `CALENDAR_SERVE_API_KEY` without also setting
`HASNA_CALENDAR_API_URL` + `HASNA_CALENDAR_API_KEY` is refused at startup
(`SPLIT_STORE_PLANE`): the MCP domain client is unconfigured; it never falls back to SQLite.

`CALENDAR_SERVE_API_KEY` is intentionally a different variable from the client-flip
`CALENDAR_API_KEY` / `HASNA_CALENDAR_API_KEY`: those point the CLI/MCP *at* a remote
`/v1`, and reusing them here would flip `getStore()` to the API store as a side effect
of configuring the server's own auth.

### Running it

```sh
# hosted (ECS/RDS): /v1 only, /mcp not served.
# No HASNA_CALENDAR_API_URL / HASNA_CALENDAR_API_KEY here — those are client-side.
HASNA_CALENDAR_DATABASE_URL=<dsn> calendar-serve
```

```sh
curl http://127.0.0.1:19428/health
curl http://127.0.0.1:19428/ready
curl -H "x-api-key: <key>" http://127.0.0.1:19428/v1/orgs
```


## Development And Validation

```sh
bun install
bun run typecheck
bun test
bun run build
bun pm pack --dry-run
```

Focused smoke checks:

```sh
bun run src/cli/index.tsx --version
bun run src/cli/index.tsx --json org-list
bun run src/mcp/index.ts --http --port 8803
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
