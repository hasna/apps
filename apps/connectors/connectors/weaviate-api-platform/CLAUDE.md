# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-weaviate-api-platform is a TypeScript connector for the [Weaviate API Platform](https://weaviate.io/). It provides item management, event listing, vector search, and raw API access via Bearer token authentication.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `Authorization: Bearer <api_key>` header.

## Base URL

```
https://api.weaviateapiplatform.com/v1
```

Override with profile `baseUrl` or `WEAVIATE_API_PLATFORM_BASE_URL`.

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   ├── client.test.ts
│   └── index.ts      # Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts
└── utils/
    ├── config.ts
    └── output.ts
```

## API Endpoints

- `GET /items` — list items
- `POST /items` — create item
- `GET /items/{id}` — get item
- `GET /events` — list events
- `POST /search` — search

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEAVIATE_API_PLATFORM_API_KEY` | API key (overrides profile) |
| `WEAVIATE_API_PLATFORM_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-weaviate-api-platform items list
connect-weaviate-api-platform items create -b '{"name":"example"}'
connect-weaviate-api-platform items get <itemId>
connect-weaviate-api-platform events list
connect-weaviate-api-platform search -b '{"query":"hello"}'
connect-weaviate-api-platform raw-request -p /items -m GET
connect-weaviate-api-platform config set-key <key>
connect-weaviate-api-platform profile list|use|create|delete|show
```
