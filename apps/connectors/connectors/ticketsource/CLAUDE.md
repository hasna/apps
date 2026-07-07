# CLAUDE.md

This file provides guidance to Claude Code when working with the TicketSource connector.

## Project Overview

connect-ticketsource is a TypeScript connector for the [TicketSource API](https://www.ticketsource.io/). It provides read-only access to events, venues, dates, customers, and bookings with multi-profile configuration.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication. Credentials can be set via:
- Environment variable: `TICKETSOURCE_API_KEY`
- Profile configuration: `connect-ticketsource config set-key <key>`

API requests use `Authorization: Bearer <api_key>` against `https://api.ticketsource.io`.

## API Endpoints

| Method | Endpoint |
|--------|----------|
| GET | `/events` |
| GET | `/events/{id}` |
| GET | `/events/{id}/venues` |
| GET | `/events/{id}/dates` |
| GET | `/venues/{id}/dates` |
| GET | `/customers` |
| GET | `/customers/{id}` |
| GET | `/bookings` |

## CLI Commands

```bash
connect-ticketsource events list
connect-ticketsource events get <eventId>
connect-ticketsource events venues <eventId>
connect-ticketsource events dates <eventId>
connect-ticketsource venues dates <venueId>
connect-ticketsource customers list
connect-ticketsource customers get <customerId>
connect-ticketsource bookings list
```

## Data Storage

```
~/.hasna/connectors/connect-ticketsource/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "your-api-key"
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TICKETSOURCE_API_KEY` | API key (overrides profile) |
