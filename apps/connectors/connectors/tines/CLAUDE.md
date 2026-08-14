# CLAUDE.md

This file provides guidance to Claude Code when working with the Tines connector.

## Project Overview

`@hasna/connect-tines` is a TypeScript connector for the Tines SOAR API with Bearer token authentication and multi-profile CLI support.

## Authentication

**Bearer Token** — set `TINES_API_KEY` and `TINES_TENANT_URL` (must be `https://`).

Profiles stored in `~/.hasna/connectors/connect-tines/profiles/`.

Webhooks use `{tenant}/webhook/{path}/{secret}` without Bearer auth.

## Build & Run

```bash
bun install
bun run dev stories list
bun run typecheck
bun test
bun run build
```

## API Base URL

`{tenantUrl}/api/v1` — tenant URL is normalized (trailing slashes stripped, https required).

## Key Modules

- `src/api/client.ts` — HTTP client, query builder, webhook helper
- `src/api/stories.ts` — story CRUD, export/import
- `src/api/agents.ts` — agent list/run/test
- `src/cli/index.ts` — Commander CLI

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINES_API_KEY` | API key (Bearer token) |
| `TINES_TENANT_URL` | Tenant URL, e.g. `https://your-tenant.tines.com` |
