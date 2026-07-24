# CLAUDE.md

This file provides guidance to Claude Code when working with the connect-tidio connector.

## Project Overview

connect-tidio is a TypeScript connector for the Tidio OpenAPI. It provides CLI and library access to manage contacts, conversations, operators, departments, tags, automations, canned responses, webhooks, and project settings.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run dev contact list
bun run dev conversation list
bun run dev project get
bun run dev config show
```

## API Details

- **Base URL**: `https://api.tidio.co/v1`
- **Auth**: Custom header `X-Tidio-Openapi-Key: <api_key>` (NOT Bearer token)
- **Format**: JSON REST
- **Docs**: https://developers.tidio.com/reference

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with X-Tidio-Openapi-Key auth and retry
│   └── index.ts      # Tidio API wrapper class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

### Contacts
- List, get, create, update, delete contacts

### Conversations
- List, get conversations
- List and send messages
- Set status (open/closed/snoozed)
- Assign to operator or department

### Operators & Departments
- List and get operators
- List departments

### Tags
- List, create, delete tags

### Automations
- List automations

### Canned Responses
- List and create canned responses

### Webhooks
- List, create, delete webhooks

### Project
- Get project details

## Authentication

Uses API key authentication with the Tidio OpenAPI:

```typescript
'X-Tidio-Openapi-Key': apiKey
```

Generate the key in Tidio Panel under **Developer > OpenAPI**.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIDIO_API_KEY` | OpenAPI key (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-tidio/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
