# CLAUDE.md

## Project Overview

connect-speakeasy-api is a TypeScript connector for the Speakeasy REST API (OpenAPI v0.4.0).

## Build & Run

```bash
bun install
bun run dev auth validate
bun run typecheck
bun test
bun run build
```

## API Details

- **Base URL**: `https://api.prod.speakeasyapi.dev`
- **Auth**: `x-api-key` header (NOT Bearer)
- **Docs**: https://speakeasy.com/docs

## Structure

```
src/
├── api/          # HTTP client + API modules (auth, apis, endpoints, ...)
├── cli/          # Commander CLI
├── types/        # TypeScript types
└── utils/        # config + output
```

## Environment

| Variable | Description |
|----------|-------------|
| `SPEAKEASY_API_KEY` | API key |
| `SPEAKEASY_TOKEN` | Alias for API key |
| `SPEAKEASY_BASE_URL` | Optional base URL override |

Config profiles: `~/.hasna/connectors/connect-speakeasy-api/profiles/`
