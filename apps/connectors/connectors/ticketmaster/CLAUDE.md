# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-ticketmaster is a TypeScript connector for the [Ticketmaster Discovery API v2](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/). It provides access to events, attractions, and venues search and retrieval.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run unit tests
```

## Authentication

Ticketmaster uses `apikey` as a query parameter:

```
https://app.ticketmaster.com/discovery/v2/events.json?apikey=YOUR_KEY
```

Auth type: **apikey** (for dashboard serve compatibility).

## API Surface

All endpoints are GET-only. Base URL: `https://app.ticketmaster.com/discovery/v2`

- **Events**: `GET /events.json` (search), `GET /events/{id}.json` (get)
- **Attractions**: `GET /attractions.json` (search), `GET /attractions/{id}.json` (get)
- **Venues**: `GET /venues.json` (search), `GET /venues/{id}.json` (get)

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client with apikey query param auth
│   ├── events.ts       # Events API
│   ├── attractions.ts  # Attractions API
│   ├── venues.ts       # Venues API
│   └── index.ts        # Main Connector class
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # Type definitions
├── utils/
│   ├── config.ts       # Multi-profile config (~/.hasna/connectors/connect-ticketmaster/)
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TICKETMASTER_API_KEY` | Ticketmaster Consumer Key (overrides profile) |

## CLI Commands

```bash
connect-ticketmaster events search --countryCode US --keyword concert
connect-ticketmaster events get <eventId>
connect-ticketmaster attractions search --keyword artist
connect-ticketmaster attractions get <attractionId>
connect-ticketmaster venues search --city "New York"
connect-ticketmaster venues get <venueId>
connect-ticketmaster config set-key <key>
connect-ticketmaster config show
connect-ticketmaster profile list|use|create|delete|show
```
