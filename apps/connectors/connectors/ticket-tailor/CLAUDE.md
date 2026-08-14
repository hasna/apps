# CLAUDE.md

This file provides guidance to Claude Code when working with the Ticket Tailor connector.

## Project Overview

`@hasna/connect-ticket-tailor` is a TypeScript connector for the Ticket Tailor event ticketing API.

- Base URL: `https://api.tickettailor.com/v1`
- Auth: HTTP Basic with API key only (`Authorization: Basic base64(apiKey)`)
- Docs: https://developers.tickettailor.com/

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Basic auth
│   ├── index.ts      # TicketTailor facade
│   └── client.test.ts
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts
└── index.ts
```

## Authentication

API key auth (dashboard type: `apikey`). Set `TICKET_TAILOR_API_KEY` or use `config set-key`.

Profiles stored in `~/.hasna/connectors/connect-ticket-tailor/profiles/`.

## CLI Commands

- `ping`, `overview`
- `events list|get <id>`
- `orders list|get <id>`
- `issued-tickets list|get <id>`
- `profile` and `config` subcommands

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TICKET_TAILOR_API_KEY` | API key |

## Security

- Never commit API keys
- `.env.example` uses placeholders only
- No browser-use or scraper dependencies
