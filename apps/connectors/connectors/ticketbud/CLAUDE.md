# CLAUDE.md

Guidance for working with the Ticketbud connector.

## Overview

`@hasna/connect-ticketbud` wraps the Ticketbud REST API at `https://api.ticketbud.com`. All requests append `access_token` as a query parameter. OAuth2 authorize/token endpoints are on the same host.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun run build
bun test
```

## API Operations

| Method | Endpoint |
|--------|----------|
| `getMe()` | `GET /me.json` |
| `listEvents()` | `GET /events.json` |
| `getEvent(id)` | `GET /events/:id.json` |
| `getEventTotals(id)` | `GET /events/:id/totals.json` |
| `listTickets(eventId)` | `GET /events/:eventId/tickets.json` |
| `getTicket(eventId, id)` | `GET /events/:eventId/tickets/:id.json` |
| `checkInTicket(eventId, id)` | `PUT /events/:eventId/tickets/:id/check_in.json` |

## Authentication

- **Access token**: `config set-token` or `TICKETBUD_ACCESS_TOKEN`
- **OAuth2**: `config set-credentials` then `oauth login`
- Authorize URL uses `redirect_url`; token exchange uses `redirect_uri`
- Callback: `http://localhost:8089/callback`

## Config Storage

```
~/.hasna/connectors/connect-ticketbud/
├── current_profile
└── profiles/
    └── default.json
```

## Security

- No hardcoded tokens
- `.env.example` has placeholders only
- No browser-use or scraper dependencies
