# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-adalo is a TypeScript connector for the Adalo no-code platform API. It provides collection record CRUD operations and push notification sending through a clean CLI and programmatic interface.

## API Reference

- **Base URL**: `https://api.adalo.com/v0`
- **Auth**: Bearer token (`Authorization: Bearer <token>`)
- **Rate Limit**: 5 requests/second
- **API Docs**: https://developers.adalo.com

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Records | Collection record CRUD | list, get, create, update, delete |
| Notifications | Push notifications | send |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ADALO_API_KEY` | API key (required) |
| `ADALO_APP_ID` | Default App ID (optional, can use --app-id) |

## Key Patterns

- All record operations are scoped to an app: `/apps/{appId}/collections/{collectionId}`
- App ID can be set via env var, --app-id flag, or passed to each method
- Record IDs are numeric
- Collections are user-defined, so records use generic key-value types
- Pagination uses offset/limit query parameters
- Filtering uses filterKey/filterValue query parameters

## CLI Commands

```bash
connect-adalo records list <collectionId> [--offset N] [--limit N] [--filter-key <key>] [--filter-value <value>]
connect-adalo records get <collectionId> <recordId>
connect-adalo records create <collectionId> -d '{"field": "value"}'
connect-adalo records update <collectionId> <recordId> -d '{"field": "newValue"}'
connect-adalo records delete <collectionId> <recordId>
connect-adalo notify send --user-id <id> --title "Title" --body "Body"
connect-adalo profile list|use|create|delete|show
connect-adalo config set-key|show|clear
```

## Build & Run

```bash
bun install
bun run dev              # Run CLI in development
bun run build            # Build for distribution
bun run typecheck        # Type check
```
