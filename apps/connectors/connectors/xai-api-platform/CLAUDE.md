# CLAUDE.md

This file provides guidance to Claude Code when working with the Xai API Platform connector.

## Project Overview

`connect-xai-api-platform` is a TypeScript CLI and library for the Xai API Platform REST API at `https://api.xaiapiplatform.com/v1`. It is **distinct** from `connect-xai` (Grok at `api.x.ai`).

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token via `XAI_API_PLATFORM_API_KEY` or `connect-xai-api-platform config set-key <key>`.

## API Surface

| Method | Endpoint | CLI |
|--------|----------|-----|
| GET | `/items` | `items list` |
| POST | `/items` | `items create --body` |
| GET | `/items/:itemId` | `items get <id>` |
| GET | `/events` | `events list` |
| POST | `/search` | `search --body` |
| * | custom | `raw --path` |

## Data Storage

```
~/.hasna/connectors/connect-xai-api-platform/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander
- chalk
