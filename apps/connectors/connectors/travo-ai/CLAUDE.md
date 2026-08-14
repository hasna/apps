# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Travo AI connector — a TypeScript CLI and library for the [Travo](https://travo.ai) travel AI platform API (`https://api.travo.ai/v1`).

## Auth

- **Type**: API key sent as a **Bearer token** (`Authorization: Bearer <api_key>`)
- **Env**: `TRAVO_AI_API_KEY` (required), `TRAVO_AI_BASE_URL` (optional)
- **Profiles**: `~/.hasna/connectors/connect-travo-ai/profiles/`

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Methods

| Method | HTTP | Path |
|--------|------|------|
| `listTrips` | GET | `/trips` |
| `createTrip` | POST | `/trips` |
| `getTrip` | GET | `/trips/:id` |
| `listEvents` | GET | `/events` |
| `search` | POST | `/search` |
| `rawRequest` | * | custom path |

## CLI Commands

```bash
connect-travo-ai trips list
connect-travo-ai trips get <tripId>
connect-travo-ai trips create --body '{"destination":"Paris"}'
connect-travo-ai events list
connect-travo-ai search --query "hotels in Tokyo"
connect-travo-ai raw --path /trips --method GET
```

## Project Structure

```
src/
├── api/client.ts   # HTTP client (Bearer auth)
├── api/index.ts    # TravoAi facade
├── cli/index.ts    # Commander CLI
├── types/index.ts  # Trip/Event/Search types
└── utils/          # config + output
```
