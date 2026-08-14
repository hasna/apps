# connect-ticketsource

TypeScript connector for the [TicketSource](https://www.ticketsource.io/) event ticketing API.

## Features

- Read-only REST client for events, venues, dates, customers, and bookings
- Bearer token authentication
- Multi-profile configuration
- JSON and pretty CLI output formats

## Quick Start

```bash
cd connectors/ticketsource
bun install

# Configure API key
export TICKETSOURCE_API_KEY=your-api-key
# or
bun run dev config set-key your-api-key

# List events
bun run dev events list
```

## CLI Commands

```bash
connect-ticketsource profile list|use|create|delete|show
connect-ticketsource config set-key|show|clear

connect-ticketsource events list [--page N] [--limit N]
connect-ticketsource events get <eventId>
connect-ticketsource events venues <eventId>
connect-ticketsource events dates <eventId>
connect-ticketsource venues dates <venueId>
connect-ticketsource customers list
connect-ticketsource customers get <customerId>
connect-ticketsource bookings list
```

## Library Usage

```typescript
import { TicketSource } from '@hasna/connect-ticketsource';

const client = TicketSource.fromEnv();
const events = await client.listEvents();
```

## API Reference

- Base URL: `https://api.ticketsource.io`
- Docs: https://reference.ticketsource.io

## License

Apache-2.0
