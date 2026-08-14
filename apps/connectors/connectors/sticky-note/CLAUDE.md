# CLAUDE.md

Guidance for working with the StickyNote connector.

## Overview

`@hasna/connect-sticky-note` is a TypeScript connector for the StickyNote REST API (`https://api.sticky-note.com/v1`). It provides CLI and library access for notes, events, search, and raw API passthrough.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## Authentication

- **Type:** Bearer token (`api_key`)
- **Env:** `STICKY_NOTE_API_KEY`
- **Optional base URL:** `STICKY_NOTE_BASE_URL` (default `https://api.sticky-note.com/v1`)
- **Profiles:** `~/.hasna/connectors/connect-sticky-note/profiles/`

## CLI Commands

| Command | API |
|---------|-----|
| `list-notes` | GET /notes |
| `create-note` | POST /notes |
| `get-note <noteId>` | GET /notes/:noteId |
| `list-events` | GET /events |
| `search` | POST /search |
| `raw-request` | Custom path/method |

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP transport
│   ├── client.test.ts # Mock fetch tests
│   └── index.ts       # StickyNote API class
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Types and errors
├── utils/
│   ├── config.ts      # Multi-profile config
│   └── output.ts      # Output formatting
└── index.ts           # Library exports
```

## Dependencies

- commander
- chalk

No browser-use or scraper dependencies.
