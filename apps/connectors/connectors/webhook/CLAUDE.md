# CLAUDE.md

This file provides guidance to Claude Code when working with connect-webhook.

## Project Overview

connect-webhook is a TypeScript connector for the Webhook REST API (`https://api.webhook.com/v1`). It provides a CLI and library for managing hooks, listing events, searching resources, and raw API access.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test

bun run dev hooks list
bun run dev hooks create --name my-hook --url https://example.com/hook
bun run dev hooks get <hookId>
bun run dev events list
bun run dev search --query invoice
bun run dev raw-request --path /hooks
```

## API Details

- **Base URL**: `https://api.webhook.com/v1` (override with `WEBHOOK_BASE_URL`)
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**:
  - `GET /hooks` — List hooks
  - `POST /hooks` — Create hook
  - `GET /hooks/{hookId}` — Get hook
  - `GET /events` — List events
  - `POST /search` — Search resources

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBHOOK_API_KEY` | API key (overrides profile) |
| `WEBHOOK_BASE_URL` | Custom API base URL |

## Config Storage

```
~/.hasna/connectors/connect-webhook/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander
- chalk
