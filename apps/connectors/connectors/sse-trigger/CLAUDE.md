# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-sse-trigger is a TypeScript connector for the SseTrigger REST API. It provides a CLI and library for managing SSE workflow streams, listing events, and running searches.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test

bun run dev streams list
bun run dev streams get <streamId>
bun run dev events list
bun run dev search run --body '{"query":"workflow"}'
bun run dev raw request --path /streams
```

## API Details

- **Base URL**: `https://api.sse-trigger.com/v1`
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**:
  - `GET /streams` — list streams
  - `POST /streams` — create stream
  - `GET /streams/{id}` — get stream
  - `GET /events` — list events
  - `POST /search` — search events

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SSE_TRIGGER_API_KEY` | API key (overrides profile) |
| `SSE_TRIGGER_BASE_URL` | Override base URL |

## Data Storage

```
~/.hasna/connectors/connect-sse-trigger/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-key",
  "baseUrl": "https://api.sse-trigger.com/v1"
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
