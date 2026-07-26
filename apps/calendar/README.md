# @hasna/calendar

Universal calendar management for AI coding agents. The package ships a typed SDK,
a `calendar` CLI, a Model Context Protocol server, and a local HTTP API server
backed by SQLite.

## Install

```sh
bun add @hasna/calendar
```

The package requires Bun. Installed binaries:

- `calendar` - CLI for orgs, agents, calendars, events, attendees, availability,
  memberships, and event-log commands from `@hasna/events`.
- `calendar-mcp` - MCP server over stdio, or Streamable HTTP with `--http`.
- `calendar-serve` - local HTTP API server.

## Storage And Configuration

By default, calendar data is stored in SQLite at:

```text
~/.hasna/calendar/calendar.db
```

The database location can be controlled with environment variables:

- `CALENDAR_DB_PATH=/absolute/path/calendar.db` uses an explicit database file.
- `CALENDAR_DB_SCOPE=project` stores data under the nearest git root at
  `.calendar/calendar.db`.
- If a `.calendar/calendar.db` exists in the current directory or a parent
  directory, that database is reused.
- `BUN_TEST=1` makes the SDK default to an in-memory database for tests.

The HTTP server uses `CALENDAR_PORT` and defaults to `19428`. The MCP HTTP mode
uses `MCP_HTTP_PORT` and defaults to `8803`.

### Storage mode

`HASNA_CALENDAR_STORAGE_MODE` accepts exactly three values — there are no aliases:

| Mode | Meaning | Store |
| --- | --- | --- |
| `local` | this machine | on-box SQLite |
| `self_hosted` | Hasna-owned infrastructure (ECS + RDS) | `/v1` over HTTP |
| `cloud` | managed multi-tenant offering | `/v1` over HTTP |

Any other value is a **hard startup failure**. It is never silently downgraded to
`local`: doing so used to split a single process across two different datasets. In
particular `remote` is **rejected**, not aliased — set `cloud` instead.

`cloud` is the value the deployed `calendar-prod` service uses, matching every other
Terraform-managed Hasna app and the `@hasna/contracts` `CONTRACT.md` Amendment A1
runtime enum. `self_hosted` is still accepted by this package but is a **deprecated
spelling** of the same hosted posture — prefer `cloud` for new configuration.

**These two modes mean different things on the two sides of the wire — do not mix
them up:**

- **Client side** (`calendar` CLI, `calendar-mcp`, the SDK): `self_hosted`/`cloud`
  route `getStore()` at a remote `/v1`, and therefore **do** additionally need
  `HASNA_CALENDAR_API_URL` (defaults to `https://calendar.hasna.xyz`) and
  `HASNA_CALENDAR_API_KEY`.
- **Server side** (`calendar-serve`): `self_hosted`/`cloud` mean *"this process **is**
  the hosted deployment"*. It talks to Postgres directly via
  `HASNA_CALENDAR_DATABASE_URL` + `HASNA_CALENDAR_API_SIGNING_KEY`, and needs **neither**
  `HASNA_CALENDAR_API_URL` **nor** `HASNA_CALENDAR_API_KEY`. `calendar-prod` runs with
  neither and is correct. Setting the client-flip pair on a serve process points it at
  *itself* — see the `SPLIT_STORE_PLANE` note under "Auth posture for `/mcp`".

Known limitation (pre-existing, not changed here): `isCloudModeEnabled()` treats a
**generic** `DATABASE_URL` as "hosted", so a developer who happens to have an
unrelated `DATABASE_URL` exported will find `/mcp` disabled on a local
`calendar-serve`. Workaround: unset `DATABASE_URL`, or set `CALENDAR_SERVE_API_KEY`.
Narrowing that lookup to the app-scoped vars is tracked separately.

## SDK

The root package export is side-effect free and exposes types, database helpers,
and CRUD helpers for orgs, agents, calendars, events, attendees, availability,
and memberships.

