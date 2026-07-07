# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-sprinklr is a TypeScript connector for the Sprinklr customer experience platform API. It provides CLI and library access to cases, events, search, and raw API requests.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Uses Bearer token authentication with an API key:

```typescript
'Authorization': `Bearer ${apiKey}`
```

Requires:
- API key (`SPRINKLR_API_KEY` or profile config)

Optional:
- Base URL override (`SPRINKLR_BASE_URL`, default `https://api.sprinklr.com/v1`)

## API Coverage

- `GET /cases` — list cases
- `POST /cases` — create case
- `GET /cases/:id` — get case
- `GET /events` — list events
- `POST /search` — search
- Raw request — arbitrary path/method

## Data Storage

```
~/.hasna/connectors/connect-sprinklr/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
