# CLAUDE.md

This file provides guidance to Claude Code when working with the Statuspage connector.

## Project Overview

connect-statuspage is a TypeScript connector for the Atlassian Statuspage Manage API (`https://api.statuspage.io/v1`). It provides a CLI and programmatic interface for managing status pages, incidents, and components.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## CLI Commands

```bash
# Authentication
connect-statuspage config set-api-key <key>
connect-statuspage config set-page-id <id>
connect-statuspage config show
connect-statuspage config clear

# Profile management
connect-statuspage profile list
connect-statuspage profile use <name>
connect-statuspage profile create <name>
connect-statuspage profile delete <name>

# Validation
connect-statuspage validate [page_id]

# Pages
connect-statuspage pages list
connect-statuspage pages get <page_id>

# Incidents
connect-statuspage incidents list [page_id]
connect-statuspage incidents get <page_id> <incident_id>
connect-statuspage incidents create [page_id] --name <name>
connect-statuspage incidents update <page_id> <incident_id> --status <status>

# Components
connect-statuspage components list [page_id]
connect-statuspage components get <page_id> <component_id>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STATUSPAGE_API_KEY` | Organization API key (overrides profile) |
| `STATUSPAGE_PAGE_ID` | Default page ID for page-scoped commands |

## Authentication

Uses a static organization API key. Create keys at https://manage.statuspage.io (avatar > API info). Only account owners can create or delete keys.

## Request Format

Send the API key in the `Authorization` header with the literal `OAuth ` prefix before the key value (this is a static key header format required by Statuspage, not a token exchange flow). Do not pass `api_key` as a query parameter.

Example:

```bash
curl -H "Authorization: OAuth YOUR_API_KEY" https://api.statuspage.io/v1/pages
```

## Data Storage

```
~/.hasna/connectors/connect-statuspage/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON structure:

```json
{
  "apiKey": "your-api-key",
  "pageId": "your-page-id"
}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   └── index.ts
├── cli/
│   └── index.ts
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts
│   └── output.ts
└── index.ts
```

## API Coverage

- Pages: list, get
- Incidents: list, get, create, update
- Components: list, get
- Validate: smoke test via GET /pages/{page_id}

## Code Style

- TypeScript strict mode, ESM modules
- Minimal dependencies: commander, chalk
- Async/await for all API calls
