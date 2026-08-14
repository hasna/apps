# CLAUDE.md

This file provides guidance to Claude Code when working with the Zatanna connector.

## Project Overview

`@hasna/connect-zatanna` is a TypeScript connector for the Zatanna AI workflow automation API (`https://api.zatanna.ai/v1`).

## Build & Run Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Authentication

- **Type:** API key (`api_key`)
- **Default:** Bearer token in `Authorization` header
- **Optional:** Custom `authHeader` profile field
- **Optional:** `defaultWorkspaceId` for workflow queries

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZATANNA_API_KEY` | API key |
| `ZATANNA_BASE_URL` | Override base URL |
| `ZATANNA_AUTH_HEADER` | Custom auth header name |
| `ZATANNA_DEFAULT_WORKSPACE_ID` | Default workspace |

## Data Storage

```
~/.hasna/connectors/connect-zatanna/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "zat_xxx",
  "defaultWorkspaceId": "workspace_id"
}
```

## API Surface

- `searchWorkflows` — GET `/workflows`
- `discoverWorkflows` — GET `/workflows/discover`
- `getWorkflow` — GET `/workflows/{id}`
- `invokeWorkflow` — POST `/workflows/{id}/invoke`
- `invokeHostedEndpoint` — arbitrary relative path
- `getRunStatus` — GET `/runs/{id}`
- `listRunEvents` — GET `/runs/{id}/events`
- `exportWorkflow` — GET `/workflows/{id}/export`
- `replayCapture` — POST `/captures/{id}/replay`
- `rawRequest` — escape hatch (relative paths only)

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client with auth
│   ├── workflows.ts   # Workflow API methods
│   └── index.ts       # Zatanna facade
├── cli/index.ts       # CLI commands
├── types/index.ts     # Types and ZatannaApiError
└── utils/
    ├── config.ts      # Multi-profile config
    └── output.ts      # CLI formatting
```
