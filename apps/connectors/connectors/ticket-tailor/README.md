# Ticket Tailor Connector

TypeScript CLI and library for the [Ticket Tailor API](https://developers.tickettailor.com/).

## Features

- Multi-profile configuration
- HTTP Basic authentication with API key
- Events, orders, and issued tickets
- Pretty and JSON output formats

## Quick Start

```bash
cd connectors/ticket-tailor
bun install
bun run dev --help
```

## Authentication

Get your API key from the Ticket Tailor dashboard. The connector sends it as HTTP Basic auth:

```
Authorization: Basic base64(apiKey)
```

Set via environment variable or profile:

```bash
export TICKET_TAILOR_API_KEY=your-api-key
# or
bun run dev config set-key your-api-key
```

## Commands

```bash
# Connectivity
bun run dev ping
bun run dev overview

# Events
bun run dev events list
bun run dev events get <eventId>

# Orders
bun run dev orders list
bun run dev orders get <orderId>

# Issued tickets
bun run dev issued-tickets list
bun run dev issued-tickets get <ticketId>

# Profiles
bun run dev profile list
bun run dev profile create staging --api-key <key> --use
```

## Library Usage

```typescript
import { TicketTailor } from '@hasna/connect-ticket-tailor';

const client = TicketTailor.fromEnv();
const events = await client.listEvents();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TICKET_TAILOR_API_KEY` | API key (overrides profile) |

## License

Apache-2.0