```ts
import {
  createOrg,
  registerAgent,
  createCalendar,
  createEvent,
  listEvents,
  findConflicts,
  searchEvents,
  closeDatabase,
  type Event,
} from "@hasna/calendar";

const org = createOrg({ name: "Platform" });
const agent = registerAgent({ name: "spark01", org_id: org.id });
const calendar = createCalendar({
  org_id: org.id,
  name: "Launch",
  timezone: "Europe/Bucharest",
});

const event: Event = createEvent({
  calendar_id: calendar.id,
  org_id: org.id,
  title: "Release review",
  start_at: "2026-06-24T14:00:00+03:00",
  end_at: "2026-06-24T14:30:00+03:00",
  created_by: agent.id,
});

console.log(listEvents({ org_id: org.id, limit: 10 }));
console.log(findConflicts(calendar.id, { start: event.start_at, end: event.end_at }));
console.log(searchEvents("release", org.id));

closeDatabase();
```

Useful exported helpers include:

- Database: `getDatabase`, `closeDatabase`, `resetDatabase`
- Orgs: `createOrg`, `getOrg`, `getOrgBySlug`, `listOrgs`, `updateOrg`, `deleteOrg`
- Agents: `registerAgent`, `getAgent`, `getAgentByName`, `listAgents`,
  `heartbeat`, `updateAgent`, `deleteAgent`
- Calendars: `createCalendar`, `getCalendar`, `listCalendars`,
  `updateCalendar`, `deleteCalendar`
- Events: `createEvent`, `getEvent`, `listEvents`, `updateEvent`,
  `deleteEvent`, `searchEvents`, `findConflicts`, `findAgentConflicts`
- Attendees: `createAttendee`, `getAttendeesForEvent`, `updateAttendee`,
  `deleteAttendee`
- Availability: `getAvailabilityForAgent`, `upsertAgentAvailability`,
  `deleteAvailability`
- Memberships: `createMembership`, `getMembershipsForOrg`, `getOrgsForAgent`,
  `deleteMembershipByAgentAndOrg`

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

The CLI also registers `events` and `webhooks` command groups from
`@hasna/events` for local event-log and webhook operations:

```sh
calendar events --help
calendar webhooks --help
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
| hosted (a database URL, or `HASNA_CALENDAR_STORAGE_MODE=self_hosted`/`cloud`) with no serve key | `local-plane-disabled` | **404 `LOCAL_PLANE_DISABLED`** — not mounted | authenticated | public |
| loopback bind **and** `--allow-anonymous` (or `CALENDAR_ALLOW_ANONYMOUS=1`) | `anonymous-loopback` | anonymous, **loopback peers only** | authenticated | public |
| anything else | — | **the server refuses to start, exit 1** | — | — |

`--allow-anonymous` is refused outright for a non-loopback bind host, and even when
active a request is only served anonymously if its **raw transport peer** is loopback
(`x-forwarded-for` is deliberately ignored, so a proxy header cannot forge it).

On a **hosted** deployment, setting `CALENDAR_SERVE_API_KEY` without also setting
`HASNA_CALENDAR_API_URL` + `HASNA_CALENDAR_API_KEY` is refused at startup
(`SPLIT_STORE_PLANE`): `/v1` would be on Postgres while `/mcp` was on on-box SQLite.

`CALENDAR_SERVE_API_KEY` is intentionally a different variable from the client-flip
`CALENDAR_API_KEY` / `HASNA_CALENDAR_API_KEY`: those point the CLI/MCP *at* a remote
`/v1`, and reusing them here would flip `getStore()` to the API store as a side effect
of configuring the server's own auth.

### Running it

```sh
# local dev, loopback only
calendar-serve --allow-anonymous

# local with a shared credential
CALENDAR_SERVE_API_KEY=<key> calendar-serve

# hosted (ECS/RDS): /v1 only, /mcp not served.
# No HASNA_CALENDAR_API_URL / HASNA_CALENDAR_API_KEY here — those are client-side.
HASNA_CALENDAR_STORAGE_MODE=cloud HASNA_CALENDAR_DATABASE_URL=<dsn> calendar-serve
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
