# CLAUDE.md — Trellis Tech Connector

## Overview

`@hasna/connect-trellistech` wraps the Trellis Tech Public REST API v1 for short-term rental property and task operations.

- **Base URL:** `https://app.trellistech.com/api/v1`
- **Auth:** `Authorization: Bearer <workspace API key>` (`trls_...`)
- **Required config:** `TRELLISTECH_API_KEY`, `TRELLISTECH_WORKSPACE_ID`
- **Docs:** https://docs.trellistech.com/api-reference
- **OpenAPI:** https://app.trellistech.com/api/v1/openapi.public.json

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client (Bearer, retry on 429/5xx)
│   ├── properties.ts  # Property CRUD
│   ├── tasks.ts       # Task CRUD
│   └── index.ts       # Trellistech facade
├── cli/index.ts       # connect-trellistech CLI
├── types/index.ts     # OpenAPI-aligned types
└── utils/             # Config, output, auth helpers
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRELLISTECH_API_KEY` | Workspace API key |
| `TRELLISTECH_WORKSPACE_ID` | Workspace slug/ID (must match key scope) |
| `TRELLISTECH_BASE_URL` | Optional API base URL override |

Profiles stored at `~/.hasna/connectors/connect-trellistech/profiles/`.

## API Modules

- **properties** — list, get, create, update, replace, delete
- **tasks** — list, get, create, update, replace, delete

Do not use legacy `api.trellistech.com` paths from internal platforms; only public v1 workspace-scoped endpoints are supported.
