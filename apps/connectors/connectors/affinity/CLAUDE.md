# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-affinity is a TypeScript connector for the Affinity CRM API (v2). It provides full access to persons, companies, opportunities, lists, notes, and field values with Bearer token authentication.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## API Reference

- **Base URL**: `https://api.affinity.co`
- **Auth**: Bearer token (`Authorization: Bearer <key>`)
- **Rate Limit**: 900 requests/user/minute
- **Pagination**: Cursor-based with `page_size` and `page_token`/`next_page_token`

## API Modules

| Module | Resource | Endpoints |
|--------|----------|-----------|
| `persons` | Persons | list, get, create, update, delete via `/v2/persons` |
| `organizations` | Companies | list, get, create, update, delete via `/v2/companies` |
| `opportunities` | Opportunities | list, get, create, update, delete via `/v2/opportunities` |
| `lists` | Lists | list, get, getFields, listEntries, getEntry, createEntry, deleteEntry via `/v2/lists` |
| `notes` | Notes | list, get, create, update, delete via `/v2/notes` |
| `fieldValues` | Field Values | create, update, delete via `/field-values` |

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-key\|show\|clear` | Manage configuration |
| `person list\|get\|create\|delete` | Manage persons |
| `company list\|get\|create\|delete` | Manage companies |
| `opportunity list\|get\|create\|delete` | Manage opportunities |
| `list all\|get\|fields\|entries\|get-entry\|add-entry\|delete-entry` | Manage lists and entries |
| `note list\|get\|create\|delete` | Manage notes |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AFFINITY_API_KEY` | Affinity API key (overrides profile) |
| `AFFINITY_TOKEN` | Alias for API key |

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
