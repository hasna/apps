# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-sparkpost is a TypeScript connector for the SparkPost API v1. It provides CLI and library access to send transactional emails, manage templates, sending domains, suppressions, webhooks, and analytics.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts

# Example commands
bun run dev transmission send --to user@example.com --from sender@example.com --subject "Test" --html "<p>Hello</p>"
bun run dev template ls
bun run dev domain ls
bun run dev config show
```

## Authentication

Uses raw API key in Authorization header (not Bearer):
```typescript
'Authorization': apiKey
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPARKPOST_API_KEY` | API key (overrides profile) |
| `SPARKPOST_REGION` | API region: `us` (default) or `eu` |

## API Regions

| Region | Base URL |
|--------|----------|
| US | `https://api.sparkpost.com/api/v1` |
| EU | `https://api.eu.sparkpost.com/api/v1` |

## Data Storage

```
~/.hasna/connectors/connect-sparkpost/
├── current_profile
└── profiles/
    └── default.json
```

## API Coverage

- Transmissions: send, list, get, delete
- Templates: list, get, create, update, publish, preview, delete
- Sending domains: list, get, create, update, verify, delete
- Suppression list: list, get, add, delete
- Metrics: deliverability stats
- Events: message events
- Webhooks: list, get, create, update, delete
- Recipient lists: list, get, create, update, delete
- IP pools: list, get, create, update, delete
- Sending IPs: list
- Account & subaccounts
- Recipient validation: single and bulk
- Inbound domains: list, get, create, delete
