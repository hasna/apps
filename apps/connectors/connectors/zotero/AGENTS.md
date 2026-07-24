# AGENTS.md

Guidance for AI agents working with connect-zotero.

## Overview

Zotero Web API v3 connector with API-key auth, multi-profile config, and CLI/library entry points.

## Quick Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Key Features

- Items: list, search, get, create, update, delete
- Collections: list, get, create
- Attachments: URL/file attachments and 3-step file upload
- Raw request escape hatch for unlisted endpoints
- Multi-profile config under `~/.hasna/connectors/connect-zotero/`

## Environment

| Variable | Description |
|----------|-------------|
| `ZOTERO_API_KEY` | API key |
| `ZOTERO_LIBRARY_ID` | Library ID |
| `ZOTERO_LIBRARY_TYPE` | `users` or `groups` |
| `ZOTERO_BASE_URL` | Optional API base URL |

## Security

- Never commit real API keys
- `.env.example` contains placeholders only
- No browser-use or scraper dependencies
