# CLAUDE.md

Guidance for working with the Sprig connector.

## Overview

`@hasna/connect-sprig` is a TypeScript connector for the Sprig product research API (`https://api.sprig.com`).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

- **v2 user import APIs** (users): `Authorization: API-Key <key>`
- **purge and v1 export APIs** (purge, surveys, responses, themes): `Authorization: Bearer <key>`

API key via `SPRIG_API_KEY` env var or profile at `~/.hasna/connectors/connect-sprig/profiles/`.

## Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client with dual auth + retry
│   ├── resources.ts   # Users, purge, surveys, responses, themes
│   └── index.ts       # Sprig facade
├── cli/index.ts
├── types/index.ts
└── utils/{config,output}.ts
```

## API Notes

- User upsert (`POST /v2/users`) returns **202 Accepted**, not 200
- Rate limits (429) are retried with exponential backoff
- Public OpenAPI: https://docs.sprig.com/reference/sprig-api.json

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPRIG_API_KEY` | API key (overrides profile) |
| `SPRIG_BASE_URL` | Optional base URL override |
