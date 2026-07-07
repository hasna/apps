# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Windmill API Platform connector CLI - a TypeScript wrapper for workspace-scoped Windmill REST APIs. Provides multi-profile configuration, Bearer token authentication, and Commander.js CLI commands.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via API key:

```typescript
'Authorization': `Bearer ${apiKey}`,
```

Credentials via environment or profile config:

| Variable | Description |
|----------|-------------|
| `WINDMILL_API_PLATFORM_API_KEY` | API key (overrides profile) |
| `WINDMILL_API_PLATFORM_BASE_URL` | Required Windmill API base URL, e.g. `https://windmill.example.com/api` |
| `WINDMILL_API_PLATFORM_WORKSPACE` | Required workspace id |

## CLI Commands

```bash
connect-windmill-api-platform profile list
connect-windmill-api-platform config set-key <key>
connect-windmill-api-platform config set-base-url https://windmill.example.com/api
connect-windmill-api-platform config set-workspace <workspace>
connect-windmill-api-platform scripts list
connect-windmill-api-platform scripts get u/admin/script
connect-windmill-api-platform scripts run-wait u/admin/script --body '{"name":"example"}'
connect-windmill-api-platform flows list
connect-windmill-api-platform resources list
connect-windmill-api-platform jobs list
connect-windmill-api-platform raw-request --path /w/<workspace>/scripts/list --method GET
```

## Data Storage

```
~/.hasna/connectors/connect-windmill-api-platform/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://your-windmill.example.com/api",
  "workspace": "your-workspace"
}
```

## API Operations

- `GET /w/{workspace}/scripts/list` - list scripts
- `GET /w/{workspace}/scripts/get/p/{path}` - get a script
- `POST /w/{workspace}/jobs/run_wait_result/p/{path}` - run a script and wait for the result
- `GET /w/{workspace}/flows/list` - list flows
- `GET /w/{workspace}/resources/list` - list resources
- `GET /w/{workspace}/jobs/list` - list jobs
- `raw-request` — arbitrary path/method

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
