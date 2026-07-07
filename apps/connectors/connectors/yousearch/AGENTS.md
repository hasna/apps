# AGENTS.md

Guidance for AI agents working with the You.com Search connector.

## Overview

`connect-yousearch` is a TypeScript CLI and library for the You.com Search and Research APIs.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API Key via `X-API-Key` header. Set via `YOUSEARCH_API_KEY` or `connect-yousearch config set-key`.

## Data Storage

```
~/.hasna/connectors/connect-yousearch/
├── current_profile
└── profiles/
    └── default.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/search` | GET | Simple web/news search |
| `/v1/search` | POST | Search with domain arrays |
| `/v1/research` | POST | Multi-step research with citations |

Default base URL: `https://api.you.com` (configurable via profile or `YOUSEARCH_BASE_URL`).
