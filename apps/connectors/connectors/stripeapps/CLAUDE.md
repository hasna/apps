# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Stripe Apps connector CLI - items, events, search, and raw requests against the Stripe Apps REST API. Authenticates with a Bearer token; the default base URL is `https://api.stripeapps.com/v1` and can be overridden with `STRIPEAPPS_BASE_URL`.

## Build & Run Commands

```bash
bun install       # Install dependencies
bun run dev       # Run CLI in development
bun run build     # Build for distribution
bun run typecheck # Type check
bun test          # Run tests
```

## Architecture

```
src/
├── api/
│   ├── client.ts  # StripeAppsClient: fetch wrapper, Bearer auth, error handling
│   ├── items.ts   # ItemsApi: list / create / get
│   ├── events.ts  # EventsApi: list
│   ├── search.ts  # SearchApi: search
│   └── index.ts   # StripeApps: aggregates modules, exposes raw() + fromEnv()
├── cli/index.ts   # commander-based CLI
├── types/index.ts # Types + StripeAppsApiError
└── utils/         # config (profiles) + output (json/pretty)
```

## API Reference

```typescript
import { StripeApps } from '@hasna/connect-stripeapps';

const client = new StripeApps({ apiKey: 'YOUR_API_KEY' });

// Items
await client.items.list({ limit: 10, cursor, status });   // GET  /items
await client.items.create({ name: 'Widget' });            // POST /items
await client.items.get('item_123');                       // GET  /items/{itemId}

// Events
await client.events.list({ limit: 10, type: 'item.created' }); // GET /events

// Search
await client.search.search({ query: 'widget', filters }); // POST /search

// Raw (any endpoint)
await client.raw({ method: 'GET', path: '/items' });
```

`StripeApps.fromEnv()` builds a client from `STRIPEAPPS_API_KEY` (+ optional `STRIPEAPPS_BASE_URL`). Errors are thrown as `StripeAppsApiError` with `statusCode` and optional `detail`.

## Authentication

- `STRIPEAPPS_API_KEY` environment variable, or
- `connect-stripeapps config set-key <key>` (stored per profile under `~/.hasna/connectors/stripeapps/`).

## Code Style

- TypeScript strict mode, ESM modules
- Minimal dependencies: commander, chalk
- Async/await throughout
