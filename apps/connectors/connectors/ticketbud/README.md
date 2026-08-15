# @hasna/connect-ticketbud

TypeScript connector for the [Ticketbud API](https://api.ticketbud.com) — event ticketing, sales totals, and check-in.

## Features

- OAuth2 authorization flow and direct access token support
- Multi-profile configuration
- CLI and programmatic API
- Seven core operations: user profile, events, totals, tickets, check-in

## Quick Start

```bash
cd connectors/ticketbud
bun install
bun run dev config set-token <your-access-token>
bun run dev me
```

## OAuth2 Setup

1. Create an application in Ticketbud (My Account → My Applications)
2. Set callback URL to `http://localhost:8089/callback`
3. Save credentials:

```bash
bun run dev config set-credentials <client-id> <client-secret>
bun run dev oauth login
```

## CLI Commands

```bash
connect-ticketbud me
connect-ticketbud events list
connect-ticketbud events get <eventId>
connect-ticketbud events totals <eventId>
connect-ticketbud tickets list <eventId>
connect-ticketbud tickets get <eventId> <ticketIdOrBarcode>
connect-ticketbud tickets check-in <eventId> <ticketId> [--reverse]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TICKETBUD_ACCESS_TOKEN` | API access token |
| `TICKETBUD_CLIENT_ID` | OAuth client ID |
| `TICKETBUD_CLIENT_SECRET` | OAuth client secret |

## Library Usage

```typescript
import { Ticketbud } from '@hasna/connect-ticketbud';

const api = Ticketbud.fromEnv();
const { user } = await api.getMe();
const { events } = await api.listEvents();
```

## Development

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
