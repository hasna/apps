# CLAUDE.md

This file provides guidance to Claude Code when working with the Wildcard connector.

## Project Overview

connect-wildcard is a TypeScript CLI and library for the Wildcard API (`https://api.wild-card.ai`). It supports tool search, endpoint discovery, and agents.json flow execution against third-party OpenAPI sources.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Auth

- Type: API Key (`X-API-Key` header)
- Docs: https://docs.wild-card.ai/

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WILDCARD_API_KEY` | API key (overrides profile) |
| `WILDCARD_BASE_URL` | API base URL (default `https://api.wild-card.ai`) |
| `WILDCARD_DEFAULT_COLLECTION_ID` | Default collection for search/get-flow |
| `WILDCARD_PROVIDER_AUTH_JSON` | JSON map of source ID → provider auth for `invoke-flow` |

## Data Storage

```
~/.hasna/connectors/connect-wildcard/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "wc-xxx",
  "baseUrl": "https://api.wild-card.ai",
  "defaultCollectionId": "collection_id",
  "providerAuthJson": {
    "crm": { "type": "bearer", "token": "..." }
  }
}
```

## Structure

```
src/
├── api/
│   ├── client.ts   # HTTP client (X-API-Key)
│   ├── search.ts   # /search, /flow
│   ├── query.ts    # /query/* endpoints
│   ├── flows.ts    # agents.json helpers + invokeFlow
│   └── index.ts    # Wildcard facade
├── cli/index.ts
├── types/index.ts
└── utils/
    ├── config.ts
    ├── args.ts
    └── url.ts
```

## CLI Commands

`search-tools`, `get-flow`, `search-endpoints`, `get-action-schema`, `list-public-tools`, `get-endpoint-count`, `list-endpoints`, `list-flows`, `create-flow-prompt`, `create-openai-tools`, `invoke-flow`, `raw-request`, plus `config` and `profile` management.

## Security

- External URL fetches (OpenAPI specs, agents.json URLs) require HTTPS
- `raw-request` rejects absolute paths
- No secrets in source; use `.env.example` placeholders only
