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

Start the local server:

```sh
calendar-serve
CALENDAR_PORT=19428 calendar-serve
```

Health endpoints:

```sh
curl http://127.0.0.1:19428/health
curl http://127.0.0.1:19428/api/health
```

Core API routes:

```text
GET    /api/orgs
POST   /api/orgs
GET    /api/orgs/:idOrSlug
PUT    /api/orgs/:id
DELETE /api/orgs/:id

GET    /api/agents
POST   /api/agents
GET    /api/agents/:idOrName
POST   /api/agents/:id/heartbeat

GET    /api/calendars?org_id=<org-id>
POST   /api/calendars
GET    /api/calendars/:id
PUT    /api/calendars/:id
DELETE /api/calendars/:id

GET    /api/events?calendar_id=<calendar-id>&org_id=<org-id>&after=<iso>&before=<iso>&limit=<n>
POST   /api/events
GET    /api/events/search?q=<query>&org_id=<org-id>
GET    /api/events/conflicts?calendar_id=<calendar-id>&start=<iso>&end=<iso>
GET    /api/events/:id
PUT    /api/events/:id
DELETE /api/events/:id

POST   /api/attendees
POST   /api/attendees/:id/respond

GET    /api/availability?agent_id=<agent-id>&org_id=<org-id>
POST   /api/availability

GET    /api/members?org_id=<org-id>
POST   /api/members
GET    /api/events/stream?org_id=<org-id>&agent_id=<agent-id>
POST   /mcp
```

Example:

```sh
curl -s -X POST http://127.0.0.1:19428/api/orgs \
  -H 'content-type: application/json' \
  -d '{"name":"Platform"}'
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
