# CLAUDE.md

## Project Overview

connect-tettra is a TypeScript connector for the Tettra REST API v1 (`https://api.tettra.co/v1`). It provides a CLI and library for listing/creating pages, listing events, and searching team knowledge.

**Auth**: Bearer token via `TETTRA_API_KEY` (generate at Tettra team settings → API).

Tettra has two API surfaces: legacy team endpoints on `app.tettra.co` and the v1 API documented at `api.tettra.co/v1`. This connector implements **v1 only**.

## Build & Run

```bash
bun install
bun run dev pages list
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Endpoints

| Method | Path | Module |
|--------|------|--------|
| GET | `/pages` | `pages.list` |
| GET | `/pages/:id` | `pages.get` |
| POST | `/pages` | `pages.create` |
| GET | `/events` | `events.list` |
| POST | `/search` | `search.search` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TETTRA_API_KEY` | Bearer API key |
| `TETTRA_BASE_URL` | Optional base URL override |

## Config Storage

`~/.hasna/connectors/connect-tettra/profiles/`
