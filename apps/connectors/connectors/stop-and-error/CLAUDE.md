# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-stop-and-error is a TypeScript connector for the StopAndError workflow error handler API. It provides multi-profile configuration, Bearer API key authentication, and a Commander-based CLI.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

**Type:** `apikey` / Bearer token

StopAndError uses Bearer token authentication with an API key:

```typescript
Authorization: Bearer <api_key>
```

Credentials can be set via:
- Environment variable `STOP_AND_ERROR_API_KEY`
- Profile configuration: `stop-and-error config set-key <key>`

Optional base URL override:
- `STOP_AND_ERROR_BASE_URL` (default `https://api.stop-and-error.com/v1`)

## API Endpoints

| Operation | Method | Path |
|-----------|--------|------|
| List errors | GET | `/errors` |
| Get error | GET | `/errors/{id}` |
| Create error | POST | `/errors` |
| List events | GET | `/events` |
| Search | POST | `/search` |

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client with Bearer auth
│   ├── client.test.ts # Mocked fetch unit tests
│   └── index.ts       # StopAndError connector class
├── cli/
│   └── index.ts       # CLI commands
├── types/
│   └── index.ts       # TypeScript types
├── utils/
│   ├── config.ts      # Multi-profile configuration
│   └── output.ts      # CLI output formatting
└── index.ts           # Library exports
```

## Data Storage

```
~/.hasna/connectors/stop-and-error/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
